# Deploying the Get Hired UK API to AWS (eu-west-2 / London)

**Target architecture** — chosen for a UK, low-traffic business app that runs a
nightly cron job:

```
Vercel (frontend)  ──HTTPS──►  Caddy (TLS, :443)  ──►  Node API (:4000, loopback)
                                   EC2 t4g.small · eu-west-2
                                          │
                          ┌───────────────┴───────────────┐
                          ▼                               ▼
              RDS PostgreSQL (private)            S3 (CVs, documents)
              db.t4g.micro                        via IAM instance role
```

**Why this shape:** the Daily Pulse runs on `node-cron`, which needs a
long-running process — so Lambda is out. Caddy gives free auto-renewing TLS,
avoiding a ~£15/mo load balancer that low traffic doesn't need. All data stays
in **London (eu-west-2)** for UK data residency (you store CVs and personal data).

**Rough cost:** EC2 t4g.small ~£10 + RDS db.t4g.micro ~£12 + S3/transfer ~£1
≈ **£25–30/month**.

---

## 1. S3 bucket (documents)

Console → S3 → **Create bucket**, region **eu-west-2**:

- Name: `gethired-uk-documents`
- **Block all public access: ON** (files are only served via short-lived signed URLs)
- Default encryption: SSE-S3

## 2. RDS PostgreSQL

Console → RDS → **Create database**, region **eu-west-2**:

- Engine: **PostgreSQL 16**
- Template: **Free tier** (or Dev/Test) → instance **db.t4g.micro**
- Storage: 20 GB gp3, **storage autoscaling on**
- Credentials: master user `gethired`, strong password (save it)
- Connectivity: **Public access = No**
- Initial database name: `gethired`
- Backups: **7 days** retention (this is your safety net — keep it)

Note the endpoint: `gethired-db.xxxx.eu-west-2.rds.amazonaws.com`

## 3. IAM role for the server (no static keys)

IAM → **Roles → Create role** → AWS service → EC2. Attach an inline policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
    "Resource": "arn:aws:s3:::gethired-uk-documents/*"
  }]
}
```

Name it `gethired-ec2-role`. The SDK picks these credentials up automatically —
**never put AWS keys in `.env`.**

## 4. EC2 instance

Console → EC2 → **Launch instance**, region **eu-west-2**:

- Name: `gethired-api`
- AMI: **Ubuntu Server 24.04 LTS (ARM 64)**
- Instance type: **t4g.small**
- Key pair: create/download one (for SSH)
- Network: allow **HTTP (80)** and **HTTPS (443)** from anywhere; **SSH (22)** from *your IP only*
  — do **not** open port 4000; the app only listens on loopback
- IAM instance profile: `gethired-ec2-role`
- Elastic IP: allocate one and associate it (so the IP survives reboots)

**Security group wiring:** edit the **RDS** security group to allow inbound
PostgreSQL (5432) **only from the EC2 instance's security group**.

## 5. DNS

At your domain registrar, point an **A record** at the Elastic IP:

```
api.gethired.uk   A   <your-elastic-ip>
```

> **Tip:** put the frontend on `www.gethired.uk` (custom domain in Vercel) and the
> API on `api.gethired.uk`. Sharing a parent domain means login cookies work with
> the safer `SameSite=Lax` default. If you keep the frontend on `*.vercel.app`,
> you must set `COOKIE_SAMESITE=none` in the API `.env`.

## 6. Provision the server

SSH in: `ssh -i key.pem ubuntu@<elastic-ip>`

```bash
# Node 20 + git + Caddy
sudo apt update && sudo apt install -y curl git debian-keyring debian-archive-keyring apt-transport-https
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy

# App user + code
sudo useradd -r -m -d /srv/gethired -s /bin/bash gethired
sudo mkdir -p /srv/gethired && sudo chown gethired:gethired /srv/gethired
sudo -u gethired git clone https://github.com/Muheeeeb/Get-Hired-UK.git /srv/gethired/app
sudo -u gethired ln -s /srv/gethired/app/server /srv/gethired/server

cd /srv/gethired/server
sudo -u gethired npm ci --omit=dev
```

## 7. Configure and launch

```bash
# Secrets — fill in RDS endpoint, SMTP, and generate the three secrets:
#   openssl rand -base64 36
sudo -u gethired cp /srv/gethired/app/deploy/env.production.example /srv/gethired/server/.env
sudo -u gethired nano /srv/gethired/server/.env
sudo chmod 600 /srv/gethired/server/.env

# Database: apply migrations, then create the first admin (prints the password ONCE)
cd /srv/gethired/server
sudo -u gethired npx prisma migrate deploy
sudo -u gethired npm run seed

# Run the API as a service (auto-restarts, survives reboot, runs the cron)
sudo cp /srv/gethired/app/deploy/gethired-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now gethired-api
sudo systemctl status gethired-api

# TLS + reverse proxy (Caddy fetches a Let's Encrypt cert automatically)
sudo cp /srv/gethired/app/deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile        # set your real domain + email
sudo systemctl reload caddy
```

**Verify:** `curl https://api.gethired.uk/health` → `{"ok":true}`

## 8. Point the frontend at it

In Vercel → Project → Settings → Environment Variables:

```
VITE_API_URL = https://api.gethired.uk
```

Then **Redeploy** (the value is baked in at build time). The landing page's
portal-status dot should turn green, and login/sign-up/consultations go live.

---

## Operating it

```bash
sudo journalctl -u gethired-api -f      # live logs
sudo systemctl restart gethired-api     # restart
```

**Deploying an update:**

```bash
cd /srv/gethired/app && sudo -u gethired git pull
cd server && sudo -u gethired npm ci --omit=dev
sudo -u gethired npx prisma migrate deploy    # only if the schema changed
sudo systemctl restart gethired-api
```

## Post-launch checklist

- [ ] Change the generated admin password (portal → sidebar → **Account**)
- [ ] RDS automated backups on (7 days) — verify in the console
- [ ] SES out of sandbox mode (otherwise it only emails *verified* addresses)
- [ ] SPF/DKIM DNS records set, or the Daily Pulse lands in spam
- [ ] `COOKIE_SAMESITE=none` **only** if frontend and API are on different sites
- [ ] Port 4000 is **not** in the security group; SSH restricted to your IP
- [ ] Test end-to-end: sign up on the site → approve in admin → client signs in

# Get Hired UK — Operations Portal

Premium recruitment operations portal (PERN stack): PostgreSQL · Express · React · Node.
Navy & gold design system. Three role-gated dashboards: **Admin**, **Employee**, **Client**.

## Quick start (development)

Prerequisites: Node 20+, Docker (for PostgreSQL).

```bash
# 1. Database
docker compose up -d

# 2. API server  → http://localhost:4000
cd server
npm install
npx prisma migrate deploy
npm run seed          # creates the FIRST ADMIN only (prints the password once)
npm run dev

# 3. Frontend    → http://localhost:5173
cd ../client
npm install
npm run dev
```

`npm run seed` is the **production bootstrap**: it creates a single admin account
(set `ADMIN_EMAIL` / `ADMIN_NAME` / `ADMIN_PASSWORD` in `server/.env`, or a strong
password is generated and printed once). There is no demo data in a fresh install —
the admin creates employees and clients through the UI.

For a disposable sandbox with sample data, `npm run seed:demo` exists but is never
run automatically and should not be used on a production database (it wipes tables).

## Architecture

```
get-hired-uk/
├── docker-compose.yml      # PostgreSQL 16
├── server/                 # Express REST API (ESM)
│   ├── prisma/             # schema, migrations, seed
│   └── src/
│       ├── config/env.js   # all env parsing (fails fast on missing secrets)
│       ├── middleware/     # authenticate, authorizeRole, loadClientScope, zod validate
│       ├── lib/            # prisma, jwt+refresh rotation, storage (S3|local), mailer, ai
│       ├── routes/         # auth, admin, employee, clients, jobs, files, ai, interview
│       └── jobs/           # dailyPulse (node-cron, idempotent)
└── client/                 # React + Vite + Tailwind v4 SPA
    └── src/
        ├── api/            # axios + in-memory access token + silent refresh
        ├── auth/           # AuthContext
        ├── components/     # design system, MomentumMeter, LinkedInStepper, JobTable
        ├── layouts/        # AppShell (navy sidebar / mobile nav, alert mode)
        └── pages/          # admin/, employee/, client/ dashboards
```

## The Privacy Rule (enforced at the API)

A **client can never see, obtain a URL for, or download tailored documents**:

- `GET /clients/:id/jobs` strips tailored docs (and employee info) from client responses.
- `GET /files/:docId/signed-url` returns **403 immediately** when a client token
  requests a tailored document — even with a valid guessed UUID.
- Signed URLs (S3 presigned or local HMAC) expire after 5 minutes.
- Row-level scope on every route: employees → assigned clients only; clients → self only.

Run the security smoke test with both apps up: 32 checks covering the privacy rule,
row-level scoping, role gates, signed-URL tampering, validation, and pulse idempotency.

## Deploying

### Frontend → Vercel (ready now)

The client is a static Vite build; `client/vercel.json` already handles SPA
rewrites and asset caching.

1. Push this repo to GitHub, then in Vercel: **Add New Project → import repo**.
   - Root Directory: `client`
   - Framework preset: Vite (build `npm run build`, output `dist` — auto-detected)
2. Set one environment variable: `VITE_API_URL` = your API's public URL
   (e.g. `https://api.gethired.uk`). It is baked in at build time — redeploy after
   changing it.
3. Until the backend is live, the landing page works but logins, live stats,
   the portal-status dot, and the consultation form will be inactive.

CLI alternative: `cd client && npx vercel --prod`.

### Backend → AWS (when ready)

Any Node host works (Elastic Beanstalk, App Runner, ECS, or a plain EC2 + PM2):

1. Postgres on **RDS**; set `DATABASE_URL`. Run `npx prisma migrate deploy`
   then `npm run seed` once (creates the first admin).
2. Files on **S3**: `STORAGE_DRIVER=s3`, `AWS_REGION`, `AWS_S3_BUCKET` (+ IAM key
   or instance role). Do not use the local driver on AWS — instance disks are
   ephemeral.
3. Set `CLIENT_ORIGIN` to your exact Vercel URL (CORS is locked to it).
4. Cookies across two domains: if the SPA stays on `*.vercel.app` while the API
   is on an AWS domain, set `COOKIE_SAMESITE=none` (HTTPS required). With a
   custom domain for both (`www.gethired.uk` + `api.gethired.uk`) leave it unset.
5. `NODE_ENV=production`, strong `JWT_*`/`FILE_URL_SECRET`, SMTP + `AI_API_KEY`
   as needed. Terminate TLS at an ALB/CloudFront — `trust proxy` is already set.

## Production checklist

- Set strong random `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `FILE_URL_SECRET`.
- `NODE_ENV=production` (secure cookies, no stack traces in responses).
- `STORAGE_DRIVER=s3` + AWS/R2 credentials (files never live on the app host).
- SMTP credentials for the Daily Pulse (`SMTP_HOST` etc.); it logs to console when unset.
- `OPENAI_API_KEY` for real AI drafting; set `MOCK_AI=false`.
- Serve the client (`npm run build` → `dist/`) behind the same origin or set
  `CLIENT_ORIGIN` for CORS; run the API behind TLS with `trust proxy` (already set).
- `npx prisma migrate deploy` on release; never `migrate dev` in production.

## Key features

- **Momentum Meter** — animated gold progress ring; live count of this month's applications vs target.
- **LinkedIn Tracker** — Not Started → In Progress → Complete stepper.
- **Interview Prep Hub** — downloadable guides + coach tips.
- **✨ Draft with AI** — server-side OpenAI cover-letter drafts from the master CV (key never leaves the server).
- **Daily Pulse** — nightly branded email per client ("We applied for X jobs today!"), idempotent via `daily_pulse_log`.
- **Admin Leaderboard** — jobs per employee (today/week/month) vs prorated targets, green/amber/red.
- **Expiry Alert** — dashboards turn amber ≤ 7 days before expiry with a Renew CTA (days computed server-side).

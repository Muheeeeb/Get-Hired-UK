# Get Hired UK — Operations Portal · Delivery Report

**Date:** 12 July 2026 · **Stack:** PostgreSQL 16 · Express · React (Vite) · Node (PERN)
**Location:** `~/Desktop/Asad/get-hired-uk` · API `http://localhost:4000` · App `http://localhost:5173`

---

## 1. Your login

| | |
|---|---|
| **URL** | http://localhost:5173 |
| **Email** | `admin@gethired.uk` |
| **Password** | _generated at bootstrap — printed once by `npm run seed`; change it via sidebar → Account_ |

⚠️ **Change it immediately** after first sign-in: sidebar → **Account** → Change password.
The database is a **clean production state** — zero demo data. You create everything
through the UI from here.

## 2. How you operate it (the daily workflows)

**Admin — you:**
1. **Employees page** → create your team members (name, email, temporary password).
2. **Clients page** → create a client: package type, expiry date, monthly job target,
   assign an employee, and set their **3–5 domains** (enforced — the API rejects 2 or 6).
3. **Overview** → live KPIs (active clients, employees, jobs today/this month) and the
   **Renewals Radar** listing every package expiring within 7 days. A "Run Daily Pulse now"
   button triggers the evening email manually.
4. **Leaderboard** → jobs logged per employee, Today / This Week / This Month, ranked,
   with each employee's prorated target marked on the bar and a green ✓ / amber △ / red ✕ status.
5. **Sign-ups** → clients can self-register on the website (`/signup`); their
   request lands here as **pending** and they cannot sign in until you act.
   "Approve & set up" provisions their package, expiry, target, employee and
   domains in one step (and emails them that they're activated); "Reject" blocks
   access. A "Pending Sign-ups" KPI shows on the Overview.
6. **Prep Hub** → publish interview guides (with file) and tips that every client sees.
6. **Client detail page** → everything about one client: momentum, package editing,
   employee reassignment, domain editing, master documents, and the full job log
   **including tailored-file downloads** (admin sees all).

**Employee:**
1. **My Clients** → only their assigned clients, each card showing monthly progress,
   today's count, LinkedIn status, and expiry warnings.
2. **Client workspace → Domains & Masters** → upload one Master CV + one Master Cover
   Letter per domain (replacing an upload cleans up the old file automatically).
3. **Client workspace → Log Jobs** → record Job Title, Company, Date, URL; attach the
   Tailored CV + Tailored Cover Letter; **✨ Draft with AI** writes a cover letter from
   the client's master CV + the job details (editable, regenerable; the draft can be
   saved as the tailored cover letter automatically). Mistaken entries can be deleted.
4. **Client workspace → LinkedIn** → set Not Started / In Progress / Complete.

**Client (the VIP view):**
- **Momentum Meter** — animated gold ring: "X of Y jobs applied this month" with %.
- **LinkedIn Tracker** — gold stepper driven by the status your team sets.
- **Master Documents** — view/download their master CV + cover letter per domain.
- **Where We've Applied** — Company · Job Title · Date · clickable URL. **No tailored
  files, no download buttons — the API physically refuses to serve them (403).**
- **Interview Prep Hub** — downloadable guides + tips.
- **Expiry alert** — at ≤ 7 days the dashboard shifts to amber with a
  "Time is almost up!" banner and a Renew button. Days are computed on the server.
- Every evening (18:00 UK) the **Daily Pulse** email tells them how many jobs were
  applied for them today — branded navy/gold, never duplicated (unique log per day).

## 3. Security — what was verified, not just written

**49 automated end-to-end checks pass against the live API**, plus an independent
code-review agent verified the critical paths line-by-line and live. Highlights:

| Rule | Result |
|---|---|
| Client requests tailored-doc URL (own or others', even a valid guessed ID) | **403 always** |
| Client job list payload | zero tailored/employee/file fields present |
| Employee touches non-assigned client (dashboard/files/AI/uploads/deletes) | **403 on every route** |
| Admin + assigned employee download tailored files | ✅ works |
| Signed URLs | 5-min expiry, HMAC-verified, tamper → 403, path traversal blocked |
| Refresh tokens | rotation + reuse detection (stolen-token replay revokes the whole family) |
| Passwords | bcrypt (cost 12), min 10 chars, login rate-limited (20/15 min/IP) |
| Deactivated accounts | sessions revoked instantly, login blocked |
| Daily Pulse | idempotent — second run same day sends 0 |
| Invalid IDs / malformed input | clean 400/404s, Zod-validated, no internals leaked |
| Domains | 3–5 enforced server-side |
| Secrets (OpenAI, SMTP, DB, JWT, file-signing) | server-side env only, never in the browser |

Independent review findings (4, all fixed): non-UUID ids leaked Prisma errors → now
clean 404s; deleted jobs/resources/domains orphaned files in storage → storage now
cleaned up on every delete/replace; downloads used mangled key names → now use the
real filename; a redundant URL-decode hardened away.

## 4. What needs your keys (3 optional env vars in `server/.env`)

| Feature | Works now? | To fully enable |
|---|---|---|
| ✨ Draft with AI | Button shows a clean "not configured" message | Set `AI_API_KEY` (+ `AI_BASE_URL`/`AI_MODEL` for Groq/Llama — examples in `.env`) |
| Daily Pulse emails | Sends are logged to the server console | Set `SMTP_HOST/PORT/USER/PASS` (Resend/SendGrid SMTP) |
| File storage | Local disk with signed expiring URLs (production-grade HMAC) | Set `STORAGE_DRIVER=s3` + AWS/R2 creds to move files off-host |

Everything else — auth, roles, uploads, downloads, dashboards, leaderboard, cron,
expiry alerts — is fully live with no additional configuration.

## 5. Public landing page (http://localhost:5173/)

Product-led marketing site, benchmarked directly against recruittoday.co (reviewed
in a real browser during the build). Their site leans on illustrations and a generic
phone mockup; ours leads with **real screenshots of the actual portal** — our
strongest asset — captured from the live app (labelled "shown with sample data").

- **Hero** — warm ivory gradient, "Now accepting clients — <current month>" badge
  (computed, real), serif headline with a hand-drawn gold underline, dual CTAs, and
  a layered product visual: the real client dashboard in a browser frame over a
  navy panel, with a floating phone showing the real mobile view.
- **Live status strip** — real portal status (pings `/health` every 30 s) and
  London clock.
- **How it works** — six numbered step cards (icon chips, ghost numerals, hover
  lift): consultation → domains → master documents → daily applications →
  LinkedIn & prep → watch it happen.
- **Portal showcase** (navy) — "Track. Review. Relax." with the real application-
  ledger screenshot in a browser frame plus five feature rows (momentum meter,
  ledger, master docs, Daily Pulse, prep hub).
- **The complete career package** — gold timeline: CV revamp per domain, cover
  letter crafting, LinkedIn lift-off, a job search partner, interview insights.
- **Areas of focus** — six industry cards (Technology, Finance, Healthcare,
  Operations, Marketing, Product).
- **Packages** — Gold and Platinum (navy, gold ring, "Most popular"); fees
  "agreed at consultation" — no invented pricing.
- **FAQ** (two-column accordions), navy CTA band, rich four-column footer with
  the live clock and portal status.
- **Zero fabricated content**: no fake employer claims, testimonials, ratings,
  or statistics. The only product imagery is the genuine app; sample-data
  labelling appears in the hero, showcase, and footer.
- Marketing screenshots regenerate any time via the app itself (`npm run seed:demo`,
  capture, then re-run the wipe + `npm run seed`).

**Consultation booking is fully dynamic (no mailto CTAs).** Every "Book a
consultation" / "Enquire" button opens an in-page form (name, email, phone,
roles sought; package buttons pre-fill the enquiry). Submissions POST to
`POST /public/consultations` (rate-limited 5/hour/IP, Zod-validated), are stored
in the `consultation_requests` table, and trigger a branded notification email to
the office. In the portal, **Admin → Leads** lists every request with one-click
New → Contacted → Closed status tracking, and the Overview gained a "New Leads"
KPI. Verified end-to-end in a real browser: click → form → submit → success
screen → row in the admin Leads page → status update.

## 6. vs. recruittoday.co

- Bespoke navy/gold design system (Playfair Display + Inter), rounded-2xl cards,
  gold hairlines, animated momentum ring, skeleton loaders, fade/slide micro-animations.
- Fully responsive: navy sidebar on desktop, slide-over nav on mobile.
- A client dashboard that *proves* daily work: live momentum %, today's applications
  in the evening email, a growing application table with real links.
- Accessibility: keyboard focus rings, aria labels on steppers/dialogs/tables,
  status conveyed by text + icon (never color alone).

## 7. Running it

```bash
# everything is already running; to restart from scratch:
cd ~/Desktop/Asad/get-hired-uk
docker compose up -d                     # PostgreSQL
cd server && npm run dev                 # API :4000
cd ../client && npm run dev              # App :5173
```

Production deploy: `README.md` → "Production checklist" (secrets, S3, SMTP, TLS,
`prisma migrate deploy`, `npm run build`).

## 8. File map

- `server/prisma/schema.prisma` — full schema (UUID PKs, snake_case, soft-delete, cascades)
- `server/src/middleware/auth.js` — authenticate / authorizeRole / row-level client scope
- `server/src/routes/files.routes.js` — **the privacy rule** (tailored → 403 for clients)
- `server/src/jobs/dailyPulse.js` — nightly cron, idempotent
- `server/src/lib/` — tokens (JWT+rotation), storage (S3|local signed URLs), mailer, ai
- `client/src/pages/client/Dashboard.jsx` — the VIP dashboard
- `client/src/pages/admin/*` — Overview, Clients, ClientDetail, Employees, Leaderboard, Resources
- `client/src/pages/employee/*` — MyClients, ClientWorkspace (Log Jobs + AI)

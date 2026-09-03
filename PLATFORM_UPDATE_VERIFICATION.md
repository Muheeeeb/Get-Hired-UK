# Platform Update Verification Report

Source: `GetHiredGlobal_Dev_Requirements.pdf` (2 September 2026)

## 1. Client details visibility

Status: Complete

- The staff-facing client dashboard response includes the client's saved date of birth, NI number, visa status, visa expiry, phone number, postcode, residential address, country and notes.
- Admins can see the details on the Admin Client Detail page.
- The assigned employee can see the same details in the Client Workspace Personal Details tab.
- Existing row-level access remains enforced: an employee can only load an assigned client, while admins can load all clients.
- The client dashboard payload continues to omit staff-only personal-detail fields.

## 2. Package extension and monthly tracking

Status: Complete

- Admin Client Detail supports extending a package by 1–24 calendar months.
- Application totals are split into anniversary-based package months (Month 1, Month 2, Month 3, and beyond).
- Expiry dates are inclusive and calendar month-end clamping is handled (for example, 31 January + one month becomes 28/29 February).
- Separate monthly totals and progress are displayed on the client dashboard, admin client view and assigned employee workspace.
- Employee client-list progress now identifies and counts the current package month.

## 3. Full-screen client workspace

Status: Complete

- The application shell now maintains full viewport width and height.
- The desktop content maximum was widened while retaining responsive margins.
- Horizontal page overflow is contained.
- Workspace tabs scroll within their own row on narrow screens instead of widening/minimising the entire page.

## 4. Claude AI Studio

Status: Code complete; production secret required

- Anthropic Messages API integration is server-side; the key is never returned to the browser.
- Available Claude models are discovered from Anthropic's Models API and cached for five minutes.
- Admins can choose from all models available to the configured key.
- Admin Employee Detail includes an Allowed Claude Model setting.
- Employees receive only their assigned model and server-side authorization rejects attempts to request another model.
- The former OpenAI-compatible integration remains as a backwards-compatible fallback.
- Production must define `ANTHROPIC_API_KEY` in `/srv/gethired/app/server/.env` and restart `gethired-api`.

## 5. Homepage blog and success-story carousels

Status: Complete

- Both live CMS collections use horizontal scroll-snap tracks.
- Touch swipe is supported on mobile.
- Previous/next arrow navigation is provided when overflow exists.
- Controls update correctly at the beginning/end of each collection and remain keyboard-accessible buttons.

## Verification performed

- `npm test` in `server`: 7/7 passing.
- `npx prisma validate`: passing.
- `npx prisma generate`: passing.
- `npm run build` in `client`: passing.
- All inline homepage scripts compiled successfully in a static syntax check.
- All 10 migrations applied successfully to a clean temporary PostgreSQL 16 database; migration status reported up to date.
- End-to-end isolated API smoke test passed for:
  - client profile save and staff visibility;
  - client-payload privacy;
  - package extension and separate Month 1/Month 2 counts;
  - employee model assignment;
  - accepted assigned-model generation;
  - rejected employee model escalation (HTTP 403);
  - unrestricted admin model selection.
- Temporary database, API and test data were removed after verification.

## Deployment checklist

1. Add `ANTHROPIC_API_KEY=<secret>` and `MOCK_AI=false` to `/srv/gethired/app/server/.env`.
2. Merge the PR into `main`.
3. Confirm the backend workflow applies `prisma migrate deploy` and the `/health` gate passes.
4. Confirm the frontend deployment completes.
5. In production, verify AI Studio lists Claude models and completes one short generation as an admin and as a restricted employee.

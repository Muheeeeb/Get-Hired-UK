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

- Admin Client Detail supports extending a package by 1–24 calendar months and confirms the exact old/new expiry and resulting duration.
- Application totals are split into anniversary-based package months (Month 1, Month 2, Month 3, and beyond).
- Expiry dates are inclusive and calendar month-end clamping is handled without drift (for example, 31 January → 28 February → 31 March).
- Package start, current expiry and total duration are shown alongside the monthly breakdown in client, employee and admin views.
- Separate monthly totals and progress are displayed on the client dashboard, admin client view and assigned employee workspace.
- Employee client-list progress now identifies and counts the current package month.

## 3. Full-screen client workspace

Status: Complete

- The application shell now maintains full viewport width and height.
- The desktop content maximum was widened while retaining responsive margins.
- Horizontal page overflow is contained.
- Workspace tabs scroll within their own row on narrow screens instead of widening/minimising the entire page.

## 4. Claude AI Studio

Status: Complete

- Anthropic Messages API integration is server-side; the key is never returned to the browser.
- Available Claude models are discovered from Anthropic's Models API and cached for five minutes.
- Admins can choose from all models available to the configured key.
- Admin Employee Detail includes an Allowed Claude Model setting.
- Employees receive only their assigned model and server-side authorization rejects attempts to request another model.
- The former OpenAI-compatible integration remains as a backwards-compatible fallback.
- Production is configured with Claude Sonnet 5, and a live generation returned successfully.
- AI Studio conversations are stored per admin/employee in the database and restored after a browser refresh.
- Saved conversations are private to their owner, limited to five tabs, and bounded to prevent unrestrained database/context growth.
- AI Studio reads attached PDF, legacy Word (`.doc`), modern Word (`.docx`), TXT and Markdown documents.
- Stored master documents use the same extraction path, including documents stored in S3.
- The prompt limit is 50,000 characters; recent conversation history is retained within a bounded 240,000-character context budget.
- Claude responses can be downloaded as formatted PDF or Word documents as well as plain text.
- Provider failures return an actionable Claude error instead of an unexplained generic server error.

## 5. Homepage blog and success-story carousels

Status: Complete

- Both live CMS collections use horizontal scroll-snap tracks.
- Touch swipe is supported on mobile.
- Previous/next arrow navigation is provided when overflow exists.
- Controls update correctly at the beginning/end of each collection and remain keyboard-accessible buttons.

## Verification performed

- `npm test` in `server`: 34/34 passing.
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
  - authenticated PDF and DOCX reference uploads;
  - prompts longer than the former 6,000-character ceiling;
  - long-context conversational follow-ups;
  - formatted PDF and DOCX generation, download and read-back.
  - AI conversation creation, reload persistence, follow-up continuation and cross-user isolation;
  - month-end package extension (28 February to 31 March), immediate client-dashboard expiry refresh and separate monthly application totals.
- Temporary database, API and test data were removed after verification.

## Deployment checklist

1. Merge the PR into `main`.
2. Confirm the backend workflow installs the document dependencies and the `/health` gate passes.
3. Confirm the frontend deployment completes.
4. In production, upload one PDF or Word CV, request a follow-up revision, and download both export formats.

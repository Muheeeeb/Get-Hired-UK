# Platform Update — September 2026

Eight requested changes, what was built for each, and how it was verified.

Verification ran against a scratch PostgreSQL database with the full migration chain applied,
the API booted against it, and the UI rendered in headless Chrome. Server suite: **78 tests, 78 passing**.

This branch went through **three rounds** of independent review (requirements conformance, and an
adversarial audit of the verification claims above). Round 1 found a regression and a set of
correctness bugs; round 2 re-checked those fixes and found four defects the fixes themselves had
introduced — including an authorization bypass; round 3 confirmed all of those closed and found one
further consequence of the fix for the largest of them. **§9 lists every finding across all three
rounds and what was done about it.** Everything in §1–8 was re-verified afterwards.

---

## 1. AI Studio output quality — match Claude Pro/Max

**Cause.** Every request carried a hand-written system prompt ("You are an expert UK CV
writer… you are in an ongoing chat…") and the user's text was wrapped in scaffolding
(`Candidate:`, `Career domain:`, `Instructions:\n…`). Claude was being told it was in a
conversation *about* a document, so it narrated, and the labelled instructions came back
inside the generated CV — which is what then landed in the exported PDF.

**Change.** No system prompt is sent unless an admin has saved a master prompt, so Claude
behaves exactly as it does in the Pro/Max apps. The typed text is now the entire user turn.
Attached PDFs are sent as native `document` content blocks (the path claude.ai uses) rather
than being flattened by a text extractor, so layout, columns and tables survive. The default
model is Claude Sonnet, and the model dropdown is unchanged.

**Verified.** `src/lib/aiRequest.test.js` stubs the Anthropic endpoint and asserts the exact
request body: no `system` key on a plain chat, the prompt passed through byte-for-byte, PDFs
as base64 `document` blocks ahead of the text, and no `temperature`.

## 2. Edit the dates of any package month, at any time

**Change.** New `package_months` table: one row per month with its own start and end date.
All of them stay editable — Month 1 can be corrected while the client is on Month 3. Saving
recalculates each month's logged-job count from the new ranges. `client_profiles.package_started_at`
and `expiry_date` are kept mirroring the first and last month, so everything that already read
those two columns (expiry banners, the Daily Pulse, client lists) follows the edited dates with
no further change. Overlaps are rejected; gaps are allowed, for a client who pauses and resumes.
Clients with no rows yet fall back to the previous anniversary derivation and are seeded on first edit.

**Verified.** End-to-end against the running API: a client created on 31 Aug expiring 11 Oct
produced exactly the spec's Month 1 (31 Aug – 30 Sep) and Month 2 (1 – 11 Oct). Moving Month 1's
start from 31 Aug to 10 Sep dropped a 5 Sep application out of its count. Overlapping and
inverted ranges were refused with specific messages.

## 3. Delete an extended month

**Change.** `DELETE /admin/clients/:id/package-months/:month` removes a month, renumbers the
rest and moves the package expiry to the new last month. The final remaining month cannot be
deleted (change its dates instead).

**Verified.** Deleting the extended Month 3 moved expiry from 19 Nov back to 11 Oct; deleting
down to the last month returned a clear error.

## 4. Delete uploaded files

**Change.** `DELETE /clients/:id/master-docs/:docId` and `DELETE /jobs/tailored-docs/:docId`,
both admin + assigned-employee only. The database row goes first, then the stored blob, so a
failed storage delete can never leave a record pointing at nothing. Delete buttons sit next to
every uploaded master document and every tailored file in the job log.

**Verified.** Upload → delete → gone from the listing → second delete returns 404, for both a
master document and a tailored document; the job row itself survives its document's deletion.

## 5. Job log behind a click, plus application charts

**Change.** The application log is now a collapsible card (closed by default) on the client
dashboard, the employee workspace and the admin client page. Above it, an **Application Activity**
card shows applied-today / this package month / next package month as figures, a donut of this
month against target, and a bar chart of applications per package month. Every number is derived
from the stored package months, so editing a month's dates re-shapes the charts.

*Note on the chart:* "today" sits **inside** "this month", so making them slices of one pie would
double-count. Today is shown as a figure; the donut is a genuine part-to-whole (applied vs
remaining to target) and the bar chart carries the month-to-month comparison. Colours were checked
with a contrast/colour-blindness validator — worst pair ΔE 24 normal vision, 19 under CVD, both
above 3:1 on white.

**Verified.** Dashboard payload returned `today=2, current Month 1 = 3, next Month 2 = 2` for a
seeded fixture; rendered in headless Chrome at 1280px and 500px.

## 6. AI Studio simplification + master prompt

**Change.**
- Client and domain selectors removed.
- Three document types collapsed to two: **CV & Cover Letter** and **Freeform**. Legacy `cv` /
  `cover_letter` values on saved rows still load.
- New **Admin → AI Settings** page, visible and writable **only to the Admin Lead** (sub-admins
  get 403 from the API, and never see the nav item). One text box, saved until changed.
- When a chat starts in *CV & Cover Letter*, the saved prompt is sent as the system prompt — once,
  in the background. The user never sees or types it. Subsequent job descriptions in the same chat
  are sent alone. A new chat picks up whatever is saved at that moment.
- The prompt is snapshotted onto the conversation when it opens, so editing the setting never
  rewrites a conversation in flight (and keeps the cached prefix byte-stable).

**Caching.** The master prompt carries `cache_control: {type: "ephemeral", ttl: "1h"}`. The
**1-hour** TTL is deliberate: job descriptions arrive 30 minutes to 2 hours apart, so the default
5-minute cache would expire between them every time. A second breakpoint moves along the
conversation tail so the accumulated history is cached too. Never more than the API's 4 breakpoints.
`usage.cache_read_input_tokens` is returned on every generation, so a silent caching regression is
visible rather than just showing up on the bill.

**Verified.** Sub-admin GET/PUT → 403, lead → 200. Two job descriptions in one chat produced four
turns with the prompt sent once and never echoed into the messages. Cache tests assert the 1h TTL
on the system block, that earlier turns stay byte-identical, and that the breakpoint count stays ≤ 4.

## 7. Text overflowing the margins

**Change.** The reported page (**Domains & Master CV**) is fixed: `min-w-0` and `overflow-hidden`
at each level, filenames set to `break-all`. Because the same cause (one long unbroken token in
free text — a 2,000-character domain name, a filename, a job URL) can hit any page, two global
fixes were added rather than only patching the one screen: `overflow-wrap: break-word` on `body`,
and `min-w-0` on the shared `Card` primitive so a card can shrink below its content inside a grid.

**Verified.** Rendered a 170-character unbroken domain name plus long filenames: text wraps inside
its card at both 1280px and 500px, and `document.documentElement.scrollWidth` equals `clientWidth`
(no page-level horizontal overflow).

## 8. PDFs open in a viewer, not a new tab

**Change.** Attachments now open in an in-app viewer overlay (iframe, with Download, "Open in new
tab" and Esc-to-close) instead of `window.open`. Anything a browser cannot display inline — Word,
ODT — still downloads directly. The signed-url response reports whether a file is viewable.

**Server side:** helmet's `X-Frame-Options: SAMEORIGIN` and `frame-ancestors 'self'` would block
this, because the SPA and the API are different origins. The file-delivery route now sends
`frame-ancestors 'self' <CLIENT_ORIGIN>` and `Cross-Origin-Resource-Policy: cross-origin` — scoped
to the configured portal origins only, never `*`.

**Verified.** A PDF returns `inline: true` with
`Content-Security-Policy: frame-ancestors 'self' http://localhost:5173`, `Content-Type: application/pdf`,
`Content-Disposition: inline` and no `X-Frame-Options`. A `.docx` returns `inline: false`.

---

## 9. Independent review — findings and fixes

Two reviewers went through this branch against the client's written requirements. Their
findings, and what changed:

**Fixed — regressions this branch introduced**

| Finding | Fix |
|---|---|
| Editing **Expiry Date** on Package & Assignment stretched the final month (Month 2 became a 92-day period counted against a one-month target), corrupting every per-month figure. | Moving the end later now appends whole months, exactly as an extension does; moving it earlier drops the months that fall outside and trims the last survivor. `applyPackageBoundaries` in `lib/packageMonths.js`. |
| **Shortening** a package returned `400 Month 6: the end date cannot be before the start date` — an operation that worked before. The rejected request had already seeded month rows and silently dropped any package-type/target change submitted with it. | Same fix. Validation now runs before any write, inside one transaction, so a rejected edit leaves nothing behind. |
| A calendar-invalid date (`2026-02-30`) passed the regex, was rolled forward to 2 March, and produced two **genuinely overlapping months** that double-counted an application. | `isValidIsoDate` round-trips every date; `dateOnly` throws rather than rolling forward. Applied to every date field on every route. |
| `POST /extend` ran **no validation at all** and could write an expiry before the package start, marking a client permanently expired while reporting success. | The extend path validates the resulting set, the legacy derivation can no longer emit an inverted range, and the route now returns the error instead of swallowing it. |
| Concurrent writes (two admins, a double-clicked Save) **500'd and lost updates** — the write is delete-all-then-recreate, so both transactions collided on the unique index. Reproduced 6/6. | Every write takes a transaction-scoped Postgres advisory lock on the client. Re-tested: 12/12 concurrent PUTs return 200, and two concurrent extends correctly produce 4 months rather than 3. |
| A stale tab submitting fewer months than are stored **silently deleted** the rest. | Rejected with an explanatory error; "Delete month" remains the only way to remove one. |

**Fixed — AI Studio**

| Finding | Fix |
|---|---|
| The banner "✓ The master prompt runs automatically" was driven by a global flag, so it claimed the prompt was running on chats that have none — including every chat created before this feature existed. | The banner now reports the chat's own state (`hasMasterPrompt`), and a chat without a snapshot picks the saved prompt up rather than silently running without one. |
| A chat switched from Freeform to CV & Cover Letter never acquired the prompt; one switched the other way kept using it. | The snapshot is bound to the chat's current mode, not the first turn's. |
| A PDF attached on turn 1 was replayed from extracted text on later turns. For a **scanned CV** (no extractable text) the attachment silently disappeared from turn 2 onward. It also broke the conversation-tail cache, because a turn re-rendered in a different shape invalidates the prefix. | Reference files are stored and **re-attached as native `document` blocks** on every later turn, byte-identical to the original upload. Verified: a scanned PDF is still attached, with matching bytes, on turn 2. Files are deleted with the conversation. |
| Switching Claude model mid-chat silently discarded the 1-hour cache (caches are model-scoped) — the exact cost the client asked to avoid. | The model selector locks once a chat has started, with a note explaining why. |
| The unused one-shot cover-letter drafter still used the old `Candidate:/Instructions:` scaffolding and put a cache breakpoint on a prompt too short to cache. | Rewritten as a plain request; the pointless breakpoint removed. |

**Fixed — smaller**

- Deleting the month **currently in progress** moved expiry into the past, marking the client expired and stopping their Daily Pulse, with no warning. The confirmation now says so explicitly.
- Unsaved month edits were discarded without warning when the page refetched. The editor now holds the refetch and offers to reload.
- Two fast clicks on different attachments could show one document under another's name.
- Collapsing the job log unmounted the table, losing its state.
- The "Applied today" tile captioned a server-computed (Europe/London) figure with the browser's clock.
- The donut tooltip called the "Remaining to target" slice "applications".
- The CSP on file responses replaced helmet's `default-src 'none'` instead of adding to it, and did not sanitise `CLIENT_ORIGIN`.
- A mistyped expiry year silently truncated the package to the 240-month cap; now refused with a clear error.
- During a gap between months the tracking exposes `inGap` rather than presenting a future month as if it were running.

### Round 2 — defects introduced by the round 1 fixes

Both reviewers independently found the same blockers. All are fixed and covered by tests.

| Finding | Fix |
|---|---|
| **Authorization bypass (critical).** Storing reference files meant the server read a file by key — and for a new chat that key came from the browser's own `history` payload. An employee who gets 403 from the file routes for a client's master CV could put its key in `history` and have the server read it off disk and hand it to Claude. On S3 there was no confinement at all. | Two independent checks: `refs` are stripped from any browser-supplied history, and `hydrateHistory` opens only keys under `ai-refs/<this user's id>/`. Verified against a foreign master doc, a tailored doc, another user's folder, a traversal attempt and a prefix-confusion attempt — all refused; the user's own file still loads. |
| **One typo wrote 95,681 month rows.** `exceedsMonthLimit` guarded client creation but not the route the admin UI actually uses, and the append loop had no ceiling. A mistyped expiry year made the *client's own dashboard* a 15 MB unrenderable payload, unrepairable from the editor. | The 240-month ceiling is enforced inside `applyPackageBoundaries` and on extend. Verified: 2200-01-01, 9999-12-31 and 2126-01-01 all return 400 with the row count unchanged, and repeated extends stop at the cap. |
| **The wrong file was stored under a PDF's name.** `storedRefs` indexed back into the upload array, but extraction skips a non-PDF once the character budget is spent, so the arrays diverged. A `document` block declared `application/pdf` then carried plain text — which the API rejects, permanently breaking that chat. | The buffer is taken from the attachment itself; there is no index lookup. Verified with a 190k-character text file ahead of a PDF: the stored bytes match their own filename. |
| **A chat could grow past the 32 MB request limit and die forever.** Re-attached history PDFs were budgeted by nothing, and the character budget counts `ref.text`, which is 0 for exactly the scanned PDFs the feature exists for. | One 18 MB raw ceiling for the whole request: the new turn's attachments have first claim, history gets the remainder, and the oldest degrade back to extracted text. Verified at 20 MB for six 5 MB history PDFs plus a fresh 5 MB upload. |
| A **rejected** package edit still committed the months it had just seeded. | The transaction throws rather than returning, so a rejection rolls back. Verified: 0 rows before, 0 after. |
| The banner lied in the **opposite** direction after the round 1 fix: a restored legacy chat was told "not running a master prompt" while the server applied one on its very next turn. | The listing now reports what the next turn will actually do, not merely what was snapshotted. Verified both directions. |
| `default-src 'none'` added to PDF responses is historically what blocks Chrome's built-in PDF viewer, and neither reviewer could verify it either way in headless Chrome. | Reverted to `frame-ancestors` only — the form already verified working. The concern it was meant to address is handled structurally instead: `INLINE_TYPES` carries no active content type, now asserted by a test. |
| `inGap` was added and **wired to nothing** — an employee logging 40 applications during a gap still saw "0 / 300" against a month that had not started. | Surfaced on the employee list and the dashboard stats; the client list now reads "Between package months" instead of a misleading zero. |
| Changing the expiry re-cut every month boundary onto a new phase, silently re-bucketing logged applications, and a round-trip did not restore the original months. | The expiry field on Package & Assignment is now **read-only** — it is the last month's end date, and Package Months owns it. This matches the spec ("the Expiry Date should equal the end date of the last month and update automatically"). |
| A replayed text-only turn was sent as a bare string where the original was a content block, which may cost the cache hit. | Every replayed turn uses block form, so the prefix is byte-identical either way. |
| Uploaded CVs were persisted with no cleanup when a conversation was trimmed, or when a user was hard-deleted. | Both paths now reclaim the files. |

### Round 3 — confirmed closed, plus three residuals now fixed

Round 3 could not get past any of the round 2 fixes: five separate bypass attempts against the file
read were all refused, six different growth paths against the month cap were all capped, and the
32 MB limit could not be exceeded. Three residuals it raised have been fixed:

| Finding | Fix |
|---|---|
| The `ai-refs/<user>/` prefix test was described as one of two independent checks, but it is **not a containment boundary**: `ai-refs/<me>/../../masters/<other>/cv.pdf` starts with the right prefix, and the local driver normalises `..` before its own check. Nothing could reach it today (references from the browser are discarded outright), but it would silently reopen the original hole the moment any future feature accepted a reference from elsewhere. | The key is normalised before the prefix test, and anything resolving outside the folder is refused. Verified against five traversal shapes including `./`, a leading `/` and a doubled slash. |
| **The budget re-broke the cache it was meant to protect.** Because the history allowance depended on the size of the *current* upload, an older message changed shape from one request to the next — and prompt caching is a prefix match, so the cache went cold from the first changed message. Worse, when a scanned PDF lost its budget the fallback was its extracted text, which is empty, so the document vanished with no note: exactly the failure re-attachment exists to prevent, reintroduced by volume. | The history budget is now **fixed** (not derived from the current turn) and spent **oldest-first** — which also matches how these chats are actually used, one CV attached at the start followed by many job descriptions. Verified across five turns: earlier messages are byte-identical every time, and the first CV stays attached. An attachment that does drop out now says so in the conversation and in the reply's note. |
| `inGap` reached the dashboard payload but `ApplicationCharts` never read it, so a client sitting in a deliberate gap still saw "0 / 40" and a 0% donut against a month that had not started. | The tile and donut now read "Between package months" and name when the next month starts. |

Two smaller ones: a save that changes only the monthly target no longer deletes and recreates every
month row, and orphaned reference files are reclaimed *after* the record that replaced them is
written rather than before.

On the CSP revert, the two reviewers disagreed about the mechanism — one held that `default-src
'none'` would block Chrome's PDF viewer, the other that it would not — but neither could verify it
in a headless browser, and both agreed the revert is the right call: the downside of being wrong is
the headline feature silently broken in production, against no real gain on content that is
provably inert. The test asserting `INLINE_TYPES` can never serve `html`, `svg`, `js`, `css` or
`xml` is what actually holds that line, and should not be removed.

### Round 3, second reviewer — three more residuals

The second reviewer's final pass reached the same verdict on the round 2 fixes (N1–N5 closed, the
95,681-row case gone, all six file-read payloads blocked) and raised three residuals, now fixed:

| Finding | Fix |
|---|---|
| **The server still accepted `expiryDate`** on `PUT /clients/:id/package`. Making the field read-only moved the problem out of the UI but left it reachable by anyone calling the endpoint — including a stale browser tab running the previous build during the deploy window, which still types into the field and sends it on every save. | The endpoint now **accepts and ignores** `expiryDate` (logging that it did), rather than honouring it. Rejecting it was the first attempt, but the currently-deployed frontend sends that field on *every* save of that form — including a save that only changes the monthly target — so a hard rejection would have broken the form in production for as long as an older client was live. Ignoring it keeps both frontend generations working while the re-phasing bug stays fixed. Verified live against both payload shapes. |
| **Orphan cleanup could delete a file a live message still referenced** — reproduced in 3 of 4 long-chat runs against the previous commit, which re-opened the "scanned CV silently vanishes" complaint by a different route. | I could not reproduce it on the current commit across 40 turns or under concurrent turns on one chat — moving the delete to *after* the write (done in the previous commit for a different reason) appears to have been the cause. Rather than rely on that, deletion is now derived from the record that was actually persisted, so a lost update or a retry cannot strip a referenced file. |
| A reference whose stored file has gone produced **no block at all** — the attachment disappeared from the conversation with no note. | A missing file is now announced in the conversation and in the reply's note, and logged server-side. |

Also added: a warning line when the legacy clamp rewrites a stored expiry date, so an un-expired
client can be explained from the log rather than being inexplicable.

**One honest limitation to carry forward.** Once a chat accumulates more attached PDFs than the
replay budget holds, the oldest are replayed as extracted text instead of the document. That
degradation is bounded and announced, but it does change those turns' bytes — so on a very long,
attachment-heavy chat the 1-hour cache will stop hitting from that point. Bounded-and-visible beats
unbounded-and-broken, but the caching promise should not be stated without that caveat.

**Open — needs a decision from the client, not a code change**

- **The pie chart (item 5).** The client asked for a pie of *today / this month / next month*. Today sits **inside** this month, so as pie slices they double-count. What shipped is three figures plus a donut (this month vs target) and a bar chart (per package month). Both reviewers agreed the reasoning is sound but that the substitution should be signed off rather than assumed.
- **"Save as master" was removed** from AI Studio as collateral of removing the client/domain selectors. Restoring it needs some way to pick a client, which is what the client asked to remove. Confirm whether it is wanted.
- **The production Claude API key** has not been rotated — the client said they would supply it.
- **Item 8 on S3.** The `frame-ancestors` header was verified on the local storage driver. Production uses S3, where the presigned URL is served by S3 and our header code never runs; S3 sends neither `X-Frame-Options` nor `frame-ancestors`, and the presigned URL already carries `Content-Disposition: inline` + the right content type, so the viewer should work. A reviewer added two cases that reasoning does not cover: a CloudFront response-headers policy injecting `X-Frame-Options` (a common hardening default), and Cloudflare R2 via `S3_ENDPOINT` handling `response-content-disposition` differently. Both collapse to one check — open a single PDF attachment through the viewer against the real bucket before calling item 8 done.

- **Retention of AI Studio uploads.** Reference CVs are now stored (they have to be, or a scanned PDF is lost after the first turn). They are deleted when the conversation is closed, when a turn is trimmed out of the saved window, and when the user is hard-deleted — but there is no time-based retention policy. For a UK jobs platform holding candidate CVs that is worth an explicit decision.

## Rollout compatibility

The backend deploys from `main` via GitHub Actions; the frontend deploys separately via Vercel, so
the two are briefly — or, if a Vercel deploy is blocked, indefinitely — out of step. Both
combinations were exercised against this build:

| Old frontend call | Result against this backend |
|---|---|
| `PUT /admin/clients/:id/package` **with** `expiryDate` | 200 — the field is ignored and logged; the monthly target and package type still save, and the stored months are untouched |
| `POST /ai/generate` with `clientId` / `domainId` / `kind=cv` | 200 — the removed fields are ignored and the legacy `kind` maps to `cv_cover_letter` |
| `GET /ai/conversations` | 200 — the dropped `clientId`/`domainId` read as `undefined` in the old UI without erroring |
| Dashboard, jobs, employees, package-choices | 200 |

So an old frontend against this backend degrades gracefully rather than failing. A new frontend
requires this backend, which is the correct ordering since the backend deploys first.

## Deploying

```bash
npx prisma migrate deploy   # adds package_months, app_settings, ai_studio_conversations.system_prompt
```

The migration is additive — no existing column or row is altered. Clients with no `package_months`
rows keep tracking exactly as before until someone edits or extends their package, at which point
their current months are materialised from their existing start/expiry dates.

After deploying, set the master prompt once under **Admin → AI Settings**.

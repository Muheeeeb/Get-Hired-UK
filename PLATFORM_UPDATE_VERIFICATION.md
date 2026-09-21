# Platform Update — September 2026

Eight requested changes, what was built for each, and how it was verified.

Verification ran against a scratch PostgreSQL database with the full migration chain applied,
the API booted against it, and the UI rendered in headless Chrome. Server suite: **71 tests,
71 passing**.

This branch was then put through two independent reviews (requirements conformance, and an
adversarial audit of the verification claims above). They found one regression and a set of
correctness bugs; **§9 below lists every finding and what was done about it**. Everything in
§1–8 was re-verified after those fixes.

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

**Open — needs a decision from the client, not a code change**

- **The pie chart (item 5).** The client asked for a pie of *today / this month / next month*. Today sits **inside** this month, so as pie slices they double-count. What shipped is three figures plus a donut (this month vs target) and a bar chart (per package month). Both reviewers agreed the reasoning is sound but that the substitution should be signed off rather than assumed.
- **"Save as master" was removed** from AI Studio as collateral of removing the client/domain selectors. Restoring it needs some way to pick a client, which is what the client asked to remove. Confirm whether it is wanted.
- **The production Claude API key** has not been rotated — the client said they would supply it.
- **Item 8 on S3.** The `frame-ancestors` header was verified on the local storage driver. Production uses S3, where the presigned URL is served by S3 and our header code never runs; S3 sends neither `X-Frame-Options` nor `frame-ancestors`, and the presigned URL already carries `Content-Disposition: inline` + the right content type, so the viewer should work — but this has not been exercised against a real bucket.

## Deploying

```bash
npx prisma migrate deploy   # adds package_months, app_settings, ai_studio_conversations.system_prompt
```

The migration is additive — no existing column or row is altered. Clients with no `package_months`
rows keep tracking exactly as before until someone edits or extends their package, at which point
their current months are materialised from their existing start/expiry dates.

After deploying, set the master prompt once under **Admin → AI Settings**.

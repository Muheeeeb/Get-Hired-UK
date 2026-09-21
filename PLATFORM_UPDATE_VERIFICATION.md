# Platform Update — September 2026

Eight requested changes, what was built for each, and how it was verified.

Verification ran against a scratch PostgreSQL database (`gethired_verify`) with the full
migration chain applied, the API booted against it, and the UI rendered in headless Chrome
at 1280px and 500px. Server suite: **55 tests, 55 passing**.

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

## Deploying

```bash
npx prisma migrate deploy   # adds package_months, app_settings, ai_studio_conversations.system_prompt
```

The migration is additive — no existing column or row is altered. Clients with no `package_months`
rows keep tracking exactly as before until someone edits or extends their package, at which point
their current months are materialised from their existing start/expiry dates.

After deploying, set the master prompt once under **Admin → AI Settings**.

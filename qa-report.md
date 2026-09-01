# QA Report — Kigali Keys

**Date:** 2026-08-30, re-verified 2026-08-30 (settings blocker) and 2026-09-01
(calendar fix + Sent log feature) — see "Re-verification" notes at end.
**Commit:** through `7581afb` + the working-tree Sent-log feature
(sent_emails.clj + migration, email.clj, emails.js, api.js, fixtures, eslint).
**Verdict:** **PASS — ready for production promotion.** The settings blocker is
fixed and re-verified; Finding 2 (banned placeholder strings) resolved; the
calendar month-anchor bug and the missing email-outbox viewer are both fixed and
verified. No open issues.

**Method:** `src/frontend/public/` served by a static file server with `/api`
proxied to the **real Clojure backend** run from this repo (`clojure -M:run`,
SQLite + migratus migrations + seed, owner seeded from `ADMIN_INITIAL_PASSWORD`).
`dev-server.mjs` mock **not** used. Every endpoint hit live with curl; pages
driven with Playwright/Chromium (already a devDependency; browser already
installed).

---

## 1. Contract — every endpoint in api-contract.md, live-tested

| Endpoint | Result |
|---|---|
| §1 GET /property | PASS — `contact{hostName:"Peter",email:"info@kigalikeys.rw",phone:null,responseTimeText}`; pricing 70/30/3; neighbourhood "Gacuriro / Kagugu, Kigali". Re-verified: `contact.phone` reflects the admin Settings value live (null when cleared, string when set). |
| §2 GET /gallery | PASS — 25 images, positions sorted, 7 categories, lead id set |
| §3 GET /availability | PASS — shape correct; bad/oversized range → 422 validationError |
| §4 POST /quote | PASS — 7-night no-car total **520**; with car adds `carRental`; line-item breakdown with real total |
| §5 GET /vehicle | PASS — includes `minDriverAge:23`, `minLicenceYears:2`, `agreement` v4 + bodyHash |
| §6 POST /bookings | PASS — missing key→400; create→201 w/ acceptancesRecorded; replay→same body + `Idempotency-Replayed:true`; same key/diff body→409; stale version→409 agreementVersionStale; missing acceptance→422 agreementRequired; 3 acceptance rows persisted (name/email/version/hash/IP/UA/snapshot). Re-verified: a fresh car booking still persists exactly 3 acceptance rows (stayTerms v3, houseRules v3, vehicleRentalAgreement v4). |
| §7 GET /bookings/:reference | PASS — email gate + token gate; wrong/missing→404; approved adds `approvalDetails`; no driver PII in guest view |
| §8 POST /contact | PASS — 202; bad input→422; >10/60s/IP→429 rateLimited |
| §9 GET /documents/:type/:version | PASS — all 6 types resolve; privacy v3 & websiteTerms v2 contact email = info@kigalikeys.rw |
| §10 GET /media/... | PASS — gallery jpg + `/media/map/approx.png` serve; `exact-location.png`→404 on every path |
| §11 POST /admin/auth/login | PASS — 200 + HttpOnly SameSite=Lax cookie; bad creds→401 |
| §12 POST /admin/auth/logout | PASS — 204, cookie cleared |
| §13 GET /admin/auth/session | PASS — 200 / 401 |
| §13b POST /admin/auth/accept-invite | PASS — valid token→200 + session; used/invalid token→**410 conflict**; weak password→422. Re-verified live: bad token → 410 `conflict`; real token → 200. |
| §14 GET /admin/bookings | PASS — status/q/car filters, `{page,pageSize,total}` |
| §15 GET /admin/bookings/:id | PASS — full PII, driver DOB/licence, acceptances w/ documentUrl, availabilityConflicts |
| §16 POST /admin/bookings/:id/approve | PASS — total≠sum→422; missing carCollection→422; overlap another approved booking→409 dateConflict; blockDates:false approves anyway; already-decided→409; key replay→stored 200 |
| §17 POST /admin/bookings/:id/reject | PASS — explanation<20→422; transitions pending→rejected; no dates blocked; already-decided→409; replay |
| §18 availability blocks | PASS — GET (range required), POST→201, DELETE manual→204, DELETE booking-source→403 |
| §19 GET/PUT /admin/pricing | PASS — validation (rate>0 etc.)→422; takes effect on next quote/availability |
| §20 GET/PUT /admin/property | PASS — GET admin shape; PUT full-replace returns new updatedAt |
| §21 gallery management | PASS — PATCH caption, POST lead, PUT order all mutate live data |
| §22 GET/PUT /admin/vehicle | PASS |
| §23 vehicle agreement versions | PASS — publish → v5 current, prior versions/acceptances intact |
| §24 legal document versions | PASS — publish houseRules → v4, `termsVersions` in GET /property bumped |
| §25 GET /admin/agreement-acceptances (+ :id) | PASS — read-only list + filters; `:id` returns immutable `documentSnapshot`; no write endpoint |
| §26 email templates | PASS — GET/GET:key/PUT/preview/test; PUT with unknown `{{token}}`→422; test→202 |
| §26b sent-email log (outbox) | PASS (added 2026-09-01) — GET /admin/sent-emails [owner+admin]: unauth→401, real non-owner admin→200, owner→200; newest-first; item shape exact {id,toAddress,templateKey,subject,bookingReference,status,createdAt}; status=="stored" every row; templateKey / q (subject+ref+to) / templateKey=none / from / to (bare-date = end-of-day) / page+pageSize all filter correctly and non-overlapping. GET /admin/sent-emails/:id → brand-wrapped html for templated rows, raw stored body for the untemplated direct notice; unknown id→404 notFound; unauth→401. bookingApproved row carries bookingReference; contactAck + direct notice null. Migration 20260901000001 adds status + booking_reference cleanly on a fresh DB. |
| §27 admin users [owner] | PASS — create→invited + adminInvite email row; demote/delete last owner→409; delete self→409 |
| §28 GET/PUT /admin/settings [owner] | **PASS (was PUT FAIL).** GET owner-only (401 unauth / 403 non-owner). PUT full matrix re-verified live: `publicPhone` omitted / `null` / `""` → 200 stored `null` (GET /admin/settings **and** GET /property `contact.phone` both return JSON `null`); real value stored trimmed and reflected in GET /property; 41-char → 422, 40-char → 200. Same matrix for `guestResponseTimeText` (omit/null/"" → 200 null; real text → 200; 201-char → 422, 200-char → 200). Normal save changing only `hostDisplayName` with no phone set → 200, not 422. |

Owner-only authorization re-verified with a real non-owner (`admin`, invited +
accept-invite) session: `/admin/settings` (GET **and** PUT) → 403;
`/admin/bookings` → 200. No session → 401. Enforced server-side.

---

## 2. Scope checklist — every "applies" category, end to end

| Category | Result |
|---|---|
| Catalog / inventory (small) | PASS — date + car calendars are live; admin blocks & pricing mutate real data reflected in `/availability` and `/quote` |
| Accounts / auth (admin only) | PASS — owner vs admin enforced server-side; invite → accept-invite → session works; no guest accounts |
| Admin / back-office | **PASS (was FAIL).** Booking queue, property text, gallery, availability, pricing, vehicle, agreement versioning, acceptance log, users, email templates all work end to end; **the owner Settings screen now saves** — cleared and re-set the public phone through the rendered UI, Save succeeded each time (no 422), reload persisted, and the public /contact page + footer tracked the change. |
| Notifications (email) | PASS — `sent_emails` rows written for bookingReceived/adminNewBooking/bookingApproved/bookingRejected/contactAck/adminInvite + the untemplated direct host notice; approve & reject show the rendered email in a confirm modal before sending. The A9 "Sent log" outbox viewer now exists (GET /admin/sent-emails + /:id): filterable table, "Stored" badge, row opens the stored html in a sandboxed iframe modal, null templateKey → "Direct message". Scope's "applies only when that view exists" condition is now met. |
| Legal / compliance | PASS — stayTerms v3, houseRules v3, websiteTerms v2, privacy v3, cancellationPolicy v3 served publicly and versioned via admin |
| Customer agreement (Kia Sorento) | PASS — full agreement text shown at Step 4 **only when the car is added**; submit writes a `vehicleRentalAgreement` acceptance row with version + bodyHash + snapshot pointer, visible in §15 and §25; the two secondary agreements (stay terms, house rules) are recorded the same way |

---

## 3. Click testing (Playwright / Chromium)

| Page | Result |
|---|---|
| P1 home | PASS — header `position:fixed`; over-hero transparent (logo currentColor `rgb(255,255,255)`) → scrolled solid Bone (logo `rgb(31,91,78)`); nav links + "Check dates" CTA land correct; FAQ accordions, "Show all amenities", photo-strip buttons all fire their own action. Re-verified: `.site-header` + `.wordmark` (inline SVG logo mark) render; CTA `href="/book"`. |
| P1 home @360px | PASS — no horizontal overflow (scrollWidth 360 = clientWidth); hero title clears the fixed header (top 96 > header bottom 65), no wordmark overlap |
| P2 gallery | PASS — 25 thumbnail buttons; clicking one opens the Lightbox; Esc closes it; **zero whole-card overlay links** — `.card__overlay-link` is defined in CSS but used by no page, cards use nested `<button>`/`<a>` |
| P3 the-car | PASS — "Add the car to your stay" → `/book?car=1`; "Read the full agreement" → `/vehicle-rental-agreement` |
| P4 location | PASS — loads, static approx map only |
| P5 /book | PASS — grid DateRangePicker day buttons select range; stepper advances; Step 4 submit stays disabled until all 3 acceptance checkboxes ticked |
| P6 /booking | PASS — reference + email lookup form present |
| P7 contact | PASS — form submits `POST /api/contact` (202); contact block renders email-only ("Write to Peter, the host: info@kigalikeys.rw") when `phone:null`, no stray "Phone:" label, no hardcoded fallback; renders the phone line when a number is set. Both states re-verified live via the rendered page + footer. |
| P8–P12 legal | PASS — all five render from `GET /documents` |
| Booking widget | PASS — Check-in / Check-out `input[type=date]` equal height (53px = 53px) and bottom-aligned (fix in `components.css` `.field-grid > .field { margin-bottom:0 }` is in place) |
| A0 admin login | PASS — login → `/admin`; sidebar renders logo mark (currentColor) |
| A1→A3 | PASS — dashboard/list row is keyboard- and click-navigable to the detail page |
| A3 approve | PASS — "Approve & send email" opens a ConfirmModal rendering the actual `bookingApproved` email; "Confirm & send" → `POST /approve` 200 → Approved badge |
| A3 reject | PASS — ConfirmModal renders `bookingRejected` with the explanation verbatim → `POST /reject` 200 → Rejected badge |
| A11 settings (re-verified) | PASS — owner login → `/admin/settings` → clear phone → Save → "Settings saved" (no 422) → reload, still empty → set "+250 788 123 456" → Save → success → public `/contact` shows the phone line → back to settings → clear → Save → `/contact` email-only again. |

No `.woff2` 404s on any page (`fraunces-latin.woff2` + `inter-latin.woff2` present, `fonts.css` references exactly those two, loaded by every page). No other 4xx, no page errors, no banned strings in any rendered page body.

---

## 4. Journey continuity (user-journeys.md)

| Journey | Result |
|---|---|
| 1 — Guest books stay + car | PASS — P1 → P3 → `/book?car=1` → dates (Continue enables) → car toggle pre-on + driver fields → details → review (3 checkboxes, submit gated) → `POST /bookings` 201 → redirect `/booking/KK-…` showing **Pending** + accepted-documents list. Stale-version and date-conflict recovery branches present in `book.js` and matched by backend error codes. |
| 2 — Manager approves | PASS — login → dashboard → list row → A3 detail (conflicts + accepted docs shown) → approve panel → ConfirmModal renders the email → send → Approved; availability updates. |
| 3 — Manager rejects | PASS — list → A3 → reject (explanation ≥ 20) → ConfirmModal shows text verbatim → send → Rejected; no dates blocked. |
| 4 — Admin updates storefront + agreement | PASS — raise nightly rate via A4 pricing panel (`PUT /admin/pricing` 200, reflected in `/quote` + `/availability`); block dates drop from `/availability`; draft + publish new car agreement → v5 current, prior v4 + its acceptances intact; Aline (`admin`) opening `/admin/users` → 403 (server-enforced). Owner editing A11 Settings (host contact, phone, response-time text) → `PUT /admin/settings` 200 and reflected in `/property`. |

Every step is reachable from the one before it. No broken link in any journey.

---

## 5. Engineering-standards non-negotiables (checked against the code)

| Rule | Result |
|---|---|
| Server-side validation at the API boundary | PASS — `mw/validate!` (malli) runs before business logic on every route; live 422s for bad email/enum/past check-in/oversized range confirm it. The §28 `publicPhone` / `guestResponseTimeText` schemas are now `{:optional true} [:maybe [:string {:max N}]]` with blank→nil normalisation in a pure `normalize` fn — validation still enforced (over-length → 422), just no longer over-strict. |
| Server-side authorization on every protected endpoint | PASS — `wrap-admin` / owner flag; 401 (no session) and 403 (real non-owner on owner-only, GET + PUT) verified live, not UI-only |
| No hardcoded secrets (incl. seed) | PASS — all config via aero/env (`resources/config.edn`); `ADMIN_INITIAL_PASSWORD` has no default (seed skipped without it); passwords buddy-hashed; `TOKEN_SECRET` fallback is a clearly-labelled dev placeholder; grep of `seed.clj` + features finds no literal secret/key |
| Versioned migrations | PASS — migratus `resources/migrations/20260829000001-init.{up,down}.sql`, run on startup; no ad-hoc DDL |
| Idempotent mutations | PASS — `wrap-idempotency` (DB-backed `idempotency_keys`) on `POST /bookings`, `/approve`, `/reject`; replay returns stored response with no repeated side effect; different body → 409; verified live |
| No micro-frontends | PASS — one static `public/` + one admin SPA shell, single deployable; `netlify.toml` / `_redirects` one build |

Supporting guidelines also honoured: single error shape `{error:{code,message}}` everywhere, camelCase + ISO 8601 throughout, vertical feature slices under `kigali/features/`, thin handlers over testable logic fns, structured logging (`clojure.tools.logging`, no stray prints). In-memory per-IP rate-limit bucket is process-local but statelessness is not a listed non-negotiable and this is a single service — acceptable.

---

## Blockers / findings

### Blocker 1 — RESOLVED (re-verified 2026-08-30)
Was: `PUT /admin/settings` required a non-empty `publicPhone`, so the owner could
not save the Settings screen in the shipped (no-phone) state, and a phone once set
could never be cleared.

Fix in place and verified live:
- **`src/backend/kigali/features/settings.clj`** — `publicPhone` and
  `guestResponseTimeText` are now `{:optional true} [:maybe [:string {:max N}]]`;
  a pure `normalize` / `blank->nil` collapses omitted / null / "" / whitespace to
  `nil` before the store, and stores other values trimmed.
- **`src/frontend/public/assets/js/admin/settings.js`** — sends `null` (via an
  `optional()` helper) instead of `""` for both free-text fields.
- **`src/backend/kigali/features/content.clj`** — GET /property `responseTimeText`
  projection also guards blank → nil.
Live matrix (curl + browser): all omit/null/""/valid/over-length cases behave
exactly as specified; GET /admin/settings and GET /property `contact.phone` both
return JSON `null` (not `""`) when cleared; browser round-trip (clear → save →
reload → set → save → public /contact → clear → save) all green.

### Finding 2 — RESOLVED
Banned placeholder strings removed from the served admin JS:
- `admin/bookings.js` — address / host-contact placeholders now
  `"House 00, KG 9 Ave, Gacuriro, Kigali"` and
  `"Peter — +250 788 000 000 / info@kigalikeys.rw"`.
- `admin/emails.js` — preview sample now `addressLine:"House 00, Gacuriro, Kigali"`,
  `hostContact:"Peter — …"`, `priceBreakdown:"Accommodation 490 + Cleaning 30 = USD 520"`.
Grep of `src/frontend/public/` for `Rebero` / `Jean` / `host@kigalikeys` /
`Cleaning 35` / `USD 1015` / `$35` / `140` → no matches.

### Note (not a defect)
`GET /admin/email-templates` returns `{templates:[…]}` (contract doesn't pin the
wrapper key; the admin UI consumes it correctly).

---

## Re-check of the "what changed" list

- Public `contact` block + `phone:null` email-only rendering (footer + contact page, no hardcoded fallback) **and the write path**: **PASS**
- `minDriverAge` / `minLicenceYears` on `GET /vehicle`: **PASS**
- §13b returns 410 `conflict` for bad/used token: **PASS**
- Location "Gacuriro / Kagugu" everywhere, no "Rebero" in served/rendered content: **PASS** (admin JS placeholders now fixed — Finding 2 resolved)
- Nightly 70 / cleaning 30 / min 3 / 7-night no-car total 520: **PASS**
- "Peter, the host" / info@kigalikeys.rw guest-facing; "Grace" not public: **PASS** (Grace appears only in a `seed.clj` code comment)
- Climate "AC in living room, standing fans in bedrooms", no ceiling fans; oven+hob, no dishwasher; washing machine present: **PASS**
- Tagline "Keys to a furnished home in Kigali — and to the car outside.": **PASS**
- houseRules v3 / privacy v3 / websiteTerms v2, contact email info@kigalikeys.rw: **PASS**
- Self-hosted Fraunces + Inter woff2, zero `.woff2` 404s: **PASS**
- Logo mark inline in header `.wordmark` + admin sidebar, `currentColor`, favicon redrawn: **PASS**
- Header `position:fixed`, transparent→solid on scroll: **PASS**
- Home hero clears header at 360px, no overlap: **PASS**
- Booking-widget Check-in/Check-out equal height + bottom-aligned: **PASS**
- No horizontal overflow at 360px (home, the-car, gallery, book, contact): **PASS**
- No "$35" / "140" in served content: **PASS** (stale `emails.js` sample now current — Finding 2 resolved)

---

## Re-verification — 2026-08-30

Focused re-verification of the Blocker 1 fix plus a light regression sweep (not a
full re-run of all 5 checks — that was done in the pass above). Real Clojure
backend from this repo (`clojure -M:run`, fresh SQLite db, owner seeded from
`ADMIN_INITIAL_PASSWORD`), `src/frontend/public/` served by a static server with
`/api` proxied to it, browser steps via Playwright/Chromium.

**Blocker 1 fix — PASS.** `PUT /admin/settings` as the owner:
- `publicPhone` omitted / `null` / `""` → **200**, stored `null`; GET /admin/settings
  and GET /property `contact.phone` both return JSON `null`.
- `publicPhone:"  +250 788 123 456  "` → **200**, stored trimmed `"+250 788 123 456"`;
  GET /property `contact.phone` reflects it.
- `publicPhone` 41 chars → **422**; 40 chars → **200**.
- `guestResponseTimeText` omit / `null` / `""` → **200** stored `null`; real text →
  **200**; 201 chars → **422**; 200 chars → **200**.
- Save changing only `hostDisplayName` with no phone set → **200** (not 422).

**Browser (Playwright) — PASS.** Owner login → `/admin/settings`: clear phone →
Save → "Settings saved", no 422 → reload, field still empty → set
"+250 788 123 456" → Save → success → public `/contact` shows the phone line and
footer → back to settings → clear → Save → `/contact` back to email-only, no stray
"Phone:" label, host email still shown.

**Light regression — PASS.**
- §1 GET /property `contact` block shape unchanged (`hostName/email/phone/responseTimeText`).
- §4 POST /quote 7-night no-car total = **520**.
- §6 POST /bookings still records exactly **3** agreement acceptance rows (stayTerms v3, houseRules v3, vehicleRentalAgreement v4).
- §28 GET/PUT /admin/settings owner-only: no session → **401**; real non-owner (`admin`) session → **403**; non-owner GET /admin/bookings → **200**.
- §13b accept-invite bad token → **410** `conflict`; real token → **200**.
- No `.woff2` / `.css` / `.js` 404s on home + contact; `.site-header` + inline-SVG `.wordmark` logo render.

**Likely-owner of the changes:** backend engineer (`settings.clj`, `content.clj`)
and frontend engineer (`settings.js`, `bookings.js`, `emails.js`). All verified
good — no further action needed. Cleared for production.

## Re-verification — 2026-09-01 · Sent log (§26b / A9)

Focused end-to-end verification of the new admin "Sent log" (email outbox viewer)
plus a light regression sweep. Real Clojure backend from this repo, fresh SQLite,
owner seeded from ADMIN_INITIAL_PASSWORD; public/ served with /api proxied;
Playwright/Chromium for browser steps. Backend unit suite: 45 tests / 268
assertions / 0 failures.

Sent log — PASS. Migration 20260901000001 clean; sent_emails.status +
booking_reference present. 8 realistic outbox rows generated (booking submit +
approve, second booking submit + reject, contact form). GET /admin/sent-emails:
401 unauth / 200 non-owner admin / 200 owner; newest-first; exact item shape;
status "stored" on every row; bookingApproved row has bookingReference, contactAck
+ direct notice null; templateKey / q (subject, reference, to-address) /
templateKey=none / from / to (bare date = end of day) / pagination all correct and
non-overlapping. GET /admin/sent-emails/:id: brand-wrapped html for templated
rows, raw stored body for the direct notice, 404 notFound for unknown id, 401
unauth. Browser: owner -> /admin/emails -> two tabs; Sent log columns
sent-at/to/template/subject/booking-ref/status; template + "Direct message"
filters narrow the table; row opens a modal with a sandboxed iframe rendering the
stored html; "Stored" badge in table and modal; Templates tab preview + Save +
Send-test (202) still work.

Light regression — PASS. §1 contact block shape unchanged (phone null); §4
7-night no-car quote = 520; §6 booking still records exactly 3 acceptance rows;
§28 settings saves with publicPhone null; /book calendar opens on the
pre-selected current month; no .woff2 404s; header + logo render; no page errors.

Verdict: PASS — the Sent log feature ships correctly, no regressions. Cleared.

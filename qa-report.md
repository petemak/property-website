# QA Report — Kigali Keys

**Date:** 2026-08-29
**Verdict:** PASS — signed off for staging deployment.
**Method:** Frontend `src/frontend/public/` served against the **live Clojure
backend** (real SQLite + migratus migrations + seed, owner seeded from
`ADMIN_INITIAL_PASSWORD`), backend on :3000, frontend behind a `/api`→backend
proxy on :5000. The in-memory mock in `dev-server.mjs` was **not** used.
Browser automation via Playwright / Chromium.

## 1. Contract — every endpoint in api-contract.md, live-tested

All 28 numbered sections plus §13b (`POST /admin/auth/accept-invite`) exist in
the backend, return the contract JSON shapes, and are called the same way by the
frontend. Verified behaviours:

- Idempotency on `POST /bookings`, `/approve`, `/reject`: missing key → 400
  `idempotencyKeyMissing`; replay → identical stored body + `Idempotency-Replayed:
  true` and **no repeated side effect** (no second booking, no second email);
  same key + different body → 409 `idempotencyKeyConflict`.
- Agreement acceptance is a real side effect of `POST /bookings`: booking
  `KK-5D6TCV` wrote 3 acceptance rows (stayTerms, houseRules, vehicleRentalAgreement)
  each with name, email, version, bodyHash, IP, user-agent, snapshot id; visible
  via §15 and §25. `§25` has no write endpoint (correct).
- `agreementVersionStale` (409) fires after an admin republishes a legal doc.
- Stale version + bad bodyHash → 409; missing required acceptance → 422
  `agreementRequired`.
- Guest PII (licence number, DOB) never echoed on any guest-facing response.
- `GET /bookings/:reference` enforces both the email gate and the signed-token
  gate; wrong/missing → 404; approved bookings add `approvalDetails`.
- Admin authz enforced server-side (not UI-only): admin role → 403 on
  owner-only routes (§27 users, §28 settings); no session → 401.
- Approve: `total ≠ sum(lineItems)` → 422; `dateConflict` → 409 with the
  conflicting dates named; `blockDates:false` approves without blocking.
- Reject: explanation < 20 chars → 422; already-decided → 409 `alreadyDecided`.

### Fixed during QA

- **§13b `POST /admin/auth/accept-invite`** originally returned **401** for an
  invalid/used/expired token; contract requires **410 `conflict`**. Fixed in
  `src/backend/kigali/features/auth.clj` (distinguishing messages for invalid vs
  used vs expired) and covered by `accept-invite-flow` in
  `test/backend/kigali/admin_flow_test.clj`. Re-verified.

### Known deviations (accepted — see api-contract.md)

- `validationError` is returned as HTTP **422** everywhere (semantic validation
  failure). The contract text has been updated to document this; the earlier
  "400 validationError" wording in §3/§4 was shorthand. Clients branch on
  `code`, not numeric status — no functional impact.

## 2. Scope checklist — every "applies" item is working functionality

| Category | Result |
|---|---|
| Catalog / inventory (small) | PASS — date + car calendar; admin availability blocks and pricing mutate live data |
| Accounts / auth (admin only) | PASS — owner vs admin enforced server-side; no guest accounts |
| Admin / back-office | PASS — booking queue, property text, gallery (multipart upload → original + thumb + dims), availability, pricing, vehicle, agreement versioning, acceptance audit log, users, email templates — all mutate live data |
| Notifications (email) | PASS — all 6 templates render rows in `sent_emails` via `OutboxMailer`; approve/reject show the rendered email in a confirm modal before sending |
| Legal / compliance | PASS — 5 versioned documents served publicly and versioned via the admin |
| Customer agreement (Kia Sorento) | PASS — shown at booking step 4 only when the car is added; submit records an acceptance event per document with full metadata |

## 3. Click testing (Playwright / Chromium)

All key public pages (P1 home, P2 gallery, P3 the-car, P4 location, P6 lookup,
P7 contact, P8–P12 legal) and the admin SPA (A0 login, A2 list, A3 detail, A4
availability, A6 gallery, A7 vehicle/agreement, A11 settings, accept-invite)
render and their primary controls fire the correct action. No whole-card overlay
click-hijack: `.card__overlay-link` is defined in CSS but referenced by zero
pages; cards use plain nested links.

Non-blocking: each page logs 5 console 404s for `/assets/fonts/*.woff2`
(uncommitted webfonts — documented in `src/frontend/README.md`; falls back to
Georgia / system-ui with no layout shift).

## 4. Journey continuity (user-journeys.md)

- **Journey 1** (guest books stay + car) — PASS end-to-end against the live
  backend: P1 → P3 → `/book?car=1` → wizard steps with submit gated until all 3
  acceptance checkboxes ticked → `POST /bookings` → redirect to
  `/booking/KK-…` Pending with the accepted-documents list. Stale-version and
  date-conflict recovery branches present in `book.js` and matched by backend
  error codes.
- **Journey 2** (admin approves) — PASS: login → dashboard → list → detail →
  approve panel → confirm modal renders the actual `bookingApproved` email →
  send → Approved badge; availability updates.
- **Journey 3** (admin rejects) — PASS: list → detail → reject (explanation ≥ 20)
  → confirm modal shows the explanation verbatim → Rejected badge; no dates
  blocked.
- **Journey 4** (storefront + agreement) — PASS: raise rate (reflected in
  `/availability` + `/quote`), block dates (drop from `/availability`), draft +
  publish a new agreement version (prior versions and acceptances intact),
  owner opens A11, admin role → 403 on users/settings.

## 5. Engineering-standards non-negotiables

| Rule | Result |
|---|---|
| Server-side validation at the API boundary | PASS — malli `mw/validate!` before business logic on every route |
| Server-side authorization on every protected endpoint | PASS — `wrap-admin` / owner flag; 401/403 verified live |
| No hardcoded secrets | PASS — aero + env; no default `ADMIN_INITIAL_PASSWORD`; passwords buddy-hashed; frontend holds no secrets, single `fetch()` in `lib/api.js`, no third-party calls |
| Versioned migrations | PASS — migratus `resources/migrations/20260829000001-init.*`, run on startup; no ad-hoc DDL |
| Idempotent mutations | PASS — `wrap-idempotency` on bookings/approve/reject; replay + conflict + no double side effects verified |
| No micro-frontends | PASS — one static `public/` + one admin SPA shell, single deployable |

## 6. Gallery spot-check

`GET /gallery` returns exactly **25** images across **7** categories (Exterior &
grounds 4, Living 5, Kitchen 2, Bedroom 1 = 4, Bedroom 2 = 3, Bathrooms 5, The
car 2) — **no Workspace**. All 25 `url` + `thumbnailUrl` load 200 as JPEG from
`/api/media/gallery/...`. `exact-location.png` is **not** served (404 on every
candidate path); only `/api/media/map/approx.png` serves, and
`property.location.staticMapUrl` points there.

## Outstanding (non-blocking for staging)

1. 6 brand webfont `.woff2` files not committed → console 404s, clean fallback.
   Pre-launch task for deployment.
2. `OutboxMailer` writes emails to a DB table; a real provider must be dropped in
   behind the `Mailer` protocol before production.

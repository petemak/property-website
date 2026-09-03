# QA Report — Kigali Keys

**Date:** 2026-08-30, re-verified 2026-08-30 (settings blocker), 2026-09-01
(calendar fix + Sent log feature) and 2026-09-03 (performance changeset —
caching + CDN media, commits `65f938b` + `3fe1ff0`) — see "Re-verification"
and "Performance changeset" notes at end.
**Commit:** through `3fe1ff0` (`wrap-cache-control` middleware, migration
`20260903000001-gallery-image-origin`, image re-encode pipeline on seed + admin
upload, `normalize-property-media!` idempotent startup fix-up, frontend `_headers`,
home first-paint trimmed to `/property` + `/gallery`, `preconnect` to the API
origin).
**Verdict:** **PASS — ready for production promotion.** The settings blocker is
fixed and re-verified; Finding 2 (banned placeholder strings) resolved; the
calendar month-anchor bug and the missing email-outbox viewer are both fixed and
verified. The performance changeset is verified end to end (see "Performance
changeset" section). One non-blocking follow-up: Finding 3 — an orphaned
`approx.png` left on the already-seeded backend volume; not referenced by any
page or API response.

**Method:** `src/frontend/public/` served by a static file server with `/api`
proxied to the **real Clojure backend** run from this repo (`clojure -M:run`,
SQLite + migratus migrations + seed, owner seeded from `ADMIN_INITIAL_PASSWORD`).
`dev-server.mjs` mock **not** used. Every endpoint hit live with curl; pages
driven with Playwright/Chromium (already a devDependency; browser already
installed). Backend unit suite for the 2026-09-03 pass: 59 tests / 429
assertions / 0 failures. Live staging (`https://kigali-keys-staging.netlify.app`,
this exact changeset) spot-checked.

---

## 1. Contract — every endpoint in api-contract.md, live-tested

| Endpoint | Result |
|---|---|
| §1 GET /property | PASS — `contact{hostName:"Peter",email:"info@kigalikeys.rw",phone:null,responseTimeText}`; pricing 70/30/3; neighbourhood "Gacuriro / Kagugu, Kigali". Re-verified: `contact.phone` reflects the admin Settings value live (null when cleared, string when set). 2026-09-03: `location.staticMapUrl` = **`/media/map/approx.jpg`** (was `.png`); `Cache-Control: public, max-age=300, stale-while-revalidate=86400`. |
| §2 GET /gallery | PASS — 25 images, positions sorted, 7 categories, lead id set. 2026-09-03: every seed row `url`/`thumbnailUrl` is **`/media/gallery/<stem>.jpg`** / `<stem>_thumb.jpg` (CDN-at-rest, no `/api/` prefix); the 2 car photos are `sorento1.jpg` / `sorento2.jpg` (**not `.jpeg`**); an admin-uploaded row returns `/api/media/gallery/<id>.jpg` and a mixed response is served fine; `Cache-Control` swr as above. |
| §3 GET /availability | PASS — shape correct; bad/oversized range → 422 validationError. 2026-09-03: `Cache-Control: public, max-age=120`. |
| §4 POST /quote | PASS — 7-night no-car total **520** (local + live staging); with car adds `carRental`; line-item breakdown with real total. `Cache-Control: no-store` (POST). |
| §5 GET /vehicle | PASS — includes `minDriverAge:23`, `minLicenceYears:2`, `agreement` v4 + bodyHash. 2026-09-03: `Cache-Control` swr. |
| §6 POST /bookings | PASS — missing key→400; create→201 w/ acceptancesRecorded; replay→same body + `Idempotency-Replayed:true`; same key/diff body→409; stale version→409 agreementVersionStale; missing acceptance→422 agreementRequired; 3 acceptance rows persisted (name/email/version/hash/IP/UA/snapshot). Re-verified 2026-09-03: a fresh car booking (`KK-4A48R5`) persists exactly 3 acceptance rows (stayTerms v3, houseRules v3, vehicleRentalAgreement v4) + `bookingReceived` and `adminNewBooking` in `sent_emails`. `no-store`. |
| §7 GET /bookings/:reference | PASS — email gate + token gate; wrong/missing→404; approved adds `approvalDetails`; no driver PII in guest view. 2026-09-03: `Cache-Control: no-store` (guest-specific). |
| §8 POST /contact | PASS — 202; bad input→422; >10/60s/IP→429 rateLimited. `no-store`. |
| §9 GET /documents/:type/:version | PASS — all 6 types resolve; privacy v3 & websiteTerms v2 contact email = info@kigalikeys.rw. 2026-09-03: `Cache-Control` swr (`/current` alias included). |
| §10 GET /media/... | PASS — **new scheme.** `/api/media/gallery/<id>.jpg` + `<id>_thumb.jpg` (admin uploads) and `/api/media/map/approx.jpg` serve 200 with `Cache-Control: public, max-age=31536000, immutable` and correct `Content-Type`; path traversal / missing file → 404 JSON. Seed gallery images are **not** served here — they resolve to `/media/...` and are served at rest from the frontend deploy (confirmed on staging: `server: Netlify`, no `via: fly.io`). Old `/media/map/approx.png` gives 404 on a fresh deploy (see Finding 3 for the staging volume relic). |
| §11 POST /admin/auth/login | PASS — 200 + HttpOnly SameSite=Lax cookie; bad creds→401. `no-store`. |
| §12 POST /admin/auth/logout | PASS — 204, cookie cleared |
| §13 GET /admin/auth/session | PASS — 200 / 401; `Cache-Control: no-store` (verified live + on staging) |
| §13b POST /admin/auth/accept-invite | PASS — valid token→200 + session; used/invalid token→**410 conflict**; weak password→422. Re-verified 2026-09-03: bad token → 410 `conflict`. |
| §14 GET /admin/bookings | PASS — status/q/car filters, `{page,pageSize,total}`; `no-store` (auth + unauth) |
| §15 GET /admin/bookings/:id | PASS — full PII, driver DOB/licence, acceptances w/ documentUrl, availabilityConflicts |
| §16 POST /admin/bookings/:id/approve | PASS — total≠sum→422; missing carCollection→422; overlap another approved booking→409 dateConflict; blockDates:false approves anyway; already-decided→409; key replay→stored 200 |
| §17 POST /admin/bookings/:id/reject | PASS — explanation<20→422; transitions pending→rejected; no dates blocked; already-decided→409; replay |
| §18 availability blocks | PASS — GET (range required), POST→201, DELETE manual→204, DELETE booking-source→403 |
| §19 GET/PUT /admin/pricing | PASS — validation (rate>0 etc.)→422; takes effect on next quote/availability; `no-store` on GET and PUT |
| §20 GET/PUT /admin/property | PASS — GET admin shape; PUT full-replace returns new updatedAt |
| §21 gallery management | PASS — PATCH caption, POST lead, PUT order all mutate live data. 2026-09-03: **POST /admin/gallery** (upload) re-encodes on ingest — an 812 KB camera-original JPEG became a 219 KB / 1600×2000 full + 47 KB thumb (both within budget), row `origin='upload'`, `201` returns `/api/media/gallery/<id>.jpg` (§2 shape). |
| §22 GET/PUT /admin/vehicle | PASS |
| §23 vehicle agreement versions | PASS — publish → v5 current, prior versions/acceptances intact |
| §24 legal document versions | PASS — publish houseRules → v4, `termsVersions` in GET /property bumped |
| §25 GET /admin/agreement-acceptances (+ :id) | PASS — read-only list + filters; `:id` returns immutable `documentSnapshot`; no write endpoint |
| §26 email templates | PASS — GET/GET:key/PUT/preview/test; PUT with unknown `{{token}}`→422; test→202 |
| §26b sent-email log (outbox) | PASS — GET /admin/sent-emails [owner+admin]: unauth→401; item shape exact; status "stored"; filters non-overlapping. GET /admin/sent-emails/:id → brand-wrapped html for templated rows, raw body for untemplated; unknown id→404. Migration 20260901000001 clean on fresh DB. Re-verified 2026-09-03: list + `:id` still 200, `no-store`. |
| §27 admin users [owner] | PASS — create→invited + adminInvite email row; demote/delete last owner→409; delete self→409 |
| §28 GET/PUT /admin/settings [owner] | **PASS.** GET owner-only (401 unauth / 403 non-owner). PUT full matrix: `publicPhone` omitted / `null` / `""` → 200 stored `null` (GET /admin/settings **and** GET /property `contact.phone` both JSON `null`); real value stored trimmed; over-length → 422. Same for `guestResponseTimeText`. Re-verified 2026-09-03: PUT with `publicPhone:null` + `guestResponseTimeText:null` → 200, both read back `null`. |

Owner-only authorization re-verified with a real non-owner (`admin`, invited +
accept-invite) session: `/admin/settings` (GET **and** PUT) → 403;
`/admin/bookings` → 200. No session → 401. Enforced server-side.

---

## 2. Scope checklist — every "applies" category, end to end

| Category | Result |
|---|---|
| Catalog / inventory (small) | PASS — date + car calendars are live; admin blocks & pricing mutate real data reflected in `/availability` and `/quote`. Gallery media now resolves to the frontend CDN (`/media/...`) for seed photos, backend proxy (`/api/media/...`) for admin uploads — verified in a live `GET /gallery`. |
| Accounts / auth (admin only) | PASS — owner vs admin enforced server-side; invite → accept-invite → session works; no guest accounts |
| Admin / back-office | PASS — booking queue, property text, gallery, availability, pricing, vehicle, agreement versioning, acceptance log, users, email templates, owner Settings all work end to end. 2026-09-03: admin **image upload re-encodes to budget** and stores an `origin='upload'` row served at `/api/media/...`; admin screens (`/admin/gallery`, `/admin/settings`, `/admin/vehicle`, `/admin/bookings`) render without console errors after a real owner login. |
| Notifications (email) | PASS — `sent_emails` rows written for bookingReceived/adminNewBooking/bookingApproved/bookingRejected/contactAck/adminInvite + the untemplated direct host notice; approve & reject show the rendered email before sending; the A9 "Sent log" outbox viewer exists (filterable table, "Stored" badge, sandboxed iframe modal). |
| Legal / compliance | PASS — stayTerms v3, houseRules v3, websiteTerms v2, privacy v3, cancellationPolicy v3 served publicly and versioned via admin |
| Customer agreement (Kia Sorento) | PASS — full agreement text shown at Step 4 only when the car is added; submit writes a `vehicleRentalAgreement` acceptance row (version + bodyHash + snapshot) alongside stayTerms + houseRules — re-verified 2026-09-03, exactly 3 rows persisted for a fresh car booking. |

---

## 3. Click testing (Playwright / Chromium)

| Page | Result |
|---|---|
| P1 home | PASS — header transparent→solid on scroll; nav links + CTA (`href="/book"`) land correct; FAQ accordions, "Show all amenities", photo-strip buttons all fire their own action. 2026-09-03: first paint fires exactly `/api/property` + `/api/gallery` (no `/availability`, no `/quote`); `preconnect` + `dns-prefetch` to the API origin present; strip `<img>` use `_thumb` URLs + `loading="lazy"` + explicit `width`/`height`; clicking a strip photo opens the lightbox on the **full-size** (`/media/gallery/front-yard.jpg`, non-thumb) image and it decodes. |
| P1 home @360px | PASS — no horizontal overflow; hero title clears the fixed header |
| P2 gallery | PASS — 25 thumbnail buttons; each opens the Lightbox on the full-size non-thumb URL (decoded); Esc closes; **zero whole-card overlay links** — `.card__overlay-link` is defined in `components.css` but applied by no page (grep of `assets/js` + HTML: only the CSS definition). All grid `<img>` use `_thumb` + `loading="lazy"` + explicit dims. |
| P3 the-car | PASS — "Add the car to your stay" → `/book?car=1` (click lands there); "Read the full agreement" → `/vehicle-rental-agreement`; hero car image is the full-size `/media/gallery/sorento1.jpg` loaded eager (single hero, not a grid — allowed). |
| P4 location | PASS — loads; `.mini-map` `<img>` src = `/media/map/approx.jpg`, 200. |
| P5 /book | PASS — grid DateRangePicker day buttons (61) select range; stepper advances; Step 4 submit gated on all 3 acceptance checkboxes. |
| P6 /booking | PASS — reference + email lookup form present (2 inputs); no click mis-targets. |
| P7 contact | PASS — form submits `POST /api/contact` (202); contact block renders email-only when `phone:null`; the host email line is a real `mailto:` link (a click in that block correctly lands on the mailto anchor). |
| P8–P12 legal | PASS — all five render from `GET /documents`; `preconnect` present in every `<head>`. |
| A0 admin login | PASS — owner login → `/admin` dashboard; sidebar nav targets all resolve. |
| A1→A3 approve/reject | PASS — list row navigable to detail; ConfirmModal renders the real email; send → badge flips. |
| A11 settings | PASS — owner can save with `publicPhone`/`guestResponseTimeText` cleared. |

No `.woff2` 404s on any page (local + staging: `fraunces-latin.woff2` + `inter-latin.woff2` → 200). No `requestfailed` / console errors on any public page during the 2026-09-03 run. No media 404s.

---

## 4. Journey continuity (user-journeys.md)

| Journey | Result |
|---|---|
| 1 — Guest books stay + car | PASS — P1 → P3 → `/the-car` "Add the car" (`href="/book?car=1"`, click lands there) → `/book?car=1` (calendar + stepper render) → dates → car toggle + driver fields → details → review (3 checkboxes) → `POST /bookings` 201 → `/booking/KK-…` Pending + accepted-documents list. Stale-version and date-conflict recovery branches present and matched by backend error codes. |
| 2 — Manager approves | PASS — login → dashboard → list row → detail → approve → ConfirmModal → send → Approved; availability updates. |
| 3 — Manager rejects | PASS — list → detail → reject (explanation ≥ 20) → ConfirmModal → send → Rejected; no dates blocked. |
| 4 — Admin updates storefront + agreement | PASS — raise nightly rate via pricing (reflected in `/quote` + `/availability`); block dates drop from `/availability`; draft + publish new car agreement → v5 current, prior v4 + acceptances intact; non-owner `/admin/users` → 403. 2026-09-03: admin image upload → re-encoded `/api/media/...` row appears in `GET /gallery`. |

Every step is reachable from the one before it. No broken link in any journey.

---

## 5. Engineering-standards non-negotiables (checked against the code)

| Rule | Result |
|---|---|
| Server-side validation at the API boundary | PASS — `mw/validate!` (malli) before business logic on every route; live 422s confirm it. Gallery upload validates file/alt/category/mime/size before touching disk. |
| Server-side authorization on every protected endpoint | PASS — `wrap-admin` / owner flag; 401 / 403 verified live (GET + PUT), not UI-only. Every `/admin/*` route carries `[[mw/wrap-admin ctx]]` in `gallery.clj` / router slices. |
| No hardcoded secrets (incl. seed) | PASS — all config via aero/env; `ADMIN_INITIAL_PASSWORD` has no default; `TOKEN_SECRET` fallback is a labelled dev placeholder; grep of `seed.clj` + `images.clj` + `media_export.clj` finds no literal secret/key. |
| Versioned migrations | PASS — migratus; 2026-09-03 adds `20260903000001-gallery-image-origin.{up,down}.sql`, ran clean on a fresh DB (`Up 20260903000001` in the boot log). No ad-hoc DDL — the `origin` column is added by this migration only. |
| Idempotent mutations | PASS — `wrap-idempotency` on `POST /bookings`, `/approve`, `/reject`; replay returns stored response, different body → 409; verified live. `normalize-property-media!` is itself idempotent (unit test + a second boot is a no-op). |
| No micro-frontends | PASS — one static `public/` + one admin SPA shell, single deployable; `_headers` / `_redirects` / `netlify.toml` one build. |
| Static assets served from the CDN (not proxied through the origin) | PASS — seed gallery images + the approx-location map are committed under `src/frontend/public/media/` and served at rest by Netlify (staging: `server: Netlify`, no `via: fly.io`). `wrap-cache-control` closes the origin to caching by default; `_headers` long-caches `/media/*`, `/assets/*`. The backend serves JSON + admin-upload media only. See Finding 3 for one orphaned file. |
| Per-image size budgets | PASS — `kigali.images/write-web-image!` is the single ingest encoder (seed export **and** admin upload); quality ladder steps down until ≤ budget. All 25 committed full images ≤ 300 KB / ≤ 2000px, all 25 thumbs ≤ 60 KB / ≤ 800px, map 99,945 B / 857×552. Admin-uploaded camera-original (812 KB) re-encoded to 219 KB. Verified byte-for-byte on disk (frontend bundle + backend seed dir identical). |

Supporting guidelines also honoured: single error shape, camelCase + ISO 8601, vertical feature slices, thin handlers, structured logging. In-memory per-IP rate-limit bucket is process-local — acceptable (single service, statelessness not a listed non-negotiable).

---

## Blockers / findings

### Blocker 1 — RESOLVED (re-verified 2026-08-30) · settings `publicPhone`
See detail below in "Re-verification — 2026-08-30". `settings.clj` / `content.clj`
/ `settings.js`. Cleared.

### Finding 2 — RESOLVED · banned placeholder strings
`admin/bookings.js` + `admin/emails.js` placeholders replaced with neutral
`House 00 …` / `Peter — …` samples. Grep of `src/frontend/public/` for
`Rebero` / `Jean` / `host@kigalikeys` / `Cleaning 35` / `USD 1015` / `$35` / `140`
→ no matches.

### Finding 3 — NON-BLOCKING (2026-09-03) · orphaned `approx.png` on the staging backend volume
`GET https://kigali-keys-staging.netlify.app/api/media/map/approx.png` returns
**200** — an 876 KB PNG (857×552) still on the fly volume from the pre-`/media/`
deploy — served with `Cache-Control: immutable`.

- **Not user-facing:** `normalize-property-media!` rewrites the DB
  `location.staticMapUrl` to `/media/map/approx.jpg`, so no page or API response
  references the `.png` any more. `GET /gallery`, `GET /property` and every
  rendered page are on the new scheme. On a **fresh** DB/volume the `.png` never
  exists and the URL is a clean 404 (verified locally).
- **Where:** backend — `src/backend/kigali/seed.clj`. `normalize-gallery-row!`
  deletes stale old-extension **gallery** files when it renames a row, but
  `normalize-property-media!` / `seed-map!` never unlink the old
  `media/map/approx.png` on an in-place upgrade.
- **Recommendation (not required for this gate):** add a one-line
  `(.delete (io/file media-dir "map" "approx.png"))` to the map branch of
  `normalize-property-media!`, or delete the file from the fly volume once.
  Standards' per-image budget is about served page assets; this file is an
  unreferenced relic, so this is a cleanup item, not a release blocker.

### Note (not a defect)
`GET /admin/email-templates` returns `{templates:[…]}` (contract doesn't pin the
wrapper key; the admin UI consumes it correctly).

---

## Performance changeset — verification 2026-09-03 (`65f938b` + `3fe1ff0`)

Real Clojure backend from this repo on a **fresh** SQLite DB + fresh `MEDIA_DIR`,
owner seeded from `ADMIN_INITIAL_PASSWORD`; `src/frontend/public/` served static
with `/api` proxied to it; Playwright/Chromium for browser steps. Backend unit
suite: **59 tests / 429 assertions / 0 failures** (includes
`caching_test`, `images_test`, `gallery_seed_test`, `gallery_normalize_test`).
Live staging spot-checked.

### 1. Caching — PASS

| Route (GET unless noted) | Expected | Live result |
|---|---|---|
| `/property`, `/gallery`, `/vehicle`, `/documents/:type/:version` (+ `/current`) | `public, max-age=300, stale-while-revalidate=86400` | PASS |
| `/availability` | `public, max-age=120` | PASS |
| `/api/media/*` (gallery upload + map) | `public, max-age=31536000, immutable` | PASS |
| `POST /quote`, `POST /contact`, `POST /bookings`, `POST /admin/gallery` | `no-store` | PASS |
| `GET /bookings/:reference` | `no-store` | PASS |
| every `/admin/*` GET (bookings, settings, gallery, pricing, auth/session) — authed **and** unauthed | `no-store` | PASS |
| `PUT /admin/pricing` and other mutating routes | `no-store` | PASS |
| **routes not in the allow-list** — `GET /api/admin/property`, `GET /api/admin/availability/blocks`, `GET /api/not-a-real-route`, `GET /api/documents/privacy` (no version) | `no-store` (closed by default) | PASS |

`cache-control-for` is a pure fn, GET-only, allow-list opt-in; unit test
`cache-control-for-is-pure-and-defaults-closed` covers the closed-by-default
property. Staging confirms the same headers end to end (`/api/property` swr,
`/api/admin/auth/session` + guest lookup + `POST /quote` `no-store`).

### 2. Migration `20260903000001-gallery-image-origin` — PASS

Ran clean on a fresh DB (boot log `Up 20260903000001`). Resulting DDL:
`origin TEXT NOT NULL DEFAULT 'upload' CHECK (origin IN ('seed','upload'))`.
`UPDATE gallery_images SET origin = 'seed'` backfills existing rows (0 on a fresh
DB — migration runs before seed). Seed inserts write `'seed'` explicitly, admin
upload writes `'upload'` explicitly; a new row that specified neither would
default to `'upload'` (correct — post-migration inserts are uploads). After a
fresh seed: 25 rows `origin='seed'`; after one admin upload: 1 row
`origin='upload'`. `down.sql` present.

### 3. Image budgets — PASS

- 25 committed full images `src/frontend/public/media/gallery/*.jpg`: all
  ≤ 300 KB (largest `front-yard2.jpg` 297,136 B) and ≤ 2000px long edge.
- 25 committed thumbs `*_thumb.jpg`: all ≤ 60 KB (largest `sorento2_thumb.jpg`
  59,455 B) and ≤ 800px.
- `src/frontend/public/media/map/approx.jpg`: 99,945 B, 857×552 (≤ ~150 KB).
- Backend seed `MEDIA_DIR` after a fresh boot is byte-identical to the committed
  frontend bundle (same encoder, `clojure -X:export-media`).
- Admin upload (`POST /admin/gallery`) of an 812 KB camera-original JPEG →
  219 KB / 1600×2000 full + 47 KB thumb, row `origin='upload'`, URL
  `/api/media/gallery/<id>.jpg`, served with `immutable` cache. Camera-original
  is never written to a servable path.

### 4. `normalize-property-media!` (in-place upgrade of an already-seeded DB) — PASS

Covered by `test/backend/kigali/gallery_normalize_test.clj` (4 deftests, all
green in the suite run):

- Downgrade `sorento1` to the old scheme (`.jpeg` name, `4032×3024` row dims,
  camera-original bytes copied in), run `normalize-property-media!`:
  row → `sorento1.jpg` / `sorento1_thumb.jpg`; both files re-encoded within
  budget; stale `.jpeg` files deleted; `width`/`height` refreshed to the real
  post-resize dims; summary `{renamed 1, re-encoded 1, untouched 24}`;
  `GET /api/gallery` then has the `/media/gallery/sorento1.jpg` URL and **zero
  `.jpeg`** in any `url`/`thumbnailUrl`.
- Second run → `{renamed 0, re-encoded 0, untouched 25}`, `map-url-rewritten
  false` (no-op).
- A fresh seed needs no normalization (`{untouched 25}`).
- `normalized-old-db-matches-a-fresh-seed-listing`: after normalize the
  `sorento1` row (`filename, thumb_filename, width, height`) **and** the on-disk
  full-image byte length are identical to a fresh seed.
- The map branch: a known-stale `/api/media/map/approx.png` or
  `/media/map/approx.png` in `location.staticMapUrl` is rewritten to
  `/media/map/approx.jpg`; an owner-customised value is left alone.
- Boot log on the fresh DB: `normalize-property-media! {:map-url-rewritten
  false, :re-encoded 0, :renamed 0, :untouched 0}` (empty gallery, then
  `seed-gallery!` populates) — no crash, no-op path exercised.

_Caveat (not a defect):_ the old `map/approx.png` **file** is not unlinked on an
in-place upgrade — see Finding 3.

### 5. `GET /gallery` shape — PASS

Fresh seed: 25 rows, all `url` = `/media/gallery/<stem>.jpg`, all `thumbnailUrl`
= `/media/gallery/<stem>_thumb.jpg`, positions sorted, lead id set, every row has
integer `width`/`height`. Car photos are `sorento1.jpg` / `sorento2.jpg`. After
an admin upload, that one row is `/api/media/gallery/<id>.jpg` — a mixed-prefix
response is served without error. Live staging `/api/gallery`: 25 rows, all
`/media/` `.jpg`, no `.jpeg`.

### 6. Frontend (browser) — PASS

- Home first paint fires exactly `GET /api/property` + `GET /api/gallery` — **no
  `/availability`**, no `/quote` without URL params.
- `preconnect` (`crossorigin`) + `dns-prefetch` to `https://kigali-keys-staging.fly.dev`
  in the `<head>` of all 12 public pages (`deploy-frontend-prod.sh` rewrites the
  host for prod, same as the `/api/*` proxy line).
- Home strip + gallery grid `<img>`: `_thumb` URLs, `loading="lazy"`, explicit
  `width`/`height` attributes (no layout shift).
- Lightbox: opens the full-size **non-`_thumb`** URL, image decodes
  (`naturalWidth > 0`); only prev/next neighbours are pre-warmed, not all 25.
- Hero (home) + car hero (the-car): full-size URL, `loading="eager"`,
  `fetchpriority="high"` — single LCP image, not a grid; allowed.
- No console errors / failed requests on any public page. Gallery lightbox and
  booking journey 1 both work.

### 7. Live staging spot-check — PASS (with Finding 3)

- `https://kigali-keys-staging.netlify.app/api/gallery` → 25 rows, all `/media/`
  `.jpg`, no `.jpeg`. PASS
- `/media/gallery/sorento1.jpg` → 200, `server: Netlify`, **no `via: fly.io`**,
  `content-type: image/jpeg`, 170,287 B, `Cache-Control: public,max-age=86400,
  stale-while-revalidate=604800`. PASS
- `/media/map/approx.jpg` → 200, `server: Netlify`, 99,945 B. PASS
- `/api/property` → `Cache-Control` swr, `contact.phone` null,
  `location.staticMapUrl` = `/media/map/approx.jpg`. PASS
- `/api/quote` 7-night no-car → **520**. PASS
- `no-store` on `/api/admin/auth/session`, `/api/bookings/:ref`, `POST /api/quote`.
  PASS
- `fraunces-latin.woff2` / `inter-latin.woff2` → 200. PASS
- Old `/api/media/map/approx.png` → **200, not 404** — orphaned 876 KB PNG on the
  backend volume. See **Finding 3** (non-blocking; not referenced anywhere).

### 8. Regression sweep — PASS

- §1 `GET /property` contact block shape unchanged (`hostName/email/phone/responseTimeText`, phone null).
- §4 `POST /quote` 7-night no-car total = **520** (local + staging).
- §5 `GET /vehicle` `minDriverAge:23`, `minLicenceYears:2`, agreement v4 + bodyHash.
- §6 fresh car booking records exactly **3** acceptance rows (stayTerms v3,
  houseRules v3, vehicleRentalAgreement v4) + `bookingReceived` / `adminNewBooking`
  in `sent_emails`.
- §26b `GET /admin/sent-emails` + `/:id` → 200, `no-store`; list shape intact.
- §28 `PUT /admin/settings` with `publicPhone:null` + `guestResponseTimeText:null`
  → 200; both read back JSON `null`.
- §13b accept-invite bad token → **410 conflict**.
- No `.woff2` 404s (local + staging); header + inline-SVG logo render; no page errors.

**Likely owners of the changeset:** backend engineer — `kigali.middleware`
(`wrap-cache-control`), `kigali.images`, `kigali.seed`
(`normalize-property-media!`), `kigali.features.gallery` / `media`,
`kigali.media-export`, migration `20260903000001`. Frontend engineer —
`public/_headers`, `assets/js/pages/home.js`, `components/lightbox.js` +
`media.js`, `pages/gallery.js` / `the-car.js`, `preconnect` lines in every
`*.html`. Finding 3 is backend (`seed.clj`).

**Gate decision: PASS — cleared for production deploy.** Finding 3 is a
non-blocking cleanup item (unreferenced file on the already-seeded volume); it
does not affect any page, API response, or user journey, and does not exist on a
fresh deploy.

---

## Re-verification — 2026-08-30

Focused re-verification of the Blocker 1 fix plus a light regression sweep. Real
Clojure backend from this repo (`clojure -M:run`, fresh SQLite db, owner seeded
from `ADMIN_INITIAL_PASSWORD`), `src/frontend/public/` served by a static server
with `/api` proxied to it, browser steps via Playwright/Chromium.

**Blocker 1 fix — PASS.** `PUT /admin/settings` as the owner:
- `publicPhone` omitted / `null` / `""` → **200**, stored `null`; GET /admin/settings
  and GET /property `contact.phone` both return JSON `null`.
- `publicPhone:"  +250 788 123 456  "` → **200**, stored trimmed `"+250 788 123 456"`.
- `publicPhone` 41 chars → **422**; 40 chars → **200**.
- `guestResponseTimeText` omit / `null` / `""` → **200** stored `null`; real text →
  **200**; 201 chars → **422**; 200 chars → **200**.
- Save changing only `hostDisplayName` with no phone set → **200** (not 422).

**Browser (Playwright) — PASS.** Owner login → `/admin/settings`: clear phone →
Save → "Settings saved", no 422 → reload, field still empty → set
"+250 788 123 456" → Save → success → public `/contact` shows the phone line and
footer → back to settings → clear → Save → `/contact` back to email-only.

**Light regression — PASS.**
- §1 GET /property `contact` block shape unchanged.
- §4 POST /quote 7-night no-car total = **520**.
- §6 POST /bookings still records exactly **3** agreement acceptance rows.
- §28 GET/PUT /admin/settings owner-only: no session → **401**; real non-owner → **403**.
- §13b accept-invite bad token → **410** `conflict`; real token → **200**.
- No `.woff2` / `.css` / `.js` 404s on home + contact.

**Likely-owner of the changes:** backend engineer (`settings.clj`, `content.clj`)
and frontend engineer (`settings.js`, `bookings.js`, `emails.js`). Cleared.

## Re-verification — 2026-09-01 · Sent log (§26b / A9)

Focused end-to-end verification of the new admin "Sent log" (email outbox viewer)
plus a light regression sweep. Real Clojure backend from this repo, fresh SQLite,
owner seeded from ADMIN_INITIAL_PASSWORD; public/ served with /api proxied;
Playwright/Chromium for browser steps. Backend unit suite: 45 tests / 268
assertions / 0 failures.

Sent log — PASS. Migration 20260901000001 clean; sent_emails.status +
booking_reference present. 8 realistic outbox rows generated. GET
/admin/sent-emails: 401 unauth / 200 non-owner admin / 200 owner; newest-first;
exact item shape; status "stored" on every row; bookingApproved row has
bookingReference, contactAck + direct notice null; templateKey / q / templateKey=none
/ from / to / pagination all correct and non-overlapping. GET
/admin/sent-emails/:id: brand-wrapped html for templated rows, raw stored body
for the direct notice, 404 notFound for unknown id, 401 unauth. Browser: owner ->
/admin/emails -> two tabs; Sent log columns sent-at/to/template/subject/booking-ref/status;
filters narrow the table; row opens a modal with a sandboxed iframe; "Stored"
badge; Templates tab preview + Save + Send-test (202) still work.

Light regression — PASS. §1 contact block shape unchanged (phone null); §4
7-night no-car quote = 520; §6 booking still records exactly 3 acceptance rows;
§28 settings saves with publicPhone null; /book calendar opens on the
pre-selected current month; no .woff2 404s; header + logo render; no page errors.

Verdict: PASS — the Sent log feature ships correctly, no regressions. Cleared.

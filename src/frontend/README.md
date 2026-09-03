# Kigali Keys — frontend

Static, framework-free frontend built to `design-spec.md`, `user-journeys.md` and
`api-contract.md` (sha256 `0c6add87…326c5`, 1105 lines — the version backend
confirmed byte-identical).

## Stack

- Semantic HTML5, one CSS layer (custom properties + a small component sheet),
  vanilla ES modules. **No framework, no build step, no bundler.**
- Production build = the contents of `public/` served by any static host / CDN,
  with `/api/*` reverse-proxied to the backend and the rewrites in
  `public/_redirects` applied (Netlify-style; mirror them on whatever host).
- One deployable build (engineering-standards: no micro-frontends).

Why vanilla: engineering-standards leaves the choice open and says "default to
vanilla … unless a framework is specified." Nothing specified one. A single
developer maintains this; a no-build static site is the cheapest thing to host
(the brief calls out a low, variable hosting budget) and the least to keep
patched.

## New dependencies

| Dependency | Scope | Why |
|---|---|---|
| `playwright` (`playwright-core`) | **dev / test only** | Drives real Chromium for `test/smoke.mjs`, which click-tests the rendered pages and walks all four user journeys. Not shipped. Already present in the machine's npx cache; `package.json` pins it for reproducibility. |

Runtime dependencies: **none.** No new libraries or frameworks were added for
the performance work (seed-image optimisation is the backend's `:export-media`
task, not a frontend dependency).

## Layout

```
public/                     ← the deployable artifact
  *.html                    ← one file per public route (P1–P13)
  admin.html                ← A0–A11 single-page shell (behind login, noindex)
  _redirects                ← pretty-route rewrites for the host
  favicon.svg               ← brand mark: Bone beehive-house on a Hill-Green tile
  assets/
    img/    logo.svg        ← header/sidebar logo mark (beehive-house + keyhole
                              door, viewBox 0 0 48 48, fill="currentColor" so it
                              inherits the wordmark colour); inlined via
                              components/icons.js `logoMark()`, never <img>
    css/    tokens, base, layout, components, admin
    fonts/  fonts.css + fraunces-latin.woff2 / inter-latin.woff2 (self-hosted, SIL OFL)
    js/
      lib/         api client, config (v2 seams), dom/format/markdown/countries
      components/  SiteHeader/Footer, BookingWidget, DateRangePicker,
                   PriceBreakdown, StatusBadge, Lightbox, Accordion, Stepper,
                   AgreementPanel, form primitives, icons, media placeholders
      pages/       one module per public page
      admin/       app router + shell + one module per admin screen
dev-server.mjs              ← DEV ONLY: static server + in-memory mock of the API
mock/fixtures/              ← seed data for the mock (property, gallery, vehicle,
                             documents, admin, plus two seeded bookings)
test/smoke.mjs              ← Playwright click-test of the 4 journeys
```

## Run it locally

```
cd src/frontend
node dev-server.mjs 4173      # http://localhost:4173  (serves the mock API too)
```

Admin sign-in (mock): `jean@kigalikeys.rw` / `kigali-demo` (owner),
`aline@kigalikeys.rw` / `kigali-demo` (admin).

## Test

```
npm install          # once, for playwright
npm run test:smoke   # starts its own server, drives Chromium, asserts on the DOM
```

`test/smoke.mjs` covers: P1 render + FAQ accordion + lightbox (open, arrow-nav,
Esc closes and restores focus) + mobile nav drawer + header logo mark (inline
`<svg>` in the `.wordmark`, colour follows the text in both header states, no
360px overlap with the header actions); P2 gallery groups; P3 → P5
deep link; **Journey 1** end-to-end (calendar range, car + driver, guest
details, all three acceptances gate the submit, `POST /bookings`, redirect to a
pending P6 with the accepted-documents list); P6 email gate (wrong email
rejected); P13 real 404 status; the five legal pages; P7 contact; **Journey 2**
(admin login → approve with the email-preview confirm modal → Approved badge);
**Journey 3** (reject with explanation); **Journey 4** (raise nightly rate,
block dates, publish a new agreement version); owner-only Users page; the
accept-invite page; and a "no uncaught page errors" assertion across the whole
run.

Performance checks: `preconnect`/`dns-prefetch` to the API origin in every
public `<head>`; the home first paint makes only `GET /property` + `GET
/gallery` and never `GET /api/availability`; gallery-grid `<img>` use the
`*_thumb` URL with `loading="lazy"` + `decoding="async"`; the lightbox loads the
full-size URL on open and warms only the neighbours, not all 25.

## How the v1 / v2 seams are wired (all data, no `if`-forests)

- **Stepper** renders from `WIZARD_STEPS` in `lib/config.js`. `stepsFor(bookingMode)`
  returns the 4 v1 steps, or appends `{ id: "payment" }` when a property's
  `bookingMode === "instant"`. The wizard's post-review handler
  (`advanceFromReview`) calls `POST /bookings` then asks whether the *next* step
  is `payment` — it never assumes "four steps ending in one API call".
- **StatusBadge / status handling** — `statusMeta(status)` returns a specific
  render for known values and a neutral "In progress" fallback for anything else
  (a future `confirmed`, or a v3 addition). Nothing throws on an unknown status.
- **PriceBreakdown** takes `mode: "estimate" | "final"`. v1 uses `estimate`
  everywhere (reads `estimatedTotal`, shows the "host confirms the final amount /
  no payment taken" note). The approved P6 view and admin decision view already
  use `mode: "final"` against `approvalDetails.total` — same markup.
- **Booking CTA copy** comes from `BOOKING_COPY[bookingMode]` (`lib/config.js`):
  button label, reassurance line, estimate label, rail-empty text, from-price
  prefix, success-banner. The `instant` key is filled in but unused in v1.

## Contract notes / assumptions (agreed with backend)

- `POST /quote` `guests` = `adults + children` (price is date/car-driven; the
  split is enforced at `POST /bookings`).
- `GET /bookings/:reference` returns the full `estimate.lineItems`; the UI also
  degrades to "total only" if they're ever absent.
- `GET /vehicle` `minDriverAge` / `minLicenceYears` are used for a soft
  client-side DOB check and to phrase the hint; the server check at
  `POST /bookings` stays authoritative. The fields are treated as optional.
- Post-submit, the guest's email is stashed in `sessionStorage` so the redirect
  to P6 opens without the email gate; the email-token link and the manual
  reference+email gate both still work.

## Photos

Owner-supplied originals live in the repo at `assets/property-photos/` (700 KB –
1.4 MB each) and are mapped per `assets/property-photos/MAPPING.md`. Those
originals are **not** part of the frontend deploy.

### Seed media bundle — committed, served from the CDN edge

`src/frontend/public/media/` **is committed** (unlike the gitignored runtime
`/media/` tree the backend seeder writes). It holds the web-optimised seed
images that ship as static files in the frontend deploy, so Netlify serves them
from the edge at rest and they are never proxied through the Fly backend:

```
public/media/gallery/<stem>.jpg        full  — longest edge ~2000px, <= 300 KB
public/media/gallery/<stem>_thumb.jpg  thumb — longest edge  ~800px, <=  60 KB
public/media/map/approx.jpg            approximate-location map (re-encoded)
```

25 gallery photos (50 files) + 1 map ≈ **8 MB**. These are produced by the
**backend** with `clojure -X:export-media` (`src/backend/kigali/media_export.clj`),
which re-encodes `assets/property-photos/` with the same encoder the seeder uses
(`kigali.images`), so the bytes match what `GET /gallery` describes. Do **not**
add a second generator on the frontend side.

`GET /gallery` returns these as `/media/...` URLs; admin-uploaded images stay on
`/api/media/...` (proxied). **The frontend renders whatever `url` /
`thumbnailUrl` / `staticMapUrl` the API returns — no hardcoded image paths, and
a mix of `/media/...` and `/api/media/...` is expected.**

> **Open coordination point with the backend:** the exporter normalises every
> filename to `.jpg`, but `kigali.seed/seed-gallery!` stores the raw source
> basename in `gallery_images.filename` — so the two `the-car/sorento*.jpeg`
> sources would come back from `GET /gallery` as `…/sorento1.jpeg` while the
> exported file on disk is `sorento1.jpg`. Exporter and seeder must agree on the
> extension (normalise both to `.jpg`, or keep `.jpeg` in both). The mock fixture
> currently follows the exporter (`.jpg` for all 25).

The mock `dev-server.mjs` serves `public/media/...` directly (static), and still
answers `/api/media/photos/...` and any unknown `/api/media/...` with a
brand-palette placeholder SVG (as `smartImage()` does client-side on a 404).
`location-map/exact-location.png` is never published. Any category with no photo
(currently **Workspace** — no desk installed yet) renders no tile; the category
stays in the API enum.

### Loading discipline

- Grid / preview-strip / card thumbnails use `thumbnailUrl`, `loading="lazy"`,
  `decoding="async"`, and carry explicit `width`/`height` (plus a CSS
  `aspect-ratio` box) so there is no layout shift.
- The full-size `url` is fetched **only** when the lightbox opens for that image;
  the lightbox warms just the immediate prev/next neighbours, not the whole set.
- The hero is the LCP element: full-size `url`, `loading="eager"`,
  `fetchpriority="high"`, and its `GET /gallery` fetch is kicked off in parallel
  with `GET /property` rather than after it.

## API origin preconnect

Every page `<head>` carries `<link rel="preconnect" ... crossorigin>` +
`<link rel="dns-prefetch">` to the backend origin so the first `/api` call
doesn't pay full connection setup. The committed value is the **staging** origin
(matches the committed `_redirects`); `scripts/deploy-frontend-prod.sh` rewrites
it to the production origin in the deployed copy, exactly as it does the `/api/*`
proxy line.

## Cache-staleness tolerance

`/property`, `/gallery`, `/vehicle`, `/documents/*` are `max-age=300,
stale-while-revalidate=86400`; `/availability` is short. The frontend re-fetches
on each page load and never assumes a just-made admin change is instantly live
on the public site — treat a few minutes' staleness on the cacheable set as
normal.

## Webfonts

Self-hosted, committed under `assets/fonts/`:

| File | Family | Axis | Source |
|---|---|---|---|
| `fraunces-latin.woff2` (~66 KB) | Fraunces | variable weight 400–700, opsz 9–144 | Google Fonts latin subset |
| `inter-latin.woff2` (~47 KB) | Inter | variable weight 400–700 | Google Fonts latin subset |

Both families ship from Google as a single variable woff2 per subset (the
per-weight `css2` URLs resolve to the same file), so `fonts.css` declares one
`@font-face` per family with a `font-weight: 400 700` range rather than six
identical-content files. `font-display: swap`; if a file fails to load,
`tokens.css` falls back to Georgia (headings) / system-ui (body) with no layout
block and no third-party request. Licences: `OFL-Fraunces.txt`, `OFL-Inter.txt`
(SIL OFL 1.1) in the same directory. `test/smoke.mjs` asserts no
`/assets/fonts/*.woff2` request 404s and that both faces load.

## Before launch (not blocking — noted per backend)
- Wire the platform-level `/api/*` proxy and the `_redirects` rules on the host.

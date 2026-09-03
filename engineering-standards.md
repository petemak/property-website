# Engineering Standards

## Goals
- Simplest architecture that satisfies everything below — one
  service, one database, until something here demands more
- Maintainable by a single developer
- Accessible to WCAG 2.1 AA

## Architectural boundaries
- Business logic never lives only in the frontend — the server
  validates and enforces it; client-side logic is convenience
  only, never the source of truth
- Route/handler code stays thin; business logic lives in its
  own module, testable without going through HTTP
- Organize backend code by feature, not by technical layer —
  src/features/catalog/, src/features/checkout/, each owning
  its own logic end to end, rather than one controllers/
  folder and one services/ folder spanning the whole app
  (vertical slices). This also lowers collision risk if you
  ever split work across more than one backend teammate.
- Frontend never calls third-party APIs or holds secrets
  directly — always proxied through the backend
- Auth/authorization enforced server-side on every protected
  endpoint, never only by hiding a button in the UI
- One deployable frontend build. Do not split the UI into
  independently built and deployed fragments (micro-frontends)
  — that pattern earns its cost at a scale of multiple
  independent teams shipping on separate schedules, which is
  not this crew's situation regardless of how the site grows

## Technology restrictions
- One error response shape across every endpoint:
  { error: { code, message } }
- camelCase keys, ISO 8601 dates, consistently across all JSON
- Mutating endpoints (checkout, booking) must be idempotent —
  a retried request can't double-charge or double-book
- All external input validated at the API boundary, before it
  reaches business logic or the database
- No secrets or API keys hardcoded anywhere, including seed
  data — environment variables only
- Schema changes go through versioned migrations, never ad hoc
  changes run by whichever agent happens to need a column
- Structured error logging with real context, not scattered
  print statements

## Performance & delivery
- Static assets (HTML, CSS, JS, fonts, images) are served from
  the CDN edge, never proxied through the application origin.
  The backend serves JSON and does data work; it is not an
  image server for public traffic.
- Every image has a size budget: hero/full-view <= ~300 KB,
  gallery/thumbnail <= ~60 KB, at a sensible max dimension
  (~2000px full, ~800px thumb). Re-encode on ingest (seed and
  admin upload) — never ship a camera-original straight to the
  page. Grids use the thumbnail; the full-size image loads only
  on demand (lightbox). Below-the-fold images are lazy-loaded.
- Read-only GET endpoints whose data changes rarely
  (property/content, gallery, vehicle, legal documents) send
  Cache-Control so the CDN edge caches them (public, max-age in
  minutes, plus stale-while-revalidate). The frontend must
  tolerate slightly stale reads for these. Availability/quote
  get a short max-age; anything user-specific or mutating is
  no-store.
- Verify caching actually happens after deploy (edge cache hit,
  not fwd=miss) — a Cache-Control header the CDN ignores is not
  a cache.
- The homepage's first paint makes the minimum set of API calls;
  no fetching large ranges or full collections that aren't shown
  yet. Add rel=preconnect to the API origin.
- A single-region backend is fine to launch on, but the target
  audience is worldwide — treat backend region and (if needed)
  multi-region read replicas as a known scaling lever, not an
  afterthought.

## Non-negotiable vs guideline
- Non-negotiable: server-side validation and authorization, no
  hardcoded secrets, versioned migrations, idempotent mutations,
  no micro-frontends, static assets served from the CDN (not
  proxied through the origin), per-image size budgets
- Guideline, may deviate with a stated reason: vertical-slice
  folder structure, the specific error shape, the date format,
  the exact Cache-Control durations

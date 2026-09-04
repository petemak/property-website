# Kigali Keys — backend

Clojure API implementing `api-contract.md` (v1: booking-request, human approval,
no online payment). One service, one database (SQLite via next.jdbc + HikariCP),
vertical feature slices under `kigali/features/`.

## Run

```
clojure -M:run          # starts HTTP server on :PORT (default 3000)
clojure -M:test         # cognitect test-runner
clj-kondo --lint src
```

Migrations (migratus, `resources/migrations/`) and idempotent seed data run
automatically on startup.

### Media / seed images

On first run the seeder copies the owner-supplied photos from
`SEED_PHOTOS_DIR` (default `assets/property-photos/`, wired per that folder's
`MAPPING.md`) into `MEDIA_DIR`: gallery originals keep their source basenames,
thumbnails are generated with real dimensions read from the files, and the
approximate-location map is copied to `media/map/approx.png`. The
`exact-location.png` image is intentionally never copied into `MEDIA_DIR`, so it
is never reachable through `/api/media`. If any expected source file is missing,
that gallery row falls back to a neutral grey placeholder (logged as a warning);
this path is retained but should not trigger in normal operation.

## Environment variables

All configuration resolves from env vars via aero (`resources/config.edn`);
dev-only fallbacks are used when unset. No secret is hardcoded.

| Var | Purpose | Default |
|-----|---------|---------|
| `PORT`, `HTTP_HOST` | HTTP bind | `3000`, `0.0.0.0` |
| `DATABASE_URL` | JDBC URL | `jdbc:sqlite:kigali-keys.db` |
| `DB_POOL_SIZE` | Hikari pool size | `1` (SQLite is single-writer) |
| `TOKEN_SECRET` | HMAC secret for guest booking-status links | dev-only fallback |
| `SESSION_TTL_HOURS`, `SESSION_COOKIE_SECURE` | admin session cookie | `168`, `true` |
| `RATE_LIMIT_MAX` | requests / 60s / IP on rate-limited routes | `10` |
| `MEDIA_DIR` | gallery + static map storage | `media` |
| `SEED_PHOTOS_DIR` | source of owner photos for first-run seed | `assets/property-photos` |
| `ADMIN_INITIAL_EMAIL` / `ADMIN_INITIAL_NAME` / `ADMIN_INITIAL_PASSWORD` | seed the first owner (only when the password is set) | — |
| `MAIL_TRANSPORT` | `outbox` = record to `sent_emails`, never transmit; `smtp` = actually send, then record `sent`/`failed` | `outbox` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | SMTP server + credentials + envelope From (owner points these at Zoho Mail SMTP). Required when `MAIL_TRANSPORT=smtp` — startup fails fast if any of host/user/pass/from is missing | — / `465` / — / — / — |
| `SMTP_REPLY_TO` | optional `Reply-To` header | — |
| `SMTP_SSL` | implicit TLS (SMTPS, port 465). Set `false` for STARTTLS on 587 | `true` |

Mail: staging leaves `MAIL_TRANSPORT` unset (`outbox`) so it never sends. In
production the `SMTP_*` values are **Fly secrets** (`fly secrets set …`), and
`MAIL_TRANSPORT=smtp` is what flips transmission on — the SMTP code is inert
until then. Guest-path sends (booking create/approve/reject, contact,
admin-invite) run on a background single-thread executor so a slow SMTP server
can't hang a request; the `sent_emails` row's final `sent`/`failed` status
appears a moment after the response. The admin "send test" endpoint waits for
the real result.

## Layout

```
kigali/
  config.clj system.clj main.clj      component wiring + entrypoint
  db.clj server.clj email.clj seed.clj  components
  router.clj middleware.clj respond.clj  HTTP plumbing + single error shape
  pricing.clj sanitize.clj tokens.clj images.clj util.clj  pure helpers
  store.clj                            shared content/legal-doc persistence
  features/
    content availability quote vehicle gallery bookings
    agreements contact auth notifications settings media
```

Handlers are thin; business logic (quote maths, acceptance rules, availability
expansion, state-machine transitions) lives in testable functions.

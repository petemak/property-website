# API Contract — Kigali Keys

The concrete interface between the frontend and backend. Build both sides
against this without waiting on each other. If a change is needed, change this
file first.

Maps 1:1 to the "Dynamic content map" in design-spec.md §5.

**Versioning intent:** v1 is a booking-request site (a human approves every
booking, no online payment). v2 will add instant booking + online payment. This
contract is written so v2 is additive — see "Booking status state machine"
below and the "Notes for both teams" section. Anything marked *(v2)* is not
built in v1; it is documented only so the v1 build leaves the seam open.

---

## Conventions (apply to every endpoint)

- **Base path:** `/api`. All paths below are relative to it.
- **Format:** JSON request and response bodies; `Content-Type: application/json`
  (exception: `POST /admin/gallery` is `multipart/form-data`).
- **Keys:** `camelCase` everywhere.
- **Dates:** ISO 8601. Calendar dates as `YYYY-MM-DD` (e.g. `2026-09-05`).
  Timestamps as UTC `YYYY-MM-DDTHH:mm:ssZ`. All server-generated timestamps are
  UTC.
- **Money:** integer or decimal `amount` fields are in **major units** of
  `currency` (e.g. `140` = USD 140.00); always paired with a `currency` string
  (ISO 4217). No fractional cents needed for this business; use 2-dp decimals if
  a fee ever needs them.
- **Errors:** one shape, every endpoint, every non-2xx:
  ```json
  { "error": { "code": "machineReadableCode", "message": "Human sentence." } }
  ```
  `code` values used: `validationError`, `unauthorized`, `forbidden`,
  `notFound`, `dateConflict`, `agreementRequired`, `agreementVersionStale`,
  `rateLimited`, `idempotencyKeyMissing`, `idempotencyKeyConflict`,
  `alreadyDecided`, `conflict`, `internalError`. For `validationError` the
  `message` names the offending fields in plain language (a machine-readable
  field list is out of scope for v1 to keep the error shape single).
  `validationError` is returned with HTTP **422** everywhere (semantic
  validation failure); the endpoint sections below that say "400
  validationError" are shorthand for this. Clients branch on `code`, not the
  numeric status.
- **Validation:** every field below is validated server-side at the API
  boundary before any business logic runs. Client-side checks are convenience
  only. Lengths/enums noted where they matter.
- **Auth:** public endpoints need nothing. Every `/api/admin/*` endpoint except
  `auth/login` and `auth/session` requires a valid admin session cookie;
  owner-only endpoints additionally require `role = owner`. Enforced
  server-side on each request — never by UI alone. Missing/invalid session ->
  `401 unauthorized`. Valid session, insufficient role -> `403 forbidden`.
- **Sessions:** `POST /admin/auth/login` sets an `HttpOnly; Secure;
  SameSite=Lax` session cookie. No token in JSON, no localStorage.
- **Idempotency:** `POST /bookings`, `POST /admin/bookings/:id/approve`,
  `POST /admin/bookings/:id/reject` require an `Idempotency-Key` request header
  (client-generated UUID v4). The server stores `(key, route)` -> response for
  24h. A repeat within 24h returns the **stored** response with header
  `Idempotency-Replayed: true` and does **not** repeat side effects (no second
  booking, no second email, no second charge-equivalent). Same key with a
  different body -> `409 idempotencyKeyConflict`. Missing header on these routes
  -> `400 idempotencyKeyMissing`. This is deliberately in from day one: it is
  exactly the guarantee a *(v2)* payment / instant-confirm step needs to avoid
  double-charging or double-booking on a retry.
- **Rate limiting:** `POST /bookings`, `POST /contact`, `POST /admin/auth/login`
  are rate-limited per IP; exceeding -> `429 rateLimited`.
- **Pagination:** list endpoints take `?page` (1-based, default 1) and
  `?pageSize` (default 20, max 100); responses include
  `{ page, pageSize, total }`.
- **Third parties:** email delivery, map tiles/static images and image storage
  are called **only** from the backend. The frontend never holds those keys.
- **Caching:** read-only GETs whose data changes rarely — `GET /property`,
  `GET /gallery`, `GET /vehicle`, `GET /documents/:type/:version` — send
  `Cache-Control: public, max-age=300, stale-while-revalidate=86400` so the CDN
  edge serves them. `GET /availability` sends `public, max-age=120`. Everything
  authenticated, mutating, or guest-specific (`/bookings/:reference`, all
  `/admin/*`, `POST` routes) sends `Cache-Control: no-store`. Clients tolerate a
  few minutes' staleness on the cacheable set.
- **Media URLs:** image `url` / `thumbnailUrl` / `staticMapUrl` fields are
  CDN-relative. Seed images resolve to `/media/...` (served at rest from the
  frontend deploy's CDN, never proxied through the backend). Admin-uploaded
  images resolve to `/api/media/...` (proxied, long-cached) until image storage
  moves to an object store. The frontend uses whatever URL the API returns.
  `GET /gallery` may therefore return a mix of both prefixes in one list.
  - **Seed media filenames** (frontend bundles these under `public/media/`):
    - Gallery: `/media/gallery/<basename>.jpg` (full) and
      `/media/gallery/<basename>_thumb.jpg` (thumb), where `<basename>` is the
      owner's original stem, e.g. `front-yard.jpg` / `front-yard_thumb.jpg`.
      25 images. All re-encoded (progressive JPEG, <= 2000px / <= ~300 KB full,
      <= 800px / <= ~60 KB thumb).
    - Map: `/media/map/approx.jpg`. **CHANGED from `approx.png`** — the source
      map re-encodes ~10x smaller as a JPEG (856 KB PNG -> ~107 KB JPEG) and the
      standards' per-image budget is non-negotiable. Flagged for the frontend.
    - The backend produces these via `clojure -X:export-media` (writes straight
      into `src/frontend/public/media/`); the frontend commits + deploys them.
- **Unknown enum values:** clients must tolerate enum values they don't
  recognise (especially booking `status`) — render a neutral fallback, never
  throw. This is what lets a v1 frontend keep working when v2 adds states.

---

## Booking status state machine

`booking.status` is an explicit enumerated state machine. The backend is the
only writer of `status`; every transition is a specific action.

**v1 states and transitions:**

```
            submit (POST /bookings)
                     |
                     v
                 [pending] --------------------------> [expired]
                  |   |   \                    (no decision before check-in,
        approve   |   |    \  cancel             or a TTL job)
                  |   |     \ (guest via Contact, or admin)
                  v   |      \
           [approved] |       -> [cancelled]
                  |   |
                  |   -> reject
                  |        |
                  |        v
                  |   [rejected]
                  |
                  -> cancel (admin, after approval) -> [cancelled]
```

- `pending` — created, awaiting a human decision. (v1 default for every
  booking.)
- `approved` — a manager approved it; `approvalDetails` populated; dates
  optionally blocked.
- `rejected` — a manager declined it; `decision.explanation` populated.
- `cancelled` — withdrawn after creation (by admin; guest-initiated cancel is
  handled off-platform in v1 and recorded by an admin).
- `expired` — reserved for a future TTL / no-decision cleanup job. v1 may leave
  this unused, but clients must handle it.

**Reserved future state:**

- `confirmed` *(v2)* — an instant booking that auto-confirmed on successful
  payment, with no `pending` review step. Transition will be
  `pending -> confirmed` (payment succeeded) or a direct create-and-confirm.
  **v1 never emits `confirmed`.** Documented so v1 clients are written to
  accept it.

**Terminal states:** `rejected`, `cancelled`, `expired` (and `confirmed` in
v2). `approved` is terminal in v1 except for an admin `cancel`.

Clients: switch on known values, `default:` to a neutral "in progress" render.
Do not assume the set is closed.

---

## PUBLIC ENDPOINTS

### 1. `GET /property`

Everything the marketing pages render. Public, cacheable (~5 min).

**Response 200**
```json
{
  "name": "Kigali Keys",
  "tagline": "A furnished home in Kigali — with the keys to a car.",
  "summary": "Whole 2-bedroom duplex in a gated Kigali neighbourhood. Sleeps 4.",
  "description": "Full paragraphs of prose (safe subset of markdown).",
  "neighbourhood": "Rebero, Kigali",
  "neighbourhoodText": "Quiet, gated, upmarket residential. 10 minutes from the CBD.",
  "maxGuests": 4,
  "bedrooms": 2,
  "bathrooms": 2,
  "beds": [
    { "room": "Primary bedroom", "type": "King" },
    { "room": "Second bedroom", "type": "Queen" }
  ],
  "amenities": [
    { "key": "wifi", "label": "Fast wifi (100 Mbps)", "category": "work", "icon": "wifi" },
    { "key": "desk", "label": "Dedicated desk and chair", "category": "work", "icon": "desk" }
  ],
  "included": ["Water and electricity", "Backup power", "Weekly linen change", "24/7 gated security"],
  "notIncluded": ["Daily housekeeping", "Airport pickup unless arranged", "The car unless added to your booking"],
  "checkIn": {
    "fromTime": "14:00",
    "untilTime": "21:00",
    "method": "Self check-in with a lockbox",
    "processSteps": [
      "The host emails the exact address and lockbox code once your request is approved.",
      "Let the gate security know the booking name.",
      "Collect the keys from the lockbox by the front door."
    ],
    "publicPreview": "Self check-in from 14:00. Exact address is shared after approval."
  },
  "houseRulesSummary": ["No smoking indoors", "No parties or events", "Quiet hours 22:00–06:00", "Maximum 4 guests"],
  "bookingMode": "request",
  "location": {
    "approxLat": -1.9833,
    "approxLng": 30.1028,
    "showExactAddress": false,
    "staticMapUrl": "/media/map/approx.jpg",
    "pointsOfInterest": [
      { "name": "Kigali International Airport", "minutesByCar": 20, "km": 12, "category": "transport" },
      { "name": "City centre / CBD", "minutesByCar": 12, "km": 6, "category": "transport" },
      { "name": "Volcanoes National Park", "minutesByCar": 150, "km": 105, "category": "trip" }
    ]
  },
  "arrivalGuide": "Prose: airport transfer options and cost, SIM/eSIM, mobile money, currency, plugs, safety.",
  "gettingAroundWithoutCar": "Prose: moto and ride-hail apps, rough fares.",
  "faq": [
    { "question": "How fast is the wifi?", "answer": "Fibre, ~100 Mbps down, with a backup line." }
  ],
  "pricing": {
    "currency": "USD",
    "nightlyRate": 140,
    "cleaningFee": 35,
    "minNights": 3,
    "paymentNote": "No payment is taken on this site. The host confirms the final amount and payment method when approving your request.",
    "carNote": "The Kia Sorento is USD 45/day, arranged with your booking and paid on site."
  },
  "termsVersions": { "stayTerms": 3, "houseRules": 2 },
  "contact": {
    "hostName": "Peter",
    "email": "info@kigalikeys.rw",
    "phone": null,
    "responseTimeText": "Typically within 24–48 hours"
  },
  "updatedAt": "2026-08-20T09:00:00Z"
}
```

`contact` is the **public** contact block for the Contact page and the site
footer — a projection of the owner-editable Settings (`hostDisplayName`,
`publicEmail`, `publicPhone`, `guestResponseTimeText`). `phone` is `null` when no
public number is set; the frontend must render email-only in that case and must
not fall back to a hardcoded address. This is distinct from `GET
/admin/settings`, which stays owner-only and carries the full settings object.

`bookingMode` is `"request"` in v1 (every booking needs human approval). The
field exists so the frontend can branch its copy and, in v2, a value of
`"instant"` will tell it to render the payment step and instant-confirm wording
without any other contract change.

---

### 2. `GET /gallery`

**Response 200**
```json
{
  "leadImageId": "img_01",
  "images": [
    {
      "id": "img_01",
      "url": "/media/gallery/front-yard.jpg",
      "thumbnailUrl": "/media/gallery/front-yard_thumb.jpg",
      "alt": "Duplex exterior at dusk with the Kia Sorento parked in the gated driveway",
      "caption": "The house and the car, on the premises",
      "category": "Exterior & grounds",
      "width": 2000,
      "height": 1333,
      "position": 1
    },
    {
      "id": "img_44",
      "url": "/api/media/gallery/img_9f3a1c22.jpg",
      "thumbnailUrl": "/api/media/gallery/img_9f3a1c22_thumb.jpg",
      "alt": "Newly added photo uploaded by an admin",
      "caption": "Uploaded via the admin gallery screen",
      "category": "Living",
      "width": 2000,
      "height": 1333,
      "position": 26
    }
  ]
}
```
`category` is one of a fixed set defined in content: `Exterior & grounds`,
`Living`, `Kitchen`, `Bedroom 1`, `Bedroom 2`, `Bathrooms`, `Workspace`,
`The car`. `images` are sorted by `position` ascending. `url` prefix reflects
origin: seed images are `/media/...` (frontend CDN bundle), admin-uploaded
images are `/api/media/...` (backend-proxied) — see the "Media URLs" convention.

---

### 3. `GET /availability`

**Query:** `from` (YYYY-MM-DD, required), `to` (YYYY-MM-DD, required, max 400
days after `from`).

**Response 200**
```json
{
  "currency": "USD",
  "nightlyRate": 140,
  "cleaningFee": 35,
  "minNights": 3,
  "rangeStart": "2026-09-01",
  "rangeEnd": "2026-12-31",
  "unavailableDates": ["2026-09-10", "2026-09-11", "2026-09-12"],
  "carUnavailableDates": []
}
```
`unavailableDates` = nights that cannot be checked in for: dates covered by an
approved booking, or a manual admin block. Pending requests do **not** appear
here (the manager resolves overlaps at approval). `carUnavailableDates` =
nights the car is committed to another approved booking or marked off.

**Errors:** `422 validationError` (bad/oversized range).

---

### 4. `POST /quote`

Stateless price calculation. No persistence. Used by the booking widget and P5
rail.

The response is a **structured line-item breakdown with a real total** — it is
"authoritative-capable." In v1 the UI labels it an *estimate* (the binding
figure is entered by a human at approval, in §16). In v2, instant booking
treats the identical payload as the amount to charge; only the copy changes,
not the shape.

**Request**
```json
{
  "checkIn": "2026-09-05",
  "checkOut": "2026-09-12",
  "guests": 2,
  "car": { "requested": true, "pickUp": "2026-09-06", "dropOff": "2026-09-10" }
}
```
Rules: `checkOut` > `checkIn`; nights >= `minNights`; `guests` 1..`maxGuests`;
if `car.requested`, `pickUp` >= `checkIn` and `dropOff` <= `checkOut` and
`dropOff` > `pickUp`. Car days = calendar-day difference `dropOff - pickUp`.

**Response 200**
```json
{
  "currency": "USD",
  "nights": 7,
  "carDays": 4,
  "lineItems": [
    { "code": "accommodation", "label": "USD 140 x 7 nights", "amount": 980 },
    { "code": "cleaningFee", "label": "Cleaning fee", "amount": 35 },
    { "code": "carRental", "label": "Kia Sorento x 4 days (USD 45/day, paid on site)", "amount": 180 }
  ],
  "estimatedSubtotal": 1195,
  "estimatedTotal": 1195,
  "disclaimer": "Estimate only. The host confirms the final amount when approving your request. Car rental is paid on site."
}
```
When `car.requested` is false, the `carRental` line is omitted and `carDays` is
`0`. (`estimatedSubtotal` / `estimatedTotal` keep the `estimated` prefix in v1;
a v2 rename to `subtotal` / `total` is the only anticipated change and would be
additive — keep both for one release.)

**Errors:** `422 validationError`.

---

### 5. `GET /vehicle`

Car details plus the **current** published rental agreement.

**Response 200**
```json
{
  "offered": true,
  "name": "Kia Sorento",
  "year": 2019,
  "bodyType": "SUV",
  "transmission": "Automatic",
  "seats": 7,
  "fuel": "Diesel",
  "luggage": "3 large cases",
  "dailyRate": 45,
  "currency": "USD",
  "pickUpLocation": "On site at the property",
  "description": "Prose about the car.",
  "driverRequirements": [
    "Primary driver at least 23 years old",
    "Full driving licence held for at least 2 years",
    "Licence and passport presented at collection"
  ],
  "minDriverAge": 23,
  "minLicenceYears": 2,
  "covered": ["Third-party liability insurance", "Local breakdown assistance"],
  "notCovered": ["Damage excess up to USD 500", "Fuel", "Traffic fines", "Cross-border travel (not permitted)"],
  "depositAmount": 500,
  "geographicLimit": "Within Rwanda only",
  "agreement": {
    "type": "vehicleRentalAgreement",
    "version": 4,
    "effectiveDate": "2026-07-01",
    "publishedAt": "2026-06-28T14:00:00Z",
    "summaryPoints": [
      "You are responsible for damage up to the USD 500 excess.",
      "Return with the same fuel level.",
      "Rwanda only; no cross-border travel.",
      "Report any accident to the host and police within 24 hours."
    ],
    "bodyMarkdown": "# Kia Sorento Rental Agreement\n\n## 1. Parties ...",
    "bodyHash": "sha256:2b1c...e9"
  }
}
```
`agreement.version` and `agreement.bodyHash` are what the frontend must send
back in `POST /bookings` when the car is added. `bodyHash` is a SHA-256 of the
canonical `bodyMarkdown`, used to prove what text was shown.

`minDriverAge` and `minLicenceYears` are the numeric mirrors of the free-text
`driverRequirements[]` (set via `PUT /admin/vehicle`), exposed so the frontend
can render/hint the rule and do a soft client-side DOB check. Server-side
DOB/licence validation in `POST /bookings` remains authoritative. Clients must
tolerate these fields being absent.

---

### 6. `POST /bookings`

**Creates a booking.** (Not "creates a request" — the same endpoint serves
instant booking in v2. Whether a booking then waits for human approval or
auto-confirms is decided server-side from `property.bookingMode`, not by a
different URL.) In v1, `bookingMode` is `"request"`, so a new booking is created
with `status: "pending"` and the response reflects that.

As side effects on creation:
1. writes one **agreement acceptance record** per accepted document (always
   stay terms + house rules; plus the vehicle rental agreement when the car is
   added), each capturing who / when / which version / body hash / IP / user
   agent;
2. sends the `bookingReceived` email to the guest and the `adminNewBooking`
   alert to the notification recipients.

*(v2)* When `bookingMode` is `"instant"`, creation will instead return a
booking in a `pendingPayment`-style holding state and the client will call a
payment sub-resource (see "Notes for both teams" §6). v1 does not implement or
stub this — it is noted so the response's `status` field and the separation
between "money fields" and "who approved this" fields are designed for it now.

**Headers:** `Idempotency-Key: <uuid-v4>` (required).

**Request**
```json
{
  "guest": {
    "firstName": "Lena",
    "lastName": "Okafor",
    "email": "lena@example.com",
    "phone": "+2348012345678",
    "countryOfResidence": "NG",
    "purposeOfStay": "remoteWork"
  },
  "stay": {
    "checkIn": "2026-09-05",
    "checkOut": "2026-09-12",
    "adults": 2,
    "children": 0
  },
  "message": "Arriving around 19:00. Is early check-in possible?",
  "car": {
    "requested": true,
    "pickUp": "2026-09-06",
    "dropOff": "2026-09-10",
    "driver": {
      "fullName": "Lena Okafor",
      "dateOfBirth": "1990-04-12",
      "licenceNumber": "A1234567",
      "licenceCountry": "NG",
      "meetsRequirements": true
    }
  },
  "acceptances": [
    { "type": "stayTerms", "version": 3, "accepted": true },
    { "type": "houseRules", "version": 2, "accepted": true },
    { "type": "vehicleRentalAgreement", "version": 4, "bodyHash": "sha256:2b1c...e9", "accepted": true }
  ],
  "quoteEcho": { "estimatedTotal": 1195, "currency": "USD" }
}
```

**Validation**
- `guest.email` valid; `guest.firstName`/`lastName` 1..80; `phone` E.164-ish
  8..20; `countryOfResidence` ISO 3166-1 alpha-2; `purposeOfStay` in
  `remoteWork|leisure|business|relocation|other`.
- `stay`: `checkOut` > `checkIn`; nights >= `minNights`;
  `adults + children` in 1..`maxGuests`; `adults` >= 1; `checkIn` not in the
  past.
- `message` <= 2000 chars.
- `car.requested` boolean. If true: `pickUp`/`dropOff` within the stay and
  `dropOff` > `pickUp`; `driver.fullName` 1..120; `driver.dateOfBirth` implies
  age >= configured minimum; `driver.licenceNumber` 3..40;
  `driver.licenceCountry` alpha-2; `driver.meetsRequirements === true`.
- `acceptances` MUST contain `stayTerms` and `houseRules` with
  `accepted === true` and `version` equal to the server's current version.
  If `car.requested` is true it MUST also contain `vehicleRentalAgreement`
  with `accepted === true`, `version` === current vehicle agreement version,
  and `bodyHash` === current `agreement.bodyHash`.
  - Missing a required acceptance -> `422 agreementRequired`.
  - `version` behind the server's current -> `409 agreementVersionStale`
    (frontend should re-fetch and re-present the document).
  - `bodyHash` mismatch -> `409 agreementVersionStale`.
- `quoteEcho` is advisory only; the server recomputes and stores its own
  breakdown. A mismatch does not fail the request in v1 (the estimate is not
  binding) but is logged. *(v2 instant-book would reject a stale quote here.)*

**Response 201**
```json
{
  "reference": "KK-7F3Q2A",
  "status": "pending",
  "submittedAt": "2026-08-29T12:00:00Z",
  "stay": { "checkIn": "2026-09-05", "checkOut": "2026-09-12", "nights": 7, "adults": 2, "children": 0 },
  "car": { "requested": true, "pickUp": "2026-09-06", "dropOff": "2026-09-10", "driverName": "Lena Okafor" },
  "estimate": {
    "currency": "USD",
    "lineItems": [
      { "code": "accommodation", "label": "USD 140 x 7 nights", "amount": 980 },
      { "code": "cleaningFee", "label": "Cleaning fee", "amount": 35 },
      { "code": "carRental", "label": "Kia Sorento x 4 days (USD 45/day, paid on site)", "amount": 180 }
    ],
    "estimatedTotal": 1195
  },
  "acceptancesRecorded": [
    { "id": "acc_a1", "type": "stayTerms", "version": 3, "acceptedAt": "2026-08-29T12:00:00Z" },
    { "id": "acc_a2", "type": "houseRules", "version": 2, "acceptedAt": "2026-08-29T12:00:00Z" },
    { "id": "acc_a3", "type": "vehicleRentalAgreement", "version": 4, "acceptedAt": "2026-08-29T12:00:00Z" }
  ],
  "statusUrl": "/booking/KK-7F3Q2A",
  "statusTokenSent": true
}
```
- The response never echoes `driver.licenceNumber` or `driver.dateOfBirth`.
- `statusTokenSent`: the acknowledgement email contains a signed link
  (`/booking/KK-7F3Q2A?token=...`) so the guest can open the status page
  without re-entering their email.

**Errors:** `400 idempotencyKeyMissing`, `409 idempotencyKeyConflict`,
`422 validationError`, `422 agreementRequired`, `409 agreementVersionStale`,
`429 rateLimited`.

**Acceptance record (persisted, not all fields returned to the client)**
```json
{
  "id": "acc_a3",
  "bookingId": "bkg_88",
  "bookingReference": "KK-7F3Q2A",
  "type": "vehicleRentalAgreement",
  "version": 4,
  "bodyHash": "sha256:2b1c...e9",
  "acceptedByName": "Lena Okafor",
  "acceptedByEmail": "lena@example.com",
  "acceptedAt": "2026-08-29T12:00:00Z",
  "ipAddress": "102.22.x.x",
  "userAgent": "Mozilla/5.0 ...",
  "documentSnapshotId": "doc_v4"
}
```
`documentSnapshotId` points at the immutable stored body for that version, so
the exact accepted text is reproducible forever even after new versions
publish.

---

### 7. `GET /bookings/:reference`

**Auth:** either `?email=<the guest email>` OR `?token=<signed token from the
email>`. Neither/ wrong -> `404 notFound` (no distinction, to avoid leaking
which references exist).

`status` is one of the values in "Booking status state machine." Clients render
a neutral fallback for any unrecognised value.

**Response 200 — pending**
```json
{
  "reference": "KK-7F3Q2A",
  "status": "pending",
  "submittedAt": "2026-08-29T12:00:00Z",
  "stay": { "checkIn": "2026-09-05", "checkOut": "2026-09-12", "nights": 7, "adults": 2, "children": 0 },
  "car": { "requested": true, "pickUp": "2026-09-06", "dropOff": "2026-09-10" },
  "estimate": { "currency": "USD", "lineItems": [], "estimatedTotal": 1195 },
  "decision": null,
  "acceptedDocuments": [
    { "type": "stayTerms", "version": 3, "acceptedAt": "2026-08-29T12:00:00Z", "documentUrl": "/api/documents/stayTerms/3" },
    { "type": "houseRules", "version": 2, "acceptedAt": "2026-08-29T12:00:00Z", "documentUrl": "/api/documents/houseRules/2" },
    { "type": "vehicleRentalAgreement", "version": 4, "acceptedAt": "2026-08-29T12:00:00Z", "documentUrl": "/api/documents/vehicleRentalAgreement/4" }
  ]
}
```

**Response 200 — approved** (adds `decision` + `approvalDetails`)
```json
{
  "status": "approved",
  "decision": { "type": "approved", "decidedAt": "2026-08-30T08:15:00Z" },
  "approvalDetails": {
    "currency": "USD",
    "lineItems": [
      { "code": "accommodation", "label": "USD 140 x 7 nights", "amount": 980 },
      { "code": "cleaningFee", "label": "Cleaning fee", "amount": 35 },
      { "code": "carRental", "label": "Kia Sorento x 4 days (paid on site)", "amount": 180 }
    ],
    "total": 1195,
    "paymentInstructions": "Bank transfer 50% to confirm, balance on arrival. Details below.",
    "addressLine": "House 12, KG 5 Ave, Rebero, Kigali",
    "mapUrl": "https://maps.example/....",
    "checkInInstructions": "Lockbox code 4821. Gate security has your name...",
    "carCollection": "Keys handed over at the house on arrival; bring your licence and passport.",
    "hostContact": "Jean — +250 7xx xxx xxx / host@kigalikeys.rw",
    "note": "Welcome — message me your flight number and I'll have everything ready."
  }
}
```

**Response 200 — rejected**
```json
{
  "status": "rejected",
  "decision": {
    "type": "rejected",
    "decidedAt": "2026-08-30T08:15:00Z",
    "explanation": "Those dates are already committed to another guest. I'd be glad to host you 15–22 September if that works."
  }
}
```

`cancelled` / `expired` return the same envelope with `decision.type` set
accordingly and no `approvalDetails`.

---

### 8. `POST /contact`

**Request**
```json
{
  "name": "Sam Field",
  "email": "sam@example.com",
  "topic": "theCar",
  "bookingReference": "KK-7F3Q2A",
  "message": "Can two people be named as drivers?"
}
```
`topic` in `bookingQuestion|theCar|existingRequest|other`. `bookingReference`
optional, 0..20 chars. `message` 1..2000. Rate-limited.

**Response 202**
```json
{ "received": true }
```
Side effect: email to the host, `contactAck` email to the sender.

**Errors:** `422 validationError`, `429 rateLimited`.

---

### 9. `GET /documents/:type/:version`

Public read of a versioned legal/agreement document body (backs P8–P12 and the
"documentUrl" links). `type` in
`stayTerms|houseRules|websiteTerms|privacy|cancellationPolicy|vehicleRentalAgreement`.
`:version` may be `current` or an integer.

**Response 200**
```json
{
  "type": "vehicleRentalAgreement",
  "version": 4,
  "effectiveDate": "2026-07-01",
  "isCurrent": true,
  "bodyMarkdown": "# Kia Sorento Rental Agreement ...",
  "bodyHash": "sha256:2b1c...e9",
  "publishedAt": "2026-06-28T14:00:00Z"
}
```

---

### 10. `GET /api/media/...`

Backend-served static assets for **admin-uploaded** gallery images + thumbnails
only. Plain HTTP GET, no JSON. Sends `Cache-Control: public, max-age=31536000,
immutable` (filenames are content-unique `img_<hex>.jpg`). Listed so the
frontend knows these image URLs come from our origin, not a third-party bucket.

Seed images and the static map are **not** served here — they resolve to
`/media/...` and are served at rest from the frontend deploy's CDN (see "Media
URLs"). The application origin is not an image server for public traffic
(engineering-standards, "Performance & delivery").

---

## ADMIN ENDPOINTS

All require an admin session (see Conventions). Owner-only endpoints marked
**[owner]**.

### 11. `POST /admin/auth/login`
```json
// request
{ "email": "jean@kigalikeys.rw", "password": "••••••••" }
// response 200  (also Set-Cookie: session=...)
{ "user": { "id": "usr_1", "name": "Jean", "email": "jean@kigalikeys.rw", "role": "owner" } }
```
Bad credentials -> `401 unauthorized` (generic message). Rate-limited ->
`429 rateLimited`.

### 12. `POST /admin/auth/logout`
`204 No Content`, clears the cookie. Idempotent by nature (no key needed).

### 13. `GET /admin/auth/session`
```json
// 200
{ "user": { "id": "usr_1", "name": "Jean", "email": "jean@kigalikeys.rw", "role": "owner" } }
// 401 if no valid session
```

### 13b. `POST /admin/auth/accept-invite`

Consumes the single-use link from the `adminInvite` email (see §27). No session
required — this is how a newly invited admin gets one.
```json
// request
{ "token": "raw-token-from-the-email-link", "password": "new-password-min-10" }
// response 200  (also Set-Cookie: session=...)
{ "user": { "id": "usr_2", "name": "Aline", "email": "aline@kigalikeys.rw", "role": "admin" } }
```
`token` invalid / already used / expired -> `410 conflict` (code `conflict`,
message distinguishes). `password` fails policy -> `422 validationError`.
On success the user moves `invited -> active` and the token is burned.

### 14. `GET /admin/bookings`
**Query:** `status` (`pending|approved|rejected|cancelled|expired|all`, default
`pending`), `from`, `to` (filter on check-in date), `car` (`true|false`), `q`
(matches name/email/reference), `page`, `pageSize`.
```json
{
  "items": [
    {
      "id": "bkg_88",
      "reference": "KK-7F3Q2A",
      "guestName": "Lena Okafor",
      "guestEmail": "lena@example.com",
      "submittedAt": "2026-08-29T12:00:00Z",
      "checkIn": "2026-09-05",
      "checkOut": "2026-09-12",
      "nights": 7,
      "guests": 2,
      "carRequested": true,
      "status": "pending",
      "estimatedTotal": 1195,
      "currency": "USD"
    }
  ],
  "page": 1, "pageSize": 20, "total": 3
}
```

### 15. `GET /admin/bookings/:id`
Full record including PII and the full acceptance metadata.
```json
{
  "id": "bkg_88",
  "reference": "KK-7F3Q2A",
  "status": "pending",
  "submittedAt": "2026-08-29T12:00:00Z",
  "guest": {
    "firstName": "Lena", "lastName": "Okafor", "email": "lena@example.com",
    "phone": "+2348012345678", "countryOfResidence": "NG", "purposeOfStay": "remoteWork"
  },
  "stay": { "checkIn": "2026-09-05", "checkOut": "2026-09-12", "nights": 7, "adults": 2, "children": 0 },
  "message": "Arriving around 19:00...",
  "car": {
    "requested": true, "pickUp": "2026-09-06", "dropOff": "2026-09-10", "carDays": 4,
    "driver": {
      "fullName": "Lena Okafor", "dateOfBirth": "1990-04-12",
      "licenceNumber": "A1234567", "licenceCountry": "NG", "meetsRequirements": true
    }
  },
  "estimate": {
    "currency": "USD",
    "lineItems": [
      { "code": "accommodation", "label": "USD 140 x 7 nights", "amount": 980 },
      { "code": "cleaningFee", "label": "Cleaning fee", "amount": 35 },
      { "code": "carRental", "label": "Kia Sorento x 4 days", "amount": 180 }
    ],
    "estimatedTotal": 1195
  },
  "availabilityConflicts": [
    { "date": "2026-09-05", "reason": "manualBlock" }
  ],
  "acceptances": [
    {
      "id": "acc_a3", "type": "vehicleRentalAgreement", "version": 4,
      "bodyHash": "sha256:2b1c...e9",
      "acceptedByName": "Lena Okafor", "acceptedByEmail": "lena@example.com",
      "acceptedAt": "2026-08-29T12:00:00Z",
      "ipAddress": "102.22.x.x", "userAgent": "Mozilla/5.0 ...",
      "documentUrl": "/api/documents/vehicleRentalAgreement/4"
    }
  ],
  "decision": null,
  "activityLog": [
    { "at": "2026-08-29T12:00:00Z", "actor": "guest", "event": "submitted" }
  ]
}
```
`availabilityConflicts` is `[]` when the requested nights are all free.

### 16. `POST /admin/bookings/:id/approve`
**Headers:** `Idempotency-Key` required.
```json
// request
{
  "currency": "USD",
  "lineItems": [
    { "code": "accommodation", "label": "USD 140 x 7 nights", "amount": 980 },
    { "code": "cleaningFee", "label": "Cleaning fee", "amount": 35 },
    { "code": "carRental", "label": "Kia Sorento x 4 days (paid on site)", "amount": 180 }
  ],
  "total": 1195,
  "paymentInstructions": "Bank transfer 50% to confirm, balance on arrival...",
  "addressLine": "House 12, KG 5 Ave, Rebero, Kigali",
  "mapUrl": "https://maps.example/...",
  "checkInInstructions": "Lockbox code 4821...",
  "carCollection": "Keys handed over at the house on arrival...",
  "hostContact": "Jean — +250 7xx xxx xxx",
  "note": "Welcome — send me your flight number.",
  "blockDates": true,
  "blockCarDates": true
}
```
Validation: `lineItems[].amount` numeric; `total` equals the sum;
`checkInInstructions` and `addressLine` non-empty; `carCollection` required
when the booking has `car.requested`.

Behaviour: transitions `pending -> approved`, stores `approvalDetails`, if
`blockDates` marks those nights unavailable (and `blockCarDates` the car), sends
the `bookingApproved` email. If any requested night is already taken by another
**approved** booking -> `409 dateConflict` (with `{ error.message }` naming the
dates) unless the admin resubmits with `"blockDates": false` (host takes
responsibility for the overlap). Booking not in `pending` -> `409 alreadyDecided`
(unless the Idempotency-Key matches the original approve call, which replays the
stored `200`).

**Response 200:** the updated booking object (same shape as §15 with
`status: "approved"` and `decision` + `approvalDetails` populated).

### 17. `POST /admin/bookings/:id/reject`
**Headers:** `Idempotency-Key` required.
```json
// request
{
  "explanation": "Those dates are already committed to another guest. I'd be glad to host you 15–22 September.",
  "internalNote": "Repeat enquirer — worth following up."
}
```
`explanation` required, 20..1500 chars — goes verbatim into the
`bookingRejected` email. `internalNote` optional, not sent to the guest.

Behaviour: transitions `pending -> rejected`, stores the explanation, sends
`bookingRejected`. Not in `pending` -> `409 alreadyDecided` (or replay on
matching key).

**Response 200:** updated booking object with `status: "rejected"` and
`decision.explanation`.

> An admin `cancel` action (`approved -> cancelled`, or `pending -> cancelled`)
> is expected but low-priority for v1; if built it follows the same
> idempotent-POST pattern (`POST /admin/bookings/:id/cancel` with
> `{ reason }`). Not required for the v1 launch; listed so the state machine is
> complete.

### 18. Availability blocks
```
GET    /admin/availability/blocks?from=&to=
POST   /admin/availability/blocks
DELETE /admin/availability/blocks/:id
```
```json
// GET 200
{
  "blocks": [
    { "id": "blk_3", "start": "2026-09-10", "end": "2026-09-13", "reason": "Owner staying", "source": "manual" },
    { "id": "blk_b88", "start": "2026-09-05", "end": "2026-09-12", "reason": "Booking KK-7F3Q2A", "source": "booking", "bookingReference": "KK-7F3Q2A" }
  ]
}
// POST request
{ "start": "2026-10-01", "end": "2026-10-05", "reason": "Maintenance" }
// POST 201
{ "id": "blk_9", "start": "2026-10-01", "end": "2026-10-05", "reason": "Maintenance", "source": "manual" }
```
`end` is exclusive (checkout day). `POST` overlapping an existing approved
booking -> `409 dateConflict`. `DELETE` on a `source: "booking"` block ->
`403 forbidden` (remove by rejecting/cancelling the booking instead).
`DELETE` -> `204`.

### 19. Pricing
```
GET /admin/pricing
PUT /admin/pricing
```
```json
// GET / PUT body / PUT 200
{ "currency": "USD", "nightlyRate": 140, "cleaningFee": 35, "minNights": 3 }
```
`currency` is read-only on `PUT` (change via settings). `nightlyRate` > 0,
`cleaningFee` >= 0, `minNights` 1..30. Takes effect immediately for new quotes
and requests.

### 20. Property content
```
GET /admin/property   // same shape as GET /property plus draft/meta fields
PUT /admin/property    // full replace of the editable content object
```
`PUT` request body = the editable subset (everything in `GET /property` except
`pricing`, `termsVersions`, `bookingMode`, `updatedAt`, which are managed
elsewhere). Server validates: `maxGuests` 1..16, `bedrooms`/`bathrooms` 0..20,
`amenities[].key` unique, POI `minutesByCar` >= 0, all prose fields <= 20000
chars, markdown sanitised to a safe subset server-side. **Response 200:**
updated object with new `updatedAt`.

### 21. Gallery management
```
GET    /admin/gallery
POST   /admin/gallery          // multipart/form-data: file, alt, caption, category
PATCH  /admin/gallery/:id      // { alt?, caption?, category?, position? }
DELETE /admin/gallery/:id
PUT    /admin/gallery/order    // { "orderedIds": ["img_03","img_01",...] }
POST   /admin/gallery/lead     // { "imageId": "img_03" }
```
`POST`: `file` must be jpg/png/webp, max 12 MB (enforced server-side), `alt`
required 1..250, `category` in the fixed set. Server **re-encodes on ingest** —
the camera-original is never served: it is downscaled (<= ~2000px long edge) and
written as a progressive JPEG within the ~300 KB budget, with a <= ~800px /
~60 KB thumbnail. Server reads final `width`/`height`, appends at the end of
`position` order. The stored files are served from the backend under
`/api/media/gallery/...` (origin `upload`). **201** returns the created image
object (§2 shape, with the `/api/media/...` prefix). `PATCH`/`lead` -> `200`.
`DELETE` -> `204` (refuses if it is the only image or the lead image without a
replacement -> `409 conflict`).

### 22. Vehicle details
```
GET /admin/vehicle    // GET /vehicle shape + version history
PUT /admin/vehicle
```
```json
// PUT request
{
  "offered": true,
  "name": "Kia Sorento", "year": 2019, "bodyType": "SUV", "transmission": "Automatic",
  "seats": 7, "fuel": "Diesel", "luggage": "3 large cases",
  "dailyRate": 45, "description": "...",
  "driverRequirements": ["..."], "covered": ["..."], "notCovered": ["..."],
  "depositAmount": 500, "geographicLimit": "Within Rwanda only",
  "minDriverAge": 23, "minLicenceYears": 2
}
```
`dailyRate` > 0. Does **not** touch the agreement text. **200:** updated object.

### 23. Vehicle rental agreement versions
```
GET  /admin/vehicle/agreement/versions
POST /admin/vehicle/agreement
```
```json
// GET 200
{
  "versions": [
    { "version": 4, "effectiveDate": "2026-07-01", "publishedAt": "2026-06-28T14:00:00Z", "publishedBy": "Jean", "acceptanceCount": 12, "isCurrent": true },
    { "version": 3, "effectiveDate": "2026-01-01", "publishedAt": "2025-12-20T10:00:00Z", "publishedBy": "Jean", "acceptanceCount": 41, "isCurrent": false }
  ]
}
// POST request
{ "bodyMarkdown": "# Kia Sorento Rental Agreement ...", "summaryPoints": ["...", "..."], "effectiveDate": "2026-10-01" }
// POST 201
{ "version": 5, "effectiveDate": "2026-10-01", "publishedAt": "2026-08-29T13:00:00Z", "bodyHash": "sha256:...", "isCurrent": true }
```
Publishing creates a new **immutable** version and makes it current. Prior
versions and every acceptance that referenced them are untouched.
`bodyMarkdown` 200..50000 chars, sanitised server-side. `effectiveDate` today
or later. Same mechanism (`POST /admin/documents/:type` below) can serve
`stayTerms`, `houseRules`, `websiteTerms`, `privacy`, `cancellationPolicy`.

### 24. Legal document versions (generic)
```
GET  /admin/documents/:type/versions
POST /admin/documents/:type            // { bodyMarkdown, effectiveDate, summaryPoints? }
```
Same semantics as §23. `:type` in
`stayTerms|houseRules|websiteTerms|privacy|cancellationPolicy`. Publishing
`stayTerms` or `houseRules` bumps `termsVersions` in `GET /property`, so P5 will
present and require the new version on the next visit.

### 25. Agreement acceptance audit log
```
GET /admin/agreement-acceptances
GET /admin/agreement-acceptances/:id
```
**Query:** `type`
(`stayTerms|houseRules|vehicleRentalAgreement`), `version`, `from`, `to`,
`email`, `bookingReference`, `page`, `pageSize`.
```json
// list 200
{
  "items": [
    {
      "id": "acc_a3", "bookingReference": "KK-7F3Q2A", "bookingId": "bkg_88",
      "type": "vehicleRentalAgreement", "version": 4, "bodyHash": "sha256:2b1c...e9",
      "acceptedByName": "Lena Okafor", "acceptedByEmail": "lena@example.com",
      "acceptedAt": "2026-08-29T12:00:00Z",
      "ipAddress": "102.22.x.x", "userAgent": "Mozilla/5.0 ..."
    }
  ],
  "page": 1, "pageSize": 20, "total": 12
}
// :id 200  — adds the exact document text as accepted
{
  "id": "acc_a3",
  "... all list fields ...": "...",
  "documentSnapshot": {
    "type": "vehicleRentalAgreement", "version": 4,
    "effectiveDate": "2026-07-01",
    "bodyMarkdown": "# Kia Sorento Rental Agreement ...",
    "bodyHash": "sha256:2b1c...e9"
  }
}
```
Read-only. There is no write endpoint here — acceptances are created **only**
as a side effect of `POST /bookings`. This log is the backing store for
design-spec A8 and for the "accepted documents" blocks on P6 and A3.

### 26. Email templates
```
GET  /admin/email-templates
GET  /admin/email-templates/:key
PUT  /admin/email-templates/:key
POST /admin/email-templates/:key/preview
POST /admin/email-templates/:key/test
```
`:key` in
`bookingReceived|bookingApproved|bookingRejected|adminNewBooking|contactAck|adminInvite`.
```json
// GET :key 200
{
  "key": "bookingApproved",
  "subject": "Your Kigali Keys stay is confirmed — {{bookingReference}}",
  "bodyMarkdown": "Hi {{guestFirstName}},\n\nGreat news ...\n\n{{priceBreakdown}}\n\n{{checkInInstructions}}",
  "availableTokens": ["guestFirstName", "bookingReference", "stayDates", "priceBreakdown", "checkInInstructions", "addressLine", "hostContact", "rejectionExplanation", "statusUrl"],
  "updatedAt": "2026-08-01T00:00:00Z"
}
// PUT request
{ "subject": "...", "bodyMarkdown": "..." }
// preview request
{ "sampleContext": { "guestFirstName": "Lena", "bookingReference": "KK-DEMO12" } }
// preview 200
{ "subject": "Your Kigali Keys stay is confirmed — KK-DEMO12", "html": "<!doctype html>..." }
```
`PUT` validates that every `{{token}}` used exists in `availableTokens` ->
otherwise `422 validationError`. The brand wrapper (logo, colours, footer) is
applied server-side and is not part of `bodyMarkdown`.

`test` sends the rendered email to the signed-in admin's address and now
**reports the transport result** (previously a bare `202`):
```json
// POST :key/test  200
{ "sent": true, "to": "admin@kigalikeys.rw", "status": "sent" }
// on transport failure — still 200, with an error string
{ "sent": false, "to": "admin@kigalikeys.rw", "status": "failed", "error": "Connection refused" }
```
`status` is the §26b `sent_emails` status: `"stored"` on the default outbox
transport (recorded, not transmitted — `sent` is still `true`), `"sent"` or
`"failed"` when `MAIL_TRANSPORT=smtp`. The endpoint waits for the real send
result before responding even though guest-path sends are asynchronous.

### 26b. Sent-email log (outbox)

Read-only view of every email the system has generated. In v1 the transport is
"store & log" — the backend writes each message to a `sent_emails` table and does
not transmit it; a real provider slots in later behind the same interface and
then also reports delivery. This log is how an admin confirms what went out (and,
in v2 with a real provider, whether it was delivered).

```
GET /admin/sent-emails
GET /admin/sent-emails/:id
```

**`GET /admin/sent-emails`** — **[owner + admin]**
**Query:** `templateKey` — one of the §26 keys, or the sentinel `none` to filter
to messages with no template (`templateKey: null` in the response) — `q` (matches
`toAddress` / `subject` / `bookingReference`), `from`, `to` (ISO date, filter on
`createdAt`), `page`, `pageSize`.
```json
{
  "items": [
    {
      "id": "eml_8Q2A7F",
      "toAddress": "lena@example.com",
      "templateKey": "bookingApproved",
      "subject": "Your Kigali Keys stay is confirmed — KK-7F3Q2A",
      "bookingReference": "KK-7F3Q2A",
      "status": "stored",
      "createdAt": "2026-09-01T10:30:00Z"
    }
  ],
  "page": 1, "pageSize": 20, "total": 42
}
```
`bookingReference` is `null` for emails not tied to a booking (e.g.
`contactAck`, `adminInvite`). `templateKey` is `null` for messages sent without a
template (the direct new-request notification to the host's own address) — render
these with a neutral label such as "Direct message". `status` is an open enum.
With the default `MAIL_TRANSPORT=outbox` v1 only ever emits `"stored"` (written
to the outbox, not transmitted). With `MAIL_TRANSPORT=smtp` v1 also emits
`"sent"` (accepted by the SMTP server) and `"failed"` (the send threw; the row
is still recorded, the booking/contact request still succeeded). `queued |
delivered | bounced` remain reserved for a future provider with delivery
webhooks. Clients must render an unrecognised status as a neutral label, never
throw.

**`GET /admin/sent-emails/:id`** — **[owner + admin]**
```json
{
  "id": "eml_8Q2A7F",
  "toAddress": "lena@example.com",
  "templateKey": "bookingApproved",
  "bookingReference": "KK-7F3Q2A",
  "subject": "Your Kigali Keys stay is confirmed — KK-7F3Q2A",
  "html": "<!doctype html>… fully rendered, brand-wrapped …",
  "status": "stored",
  "createdAt": "2026-09-01T10:30:00Z"
}
```
`html` is the exact rendered body that was stored (brand wrapper applied). No
write endpoints — the log is a side effect of the system sending mail, never
created directly. Unknown `:id` → `404 notFound`.

### 27. Administrator accounts **[owner]**
```
GET    /admin/users
POST   /admin/users                    // { name, email, role }
PATCH  /admin/users/:id                 // { role?, status? }
DELETE /admin/users/:id
POST   /admin/users/:id/resend-invite
```
```json
// GET 200
{
  "users": [
    { "id": "usr_1", "name": "Jean", "email": "jean@kigalikeys.rw", "role": "owner", "status": "active", "lastLoginAt": "2026-08-29T07:00:00Z" },
    { "id": "usr_2", "name": "Aline", "email": "aline@kigalikeys.rw", "role": "admin", "status": "invited", "lastLoginAt": null }
  ]
}
```
`role` in `owner|admin`. `status` in `active|invited|disabled` (settable:
`active`/`disabled` only). `POST` creates the user in `invited` state and sends
`adminInvite` with a single-use set-password link; the link is consumed via
`POST /admin/auth/accept-invite` (§13b). Guards -> `409 conflict`:
cannot demote or disable or delete the last `owner`; cannot disable/delete
yourself; duplicate email.

### 28. Settings **[owner]**
```
GET /admin/settings
PUT /admin/settings
```
```json
{
  "hostDisplayName": "Jean at Kigali Keys",
  "publicEmail": "host@kigalikeys.rw",
  "publicPhone": "+250 7xx xxx xxx",
  "newRequestNotificationEmails": ["jean@kigalikeys.rw", "aline@kigalikeys.rw"],
  "timezone": "Africa/Kigali",
  "currency": "USD",
  "approxLat": -1.9833,
  "approxLng": 30.1028,
  "revealExactAddressAfterApproval": true,
  "guestResponseTimeText": "Typically within 24–48 hours"
}
```
`currency` ISO 4217; `timezone` IANA; emails all valid. **200:** updated
object. *(v2: `bookingMode` would become editable here — `"request"` vs
`"instant"` — which is the single switch that turns on the payment flow.)*

---

## Endpoint-to-feature index (for vertical-slice backend structure)

| Feature slice | Endpoints |
|---------------|-----------|
| `content` | 1, 9, 20, 24 |
| `gallery` | 2, 10, 21 |
| `availability` | 3, 18, 19 |
| `quote` | 4 |
| `vehicle` | 5, 22, 23 |
| `bookings` | 6, 7, 14, 15, 16, 17 |
| `agreements` | 25 (+ the write side-effect inside `bookings` §6) |
| `contact` | 8 |
| `auth` | 11, 12, 13, 27 |
| `notifications` | 26 (+ send calls invoked by `bookings`, `contact`, `auth`) |
| `settings` | 28 |
| `payments` *(v2 only — not built in v1)* | would be its own slice; see note 6 |

---

## Notes for both teams

1. **The acceptance write is not optional.** `POST /bookings` MUST persist an
   acceptance row per accepted document with the fields in §6, or the
   "customer agreements" scope category is unimplemented regardless of what the
   UI renders. §25 has no POST on purpose — the only way a row appears is
   through a real booking submission.
2. **Idempotency before anything else** on §6, §16, §17 — wire the key store
   first so retries during development don't create duplicate bookings/emails.
   Same store serves a v2 payment step.
3. **The breakdown from `POST /quote` is structured and total-bearing.** v1
   copy calls it an estimate; the only binding v1 figures are in
   `approvalDetails` (§16), entered by a human. v2 instant-book reuses the quote
   payload as-is as the charge amount — do not build `quote` as throwaway
   display text.
4. **Address privacy.** Exact `addressLine` / real `mapUrl` are only ever in
   `approvalDetails` (§7 approved, §16). Public endpoints expose approximate
   coordinates only.
5. **Licence data is sensitive.** `driver.licenceNumber` and `dateOfBirth` are
   accepted in §6, stored, shown only in §15 to authenticated admins, and never
   returned on public endpoints. Reflect this in the privacy policy (P9).
6. **Where the *(v2)* payment step attaches — do NOT build this in v1, no
   stub, no dead route.** The design leaves room for it as a sub-resource of an
   existing booking:
   - `POST /api/bookings/:id/payment` (idempotent, same key mechanism) creates
     a payment intent against a booking and, on provider success (via a
     backend webhook — frontend never talks to the processor, per
     engineering-standards), transitions the booking `pending -> confirmed`.
   - `GET /api/bookings/:id/payment` for status polling / the confirmation
     page.
   - The booking resource is already shaped for this: `status` is an explicit
     state machine with `confirmed` reserved; money lives in `estimate` /
     `approvalDetails` line items separate from the `decision` (who-approved)
     fields; `bookingMode` on the property is the switch. Nothing in v1 needs
     to change to add this — that is the whole point of the seam.
7. **Unknown `status` handling** is a client requirement, not a nicety — see
   "Booking status state machine." A v1 frontend that `throw`s on an
   unrecognised status will break the day v2 ships `confirmed`.

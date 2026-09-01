# Design Spec — Kigali Keys

Turns brand-brief.md into a buildable design, within the limits of
engineering-standards.md. Read scope-checklist.md first — every category marked
"applies" there has a page or section here.

Companion files:
- api-contract.md — every dynamic piece below maps to endpoints there.
- user-journeys.md — how a real person moves across these pages.

**Versioning (see scope-checklist.md "Future direction / extensibility"):**
v1 is a booking-request site — no online payment, a human approves every
booking. v2 will add instant booking + online payment. This spec builds v1 only,
but flags the copy and the one wizard seam that change for v2, so v1 is not
built in a way that has to be torn out. Look for **[v1-only copy]** and
**[v2 seam]** markers.

---

## 0. Design foundations

**Brand application** (from brand-brief.md, not re-argued here)

- Colours: Hill Green `#1F5B4E` (structure, trust, headers, links), Savanna Clay
  `#D97A45` (primary actions only — one clay button per view where possible),
  Warm Charcoal `#2B2A28` (body text, UI framing), Bone `#FAF7F2` (page
  background). White `#FFFFFF` for cards raised off the bone canvas.
- Type: Fraunces for the wordmark, page titles, section headers. Inter for body,
  labels, tables, form fields. Fallbacks `Georgia, serif` and
  `system-ui, sans-serif`. Self-host both (woff2) or use Google Fonts with
  `font-display: swap`; either way the request must be proxied/served by us, not
  a client call to a third-party API for data (fonts are a static asset, this is
  fine).
- Photography does the emotional work: large, edge-to-edge, generous whitespace,
  no superlative copy. Every image needs alt text (WCAG).
- Voice in all UI copy: warm, precise, confident, grounded. Concrete numbers
  (minutes, USD, bed sizes). No "nestled in paradise."

**Accessibility (WCAG 2.1 AA — a hard goal in engineering-standards)**

- Contrast: charcoal on bone and white passes. White on Hill Green passes. Clay
  `#D97A45` does **not** pass for normal-size text with white or charcoal on
  top — so clay is used as a button *fill with charcoal text at >=16px bold* (be
  sure this hits 4.5:1; if it does not in final tokens, darken the action colour
  to `#C25E2C` for text-bearing surfaces and keep `#D97A45` for large decorative
  fills). Never use clay for body text or thin icons on bone.
- All interactive elements keyboard reachable, visible focus ring (2px Hill
  Green outline, offset 2px).
- Forms: every field has a persistent visible `<label>`, errors are text (not
  colour alone) and are linked to the field via `aria-describedby`.
- Date picker: operable by keyboard, announces selected range.
- Gallery lightbox: focus trapped while open, Esc closes, returns focus to the
  trigger thumbnail.
- Motion: respect `prefers-reduced-motion`; no parallax or autoplay.
- Target: single responsive breakpoint set — mobile-first (base), tablet
  >=768px, desktop >=1080px. One deployable frontend build (no
  micro-frontends).

**Global chrome**

- Header/nav on every public page. Footer on every public page. Admin uses its
  own shell (sidebar + top bar), never the public header.

---

## 1. Page list

### Public

| # | Route | Page | Primary job |
|---|-------|------|-------------|
| P1 | `/` | Home / the property | Sell the stay; get the guest to pick dates |
| P2 | `/gallery` | Photo gallery | Full set of house + car photos |
| P3 | `/the-car` | The Kia Sorento | Explain the car add-on, rate, rules, agreement |
| P4 | `/location` | Location & getting around | Map, travel times, arrival logistics |
| P5 | `/book` | Request to book (multi-step) | Capture dates, guest, car, acceptances, submit |
| P6 | `/booking/:reference` | Booking status | Show pending / approved / rejected + details |
| P7 | `/contact` | Contact the host | Questions before booking |
| P8 | `/terms` | Website terms of use | Static legal |
| P9 | `/privacy` | Privacy policy | Static legal — what guest data we hold |
| P10 | `/house-rules` | House rules | Static; also surfaced in the booking flow |
| P11 | `/cancellation-policy` | Cancellation & stay terms | Static; also surfaced in the booking flow |
| P12 | `/vehicle-rental-agreement` | Kia Sorento Rental Agreement (reference copy) | Public read-only copy of the current version |
| P13 | `*` | Not found (404) | Recovery |

### Admin (all behind login; see scope-checklist "Accounts / auth")

| # | Route | Page | Who |
|---|-------|------|-----|
| A0 | `/admin/login` | Sign in | owner + admins |
| A1 | `/admin` | Dashboard | owner + admins |
| A2 | `/admin/bookings` | Booking queue (list + filters) | owner + admins |
| A3 | `/admin/bookings/:id` | Booking detail — approve / reject | owner + admins |
| A4 | `/admin/availability` | Calendar — block/open dates, set pricing | owner + admins |
| A5 | `/admin/content` | Edit property text (description, amenities, check-in, FAQ, arrival guide) | owner + admins |
| A6 | `/admin/gallery` | Manage photos (upload, caption, alt, reorder, delete) | owner + admins |
| A7 | `/admin/vehicle` | Edit car details + daily rate + publish agreement versions | owner + admins |
| A8 | `/admin/agreements` | Agreement acceptance log (audit) | owner + admins |
| A9 | `/admin/emails` | Edit + preview email templates | owner + admins |
| A10 | `/admin/users` | Manage administrator accounts | **owner only** |
| A11 | `/admin/settings` | Host contact details, site defaults | **owner only** |

---

## 2. Public pages — sections

Layout notes are rough on purpose: enough to build from, not pixel specs.

### P1 — Home (`/`)

Single scrolling page, Airbnb-style, with a sticky booking widget. Dynamic
content comes from `GET /api/property`, `GET /api/gallery`, `GET
/api/availability`.

1. **Header / nav** (component: `SiteHeader`)
   - Left: the logo mark then the "Kigali Keys" wordmark (Fraunces), as one
     link to home. The mark precedes the wordmark: a Rwandan beehive-house
     silhouette with a keyhole doorway, drawn in `currentColor` (~1.1em tall)
     so it takes the wordmark's colour in both header states. The wordmark
     must read clearly as the brand: noticeably larger than the nav links
     beside it (target ~`--fs-800`, weight 600–700), not near-parity with
     them. Right: links — The home, The car, Location, Contact. On desktop a
     compact "Check dates" clay button; on mobile a hamburger.
   - Transparent over the hero, switches to solid Bone with charcoal text once
     scrolled past the hero.

2. **Hero**
   - Purpose: one image, one sentence, the core facts, one action.
   - Content: full-bleed lead photo of the duplex exterior (with the Sorento
     visible if a good shot exists). Overlaid: tagline "Keys to a furnished home
     in Kigali — and to the car outside." Sub-line: neighbourhood, "Whole 2-bed
     duplex · sleeps 4 · gated." A `BookingWidget` card (dates + guests +
     "Check availability").
   - Layout: image fills viewport height on desktop (min 520px), text block
     bottom-left, widget bottom-right on desktop / stacked under text on mobile.

3. **At a glance** (component: `FactRow`)
   - Purpose: Booking.com-style scannable facts.
   - Content: 4–6 icon+label pairs — Bedrooms 2 · Bathrooms 2 · Max guests 4 ·
     Fast fibre wifi (100 Mbps) · Dining table doubles as a workspace · Kia
     Sorento on site (USD 45 a day).
   - Layout: horizontal wrapping grid of small cells, one row desktop, 2-up
     mobile.

4. **The home** (narrative + gallery preview)
   - Purpose: what the place actually is, in full sentences.
   - Content: 2–3 short paragraphs from `property.description`. Beside/under it a
     3–5 image `GalleryPreview` strip; "See all N photos" opens P2 / lightbox.
   - Layout: text column + image mosaic on desktop; stacked on mobile.

5. **What's included / what's not** (component: `IncludedTable`)
   - Purpose: kill ambiguity (Booking.com borrow).
   - Content: two columns — Included (wifi, workspace, equipped kitchen, weekly
     linen change, water/electricity, backup power, security) vs Not included
     (daily housekeeping, airport pickup unless arranged, the car unless added,
     early check-in).
   - Layout: two lists side by side desktop, stacked mobile, check/cross icons
     with text labels (not colour alone).

6. **Amenities** (component: `AmenityGrid`)
   - Content: `property.amenities` grouped (Work, Kitchen, Comfort, Building,
     Safety) with an icon each.
   - Layout: responsive grid, "Show all amenities" disclosure if long.

7. **The car — teaser**
   - Purpose: lead into the differentiator without repeating P3.
   - Content: one photo of the Sorento, 2 sentences, specs chips (SUV ·
     automatic · 7 seats · $45/day · collected on site), "How the car works"
     link to P3.
   - Layout: image left / text right desktop, stacked mobile. One secondary
     (outline) button, not clay — the clay action on this page is Book.

8. **Location & getting around — teaser** (component: `MiniMap`)
   - Purpose: Booking.com "map + travel times" borrow.
   - Content: static map image centred on an *approximate* pin (exact address
     only after approval — see `property.location.showExactAddress`), plus
     a `TravelTimeList`: Kigali airport 20 min, city centre / CBD 12 min,
     nearest supermarket 5 min, Volcanoes NP ~2h 30m, Lake Kivu ~3h. "Full
     location details" link to P4.
   - Layout: map panel + list beside it desktop; map above list mobile.

9. **Check-in & house rules** (component: `StepList` + rules list)
   - Purpose: set expectations early (Vrbo borrow).
   - Content: check-in window (e.g. "from 14:00, self check-in via lockbox"),
     3–5 numbered arrival steps from `property.checkIn.processSteps`, key house
     rules (no smoking indoors, no parties, quiet hours 22:00–06:00, max 4
     guests), link to full P10 and P11.
   - Layout: numbered vertical steps; rules as a short bulleted list beneath.

10. **Pricing** (component: `PriceBreakdown`)
    - Purpose: upfront, honest numbers — no manufactured urgency.
    - Content: nightly rate, cleaning fee, minimum nights, car add-on rate,
      note that the total is confirmed by the host on approval and the car is
      paid on site. If the guest has already chosen dates in the widget, show
      the live breakdown from `POST /api/quote`.
    - **[v1-only copy]** The heading/label "Estimate", the disclaimer "The host
      confirms the final amount when approving your request", and "No payment is
      taken on this site" all come from `property.pricing.paymentNote` /
      `quote.disclaimer`. In v2 (instant booking) the same `PriceBreakdown`
      component renders the same line items as the amount to pay now, and this
      copy is replaced with a checkout summary — no layout change, only text and
      the added CTA. Build `PriceBreakdown` with a `mode` prop
      (`"estimate" | "final"`) so the switch is a prop, not a rewrite.
    - Layout: simple 2-column money table, total row emphasised, explanatory
      note below in smaller text.

11. **FAQ** (component: `Accordion`)
    - Content: `property.faq` — wifi speed, workspace, laundry, pets, children,
      extra guests, parking, payment method, cancellation, long-stay discounts.
    - Layout: single-column accordion, one open at a time, all expandable by
      keyboard.

12. **Booking call-to-action band**
    - Content: dates + guests + clay "Request to book" -> P5.
    - **[v1-only copy]** The reassurance line "Send a request — no charge until
      the host confirms." is v1 wording. Source it from a single copy
      constant (e.g. `bookingCtaReassurance`) keyed off `property.bookingMode`
      so v2's `"instant"` mode swaps in "Book instantly — pay now, keys are
      yours" without touching the band's markup. Button label likewise:
      "Request to book" (v1) vs "Book now" (v2).
    - Layout: full-width Hill Green band, centred content.

13. **Footer** (component: `SiteFooter`)
    - Content: wordmark + one-line description; columns — Explore (home, car,
      location, gallery), Book (check dates, contact, booking status lookup),
      Legal (terms, privacy, house rules, cancellation policy, vehicle rental
      agreement); host contact email + phone; "Managed by [owner]"; copyright.
    - Layout: 3–4 columns desktop, stacked accordion-ish mobile.

**Sticky element:** on desktop, once section 4 scrolls into view, a condensed
`BookingWidget` docks to the top-right / a right rail (dates, guests, estimate,
"Request to book"). On mobile it becomes a sticky bottom bar (from-price +
"Check dates"). The from-price/estimate label is the same **[v1-only copy]**
constant as §10.

### P2 — Gallery (`/gallery`)

1. Header / nav.
2. **Gallery grid** — purpose: all photos, grouped (Exterior & grounds, Living,
   Kitchen, Bedroom 1, Bedroom 2, Bathrooms, Workspace, The car). Content:
   `GET /api/gallery` images with captions. Layout: masonry / justified rows,
   click opens `Lightbox` (component) with prev/next, caption, counter, keyboard
   + swipe. Category jump-links at top.
3. **Back to booking** band — dates + "Request to book".
4. Footer.

### P3 — The car (`/the-car`)

Dynamic: `GET /api/vehicle`.

1. Header / nav.
2. **Hero** — Sorento photo, "The keys are included in the deal — the car is
   the add-on." Rate chip: USD 45/day, collected at the property.
3. **Specs** (`FactRow`) — make/model/year, SUV, transmission, seats, fuel,
   luggage, aircon.
4. **How it works** (`StepList`) — add the car to your booking request; the
   host confirms availability with your stay; sign/collect keys on arrival at
   the property; return with the same fuel level; pay on site.
5. **Driver requirements** — minimum age, licence held N+ years, passport/licence
   presented on collection, permitted-use area, who else may drive.
6. **What's covered / what's not** (`IncludedTable`) — insurance basis, excess
   /deposit amount, fuel policy, mileage, cross-border (not permitted),
   breakdown contact, what counts as chargeable damage.
7. **The rental agreement** — plain-language summary bullets
   (`vehicle.agreement.summaryPoints`), current version + effective date, and a
   "Read the full Kia Sorento Rental Agreement" link to P12. Copy states clearly:
   "You'll review and accept this as part of your booking request if you add the
   car."
8. **CTA band** — "Add the car to your stay" -> P5 with car pre-selected
   (`/book?car=1`).
9. Footer.

### P4 — Location & getting around (`/location`)

Dynamic: `GET /api/property` (location + arrivalGuide).

1. Header / nav.
2. **Map** (`MiniMap`, larger) — approximate pin, note that the exact address and
   pin are sent after the booking is approved.
3. **Travel times** (`TravelTimeList`) — airport, CBD, supermarkets,
   restaurants, ATM, hospital, gym, and the weekend-trip anchors (Volcanoes,
   Nyungwe, Lake Kivu) with car vs without.
4. **The neighbourhood** — 1–2 paragraphs: gated, quiet, upmarket residential,
   what's walkable.
5. **Arriving in Kigali** — `property.arrivalGuide`: airport transfer options
   and cost, SIM card / eSIM, mobile money, currency, plug type, safety notes.
   (kigaliapartments.com / vibe.rw borrow.)
6. **Getting around without the car** — moto/taxi apps, rough fares.
7. **CTA band** -> P5.
8. Footer.

### P5 — Request to book (`/book`)

The most important flow. A 4-step wizard with a visible `Stepper` (component).
State held client-side between steps; **nothing is authoritative until `POST
/api/bookings` succeeds** (server validates everything again). Deep links:
`/book?checkIn=&checkOut=&guests=&car=1` pre-fills.

- **Persistent summary rail** (desktop right / collapsible top on mobile):
  `PriceBreakdown` from `POST /api/quote`, recalculated on any change. In v1,
  labelled "Estimate — the host confirms the final amount" (**[v1-only copy]**,
  same constant as P1 §10; `PriceBreakdown` `mode="estimate"`). Car line only
  when selected.

**Step 1 — Your trip**
- Purpose: dates + party size.
- Content: `DateRangePicker` seeded with `GET /api/availability` (unavailable
  nights disabled), guests stepper (adults/children, max 4), min-nights and
  disabled-date messaging inline.
- Layout: calendar left, guest control + rules note right; "Continue".

**Step 2 — Add the Kia Sorento? (optional)**
- Purpose: the add-on and, if taken, the driver info the agreement needs.
- Content: toggle "Add the car — USD 45/day, paid on site." If on: pickup /
  drop-off dates (default = stay dates, must sit within stay), primary driver
  full name, date of birth, licence number, licence issuing country, checkbox
  "I meet the driver requirements" (links to P3 list). If off: a single line
  "You can add the car later by contacting the host" and skip straight to the
  agreement-free path.
- Layout: toggle card; driver fields revealed below when on; "Continue" / "Back".

**Step 3 — Your details**
- Purpose: who the host is approving and how to reach them.
- Content: first name, last name, email, confirm email, phone (international),
  country of residence, purpose of stay (select: remote work / leisure /
  business / relocation / other), free-text message to the host (optional,
  "arrival time, questions, anything the host should know").
- Layout: single column, grouped fieldsets; "Continue" / "Back".

**Step 4 — Review & accept**  *(this is the customer-agreements step — see
scope-checklist)*
- Purpose: show the full estimate and capture explicit, recorded acceptance.
- Content:
  1. Trip summary (dates, guests, nights) + `PriceBreakdown` estimate.
  2. Car summary (if added) + driver name.
  3. **Stay terms & cancellation** — short summary, link to P11, checkbox
     "I have read and accept the booking terms and cancellation policy
     (v{n})". Required.
  4. **House rules** — short summary, link to P10, checkbox "I have read and
     accept the house rules (v{n})". Required.
  5. **Kia Sorento Rental Agreement** — *rendered only if the car was added.*
     Component `AgreementPanel`: the full agreement text in a scrollable box
     with the version and effective date shown in the header; a "download /
     open full page" link to P12. Below it, checkbox "I,
     {driver full name}, have read and accept the Kia Sorento Rental Agreement
     (v{n}) dated {date}." Required when car added. The submit button stays
     disabled until every required box for the current configuration is
     checked.
  6. A short data-use line: "Your details are stored so the host can process
     this request — see the privacy policy."
- Submit: clay "Send booking request". Calls `POST /api/bookings` with an
  `Idempotency-Key`; button enters loading and is disabled to prevent
  double-submit; a retried/duplicated call returns the same reference.
- On success: redirect to P6 (`/booking/:reference`) with a success banner.
- On validation error from the server (e.g. dates just got taken): show the
  error inline at the relevant step and jump the user there.
- Layout: stacked cards, each acceptance its own bordered block; sticky submit
  bar on mobile.

**[v2 seam] Payment step.** In v2, when `property.bookingMode === "instant"`, a
**Step 5 — Payment** slots in *between Step 4 (review & accept) and the
confirmation view*, with no change to steps 1–4 or to the confirmation page's
structure. Concretely, build for this now:
- The `Stepper` reads its step list from a config array, not hard-coded to 4 —
  adding an entry is a data change.
- Step 4's submit is "advance to next step" semantics; whether the next thing is
  "call `POST /api/bookings` then go to P6" (v1) or "call `POST /api/bookings`
  then go to Step 5 payment" (v2) is decided by `bookingMode`.
- The confirmation destination is P6 in both cases — v1 lands on a `pending`
  P6, v2 lands on a `confirmed` P6 after payment succeeds.
- Do **not** build Step 5, the payment UI, or any payment field in v1. This note
  exists only so the wizard's step model and submit handler are not written in a
  way that assumes exactly four steps ending in one API call.

### P6 — Booking status (`/booking/:reference`)

Dynamic: `GET /api/bookings/:reference?email=`.

- **Access:** reference in URL + email entered on a small gate form (or via the
  link in the acknowledgement email that carries a signed token). Wrong email
  -> generic "we couldn't find that booking."
- **Status rendering:** switch on `status`; render a neutral "in progress" card
  for any value the frontend does not recognise (the contract reserves
  `confirmed` for v2 and may add more — never crash on an unknown status).
1. Header / nav.
2. **Status card** (`StatusBadge`: Pending / Approved / Rejected / Cancelled /
   Expired) with the reference, submitted date, stay dates, guests, car yes/no.
3. **If Pending:** "The host is reviewing your request. You'll get an email at
   {masked email}. Typical response within 24–48h." Show what was requested and
   the estimate. Button: "Contact the host" -> P7 prefilled.
4. **If Approved:** the confirmed `PriceBreakdown` (host's final figures), the
   exact address + map link, check-in instructions, host contact, car
   collection details (if car), and "what to bring." Mirrors the approval
   email.
5. **If Rejected:** the host's explanation text, plus "You're welcome to send a
   new request for different dates" -> P5, and "Contact the host" -> P7.
6. **Accepted documents** — list of what was accepted at submit (stay terms
   vN, house rules vN, vehicle agreement vN) with timestamps, each linking to
   the versioned text. Reassurance + record for the guest.
7. Footer.

### P7 — Contact (`/contact`)

Dynamic: `POST /api/contact`.

1. Header / nav.
2. **Contact form** (`Form`) — name, email, topic (select: booking question /
   the car / my existing request / other), optional booking reference, message.
   On submit: inline success "Thanks — the host replies within a day," triggers
   an acknowledgement email.
3. **Other ways to reach us** — host email, phone/WhatsApp, response-time note.
4. **Quick answers** — 3–4 top FAQ entries with a link to P1 FAQ.
5. Footer.

### P8–P12 — Legal & the reference agreement

Shared template `LegalPage` (component): header/nav, centred single prose
column (max ~72ch), "Last updated {date}" and version, in-page anchored
subheadings, table of contents on desktop, footer.

- **P8 `/terms`** — website terms of use: acceptable use, no warranty on
  content accuracy, IP, liability cap, governing law (Rwanda), contact.
- **P9 `/privacy`** — what's collected (name, email, phone, country, driver
  licence details when the car is added, message text, IP + user agent at
  acceptance), why, lawful basis, retention, third parties (email delivery
  provider, map/image hosting), guest rights and how to exercise them,
  data-controller contact. Must reflect that driver licence data and acceptance
  metadata are stored.
- **P10 `/house-rules`** — occupancy, smoking, parties/events, quiet hours,
  pets, visitors, damage responsibility, check-out tasks. Versioned.
- **P11 `/cancellation-policy`** — the booking terms: what a "request" means, how
  approval works, how/whether payment is taken, cancellation windows and
  refunds, changes to dates, no-show, host cancellation. Versioned. (v2 will
  need a paid-booking cancellation/refund section added here — additive.)
- **P12 `/vehicle-rental-agreement`** — read-only render of the **current**
  published Kia Sorento Rental Agreement (`GET /api/vehicle` -> `agreement`).
  Shows version + effective date. A banner: "This is the current version.
  If you have a booking, the version you accepted is shown on your booking
  status page." Content: parties, vehicle, rental period, rate & on-site
  payment, security deposit / excess, permitted use & geographic limit, driver
  eligibility, insurance basis, fuel & mileage, condition on return, damage &
  loss, breakdown & accident procedure, prohibited uses, termination,
  liability, governing law, signature/acceptance clause.

### P13 — 404

Header/nav, Fraunces "That page isn't here," links back to Home / Gallery /
Contact, and a "Look up a booking" field -> P6. Footer.

---

## 3. Admin pages — sections

Shell: `AdminShell` (component) = left sidebar (Dashboard, Bookings,
Availability & pricing, Content, Gallery, The car, Agreements, Emails; Users and
Settings shown to owner only), top bar (site name, "View site", signed-in user,
sign out). No public header/footer. Every screen's data and every action is
authorised server-side by session + role — hiding a menu item is not the
control.

### A0 — `/admin/login`
- Centred card: email, password, "Sign in", "Forgot password" (email reset
  link). Rate-limited. Generic failure message. On success -> A1.

### A1 — `/admin` Dashboard
1. **Queue summary** — counts: Pending, Approved (upcoming), Rejected (30d).
2. **Needs attention** — list of pending requests oldest-first, each row: guest,
   dates, car?, estimate, "Review" -> A3.
3. **Next arrivals** — approved bookings by check-in date.
4. **Content health** — nudges: "3 photos missing alt text," "Nightly rate last
   changed 88 days ago," "Vehicle agreement v4 — 12 acceptances."

### A2 — `/admin/bookings` Queue
1. **Filters** — status (Pending/Approved/Rejected/Cancelled/Expired/All), date
   range, car-only, text search (name/email/reference).
2. **Table** (`AdminTable`) — reference, guest, submitted, stay dates, nights,
   guests, car, estimate, status badge. Row click -> A3. Pagination.
3. **Export** — CSV of the current filter (optional, nice-to-have).

### A3 — `/admin/bookings/:id` Detail + decide
1. **Header** — reference, status badge, submitted timestamp, idempotency-safe
   action buttons.
2. **Guest** — name, email, phone, country, purpose, message.
3. **Trip** — dates, nights, guests, live availability check for those nights
   with a conflict warning if any night is already blocked/booked.
4. **Car** (if requested) — pickup/drop-off, driver name, DOB, licence number +
   country, "meets requirements" flag.
5. **Estimate** — the system estimate breakdown (read-only).
6. **Accepted documents** — stay terms vN, house rules vN, vehicle agreement
   vN, each with acceptedAt, acceptedBy name/email, IP, user agent, and a link
   to the exact text of that version (from A8 data). Read-only, always present
   for submitted bookings.
7. **Approve panel** — editable line items (prefilled from the estimate:
   accommodation, cleaning fee, car, plus "add line" for deposit/discount/other),
   currency, final total (auto), check-in instructions (rich text, prefilled
   from content defaults), exact address, map link, host contact, optional
   personal note, "Block these dates on approval" (default on). Button "Approve
   & send email" -> calls approve endpoint (idempotent), shows the rendered
   email preview first in a `ConfirmModal`.
8. **Reject panel** — required "Explanation to the guest" textarea (min ~20
   chars; this text goes verbatim into the rejection email), optional internal
   note. Button "Reject & send email" -> confirm modal with email preview.
9. **Activity log** — status changes, who did what, when.

### A4 — `/admin/availability` Calendar & pricing
1. **Calendar** — month grid; each night shows state: open / blocked (manual) /
   booked (from an approved booking, not editable here, links to A3). Drag or
   click-range to block; click a manual block to edit reason or remove.
2. **Pricing panel** — nightly rate, cleaning fee, minimum nights, currency
   (display only), "changes apply to new quotes and requests immediately."
   Save -> `PUT /api/admin/pricing`.
3. **Rules** — optional: weekend rate, long-stay note (kept simple; a single
   nightly rate is acceptable for v1).

### A5 — `/admin/content` Property text
- Section-by-section editors, each with Save and "revert to last saved":
  summary, description, neighbourhood text, amenities (add/remove/reorder,
  pick category + icon), included / not-included lists, check-in window +
  numbered process steps, arrival guide, travel-time list (name, minutes, km),
  FAQ (Q/A add/reorder), house-contact defaults used to prefill approvals.
- Live "preview on site" link. Plain textareas / lightweight rich text
  (headings, bold, links, lists) — no raw HTML paste.

### A6 — `/admin/gallery` Photos
1. **Upload** — drag-drop multiple; each upload posts through our backend to
   storage (never a direct client-to-provider call). Progress per file. Accept
   jpg/png/webp, enforce max size server-side, auto-generate thumbnail +
   dimensions.
2. **Grid** — thumbnails with caption, alt text (required — flagged if empty),
   category, drag to reorder (persists via order endpoint), delete (confirm).
3. **Set lead image** — marks the hero photo for P1.

### A7 — `/admin/vehicle` The car
1. **Details** — make, model, year, body, transmission, seats, fuel, luggage,
   daily rate, "car currently offered" toggle, description, requirements list,
   covered / not-covered lists, deposit/excess amount, geographic limit.
   Save -> `PUT /api/admin/vehicle`.
2. **Rental agreement versions** — table of published versions (version,
   effective date, published-by, acceptance count). "Draft a new version":
   rich-text/markdown editor + summary bullet points + effective date;
   "Publish" creates a new immutable version (`POST
   /api/admin/vehicle/agreement`). Existing acceptances and bookings keep the
   version they referenced. Warning copy: "Publishing changes what new guests
   accept. It does not alter agreements already accepted."
3. **Preview** — renders exactly as P12 will.

### A8 — `/admin/agreements` Acceptance log (audit)
1. **Filters** — document type (stay terms / house rules / vehicle agreement),
   version, date range, guest email, booking reference.
2. **Table** — acceptance id, booking reference (link to A3), document type,
   version, accepted-by name, accepted-by email, acceptedAt, IP, user agent.
3. **Row detail** — full metadata + the exact document body as it stood at that
   version (immutable). "Download record" (JSON/PDF) for dispute handling.
- This page is the human-facing view of the write required by scope-checklist;
  if it is empty after bookings exist with the car, the acceptance write is not
  wired up.

### A9 — `/admin/emails` Templates & sent log
Two tabs (or two sub-sections on one page):

**Templates**
- Editable templates (subject + body, with a token list like `{{guestFirstName}}`,
  `{{stayDates}}`, `{{priceBreakdown}}`, `{{checkInInstructions}}`,
  `{{rejectionExplanation}}`, `{{bookingReference}}`, `{{statusUrl}}`):
  bookingReceived, bookingApproved, bookingRejected, adminNewBooking,
  contactAck, adminInvite.
- Per template: live HTML preview with sample data, "send test to me" button.
- Brand-locked wrapper (logo, colours, footer) is not editable here — only the
  message body — so every email stays styled per brand-brief.

**Sent log (outbox)** — `AdminTable` from `GET /admin/sent-emails`
- Columns: sent-at, to, template, subject, booking reference (link to A3 when
  present), status. Filters: template, free-text (`q`), date range. Paginated.
- Row → opens the exact rendered email that was stored (`GET
  /admin/sent-emails/:id` → `html`), read-only, in a panel/modal.
- Status column renders `stored` in v1 (nothing is actually transmitted — the
  v1 mailer only writes to the outbox); an unrecognised status renders as a
  neutral label. A real provider will populate `queued|sent|delivered|
  bounced|failed` here later.
- No create/edit/delete — the log is a byproduct of the system sending mail.

### A10 — `/admin/users` (owner only)
- Table: name, email, role (owner / admin), status (active / invited /
  disabled), last login. "Invite administrator" (name + email -> invite email
  with set-password link). Per row: change role, disable/enable, remove. Guard:
  cannot remove or demote the last owner; cannot disable yourself.

### A11 — `/admin/settings` (owner only)
- Host display name, public contact email + phone/WhatsApp, notification
  recipients for new-request alerts, timezone, default currency, approximate
  map coordinates + "reveal exact address only after approval" toggle,
  response-time text shown to guests.
- **[v2 seam]** This is where a `bookingMode` switch (`request` / `instant`)
  will live. Not shown in v1 (the value is fixed to `request`), but the page is
  the right home for it so no new screen is needed later.

---

## 4. Component inventory (reused across pages)

| Component | Used on | Notes |
|-----------|---------|-------|
| `SiteHeader` | all public | transparent-over-hero variant + solid variant; mobile drawer |
| `SiteFooter` | all public | legal links incl. vehicle rental agreement + booking lookup |
| `BookingWidget` | P1 (hero + sticky), P2/P3/P4 CTA bands | date range + guests + action; emits to `/book`; action label + reassurance from a `bookingMode`-keyed copy constant |
| `DateRangePicker` | BookingWidget, P5 step 1 | consumes availability; disables taken/min-stay-invalid nights; keyboard operable |
| `PriceBreakdown` | P1, P5 rail, P6, A3 | line items + total; `mode` prop `"estimate" \| "final"` — v1 uses `estimate`, v2 checkout uses `final` |
| `FactRow` | P1, P3 | icon + label cells |
| `AmenityGrid` | P1 | grouped, disclosure |
| `IncludedTable` | P1, P3 | two-column included / not-included with text-labelled icons |
| `GalleryPreview` | P1 | strip that opens Lightbox |
| `Lightbox` | P2 (and P1 preview) | focus-trapped modal, prev/next, captions, swipe |
| `MiniMap` | P1, P4 | static map image + approx pin + disclaimer |
| `TravelTimeList` | P1, P4 | place / minutes / km rows |
| `StepList` | P1, P3 | numbered vertical steps |
| `Accordion` | P1 FAQ, P7 | single-open, keyboard |
| `Stepper` | P5 | step list from a **config array**, not hard-coded to 4 — a v2 payment step is a data entry |
| `Form`, `Field`, `FieldError`, `Fieldset` | P5, P7, all admin | label always visible, aria-describedby errors |
| `AgreementPanel` | P5 step 4, A7 preview, P12 | scrollable versioned document + accept checkbox (checkbox only in P5) |
| `StatusBadge` | P6, A1, A2, A3 | pending / approved / rejected / cancelled / expired; neutral fallback for unknown values |
| `CtaBand` | P1, P2, P3, P4 | full-width Hill Green band with BookingWidget |
| `LegalPage` | P8–P12 | prose template + TOC + version line |
| `Toast` / `InlineAlert` | forms, admin | text + icon, not colour alone |
| `AdminShell` | all admin | sidebar + top bar, role-aware menu |
| `AdminTable` | A2, A8, A10, A7 versions | sortable, paginated |
| `ConfirmModal` | A3 approve/reject, A6 delete, A10 remove | shows consequence + (for emails) preview |
| `RichTextEditor` | A5, A7, A9 | constrained formatting, no raw HTML |
| `ImageUploader` | A6 | multi-file, backend-proxied, progress |
| `EmptyState` | queues, gallery, logs | guidance + primary action |

---

## 5. Dynamic content map

Every item below has a matching endpoint in api-contract.md.

| Where | Dynamic content | Endpoint(s) | Direction |
|-------|-----------------|-------------|-----------|
| P1, P3, P4 | Property text, amenities, check-in, FAQ, travel times, pricing, `bookingMode` | `GET /api/property` | read |
| P1, P2 | Photo gallery | `GET /api/gallery` | read |
| P1, P5 | Which nights are free + current rates | `GET /api/availability` | read |
| P1, P5 | Price breakdown for chosen dates + car | `POST /api/quote` | read (compute) |
| P3, P5, P12 | Car details + current rental agreement text/version | `GET /api/vehicle` | read |
| P5 | Create booking **+ record acceptances** | `POST /api/bookings` | write (+ side effects: acceptance records, emails) |
| P6, P13 | Booking status lookup | `GET /api/bookings/:reference?email=` | read |
| P7 | Contact message | `POST /api/contact` | write (+ email) |
| A0 | Sign in / out / session | `POST /api/admin/auth/login`, `POST /api/admin/auth/logout`, `GET /api/admin/auth/session` | write / read |
| A1, A2 | Booking queue | `GET /api/admin/bookings` | read |
| A3 | Booking detail | `GET /api/admin/bookings/:id` | read |
| A3 | Approve (final costs, check-in info, email) | `POST /api/admin/bookings/:id/approve` | write (+ block dates, email) |
| A3 | Reject (explanation, email) | `POST /api/admin/bookings/:id/reject` | write (+ email) |
| A4 | Availability blocks | `GET/POST/DELETE /api/admin/availability/blocks` | read / write |
| A4 | Pricing | `GET/PUT /api/admin/pricing` | read / write |
| A5 | Property content editing | `GET /api/admin/property`, `PUT /api/admin/property` | read / write |
| A6 | Gallery management | `GET /api/admin/gallery`, `POST /api/admin/gallery`, `PATCH/DELETE /api/admin/gallery/:id`, `PUT /api/admin/gallery/order` | read / write |
| A7 | Vehicle details | `GET /api/admin/vehicle`, `PUT /api/admin/vehicle` | read / write |
| A7 | Publish agreement version | `POST /api/admin/vehicle/agreement`, `GET /api/admin/vehicle/agreement/versions` | write / read |
| A8 | Acceptance audit log | `GET /api/admin/agreement-acceptances`, `GET /api/admin/agreement-acceptances/:id` | read |
| A9 | Email templates | `GET/PUT /api/admin/email-templates/:key`, `POST /api/admin/email-templates/:key/preview` | read / write |
| A10 | Administrator accounts | `GET/POST /api/admin/users`, `PATCH/DELETE /api/admin/users/:id`, `POST /api/admin/users/:id/resend-invite` | read / write |
| A11 | Site settings | `GET/PUT /api/admin/settings` | read / write |

---

## 6. Category coverage check (against scope-checklist.md)

- **Catalog / inventory** -> P1/P3 (the unit + the car) for guests; A4 (dates &
  pricing), A5 (content), A6 (photos), A7 (car) for management.
- **Payments / checkout** -> deliberately none in v1; P1 §10, P5 rail, P6 §4
  present costs as estimate-then-confirmed; car "paid on site" stated on
  P3/P5. **[v1-only copy]** and **[v2 seam]** markers on P1 §10, P1 §12, P5,
  P6, A11 record where v2 instant-book + payment slot in additively.
- **Accounts / auth** -> A0 login; session enforced on all `/api/admin/*`; no
  guest accounts (P6 uses reference + email).
- **Admin / back-office** -> A1–A11.
- **Search / discovery** -> N/A, no page.
- **Notifications** -> emails triggered by `POST /api/bookings` (received +
  admin alert), approve, reject, `POST /api/contact`, user invite; templates
  editable at A9.
- **Legal / compliance** -> P8, P9, P10, P11 (`LegalPage`).
- **Customer agreements** -> P5 step 4 acceptance UI (vehicle agreement shown
  only when car added), `AgreementPanel`; recorded by `POST /api/bookings` side
  effect; auditable at A8; versioned at A7; reference copy at P12; per-guest
  record echoed on P6 §6 and A3 §6. It is an explicit step in user-journeys.md,
  not folded into "then they book."

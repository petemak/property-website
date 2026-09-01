# Scope Checklist — Kigali Keys

Purpose: work out what kind of site this is before designing it. One line per
capability category: applies / doesn't apply / unsure, with a reason. Nothing
skipped silently.

## What kind of site is this

A **single-property short-stay website** for one 2-bedroom duplex in Kigali.
It is a *booking-request* site, not an instant-booking marketplace: guests read
the property information, browse a photo gallery, pick dates, and submit a
request with their contact details. A human (the property manager) then
approves or rejects each request, and the guest is told the outcome by a styled
email. The owner and a small number of appointed administrators maintain the
content, the photos, availability, and the booking queue.

One paid add-on exists: the on-site Kia Sorento SUV at USD 45/day, collected at
the property. Because a guest is taking temporary custody of a vehicle, this
add-on carries a **binding rental agreement** that must be accepted per booking.

No money is taken online anywhere on the site in v1 (see Payments below, and
"Future direction / extensibility").

## Category-by-category

- **Catalog / inventory — APPLIES (small).** There is one rentable unit (the
  whole duplex) plus one add-on (the Kia Sorento). "Inventory" here is a date
  calendar (which nights are free) and the car's availability, not a product
  list. Managed by the owner and appointed administrators through an admin area.
  Per the standing instruction, a business that ships/sells a stay is assumed to
  have a catalog and back-office unless the brief rules it out — it does not.

- **Payments / checkout — NONE IN v1, BY DESIGN.** v1 is a booking-request site:
  a manager approves each request and the guest then gets an email with
  "detailed information about the location, costs and check-in procedure." Costs
  are settled off-platform; the car is "collected on-site" at USD 45/day. No
  card processor in v1. The flow is deliberately structured so a payment +
  instant-confirm step can be inserted later **without reshaping the booking
  model** (see "Future direction / extensibility" below). The site shows a price
  breakdown that is labelled an **estimate** in v1 only. NOTE: the booking
  mutation is already built idempotently per engineering-standards (a retried
  submit must not create a second booking) — that is exactly the property a
  payment step needs.
  Owner confirmed: how the stay itself is paid in v1 is "arranged by the manager
  in the approval email" (bank transfer / on arrival / deposit at the manager's
  discretion).

- **Accounts / auth — APPLIES (admin only).** The owner plus "chosen
  administrators" log in to maintain the site and process bookings. Guests do
  **not** get accounts — they submit a request as a one-off and track its
  status with a reference code plus their email. So: authenticated admin area,
  unauthenticated public site, no guest login.

- **Admin / back-office — APPLIES.** Explicit in the brief: "allow the property
  owner and chosen administrators to maintain it." Back-office responsibilities:
  review the booking queue and approve/reject with a manager-written
  explanation; edit property description, amenities, check-in text, FAQ, arrival
  guide; manage the photo gallery; block/open dates and set the nightly rate,
  cleaning fee and minimum stay; edit the car details, daily rate and the
  vehicle rental agreement text; view the log of accepted agreements; manage
  administrator accounts (owner only); edit the email templates.

- **Search / discovery — DOES NOT APPLY.** One property. There is no listing
  grid to search or filter. The only "discovery" interaction is an availability
  calendar and a date picker, which are part of the booking flow, not search.
  No search box, no filters, no results page.

- **Notifications — APPLIES (email).** Required by the brief:
  (1) booking-request-received acknowledgement to the guest; (2) styled
  approval email including location, costs and check-in procedure; (3) styled
  rejection email including the manager's explanation. Plus operationally
  necessary: (4) new-request alert to the manager/admins; (5) contact-form
  acknowledgement; (6) administrator invite / password-set email. Email only —
  no SMS or push in scope. The v1 mailer is "store & log" (writes every message
  to an outbox table, does not transmit); a real provider is a deployment-time
  config swap. The admin can inspect the outbox — every generated email, its
  rendered body, and (with a real provider later) its delivery status — on the
  A9 "Sent log" tab (`GET /admin/sent-emails`). "Applies" is only satisfied when
  that view exists, not merely when rows are written.

- **Legal / compliance — APPLIES.** Needs a privacy policy (guest contact data
  is collected and stored, audience includes the EU so GDPR-style disclosure is
  expected), website terms of use, house rules, and a cancellation policy
  (borrowed from the Vrbo reference: "upfront house rules and cancellation
  terms"). These are static, versioned pages. Distinct from the item below.

- **Customer agreements — APPLIES.** The Kia Sorento rental is a binding
  contract: the guest takes custody of a vehicle, so there must be terms on
  liability, insurance/excess, fuel, mileage, driver eligibility, damage and
  return condition. This is **not** the same as the static terms page. It must
  be shown and explicitly accepted at the point the booking request is
  finalised, and the acceptance must be *recorded* (who, when, which version).
  It is a first-class step in the user journey ("review and accept the Kia
  Sorento Rental Agreement"), not folded into "then they book."
  Secondary agreements captured the same way (lighter weight, same mechanism):
  acceptance of the **house rules** and the **stay booking terms /
  cancellation policy** at submit time. These also get recorded acceptance
  events, because the manager approves a request on the basis that the guest
  agreed to them.

## Consequences for the design

1. Admin-only pages are in scope and specified in design-spec.md even though
   guests never see them.
2. The booking flow has an explicit "review and accept" step. The vehicle
   agreement appears there only when the car add-on is selected.
3. api-contract.md includes a write that records each acceptance event as a
   side effect of creating the booking — a rendered text block with no
   corresponding stored record does not satisfy the "customer agreements"
   category.
4. No payment endpoints, no card fields in v1. The booking response carries an
   *estimate*; the real figure is set by the manager at approval time and
   delivered by email.
5. No guest-facing search, login, or account pages.

## Future direction / extensibility

The owner has confirmed the roadmap: **v1 = booking-request (human approves
each request, no online payment)**; **v2 = instant booking + online payment**.
v1 must be built so v2 is an *additive* change, not a rewrite. Concrete
implications, carried into the other three docs:

- **One booking model, one create endpoint.** `POST /api/bookings` is "create a
  booking," never "create a request." Whether a booking needs human approval or
  can auto-confirm on payment is a server-side `bookingMode` / property setting,
  not a different URL or a different resource. v2 flips the mode; the client
  contract for creating a booking does not change shape.
- **Explicit status state machine.** Booking `status` is an enumerated state
  machine (v1: `pending → approved | rejected | cancelled | expired`). `confirmed`
  is a **reserved** future state for instant bookings. All clients must treat
  unknown status values gracefully (render as "in progress," never crash).
- **Payment is a sub-resource, not a reshaping.** When v2 arrives, a payment
  attaches under the booking (e.g. `POST /api/bookings/:id/payment`) and a
  successful payment transitions `pending → confirmed`. v1 does not define or
  stub this endpoint (no dead code), but the booking resource leaves room for
  it: `status`, `decision`, and money fields are already separable from the
  "who approved this" fields.
- **Quote is already breakdown-shaped, not estimate-shaped.** `POST /api/quote`
  returns a structured line-item breakdown with a real total. v1 labels it an
  estimate in copy only; v2 stops calling it an estimate and treats the same
  payload as the amount to charge. No structural change.
- **Idempotency keys already required** on booking mutations — this is exactly
  the guarantee a payment/instant-confirm step depends on, so it is in from day
  one.
- **UI seam:** the booking wizard is built so a "payment" step can slot between
  "review & accept" and "confirmation" without disturbing the other steps
  (see design-spec.md).
- v1 ships none of the v2 machinery. This section documents the seams so the v1
  build does not paint them shut.

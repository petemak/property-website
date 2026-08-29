# User Journeys — Kigali Keys

design-spec.md describes pages in isolation. This file describes the sequences a
real person follows across them. If getting from one step to the next isn't
obvious, that is a bug to fix here before a developer builds it.

Page IDs (P1, A3, ...) and endpoints refer to design-spec.md and
api-contract.md.

The four journeys, in priority order:

1. Guest browses the property and submits a booking request **with the car**
   (the differentiator, and the path that exercises the agreement step).
2. Property manager reviews a pending request and **approves** it.
3. Property manager reviews a pending request and **rejects** it with an
   explanation.
4. Owner/admin updates the storefront (photos, nightly rate, blocked dates) and
   publishes a new car rental agreement version.

How reference sites structure journey 1: Airbnb keeps a sticky price/date card
on the listing and moves the guest to a single "Request to book" page that
bundles trip details, a message to the host, and confirmation. Booking.com
splits it into "your selection -> guest details -> confirm" with a persistent
price summary. We follow the Booking.com-style explicit steps (the audience
"reads the practical details closely"), keep Airbnb's sticky widget and
image-first listing, and add one step they don't have — reviewing and accepting
the car rental agreement — as its own clearly labelled stage, not a checkbox
buried in "confirm."

---

## Journey 1 — Guest books the stay and the car

**Persona:** Lena, a remote worker in Lagos, planning a 7-night working trip.
Mobile first, comparing two or three Kigali places.

**Start:** lands on P1 (`/`) from a search engine or a link.

1. **P1 hero.** Lena sees the lead photo, the tagline, and a one-line fact
   summary ("Whole 2-bed duplex · sleeps 4 · gated · Kia Sorento on site").
   The `BookingWidget` shows "Check availability" with empty date fields.
   Frontend has already called `GET /api/property` and `GET /api/gallery`.
2. **She scrolls the page.** Reads "The home," opens two photos in the
   `Lightbox` from the preview strip, closes it (focus returns to the
   thumbnail). Reads "What's included / what's not," the amenities, and stops
   at "The car — teaser": SUV, automatic, USD 45/day, collected on site.
   She taps **"How the car works."**
3. **P3 (`/the-car`).** Frontend calls `GET /api/vehicle`. She reads specs,
   "How it works," driver requirements, and the covered/not-covered table.
   She notes the excess is USD 500 and Rwanda-only. She taps the CTA
   **"Add the car to your stay."**
4. **Arrives on P5 (`/book`) at Step 1**, deep-linked as `/book?car=1` so the
   car toggle will default on later. The `Stepper` shows 4 steps. The summary
   rail says "Pick your dates for an estimate."
5. **Step 1 — Your trip.** The `DateRangePicker` is seeded from
   `GET /api/availability?from=<today>&to=<+12 months>`; unavailable nights are
   disabled and greyed. She picks 5–12 September (7 nights), sets guests to 2
   adults. Min-nights rule (3) is satisfied, so **"Continue"** enables. On
   change, the frontend calls `POST /api/quote` and the rail shows
   accommodation 980 + cleaning 35 = **USD 1,015 estimate**.
6. **Step 2 — Add the Kia Sorento?** The toggle is already **on** (from
   `?car=1`). Pickup/drop-off default to 5 and 12 Sep; she changes them to
   6–10 Sep (4 days). Driver fields appear: she enters her full name, date of
   birth, licence number, issuing country (NG), and ticks "I meet the driver
   requirements" (link opens the P3 list in a new tab). The rail recalculates
   via `POST /api/quote`: adds "Kia Sorento x 4 days = 180," estimate now
   **USD 1,195**. **"Continue."**
7. **Step 3 — Your details.** First/last name, email, confirm email, phone
   (+234...), country of residence, purpose of stay = "Remote work," and a
   message: "Arriving ~19:00, early check-in possible?" **"Continue."**
8. **Step 4 — Review & accept.** She sees:
   - Trip summary + the `PriceBreakdown` estimate (USD 1,195), labelled
     "Estimate — the host confirms the final amount."
   - Car summary: "Kia Sorento, 6–10 Sep, driver: Lena Okafor."
   - **Booking terms & cancellation** — 3-line summary, "Read the full policy"
     (opens P11), checkbox: *"I have read and accept the booking terms and
     cancellation policy (v3)."*
   - **House rules** — summary, link to P10, checkbox: *"I have read and accept
     the house rules (v2)."*
   - **Kia Sorento Rental Agreement** — because the car is added, an
     `AgreementPanel` shows the full agreement text (from
     `GET /api/vehicle` -> `agreement.bodyMarkdown`) in a scrollable box headed
     "Version 4 · effective 1 July 2026," with "Open full agreement" (P12).
     Below it: checkbox *"I, Lena Okafor, have read and accept the Kia Sorento
     Rental Agreement (v4) dated 1 July 2026."*
   - A line: "Your details are stored so the host can process this request —
     see the privacy policy."
   The **"Send booking request"** button stays disabled until all three boxes
   are ticked.
9. **She ticks all three and taps "Send booking request."** The frontend
   generates an `Idempotency-Key` (UUID) and calls
   `POST /api/bookings` with the guest, stay, car+driver, and an `acceptances`
   array carrying `stayTerms v3`, `houseRules v2`, and
   `vehicleRentalAgreement v4` + the `bodyHash` from the vehicle response.
   Button shows a spinner and is disabled.
10. **Server side:** validates everything again (dates still valid, versions
    current, driver age ok), creates booking `KK-7F3Q2A` with status
    `pending`, **writes three acceptance records** (each with her name, email,
    server timestamp, IP, user agent, version, and — for the car — the body
    hash and a snapshot pointer), then sends her the `bookingReceived` email
    and the `adminNewBooking` alert to the host. Responds `201` with
    `reference`, `statusUrl`, and `acceptancesRecorded`.
11. **Redirect to P6 (`/booking/KK-7F3Q2A`).** A success banner: "Request sent.
    The host will reply within 24–48 hours." The `StatusBadge` reads
    **Pending**. She sees what she requested, the estimate, and an "Accepted
    documents" list (stay terms v3, house rules v2, vehicle agreement v4) with
    timestamps and links. The page also notes the confirmation email includes a
    direct link back here.
12. **Email.** She gets the branded `bookingReceived` email with the reference
    and a `/booking/KK-7F3Q2A?token=...` link that reopens P6 without typing
    her email.

**End state:** booking `pending`; three acceptance records stored; host
notified. Lena waits for the decision (Journey 2 or 3).

**Failure branch (dates taken meanwhile):** at step 10 the server finds a night
now blocked by another approved booking -> `409` / `422`. P5 returns Lena to
Step 1 with an inline message "One or more of these nights was just booked —
please pick again." Her other entries and ticked boxes are preserved except the
dates.

**Failure branch (agreement version changed):** if the host published vehicle
agreement v5 between step 3 and step 9, `POST /api/bookings` returns
`409 agreementVersionStale`. P5 stays on Step 4, re-fetches
`GET /api/vehicle`, swaps in the v5 text with a notice "The rental agreement
was updated — please review and accept the current version," and clears only
that checkbox.

---

## Journey 2 — Manager approves a request

**Persona:** Jean, the owner, on a laptop, clearing the queue in the morning.

**Start:** the `adminNewBooking` email, or he just opens `/admin`.

1. **A0 (`/admin/login`).** Enters email + password. `POST /api/admin/auth/login`
   sets the session cookie. Redirects to **A1**.
2. **A1 dashboard.** "Needs attention" lists `KK-7F3Q2A` — Lena Okafor,
   5–12 Sep, car: yes, est. USD 1,195, submitted today. He clicks **"Review."**
3. **A3 (`/admin/bookings/bkg_88`).** `GET /api/admin/bookings/:id` loads the
   full record. Jean reads the guest details, the message ("early check-in?"),
   the trip, and the **Car** block with Lena's driver details. The **Trip**
   block shows "All 7 nights available — no conflicts."
4. **Accepted documents** section confirms she accepted stay terms v3, house
   rules v2, and vehicle agreement v4, each with timestamp, IP, and a link to
   the exact v4 text. Jean is comfortable proceeding.
5. **Approve panel.** Line items are prefilled from the estimate
   (accommodation 980, cleaning 35, car 180, total 1,195). Jean adds a line
   "Refundable car deposit (paid on site) — 0 shown / collected on arrival"
   note in the free-text, keeps the total at 1,195. He fills:
   - Payment instructions: "50% bank transfer to confirm within 3 days, balance
     on arrival."
   - Exact address + Google Maps link.
   - Check-in instructions (prefilled from content defaults; he edits the
     lockbox code and adds "Early check-in at 12:30 is fine").
   - Car collection: "Keys at the house on arrival; bring licence + passport."
   - Host contact + a personal note.
   - "Block these dates on approval" and "Block the car" both left **on**.
6. **He clicks "Approve & send email."** A `ConfirmModal` renders the actual
   `bookingApproved` email with all his text merged in. He reads it, clicks
   **"Confirm & send."**
7. **Frontend calls** `POST /api/admin/bookings/bkg_88/approve` with an
   `Idempotency-Key` and the line items, total, and all the text fields.
8. **Server side:** sets status `approved`, stores `approvalDetails`, creates
   availability blocks for 5–12 Sep (stay) and 6–10 Sep (car), sends the
   branded `bookingApproved` email to Lena. Returns `200` with the updated
   booking.
9. **A3 refreshes** to show the **Approved** badge, the decision timestamp, and
   a read-only view of what was sent. The "Approve" panel is replaced by
   "Resend email" and "View on guest status page."
10. **Storefront reflects it:** the next visitor's `GET /api/availability` no
    longer offers 5–11 Sep as check-in nights; the P1 calendar greys them out.
11. **Guest side:** Lena's `bookingReceived` link now opens P6 showing
    **Approved** with the full `PriceBreakdown`, the exact address and map,
    check-in steps, and car collection details — mirroring the email.

**End state:** booking `approved`; dates + car blocked; guest emailed and P6
updated.

**Conflict branch:** if Jean had approved a different overlapping request first,
this approve call returns `409 dateConflict` naming the clashing nights. A3
shows "These nights are already committed to KK-XXXX. Reject this request, or
approve without blocking dates." Jean chooses reject (Journey 3) or re-submits
with "Block dates" off and handles it manually.

---

## Journey 3 — Manager rejects a request

**Persona:** Jean again; a request has come in for dates he's already promised
elsewhere but not yet entered.

1. **A2 (`/admin/bookings`)**, filter = Pending. He opens the request for
   12–18 Sep.
2. **A3.** The Trip block flags "3 nights overlap a manual block: owner
   staying." He decides not to host this one.
3. **Reject panel.** He types the required explanation (min 20 chars):
   "I'm so sorry — the house is already committed for those exact dates. It's
   free again from 22 September and I'd love to host you then; reply to this
   email and I'll hold it." He adds an internal note "nice enquiry, follow up."
4. **He clicks "Reject & send email."** `ConfirmModal` shows the rendered
   `bookingRejected` email with his explanation quoted in full. He confirms.
5. **Frontend calls** `POST /api/admin/bookings/:id/reject` with an
   `Idempotency-Key` and `{ explanation, internalNote }`.
6. **Server side:** status `rejected`, stores the explanation, sends the
   branded `bookingRejected` email containing his verbatim text. No dates are
   blocked. Returns `200`.
7. **A3** shows the **Rejected** badge, timestamp, and the explanation
   (guest-visible) plus the internal note (admin-only).
8. **Guest side:** the applicant's P6 now shows **Rejected** with Jean's
   explanation, a "Send a new request for different dates" button (-> P5) and
   "Contact the host" (-> P7 prefilled with the reference).

**End state:** booking `rejected`; applicant emailed with a real reason and a
route to re-book; calendar unchanged.

**Guard:** if the request was already approved or rejected, the reject call
returns `409 alreadyDecided` and A3 tells Jean the current status (prevents a
second contradictory email). A retried click with the same `Idempotency-Key`
just replays the first result.

---

## Journey 4 — Admin updates the storefront and the car agreement

**Persona:** Aline, an appointed administrator (role `admin`, not `owner`),
doing seasonal upkeep before the summer peak.

1. **A0 login** -> **A1 dashboard.** "Content health" nudges: "2 photos missing
   alt text," "Nightly rate last changed 95 days ago."
2. **Add photos — A6 (`/admin/gallery`).** She drags in 5 new interior photos.
   Each uploads via `POST /api/admin/gallery` (multipart) — the backend stores
   the original, makes a thumbnail, reads dimensions. She fills the required
   **alt text** and a caption for each, sets category "Living" / "Workspace."
   She drags the best new exterior shot to the top and clicks "Set as lead
   image" (`POST /api/admin/gallery/lead`). Reorder persists via
   `PUT /api/admin/gallery/order`.
3. **Verify on storefront.** She opens `/` in a new tab: the hero shows the new
   lead image, `GET /api/gallery` returns the new set, P2 shows them in the
   chosen order. (Cache TTL ~5 min; a hard refresh confirms.)
4. **Raise the nightly rate — A4 (`/admin/availability`).** In the pricing
   panel she changes nightly rate 140 -> 165, keeps cleaning fee 35 and
   min-nights 3, saves (`PUT /api/admin/pricing`). A banner confirms "Applies to
   new quotes immediately."
5. **Verify:** on `/`, picking any dates now calls `POST /api/quote` and shows
   165/night. Existing approved bookings are untouched (their figures live in
   `approvalDetails`).
6. **Block owner dates — A4 calendar.** She click-drags 20–27 Dec, reason
   "Owner family visit," saves (`POST /api/admin/availability/blocks`). Those
   nights immediately drop out of `GET /api/availability` and grey out on P1.
7. **Publish a new car rental agreement — A7 (`/admin/vehicle`).** Legal sent
   revised excess wording. She opens "Rental agreement versions," clicks "Draft
   a new version," pastes the updated markdown, updates the summary bullets
   (excess now USD 750), sets effective date 1 Oct 2026, clicks **"Publish."**
   A warning modal: "This changes what new guests accept. Agreements already
   accepted are unchanged." She confirms -> `POST /api/admin/vehicle/agreement`
   creates **version 5**, now current.
8. **Effect on guests:** `GET /api/vehicle` now returns v5 text + hash. Any
   guest mid-booking who had loaded v4 gets `409 agreementVersionStale` on
   submit and is shown v5 to re-accept (Journey 1 failure branch). New bookings
   record `vehicleRentalAgreement v5`.
9. **Effect on records:** the A8 acceptance log still shows historical v4
   acceptances with the exact v4 text preserved via their snapshot; new rows
   reference v5. `GET /api/admin/vehicle/agreement/versions` lists v5 (current,
   0 acceptances) and v4 (12 acceptances).
10. **Out of scope for Aline:** she opens `/admin/users` and gets a
    `403 forbidden` view ("Only the owner can manage administrators") — role is
    enforced server-side, not just hidden.

**End state:** storefront shows new photos and rate; December is blocked;
vehicle agreement v5 is live for new bookings; all prior acceptance records and
their document text remain intact and auditable.

---

## Cross-journey checks (things that must line up)

- The version numbers shown in P5 Step 4 checkboxes come from
  `GET /api/property` (`termsVersions`) and `GET /api/vehicle`
  (`agreement.version`) — the same values the server validates in
  `POST /api/bookings`. If they can drift, journey 1 step 9 fails confusingly.
- P6 is reachable **two ways** (email token link, or reference + email on the
  P6 gate) — both must resolve to the same view. A guest who lost the email
  must still get in.
- The approval email and P6 "Approved" view render from the **same**
  `approvalDetails` object — never build the email from one source and the page
  from another.
- Rejecting never blocks dates; approving always offers to. A calendar that
  shows a rejected request's nights as unavailable is a bug.
- Every admin action that sends an email shows the rendered email in a
  `ConfirmModal` first (journeys 2 and 3 step "Confirm & send") — no email
  leaves without the manager seeing exactly what the guest gets.

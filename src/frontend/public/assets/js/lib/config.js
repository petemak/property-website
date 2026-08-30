// Central config — this is where the v1/v2 seams live as DATA, not code branches.
// design-spec.md [v1-only copy] / [v2 seam]; user-journeys.md Journey 1 fork note.

// ---------------------------------------------------------------------------
// Booking wizard steps. The Stepper renders from THIS array — it is not
// hard-coded to 4. Adding the v2 payment step is a one-line data change here
// (insert { id: "payment", ... } before "confirmation" and give it a view).
// ---------------------------------------------------------------------------
export const WIZARD_STEPS = [
  { id: "trip", label: "Your trip", nav: "1" },
  { id: "car", label: "Add the car", nav: "2" },
  { id: "details", label: "Your details", nav: "3" },
  { id: "review", label: "Review & accept", nav: "4" },
  // [v2 seam] { id: "payment", label: "Payment", nav: "5" },  <-- inserted when bookingMode === "instant"
];

// ---------------------------------------------------------------------------
// Booking CTA copy, keyed off property.bookingMode. v1 is always "request".
// v2 adds an "instant" entry; markup never changes.
// ---------------------------------------------------------------------------
export const BOOKING_COPY = {
  request: {
    widgetAction: "Check availability",
    ctaAction: "Request to book",
    ctaReassurance: "Send a request — nothing is charged until the host confirms your dates.",
    submitAction: "Send booking request",
    estimateLabel: "Estimate",
    estimateSubLabel: "Estimate — the host confirms the final amount",
    railEmpty: "Pick your dates for an estimate.",
    fromPricePrefix: "From",
    successBanner: "Request sent. The host will reply within 24–48 hours.",
  },
  instant: {
    // [v2 seam] not used in v1 — documented so the swap is text-only
    widgetAction: "Check availability",
    ctaAction: "Book now",
    ctaReassurance: "Book instantly — pay now, keys are yours.",
    submitAction: "Continue to payment",
    estimateLabel: "Total due now",
    estimateSubLabel: "Total due now",
    railEmpty: "Pick your dates to see your total.",
    fromPricePrefix: "From",
    successBanner: "Booking confirmed.",
  },
};

export function bookingCopy(bookingMode) {
  return BOOKING_COPY[bookingMode] || BOOKING_COPY.request;
}

// After Step "review": in v1, submit -> POST /bookings -> land on P6 (pending).
// In v2 ("instant"), submit -> POST /bookings -> advance to payment step.
// The handler asks this, it never assumes "four steps ending in one API call".
export function stepsFor(bookingMode) {
  if (bookingMode === "instant") {
    const steps = WIZARD_STEPS.slice();
    steps.push({ id: "payment", label: "Payment", nav: "5" });
    return steps;
  }
  return WIZARD_STEPS.slice();
}

// ---------------------------------------------------------------------------
// Booking status metadata. Known values get a specific render; ANY unknown
// value (e.g. a future "confirmed", or something v3 adds) falls back to
// neutral "in progress" — never throw. (api-contract "Booking status state machine")
// ---------------------------------------------------------------------------
export const STATUS_META = {
  pending:   { label: "Pending",   variant: "pending",  blurb: "The host is reviewing your request." },
  approved:  { label: "Approved",  variant: "approved", blurb: "Your stay is confirmed by the host." },
  rejected:  { label: "Rejected",  variant: "rejected", blurb: "The host could not take this booking." },
  cancelled: { label: "Cancelled", variant: "cancelled", blurb: "This booking was cancelled." },
  expired:   { label: "Expired",   variant: "expired",  blurb: "This request expired without a decision." },
  confirmed: { label: "Confirmed", variant: "confirmed", blurb: "Your booking is confirmed." },
};

export function statusMeta(status) {
  return STATUS_META[status] || {
    label: "In progress",
    variant: "neutral",
    blurb: "This booking is being processed. Check back shortly or contact the host.",
    unknown: true,
  };
}

export const PURPOSE_OPTIONS = [
  { value: "remoteWork", label: "Remote work" },
  { value: "leisure", label: "Leisure" },
  { value: "business", label: "Business" },
  { value: "relocation", label: "Relocation" },
  { value: "other", label: "Other" },
];

export const CONTACT_TOPICS = [
  { value: "bookingQuestion", label: "Booking question" },
  { value: "theCar", label: "The car" },
  { value: "existingRequest", label: "My existing request" },
  { value: "other", label: "Other" },
];

export const GALLERY_CATEGORIES = [
  "Exterior & grounds", "Living", "Kitchen", "Bedroom 1", "Bedroom 2",
  "Bathrooms", "Workspace", "The car",
];

export const NAV_LINKS = [
  { href: "/", label: "The home" },
  { href: "/the-car", label: "The car" },
  { href: "/location", label: "Location" },
  { href: "/gallery", label: "Gallery" },
  { href: "/contact", label: "Contact" },
];

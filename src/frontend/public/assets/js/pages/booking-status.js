// P6 — Booking status. Reachable via /booking/:reference (+ email gate) OR
// /booking/:reference?token=... from the acknowledgement email.

import { initPublicPage } from "./common.js";
import { api, ApiError } from "../lib/api.js";
import { h, $, mount, announce } from "../lib/dom.js";
import { statusBadge } from "../components/status-badge.js";
import { statusMeta } from "../lib/config.js";
import { priceBreakdown } from "../components/price-breakdown.js";
import { field, setFieldError, clearErrors } from "../components/form.js";
import { formatDate, formatDateRange, formatDateTime, maskEmail } from "../lib/format.js";

const root = $("#booking-root");

(async function () {
  const { property } = await initPublicPage();
  root.className = "container section";

  const path = decodeURIComponent(location.pathname);
  const m = path.match(/^\/booking\/(.+)$/);
  const params = new URLSearchParams(location.search);
  const reference = (m && m[1]) || params.get("ref") || "";
  const token = params.get("token") || "";
  const justSubmitted = params.get("submitted") === "1";

  if (reference && token) { load({ reference, token }); return; }

  // Just came from a successful submit? We stashed the email so P6 opens without a gate.
  let stashed = null;
  try { stashed = JSON.parse(sessionStorage.getItem("kk_last_booking") || "null"); } catch {}
  if (reference && stashed && stashed.reference === reference && stashed.email) {
    load({ reference, email: stashed.email }).catch(() => renderGate(reference));
    return;
  }

  if (!reference) { renderLookup(""); return; }
  renderGate(reference);

  function renderLookup(prefRef) {
    mount(root,
      h("header", { class: "page-hero" }, h("h1", {}, "Look up a booking")),
      gateForm(prefRef),
    );
  }
  function renderGate(ref) {
    mount(root,
      h("header", { class: "page-hero" },
        h("h1", {}, "Your booking"),
        h("p", {}, `Enter the email you used for request ${ref} to see its status.`)),
      gateForm(ref),
    );
  }

  function gateForm(prefRef) {
    const refEl = h("input", { type: "text", id: "g-ref", name: "ref", value: prefRef, required: true, autocomplete: "off" });
    const emailEl = h("input", { type: "email", id: "g-email", name: "email", required: true, autocomplete: "email" });
    const err = h("div", { "aria-live": "polite" });
    return h("form", { class: "form", style: "max-width:420px", novalidate: true,
      onSubmit: async (e) => {
        e.preventDefault();
        clearErrors(e.target); err.replaceChildren();
        if (!refEl.value.trim()) return setFieldError(refEl, "Enter your booking reference.");
        if (!emailEl.checkValidity()) return setFieldError(emailEl, "Enter the email on the booking.");
        try { await load({ reference: refEl.value.trim(), email: emailEl.value.trim() }); }
        catch { err.replaceChildren(alert_("We couldn't find that booking. Check the reference and the email address.")); }
      },
    },
      field({ label: "Booking reference", control: refEl, id: "g-ref" }),
      field({ label: "Email address", control: emailEl, id: "g-email" }),
      err,
      h("button", { class: "btn btn--primary", type: "submit" }, "View booking"),
    );
  }

  async function load({ reference, email, token }) {
    let booking;
    try { booking = await api.getBooking(reference, { email, token }); }
    catch (e) {
      if (e instanceof ApiError && e.status === 404) throw e;
      mount(root, h("h1", {}, "Booking"), alert_(e.message || "Could not load this booking."));
      return;
    }
    render(booking, { justSubmitted, email });
  }

  function render(b, { justSubmitted, email }) {
    const meta = statusMeta(b.status);
    const est = b.estimate || {};
    const nights = b.stay?.nights ?? 0;

    mount(root,
      justSubmitted
        ? h("div", { class: "inline-alert inline-alert--success", role: "status" },
            h("span", { class: "inline-alert__icon", "aria-hidden": "true" }, "✓"),
            h("span", {}, "Request sent. The host will reply within 24–48 hours. A confirmation email with a direct link to this page is on its way."))
        : null,

      h("header", { class: "page-hero" },
        h("h1", {}, "Your booking"),
        h("p", { class: "stack" }, statusBadge(b.status), " ", h("span", {}, ` ${meta.blurb}`)),
        h("p", { class: "doc-version-line" }, `Reference ${b.reference} · submitted ${formatDateTime(b.submittedAt)}`),
      ),

      h("div", { class: "split split--text-first" },
        h("div", { class: "stack-lg" },
          card("What you requested",
            h("dl", { class: "detail-list" },
              row("Dates", `${formatDateRange(b.stay?.checkIn, b.stay?.checkOut)} · ${nights} night${nights === 1 ? "" : "s"}`),
              row("Guests", `${(b.stay?.adults || 0) + (b.stay?.children || 0)}`),
              row("Car", b.car?.requested ? `Yes — ${formatDateRange(b.car.pickUp, b.car.dropOff)}` : "No"),
            ),
          ),

          b.status === "approved" && b.approvalDetails
            ? approvedBlock(b.approvalDetails, b)
            : card(b.status === "rejected" ? "The estimate on this request" : "Your estimate",
                priceBreakdown({
                  mode: "estimate", bookingMode: property?.bookingMode,
                  currency: est.currency, lineItems: est.lineItems || [],
                  total: est.estimatedTotal,
                })),

          b.status === "rejected" && b.decision?.explanation
            ? card("The host's explanation",
                h("p", {}, b.decision.explanation),
                h("div", { class: "wizard-actions" },
                  h("a", { class: "btn btn--primary", href: "/book" }, "Send a new request for different dates"),
                  h("a", { class: "btn btn--ghost", href: `/contact?ref=${b.reference}&topic=existingRequest` }, "Contact the host"),
                ))
            : null,

          b.status === "pending"
            ? card("While you wait",
                h("p", {}, `The host is reviewing your request. You'll get an email at ${maskEmail(email || "your email")}. Typical response within 24–48 hours.`),
                h("a", { class: "btn btn--ghost", href: `/contact?ref=${b.reference}&topic=existingRequest` }, "Contact the host"))
            : null,

          acceptedDocs(b.acceptedDocuments || []),
        ),

        h("aside", {},
          h("div", { class: "card stack" },
            h("h2", { style: "font-size:1.1rem" }, "Need to reach the host?"),
            h("p", {}, "Reply to any Kigali Keys email, or use the contact form."),
            h("a", { class: "btn btn--ghost btn--block", href: `/contact?ref=${b.reference}` }, "Contact the host"),
          ),
        ),
      ),
    );
    announce(`Booking ${b.reference}: ${meta.label}.`);
    if (m) history.replaceState(null, "", location.pathname); // drop ?submitted / ?token from the address bar
  }
})();

function approvedBlock(a, b) {
  return card("Confirmed by the host",
    priceBreakdown({ mode: "final", currency: a.currency, lineItems: a.lineItems || [], total: a.total, caption: "Your total", disclaimer: a.paymentInstructions }),
    h("dl", { class: "detail-list", style: "margin-top:1rem" },
      a.addressLine ? row("Address", a.addressLine) : null,
      a.mapUrl ? row("Map", h("a", { href: a.mapUrl, target: "_blank", rel: "noopener" }, "Open map")) : null,
      a.hostContact ? row("Host", a.hostContact) : null,
    ),
    a.checkInInstructions ? h("div", { class: "stack" }, h("h3", {}, "Check-in"), h("p", {}, a.checkInInstructions)) : null,
    b.car?.requested && a.carCollection ? h("div", { class: "stack" }, h("h3", {}, "Collecting the car"), h("p", {}, a.carCollection)) : null,
    a.note ? h("p", { class: "price-breakdown__note" }, a.note) : null,
  );
}

function acceptedDocs(list) {
  if (!list.length) return null;
  const nice = { stayTerms: "Booking terms & cancellation policy", houseRules: "House rules", vehicleRentalAgreement: "Kia Sorento Rental Agreement" };
  return card("Documents you accepted",
    h("p", { class: "price-breakdown__note" }, "Kept as your record. Each links to the exact version you accepted."),
    h("ul", {}, ...list.map((d) => h("li", {},
      h("a", { href: d.documentUrl.replace(/^\/api\/documents/, "/documents-view"), onClick: (e) => { e.preventDefault(); window.open(d.documentUrl, "_blank"); } },
        `${nice[d.type] || d.type} (v${d.version})`),
      ` — accepted ${formatDate(d.acceptedAt)}`,
    ))),
  );
}

function card(title, ...content) {
  return h("section", { class: "card stack", "aria-label": title }, h("h2", { style: "font-size:1.2rem" }, title), ...content);
}
function row(dt, dd) { return [h("dt", {}, dt), h("dd", {}, dd)]; }
function alert_(msg) {
  return h("div", { class: "inline-alert inline-alert--error", role: "alert" },
    h("span", { class: "inline-alert__icon", "aria-hidden": "true" }, "!"), h("span", {}, msg));
}

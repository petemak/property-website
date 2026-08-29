// BookingWidget — date range + guests + action. Emits to /book.
// Action label + reassurance come from a bookingMode-keyed copy constant.
// (design-spec component inventory; P1 hero + sticky; CtaBand)

import { h } from "../lib/dom.js";
import { bookingCopy } from "../lib/config.js";
import { money, isoDate, addDays } from "../lib/format.js";

let seq = 0;

export function bookingWidget({
  bookingMode = "request",
  maxGuests = 4,
  fromPrice = null,
  currency = "USD",
  minNights = 1,
  heading = "Check availability",
  compact = false,
  values = {},
} = {}) {
  const copy = bookingCopy(bookingMode);
  const id = `bw-${++seq}`;
  const todayStr = isoDate(new Date());

  const checkIn = h("input", { type: "date", id: `${id}-in`, name: "checkIn", min: todayStr, value: values.checkIn || "" });
  const checkOut = h("input", { type: "date", id: `${id}-out`, name: "checkOut", min: addDays(todayStr, minNights), value: values.checkOut || "" });
  const guests = h("select", { id: `${id}-guests`, name: "guests" },
    ...Array.from({ length: maxGuests }, (_, i) => h("option", { value: i + 1, selected: (values.guests || 1) === i + 1 }, `${i + 1} guest${i ? "s" : ""}`))
  );
  const err = h("p", { class: "field-error", id: `${id}-err`, hidden: true });

  checkIn.addEventListener("change", () => {
    checkOut.min = addDays(checkIn.value || todayStr, minNights);
    if (checkOut.value && checkOut.value < checkOut.min) checkOut.value = "";
  });

  const form = h("form", {
    class: "booking-widget", "aria-labelledby": `${id}-h`,
    onSubmit: (e) => {
      e.preventDefault();
      err.hidden = true;
      const params = new URLSearchParams();
      if (checkIn.value) params.set("checkIn", checkIn.value);
      if (checkOut.value) params.set("checkOut", checkOut.value);
      params.set("guests", guests.value);
      if (values.car) params.set("car", "1");
      if (checkIn.value && checkOut.value && checkOut.value <= checkIn.value) {
        err.textContent = "Check-out must be after check-in.";
        err.hidden = false;
        return;
      }
      location.href = "/book" + (params.toString() ? "?" + params.toString() : "");
    },
  },
    h("h2", { id: `${id}-h`, class: "booking-widget__title" }, heading),
    fromPrice != null
      ? h("p", { class: "from-price" }, `${copy.fromPricePrefix} `, h("strong", {}, money(fromPrice, currency)), " / night")
      : null,
    h("div", { class: "field-grid" },
      h("div", { class: "field" }, h("label", { for: `${id}-in` }, "Check-in"), checkIn),
      h("div", { class: "field" }, h("label", { for: `${id}-out` }, "Check-out"), checkOut),
    ),
    h("div", { class: "field" }, h("label", { for: `${id}-guests` }, "Guests"), guests),
    err,
    h("button", { type: "submit", class: "btn btn--primary btn--block" }, copy.widgetAction),
    compact ? null : h("p", { class: "from-price" }, copy.ctaReassurance),
  );

  return form;
}

// CtaBand — full-width Hill Green band with a BookingWidget. (design-spec CtaBand)
export function ctaBand({ bookingMode = "request", title, text, property } = {}) {
  const copy = bookingCopy(bookingMode);
  return h("section", { class: "cta-band", "aria-label": "Book this stay" },
    h("div", { class: "container" },
      h("div", {},
        h("h2", {}, title || "Ready when you are"),
        h("p", {}, text || copy.ctaReassurance),
      ),
      bookingWidget({
        bookingMode,
        maxGuests: property?.maxGuests || 4,
        fromPrice: property?.pricing?.nightlyRate ?? null,
        currency: property?.pricing?.currency || "USD",
        minNights: property?.pricing?.minNights || 1,
        heading: "Your dates",
        compact: true,
      }),
    )
  );
}

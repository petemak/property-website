// PriceBreakdown — line items + total.
// `mode` prop: "estimate" (v1) | "final" (v2 checkout). Same markup either way;
// only the caption, the total-field it reads, and the note change. (design-spec P1 §10)

import { h } from "../lib/dom.js";
import { money } from "../lib/format.js";
import { bookingCopy } from "../lib/config.js";

export function priceBreakdown({
  mode = "estimate",
  currency = "USD",
  lineItems = [],
  total,
  disclaimer,
  bookingMode = "request",
  caption,
} = {}) {
  const copy = bookingCopy(bookingMode);
  const isFinal = mode === "final";
  const cap = caption || (isFinal ? "Your total" : copy.estimateLabel);
  const totalLabel = isFinal ? "Total" : `${copy.estimateLabel} total`;

  const table = h("table", { class: "price-breakdown" },
    h("caption", {}, cap),
  );

  if (!lineItems.length && total == null) {
    table.appendChild(h("tbody", {}, h("tr", {}, h("td", { class: "price-breakdown__empty", colspan: "2" }, copy.railEmpty))));
    return wrap(table, null, mode, bookingMode);
  }

  const tbody = h("tbody", {});
  for (const li of lineItems) {
    tbody.appendChild(h("tr", {},
      h("th", { scope: "row" }, li.label),
      h("td", {}, money(li.amount, currency)),
    ));
  }
  table.appendChild(tbody);

  if (total != null) {
    table.appendChild(h("tfoot", {}, h("tr", {},
      h("td", {}, totalLabel),
      h("td", {}, money(total, currency)),
    )));
  }

  return wrap(table, disclaimer, mode, bookingMode);
}

function wrap(table, disclaimer, mode, bookingMode) {
  const copy = bookingCopy(bookingMode);
  const frag = h("div", { class: "price-breakdown-wrap" }, table);
  const note = disclaimer || (mode === "estimate"
    ? "The host confirms the final amount when approving your request. No payment is taken on this site. The car is paid on site."
    : null);
  if (note) frag.appendChild(h("p", { class: "price-breakdown__note" }, note));
  return frag;
}

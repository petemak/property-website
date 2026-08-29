// A4 — Calendar (block/open dates) + pricing.

import { api, ApiError } from "../lib/api.js";
import { h, mount, announce } from "../lib/dom.js";
import { pageTitle, alertBox, confirmModal } from "./shell.js";
import { field, setFieldError, clearErrors } from "../components/form.js";
import { isoDate, addDays, formatDate, money } from "../lib/format.js";

export async function renderAvailability(ctx) {
  const from = isoDate(new Date());
  const to = addDays(from, 120);
  const [blocksRes, pricing, avail] = await Promise.all([
    api.adminBlocks(from, to).catch(() => ({ blocks: [] })),
    api.adminGetPricing().catch(() => null),
    api.getAvailability(from, to).catch(() => ({ unavailableDates: [] })),
  ]);

  const host = h("div", {});
  ctx.mount(h("div", {}, pageTitle("Availability & pricing"), host));
  draw(blocksRes.blocks);

  function draw(blocks) {
    const bookedDates = new Set();
    const manualByDate = new Map();
    for (const b of blocks) {
      let d = b.start;
      while (d < b.end) {
        if (b.source === "booking") bookedDates.add(d);
        else manualByDate.set(d, b);
        d = addDays(d, 1);
      }
    }

    mount(host,
      h("section", { class: "admin-panel" },
        h("h2", {}, "Next 4 months"),
        h("p", { class: "role-note" }, "Red = manual block · green = booked (edit via the booking) · click a manual block to remove it."),
        calendar(from, 4, manualByDate, bookedDates, async (block) => {
          confirmModal({
            title: "Remove this block?",
            body: `${formatDate(block.start)} – ${formatDate(block.end)} · ${block.reason}`,
            confirmLabel: "Remove block",
            onConfirm: async () => {
              await api.adminDeleteBlock(block.id);
              announce("Block removed.");
              const r = await api.adminBlocks(from, to);
              draw(r.blocks);
            },
          });
        }),
      ),
      blockForm(),
      pricingPanel(),
    );
  }

  function blockForm() {
    const start = h("input", { type: "date", id: "b-start", min: from });
    const end = h("input", { type: "date", id: "b-end", min: from });
    const reason = h("input", { type: "text", id: "b-reason", placeholder: "e.g. Owner staying, Maintenance" });
    const errHost = h("div", {});
    const form = h("form", { class: "form", novalidate: true, onSubmit: async (e) => {
      e.preventDefault();
      clearErrors(form); errHost.replaceChildren();
      if (!start.value) return setFieldError(start, "Pick a start date.");
      if (!end.value || end.value <= start.value) return setFieldError(end, "End must be after start (end date is the checkout day, exclusive).");
      try {
        await api.adminCreateBlock({ start: start.value, end: end.value, reason: reason.value.trim() || "Manual block" });
        announce("Dates blocked.");
        const r = await api.adminBlocks(from, to);
        start.value = end.value = reason.value = "";
        draw(r.blocks);
      } catch (err) {
        errHost.replaceChildren(alertBox(err instanceof ApiError && err.code === "dateConflict"
          ? "Those dates overlap an approved booking. Handle it through the booking."
          : err.message));
      }
    } },
      h("h2", {}, "Block dates"),
      h("div", { class: "field-row" }, field({ label: "From", control: start, id: "b-start" }), field({ label: "To (exclusive)", control: end, id: "b-end" })),
      field({ label: "Reason", control: reason, id: "b-reason" }),
      errHost,
      h("button", { class: "btn btn--primary", type: "submit" }, "Block these dates"),
    );
    return h("section", { class: "admin-panel" }, form);
  }

  function pricingPanel() {
    if (!pricing) return h("section", { class: "admin-panel" }, alertBox("Could not load pricing."));
    const rate = h("input", { type: "number", id: "p-rate", min: "1", value: pricing.nightlyRate });
    const clean = h("input", { type: "number", id: "p-clean", min: "0", value: pricing.cleaningFee });
    const minN = h("input", { type: "number", id: "p-min", min: "1", max: "30", value: pricing.minNights });
    const errHost = h("div", {});
    const form = h("form", { class: "form", novalidate: true, onSubmit: async (e) => {
      e.preventDefault();
      clearErrors(form); errHost.replaceChildren();
      const payload = { currency: pricing.currency, nightlyRate: Number(rate.value), cleaningFee: Number(clean.value), minNights: Number(minN.value) };
      if (!(payload.nightlyRate > 0)) return setFieldError(rate, "Nightly rate must be greater than 0.");
      if (payload.cleaningFee < 0) return setFieldError(clean, "Cleaning fee cannot be negative.");
      if (!(payload.minNights >= 1 && payload.minNights <= 30)) return setFieldError(minN, "Minimum nights must be 1–30.");
      try {
        await api.adminPutPricing(payload);
        errHost.replaceChildren(alertBox("Saved. Applies to new quotes and requests immediately.", "success"));
      } catch (err) { errHost.replaceChildren(alertBox(err.message)); }
    } },
      h("h2", {}, "Pricing"),
      h("p", { class: "role-note" }, `Currency: ${pricing.currency} (change in Settings). Changes apply to new quotes immediately; existing approved bookings keep their figures.`),
      h("div", { class: "field-row" },
        field({ label: `Nightly rate (${pricing.currency})`, control: rate, id: "p-rate" }),
        field({ label: `Cleaning fee (${pricing.currency})`, control: clean, id: "p-clean" }),
      ),
      field({ label: "Minimum nights", control: minN, id: "p-min" }),
      errHost,
      h("button", { class: "btn btn--primary", type: "submit" }, "Save pricing"),
    );
    return h("section", { class: "admin-panel" }, form);
  }
}

function calendar(startStr, months, manualByDate, bookedDates, onBlockClick) {
  const wrap = h("div", { class: "stack-lg" });
  const start = new Date(startStr);
  for (let mi = 0; mi < months; mi++) {
    const my = new Date(start.getFullYear(), start.getMonth() + mi, 1);
    const label = my.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    const grid = h("div", { class: "cal-grid", role: "group", "aria-label": label });
    ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].forEach((d) => grid.appendChild(h("div", { class: "cal-dow" }, d)));
    const pad = (my.getDay() + 6) % 7;
    for (let i = 0; i < pad; i++) grid.appendChild(h("div", {}));
    const days = new Date(my.getFullYear(), my.getMonth() + 1, 0).getDate();
    for (let d = 1; d <= days; d++) {
      const dateStr = isoDate(new Date(my.getFullYear(), my.getMonth(), d));
      const manual = manualByDate.get(dateStr);
      const booked = bookedDates.has(dateStr);
      const state = manual ? "blocked" : booked ? "booked" : "open";
      grid.appendChild(h("button", {
        type: "button", class: "cal-cell", dataset: { state },
        "aria-label": `${formatDate(dateStr)} — ${state}${manual ? `: ${manual.reason}` : ""}`,
        disabled: state === "open" || state === "booked",
        onClick: manual ? () => onBlockClick(manual) : null,
      }, String(d), manual ? h("br") : null, manual ? h("small", {}, manual.reason) : null));
    }
    wrap.appendChild(h("div", {}, h("h3", {}, label), grid));
  }
  return wrap;
}

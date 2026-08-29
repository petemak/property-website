// A2 — Booking queue.  A3 — Booking detail, approve / reject.

import { api, ApiError } from "../lib/api.js";
import { h, $, mount, announce } from "../lib/dom.js";
import { pageTitle, alertBox, confirmModal } from "./shell.js";
import { statusBadge } from "../components/status-badge.js";
import { priceBreakdown } from "../components/price-breakdown.js";
import { field, fieldset, setFieldError, clearErrors } from "../components/form.js";
import { money, formatDate, formatDateRange, formatDateTime, uuidv4 } from "../lib/format.js";

const STATUSES = ["pending", "approved", "rejected", "cancelled", "expired", "all"];

export async function renderBookingsList(ctx) {
  const params = new URLSearchParams(location.search);
  const q = {
    status: params.get("status") || "pending",
    q: params.get("q") || "",
    car: params.get("car") || "",
    page: Number(params.get("page")) || 1,
  };

  const statusSel = h("select", { id: "f-status" }, ...STATUSES.map((s) => h("option", { value: s, selected: q.status === s }, cap(s))));
  const carSel = h("select", { id: "f-car" },
    h("option", { value: "", selected: q.car === "" }, "Car: any"),
    h("option", { value: "true", selected: q.car === "true" }, "With car"),
    h("option", { value: "false", selected: q.car === "false" }, "Without car"));
  const search = h("input", { type: "search", id: "f-q", value: q.q, placeholder: "Name, email or reference" });

  function apply() {
    const p = new URLSearchParams();
    p.set("status", statusSel.value);
    if (search.value.trim()) p.set("q", search.value.trim());
    if (carSel.value) p.set("car", carSel.value);
    ctx.navigate(`/admin/bookings?${p.toString()}`);
  }

  const tableHost = h("div", {}, h("p", { class: "is-loading" }, "Loading bookings…"));

  ctx.mount(h("div", {},
    pageTitle("Bookings"),
    h("div", { class: "admin-filters" },
      field({ label: "Status", control: statusSel, id: "f-status" }),
      field({ label: "Car", control: carSel, id: "f-car" }),
      field({ label: "Search", control: search, id: "f-q" }),
      h("button", { class: "btn btn--primary", type: "button", onClick: apply }, "Apply"),
    ),
    tableHost,
  ));
  search.addEventListener("keydown", (e) => { if (e.key === "Enter") apply(); });

  let res;
  try { res = await api.adminBookings({ status: q.status, q: q.q || undefined, car: q.car || undefined, page: q.page }); }
  catch (e) { mount(tableHost, alertBox(e.message)); return; }

  if (!res.items.length) {
    mount(tableHost, h("p", { class: "empty-state" }, `No ${q.status === "all" ? "" : q.status + " "}bookings match.`));
    return;
  }

  mount(tableHost,
    h("table", { class: "admin-table" },
      h("thead", {}, h("tr", {}, ...["Reference", "Guest", "Submitted", "Stay", "Nights", "Guests", "Car", "Estimate", "Status"].map((x) => h("th", { scope: "col" }, x)))),
      h("tbody", {}, ...res.items.map((b) => {
        const go = () => ctx.navigate(`/admin/bookings/${b.id}`);
        return h("tr", { tabindex: "0", onClick: go, onKeydown: (e) => { if (e.key === "Enter") go(); } },
          h("td", {}, b.reference),
          h("td", {}, b.guestName, h("br"), h("span", { class: "role-note" }, b.guestEmail)),
          h("td", {}, formatDate(b.submittedAt)),
          h("td", {}, formatDateRange(b.checkIn, b.checkOut)),
          h("td", {}, String(b.nights)),
          h("td", {}, String(b.guests)),
          h("td", {}, b.carRequested ? "Yes" : "—"),
          h("td", {}, money(b.estimatedTotal, b.currency)),
          h("td", {}, statusBadge(b.status)),
        );
      })),
    ),
    h("p", { class: "role-note" }, `${res.total} total · page ${res.page}`),
  );
}

// ---------------------------------------------------------------------------

export async function renderBookingDetail(ctx, id) {
  let b;
  try { b = await api.adminBooking(id); }
  catch (e) { ctx.mount(h("div", {}, pageTitle("Booking"), alertBox(e.message))); return; }

  const decided = b.status !== "pending";
  const conflicts = b.availabilityConflicts || [];

  ctx.mount(h("div", {},
    h("p", {}, h("a", { href: "/admin/bookings", onClick: (e) => { e.preventDefault(); ctx.navigate("/admin/bookings"); } }, "← All bookings")),
    h("div", { style: "display:flex;gap:1rem;align-items:baseline;flex-wrap:wrap" },
      pageTitle(`Booking ${b.reference}`), statusBadge(b.status)),
    h("p", { class: "role-note" }, `Submitted ${formatDateTime(b.submittedAt)}`),

    conflicts.length
      ? alertBox(`Heads up: ${conflicts.length} night(s) overlap an existing block or booking (${conflicts.map((c) => c.date).join(", ")}).`, "warning")
      : (b.status === "pending" ? alertBox("All requested nights are free — no conflicts.", "success") : null),

    guestPanel(b),
    tripPanel(b),
    b.car?.requested ? carPanel(b) : null,
    estimatePanel(b),
    acceptedDocsPanel(b),

    b.status === "pending" ? approvePanel(ctx, b) : null,
    b.status === "pending" ? rejectPanel(ctx, b) : null,
    decided ? decisionPanel(ctx, b) : null,

    activityPanel(b),
  ));
}

function panel(title, ...body) { return h("section", { class: "admin-panel" }, h("h2", {}, title), ...body); }
function dl(pairs) {
  return h("dl", { class: "detail-list" }, ...pairs.flatMap(([k, v]) => v == null ? [] : [h("dt", {}, k), h("dd", {}, v)]));
}

function guestPanel(b) {
  const g = b.guest;
  return panel("Guest",
    dl([
      ["Name", `${g.firstName} ${g.lastName}`],
      ["Email", h("a", { href: `mailto:${g.email}` }, g.email)],
      ["Phone", g.phone],
      ["Country", g.countryOfResidence],
      ["Purpose", g.purposeOfStay],
    ]),
    b.message ? h("div", {}, h("h3", {}, "Message"), h("p", {}, b.message)) : null,
  );
}
function tripPanel(b) {
  return panel("Trip", dl([
    ["Dates", `${formatDateRange(b.stay.checkIn, b.stay.checkOut)}`],
    ["Nights", String(b.stay.nights)],
    ["Guests", `${b.stay.adults} adults${b.stay.children ? `, ${b.stay.children} children` : ""}`],
  ]));
}
function carPanel(b) {
  const d = b.car.driver || {};
  return panel("Car", dl([
    ["Pick-up / drop-off", `${formatDateRange(b.car.pickUp, b.car.dropOff)} (${b.car.carDays} days)`],
    ["Driver", d.fullName],
    ["Date of birth", d.dateOfBirth],
    ["Licence", `${d.licenceNumber} (${d.licenceCountry})`],
    ["Confirmed requirements", d.meetsRequirements ? "Yes" : "No"],
  ]));
}
function estimatePanel(b) {
  const e = b.estimate || {};
  return panel("System estimate",
    priceBreakdown({ mode: "estimate", currency: e.currency, lineItems: e.lineItems || [], total: e.estimatedTotal }));
}
function acceptedDocsPanel(b) {
  const rows = (b.acceptances || []).map((a) => h("tr", {},
    h("td", {}, a.type), h("td", {}, `v${a.version}`),
    h("td", {}, a.acceptedByName, h("br"), h("span", { class: "role-note" }, a.acceptedByEmail)),
    h("td", {}, formatDateTime(a.acceptedAt)),
    h("td", {}, a.ipAddress), h("td", { style: "max-width:220px;word-break:break-all" }, a.userAgent),
    h("td", {}, a.documentUrl ? h("a", { href: a.documentUrl, target: "_blank", rel: "noopener" }, "Text") : "—"),
  ));
  return panel("Accepted documents",
    b.acceptances?.length
      ? h("table", { class: "admin-table" },
          h("thead", {}, h("tr", {}, ...["Document", "Version", "Accepted by", "At", "IP", "User agent", ""].map((x) => h("th", { scope: "col" }, x)))),
          h("tbody", {}, ...rows))
      : alertBox("No acceptance records on this booking — the acceptance write may not be wired up.", "warning"));
}

// ---- Approve ----
function approvePanel(ctx, b) {
  const e = b.estimate || {};
  const cur = e.currency || "USD";
  const lines = (e.lineItems || []).map((li) => ({ ...li }));
  const linesHost = h("div", { class: "stack" });
  const totalOut = h("output", { style: "font-weight:700;font-size:1.1rem" });

  function recalc() {
    const t = lines.reduce((s, li) => s + Number(li.amount || 0), 0);
    totalOut.textContent = money(t, cur);
    return t;
  }
  function drawLines() {
    linesHost.replaceChildren(...lines.map((li, i) =>
      h("div", { class: "field-row" },
        field({ label: "Description", id: `li-l-${i}`, control: h("input", { type: "text", value: li.label, onInput: (ev) => (li.label = ev.target.value) }) }),
        field({ label: `Amount (${cur})`, id: `li-a-${i}`, control: h("input", { type: "number", step: "0.01", value: li.amount, onInput: (ev) => { li.amount = Number(ev.target.value); recalc(); } }) }),
      )
    ),
      h("button", { class: "btn btn--sm btn--ghost", type: "button", onClick: () => { lines.push({ code: "other", label: "", amount: 0 }); drawLines(); recalc(); } }, "Add line"),
    );
  }
  drawLines();

  const payInstr = h("textarea", { id: "ap-pay", placeholder: "e.g. 50% bank transfer to confirm within 3 days, balance on arrival." });
  const address = h("input", { type: "text", id: "ap-addr", placeholder: "House 12, KG 5 Ave, Rebero, Kigali" });
  const mapUrl = h("input", { type: "url", id: "ap-map", placeholder: "https://maps.google.com/…" });
  const checkIn = h("textarea", { id: "ap-ci", placeholder: "Lockbox code, gate instructions, early check-in notes…" });
  const carColl = h("input", { type: "text", id: "ap-car", placeholder: "Keys at the house on arrival; bring licence + passport." });
  const hostContact = h("input", { type: "text", id: "ap-host", placeholder: "Jean — +250 7xx xxx xxx / host@kigalikeys.rw" });
  const note = h("textarea", { id: "ap-note", placeholder: "Optional personal note to the guest." });
  const blockDates = h("input", { type: "checkbox", id: "ap-block", checked: true });
  const blockCar = h("input", { type: "checkbox", id: "ap-blockcar", checked: true });

  const errHost = h("div", {});
  const form = h("form", { class: "form", novalidate: true, onSubmit: (ev) => { ev.preventDefault(); openConfirm(); } });

  mount(form,
    h("h3", {}, "Line items"), linesHost,
    h("p", {}, "Final total: ", totalOut),
    fieldset("Details for the guest",
      field({ label: "Payment instructions", control: payInstr, id: "ap-pay" }),
      field({ label: "Exact address", control: address, id: "ap-addr" }),
      field({ label: "Map link", control: mapUrl, id: "ap-map" }),
      field({ label: "Check-in instructions", control: checkIn, id: "ap-ci" }),
      b.car?.requested ? field({ label: "Car collection details", control: carColl, id: "ap-car" }) : null,
      field({ label: "Host contact", control: hostContact, id: "ap-host" }),
      field({ label: "Personal note (optional)", control: note, id: "ap-note" }),
    ),
    h("div", { class: "checkbox-field" }, blockDates, h("label", { for: "ap-block" }, "Block these dates on approval")),
    b.car?.requested ? h("div", { class: "checkbox-field" }, blockCar, h("label", { for: "ap-blockcar" }, "Block the car for these dates")) : null,
    errHost,
    h("button", { class: "btn btn--primary", type: "submit" }, "Approve & send email"),
  );
  recalc();

  function buildPayload() {
    return {
      currency: cur,
      lineItems: lines.map((li) => ({ code: li.code || "other", label: li.label, amount: Number(li.amount) })),
      total: recalc(),
      paymentInstructions: payInstr.value.trim(),
      addressLine: address.value.trim(),
      mapUrl: mapUrl.value.trim() || undefined,
      checkInInstructions: checkIn.value.trim(),
      carCollection: b.car?.requested ? carColl.value.trim() : undefined,
      hostContact: hostContact.value.trim(),
      note: note.value.trim() || undefined,
      blockDates: blockDates.checked,
      blockCarDates: b.car?.requested ? blockCar.checked : undefined,
    };
  }

  function openConfirm() {
    clearErrors(form); errHost.replaceChildren();
    const p = buildPayload();
    let ok = true;
    if (!p.addressLine) { setFieldError(address, "The exact address is required."); ok = false; }
    if (!p.checkInInstructions) { setFieldError(checkIn, "Check-in instructions are required."); ok = false; }
    if (b.car?.requested && !p.carCollection) { setFieldError(carColl, "Car collection details are required."); ok = false; }
    if (!ok) return;

    const key = uuidv4();
    confirmModal({
      title: "Send the approval email?",
      body: emailPreview("bookingApproved", b, p),
      confirmLabel: "Confirm & send",
      onConfirm: async () => {
        try {
          await api.adminApprove(b.id, p, key);
          announce("Booking approved and the guest emailed.");
          ctx.navigate(`/admin/bookings/${b.id}`);
        } catch (err) {
          if (err instanceof ApiError && err.code === "dateConflict") {
            throw new Error(err.message + " — reject this request, or re-submit with 'Block these dates' off.");
          }
          if (err instanceof ApiError && err.code === "alreadyDecided") {
            ctx.navigate(`/admin/bookings/${b.id}`);
            return;
          }
          throw err;
        }
      },
    });
  }

  return panel("Approve", form);
}

// ---- Reject ----
function rejectPanel(ctx, b) {
  const explanation = h("textarea", { id: "rj-exp", minlength: "20", maxlength: "1500",
    placeholder: "This text is sent to the guest word for word. Explain why, and offer an alternative if you can." });
  const internal = h("textarea", { id: "rj-int", placeholder: "Internal note (not sent to the guest)." });
  const errHost = h("div", {});

  const form = h("form", { class: "form", novalidate: true, onSubmit: (ev) => {
    ev.preventDefault();
    clearErrors(form); errHost.replaceChildren();
    if (explanation.value.trim().length < 20) { setFieldError(explanation, "The explanation must be at least 20 characters — it goes to the guest."); return; }
    const p = { explanation: explanation.value.trim(), internalNote: internal.value.trim() || undefined };
    const key = uuidv4();
    confirmModal({
      title: "Send the rejection email?",
      body: emailPreview("bookingRejected", b, p),
      confirmLabel: "Confirm & send",
      onConfirm: async () => {
        try {
          await api.adminReject(b.id, p, key);
          announce("Booking rejected and the guest emailed.");
          ctx.navigate(`/admin/bookings/${b.id}`);
        } catch (err) {
          if (err instanceof ApiError && err.code === "alreadyDecided") { ctx.navigate(`/admin/bookings/${b.id}`); return; }
          throw err;
        }
      },
    });
  } },
    field({ label: "Explanation to the guest", control: explanation, id: "rj-exp", hint: "Minimum 20 characters. Sent verbatim." }),
    field({ label: "Internal note (optional)", control: internal, id: "rj-int" }),
    errHost,
    h("button", { class: "btn btn--ghost", type: "submit" }, "Reject & send email"),
  );
  return panel("Reject", form);
}

function decisionPanel(ctx, b) {
  if (b.status === "approved" && b.approvalDetails) {
    const a = b.approvalDetails;
    return panel("Approved — what was sent",
      priceBreakdown({ mode: "final", currency: a.currency, lineItems: a.lineItems || [], total: a.total, caption: "Final total" }),
      dl([
        ["Decided", formatDateTime(b.decision?.decidedAt)],
        ["Address", a.addressLine], ["Payment", a.paymentInstructions],
        ["Check-in", a.checkInInstructions], ["Car collection", a.carCollection],
        ["Host contact", a.hostContact], ["Note", a.note],
      ]),
      h("div", { class: "wizard-actions" },
        h("a", { class: "btn btn--ghost", href: `/booking/${b.reference}`, target: "_blank", rel: "noopener" }, "View on guest status page"),
      ),
    );
  }
  if (b.status === "rejected") {
    return panel("Rejected",
      dl([["Decided", formatDateTime(b.decision?.decidedAt)]]),
      h("h3", {}, "Explanation sent to guest"), h("p", {}, b.decision?.explanation),
      b.decision?.internalNote ? h("div", {}, h("h3", {}, "Internal note"), h("p", { class: "role-note" }, b.decision.internalNote)) : null,
    );
  }
  return panel(cap(b.status), dl([["Decided", formatDateTime(b.decision?.decidedAt)]]));
}

function activityPanel(b) {
  return panel("Activity log", h("ul", {}, ...(b.activityLog || []).map((a) =>
    h("li", {}, `${formatDateTime(a.at)} — ${a.actor} ${a.event}`))));
}

function emailPreview(key, b, payload) {
  const g = b.guest;
  const lines = [];
  lines.push(`To: ${g.email}`);
  if (key === "bookingApproved") {
    lines.push(`Subject: Your Kigali Keys stay is confirmed — ${b.reference}`, "", `Hi ${g.firstName},`, "",
      `Great news — your stay for ${formatDateRange(b.stay.checkIn, b.stay.checkOut)} is confirmed.`, "",
      ...(payload.lineItems || []).map((li) => `  ${li.label}: ${money(li.amount, payload.currency)}`),
      `  Total: ${money(payload.total, payload.currency)}`, "",
      payload.paymentInstructions, "", `Address: ${payload.addressLine}`, "",
      payload.checkInInstructions,
      b.car?.requested ? `\nCar: ${payload.carCollection}` : "",
      "", payload.hostContact, payload.note ? `\n${payload.note}` : "");
  } else {
    lines.push(`Subject: About your Kigali Keys request — ${b.reference}`, "", `Hi ${g.firstName},`, "",
      `Thank you for your request for ${formatDateRange(b.stay.checkIn, b.stay.checkOut)}. Unfortunately the host can't take this one:`, "",
      payload.explanation, "", "You're welcome to send a new request for different dates.");
  }
  return h("div", {},
    h("p", { class: "role-note" }, "This is exactly what the guest receives (inside the brand email wrapper)."),
    h("pre", { class: "email-preview", style: "white-space:pre-wrap;font:inherit" }, lines.filter((l) => l !== undefined).join("\n")),
  );
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

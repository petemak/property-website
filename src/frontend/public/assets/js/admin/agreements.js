// A8 — Agreement acceptance log (audit).

import { api } from "../lib/api.js";
import { h, mount } from "../lib/dom.js";
import { pageTitle, alertBox, confirmModal } from "./shell.js";
import { field } from "../components/form.js";
import { renderMarkdown } from "../lib/markdown.js";
import { formatDateTime } from "../lib/format.js";

const TYPES = ["", "stayTerms", "houseRules", "vehicleRentalAgreement"];

export async function renderAgreements(ctx) {
  const params = new URLSearchParams(location.search);
  const typeSel = h("select", { id: "a-type" }, ...TYPES.map((t) => h("option", { value: t, selected: params.get("type") === t }, t || "All document types")));
  const emailInp = h("input", { type: "search", id: "a-email", value: params.get("email") || "", placeholder: "guest email" });
  const refInp = h("input", { type: "search", id: "a-ref", value: params.get("bookingReference") || "", placeholder: "KK-…" });

  const host = h("div", {}, h("p", { class: "is-loading" }, "Loading…"));
  ctx.mount(h("div", {},
    pageTitle("Agreement acceptance log"),
    h("p", { class: "role-note" }, "Read-only. Rows are written only when a booking is submitted — there is no way to add one here."),
    h("div", { class: "admin-filters" },
      field({ label: "Type", control: typeSel, id: "a-type" }),
      field({ label: "Guest email", control: emailInp, id: "a-email" }),
      field({ label: "Booking ref", control: refInp, id: "a-ref" }),
      h("button", { class: "btn btn--primary", type: "button", onClick: () => {
        const p = new URLSearchParams();
        if (typeSel.value) p.set("type", typeSel.value);
        if (emailInp.value.trim()) p.set("email", emailInp.value.trim());
        if (refInp.value.trim()) p.set("bookingReference", refInp.value.trim());
        ctx.navigate("/admin/agreements" + (p.toString() ? "?" + p : ""));
      } }, "Filter"),
    ),
    host,
  ));

  let res;
  try {
    res = await api.adminAcceptances({
      type: params.get("type") || undefined,
      email: params.get("email") || undefined,
      bookingReference: params.get("bookingReference") || undefined,
    });
  } catch (e) { mount(host, alertBox(e.message)); return; }

  if (!res.items.length) { mount(host, h("p", { class: "empty-state" }, "No acceptance records match. If bookings with the car exist and this is empty, the acceptance write is not wired up.")); return; }

  mount(host,
    h("table", { class: "admin-table" },
      h("thead", {}, h("tr", {}, ...["ID", "Booking", "Type", "Version", "Accepted by", "At", "IP", ""].map((x) => h("th", { scope: "col" }, x)))),
      h("tbody", {}, ...res.items.map((a) => h("tr", {},
        h("td", {}, a.id),
        h("td", {}, h("a", { href: "#", onClick: (e) => { e.preventDefault(); ctx.navigate(`/admin/bookings?q=${a.bookingReference}`); } }, a.bookingReference)),
        h("td", {}, a.type), h("td", {}, `v${a.version}`),
        h("td", {}, a.acceptedByName, h("br"), h("span", { class: "role-note" }, a.acceptedByEmail)),
        h("td", {}, formatDateTime(a.acceptedAt)), h("td", {}, a.ipAddress),
        h("td", {}, h("button", { class: "btn btn--sm btn--ghost", type: "button", onClick: () => openRecord(a.id) }, "Open")),
      ))),
    ),
    h("p", { class: "role-note" }, `${res.total} records`),
  );

  async function openRecord(id) {
    const rec = await api.adminAcceptance(id);
    const snap = rec.documentSnapshot || {};
    confirmModal({
      title: `Acceptance ${rec.id}`,
      confirmLabel: "Close",
      onConfirm: async () => {},
      body: h("div", { class: "stack" },
        h("dl", { class: "detail-list" },
          h("dt", {}, "Booking"), h("dd", {}, rec.bookingReference),
          h("dt", {}, "Document"), h("dd", {}, `${rec.type} v${rec.version}`),
          h("dt", {}, "Accepted by"), h("dd", {}, `${rec.acceptedByName} <${rec.acceptedByEmail}>`),
          h("dt", {}, "At"), h("dd", {}, formatDateTime(rec.acceptedAt)),
          h("dt", {}, "IP"), h("dd", {}, rec.ipAddress),
          h("dt", {}, "User agent"), h("dd", { style: "word-break:break-all" }, rec.userAgent),
          h("dt", {}, "Body hash"), h("dd", { style: "word-break:break-all" }, rec.bodyHash || "—"),
        ),
        h("h3", {}, "Document as accepted"),
        h("div", { class: "agreement-panel__body", html: renderMarkdown(snap.bodyMarkdown || "(snapshot not available)") }),
      ),
    });
  }
}

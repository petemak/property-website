// A7 — Edit car details + daily rate + publish agreement versions.

import { api } from "../lib/api.js";
import { h, mount, announce } from "../lib/dom.js";
import { pageTitle, alertBox, confirmModal } from "./shell.js";
import { field, fieldset } from "../components/form.js";
import { agreementPanel } from "../components/agreement-panel.js";
import { formatDate, isoDate } from "../lib/format.js";

export async function renderVehicle(ctx) {
  let v, versions;
  try {
    v = await api.adminGetVehicle();
    versions = (await api.adminAgreementVersions().catch(() => ({ versions: v.versions || [] }))).versions;
  } catch (e) { ctx.mount(h("div", {}, pageTitle("The car"), alertBox(e.message))); return; }

  const status = h("div", { "aria-live": "polite" });

  const offered = h("input", { type: "checkbox", checked: v.offered, id: "v-offered" });
  const name = inp(v.name), year = inp(v.year, "number"), body = inp(v.bodyType), trans = inp(v.transmission);
  const seats = inp(v.seats, "number"), fuel = inp(v.fuel), luggage = inp(v.luggage);
  const rate = inp(v.dailyRate, "number"), deposit = inp(v.depositAmount, "number");
  const geo = inp(v.geographicLimit);
  const minAge = inp(v.minDriverAge ?? 23, "number"), minYears = inp(v.minLicenceYears ?? 2, "number");
  const desc = h("textarea", { rows: "4", value: v.description || "", style: "width:100%" });
  const reqs = listArea(v.driverRequirements);
  const covered = listArea(v.covered);
  const notCovered = listArea(v.notCovered);

  ctx.mount(h("div", {},
    pageTitle("The car"),
    status,

    h("section", { class: "admin-panel" },
      h("h2", {}, "Car details"),
      h("div", { class: "checkbox-field" }, offered, h("label", { for: "v-offered" }, "Car currently offered to guests")),
      fieldset("Specs",
        h("div", { class: "field-row" }, field({ label: "Name", control: name }), field({ label: "Year", control: year })),
        h("div", { class: "field-row" }, field({ label: "Body type", control: body }), field({ label: "Transmission", control: trans })),
        h("div", { class: "field-row" }, field({ label: "Seats", control: seats }), field({ label: "Fuel", control: fuel })),
        field({ label: "Luggage", control: luggage }),
      ),
      fieldset("Commercial",
        h("div", { class: "field-row" }, field({ label: `Daily rate (${v.currency})`, control: rate }), field({ label: `Deposit / excess (${v.currency})`, control: deposit })),
        field({ label: "Geographic limit", control: geo }),
        h("div", { class: "field-row" }, field({ label: "Minimum driver age", control: minAge }), field({ label: "Min licence years", control: minYears })),
      ),
      field({ label: "Description", control: desc }),
      field({ label: "Driver requirements (one per line)", control: reqs.el }),
      field({ label: "Covered (one per line)", control: covered.el }),
      field({ label: "Not covered (one per line)", control: notCovered.el }),
      h("button", { class: "btn btn--primary", type: "button", onClick: async () => {
        status.replaceChildren();
        try {
          await api.adminPutVehicle({
            offered: offered.checked, name: name.value, year: Number(year.value), bodyType: body.value,
            transmission: trans.value, seats: Number(seats.value), fuel: fuel.value, luggage: luggage.value,
            dailyRate: Number(rate.value), description: desc.value,
            driverRequirements: reqs.value(), covered: covered.value(), notCovered: notCovered.value(),
            depositAmount: Number(deposit.value), geographicLimit: geo.value,
            minDriverAge: Number(minAge.value), minLicenceYears: Number(minYears.value),
          });
          status.replaceChildren(alertBox("Car details saved. The agreement text is unchanged.", "success"));
        } catch (e) { status.replaceChildren(alertBox(e.message)); }
      } }, "Save car details"),
    ),

    h("section", { class: "admin-panel" },
      h("h2", {}, "Rental agreement versions"),
      h("table", { class: "admin-table" },
        h("thead", {}, h("tr", {}, ...["Version", "Effective", "Published", "By", "Acceptances", ""].map((x) => h("th", { scope: "col" }, x)))),
        h("tbody", {}, ...versions.map((ver) => h("tr", {},
          h("td", {}, `v${ver.version}`), h("td", {}, formatDate(ver.effectiveDate)),
          h("td", {}, formatDate(ver.publishedAt)), h("td", {}, ver.publishedBy || "—"),
          h("td", {}, String(ver.acceptanceCount ?? "—")),
          h("td", {}, ver.isCurrent ? h("span", { class: "chip" }, "Current") : ""),
        ))),
      ),
      draftForm(ctx, v),
    ),

    h("section", { class: "admin-panel" },
      h("h2", {}, "Preview (as guests see it at P12)"),
      agreementPanel({ title: "Kia Sorento Rental Agreement", version: v.agreement.version, effectiveDate: v.agreement.effectiveDate, bodyMarkdown: v.agreement.bodyMarkdown }),
    ),
  ));

  function draftForm() {
    const bodyMd = h("textarea", { rows: "10", style: "width:100%", placeholder: "# Kia Sorento Rental Agreement\n\n## 1. Parties …" });
    const summary = h("textarea", { rows: "4", style: "width:100%", placeholder: "One summary bullet per line" });
    const eff = h("input", { type: "date", min: isoDate(new Date()) });
    const errHost = h("div", {});
    return h("form", { class: "form", style: "margin-top:1rem", novalidate: true, onSubmit: (e) => {
      e.preventDefault();
      errHost.replaceChildren();
      if ((bodyMd.value || "").length < 200) { errHost.replaceChildren(alertBox("The agreement body must be at least 200 characters.")); return; }
      if (!eff.value) { errHost.replaceChildren(alertBox("Set an effective date (today or later).")); return; }
      confirmModal({
        title: "Publish a new agreement version?",
        body: "This changes what new guests accept. Agreements already accepted are unchanged, and their exact text is preserved.",
        confirmLabel: "Publish new version",
        onConfirm: async () => {
          await api.adminPublishAgreement({
            bodyMarkdown: bodyMd.value,
            summaryPoints: summary.value.split("\n").map((s) => s.trim()).filter(Boolean),
            effectiveDate: eff.value,
          });
          announce("New agreement version published.");
          ctx.navigate("/admin/vehicle");
        },
      });
    } },
      h("h3", {}, "Draft a new version"),
      field({ label: "Agreement body (markdown)", control: bodyMd }),
      field({ label: "Summary points", control: summary }),
      field({ label: "Effective date", control: eff }),
      errHost,
      h("button", { class: "btn btn--primary", type: "submit" }, "Publish"),
    );
  }
}

function inp(value, type = "text") { return h("input", { type, value: value ?? "" }); }
function listArea(arr) {
  const ta = h("textarea", { rows: "4", style: "width:100%", value: (arr || []).join("\n") });
  return { el: ta, value: () => ta.value.split("\n").map((s) => s.trim()).filter(Boolean) };
}

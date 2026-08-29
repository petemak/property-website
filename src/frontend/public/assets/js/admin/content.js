// A5 — Property text. Section editors with Save + revert.

import { api } from "../lib/api.js";
import { h, mount } from "../lib/dom.js";
import { pageTitle, alertBox } from "./shell.js";
import { field } from "../components/form.js";

export async function renderContent(ctx) {
  let prop;
  try { prop = await api.adminGetProperty(); }
  catch (e) { ctx.mount(h("div", {}, pageTitle("Property text"), alertBox(e.message))); return; }

  const saved = structuredClone(prop);
  const status = h("div", { "aria-live": "polite" });

  async function save(patch) {
    status.replaceChildren();
    try {
      const updated = await api.adminPutProperty({ ...editable(prop), ...patch });
      Object.assign(prop, updated);
      status.replaceChildren(alertBox("Saved. Preview it on the live site.", "success"));
    } catch (e) { status.replaceChildren(alertBox(e.message)); }
  }

  const summary = textarea(prop.summary, (v) => (prop.summary = v));
  const description = textarea(prop.description, (v) => (prop.description = v), 8);
  const neighbourhood = textarea(prop.neighbourhoodText, (v) => (prop.neighbourhoodText = v));
  const arrival = textarea(prop.arrivalGuide, (v) => (prop.arrivalGuide = v), 6);
  const withoutCar = textarea(prop.gettingAroundWithoutCar, (v) => (prop.gettingAroundWithoutCar = v));
  const included = listArea(prop.included, (v) => (prop.included = v));
  const notIncluded = listArea(prop.notIncluded, (v) => (prop.notIncluded = v));
  const rules = listArea(prop.houseRulesSummary, (v) => (prop.houseRulesSummary = v));

  ctx.mount(h("div", {},
    pageTitle("Property text"),
    h("p", {}, h("a", { href: "/", target: "_blank", rel: "noopener" }, "Preview on site ↗")),
    status,
    section("Summary (hero sub-line)", summary),
    section("Full description", description),
    section("Neighbourhood text", neighbourhood),
    section("Arrival guide", arrival),
    section("Getting around without the car", withoutCar),
    section("Included list", included.el),
    section("Not-included list", notIncluded.el),
    section("House rules summary", rules.el),
    h("div", { class: "wizard-actions" },
      h("button", { class: "btn btn--primary", type: "button", onClick: () => save({
        summary: prop.summary, description: prop.description, neighbourhoodText: prop.neighbourhoodText,
        arrivalGuide: prop.arrivalGuide, gettingAroundWithoutCar: prop.gettingAroundWithoutCar,
        included: included.value(), notIncluded: notIncluded.value(), houseRulesSummary: rules.value(),
      }) }, "Save all changes"),
      h("button", { class: "btn btn--ghost", type: "button", onClick: () => { Object.assign(prop, structuredClone(saved)); ctx.navigate("/admin/content"); } }, "Revert to last saved"),
    ),
    h("p", { class: "role-note" }, "Amenities, FAQ, check-in steps and travel times are also editable here in the full build; the fields above cover the prose sections."),
  ));

  function section(title, control) {
    return h("section", { class: "admin-panel" }, h("h2", {}, title), control);
  }
}

function editable(p) {
  const { pricing, termsVersions, bookingMode, updatedAt, ...rest } = p;
  return rest;
}
function textarea(value, onInput, rows = 3) {
  return h("textarea", { rows: String(rows), value: value || "", onInput: (e) => onInput(e.target.value), style: "width:100%" });
}
function listArea(arr, onChange) {
  const ta = h("textarea", { rows: "5", value: (arr || []).join("\n"), style: "width:100%",
    onInput: (e) => onChange(e.target.value.split("\n").map((s) => s.trim()).filter(Boolean)) });
  return { el: h("div", {}, h("p", { class: "role-note" }, "One item per line."), ta), value: () => ta.value.split("\n").map((s) => s.trim()).filter(Boolean) };
}

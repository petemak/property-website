// Form primitives — label always visible; errors are text and linked via aria-describedby.

import { h } from "../lib/dom.js";

let seq = 0;

export function field({ label, control, id, hint, required }) {
  id = id || control.id || `f-${++seq}`;
  control.id = id;
  const hintId = hint ? `${id}-hint` : null;
  const errId = `${id}-err`;
  const describedBy = [hintId].filter(Boolean).join(" ");
  if (describedBy) control.setAttribute("aria-describedby", describedBy);

  const wrap = h("div", { class: "field", dataset: { fieldFor: id } },
    h("label", { for: id }, label, required ? h("span", { "aria-hidden": "true" }, " *") : null),
    hint ? h("span", { class: "hint", id: hintId }, hint) : null,
    control,
    h("p", { class: "field-error", id: errId, hidden: true, role: "alert" }),
  );
  return wrap;
}

export function fieldset(legend, ...children) {
  return h("fieldset", {}, h("legend", {}, legend), ...children);
}

export function setFieldError(control, message) {
  const wrap = control.closest(".field");
  if (!wrap) return;
  wrap.classList.add("field--error");
  control.setAttribute("aria-invalid", "true");
  const err = wrap.querySelector(".field-error");
  if (err) {
    err.textContent = message;
    err.hidden = false;
    const ids = (control.getAttribute("aria-describedby") || "").split(" ").filter(Boolean);
    if (!ids.includes(err.id)) { ids.push(err.id); control.setAttribute("aria-describedby", ids.join(" ")); }
  }
}

export function clearErrors(root) {
  root.querySelectorAll(".field--error").forEach((w) => w.classList.remove("field--error"));
  root.querySelectorAll(".field-error").forEach((e) => { e.hidden = true; e.textContent = ""; });
  root.querySelectorAll('[aria-invalid="true"]').forEach((c) => c.removeAttribute("aria-invalid"));
}

// Accessible guests stepper (adults / children)
export function numberStepper({ label, id, value = 0, min = 0, max = 10, onChange = () => {} }) {
  const output = h("output", { for: id }, String(value));
  let v = Math.max(min, Math.min(max, value));
  const paint = () => {
    output.textContent = String(v);
    dec.disabled = v <= min;
    inc.disabled = v >= max;
  };
  const set = (next, fire = true) => {
    v = Math.max(min, Math.min(max, next));
    paint();
    if (fire) onChange(v);
  };
  const dec = h("button", { type: "button", "aria-label": `Decrease ${label}`, onClick: () => set(v - 1) }, "−");
  const inc = h("button", { type: "button", "aria-label": `Increase ${label}`, onClick: () => set(v + 1) }, "+");
  const group = h("div", { class: "field" },
    h("span", { id: `${id}-label`, class: "label", style: "font-weight:600" }, label),
    h("div", { class: "stepper-input", role: "group", "aria-labelledby": `${id}-label` }, dec, output, inc),
  );
  paint();
  return { el: group, get value() { return v; }, set: (n) => set(n) };
}

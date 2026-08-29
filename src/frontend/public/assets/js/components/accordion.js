// Accordion — single open at a time, keyboard operable. (design-spec P1 FAQ, P7)

import { h } from "../lib/dom.js";

let uid = 0;

export function accordion(items, { singleOpen = true } = {}) {
  const root = h("div", { class: "accordion" });
  const triggers = [];

  items.forEach((item, i) => {
    const id = `acc-${++uid}`;
    const panel = h("div", { class: "accordion__panel", id: `${id}-panel`, role: "region", "aria-labelledby": `${id}-btn`, hidden: true },
      typeof item.body === "string" ? h("p", {}, item.body) : item.body);

    const trigger = h("button", {
      class: "accordion__trigger", type: "button", id: `${id}-btn`,
      "aria-expanded": "false", "aria-controls": `${id}-panel`,
      onClick: () => toggle(i),
      onKeydown: (e) => {
        if (e.key === "ArrowDown") { e.preventDefault(); triggers[(i + 1) % triggers.length].focus(); }
        if (e.key === "ArrowUp") { e.preventDefault(); triggers[(i - 1 + triggers.length) % triggers.length].focus(); }
      },
    }, h("span", {}, item.title), h("span", { class: "accordion__marker", "aria-hidden": "true" }, "+"));

    triggers.push(trigger);
    root.appendChild(h("div", { class: "accordion__item" }, h("h3", { style: "margin:0" }, trigger), panel));
  });

  function toggle(idx) {
    const trigger = triggers[idx];
    const panel = document.getElementById(trigger.getAttribute("aria-controls"));
    const willOpen = trigger.getAttribute("aria-expanded") === "false";
    if (singleOpen) {
      triggers.forEach((t) => {
        t.setAttribute("aria-expanded", "false");
        document.getElementById(t.getAttribute("aria-controls")).hidden = true;
      });
    }
    trigger.setAttribute("aria-expanded", String(willOpen));
    panel.hidden = !willOpen;
  }

  return root;
}

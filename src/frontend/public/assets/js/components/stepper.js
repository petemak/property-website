// Stepper — renders from a config array (never hard-coded to 4 steps).
// A v2 payment step is a data entry in config.js, not a markup change.

import { h } from "../lib/dom.js";

export function stepper(steps, activeId) {
  const activeIndex = steps.findIndex((s) => s.id === activeId);
  return h("ol", { class: "stepper", "aria-label": `Step ${activeIndex + 1} of ${steps.length}` },
    ...steps.map((s, i) =>
      h("li", {
        "aria-current": s.id === activeId ? "step" : null,
        "data-done": i < activeIndex ? "true" : "false",
      }, s.label)
    )
  );
}

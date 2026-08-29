// AgreementPanel — scrollable versioned document + (optionally) an accept checkbox.
// Used in P5 step 4 (with checkbox), A7 preview and P12 (no checkbox).

import { h } from "../lib/dom.js";
import { renderMarkdown } from "../lib/markdown.js";
import { formatDate } from "../lib/format.js";

let seq = 0;

export function agreementPanel({
  title = "Agreement",
  version,
  effectiveDate,
  bodyMarkdown = "",
  fullLink,
  checkbox = null, // { label, checked, onToggle }  -> renders the accept checkbox
} = {}) {
  const id = `agr-${++seq}`;
  const body = h("div", { class: "agreement-panel__body", tabindex: "0", role: "region", "aria-label": `${title} full text` });
  body.innerHTML = renderMarkdown(bodyMarkdown);

  const panel = h("div", { class: "agreement-panel" },
    h("div", { class: "agreement-panel__head" },
      h("strong", {}, `${title}${version != null ? ` · Version ${version}` : ""}${effectiveDate ? ` · effective ${formatDate(effectiveDate)}` : ""}`),
      fullLink ? h("a", { href: fullLink, target: "_blank", rel: "noopener" }, "Open full agreement") : null,
    ),
    body,
  );

  if (!checkbox) return panel;

  const input = h("input", {
    type: "checkbox", id, checked: !!checkbox.checked,
    onChange: (e) => checkbox.onToggle(e.target.checked),
  });
  return h("div", { class: "stack" },
    panel,
    h("div", { class: "checkbox-field" }, input, h("label", { for: id }, checkbox.label)),
  );
}

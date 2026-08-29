// P8–P12 — shared LegalPage template.

import { initPublicPage, errorNotice } from "./common.js";
import { api } from "../lib/api.js";
import { h, $, mount } from "../lib/dom.js";
import { renderMarkdown } from "../lib/markdown.js";
import { formatDate } from "../lib/format.js";

const root = $("#legal-root");
const type = root.dataset.docType;
const title = root.dataset.docTitle;
const showBanner = root.dataset.docBanner === "1";

(async function () {
  await initPublicPage();
  let doc;
  try { doc = await api.getDocument(type, "current"); }
  catch (e) { root.className = "container section"; mount(root, h("h1", {}, title), errorNotice(e)); return; }

  const bodyHtml = renderMarkdown(doc.bodyMarkdown || "");
  const tmp = document.createElement("div");
  tmp.innerHTML = bodyHtml;
  const headings = Array.from(tmp.querySelectorAll("h2")).map((el, i) => {
    const id = `s-${i}-${el.textContent.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`;
    el.id = id;
    return { id, text: el.textContent };
  });

  root.className = "container section";
  mount(root,
    h("header", { class: "page-hero" },
      h("h1", {}, title),
      h("p", { class: "doc-version-line" }, `Version ${doc.version} · last updated ${formatDate(doc.effectiveDate)}`),
      showBanner
        ? h("div", { class: "inline-alert inline-alert--warning", role: "note", style: "margin-top:1rem" },
            h("span", { class: "inline-alert__icon", "aria-hidden": "true" }, "i"),
            h("span", {}, "This is the current version. If you have a booking, the version you accepted is shown on your booking status page."))
        : null,
    ),
    h("div", { class: "legal-layout" },
      headings.length
        ? h("nav", { class: "legal-toc", "aria-label": "On this page" },
            h("h2", { style: "font-size:1rem" }, "On this page"),
            h("ul", {}, ...headings.map((x) => h("li", {}, h("a", { href: `#${x.id}` }, x.text)))))
        : h("div", {}),
      h("article", { class: "prose", html: tmp.innerHTML }),
    ),
    type === "vehicleRentalAgreement"
      ? h("p", { style: "margin-top:2rem" }, h("a", { class: "btn btn--ghost", href: "/the-car" }, "Back to the car"))
      : h("p", { style: "margin-top:2rem" }, h("a", { class: "btn btn--ghost", href: "/" }, "Back to the home page")),
  );
})();

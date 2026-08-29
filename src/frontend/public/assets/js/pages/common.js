// Shared bootstrap for every public page.

import { api } from "../lib/api.js";
import { renderHeader, renderFooter, wireHeroHeader } from "../components/site-chrome.js";
import { h, $ } from "../lib/dom.js";

export { wireHeroHeader };

let propertyPromise;
export function getProperty() {
  if (!propertyPromise) propertyPromise = api.getProperty().catch((e) => { propertyPromise = null; throw e; });
  return propertyPromise;
}

export async function initPublicPage({ transparentHeader = false } = {}) {
  document.documentElement.classList.remove("no-js");
  let property = null;
  try { property = await getProperty(); } catch { /* chrome still renders with fallbacks */ }

  renderHeader({ transparentOverHero: transparentHeader, bookingMode: property?.bookingMode || "request" });
  renderFooter(property);
  // Note: pages with a hero must call wireHeroHeader() AFTER they mount the hero.
  if (transparentHeader) document.body.classList.add("has-transparent-header");

  return { property };
}

export function errorNotice(err, { region } = {}) {
  const msg = err?.message || "Something went wrong loading this section.";
  const el = h("div", { class: "inline-alert inline-alert--error", role: "alert" },
    h("span", { class: "inline-alert__icon", "aria-hidden": "true" }, "!"),
    h("span", {}, msg),
  );
  if (region) region.replaceChildren(el);
  return el;
}

export function loading(text = "Loading…") {
  return h("p", { class: "is-loading" }, text);
}

export function sectionRegion(id, label) {
  return h("section", { class: "section", id, "aria-label": label, "data-region": "" });
}

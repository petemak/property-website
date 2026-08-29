// Lightbox — focus-trapped modal, prev/next, caption, counter, keyboard + swipe.
// Esc closes and returns focus to the trigger. (design-spec P2, accessibility notes)

import { h, trapFocus, announce } from "../lib/dom.js";
import { smartImage } from "./media.js";

let el, releaseTrap, images = [], index = 0, triggerEl = null;

function ensureDom() {
  if (el) return;
  el = h("div", { class: "lightbox", role: "dialog", "aria-modal": "true", "aria-label": "Photo viewer", hidden: true },
    h("div", { class: "lightbox__bar" },
      h("span", { class: "lightbox__counter", "aria-live": "polite" }, ""),
      h("button", { type: "button", class: "lightbox__close", onClick: close }, "Close ✕"),
    ),
    h("div", { class: "lightbox__stage" },
      h("button", { type: "button", class: "lightbox__nav lightbox__nav--prev", "aria-label": "Previous photo", onClick: () => step(-1) }, "‹"),
      h("div", { class: "lightbox__img" }),
      h("button", { type: "button", class: "lightbox__nav lightbox__nav--next", "aria-label": "Next photo", onClick: () => step(1) }, "›"),
    ),
    h("p", { class: "lightbox__caption" }, ""),
  );
  document.body.appendChild(el);

  el.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") step(-1);
    if (e.key === "ArrowRight") step(1);
  });

  let x0 = null;
  el.addEventListener("touchstart", (e) => { x0 = e.changedTouches[0].clientX; }, { passive: true });
  el.addEventListener("touchend", (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 40) step(dx < 0 ? 1 : -1);
    x0 = null;
  }, { passive: true });
}

function render() {
  const item = images[index];
  const stage = el.querySelector(".lightbox__img");
  stage.replaceChildren(smartImage({ url: item.url, alt: item.alt || "", ratio: "3 / 2", loading: "eager" }));
  el.querySelector(".lightbox__counter").textContent = `${index + 1} / ${images.length}`;
  el.querySelector(".lightbox__caption").textContent = item.caption || item.alt || "";
  announce(`Photo ${index + 1} of ${images.length}. ${item.caption || item.alt || ""}`);
}

function step(dir) {
  index = (index + dir + images.length) % images.length;
  render();
}

export function openLightbox(list, startIndex = 0, trigger = null) {
  ensureDom();
  images = list;
  index = Math.max(0, Math.min(startIndex, list.length - 1));
  triggerEl = trigger || document.activeElement;
  el.hidden = false;
  document.documentElement.style.overflow = "hidden";
  render();
  releaseTrap = trapFocus(el, { onEscape: close });
}

function close() {
  if (!el) return;
  el.hidden = true;
  document.documentElement.style.overflow = "";
  if (releaseTrap) releaseTrap();
  releaseTrap = null;
  if (triggerEl && triggerEl.focus) triggerEl.focus();
}

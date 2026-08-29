// Tiny hyperscript helper — safe by construction (text goes through textContent).

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k === "html") el.innerHTML = v; // caller's explicit responsibility (used only for vetted markdown output)
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el && k !== "list" && k !== "form") {
      try { el[k] = v; } catch { el.setAttribute(k, v); }
    } else el.setAttribute(k, v === true ? "" : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

export function mount(el, ...children) {
  clear(el);
  append(el, children);
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

// Focus trap for modal-ish surfaces. Returns a release fn.
export function trapFocus(container, { onEscape } = {}) {
  const selector = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';
  const previouslyFocused = document.activeElement;

  function keydown(e) {
    if (e.key === "Escape" && onEscape) { onEscape(); return; }
    if (e.key !== "Tab") return;
    const focusables = Array.from(container.querySelectorAll(selector)).filter((n) => n.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  document.addEventListener("keydown", keydown);
  const firstFocusable = container.querySelector(selector);
  if (firstFocusable) firstFocusable.focus();

  return function release() {
    document.removeEventListener("keydown", keydown);
    if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
  };
}

let liveRegion;
export function announce(message) {
  if (!liveRegion) {
    liveRegion = h("div", { class: "visually-hidden", role: "status", "aria-live": "polite" });
    document.body.appendChild(liveRegion);
  }
  liveRegion.textContent = "";
  setTimeout(() => { liveRegion.textContent = message; }, 50);
}

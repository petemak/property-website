// AdminShell — sidebar + topbar, role-aware menu. Plus ConfirmModal + helpers.
// Hiding a menu item is not the access control — the server authorises every call.

import { h, $, trapFocus } from "../lib/dom.js";
import { api } from "../lib/api.js";

const NAV = [
  { group: null, items: [
    { href: "/admin", label: "Dashboard" },
    { href: "/admin/bookings", label: "Bookings" },
    { href: "/admin/availability", label: "Availability & pricing" },
  ]},
  { group: "Content", items: [
    { href: "/admin/content", label: "Property text" },
    { href: "/admin/gallery", label: "Gallery" },
    { href: "/admin/vehicle", label: "The car" },
    { href: "/admin/emails", label: "Email templates" },
  ]},
  { group: "Records", items: [
    { href: "/admin/agreements", label: "Agreement log" },
  ]},
  { group: "Owner", ownerOnly: true, items: [
    { href: "/admin/users", label: "Administrators" },
    { href: "/admin/settings", label: "Settings" },
  ]},
];

export function renderShell(user, activePath, contentNode) {
  const app = $("#admin-app");
  const isOwner = user.role === "owner";

  const nav = h("nav", { "aria-label": "Admin" },
    ...NAV.filter((g) => !g.ownerOnly || isOwner).map((g) =>
      h("div", {},
        g.group ? h("p", { class: "sidebar-group-label" }, g.group) : null,
        h("ul", {}, ...g.items.map((it) =>
          h("li", {}, h("a", {
            href: it.href,
            "aria-current": activePath === it.href || (it.href !== "/admin" && activePath.startsWith(it.href)) ? "page" : null,
            onClick: linkNav,
          }, it.label)))),
      )
    )
  );

  app.replaceChildren(
    h("div", { class: "admin-shell" },
      h("aside", { class: "admin-sidebar" },
        h("a", { href: "/admin", class: "wordmark", onClick: linkNav }, "Kigali Keys"),
        nav,
      ),
      h("div", {},
        h("div", { class: "admin-topbar" },
          h("a", { href: "/", target: "_blank", rel: "noopener" }, "View site ↗"),
          h("div", {},
            h("span", {}, `${user.name} · ${user.role}`), " ",
            h("button", { class: "btn btn--sm btn--ghost", type: "button", onClick: async () => { await api.adminLogout().catch(() => {}); location.href = "/admin/login"; } }, "Sign out"),
          ),
        ),
        h("main", { class: "admin-main", id: "admin-main", tabindex: "-1" }, contentNode),
      ),
    )
  );
}

export function linkNav(e) {
  const a = e.currentTarget;
  if (a.target === "_blank") return;
  e.preventDefault();
  history.pushState(null, "", a.getAttribute("href"));
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function navigate(path) {
  history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function pageTitle(text) {
  document.title = `${text} — Kigali Keys admin`;
  return h("h1", {}, text);
}

export function alertBox(msg, kind = "error") {
  return h("div", { class: `inline-alert inline-alert--${kind}`, role: kind === "error" ? "alert" : "status" },
    h("span", { class: "inline-alert__icon", "aria-hidden": "true" }, kind === "error" ? "!" : "✓"),
    h("span", {}, msg));
}

export function confirmModal({ title, body, confirmLabel = "Confirm", onConfirm }) {
  const backdrop = h("div", { class: "modal-backdrop" });
  let release;
  const close = () => { release && release(); backdrop.remove(); };
  const confirmBtn = h("button", { class: "btn btn--primary", type: "button", onClick: async () => {
    confirmBtn.disabled = true;
    confirmBtn.replaceChildren(h("span", { class: "btn__spinner", "aria-hidden": "true" }), " Working…");
    try { await onConfirm(); close(); }
    catch (err) {
      confirmBtn.disabled = false; confirmBtn.textContent = confirmLabel;
      modal.querySelector(".modal-error")?.replaceChildren(alertBox(err.message || "That didn't work."));
    }
  } }, confirmLabel);

  const modal = h("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": title },
    h("h2", {}, title),
    typeof body === "string" ? h("p", {}, body) : body,
    h("div", { class: "modal-error" }),
    h("div", { class: "wizard-actions" },
      h("button", { class: "btn btn--ghost", type: "button", onClick: close }, "Cancel"),
      confirmBtn),
  );
  backdrop.appendChild(modal);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  document.body.appendChild(backdrop);
  release = trapFocus(modal, { onEscape: close });
  return { close };
}

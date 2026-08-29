// Admin SPA bootstrap + router. Behind /admin/* (no public chrome, noindex).

import { api, ApiError } from "../lib/api.js";
import { h, $ } from "../lib/dom.js";
import { renderShell, pageTitle, alertBox } from "./shell.js";
import { renderLogin } from "./login.js";
import { renderAcceptInvite } from "./accept-invite.js";
import { renderDashboard } from "./dashboard.js";
import { renderBookingsList, renderBookingDetail } from "./bookings.js";
import { renderAvailability } from "./availability.js";
import { renderContent } from "./content.js";
import { renderGallery } from "./gallery.js";
import { renderVehicle } from "./vehicle.js";
import { renderAgreements } from "./agreements.js";
import { renderEmails } from "./emails.js";
import { renderUsers } from "./users.js";
import { renderSettings } from "./settings.js";

document.documentElement.classList.remove("no-js");
let user = null;

const ROUTES = [
  [/^\/admin\/?$/, () => renderDashboard(ctx)],
  [/^\/admin\/bookings\/?$/, () => renderBookingsList(ctx)],
  [/^\/admin\/bookings\/([^/]+)\/?$/, (m) => renderBookingDetail(ctx, m[1])],
  [/^\/admin\/availability\/?$/, () => renderAvailability(ctx)],
  [/^\/admin\/content\/?$/, () => renderContent(ctx)],
  [/^\/admin\/gallery\/?$/, () => renderGallery(ctx)],
  [/^\/admin\/vehicle\/?$/, () => renderVehicle(ctx)],
  [/^\/admin\/agreements\/?$/, () => renderAgreements(ctx)],
  [/^\/admin\/emails\/?$/, () => renderEmails(ctx)],
  [/^\/admin\/users\/?$/, () => renderUsers(ctx)],
  [/^\/admin\/settings\/?$/, () => renderSettings(ctx)],
];

const ctx = {
  get user() { return user; },
  mount(node) {
    renderShell(user, cleanPath(), node);
    $("#admin-main")?.focus();
  },
  navigate(p) { history.pushState(null, "", p); route(); },
};

function cleanPath() { return location.pathname.replace(/\/+$/, "") || "/admin"; }

async function route() {
  const path = location.pathname;

  if (/^\/admin\/login\/?$/.test(path)) {
    renderLogin({ onSuccess: (u) => { user = u; history.pushState(null, "", "/admin"); route(); } });
    return;
  }

  if (/^\/admin\/accept-invite\/?$/.test(path)) {
    renderAcceptInvite({ onSuccess: (u) => { user = u; history.pushState(null, "", "/admin"); route(); } });
    return;
  }

  if (!user) {
    try { const s = await api.adminSession(); user = s.user; }
    catch (e) {
      if (e instanceof ApiError && e.status === 401) { history.replaceState(null, "", "/admin/login"); return route(); }
      $("#admin-app").replaceChildren(h("div", { class: "container section" }, alertBox("Could not reach the admin API.")));
      return;
    }
  }

  for (const [re, handler] of ROUTES) {
    const m = path.replace(/\/+$/, "").match(re) || path.match(re);
    if (m) {
      try { await handler(m); }
      catch (err) {
        ctx.mount(h("div", {}, pageTitle("Something went wrong"), alertBox(err.message || "Unexpected error.")));
      }
      return;
    }
  }

  ctx.mount(h("div", {}, pageTitle("Not found"),
    h("p", {}, "That admin page doesn't exist. "),
    h("p", {}, h("a", { href: "/admin", onClick: (e) => { e.preventDefault(); ctx.navigate("/admin"); } }, "Back to the dashboard")),
  ));
}

window.addEventListener("popstate", route);
route();

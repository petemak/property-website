// A1 — Dashboard.

import { api } from "../lib/api.js";
import { h } from "../lib/dom.js";
import { pageTitle } from "./shell.js";
import { statusBadge } from "../components/status-badge.js";
import { money, formatDate, formatDateRange } from "../lib/format.js";

export async function renderDashboard(ctx) {
  const [pending, approved] = await Promise.all([
    api.adminBookings({ status: "pending", pageSize: 100 }).catch(() => ({ items: [], total: 0 })),
    api.adminBookings({ status: "approved", pageSize: 100 }).catch(() => ({ items: [], total: 0 })),
  ]);
  const rejected = await api.adminBookings({ status: "rejected", pageSize: 100 }).catch(() => ({ total: 0 }));

  const oldestFirst = [...pending.items].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
  const arrivals = [...approved.items].sort((a, b) => a.checkIn.localeCompare(b.checkIn));

  ctx.mount(h("div", {},
    pageTitle("Dashboard"),
    h("div", { class: "admin-cards" },
      stat("Pending requests", pending.total),
      stat("Approved (upcoming)", approved.total),
      stat("Rejected (recent)", rejected.total),
    ),

    panel("Needs attention", oldestFirst.length
      ? table(["Guest", "Dates", "Car", "Estimate", ""], oldestFirst.map((b) => [
          b.guestName,
          `${formatDateRange(b.checkIn, b.checkOut)}`,
          b.carRequested ? "Yes" : "No",
          money(b.estimatedTotal, b.currency),
          h("a", { href: `/admin/bookings/${b.id}`, class: "btn btn--sm btn--ghost", onClick: nav(ctx) }, "Review"),
        ], (b) => `/admin/bookings/${b.id}`, oldestFirst))
      : h("p", { class: "empty-state" }, "No pending requests. All clear.")),

    panel("Next arrivals", arrivals.length
      ? table(["Guest", "Check-in", "Nights", "Status"], arrivals.map((b) => [
          b.guestName, formatDate(b.checkIn), String(b.nights), statusBadge(b.status),
        ], (b) => `/admin/bookings/${b.id}`, arrivals))
      : h("p", { class: "role-note" }, "No upcoming approved bookings.")),

    panel("Content health", h("ul", {},
      h("li", {}, "Check the gallery for photos missing alt text on the Gallery page."),
      h("li", {}, "Review the nightly rate on Availability & pricing if it has been a while."),
      h("li", {}, "The current vehicle agreement version and its acceptance count are on The car page."),
    )),
  ));
}

function stat(label, num) {
  return h("div", { class: "stat-card" }, h("div", { class: "stat-num" }, String(num ?? "—")), h("div", {}, label));
}
function panel(title, body) {
  return h("section", { class: "admin-panel" }, h("h2", {}, title), body);
}
function nav(ctx) {
  return (e) => { e.preventDefault(); e.stopPropagation(); ctx.navigate(e.currentTarget.getAttribute("href")); };
}
function table(headers, rows, hrefFn, data) {
  return h("table", { class: "admin-table" },
    h("thead", {}, h("tr", {}, ...headers.map((x) => h("th", { scope: "col" }, x)))),
    h("tbody", {}, ...rows.map((cells, i) => {
      const href = hrefFn && data ? hrefFn(data[i]) : null;
      return h("tr", {
        tabindex: href ? "0" : null,
        onClick: href ? () => location.assign(href) : null,
        onKeydown: href ? (e) => { if (e.key === "Enter") location.assign(href); } : null,
      }, ...cells.map((c) => h("td", {}, c)));
    })),
  );
}

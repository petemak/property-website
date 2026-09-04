// A9 — Email templates + Sent log (outbox).
// Two tabs on one route: ?tab=templates (default) and ?tab=sent.
// design-spec.md §A9 · api-contract.md §26 (templates) + §26b (sent log).

import { api } from "../lib/api.js";
import { h, mount, announce } from "../lib/dom.js";
import { pageTitle, alertBox, confirmModal } from "./shell.js";
import { field } from "../components/form.js";
import { formatDateTime } from "../lib/format.js";

const KEYS = ["bookingReceived", "bookingApproved", "bookingRejected", "adminNewBooking", "contactAck", "adminInvite"];

export async function renderEmails(ctx) {
  const params = new URLSearchParams(location.search);
  const tab = params.get("tab") === "sent" ? "sent" : "templates";
  if (tab === "sent") return renderSentLog(ctx, params);
  return renderTemplates(ctx, params);
}

function tabsNav(ctx, active) {
  const mk = (id, label) => h("a", {
    class: "admin-tab",
    href: `/admin/emails?tab=${id}`,
    "aria-current": active === id ? "page" : null,
    onClick: (e) => { e.preventDefault(); ctx.navigate(`/admin/emails?tab=${id}`); },
  }, label);
  return h("nav", { class: "admin-tabs", "aria-label": "Email sections" },
    mk("templates", "Templates"), mk("sent", "Sent log"));
}

// ---------------------------------------------------------------------------
// Templates tab (unchanged behaviour, now under a tab strip)
// ---------------------------------------------------------------------------

async function renderTemplates(ctx, params) {
  const activeKey = params.get("key") || KEYS[0];

  let tpl;
  try { tpl = await api.adminEmailTemplate(activeKey); }
  catch (e) { ctx.mount(h("div", {}, pageTitle("Email"), tabsNav(ctx, "templates"), alertBox(e.message))); return; }

  const subject = h("input", { type: "text", id: "e-subj", value: tpl.subject, style: "width:100%" });
  const bodyMd = h("textarea", { id: "e-body", rows: "12", style: "width:100%" }, tpl.bodyMarkdown);
  const status = h("div", { "aria-live": "polite" });
  const testStatus = h("div", { class: "test-email-result", "aria-live": "polite" });
  const previewHost = h("div", { class: "email-preview" });

  ctx.mount(h("div", {},
    pageTitle("Email"),
    tabsNav(ctx, "templates"),
    h("nav", { class: "jump-links", "aria-label": "Templates" },
      ...KEYS.map((k) => h("a", { class: "chip", href: `/admin/emails?key=${k}`, "aria-current": k === activeKey ? "page" : null,
        onClick: (e) => { e.preventDefault(); ctx.navigate(`/admin/emails?key=${k}`); } }, k))),

    h("section", { class: "admin-panel" },
      h("h2", {}, activeKey),
      h("p", { class: "role-note" }, "Available tokens: ", ...(tpl.availableTokens || []).map((t) => h("code", { style: "margin-right:.4rem" }, `{{${t}}}`))),
      h("p", { class: "role-note" }, "The brand wrapper (logo, colours, footer) is applied automatically and isn't editable here."),
      field({ label: "Subject", control: subject, id: "e-subj" }),
      field({ label: "Body (markdown)", control: bodyMd, id: "e-body" }),
      status,
      h("div", { class: "wizard-actions" },
        h("button", { class: "btn btn--primary", type: "button", onClick: save }, "Save"),
        h("button", { class: "btn btn--ghost", type: "button", onClick: preview }, "Refresh preview"),
        h("button", { class: "btn btn--ghost", type: "button", onClick: sendTest }, "Send test to me"),
      ),
      testStatus,
    ),

    h("section", { class: "admin-panel" }, h("h2", {}, "Preview"), previewHost),
  ));

  preview();

  async function save() {
    status.replaceChildren();
    try {
      await api.adminPutEmailTemplate(activeKey, { subject: subject.value, bodyMarkdown: bodyMd.value });
      status.replaceChildren(alertBox("Saved.", "success"));
      preview();
    } catch (e) { status.replaceChildren(alertBox(e.message)); }
  }

  // api-contract §26: POST :key/test now returns { sent, to, status, error? }.
  // Reflect the real transport result inline, next to the button.
  async function sendTest() {
    testStatus.replaceChildren();
    let res;
    try {
      res = await api.adminTestEmail(activeKey);
    } catch (e) {
      testStatus.replaceChildren(alertBox(e.message, "error"));
      announce(e.message);
      return;
    }
    const to = res && res.to ? res.to : "your address";
    let msg, kind;
    if (res && res.status === "sent") {
      msg = `Test email sent to ${to}.`;
      kind = "success";
    } else if (res && res.status === "failed") {
      msg = res.error ? `Send failed: ${res.error}` : "Send failed.";
      kind = "error";
    } else {
      // "stored" (default outbox) or any unrecognised non-failure status:
      // the message was recorded but NOT actually transmitted.
      msg = `Recorded to the outbox for ${to} — this environment doesn't send email. Set MAIL_TRANSPORT=smtp to deliver.`;
      kind = "warning";
    }
    testStatus.replaceChildren(alertBox(msg, kind));
    announce(msg);
  }

  async function preview() {
    try {
      const sample = { guestFirstName: "Lena", bookingReference: "KK-DEMO12", stayDates: "5–12 Sep 2026", statusUrl: "https://kigalikeys.rw/booking/KK-DEMO12", addressLine: "House 00, Gacuriro, Kigali", hostContact: "Peter — +250 788 000 000", checkInInstructions: "Lockbox 4821.", priceBreakdown: "Accommodation 490 + Cleaning 30 = USD 520", rejectionExplanation: "Those dates are taken." };
      const res = await api.adminPreviewEmail(activeKey, sample);
      const frame = h("iframe", { title: "Email preview", srcdoc: res.html, sandbox: "" });
      mount(previewHost, h("p", {}, h("strong", {}, "Subject: "), res.subject), frame);
    } catch (e) { mount(previewHost, alertBox(e.message)); }
  }
}

// ---------------------------------------------------------------------------
// Sent log tab (api-contract §26b) — read-only outbox.
// ---------------------------------------------------------------------------

const TEMPLATE_LABEL = {
  bookingReceived: "Booking received",
  bookingApproved: "Booking approved",
  bookingRejected: "Booking rejected",
  adminNewBooking: "New-booking alert",
  contactAck: "Contact acknowledgement",
  adminInvite: "Administrator invite",
};

// templateKey is null for messages sent without a template (the direct
// new-request notification to the host's own address). api-contract §26b.
function templateLabel(key) {
  if (key == null) return "Direct message";
  return TEMPLATE_LABEL[key] || key;
}

// api-contract §26b: the outbox transport emits "stored"; MAIL_TRANSPORT=smtp
// also emits "sent" and "failed". queued|delivered|bounced are reserved. Any
// value we don't know about renders as a neutral label — never throw.
const SENT_STATUS = {
  stored: { cls: "status-badge--neutral", label: "Stored", title: "Recorded to the outbox — this environment did not transmit it." },
  sent: { cls: "status-badge--sent", label: "Sent", title: "Accepted by the mail server." },
  failed: { cls: "status-badge--failed", label: "Failed", title: "The mail server rejected the message or the send threw. The request itself still succeeded." },
};

function statusCell(status) {
  const known = SENT_STATUS[status];
  if (known) return h("span", { class: `status-badge ${known.cls}`, title: known.title }, known.label);
  return h("span", { class: "role-note" }, status || "—");
}

async function renderSentLog(ctx, params) {
  const q = {
    templateKey: params.get("templateKey") || "",
    q: params.get("q") || "",
    from: params.get("from") || "",
    to: params.get("to") || "",
    page: Number(params.get("page")) || 1,
  };

  const tplSel = h("select", { id: "se-tpl" },
    h("option", { value: "", selected: q.templateKey === "" }, "All templates"),
    ...KEYS.map((k) => h("option", { value: k, selected: q.templateKey === k }, templateLabel(k))),
    h("option", { value: "none", selected: q.templateKey === "none" }, "Direct message"));
  const search = h("input", { type: "search", id: "se-q", value: q.q, placeholder: "To, subject or booking ref" });
  const fromInp = h("input", { type: "date", id: "se-from", value: q.from });
  const toInp = h("input", { type: "date", id: "se-to", value: q.to });

  function apply(page) {
    const p = new URLSearchParams({ tab: "sent" });
    if (tplSel.value) p.set("templateKey", tplSel.value);
    if (search.value.trim()) p.set("q", search.value.trim());
    if (fromInp.value) p.set("from", fromInp.value);
    if (toInp.value) p.set("to", toInp.value);
    if (page && page > 1) p.set("page", String(page));
    ctx.navigate(`/admin/emails?${p.toString()}`);
  }

  const tableHost = h("div", {}, h("p", { class: "is-loading" }, "Loading sent emails…"));

  ctx.mount(h("div", {},
    pageTitle("Email"),
    tabsNav(ctx, "sent"),
    h("p", { class: "role-note" }, "Every email the system generated, newest first. Read-only — the log is a by-product of the system sending mail. Emails are recorded here; in production with a mail provider configured, the status shows whether each was ", h("strong", {}, "Sent"), " or ", h("strong", {}, "Failed"), "."),
    h("div", { class: "admin-filters" },
      field({ label: "Template", control: tplSel, id: "se-tpl" }),
      field({ label: "Search", control: search, id: "se-q" }),
      field({ label: "Sent from", control: fromInp, id: "se-from" }),
      field({ label: "Sent to", control: toInp, id: "se-to" }),
      h("button", { class: "btn btn--primary", type: "button", onClick: () => apply(1) }, "Apply"),
    ),
    tableHost,
  ));
  search.addEventListener("keydown", (e) => { if (e.key === "Enter") apply(1); });

  let res;
  try { res = await api.adminSentEmails({ templateKey: q.templateKey || undefined, q: q.q || undefined, from: q.from || undefined, to: q.to || undefined, page: q.page }); }
  catch (e) { mount(tableHost, alertBox(e.message)); return; }

  if (!res.items.length) {
    const filtered = q.templateKey || q.q || q.from || q.to;
    mount(tableHost, h("p", { class: "empty-state" }, filtered ? "No emails match these filters." : "No emails sent yet."));
    return;
  }

  const pageSize = res.pageSize || 20;
  const pages = Math.max(1, Math.ceil(res.total / pageSize));

  mount(tableHost,
    h("table", { class: "admin-table" },
      h("thead", {}, h("tr", {}, ...["Sent at", "To", "Template", "Subject", "Booking ref", "Status"].map((x) => h("th", { scope: "col" }, x)))),
      h("tbody", {}, ...res.items.map((row) => {
        const open = () => openEmail(ctx, row.id);
        return h("tr", { tabindex: "0", onClick: open, onKeydown: (e) => { if (e.key === "Enter") open(); } },
          h("td", {}, formatDateTime(row.createdAt)),
          h("td", { style: "word-break:break-all" }, row.toAddress),
          h("td", {}, templateLabel(row.templateKey)),
          h("td", {}, row.subject),
          h("td", {}, row.bookingReference
            ? h("a", {
                href: `/admin/bookings?q=${encodeURIComponent(row.bookingReference)}`,
                onClick: (e) => { e.stopPropagation(); e.preventDefault(); ctx.navigate(`/admin/bookings?q=${encodeURIComponent(row.bookingReference)}`); },
              }, row.bookingReference)
            : "—"),
          h("td", {}, statusCell(row.status)),
        );
      })),
    ),
    h("div", { class: "admin-filters", style: "justify-content:space-between;align-items:center" },
      h("p", { class: "role-note" }, `${res.total} email${res.total === 1 ? "" : "s"} · page ${res.page} of ${pages}`),
      h("div", { class: "wizard-actions" },
        h("button", { class: "btn btn--sm btn--ghost", type: "button", disabled: res.page <= 1, onClick: () => apply(res.page - 1) }, "Previous"),
        h("button", { class: "btn btn--sm btn--ghost", type: "button", disabled: res.page >= pages, onClick: () => apply(res.page + 1) }, "Next"),
      ),
    ),
  );
}

async function openEmail(ctx, id) {
  let rec;
  try { rec = await api.adminSentEmail(id); }
  catch (e) { announce(e.message); return; }

  const frame = h("iframe", { title: "Rendered email", srcdoc: rec.html || "<!doctype html><p>No stored body.</p>", sandbox: "" });

  const bookingCell = rec.bookingReference
    ? h("a", { href: `/admin/bookings?q=${encodeURIComponent(rec.bookingReference)}` }, rec.bookingReference)
    : h("span", {}, "—");

  const modal = confirmModal({
    title: "Sent email",
    confirmLabel: "Close",
    onConfirm: async () => {},
    body: h("div", { class: "stack" },
      h("dl", { class: "detail-list" },
        h("dt", {}, "Subject"), h("dd", {}, rec.subject),
        h("dt", {}, "To"), h("dd", { style: "word-break:break-all" }, rec.toAddress),
        h("dt", {}, "Template"), h("dd", {}, templateLabel(rec.templateKey)),
        h("dt", {}, "Sent at"), h("dd", {}, formatDateTime(rec.createdAt)),
        h("dt", {}, "Booking"), h("dd", {}, bookingCell),
        h("dt", {}, "Status"), h("dd", {}, statusCell(rec.status)),
      ),
      h("div", { class: "email-preview" }, frame),
    ),
  });

  if (rec.bookingReference) {
    bookingCell.addEventListener("click", (e) => {
      e.preventDefault();
      modal.close();
      ctx.navigate(`/admin/bookings?q=${encodeURIComponent(rec.bookingReference)}`);
    });
  }
}

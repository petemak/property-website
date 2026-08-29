// A9 — Edit + preview email templates.

import { api } from "../lib/api.js";
import { h, mount, announce } from "../lib/dom.js";
import { pageTitle, alertBox } from "./shell.js";
import { field } from "../components/form.js";

const KEYS = ["bookingReceived", "bookingApproved", "bookingRejected", "adminNewBooking", "contactAck", "adminInvite"];

export async function renderEmails(ctx) {
  const params = new URLSearchParams(location.search);
  const activeKey = params.get("key") || KEYS[0];

  let tpl;
  try { tpl = await api.adminEmailTemplate(activeKey); }
  catch (e) { ctx.mount(h("div", {}, pageTitle("Email templates"), alertBox(e.message))); return; }

  const subject = h("input", { type: "text", id: "e-subj", value: tpl.subject, style: "width:100%" });
  const bodyMd = h("textarea", { id: "e-body", rows: "12", style: "width:100%" }, tpl.bodyMarkdown);
  const status = h("div", { "aria-live": "polite" });
  const previewHost = h("div", { class: "email-preview" });

  ctx.mount(h("div", {},
    pageTitle("Email templates"),
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
        h("button", { class: "btn btn--ghost", type: "button", onClick: async () => { try { await api.adminTestEmail(activeKey); announce("Test email sent to your address."); } catch (e) { announce(e.message); } } }, "Send test to me"),
      ),
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

  async function preview() {
    try {
      const sample = { guestFirstName: "Lena", bookingReference: "KK-DEMO12", stayDates: "5–12 Sep 2026", statusUrl: "https://kigalikeys.rw/booking/KK-DEMO12", addressLine: "House 12, Rebero", hostContact: "Jean — +250 788 000 000", checkInInstructions: "Lockbox 4821.", priceBreakdown: "Accommodation 980 + Cleaning 35 = USD 1015", rejectionExplanation: "Those dates are taken." };
      const res = await api.adminPreviewEmail(activeKey, sample);
      const frame = h("iframe", { title: "Email preview", srcdoc: res.html });
      mount(previewHost, h("p", {}, h("strong", {}, "Subject: "), res.subject), frame);
    } catch (e) { mount(previewHost, alertBox(e.message)); }
  }
}

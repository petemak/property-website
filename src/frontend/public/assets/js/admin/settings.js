// A11 — Host contact details, site defaults (owner only).

import { api, ApiError } from "../lib/api.js";
import { h, mount } from "../lib/dom.js";
import { pageTitle, alertBox } from "./shell.js";
import { field, fieldset } from "../components/form.js";

export async function renderSettings(ctx) {
  if (ctx.user.role !== "owner") {
    ctx.mount(h("div", {}, pageTitle("Settings"), alertBox("Only the owner can change settings. (Also enforced by the server.)", "warning")));
    return;
  }

  let s;
  try { s = await api.adminGetSettings(); }
  catch (e) {
    if (e instanceof ApiError && e.status === 403) { ctx.mount(h("div", {}, pageTitle("Settings"), alertBox("Only the owner can change settings.", "warning"))); return; }
    ctx.mount(h("div", {}, pageTitle("Settings"), alertBox(e.message))); return;
  }

  const name = inp(s.hostDisplayName);
  const email = inp(s.publicEmail, "email");
  const phone = inp(s.publicPhone, "tel");
  const notify = h("textarea", { rows: "3", style: "width:100%", value: (s.newRequestNotificationEmails || []).join("\n") });
  const tz = inp(s.timezone);
  const currency = inp(s.currency);
  const lat = inp(s.approxLat, "number");
  const lng = inp(s.approxLng, "number");
  const reveal = h("input", { type: "checkbox", id: "s-reveal", checked: s.revealExactAddressAfterApproval });
  const respTime = inp(s.guestResponseTimeText);
  const status = h("div", { "aria-live": "polite" });

  ctx.mount(h("div", {},
    pageTitle("Settings"),
    status,
    h("section", { class: "admin-panel" },
      fieldset("Host contact (shown to guests)",
        field({ label: "Host display name", control: name }),
        h("div", { class: "field-row" }, field({ label: "Public email", control: email }), field({ label: "Public phone / WhatsApp", control: phone })),
      ),
      fieldset("Operations",
        field({ label: "New-request notification emails (one per line)", control: notify }),
        h("div", { class: "field-row" }, field({ label: "Timezone (IANA)", control: tz }), field({ label: "Default currency (ISO 4217)", control: currency })),
        field({ label: "Guest response-time text", control: respTime }),
      ),
      fieldset("Map",
        h("div", { class: "field-row" }, field({ label: "Approx latitude", control: lat }), field({ label: "Approx longitude", control: lng })),
        h("div", { class: "checkbox-field" }, reveal, h("label", { for: "s-reveal" }, "Reveal the exact address only after a booking is approved")),
      ),
      h("p", { class: "role-note" }, "Booking mode is fixed to “request” in v1 (a human approves every booking). The switch to instant booking + payment will live here in v2."),
      h("button", { class: "btn btn--primary", type: "button", onClick: async () => {
        status.replaceChildren();
        try {
          const updated = await api.adminPutSettings({
            hostDisplayName: name.value, publicEmail: email.value,
            // Optional free-text fields: send null (not "") when blank so the
            // backend stores an absent value rather than an empty string.
            publicPhone: optional(phone.value),
            newRequestNotificationEmails: notify.value.split("\n").map((x) => x.trim()).filter(Boolean),
            timezone: tz.value, currency: currency.value,
            approxLat: Number(lat.value), approxLng: Number(lng.value),
            revealExactAddressAfterApproval: reveal.checked,
            guestResponseTimeText: optional(respTime.value),
          });
          Object.assign(s, updated);
          status.replaceChildren(alertBox("Settings saved.", "success"));
        } catch (e) { status.replaceChildren(alertBox(e.message)); }
      } }, "Save settings"),
    ),
  ));
}

function inp(value, type = "text") { return h("input", { type, value: value ?? "", style: "width:100%" }); }

// Trim a free-text input; return null when it's empty so the payload omits a
// real value rather than sending "".
function optional(value) {
  const v = (value ?? "").trim();
  return v === "" ? null : v;
}

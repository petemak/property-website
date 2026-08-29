// A10 — Manage administrator accounts (owner only; server also enforces role).

import { api, ApiError } from "../lib/api.js";
import { h, mount, announce } from "../lib/dom.js";
import { pageTitle, alertBox, confirmModal } from "./shell.js";
import { field, setFieldError, clearErrors } from "../components/form.js";
import { formatDateTime } from "../lib/format.js";

export async function renderUsers(ctx) {
  if (ctx.user.role !== "owner") {
    ctx.mount(h("div", {}, pageTitle("Administrators"),
      alertBox("Only the owner can manage administrators. (This is also enforced by the server.)", "warning")));
    return;
  }

  let data;
  try { data = await api.adminUsers(); }
  catch (e) {
    if (e instanceof ApiError && e.status === 403) {
      ctx.mount(h("div", {}, pageTitle("Administrators"), alertBox("Only the owner can manage administrators.", "warning")));
      return;
    }
    ctx.mount(h("div", {}, pageTitle("Administrators"), alertBox(e.message)));
    return;
  }

  const host = h("div", {});
  ctx.mount(h("div", {}, pageTitle("Administrators"), host));
  draw();

  function draw() {
    mount(host,
      h("section", { class: "admin-panel" },
        h("h2", {}, "Team"),
        h("table", { class: "admin-table" },
          h("thead", {}, h("tr", {}, ...["Name", "Email", "Role", "Status", "Last login", ""].map((x) => h("th", { scope: "col" }, x)))),
          h("tbody", {}, ...data.users.map((u) => h("tr", {},
            h("td", {}, u.name), h("td", {}, u.email), h("td", {}, u.role), h("td", {}, u.status),
            h("td", {}, u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "—"),
            h("td", {}, h("div", { class: "wizard-actions" },
              u.role === "owner"
                ? h("button", { class: "btn btn--sm btn--ghost", type: "button", onClick: () => change(u, { role: "admin" }) }, "Make admin")
                : h("button", { class: "btn btn--sm btn--ghost", type: "button", onClick: () => change(u, { role: "owner" }) }, "Make owner"),
              u.status === "disabled"
                ? h("button", { class: "btn btn--sm btn--ghost", type: "button", onClick: () => change(u, { status: "active" }) }, "Enable")
                : h("button", { class: "btn btn--sm btn--ghost", type: "button", onClick: () => change(u, { status: "disabled" }) }, "Disable"),
              u.status === "invited" ? h("button", { class: "btn btn--sm btn--ghost", type: "button", onClick: async () => { await api.adminResendInvite(u.id); announce("Invite re-sent."); } }, "Resend invite") : null,
              h("button", { class: "btn btn--sm btn--ghost", type: "button", onClick: () => remove(u) }, "Remove"),
            )),
          ))),
        ),
      ),
      inviteForm(),
    );
  }

  function inviteForm() {
    const name = h("input", { type: "text", id: "u-name" });
    const email = h("input", { type: "email", id: "u-email" });
    const role = h("select", { id: "u-role" }, h("option", { value: "admin" }, "Admin"), h("option", { value: "owner" }, "Owner"));
    const errHost = h("div", {});
    const form = h("form", { class: "form", novalidate: true, onSubmit: async (e) => {
      e.preventDefault();
      clearErrors(form); errHost.replaceChildren();
      if (!name.value.trim()) return setFieldError(name, "Enter a name.");
      if (!email.checkValidity()) return setFieldError(email, "Enter a valid email.");
      try {
        const u = await api.adminCreateUser({ name: name.value.trim(), email: email.value.trim(), role: role.value });
        data.users.push(u);
        name.value = email.value = "";
        announce("Invitation sent.");
        draw();
      } catch (err) {
        errHost.replaceChildren(alertBox(err instanceof ApiError && err.code === "conflict" ? "That email is already an administrator." : err.message));
      }
    } },
      h("h2", {}, "Invite an administrator"),
      h("div", { class: "field-row" }, field({ label: "Name", control: name, id: "u-name" }), field({ label: "Email", control: email, id: "u-email" })),
      field({ label: "Role", control: role, id: "u-role" }),
      errHost,
      h("button", { class: "btn btn--primary", type: "submit" }, "Send invite"),
    );
    return h("section", { class: "admin-panel" }, form);
  }

  async function change(u, patch) {
    try {
      const updated = await api.adminPatchUser(u.id, patch);
      Object.assign(u, updated);
      announce("Updated.");
      draw();
    } catch (e) {
      alert(e instanceof ApiError && e.code === "conflict" ? e.message : e.message);
    }
  }

  function remove(u) {
    confirmModal({
      title: `Remove ${u.name}?`,
      body: "They lose access immediately. This can't be undone.",
      confirmLabel: "Remove",
      onConfirm: async () => {
        await api.adminDeleteUser(u.id);
        data.users = data.users.filter((x) => x.id !== u.id);
        announce("Administrator removed.");
        draw();
      },
    });
  }
}

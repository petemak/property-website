// Set-your-password page for a newly invited administrator (api-contract §13b).
// Reached from the adminInvite email link: /admin/accept-invite?token=...

import { api, ApiError } from "../lib/api.js";
import { h, $, mount } from "../lib/dom.js";
import { field, setFieldError, clearErrors } from "../components/form.js";
import { alertBox } from "./shell.js";

export function renderAcceptInvite({ onSuccess }) {
  document.title = "Set your password — Kigali Keys admin";
  const token = new URLSearchParams(location.search).get("token") || "";

  const pass = h("input", { type: "password", id: "ai-pass", autocomplete: "new-password", required: true, minlength: "10" });
  const confirm = h("input", { type: "password", id: "ai-pass2", autocomplete: "new-password", required: true });
  const errHost = h("div", { "aria-live": "polite" });
  const btn = h("button", { class: "btn btn--primary btn--block", type: "submit" }, "Set password & sign in");

  const form = h("form", { class: "form", novalidate: true, onSubmit: async (e) => {
    e.preventDefault();
    clearErrors(form); errHost.replaceChildren();
    if (!token) { errHost.replaceChildren(alertBox("This link is missing its token. Ask the owner to resend the invite.")); return; }
    if (pass.value.length < 10) { setFieldError(pass, "Use at least 10 characters."); return; }
    if (confirm.value !== pass.value) { setFieldError(confirm, "The two passwords don't match."); return; }
    btn.disabled = true; btn.replaceChildren(h("span", { class: "btn__spinner", "aria-hidden": "true" }), " Setting up…");
    try {
      const { user } = await api.adminAcceptInvite(token, pass.value);
      onSuccess(user);
    } catch (err) {
      btn.disabled = false; btn.textContent = "Set password & sign in";
      if (err instanceof ApiError && err.status === 410) {
        errHost.replaceChildren(alertBox(err.message || "This invite link has expired or was already used. Ask the owner to resend it."));
      } else if (err instanceof ApiError && err.code === "validationError") {
        setFieldError(pass, err.message || "That password doesn't meet the policy.");
      } else {
        errHost.replaceChildren(alertBox(err.message || "Something went wrong. Try again."));
      }
    }
  } },
    field({ label: "New password", control: pass, id: "ai-pass", hint: "At least 10 characters." }),
    field({ label: "Confirm password", control: confirm, id: "ai-pass2" }),
    errHost,
    btn,
  );

  mount($("#admin-app"),
    h("div", { class: "login-wrap" },
      h("div", { class: "login-card" },
        h("a", { href: "/", class: "wordmark" }, "Kigali Keys"),
        h("h1", { style: "font-size:1.4rem;margin-top:1rem" }, "Welcome — set your password"),
        h("p", { class: "role-note" }, "You've been invited to help manage Kigali Keys. Choose a password to finish setting up your account."),
        form,
      )
    )
  );
  pass.focus();
}

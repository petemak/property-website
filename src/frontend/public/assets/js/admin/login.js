// A0 — Sign in.

import { api, ApiError } from "../lib/api.js";
import { h, $, mount } from "../lib/dom.js";
import { field, setFieldError, clearErrors } from "../components/form.js";
import { alertBox } from "./shell.js";

export function renderLogin({ onSuccess }) {
  document.title = "Sign in — Kigali Keys admin";
  const email = h("input", { type: "email", id: "l-email", autocomplete: "username", required: true });
  const password = h("input", { type: "password", id: "l-pass", autocomplete: "current-password", required: true });
  const errHost = h("div", { "aria-live": "polite" });
  const btn = h("button", { class: "btn btn--primary btn--block", type: "submit" }, "Sign in");

  const form = h("form", { class: "form", novalidate: true, onSubmit: async (e) => {
    e.preventDefault();
    clearErrors(form); errHost.replaceChildren();
    if (!email.checkValidity()) return setFieldError(email, "Enter your email.");
    if (!password.value) return setFieldError(password, "Enter your password.");
    btn.disabled = true; btn.replaceChildren(h("span", { class: "btn__spinner", "aria-hidden": "true" }), " Signing in…");
    try {
      const { user } = await api.adminLogin(email.value.trim(), password.value);
      onSuccess(user);
    } catch (err) {
      btn.disabled = false; btn.textContent = "Sign in";
      const msg = err instanceof ApiError && err.status === 429
        ? "Too many attempts. Wait a minute and try again."
        : "Email or password is incorrect.";
      errHost.replaceChildren(alertBox(msg));
    }
  }},
    field({ label: "Email", control: email, id: "l-email" }),
    field({ label: "Password", control: password, id: "l-pass" }),
    errHost,
    btn,
    h("p", { class: "role-note" }, h("a", { href: "#" , onClick: (e) => e.preventDefault() }, "Forgot password?"), " — a reset link is emailed to you."),
  );

  mount($("#admin-app"),
    h("div", { class: "login-wrap" },
      h("div", { class: "login-card" },
        h("a", { href: "/", class: "wordmark" }, "Kigali Keys"),
        h("h1", { style: "font-size:1.4rem;margin-top:1rem" }, "Admin sign in"),
        form,
      )
    )
  );
  email.focus();
}

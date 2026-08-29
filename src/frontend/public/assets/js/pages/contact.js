// P7 — Contact the host.

import { initPublicPage } from "./common.js";
import { api, ApiError } from "../lib/api.js";
import { h, $, mount, announce } from "../lib/dom.js";
import { CONTACT_TOPICS } from "../lib/config.js";
import { field, setFieldError, clearErrors } from "../components/form.js";

const root = $("#contact-root");

(async function () {
  const { property } = await initPublicPage();
  const params = new URLSearchParams(location.search);
  root.className = "";

  const nameEl = h("input", { type: "text", id: "c-name", name: "name", required: true, autocomplete: "name" });
  const emailEl = h("input", { type: "email", id: "c-email", name: "email", required: true, autocomplete: "email" });
  const topicEl = h("select", { id: "c-topic", name: "topic", required: true },
    ...CONTACT_TOPICS.map((t) => h("option", { value: t.value, selected: params.get("topic") === t.value }, t.label)));
  const refEl = h("input", { type: "text", id: "c-ref", name: "bookingReference", value: params.get("ref") || "", autocomplete: "off", maxlength: "20" });
  const msgEl = h("textarea", { id: "c-msg", name: "message", required: true, maxlength: "2000", placeholder: "How can the host help?" });
  if (params.get("ref")) { topicEl.value = "existingRequest"; }

  const status = h("div", { "aria-live": "polite" });
  const submit = h("button", { class: "btn btn--primary", type: "submit" }, "Send message");

  const form = h("form", { class: "form", novalidate: true, onSubmit: onSubmit },
    field({ label: "Your name", control: nameEl, id: "c-name" }),
    field({ label: "Email", control: emailEl, id: "c-email", hint: "So the host can reply." }),
    field({ label: "Topic", control: topicEl, id: "c-topic" }),
    field({ label: "Booking reference (optional)", control: refEl, id: "c-ref", hint: "If your question is about an existing request." }),
    field({ label: "Message", control: msgEl, id: "c-msg" }),
    status,
    submit,
  );

  async function onSubmit(e) {
    e.preventDefault();
    clearErrors(form);
    status.replaceChildren();
    let ok = true;
    if (!nameEl.value.trim()) { setFieldError(nameEl, "Enter your name."); ok = false; }
    if (!emailEl.checkValidity()) { setFieldError(emailEl, "Enter a valid email address."); ok = false; }
    if (!msgEl.value.trim()) { setFieldError(msgEl, "Enter a message."); ok = false; }
    if (!ok) { form.querySelector('[aria-invalid="true"]')?.focus(); return; }

    submit.disabled = true;
    submit.replaceChildren(h("span", { class: "btn__spinner", "aria-hidden": "true" }), " Sending…");
    try {
      await api.postContact({
        name: nameEl.value.trim(), email: emailEl.value.trim(), topic: topicEl.value,
        bookingReference: refEl.value.trim() || undefined, message: msgEl.value.trim(),
      });
      form.replaceChildren(h("div", { class: "inline-alert inline-alert--success", role: "status" },
        h("span", { class: "inline-alert__icon", "aria-hidden": "true" }, "✓"),
        h("span", {}, "Thanks — the host replies within a day. A confirmation is on its way to your inbox."),
      ));
      announce("Message sent. The host replies within a day.");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Something went wrong. Please try again.";
      status.replaceChildren(h("div", { class: "inline-alert inline-alert--error", role: "alert" },
        h("span", { class: "inline-alert__icon", "aria-hidden": "true" }, "!"), h("span", {}, msg)));
      submit.disabled = false;
      submit.textContent = "Send message";
    }
  }

  mount(root,
    h("div", { class: "container split split--text-first" },
      h("div", {},
        h("h1", {}, "Contact the host"),
        h("p", {}, "Questions before you book, or about an existing request? Send a message and the host will get back to you."),
        form,
      ),
      h("aside", { class: "stack" },
        h("div", { class: "card stack" },
          h("h2", {}, "Other ways to reach us"),
          h("p", {}, "Email: ", h("a", { href: `mailto:${property?.publicEmail || "host@kigalikeys.rw"}` }, property?.publicEmail || "host@kigalikeys.rw")),
          h("p", {}, "Phone / WhatsApp: ", property?.publicPhone || "+250 788 000 000"),
          h("p", { class: "price-breakdown__note" }, property?.guestResponseTimeText || "Typically within 24–48 hours."),
        ),
        h("div", { class: "card stack" },
          h("h2", {}, "Quick answers"),
          h("ul", {}, ...(property?.faq || []).slice(0, 4).map((f) => h("li", {}, f.question))),
          h("p", {}, h("a", { href: "/#faq-h" }, "See all FAQs")),
        ),
      ),
    )
  );
})();

// A6 — Manage photos: upload, caption, alt (required), category, reorder, delete, set lead.

import { api } from "../lib/api.js";
import { h, mount, announce } from "../lib/dom.js";
import { pageTitle, alertBox, confirmModal } from "./shell.js";
import { smartImage } from "../components/media.js";
import { GALLERY_CATEGORIES } from "../lib/config.js";
import { field } from "../components/form.js";

export async function renderGallery(ctx) {
  let data;
  try { data = await api.adminGallery(); }
  catch (e) { ctx.mount(h("div", {}, pageTitle("Gallery"), alertBox(e.message))); return; }

  const host = h("div", {});
  ctx.mount(h("div", {}, pageTitle("Gallery"), host));
  draw();

  function draw() {
    const missingAlt = data.images.filter((i) => !i.alt || !i.alt.trim()).length;
    const fileInput = h("input", { type: "file", id: "up", accept: "image/jpeg,image/png,image/webp", multiple: true });
    // The backend rejects an upload without alt text (1–250 chars), so it is
    // collected here, up front, and applied to every file in this batch.
    const altInput = h("input", { type: "text", id: "up-alt", maxLength: 250, placeholder: "Describe the photo (required)" });
    const capInput = h("input", { type: "text", id: "up-cap", maxLength: 250 });
    const catSelect = h("select", { id: "up-cat" },
      ...GALLERY_CATEGORIES.map((c) => h("option", { value: c }, c)));
    const status = h("div", { role: "status" });

    mount(host,
      h("section", { class: "admin-panel" },
        h("h2", {}, "Upload photos"),
        h("p", { class: "role-note" }, "JPG, PNG or WebP. Alt text and category apply to every file chosen in one go; you can refine each photo below afterwards."),
        field({ label: "Choose files", control: fileInput, id: "up" }),
        field({ label: "Category", control: catSelect, id: "up-cat" }),
        field({ label: "Alt text", control: altInput, id: "up-alt" }),
        field({ label: "Caption (optional)", control: capInput, id: "up-cap" }),
        status,
        h("button", { class: "btn btn--primary", type: "button", onClick: async () => {
          const files = Array.from(fileInput.files || []);
          if (!files.length) { mount(status, alertBox("Choose at least one photo first.")); return; }
          const alt = altInput.value.trim();
          if (!alt) { mount(status, alertBox("Add alt text describing the photo — it is required.")); altInput.focus(); return; }
          let failed = 0, done = 0, lastError = "";
          for (const f of files) {
            const fd = new FormData();
            fd.append("file", f);
            fd.append("alt", alt);
            fd.append("caption", capInput.value.trim());
            fd.append("category", catSelect.value);
            try { const img = await api.adminUploadImage(fd); data.images.push(img); done++; }
            catch (e) { failed++; lastError = e.message; }
          }
          draw();
          const result = h("div", { role: "status" });
          if (failed) {
            mount(result, alertBox(`${failed} of ${files.length} upload(s) failed: ${lastError}`));
            announce("Upload failed: " + lastError);
          } else {
            mount(result, alertBox(`${done} photo(s) uploaded.`, "success"));
            announce("Upload complete.");
          }
          host.prepend(result);
        } }, "Upload"),
      ),

      missingAlt ? alertBox(`${missingAlt} photo(s) are missing alt text. Add it before they go live.`, "warning") : null,

      h("section", { class: "admin-panel" },
        h("h2", {}, `Photos (${data.images.length})`),
        h("p", { class: "role-note" }, "Use ▲ ▼ to reorder. The lead photo appears on the home hero."),
        h("div", { class: "stack" },
          ...data.images.sort((a, b) => (a.position || 0) - (b.position || 0)).map((img, idx) => imageRow(img, idx)),
        ),
      ),
    );
  }

  function imageRow(img, idx) {
    const alt = h("input", { type: "text", value: img.alt || "", placeholder: "Describe the photo (required)",
      onChange: (e) => patch(img, { alt: e.target.value }) });
    const caption = h("input", { type: "text", value: img.caption || "", onChange: (e) => patch(img, { caption: e.target.value }) });
    const cat = h("select", { onChange: (e) => patch(img, { category: e.target.value }) },
      ...GALLERY_CATEGORIES.map((c) => h("option", { value: c, selected: img.category === c }, c)));
    const isLead = data.leadImageId === img.id;

    return h("div", { class: "card", style: "display:grid;grid-template-columns:120px 1fr;gap:1rem" },
      h("div", {}, smartImage({ url: img.thumbnailUrl || img.url, alt: img.alt || "", ratio: "4 / 3" }),
        isLead ? h("p", { class: "chip", style: "margin-top:.4rem" }, "Lead photo") : null),
      h("div", { class: "stack" },
        field({ label: "Alt text", control: alt, id: `alt-${img.id}` }),
        field({ label: "Caption", control: caption, id: `cap-${img.id}` }),
        field({ label: "Category", control: cat, id: `cat-${img.id}` }),
        h("div", { class: "wizard-actions" },
          h("button", { class: "btn btn--sm btn--ghost", type: "button", disabled: idx === 0, "aria-label": "Move up", onClick: () => reorder(idx, idx - 1) }, "▲"),
          h("button", { class: "btn btn--sm btn--ghost", type: "button", disabled: idx === data.images.length - 1, "aria-label": "Move down", onClick: () => reorder(idx, idx + 1) }, "▼"),
          isLead ? null : h("button", { class: "btn btn--sm btn--ghost", type: "button", onClick: async () => { await api.adminSetLeadImage(img.id); data.leadImageId = img.id; announce("Lead photo set."); draw(); } }, "Set as lead"),
          h("button", { class: "btn btn--sm btn--ghost", type: "button", onClick: () => confirmModal({
            title: "Delete this photo?", body: img.caption || img.alt || "This photo", confirmLabel: "Delete",
            onConfirm: async () => { await api.adminDeleteImage(img.id); data.images = data.images.filter((x) => x.id !== img.id); announce("Photo deleted."); draw(); },
          }) }, "Delete"),
        ),
      ),
    );
  }

  async function patch(img, changes) {
    Object.assign(img, changes);
    try { await api.adminPatchImage(img.id, changes); announce("Saved."); }
    catch (e) { announce("Save failed: " + e.message); }
    draw();
  }
  async function reorder(fromIdx, toIdx) {
    const arr = data.images;
    const [moved] = arr.splice(fromIdx, 1);
    arr.splice(toIdx, 0, moved);
    arr.forEach((i, n) => (i.position = n + 1));
    draw();
    try { await api.adminOrderGallery(arr.map((i) => i.id)); }
    catch (e) { announce("Reorder failed: " + e.message); }
  }
}

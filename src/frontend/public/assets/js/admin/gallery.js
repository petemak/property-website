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

    mount(host,
      h("section", { class: "admin-panel" },
        h("h2", {}, "Upload photos"),
        h("p", { class: "role-note" }, "JPG, PNG or WebP. Uploads go through our backend to storage; a thumbnail is generated server-side."),
        field({ label: "Choose files", control: fileInput, id: "up" }),
        h("button", { class: "btn btn--primary", type: "button", onClick: async () => {
          const files = Array.from(fileInput.files || []);
          if (!files.length) return;
          for (const f of files) {
            const fd = new FormData();
            fd.append("file", f);
            fd.append("alt", "");
            fd.append("caption", "");
            fd.append("category", "Living");
            try { const img = await api.adminUploadImage(fd); data.images.push(img); }
            catch (e) { announce("Upload failed: " + e.message); }
          }
          announce("Upload complete. Add alt text to each new photo.");
          draw();
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

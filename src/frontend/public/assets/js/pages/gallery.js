// P2 — Photo gallery.

import { initPublicPage, errorNotice } from "./common.js";
import { api } from "../lib/api.js";
import { h, $, mount } from "../lib/dom.js";
import { smartImage } from "../components/media.js";
import { openLightbox } from "../components/lightbox.js";
import { ctaBand } from "../components/booking-widget.js";
import { GALLERY_CATEGORIES } from "../lib/config.js";

const root = $("#gallery-root");

(async function () {
  const { property } = await initPublicPage();
  let gallery;
  try { gallery = await api.getGallery(); }
  catch (e) { mount(root, errorNotice(e)); return; }

  const images = (gallery.images || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0));
  root.className = "";

  const groups = [];
  for (const cat of GALLERY_CATEGORIES) {
    const inCat = images.filter((i) => i.category === cat);
    if (inCat.length) groups.push([cat, inCat]);
  }
  const ungrouped = images.filter((i) => !GALLERY_CATEGORIES.includes(i.category));
  if (ungrouped.length) groups.push(["More photos", ungrouped]);

  mount(root,
    h("div", { class: "container" },
      h("header", { class: "page-hero" },
        h("h1", {}, "Photo gallery"),
        h("p", {}, `${images.length} photos of the house and the Kia Sorento.`),
        h("nav", { class: "jump-links", "aria-label": "Jump to a section" },
          ...groups.map(([cat]) => h("a", { class: "chip", href: `#g-${slug(cat)}` }, cat))),
      ),
      h("div", { class: "gallery-groups" },
        ...groups.map(([cat, items]) =>
          h("section", { class: "gallery-group", id: `g-${slug(cat)}`, "aria-labelledby": `h-${slug(cat)}` },
            h("h2", { id: `h-${slug(cat)}` }, cat),
            h("div", { class: "gallery-justified" },
              ...items.map((img) => {
                const globalIndex = images.indexOf(img);
                return h("figure", {},
                  h("button", {
                    type: "button", "aria-label": `Open photo ${globalIndex + 1} of ${images.length}: ${img.alt || img.caption || cat}`,
                    onClick: (e) => openLightbox(images, globalIndex, e.currentTarget),
                  }, smartImage({ url: img.thumbnailUrl || img.url, alt: img.alt || "", ratio: "3 / 2", width: img.width, height: img.height })),
                  img.caption ? h("figcaption", {}, img.caption) : null,
                );
              })
            )
          )
        )
      ),
    ),
    ctaBand({ bookingMode: property?.bookingMode, title: "Seen enough?", text: "Pick your dates and send a request.", property }),
  );
})();

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

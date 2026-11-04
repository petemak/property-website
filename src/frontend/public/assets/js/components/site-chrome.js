// SiteHeader + SiteFooter, shared by every public page. (design-spec §0 global chrome)

import { h, $, announce } from "../lib/dom.js";
import { logoMark } from "./icons.js";
import { NAV_LINKS } from "../lib/config.js";
import { bookingCopy } from "../lib/config.js";

function currentPath() {
  return location.pathname.replace(/\.html$/, "").replace(/\/index$/, "/") || "/";
}

export function renderHeader({ transparentOverHero = false, bookingMode = "request" } = {}) {
  const host = $("#site-header");
  if (!host) return;
  const path = currentPath();
  const copy = bookingCopy(bookingMode);

  const navList = h("ul", {},
    ...NAV_LINKS.map((l) =>
      h("li", {}, h("a", { href: l.href, "aria-current": isCurrent(l.href, path) ? "page" : null }, l.label))
    )
  );

  const drawer = h("div", { class: "mobile-drawer", id: "mobile-drawer", hidden: true },
    h("nav", { "aria-label": "Site (mobile)" },
      h("ul", {},
        ...NAV_LINKS.map((l) => h("li", {}, h("a", { href: l.href, "aria-current": isCurrent(l.href, path) ? "page" : null }, l.label))),
        h("li", {}, h("a", { href: "/book" }, copy.ctaAction)),
        h("li", {}, h("a", { href: "/booking" }, "Look up a booking")),
      )
    )
  );

  const toggle = h("button", {
    class: "nav-toggle", type: "button",
    "aria-expanded": "false", "aria-controls": "mobile-drawer",
    onClick: () => {
      const open = drawer.hasAttribute("hidden");
      if (open) { drawer.removeAttribute("hidden"); drawer.classList.add("is-open"); }
      else { drawer.setAttribute("hidden", ""); drawer.classList.remove("is-open"); }
      toggle.setAttribute("aria-expanded", String(open));
    },
  }, "Menu");

  const header = h("div", { class: "site-header" + (transparentOverHero ? " site-header--transparent" : "") },
    h("div", { class: "container site-header__inner" },
      h("a", { href: "/", class: "wordmark" }, logoMark(), "Kigali Keys"),
      h("nav", { class: "site-nav", "aria-label": "Site" }, navList),
      h("div", { class: "site-header__actions" },
        h("a", { class: "btn btn--primary btn--sm site-header__cta", href: "/book" }, "Check dates"),
        toggle,
      )
    ),
    drawer
  );

  host.replaceChildren(header);
}

function isCurrent(href, path) {
  if (href === "/") return path === "/";
  return path === href || path.startsWith(href + "/");
}

const MAKER_LINK = '<a class="maker-link" href="mailto:peter.makumbi@yahoo.com" title="Email PJM"><svg class="maker-mark" viewBox="0 0 56 32" role="img" aria-label="PJM" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><rect x="1.2" y="1.2" width="53.6" height="29.6" rx="6" stroke-width="2.2"/><g transform="translate(6 4)"><path d="M4 21V3h6a5 5 0 0 1 0 10H4"/><path d="M24 3v13a5 5 0 0 1-10 0"/><path d="M24 3l8 11 8-11v18"/></g></svg></a>';

export function renderFooter(property) {
  const host = $("#site-footer");
  if (!host) return;
  // Public contact block from GET /property (api-contract §1). No hardcoded
  // fallback address — if it's missing (API error) we omit the contact line.
  const contact = property?.contact || null;
  const hostName = (contact?.hostName || "").trim() || null;
  const contactEmail = (contact?.email || "").trim() || null;
  const contactPhone = typeof contact?.phone === "string" && contact.phone.trim() ? contact.phone.trim() : null;
  const owner = hostName || "its owner";

  const col = (title, links) =>
    h("div", {}, h("h2", {}, title), h("ul", {}, ...links.map(([href, label]) => h("li", {}, h("a", { href }, label)))));

  const year = new Date().getFullYear();
  const metaLine = contactEmail
    ? h("p", { class: "footer-meta" },
        `Contact: ${hostName ? hostName + ", the host" : "the host"} · `,
        h("a", { href: `mailto:${contactEmail}` }, contactEmail),
        contactPhone ? ` · ${contactPhone}` : null,
        h("br"), `© ${year} Kigali Keys. A privately owned home in Kigali, managed by ${owner}.`)
    : h("p", { class: "footer-meta" },
        `© ${year} Kigali Keys. A privately owned home in Kigali${hostName ? `, managed by ${owner}` : ""}.`);

  const footer = h("footer", { class: "site-footer" },
    h("div", { class: "container" },
      h("div", { class: "footer-grid" },
        h("div", {},
          h("a", { href: "/", class: "wordmark", style: "color:#fff" }, "Kigali Keys"),
          h("p", { style: "margin-top:.5rem;max-width:32ch;opacity:.9" },
            "A furnished two-bedroom duplex in a gated Kigali neighbourhood, with a car on site."),
        ),
        col("Explore", [["/", "The home"], ["/the-car", "The car"], ["/location", "Location"], ["/gallery", "Gallery"]]),
        col("Book", [["/book", "Check dates"], ["/contact", "Contact the host"], ["/booking", "Booking status lookup"]]),
        col("Legal", [
          ["/terms", "Terms of use"], ["/privacy", "Privacy policy"],
          ["/house-rules", "House rules"], ["/cancellation-policy", "Cancellation policy"],
          ["/vehicle-rental-agreement", "Vehicle rental agreement"],
        ]),
      ),
      h("div", { class: "footer-bottom" },
        metaLine,
        // PJM maker credit — markup from maker-credit/footer-credit.html (static, vetted SVG).
        h("p", { class: "site-footer__credit", html: `Designed and built by ${MAKER_LINK}` }),
      ),
    )
  );
  host.replaceChildren(footer);
}

// Transparent-over-hero: white wordmark/nav while the hero is in view, solid Bone
// once it scrolls past. Call this AFTER the hero element is in the DOM.
export function wireHeroHeader() {
  const header = $(".site-header");
  const hero = $(".hero");
  if (!header) return;
  if (!hero || !("IntersectionObserver" in window)) {
    header.classList.remove("site-header--transparent");
    return;
  }
  const apply = (transparent) => header.classList.toggle("site-header--transparent", transparent);
  apply(true); // starts over the hero
  new IntersectionObserver(
    ([e]) => apply(e.isIntersecting && e.intersectionRatio > 0.1),
    { threshold: [0, 0.1, 0.5] }
  ).observe(hero);
}

export { announce };

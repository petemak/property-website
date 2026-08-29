// SiteHeader + SiteFooter, shared by every public page. (design-spec §0 global chrome)

import { h, $, announce } from "../lib/dom.js";
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
      h("a", { href: "/", class: "wordmark" }, "Kigali Keys"),
      h("nav", { class: "site-nav", "aria-label": "Site" }, navList),
      h("div", { class: "site-header__actions" },
        h("a", { class: "btn btn--primary btn--sm", href: "/book" }, "Check dates"),
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

export function renderFooter(property) {
  const host = $("#site-footer");
  if (!host) return;
  const email = property?.pricing ? null : null; // host contact comes from settings; property has publicPreview only
  const contactEmail = property?.hostContact?.email || property?.publicEmail || "host@kigalikeys.rw";
  const contactPhone = property?.hostContact?.phone || property?.publicPhone || "+250 7xx xxx xxx";
  const owner = property?.hostDisplayName || "Jean at Kigali Keys";

  const col = (title, links) =>
    h("div", {}, h("h2", {}, title), h("ul", {}, ...links.map(([href, label]) => h("li", {}, h("a", { href }, label)))));

  const footer = h("footer", { class: "site-footer" },
    h("div", { class: "container" },
      h("div", { class: "footer-grid" },
        h("div", {},
          h("a", { href: "/", class: "wordmark", style: "color:#fff" }, "Kigali Keys"),
          h("p", { style: "margin-top:.5rem;max-width:32ch;opacity:.9" },
            "A furnished 2-bedroom duplex in a gated Kigali neighbourhood — with the keys to a car on site."),
        ),
        col("Explore", [["/", "The home"], ["/the-car", "The car"], ["/location", "Location"], ["/gallery", "Gallery"]]),
        col("Book", [["/book", "Check dates"], ["/contact", "Contact the host"], ["/booking", "Booking status lookup"]]),
        col("Legal", [
          ["/terms", "Terms of use"], ["/privacy", "Privacy policy"],
          ["/house-rules", "House rules"], ["/cancellation-policy", "Cancellation policy"],
          ["/vehicle-rental-agreement", "Vehicle rental agreement"],
        ]),
      ),
      h("p", { class: "footer-meta" },
        `Host: ${owner} · `, h("a", { href: `mailto:${contactEmail}` }, contactEmail), ` · ${contactPhone}`,
        h("br"), `© ${new Date().getFullYear()} Kigali Keys. Managed by ${owner}.`
      )
    )
  );
  host.replaceChildren(footer);
}

// Transparent-over-hero: switch to solid once the hero scrolls out.
export function wireHeroHeader() {
  const header = $(".site-header--transparent");
  const hero = $(".hero");
  if (!header || !hero || !("IntersectionObserver" in window)) {
    header?.classList.remove("site-header--transparent");
    return;
  }
  const obs = new IntersectionObserver(
    ([e]) => header.classList.toggle("site-header--transparent", e.isIntersecting && e.intersectionRatio > 0.1),
    { threshold: [0, 0.1, 0.5] }
  );
  obs.observe(hero);
}

export { announce };

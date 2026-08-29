// P1 — Home / the property. Single scrolling page + sticky booking widget.

import { initPublicPage, getProperty, errorNotice } from "./common.js";
import { api } from "../lib/api.js";
import { h, $, mount } from "../lib/dom.js";
import { icon, CATEGORY_ICON } from "../components/icons.js";
import { smartImage } from "../components/media.js";
import { bookingWidget, ctaBand } from "../components/booking-widget.js";
import { priceBreakdown } from "../components/price-breakdown.js";
import { accordion } from "../components/accordion.js";
import { openLightbox } from "../components/lightbox.js";
import { bookingCopy } from "../lib/config.js";
import { money, minutesToText, isoDate, addDays } from "../lib/format.js";

const root = $("#home-root");

(async function () {
  const { property } = await initPublicPage({ transparentHeader: true });
  if (!property) {
    mount(root, h("div", { class: "container section" }, errorNotice({ message: "We couldn't load the property details. Please refresh." })));
    return;
  }
  const copy = bookingCopy(property.bookingMode);
  const currency = property.pricing?.currency || "USD";

  const [gallery, availability] = await Promise.all([
    api.getGallery().catch(() => ({ images: [] })),
    api.getAvailability(isoDate(new Date()), addDays(isoDate(new Date()), 365)).catch(() => null),
  ]);

  const leadImg = gallery.images?.find((i) => i.id === gallery.leadImageId) || gallery.images?.[0];

  mount(root,
    hero(property, leadImg, copy),
    atAGlance(property),
    theHome(property, gallery),
    includedTable(property),
    amenities(property),
    carTeaser(property, gallery),
    locationTeaser(property),
    checkInRules(property),
    pricingSection(property, currency),
    faqSection(property),
    ctaBand({ bookingMode: property.bookingMode, title: "Request your dates", text: copy.ctaReassurance, property }),
    mobileBookBar(property, copy, currency),
  );

  wireStickyRail();
  wireLiveEstimate(property, currency);
})();

function hero(property, leadImg, copy) {
  return h("section", { class: "hero" },
    h("div", { class: "hero__media" }, smartImage({
      url: leadImg?.url, alt: leadImg?.alt || "The Kigali Keys duplex exterior", ratio: "16 / 10", loading: "eager",
      label: "Lead photo of the house",
    })),
    h("div", { class: "hero__inner container" },
      h("div", {},
        h("h1", { class: "hero__title" }, property.tagline || "A furnished home in Kigali — with the keys to a car."),
        h("p", { class: "hero__sub" },
          `${property.neighbourhood || "Kigali"} · Whole ${property.bedrooms || 2}-bed duplex · sleeps ${property.maxGuests || 4} · gated`),
      ),
      h("div", { id: "hero-widget" },
        bookingWidget({
          bookingMode: property.bookingMode,
          maxGuests: property.maxGuests || 4,
          fromPrice: property.pricing?.nightlyRate ?? null,
          currency: property.pricing?.currency || "USD",
          minNights: property.pricing?.minNights || 1,
          heading: "Check availability",
        }),
      ),
    ),
  );
}

function atAGlance(property) {
  const facts = [
    { icon: "bed", label: "Bedrooms", value: property.bedrooms ?? 2 },
    { icon: "bath", label: "Bathrooms", value: property.bathrooms ?? 2 },
    { icon: "guests", label: "Max guests", value: property.maxGuests ?? 4 },
    { icon: "wifi", label: "Wifi", value: amenityLabel(property, "wifi") || "Fast wifi" },
    { icon: "desk", label: "Work setup", value: "Fast fibre + dining table" },
    { icon: "car", label: "On-site car", value: `Kia Sorento · ${money(45, property.pricing?.currency || "USD")}/day` },
  ];
  return h("section", { class: "section", "aria-labelledby": "glance-h" },
    h("div", { class: "container" },
      h("h2", { id: "glance-h" }, "At a glance"),
      h("ul", { class: "fact-row" }, ...facts.map((f) =>
        h("li", {}, icon(f.icon), h("span", {}, h("span", { class: "fact__label" }, f.label), h("br"), h("span", { class: "fact__value" }, String(f.value)))))),
    )
  );
}

function amenityLabel(property, key) {
  return property.amenities?.find((a) => a.key === key)?.label;
}

function theHome(property, gallery) {
  const strip = h("div", { class: "gallery-strip" });
  const preview = (gallery.images || []).slice(0, 5);
  preview.forEach((img, i) => {
    strip.appendChild(h("button", {
      type: "button", "aria-label": `Open photo: ${img.alt || img.caption || "house photo"}`,
      onClick: () => openLightbox(gallery.images, i),
    }, smartImage({ url: img.thumbnailUrl || img.url, alt: img.alt || "", ratio: "4 / 3" })));
  });

  return h("section", { class: "section", "aria-labelledby": "home-h" },
    h("div", { class: "container split split--text-first" },
      h("div", {},
        h("h2", { id: "home-h" }, "The home"),
        renderProse(property.description),
        h("p", {}, h("a", { class: "btn btn--ghost", href: "/gallery" }, `See all ${gallery.images?.length || 0} photos`)),
      ),
      h("div", {}, preview.length ? strip : smartImage({ url: null, alt: "House photos", ratio: "4 / 3", label: "Photos coming soon" })),
    )
  );
}

function renderProse(text) {
  if (!text) return h("p", {}, "Details coming soon.");
  return h("div", { class: "stack" }, ...String(text).split(/\n{2,}/).map((p) => h("p", {}, p.trim())));
}

function includedTable(property) {
  const inc = property.included || [];
  const exc = property.notIncluded || [];
  return h("section", { class: "section", "aria-labelledby": "inc-h" },
    h("div", { class: "container" },
      h("h2", { id: "inc-h" }, "What's included, what's not"),
      h("div", { class: "included-grid" },
        h("div", {}, h("h3", {}, "Included"),
          h("ul", { class: "included-list" }, ...inc.map((t) => h("li", {}, h("span", { class: "mark mark--yes", "aria-hidden": "true" }, "✓"), h("span", {}, h("span", { class: "visually-hidden" }, "Included: "), t))))),
        h("div", {}, h("h3", {}, "Not included"),
          h("ul", { class: "included-list" }, ...exc.map((t) => h("li", {}, h("span", { class: "mark mark--no", "aria-hidden": "true" }, "✕"), h("span", {}, h("span", { class: "visually-hidden" }, "Not included: "), t))))),
      )
    )
  );
}

function amenities(property) {
  const groups = {};
  for (const a of property.amenities || []) (groups[a.category || "other"] ||= []).push(a);
  const titles = { work: "Work", kitchen: "Kitchen", comfort: "Comfort", building: "Building", safety: "Safety", other: "More" };
  const entries = Object.entries(groups);
  const wrap = h("div", { class: "container" }, h("h2", { id: "amen-h" }, "Amenities"));
  const list = h("div", {});
  entries.forEach(([cat, items], idx) => {
    list.appendChild(h("div", { class: "amenity-group" + (idx > 1 ? " js-only extra-amenities" : ""), hidden: idx > 1 ? true : null },
      h("h3", {}, titles[cat] || cat),
      h("ul", { class: "amenity-list" }, ...items.map((a) => h("li", {}, icon(a.icon || CATEGORY_ICON[cat] || "key", { size: 18 }), h("span", {}, a.label)))),
    ));
  });
  wrap.appendChild(list);
  if (entries.length > 2) {
    const btn = h("button", { class: "btn btn--ghost", type: "button", "aria-expanded": "false",
      onClick: () => {
        const hidden = list.querySelectorAll(".extra-amenities");
        const show = btn.getAttribute("aria-expanded") === "false";
        hidden.forEach((n) => { n.hidden = !show; });
        btn.setAttribute("aria-expanded", String(show));
        btn.textContent = show ? "Show fewer amenities" : "Show all amenities";
      } }, "Show all amenities");
    wrap.appendChild(btn);
  }
  return h("section", { class: "section", "aria-labelledby": "amen-h" }, wrap);
}

function carTeaser(property, gallery) {
  const rate = money(45, property.pricing?.currency || "USD");
  const carImg = (gallery?.images || []).find((i) => i.category === "The car");
  return h("section", { class: "section", "aria-labelledby": "car-h" },
    h("div", { class: "container split" },
      h("div", {}, smartImage({ url: carImg?.url, alt: carImg?.alt || "The Kia Sorento parked at the property", ratio: "4 / 3", label: "The Kia Sorento" })),
      h("div", {},
        h("h2", { id: "car-h" }, "The car"),
        h("p", {}, `A Kia Sorento SUV is parked on the premises. Add it to your stay for ${rate}/day and collect the keys at the house — no separate rental agency, no airport queue.`),
        h("ul", { class: "chips" },
          h("li", { class: "chip" }, "SUV"), h("li", { class: "chip" }, "Automatic"), h("li", { class: "chip" }, "7 seats"),
          h("li", { class: "chip" }, `${rate}/day`), h("li", { class: "chip" }, "Collected on site")),
        h("p", {}, h("a", { class: "btn btn--ghost", href: "/the-car" }, "How the car works")),
      )
    )
  );
}

function locationTeaser(property) {
  const loc = property.location || {};
  const pois = (loc.pointsOfInterest || []).slice(0, 5);
  return h("section", { class: "section", "aria-labelledby": "loc-h" },
    h("div", { class: "container split split--text-first" },
      h("div", {},
        h("h2", { id: "loc-h" }, "Location & getting around"),
        h("div", { class: "mini-map" },
          smartImage({ url: loc.staticMapUrl, alt: `Approximate location map — ${property.neighbourhood || "Kigali"}`, ratio: "16 / 10", label: "Approximate location map" }),
          h("p", { class: "mini-map__note" }, "Approximate pin. The exact address is shared once your booking is approved."),
        ),
      ),
      h("div", {},
        h("ul", { class: "travel-times" }, ...pois.map((p) =>
          h("li", {}, h("span", {}, p.name), h("span", { class: "tt__meta" }, `${minutesToText(p.minutesByCar)} by car${p.km ? ` · ${p.km} km` : ""}`)))),
        h("p", {}, h("a", { class: "btn btn--ghost", href: "/location" }, "Full location details")),
      )
    )
  );
}

function checkInRules(property) {
  const ci = property.checkIn || {};
  const steps = ci.processSteps || [];
  return h("section", { class: "section", "aria-labelledby": "ci-h" },
    h("div", { class: "container split" },
      h("div", {},
        h("h2", { id: "ci-h" }, "Check-in"),
        h("p", {}, ci.publicPreview || `Self check-in from ${ci.fromTime || "14:00"}.`),
        h("ol", { class: "step-list" }, ...steps.map((s) => h("li", {}, s))),
      ),
      h("div", {},
        h("h3", {}, "House rules"),
        h("ul", {}, ...(property.houseRulesSummary || []).map((r) => h("li", {}, r))),
        h("p", {},
          h("a", { href: "/house-rules" }, "Full house rules"), " · ",
          h("a", { href: "/cancellation-policy" }, "Cancellation policy")),
      )
    )
  );
}

function pricingSection(property, currency) {
  const p = property.pricing || {};
  const rows = [
    { label: `Nightly rate`, amount: p.nightlyRate },
    { label: "Cleaning fee", amount: p.cleaningFee },
    { label: `Kia Sorento (optional, paid on site)`, amount: 45 },
  ];
  return h("section", { class: "section", "aria-labelledby": "price-h", id: "pricing" },
    h("div", { class: "container split split--text-first" },
      h("div", {},
        h("h2", { id: "price-h" }, "Pricing"),
        h("table", { class: "price-breakdown" },
          h("caption", {}, "Rates"),
          h("tbody", {}, ...rows.map((r) => h("tr", {}, h("th", { scope: "row" }, r.label), h("td", {}, `${money(r.amount, currency)}${r.label.startsWith("Nightly") || r.label.startsWith("Kia") ? "" : ""}`)))),
        ),
        h("p", { class: "price-breakdown__note" }, `Minimum stay ${p.minNights || 3} nights. ${p.paymentNote || "No payment is taken on this site. The host confirms the final amount when approving your request."}`),
      ),
      h("div", { id: "live-estimate" }),
    )
  );
}

function faqSection(property) {
  const faq = property.faq || [];
  if (!faq.length) return h("section", {});
  return h("section", { class: "section", "aria-labelledby": "faq-h" },
    h("div", { class: "container", style: "max-width:780px" },
      h("h2", { id: "faq-h" }, "Frequently asked questions"),
      accordion(faq.map((f) => ({ title: f.question, body: h("p", {}, f.answer) }))),
    )
  );
}

function mobileBookBar(property, copy, currency) {
  return h("div", { class: "mobile-book-bar" },
    h("span", { class: "from-price" },
      `${copy.fromPricePrefix} `, h("strong", {}, money(property.pricing?.nightlyRate, currency)), " / night"),
    h("a", { class: "btn btn--primary btn--sm", href: "/book" }, "Check dates"),
  );
}

// Desktop sticky rail: after the "home" section scrolls in, dock a condensed widget.
function wireStickyRail() {
  const anchor = $("#home-h");
  const heroWidget = $("#hero-widget");
  if (!anchor || !heroWidget || !("IntersectionObserver" in window)) return;
  // The hero widget already serves; simple approach: keep as-is. Sticky behaviour is
  // provided by #live-estimate becoming sticky within the pricing section on desktop.
  const rail = $("#live-estimate");
  if (rail) rail.classList.add("sticky-rail");
}

async function wireLiveEstimate(property, currency) {
  const region = $("#live-estimate");
  if (!region) return;
  const params = new URLSearchParams(location.search);
  const checkIn = params.get("checkIn");
  const checkOut = params.get("checkOut");
  const copy = bookingCopy(property.bookingMode);

  function placeholder() {
    region.replaceChildren(h("div", { class: "summary-rail" },
      h("h3", {}, copy.estimateLabel),
      h("p", { class: "price-breakdown__empty" }, copy.railEmpty),
      h("p", {}, h("a", { class: "btn btn--primary btn--block", href: "/book" }, copy.ctaAction)),
    ));
  }

  if (!checkIn || !checkOut) { placeholder(); return; }
  try {
    const quote = await api.postQuote({ checkIn, checkOut, guests: Number(params.get("guests")) || 1, car: { requested: params.get("car") === "1" } });
    region.replaceChildren(h("div", { class: "summary-rail stack" },
      priceBreakdown({
        mode: "estimate", bookingMode: property.bookingMode,
        currency: quote.currency, lineItems: quote.lineItems,
        total: quote.estimatedTotal, disclaimer: quote.disclaimer,
      }),
      h("a", { class: "btn btn--primary btn--block", href: `/book?checkIn=${checkIn}&checkOut=${checkOut}&guests=${params.get("guests") || 1}${params.get("car") === "1" ? "&car=1" : ""}` }, copy.ctaAction),
    ));
  } catch {
    placeholder();
  }
}

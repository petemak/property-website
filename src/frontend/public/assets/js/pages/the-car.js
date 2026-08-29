// P3 — The Kia Sorento.

import { initPublicPage, errorNotice } from "./common.js";
import { api } from "../lib/api.js";
import { h, $, mount } from "../lib/dom.js";
import { icon } from "../components/icons.js";
import { smartImage } from "../components/media.js";
import { ctaBand } from "../components/booking-widget.js";
import { agreementPanel } from "../components/agreement-panel.js";
import { money, formatDate } from "../lib/format.js";

const root = $("#car-root");

(async function () {
  const { property } = await initPublicPage();
  let vehicle;
  try { vehicle = await api.getVehicle(); }
  catch (e) { mount(root, errorNotice(e)); return; }
  const gallery = await api.getGallery().catch(() => ({ images: [] }));
  const carPhotos = (gallery.images || []).filter((i) => i.category === "The car");

  const cur = vehicle.currency || "USD";
  root.className = "";
  mount(root,
    h("section", { class: "page-hero" },
      h("div", { class: "container split" },
        h("div", {}, smartImage({ url: carPhotos[0]?.url, alt: carPhotos[0]?.alt || "The Kia Sorento at the property", ratio: "4 / 3", label: "The Kia Sorento" })),
        h("div", {},
          h("h1", {}, "The car"),
          h("p", {}, "The keys are included in the deal — the car is the add-on. A Kia Sorento SUV, kept on the premises, yours to collect at the house."),
          h("ul", { class: "chips" },
            h("li", { class: "chip" }, `${money(vehicle.dailyRate, cur)} / day`),
            h("li", { class: "chip" }, "Collected at the property"),
            h("li", { class: "chip" }, "Paid on site"),
          ),
          h("p", {}, h("a", { class: "btn btn--primary", href: "/book?car=1" }, "Add the car to your stay")),
        )
      )
    ),

    section("Specs", "specs-h",
      h("ul", { class: "fact-row fact-row--specs" }, ...[
        ["car", "Make & model", `${vehicle.name} ${vehicle.year}`],
        ["car", "Body", vehicle.bodyType],
        ["cog", "Transmission", vehicle.transmission],
        ["seat", "Seats", String(vehicle.seats)],
        ["fuel", "Fuel", vehicle.fuel],
        ["luggage", "Luggage", vehicle.luggage],
        ["pin", "Collection", vehicle.pickUpLocation],
        ["power", "Area", vehicle.geographicLimit],
      ].map(([ic, label, value]) => h("li", {}, icon(ic), h("span", {}, h("span", { class: "fact__label" }, label), h("br"), h("span", { class: "fact__value" }, value)))))
    ),

    vehicle.description ? section("About the car", "about-h", h("p", {}, vehicle.description)) : null,

    section("How it works", "how-h",
      h("ol", { class: "step-list" },
        h("li", {}, "Add the car to your booking request and choose pick-up and drop-off dates within your stay."),
        h("li", {}, "The host confirms the car is free for your dates when they approve your booking."),
        h("li", {}, "On arrival, sign the handover checklist and collect the keys at the house — bring your licence and passport."),
        h("li", {}, `Return it with the same fuel level, on your drop-off date.`),
        h("li", {}, "Pay on site — the daily rate and the refundable deposit are settled with the host, not on this website."),
      )
    ),

    section("Driver requirements", "drv-h",
      h("ul", {}, ...(vehicle.driverRequirements || []).map((r) => h("li", {}, r))),
      vehicle.minDriverAge
        ? h("p", { class: "price-breakdown__note" }, `In short: primary driver ${vehicle.minDriverAge}+, licence held ${vehicle.minLicenceYears}+ years. Your date of birth and licence details are checked when you submit the request.`)
        : null,
    ),

    section("What's covered, what's not", "cov-h",
      h("div", { class: "included-grid" },
        h("div", {}, h("h3", {}, "Covered"),
          h("ul", { class: "included-list" }, ...(vehicle.covered || []).map((t) => h("li", {}, h("span", { class: "mark mark--yes", "aria-hidden": "true" }, "✓"), h("span", {}, t))))),
        h("div", {}, h("h3", {}, "Not covered / your responsibility"),
          h("ul", { class: "included-list" }, ...(vehicle.notCovered || []).map((t) => h("li", {}, h("span", { class: "mark mark--no", "aria-hidden": "true" }, "✕"), h("span", {}, t))))),
      ),
      h("p", { class: "price-breakdown__note" }, `Damage excess / security deposit: ${money(vehicle.depositAmount, cur)}. ${vehicle.geographicLimit}.`),
    ),

    section("The rental agreement", "agr-h",
      h("ul", {}, ...(vehicle.agreement?.summaryPoints || []).map((p) => h("li", {}, p))),
      h("p", {}, `Current version: v${vehicle.agreement?.version} · effective ${formatDate(vehicle.agreement?.effectiveDate)}.`),
      h("p", {}, h("a", { class: "btn btn--ghost", href: "/vehicle-rental-agreement" }, "Read the full Kia Sorento Rental Agreement")),
      h("p", { class: "price-breakdown__note" }, "You'll review and accept this as part of your booking request if you add the car."),
    ),

    ctaBand({ bookingMode: property?.bookingMode, title: "Add the car to your stay", text: "Choose your dates and toggle the car on in step 2.", property }),
  );

  // add car pre-select to the CTA band widget
  $(".cta-band form")?.addEventListener("submit", () => {}, { once: true });
})();

function section(title, id, ...content) {
  return h("section", { class: "section", "aria-labelledby": id },
    h("div", { class: "container" }, h("h2", { id }, title), ...content));
}

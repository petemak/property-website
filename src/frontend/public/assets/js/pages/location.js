// P4 — Location & getting around.

import { initPublicPage, errorNotice } from "./common.js";
import { h, $, mount } from "../lib/dom.js";
import { smartImage } from "../components/media.js";
import { ctaBand } from "../components/booking-widget.js";
import { minutesToText } from "../lib/format.js";

const root = $("#location-root");

(async function () {
  const { property } = await initPublicPage();
  if (!property) { mount(root, errorNotice({ message: "We couldn't load the location details." })); return; }

  const loc = property.location || {};
  const pois = loc.pointsOfInterest || [];
  const transport = pois.filter((p) => p.category === "transport" || p.category === "essentials");
  const trips = pois.filter((p) => p.category === "trip");
  root.className = "";

  mount(root,
    h("div", { class: "container" },
      h("header", { class: "page-hero" },
        h("h1", {}, "Location & getting around"),
        h("p", {}, `${property.neighbourhood || "Kigali"} — the exact address and pin are sent once your booking is approved.`),
      ),
      h("div", { class: "mini-map" },
        smartImage({ url: loc.staticMapUrl, alt: `Approximate location map centred on ${property.neighbourhood || "Kigali"}`, ratio: "16 / 9", label: "Approximate location map" }),
        h("p", { class: "mini-map__note" }, "This pin is approximate. The precise address and a map link are shared in the approval email."),
      ),
    ),

    section("Travel times", "tt-h",
      h("h3", {}, "Around the city"),
      ttList(transport),
      trips.length ? h("h3", {}, "Weekend trips") : null,
      trips.length ? h("div", { class: "stack" },
        ttList(trips, true),
        h("p", { class: "price-breakdown__note" }, "Times with the Kia Sorento. Without a car you'd need a hired driver or an intercity bus from Nyabugogo."),
      ) : null,
    ),

    property.neighbourhoodText ? section("The neighbourhood", "nb-h", h("p", {}, property.neighbourhoodText)) : null,
    property.arrivalGuide ? section("Arriving in Kigali", "arr-h", prose(property.arrivalGuide)) : null,
    property.gettingAroundWithoutCar ? section("Getting around without the car", "gac-h", prose(property.gettingAroundWithoutCar)) : null,

    ctaBand({ bookingMode: property.bookingMode, title: "Ready to pick dates?", property }),
  );
})();

function ttList(items, withKm) {
  return h("ul", { class: "travel-times" }, ...items.map((p) =>
    h("li", {},
      h("span", {}, p.name),
      h("span", { class: "tt__meta" }, `${minutesToText(p.minutesByCar)}${p.km ? ` · ${p.km} km` : ""}`),
    )));
}

function section(title, id, ...content) {
  return h("section", { class: "section", "aria-labelledby": id },
    h("div", { class: "container", style: "max-width:760px" }, h("h2", { id }, title), ...content));
}
function prose(text) {
  return h("div", { class: "stack" }, ...String(text).split(/\n{2,}/).map((p) => h("p", {}, p.trim())));
}

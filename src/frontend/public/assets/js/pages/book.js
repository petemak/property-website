// P5 — Request to book. A wizard whose step list comes from config (not
// hard-coded to 4) and whose post-review submit handler asks bookingMode what
// to do next — so a v2 payment step is a data change, not a rewrite.

import { initPublicPage, errorNotice } from "./common.js";
import { api, ApiError } from "../lib/api.js";
import { h, $, mount, announce } from "../lib/dom.js";
import { stepsFor, bookingCopy, PURPOSE_OPTIONS } from "../lib/config.js";
import { stepper } from "../components/stepper.js";
import { dateRangePicker } from "../components/date-range-picker.js";
import { priceBreakdown } from "../components/price-breakdown.js";
import { agreementPanel } from "../components/agreement-panel.js";
import { field, fieldset, numberStepper, setFieldError, clearErrors } from "../components/form.js";
import { COUNTRIES } from "../lib/countries.js";
import { money, isoDate, addDays, formatDateRange, nightsBetween, uuidv4 } from "../lib/format.js";

const root = $("#book-root");

(async function () {
  const { property } = await initPublicPage();
  if (!property) { mount(root, errorNotice({ message: "We couldn't start the booking form. Please refresh." })); return; }

  const copy = bookingCopy(property.bookingMode);
  const steps = stepsFor(property.bookingMode); // v1: 4 steps; v2 would include "payment"
  const maxGuests = property.maxGuests || 4;
  const minNights = property.pricing?.minNights || 3;
  const cur = property.pricing?.currency || "USD";
  const p = new URLSearchParams(location.search);

  const today = isoDate(new Date());
  const [availability, vehicle] = await Promise.all([
    api.getAvailability(today, addDays(today, 365)).catch(() => ({ unavailableDates: [] })),
    api.getVehicle().catch(() => null),
  ]);

  const state = {
    stepIndex: 0,
    checkIn: p.get("checkIn") || null,
    checkOut: p.get("checkOut") || null,
    adults: Math.max(1, Math.min(maxGuests, Number(p.get("guests")) || 2)),
    children: 0,
    car: {
      requested: p.get("car") === "1",
      pickUp: null, dropOff: null,
      driver: { fullName: "", dateOfBirth: "", licenceNumber: "", licenceCountry: "", meetsRequirements: false },
    },
    guest: { firstName: "", lastName: "", email: "", confirmEmail: "", phone: "", countryOfResidence: "", purposeOfStay: "remoteWork", message: "" },
    accept: { stayTerms: false, houseRules: false, vehicleRentalAgreement: false },
    agreementDoc: vehicle?.agreement || null,
    quote: null,
    submitError: null,
  };

  const stepperHost = h("div");
  const viewHost = h("div", { class: "wizard-view" });
  const railHost = h("aside", {});
  let quoteTimer;

  mount(root,
    h("header", { class: "page-hero" }, h("h1", {}, "Request to book"),
      h("p", {}, "Four steps: your dates, the car, your details, then review and accept. Nothing is charged here — the host confirms everything.")),
    stepperHost,
    h("div", { class: "split split--rail" }, viewHost, railHost),
  );

  quote();
  renderStep();

  // --------------------------------------------------------------- navigation
  function goto(index) {
    state.stepIndex = Math.max(0, Math.min(steps.length - 1, index));
    renderStep();
    root.scrollIntoView({ behavior: "smooth", block: "start" });
    $("#main")?.focus();
  }

  // The post-review "advance": v1 request-mode submits and lands on P6; v2
  // instant-mode would submit then advance to the "payment" step. Not "4 steps
  // ending in one API call".
  async function advanceFromReview() {
    const created = await submitBooking();
    if (!created) return;
    const next = steps[state.stepIndex + 1];
    if (next && next.id === "payment") { goto(state.stepIndex + 1); return; } // [v2 seam]
    try { sessionStorage.setItem("kk_last_booking", JSON.stringify({ reference: created.reference, email: state.guest.email })); } catch {}
    location.href = `/booking/${created.reference}?submitted=1`;
  }

  function renderStep() {
    const step = steps[state.stepIndex];
    stepperHost.replaceChildren(stepper(steps, step.id));
    let view;
    if (step.id === "trip") view = stepTrip();
    else if (step.id === "car") view = stepCar();
    else if (step.id === "details") view = stepDetails();
    else if (step.id === "review") view = stepReview();
    else view = h("p", {}, "This step is not part of the v1 build.");
    viewHost.replaceChildren(view);
    renderRail();
    announce(`Step ${state.stepIndex + 1} of ${steps.length}: ${step.label}`);
  }

  // --------------------------------------------------------------- rail
  function renderRail() {
    const items = state.quote?.lineItems || [];
    railHost.replaceChildren(
      h("div", { class: "summary-rail sticky-rail stack" },
        priceBreakdown({
          mode: "estimate", bookingMode: property.bookingMode, currency: state.quote?.currency || cur,
          lineItems: items, total: state.quote?.estimatedTotal,
          disclaimer: state.quote?.disclaimer,
          caption: copy.estimateSubLabel,
        }),
        state.checkIn && state.checkOut
          ? h("p", { class: "price-breakdown__note" }, `${formatDateRange(state.checkIn, state.checkOut)} · ${nightsBetween(state.checkIn, state.checkOut)} nights`)
          : null,
      ),
    );
  }

  function quote() {
    clearTimeout(quoteTimer);
    quoteTimer = setTimeout(async () => {
      if (!state.checkIn || !state.checkOut || nightsBetween(state.checkIn, state.checkOut) < minNights) {
        state.quote = null; renderRail(); return;
      }
      const body = { checkIn: state.checkIn, checkOut: state.checkOut, guests: state.adults + state.children };
      if (state.car.requested && state.car.pickUp && state.car.dropOff) {
        body.car = { requested: true, pickUp: state.car.pickUp, dropOff: state.car.dropOff };
      } else {
        body.car = { requested: false };
      }
      try { state.quote = await api.postQuote(body); }
      catch { state.quote = null; }
      renderRail();
    }, 250);
  }

  // --------------------------------------------------------------- step 1
  function stepTrip() {
    const picker = dateRangePicker({
      months: 2, minNights,
      unavailableDates: availability.unavailableDates || [],
      value: { checkIn: state.checkIn, checkOut: state.checkOut },
      onChange: ({ checkIn, checkOut }) => {
        state.checkIn = checkIn; state.checkOut = checkOut;
        if (state.car.requested) { state.car.pickUp = checkIn; state.car.dropOff = checkOut; }
        state.submitError = null;
        quote();
        cont.disabled = !(checkIn && checkOut);
      },
    });

    const adults = numberStepper({ label: "Adults", id: "g-adults", value: state.adults, min: 1, max: maxGuests, onChange: onGuests });
    const children = numberStepper({ label: "Children", id: "g-children", value: state.children, min: 0, max: maxGuests - 1, onChange: onGuests });
    const guestsNote = h("p", { class: "field-error", hidden: true, role: "alert" });

    function onGuests() {
      const total = adults.value + children.value;
      if (total > maxGuests) {
        guestsNote.textContent = `This home sleeps ${maxGuests}. Reduce the number of guests.`;
        guestsNote.hidden = false;
      } else {
        guestsNote.hidden = true;
        state.adults = adults.value; state.children = children.value;
        quote();
      }
    }

    const errBox = h("div", {});
    if (state.submitError) errBox.appendChild(alertBox(state.submitError));

    const cont = h("button", { class: "btn btn--primary", type: "button", disabled: !(state.checkIn && state.checkOut),
      onClick: () => {
        if (!state.checkIn || !state.checkOut) return;
        if (nightsBetween(state.checkIn, state.checkOut) < minNights) return;
        if (adults.value + children.value > maxGuests) return;
        goto(state.stepIndex + 1);
      } }, "Continue");

    return h("section", { class: "stack-lg", "aria-labelledby": "s1-h" },
      h("h2", { id: "s1-h" }, "Your trip"),
      errBox,
      h("div", { class: "card" },
        h("h3", {}, "Choose your dates"),
        h("p", { class: "price-breakdown__note" }, `Minimum stay ${minNights} nights. Greyed dates are already booked or blocked.`),
        picker,
      ),
      h("div", { class: "card" },
        h("h3", {}, "Guests"),
        h("div", { class: "field-row" }, adults.el, children.el),
        guestsNote,
        h("p", { class: "price-breakdown__note" }, `Maximum ${maxGuests} guests, including children.`),
      ),
      h("div", { class: "wizard-actions" }, cont),
    );
  }

  // --------------------------------------------------------------- step 2
  function stepCar() {
    const rate = money(vehicle?.dailyRate || 45, cur);
    const toggle = h("input", { type: "checkbox", id: "car-toggle", checked: state.car.requested,
      onChange: (e) => { state.car.requested = e.target.checked; syncCar(); driverWrap.hidden = !e.target.checked; offNote.hidden = e.target.checked; quote(); } });

    function syncCar() {
      if (state.car.requested) {
        state.car.pickUp = state.car.pickUp || state.checkIn;
        state.car.dropOff = state.car.dropOff || state.checkOut;
        if (pickUp) pickUp.value = state.car.pickUp || "";
        if (dropOff) dropOff.value = state.car.dropOff || "";
      }
    }

    const pickUp = h("input", { type: "date", id: "car-pick", value: state.car.pickUp || state.checkIn || "", min: state.checkIn || undefined, max: state.checkOut || undefined,
      onChange: (e) => { state.car.pickUp = e.target.value; quote(); } });
    const dropOff = h("input", { type: "date", id: "car-drop", value: state.car.dropOff || state.checkOut || "", min: state.checkIn || undefined, max: state.checkOut || undefined,
      onChange: (e) => { state.car.dropOff = e.target.value; quote(); } });

    const d = state.car.driver;
    const fullName = h("input", { type: "text", id: "drv-name", value: d.fullName, autocomplete: "name", onInput: (e) => (d.fullName = e.target.value) });
    const dob = h("input", { type: "date", id: "drv-dob", value: d.dateOfBirth, max: isoDate(new Date()), onInput: (e) => (d.dateOfBirth = e.target.value) });
    const lic = h("input", { type: "text", id: "drv-lic", value: d.licenceNumber, autocomplete: "off", onInput: (e) => (d.licenceNumber = e.target.value) });
    const licCountry = countrySelect("drv-licc", d.licenceCountry, (v) => (d.licenceCountry = v));
    const meets = h("input", { type: "checkbox", id: "drv-meets", checked: d.meetsRequirements, onChange: (e) => (d.meetsRequirements = e.target.checked) });

    const minAge = vehicle?.minDriverAge;
    const dobHint = minAge
      ? `The primary driver must be at least ${minAge} and have held a licence for ${vehicle.minLicenceYears}+ years. This is checked when you submit.`
      : "Used to check driver eligibility.";

    const driverWrap = h("div", { class: "stack", hidden: !state.car.requested },
      fieldset("Primary driver",
        field({ label: "Full name (as on the licence)", control: fullName, id: "drv-name" }),
        field({ label: "Date of birth", control: dob, id: "drv-dob", hint: dobHint }),
        h("div", { class: "field-row" },
          field({ label: "Licence number", control: lic, id: "drv-lic" }),
          field({ label: "Licence issuing country", control: licCountry, id: "drv-licc" }),
        ),
        h("div", { class: "checkbox-field" }, meets,
          h("label", { for: "drv-meets" }, "I meet the driver requirements (",
            h("a", { href: "/the-car#drv-h", target: "_blank", rel: "noopener" }, "see the list"), ").")),
      ),
    );

    const offNote = h("p", { class: "price-breakdown__note", hidden: state.car.requested }, "You can add the car later by contacting the host.");
    syncCar();

    const errBox = h("div", {});
    const cont = h("button", { class: "btn btn--primary", type: "button", onClick: () => {
      clearErrors(driverWrap); errBox.replaceChildren();
      if (state.car.requested) {
        let ok = true;
        if (!state.car.pickUp || !state.car.dropOff || state.car.dropOff <= state.car.pickUp) { errBox.appendChild(alertBox("Set a car pick-up and drop-off, with drop-off after pick-up.")); ok = false; }
        if (state.car.pickUp < state.checkIn || state.car.dropOff > state.checkOut) { errBox.appendChild(alertBox("Car dates must sit within your stay.")); ok = false; }
        if (!d.fullName.trim()) { setFieldError(fullName, "Enter the driver's full name."); ok = false; }
        if (!d.dateOfBirth) { setFieldError(dob, "Enter the driver's date of birth."); ok = false; }
        else if (minAge && ageOn(d.dateOfBirth, state.checkIn) < minAge) { setFieldError(dob, `The driver must be at least ${minAge} at check-in.`); ok = false; }
        if (d.licenceNumber.trim().length < 3) { setFieldError(lic, "Enter the licence number."); ok = false; }
        if (!d.licenceCountry) { setFieldError(licCountry, "Select the issuing country."); ok = false; }
        if (!d.meetsRequirements) { setFieldError(meets, "You must confirm you meet the driver requirements to add the car."); ok = false; }
        if (!ok) { driverWrap.querySelector('[aria-invalid="true"]')?.focus(); return; }
      }
      goto(state.stepIndex + 1);
    } }, "Continue");

    return h("section", { class: "stack-lg", "aria-labelledby": "s2-h" },
      h("h2", { id: "s2-h" }, "Add the Kia Sorento?"),
      h("div", { class: "card stack" },
        h("div", { class: "checkbox-field" }, toggle,
          h("label", { for: "car-toggle" }, `Add the car — ${rate}/day, paid on site.`)),
        offNote,
        h("div", { class: "field-row", hidden: !state.car.requested, id: "car-dates" },
          field({ label: "Pick-up date", control: pickUp, id: "car-pick" }),
          field({ label: "Drop-off date", control: dropOff, id: "car-drop" }),
        ),
      ),
      driverWrap,
      errBox,
      h("div", { class: "wizard-actions" },
        h("button", { class: "btn btn--ghost", type: "button", onClick: () => goto(state.stepIndex - 1) }, "Back"),
        cont),
    );
  }

  // --------------------------------------------------------------- step 3
  function stepDetails() {
    const g = state.guest;
    const first = h("input", { type: "text", id: "g-first", value: g.firstName, autocomplete: "given-name", onInput: (e) => (g.firstName = e.target.value) });
    const last = h("input", { type: "text", id: "g-last", value: g.lastName, autocomplete: "family-name", onInput: (e) => (g.lastName = e.target.value) });
    const email = h("input", { type: "email", id: "g-email", value: g.email, autocomplete: "email", onInput: (e) => (g.email = e.target.value) });
    const confirm = h("input", { type: "email", id: "g-email2", value: g.confirmEmail, autocomplete: "email", onInput: (e) => (g.confirmEmail = e.target.value) });
    const phone = h("input", { type: "tel", id: "g-phone", value: g.phone, autocomplete: "tel", placeholder: "+250 7…", onInput: (e) => (g.phone = e.target.value) });
    const country = countrySelect("g-country", g.countryOfResidence, (v) => (g.countryOfResidence = v));
    const purpose = h("select", { id: "g-purpose", onChange: (e) => (g.purposeOfStay = e.target.value) },
      ...PURPOSE_OPTIONS.map((o) => h("option", { value: o.value, selected: g.purposeOfStay === o.value }, o.label)));
    const message = h("textarea", { id: "g-message", maxlength: "2000", value: g.message,
      placeholder: "Arrival time, questions, anything the host should know.", onInput: (e) => (g.message = e.target.value) });

    const form = h("form", { class: "form", novalidate: true });
    const cont = h("button", { class: "btn btn--primary", type: "button", onClick: () => {
      clearErrors(form);
      let ok = true;
      if (!g.firstName.trim()) { setFieldError(first, "Enter your first name."); ok = false; }
      if (!g.lastName.trim()) { setFieldError(last, "Enter your last name."); ok = false; }
      if (!email.checkValidity() || !g.email) { setFieldError(email, "Enter a valid email address."); ok = false; }
      if (g.confirmEmail !== g.email) { setFieldError(confirm, "The two email addresses don't match."); ok = false; }
      if (g.phone.replace(/[^\d]/g, "").length < 8) { setFieldError(phone, "Enter a phone number with country code."); ok = false; }
      if (!g.countryOfResidence) { setFieldError(country, "Select your country of residence."); ok = false; }
      if (!ok) { form.querySelector('[aria-invalid="true"]')?.focus(); return; }
      goto(state.stepIndex + 1);
    } }, "Continue");

    mount(form,
      fieldset("About you",
        h("div", { class: "field-row" },
          field({ label: "First name", control: first, id: "g-first" }),
          field({ label: "Last name", control: last, id: "g-last" }),
        ),
        h("div", { class: "field-row" },
          field({ label: "Email", control: email, id: "g-email" }),
          field({ label: "Confirm email", control: confirm, id: "g-email2" }),
        ),
        h("div", { class: "field-row" },
          field({ label: "Phone (with country code)", control: phone, id: "g-phone" }),
          field({ label: "Country of residence", control: country, id: "g-country" }),
        ),
      ),
      fieldset("Your stay",
        field({ label: "Purpose of stay", control: purpose, id: "g-purpose" }),
        field({ label: "Message to the host (optional)", control: message, id: "g-message" }),
      ),
      h("div", { class: "wizard-actions" },
        h("button", { class: "btn btn--ghost", type: "button", onClick: () => goto(state.stepIndex - 1) }, "Back"),
        cont),
    );

    return h("section", { class: "stack-lg", "aria-labelledby": "s3-h" },
      h("h2", { id: "s3-h" }, "Your details"), form);
  }

  // --------------------------------------------------------------- step 4
  function stepReview() {
    const tv = property.termsVersions || {};
    const nights = nightsBetween(state.checkIn, state.checkOut);
    const q = state.quote;

    const submit = h("button", { class: "btn btn--primary", type: "button" }, copy.submitAction);
    const errBox = h("div", {});
    if (state.submitError) errBox.appendChild(alertBox(state.submitError));

    function refreshSubmit() {
      const need = ["stayTerms", "houseRules", ...(state.car.requested ? ["vehicleRentalAgreement"] : [])];
      submit.disabled = !need.every((k) => state.accept[k]);
    }

    const stayChk = acceptRow("stayTerms", `I have read and accept the booking terms and cancellation policy (v${tv.stayTerms ?? "?"}).`, "/cancellation-policy", refreshSubmit);
    const rulesChk = acceptRow("houseRules", `I have read and accept the house rules (v${tv.houseRules ?? "?"}).`, "/house-rules", refreshSubmit);

    let agreementBlock = null;
    if (state.car.requested) {
      const doc = state.agreementDoc || {};
      agreementBlock = h("div", { class: "card stack", id: "agr-block" },
        h("h3", {}, "Kia Sorento Rental Agreement"),
        agreementPanel({
          title: "Kia Sorento Rental Agreement",
          version: doc.version, effectiveDate: doc.effectiveDate,
          bodyMarkdown: doc.bodyMarkdown || "",
          fullLink: "/vehicle-rental-agreement",
          checkbox: {
            label: `I, ${state.car.driver.fullName || "the driver"}, have read and accept the Kia Sorento Rental Agreement (v${doc.version ?? "?"})${doc.effectiveDate ? ` dated ${new Date(doc.effectiveDate).toLocaleDateString("en-GB")}` : ""}.`,
            checked: state.accept.vehicleRentalAgreement,
            onToggle: (v) => { state.accept.vehicleRentalAgreement = v; refreshSubmit(); },
          },
        }),
      );
    }

    submit.addEventListener("click", advanceFromReview);
    refreshSubmit();

    return h("section", { class: "stack-lg", "aria-labelledby": "s4-h" },
      h("h2", { id: "s4-h" }, "Review & accept"),

      h("div", { class: "card stack" },
        h("h3", {}, "Your trip"),
        h("dl", { class: "detail-list" },
          h("dt", {}, "Dates"), h("dd", {}, `${formatDateRange(state.checkIn, state.checkOut)} · ${nights} nights`),
          h("dt", {}, "Guests"), h("dd", {}, `${state.adults} adult${state.adults === 1 ? "" : "s"}${state.children ? `, ${state.children} child${state.children === 1 ? "" : "ren"}` : ""}`),
        ),
        priceBreakdown({
          mode: "estimate", bookingMode: property.bookingMode,
          currency: q?.currency || cur, lineItems: q?.lineItems || [], total: q?.estimatedTotal,
          disclaimer: q?.disclaimer, caption: copy.estimateSubLabel,
        }),
      ),

      state.car.requested
        ? h("div", { class: "card stack" },
            h("h3", {}, "The car"),
            h("p", {}, `Kia Sorento, ${formatDateRange(state.car.pickUp, state.car.dropOff)}. Driver: ${state.car.driver.fullName || "—"}.`))
        : null,

      h("div", { class: "card stack" },
        h("h3", {}, "Booking terms & cancellation"),
        h("p", { class: "price-breakdown__note" }, "A request holds nothing until the host approves it. Cancellation windows and refunds are on the policy page."),
        stayChk),

      h("div", { class: "card stack" },
        h("h3", {}, "House rules"),
        h("p", { class: "price-breakdown__note" }, "Whole home, max 4 guests, no smoking indoors, no parties, quiet hours 22:00–06:00."),
        rulesChk),

      agreementBlock,

      h("p", { class: "price-breakdown__note" }, "Your details are stored so the host can process this request — see the ", h("a", { href: "/privacy" }, "privacy policy"), "."),

      errBox,

      h("div", { class: "wizard-actions wizard-submit-bar" },
        h("button", { class: "btn btn--ghost", type: "button", onClick: () => goto(state.stepIndex - 1) }, "Back"),
        submit),
    );

    function acceptRow(key, label, href, onToggle) {
      const id = `acc-${key}`;
      return h("div", { class: "checkbox-field" },
        h("input", { type: "checkbox", id, checked: state.accept[key], onChange: (e) => { state.accept[key] = e.target.checked; onToggle(); } }),
        h("label", { for: id }, label, " ", h("a", { href, target: "_blank", rel: "noopener" }, "Read the full policy")));
    }
  }

  // --------------------------------------------------------------- submit
  async function submitBooking() {
    const submitBtns = viewHost.querySelectorAll("button");
    const submit = viewHost.querySelector(".wizard-submit-bar .btn--primary");
    state.submitError = null;

    const need = ["stayTerms", "houseRules", ...(state.car.requested ? ["vehicleRentalAgreement"] : [])];
    if (!need.every((k) => state.accept[k])) return null;

    const tv = property.termsVersions || {};
    const acceptances = [
      { type: "stayTerms", version: tv.stayTerms, accepted: true },
      { type: "houseRules", version: tv.houseRules, accepted: true },
    ];
    if (state.car.requested) {
      acceptances.push({
        type: "vehicleRentalAgreement",
        version: state.agreementDoc?.version,
        bodyHash: state.agreementDoc?.bodyHash,
        accepted: true,
      });
    }

    const payload = {
      guest: {
        firstName: state.guest.firstName.trim(), lastName: state.guest.lastName.trim(),
        email: state.guest.email.trim(), phone: state.guest.phone.trim(),
        countryOfResidence: state.guest.countryOfResidence, purposeOfStay: state.guest.purposeOfStay,
      },
      stay: { checkIn: state.checkIn, checkOut: state.checkOut, adults: state.adults, children: state.children },
      message: state.guest.message.trim() || undefined,
      car: state.car.requested
        ? {
            requested: true, pickUp: state.car.pickUp, dropOff: state.car.dropOff,
            driver: {
              fullName: state.car.driver.fullName.trim(),
              dateOfBirth: state.car.driver.dateOfBirth,
              licenceNumber: state.car.driver.licenceNumber.trim(),
              licenceCountry: state.car.driver.licenceCountry,
              meetsRequirements: true,
            },
          }
        : { requested: false },
      acceptances,
      quoteEcho: state.quote ? { estimatedTotal: state.quote.estimatedTotal, currency: state.quote.currency } : undefined,
    };

    if (submit) {
      submit.disabled = true;
      submit.replaceChildren(h("span", { class: "btn__spinner", "aria-hidden": "true" }), " Sending…");
    }

    // one key for the life of this attempt; reused on retry so a repeat is a replay
    state._idemKey = state._idemKey || uuidv4();

    try {
      const { data } = await api.createBooking(payload, state._idemKey);
      return data;
    } catch (err) {
      if (submit) { submit.disabled = false; submit.textContent = copy.submitAction; }
      handleSubmitError(err);
      return null;
    }
  }

  function handleSubmitError(err) {
    if (!(err instanceof ApiError)) { state.submitError = "Something went wrong. Please try again."; renderStep(); return; }

    if (err.code === "agreementVersionStale") {
      // stay on review, re-fetch the vehicle, swap the text, clear only that box
      state._idemKey = null;
      api.getVehicle().then((v) => {
        state.agreementDoc = v.agreement;
        state.accept.vehicleRentalAgreement = false;
        state.submitError = "The rental agreement was updated — please review and accept the current version.";
        renderStep();
        viewHost.querySelector("#agr-block")?.scrollIntoView({ behavior: "smooth", block: "center" });
      }).catch(() => { state.submitError = err.message; renderStep(); });
      return;
    }

    if (err.code === "dateConflict" || err.code === "conflict") {
      state._idemKey = null;
      state.checkIn = null; state.checkOut = null;
      if (state.car.requested) { state.car.pickUp = null; state.car.dropOff = null; }
      state.quote = null;
      state.submitError = err.message || "One or more of these nights was just booked — please pick again.";
      goto(0);
      return;
    }

    if (err.code === "agreementRequired") {
      state.submitError = err.message || "Please accept all the required agreements.";
      renderStep();
      return;
    }

    if (err.code === "validationError") {
      // most validation maps to step 1 or 3; send them to step 1 with the message
      state._idemKey = null;
      state.submitError = err.message;
      goto(0);
      return;
    }

    state.submitError = err.message || "We couldn't send your request. Please try again.";
    renderStep();
  }

  function alertBox(msg) {
    return h("div", { class: "inline-alert inline-alert--error", role: "alert" },
      h("span", { class: "inline-alert__icon", "aria-hidden": "true" }, "!"), h("span", {}, msg));
  }
})();

function countrySelect(id, value, onChange) {
  return h("select", { id, onChange: (e) => onChange(e.target.value) },
    h("option", { value: "", selected: !value }, "Select…"),
    ...COUNTRIES.map(([code, name]) => h("option", { value: code, selected: value === code }, name)));
}

function ageOn(dobStr, onStr) {
  if (!dobStr || !onStr) return 0;
  const dob = new Date(dobStr), on = new Date(onStr);
  let age = on.getFullYear() - dob.getFullYear();
  const mm = on.getMonth() - dob.getMonth();
  if (mm < 0 || (mm === 0 && on.getDate() < dob.getDate())) age--;
  return age;
}

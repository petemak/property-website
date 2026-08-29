// DateRangePicker — accessible month-grid calendar.
// - consumes availability (unavailable nights disabled + greyed)
// - enforces minNights
// - keyboard operable (arrow keys, Home/End, PageUp/Down, Enter/Space)
// - announces the selected range
// (design-spec DateRangePicker; accessibility notes "operable by keyboard, announces selected range")

import { h, announce } from "../lib/dom.js";
import { isoDate, parseDate, formatDate, nightsBetween, addDays } from "../lib/format.js";

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function dateRangePicker({
  months = 2,
  minNights = 1,
  unavailableDates = [],
  value = {},
  onChange = () => {},
} = {}) {
  const unavailable = new Set(unavailableDates);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let viewYear = today.getFullYear();
  let viewMonth = today.getMonth();
  let focusDate = value.checkIn ? parseDate(value.checkIn) : new Date(today);
  let checkIn = value.checkIn || null;
  let checkOut = value.checkOut || null;

  const root = h("div", { class: "drp" });
  const status = h("p", { class: "drp__status", "aria-live": "polite" });
  const grids = h("div", { class: "drp__months" });

  const nav = h("div", { class: "drp__nav" },
    h("button", { type: "button", class: "btn btn--sm btn--ghost", onClick: () => shiftMonth(-1) }, "‹ Prev"),
    h("span", { class: "drp__nav-label", "aria-live": "polite" }),
    h("button", { type: "button", class: "btn btn--sm btn--ghost", onClick: () => shiftMonth(1) }, "Next ›"),
  );

  root.append(nav, grids, status);
  draw();
  return root;

  function shiftMonth(d) {
    viewMonth += d;
    if (viewMonth < 0) { viewMonth = 11; viewYear--; }
    if (viewMonth > 11) { viewMonth = 0; viewYear++; }
    draw();
  }

  function isDisabled(dateStr) {
    const d = parseDate(dateStr);
    if (d < today) return true;
    return unavailable.has(dateStr);
  }

  // a night range is valid only if no night within it is unavailable
  function rangeHasBlocked(a, b) {
    let cur = a;
    while (cur < b) {
      if (unavailable.has(cur)) return true;
      cur = addDays(cur, 1);
    }
    return false;
  }

  function pick(dateStr) {
    if (isDisabled(dateStr)) return;
    if (!checkIn || (checkIn && checkOut) || dateStr <= checkIn) {
      checkIn = dateStr; checkOut = null;
      status.textContent = `Check-in ${formatDate(dateStr)} selected. Now choose your check-out date.`;
    } else {
      if (rangeHasBlocked(checkIn, dateStr)) {
        status.textContent = "That range includes a night that isn't available. Pick a different check-out date.";
        return;
      }
      const nights = nightsBetween(checkIn, dateStr);
      if (nights < minNights) {
        status.textContent = `Minimum stay is ${minNights} nights. Choose a later check-out date.`;
        return;
      }
      checkOut = dateStr;
      status.textContent = `${nights} nights selected: ${formatDate(checkIn)} to ${formatDate(checkOut)}.`;
      announce(status.textContent);
    }
    onChange({ checkIn, checkOut });
    draw();
  }

  function inRange(dateStr) {
    if (checkIn && checkOut) return dateStr >= checkIn && dateStr <= checkOut;
    return false;
  }

  function draw() {
    nav.querySelector(".drp__nav-label").textContent =
      new Date(viewYear, viewMonth, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    grids.replaceChildren();
    for (let m = 0; m < months; m++) {
      const my = new Date(viewYear, viewMonth + m, 1);
      grids.appendChild(monthGrid(my.getFullYear(), my.getMonth()));
    }
    // keep roving focus target valid
    const focusable = grids.querySelector(`[data-date="${isoDate2(focusDate)}"]`);
    if (!focusable) {
      const first = grids.querySelector('[role="gridcell"] button:not([aria-disabled="true"])');
      if (first) focusDate = parseDate(first.dataset.date);
    }
  }

  function monthGrid(y, m) {
    const first = new Date(y, m, 1);
    const startPad = (first.getDay() + 6) % 7; // Monday-first
    const daysInMonth = new Date(y, m + 1, 0).getDate();

    const table = h("table", { class: "drp__grid", role: "grid", "aria-label": first.toLocaleDateString("en-GB", { month: "long", year: "numeric" }) },
      h("caption", { class: "visually-hidden" }, first.toLocaleDateString("en-GB", { month: "long", year: "numeric" })),
      h("thead", {}, h("tr", {}, ...DOW.map((d) => h("th", { scope: "col" }, h("span", { "aria-hidden": "true" }, d.slice(0, 1)), h("span", { class: "visually-hidden" }, d))))),
    );
    const tbody = h("tbody", {});
    let row = h("tr", {});
    for (let i = 0; i < startPad; i++) row.appendChild(h("td", {}));

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = isoDate2(new Date(y, m, day));
      const disabled = isDisabled(dateStr);
      const selected = dateStr === checkIn || dateStr === checkOut;
      const within = inRange(dateStr);
      const isFocus = dateStr === isoDate2(focusDate);

      const btn = h("button", {
        type: "button",
        class: "drp__day" + (selected ? " is-selected" : "") + (within ? " is-in-range" : ""),
        "data-date": dateStr,
        "aria-disabled": disabled ? "true" : null,
        "aria-pressed": selected ? "true" : "false",
        "aria-label": `${formatDate(dateStr)}${disabled ? " (unavailable)" : ""}`,
        tabindex: isFocus ? "0" : "-1",
        onClick: () => pick(dateStr),
        onKeydown: (e) => onKey(e, dateStr),
      }, String(day));

      row.appendChild(h("td", { role: "gridcell" }, btn));
      if ((startPad + day) % 7 === 0) { tbody.appendChild(row); row = h("tr", {}); }
    }
    if (row.childNodes.length) tbody.appendChild(row);
    table.appendChild(tbody);
    return table;
  }

  function onKey(e, dateStr) {
    const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in moves) {
      e.preventDefault();
      focusDate = parseDate(addDays(dateStr, moves[e.key]));
      // ensure the month is visible
      if (focusDate.getMonth() !== viewMonth && focusDate < new Date(viewYear, viewMonth, 1)) shiftMonth(-1);
      else if (focusDate > new Date(viewYear, viewMonth + months, 0)) shiftMonth(1);
      else draw();
      const target = grids.querySelector(`[data-date="${isoDate2(focusDate)}"]`);
      if (target) target.focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const d = parseDate(dateStr);
      const shift = e.key === "Home" ? -((d.getDay() + 6) % 7) : (6 - ((d.getDay() + 6) % 7));
      focusDate = parseDate(addDays(dateStr, shift));
      draw();
      grids.querySelector(`[data-date="${isoDate2(focusDate)}"]`)?.focus();
    } else if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      shiftMonth(e.key === "PageUp" ? -1 : 1);
    }
  }
}

function isoDate2(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

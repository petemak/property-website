// Inline SVG icons — decorative unless labelled. Keyed by the `icon` strings
// the content API uses, with a safe fallback.

const PATHS = {
  wifi: "M12 18h.01M8.5 14.5a5 5 0 0 1 7 0M5 11a9 9 0 0 1 14 0M2 7.5a13 13 0 0 1 20 0",
  desk: "M3 10h18M4 10v8M20 10v8M6 14h4M4 10 6 5h12l2 5",
  bed: "M3 18v-6h18v6M3 12V7h9v5M21 18v-3",
  bath: "M4 12h16v4a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-4ZM7 12V6a2 2 0 0 1 4 0",
  guests: "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3 20a6 6 0 0 1 12 0M17 11a3 3 0 1 0 0-6M15 20a6 6 0 0 1 6 0",
  car: "M5 13 7 7h10l2 6M5 13h14v5H5zM7 18v2M17 18v2M7.5 15.5h.01M16.5 15.5h.01",
  power: "M13 3v9M7 6a8 8 0 1 0 10 0",
  kitchen: "M8 3v7M6 3v7M10 3v7M8 10v11M15 3c-1.5 2-1.5 8 0 10v8",
  shield: "M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Z",
  key: "M15 7a4 4 0 1 1-4 4M11 11l-7 7v3h3l1-1v-2h2v-2h2l1-1",
  clock: "M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z",
  pin: "M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11ZM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  seat: "M6 4h4l1 8h5v4H8l-2-8ZM8 16v4M16 16v4",
  fuel: "M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h13M14 9h3a2 2 0 0 1 2 2v6a2 2 0 0 0 2 2M17 5l2 2",
  luggage: "M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M5 7h14v13H5zM9 20v1M15 20v1",
  cog: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19 12a7 7 0 0 0-.1-1l2-1.5-2-3.5-2.4 1a7 7 0 0 0-1.7-1L14.5 3h-5l-.3 2.5a7 7 0 0 0-1.7 1l-2.4-1-2 3.5L3.1 11a7 7 0 0 0 0 2l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 1.7 1l.3 2.5h5l.3-2.5a7 7 0 0 0 1.7-1l2.4 1 2-3.5-2-1.5a7 7 0 0 0 .1-1Z",
};

export function icon(name, { size = 22, className = "fact__icon" } = {}) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  if (className) svg.setAttribute("class", className);
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", PATHS[name] || PATHS.key);
  svg.appendChild(p);
  return svg;
}

export const CATEGORY_ICON = {
  work: "desk", kitchen: "kitchen", comfort: "bed", building: "shield", safety: "shield",
};

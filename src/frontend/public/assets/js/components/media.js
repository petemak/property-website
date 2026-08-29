// Neutral, obviously-a-placeholder graphic in the brand palette.
// Used when an image URL is missing or fails to load. Never a random-photo service.

import { h } from "../lib/dom.js";

const PALETTE = ["#1F5B4E", "#2B6B5C", "#D97A45", "#E7DFD2"];

export function placeholderSvg(label = "Photo coming soon", { ratio = "4 / 3" } = {}) {
  const [w, hh] = ratio.split("/").map((n) => parseFloat(n.trim()));
  const vw = 400, vh = Math.round((400 * hh) / w);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${vw} ${vh}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", label);
  svg.setAttribute("preserveAspectRatio", "xMidYMid slice");
  svg.innerHTML = `
    <rect width="${vw}" height="${vh}" fill="${PALETTE[3]}"/>
    <path d="M0 ${vh} L${vw * 0.35} ${vh * 0.55} L${vw * 0.6} ${vh * 0.78} L${vw} ${vh * 0.4} L${vw} ${vh} Z" fill="${PALETTE[1]}" opacity="0.55"/>
    <path d="M0 ${vh} L${vw * 0.5} ${vh * 0.7} L${vw} ${vh * 0.85} L${vw} ${vh} Z" fill="${PALETTE[0]}" opacity="0.75"/>
    <circle cx="${vw * 0.78}" cy="${vh * 0.28}" r="${vh * 0.09}" fill="${PALETTE[2]}"/>
    <text x="50%" y="${vh - 14}" text-anchor="middle" font-family="Georgia, serif"
      font-size="16" fill="#2B2A28" opacity="0.75">${escapeText(label)}</text>
  `;
  return svg;
}

function escapeText(s) {
  return String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
}

// Returns an <img> that swaps itself for a placeholder SVG on error / when no url.
export function smartImage({ url, alt, ratio = "4 / 3", label, className, loading = "lazy" }) {
  const wrap = h("span", { class: "smart-image" + (className ? " " + className : ""), style: `display:block;aspect-ratio:${ratio}` });
  if (!url) {
    wrap.appendChild(placeholderSvg(label || alt || "Photo coming soon", { ratio }));
    return wrap;
  }
  const img = h("img", { src: url, alt: alt || "", loading, decoding: "async" });
  img.style.width = "100%";
  img.style.height = "100%";
  img.style.objectFit = "cover";
  img.addEventListener("error", () => {
    wrap.replaceChildren(placeholderSvg(label || alt || "Photo unavailable", { ratio }));
  });
  wrap.appendChild(img);
  return wrap;
}

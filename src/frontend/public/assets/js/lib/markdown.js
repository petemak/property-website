// Minimal, safe markdown -> HTML for the "safe subset" the API sends
// (headings, paragraphs, bold/italic, links, lists). All text is escaped first,
// so no raw HTML from the payload can execute.

import { escapeHtml } from "./dom.js";

export function renderMarkdown(src) {
  if (!src) return "";
  const lines = String(src).replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let listType = null;
  let para = [];

  const flushPara = () => {
    if (para.length) { out.push(`<p>${inline(para.join(" "))}</p>`); para = []; }
  };
  const closeList = () => { if (listType) { out.push(`</${listType}>`); listType = null; } };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { flushPara(); closeList(); continue; }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushPara(); closeList();
      const level = Math.min(6, heading[1].length + 1); // demote so page h1 stays unique
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    const ul = line.match(/^[-*]\s+(.*)$/);
    const ol = line.match(/^\d+\.\s+(.*)$/);
    if (ul || ol) {
      flushPara();
      const want = ul ? "ul" : "ol";
      if (listType && listType !== want) closeList();
      if (!listType) { listType = want; out.push(`<${want}>`); }
      out.push(`<li>${inline((ul || ol)[1])}</li>`);
      continue;
    }

    closeList();
    para.push(line.trim());
  }
  flushPara(); closeList();
  return out.join("\n");
}

function inline(text) {
  let s = escapeHtml(text);
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/g,
    (_, label, href) => `<a href="${escapeHtml(href)}">${label}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  return s;
}

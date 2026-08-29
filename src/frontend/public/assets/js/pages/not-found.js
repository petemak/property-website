// P13 — 404.

import { initPublicPage } from "./common.js";
import { $ } from "../lib/dom.js";

(async function () {
  await initPublicPage();
  const form = $("#lookup-form");
  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    const ref = $("#ref").value.trim();
    if (ref) location.href = `/booking/${encodeURIComponent(ref)}`;
  });
})();

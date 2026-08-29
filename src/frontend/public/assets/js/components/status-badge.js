// StatusBadge — known statuses get a specific variant; unknown values fall back
// to a neutral badge. Never throws on an unrecognised status.

import { h } from "../lib/dom.js";
import { statusMeta } from "../lib/config.js";

export function statusBadge(status) {
  const meta = statusMeta(status);
  return h("span", {
    class: `status-badge status-badge--${meta.variant}`,
    title: meta.unknown ? `Status: ${status}` : null,
  }, meta.label);
}

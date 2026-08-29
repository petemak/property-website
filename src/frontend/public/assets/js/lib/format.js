// Formatting helpers. Money is major units + ISO currency (api-contract Conventions).

export function money(amount, currency = "USD") {
  if (amount == null || isNaN(amount)) return "—";
  try {
    return new Intl.NumberFormat("en", {
      style: "currency", currency, maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

export function isoDate(d) {
  if (!(d instanceof Date)) d = new Date(d);
  return d.toISOString().slice(0, 10);
}

export function parseDate(str) {
  // YYYY-MM-DD as a local calendar date (no TZ shift)
  const [y, m, day] = String(str).split("-").map(Number);
  return new Date(y, m - 1, day);
}

export function formatDate(str, opts = { day: "numeric", month: "short", year: "numeric" }) {
  if (!str) return "—";
  try { return parseDate(str).toLocaleDateString("en-GB", opts); }
  catch { return str; }
}

export function formatDateRange(a, b) {
  if (!a || !b) return "—";
  const da = parseDate(a), db = parseDate(b);
  const sameYear = da.getFullYear() === db.getFullYear();
  const sameMonth = sameYear && da.getMonth() === db.getMonth();
  const left = da.toLocaleDateString("en-GB", { day: "numeric", month: sameMonth ? undefined : "short" });
  const right = db.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return `${left} – ${right}`;
}

export function formatDateTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-GB", {
      day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

export function nightsBetween(checkIn, checkOut) {
  if (!checkIn || !checkOut) return 0;
  const ms = parseDate(checkOut) - parseDate(checkIn);
  return Math.max(0, Math.round(ms / 86400000));
}

export function addDays(str, n) {
  const d = parseDate(str);
  d.setDate(d.getDate() + n);
  return isoDate(new Date(d.getTime() - d.getTimezoneOffset() * 60000));
}

export function maskEmail(email) {
  if (!email || !email.includes("@")) return "your email";
  const [user, domain] = email.split("@");
  const head = user.slice(0, 2);
  return `${head}${"•".repeat(Math.max(1, user.length - 2))}@${domain}`;
}

export function minutesToText(mins) {
  if (mins == null) return "";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function uuidv4() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16));
}

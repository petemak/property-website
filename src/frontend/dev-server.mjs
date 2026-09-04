/**
 * DEV ONLY — static file server + in-memory mock of api-contract.md.
 *
 * This is NOT part of the deployable frontend. The production build is the
 * static contents of ./public served by any host/CDN, with the pretty-route
 * rewrites in ./public/_redirects and /api/* proxied to the real backend.
 *
 * Run:  node src/frontend/dev-server.mjs [port]
 */
import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("./public/", import.meta.url));
const FIX = fileURLToPath(new URL("./mock/fixtures/", import.meta.url));
// Owner-supplied real photos (repo root /assets/property-photos). In production
// the backend serves these under /api/media/... ; the mock does the same here.
const PHOTOS = fileURLToPath(new URL("../../assets/property-photos/", import.meta.url));
const PORT = Number(process.argv[2]) || 4173;

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".woff2": "font/woff2", ".ico": "image/x-icon",
};

// Mock-only: which transport result POST /admin/email-templates/:key/test
// reports, so the UI's sent / stored / failed branches are all reachable.
const MAIL_TEST_OUTCOME = {
  bookingApproved: { status: "sent" },
  adminInvite: { status: "failed", error: "SMTP 550: relay access denied" },
};

const load = async (f) => JSON.parse(await readFile(join(FIX, f), "utf8"));
const property = await load("property.json");
const vehicle = await load("vehicle.json");
const gallery = await load("gallery.json");
const documents = await load("documents.json");
const admin = await load("admin.json");
const sentEmails = await load("sent-emails.json");
documents.vehicleRentalAgreement.bodyMarkdown = vehicle.agreement.bodyMarkdown;

// ---- mutable in-memory state ----
const state = {
  pricing: { ...admin.pricing },
  settings: { ...admin.settings },
  blocks: [...admin.blocks],
  bookings: [],
  acceptances: [],
  idem: new Map(),
  session: false, // dev: start signed out so the login flow is exercised
};

seedBookings();

const PRETTY = {
  "/": "index.html", "/gallery": "gallery.html", "/the-car": "the-car.html",
  "/location": "location.html", "/book": "book.html", "/contact": "contact.html",
  "/terms": "terms.html", "/privacy": "privacy.html", "/house-rules": "house-rules.html",
  "/cancellation-policy": "cancellation-policy.html",
  "/vehicle-rental-agreement": "vehicle-rental-agreement.html",
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = decodeURIComponent(url.pathname);

  if (path.startsWith("/api/")) return handleApi(req, res, url).catch((e) => send(res, 500, { error: { code: "internalError", message: String(e) } }));

  // pretty routes
  let file = PRETTY[path];
  if (!file) {
    if (path === "/booking" || path.startsWith("/booking/")) file = "booking.html";
    else if (path === "/admin" || path.startsWith("/admin/")) file = "admin.html";
    else if (path.endsWith("/")) file = path.slice(1) + "index.html";
    else file = path.slice(1);
  }
  let full = normalize(join(ROOT, file));
  if (!full.startsWith(ROOT)) return send(res, 403, "Forbidden");
  const found = existsSync(full);
  if (!found) full = join(ROOT, "404.html");
  try {
    const body = await readFile(full);
    res.writeHead(found ? 200 : 404, {
      "Content-Type": MIME[extname(full)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(body);
  } catch {
    send(res, 404, "Not found");
  }
});

server.listen(PORT, () => console.log(`Kigali Keys frontend (dev + mock API) → http://localhost:${PORT}`));

// ---------------------------------------------------------------------------

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== "string";
  res.writeHead(status, { "Content-Type": isJson ? "application/json" : "text/plain; charset=utf-8", ...headers });
  res.end(isJson ? JSON.stringify(body) : body);
}
const err = (res, status, code, message, headers) => send(res, status, { error: { code, message } }, headers);

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return { __raw: raw }; }
}

async function handleApi(req, res, url) {
  const p = url.pathname.replace(/^\/api/, "");
  const q = url.searchParams;
  const m = req.method;

  // ---- media ----
  if (p.startsWith("/media/")) {
    // Real owner photos: /api/media/photos/<category>/<file>  and the public map.
    let rel = null;
    if (p.startsWith("/media/photos/")) rel = p.slice("/media/photos/".length);
    else if (p === "/media/map/approx.png") rel = "location-map/approximate-location.png";
    if (rel && !rel.includes("..") && !/exact-location/.test(rel)) {
      const file = normalize(join(PHOTOS, rel));
      if (file.startsWith(PHOTOS) && existsSync(file)) {
        res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream", "Cache-Control": "public,max-age=300" });
        return res.end(await readFile(file));
      }
    }
    // Fallback: neutral brand-palette placeholder (same as the frontend renders).
    res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "public,max-age=300" });
    return res.end(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 260"><rect width="400" height="260" fill="#E7DFD2"/><path d="M0 260 L160 150 L250 200 L400 110 L400 260Z" fill="#1F5B4E" opacity=".7"/><circle cx="310" cy="70" r="24" fill="#D97A45"/><text x="200" y="240" text-anchor="middle" font-family="Georgia,serif" font-size="15" fill="#2B2A28">Photo placeholder</text></svg>`);
  }

  // ---- PUBLIC ----
  if (p === "/property" && m === "GET") return send(res, 200, property);
  if (p === "/gallery" && m === "GET") return send(res, 200, gallery);

  if (p === "/availability" && m === "GET") {
    const from = q.get("from"), to = q.get("to");
    if (!from || !to) return err(res, 400, "validationError", "from and to are required (YYYY-MM-DD).");
    const unavailable = expandBlocks(state.blocks.filter((b) => b.reason !== "__car"));
    return send(res, 200, {
      currency: state.pricing.currency, nightlyRate: state.pricing.nightlyRate,
      cleaningFee: state.pricing.cleaningFee, minNights: state.pricing.minNights,
      rangeStart: from, rangeEnd: to,
      unavailableDates: unavailable.filter((d) => d >= from && d <= to),
      carUnavailableDates: expandBlocks(state.blocks.filter((b) => b.reason === "__car")).filter((d) => d >= from && d <= to),
    });
  }

  if (p === "/quote" && m === "POST") {
    const b = await readBody(req);
    const nights = daysBetween(b.checkIn, b.checkOut);
    if (!b.checkIn || !b.checkOut || nights <= 0) return err(res, 400, "validationError", "checkOut must be after checkIn.");
    if (nights < state.pricing.minNights) return err(res, 400, "validationError", `Minimum stay is ${state.pricing.minNights} nights.`);
    const cur = state.pricing.currency;
    const lineItems = [
      { code: "accommodation", label: `${cur} ${state.pricing.nightlyRate} x ${nights} nights`, amount: state.pricing.nightlyRate * nights },
      { code: "cleaningFee", label: "Cleaning fee", amount: state.pricing.cleaningFee },
    ];
    let carDays = 0;
    if (b.car && b.car.requested) {
      carDays = daysBetween(b.car.pickUp, b.car.dropOff);
      if (carDays <= 0) return err(res, 400, "validationError", "Car drop-off must be after pick-up.");
      lineItems.push({ code: "carRental", label: `Kia Sorento x ${carDays} days (${cur} ${vehicle.dailyRate}/day, paid on site)`, amount: vehicle.dailyRate * carDays });
    }
    const total = lineItems.reduce((s, li) => s + li.amount, 0);
    return send(res, 200, {
      currency: cur, nights, carDays, lineItems,
      estimatedSubtotal: total, estimatedTotal: total,
      disclaimer: "Estimate only. The host confirms the final amount when approving your request. Car rental is paid on site.",
    });
  }

  if (p === "/vehicle" && m === "GET") return send(res, 200, vehicle);

  if (p === "/bookings" && m === "POST") return createBooking(req, res);

  const bref = p.match(/^\/bookings\/([^/]+)$/);
  if (bref && m === "GET") {
    const booking = state.bookings.find((x) => x.reference === bref[1]);
    const email = q.get("email"), token = q.get("token");
    if (!booking) return err(res, 404, "notFound", "We couldn't find that booking.");
    const ok = (token && token === booking.__token) || (email && email.toLowerCase() === booking.__email.toLowerCase());
    if (!ok) return err(res, 404, "notFound", "We couldn't find that booking.");
    return send(res, 200, publicBookingView(booking));
  }

  if (p === "/contact" && m === "POST") {
    const b = await readBody(req);
    if (!b.name || !b.email || !b.message || !["bookingQuestion", "theCar", "existingRequest", "other"].includes(b.topic))
      return err(res, 422, "validationError", "Please provide your name, a valid email, a topic and a message.");
    return send(res, 202, { received: true });
  }

  const doc = p.match(/^\/documents\/([^/]+)\/([^/]+)$/);
  if (doc && m === "GET") {
    const d = documents[doc[1]];
    if (!d) return err(res, 404, "notFound", "Unknown document type.");
    return send(res, 200, d);
  }

  // ---- ADMIN AUTH ----
  if (p === "/admin/auth/login" && m === "POST") {
    const b = await readBody(req);
    const found = admin.credentials.find((c) => c.email === b.email && c.password === b.password);
    if (!found) return err(res, 401, "unauthorized", "Email or password is incorrect.");
    state.session = found.user;
    return send(res, 200, { user: found.user }, { "Set-Cookie": "session=dev; HttpOnly; SameSite=Lax; Path=/" });
  }
  if (p === "/admin/auth/accept-invite" && m === "POST") {
    const b = await readBody(req);
    if (!b.token) return err(res, 410, "conflict", "This invite link is invalid or has expired.");
    if (!b.password || b.password.length < 10) return err(res, 422, "validationError", "Password must be at least 10 characters.");
    const invited = admin.users.find((u) => u.status === "invited");
    if (!invited) return err(res, 410, "conflict", "This invite link has already been used.");
    invited.status = "active";
    const user = { id: invited.id, name: invited.name, email: invited.email, role: invited.role };
    state.session = user;
    return send(res, 200, { user }, { "Set-Cookie": "session=dev; HttpOnly; SameSite=Lax; Path=/" });
  }
  if (p === "/admin/auth/logout" && m === "POST") { state.session = false; return send(res, 204, ""); }
  if (p === "/admin/auth/session" && m === "GET") {
    if (!state.session) return err(res, 401, "unauthorized", "Not signed in.");
    return send(res, 200, { user: state.session === true ? admin.session.user : state.session });
  }

  // gate the rest
  if (p.startsWith("/admin/")) {
    if (!state.session) return err(res, 401, "unauthorized", "Not signed in.");
    const role = state.session === true ? "owner" : state.session.role;
    const ownerOnly = /^\/admin\/(users|settings)/.test(p);
    if (ownerOnly && role !== "owner") return err(res, 403, "forbidden", "Only the owner can manage administrators and settings.");
    return handleAdmin(req, res, p, q, m);
  }

  return err(res, 404, "notFound", "No such endpoint.");
}

async function handleAdmin(req, res, p, q, m) {
  // bookings
  if (p === "/admin/bookings" && m === "GET") {
    const status = q.get("status") || "pending";
    let items = state.bookings.map(adminListRow);
    if (status !== "all") items = items.filter((b) => b.status === status);
    const qq = (q.get("q") || "").toLowerCase();
    if (qq) items = items.filter((b) => (b.guestName + b.guestEmail + b.reference).toLowerCase().includes(qq));
    if (q.get("car") === "true") items = items.filter((b) => b.carRequested);
    if (q.get("car") === "false") items = items.filter((b) => !b.carRequested);
    const page = Number(q.get("page")) || 1, pageSize = Number(q.get("pageSize")) || 20;
    return send(res, 200, { items: items.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: items.length });
  }
  const bd = p.match(/^\/admin\/bookings\/([^/]+)$/);
  if (bd && m === "GET") {
    const b = state.bookings.find((x) => x.id === bd[1]);
    if (!b) return err(res, 404, "notFound", "No such booking.");
    return send(res, 200, adminBookingView(b));
  }
  const appr = p.match(/^\/admin\/bookings\/([^/]+)\/approve$/);
  if (appr && m === "POST") return decide(req, res, appr[1], "approve");
  const rej = p.match(/^\/admin\/bookings\/([^/]+)\/reject$/);
  if (rej && m === "POST") return decide(req, res, rej[1], "reject");

  // availability + pricing
  if (p === "/admin/availability/blocks" && m === "GET")
    return send(res, 200, { blocks: state.blocks.filter((b) => b.reason !== "__car").map(stripInternal) });
  if (p === "/admin/availability/blocks" && m === "POST") {
    const b = await readBody(req);
    if (!b.start || !b.end || b.end <= b.start) return err(res, 400, "validationError", "start and end are required; end must be after start.");
    const blk = { id: "blk_" + Math.random().toString(36).slice(2, 8), start: b.start, end: b.end, reason: b.reason || "Manual block", source: "manual" };
    state.blocks.push(blk);
    return send(res, 201, blk);
  }
  const delBlk = p.match(/^\/admin\/availability\/blocks\/([^/]+)$/);
  if (delBlk && m === "DELETE") {
    const blk = state.blocks.find((b) => b.id === delBlk[1]);
    if (blk && blk.source === "booking") return err(res, 403, "forbidden", "Remove by rejecting or cancelling the booking instead.");
    state.blocks = state.blocks.filter((b) => b.id !== delBlk[1]);
    return send(res, 204, "");
  }
  if (p === "/admin/pricing" && m === "GET") return send(res, 200, state.pricing);
  if (p === "/admin/pricing" && m === "PUT") {
    const b = await readBody(req);
    if (!(b.nightlyRate > 0) || b.cleaningFee < 0 || !(b.minNights >= 1 && b.minNights <= 30))
      return err(res, 422, "validationError", "nightlyRate must be > 0, cleaningFee >= 0, minNights 1..30.");
    state.pricing = { ...state.pricing, nightlyRate: b.nightlyRate, cleaningFee: b.cleaningFee, minNights: b.minNights };
    property.pricing.nightlyRate = b.nightlyRate;
    property.pricing.cleaningFee = b.cleaningFee;
    property.pricing.minNights = b.minNights;
    return send(res, 200, state.pricing);
  }

  // content
  if (p === "/admin/property" && m === "GET") return send(res, 200, property);
  if (p === "/admin/property" && m === "PUT") {
    const b = await readBody(req);
    Object.assign(property, b, { updatedAt: new Date().toISOString() });
    return send(res, 200, property);
  }

  // gallery
  if (p === "/admin/gallery" && m === "GET") return send(res, 200, gallery);
  if (p === "/admin/gallery" && m === "POST") {
    const id = "img_" + Math.random().toString(36).slice(2, 7);
    const img = { id, url: "", thumbnailUrl: "", alt: "Uploaded photo", caption: "", category: "Living", width: 2000, height: 1333, position: gallery.images.length + 1 };
    gallery.images.push(img);
    return send(res, 201, img);
  }
  const gp = p.match(/^\/admin\/gallery\/([^/]+)$/);
  if (gp && m === "PATCH") {
    const b = await readBody(req);
    const img = gallery.images.find((i) => i.id === gp[1]);
    if (!img) return err(res, 404, "notFound", "No such image.");
    Object.assign(img, b);
    return send(res, 200, img);
  }
  if (gp && m === "DELETE") {
    if (gallery.images.length <= 1) return err(res, 409, "conflict", "Cannot delete the only image.");
    gallery.images = gallery.images.filter((i) => i.id !== gp[1]);
    return send(res, 204, "");
  }
  if (p === "/admin/gallery/order" && m === "PUT") {
    const b = await readBody(req);
    gallery.images.sort((a, z) => b.orderedIds.indexOf(a.id) - b.orderedIds.indexOf(z.id));
    gallery.images.forEach((i, idx) => (i.position = idx + 1));
    return send(res, 200, gallery);
  }
  if (p === "/admin/gallery/lead" && m === "POST") {
    const b = await readBody(req);
    gallery.leadImageId = b.imageId;
    return send(res, 200, gallery);
  }

  // vehicle
  if (p === "/admin/vehicle" && m === "GET") return send(res, 200, { ...vehicle, versions: admin.agreementVersions });
  if (p === "/admin/vehicle" && m === "PUT") {
    const b = await readBody(req);
    Object.assign(vehicle, b);
    return send(res, 200, vehicle);
  }
  if (p === "/admin/vehicle/agreement/versions" && m === "GET") return send(res, 200, { versions: admin.agreementVersions });
  if (p === "/admin/vehicle/agreement" && m === "POST") {
    const b = await readBody(req);
    if (!b.bodyMarkdown || b.bodyMarkdown.length < 200) return err(res, 422, "validationError", "bodyMarkdown must be at least 200 characters.");
    const next = admin.agreementVersions[0].version + 1;
    admin.agreementVersions.forEach((v) => (v.isCurrent = false));
    const v = { version: next, effectiveDate: b.effectiveDate, publishedAt: new Date().toISOString(), publishedBy: "You", acceptanceCount: 0, isCurrent: true, bodyHash: "sha256:demo-v" + next };
    admin.agreementVersions.unshift(v);
    vehicle.agreement = { ...vehicle.agreement, version: next, effectiveDate: b.effectiveDate, bodyMarkdown: b.bodyMarkdown, summaryPoints: b.summaryPoints || vehicle.agreement.summaryPoints, bodyHash: v.bodyHash, publishedAt: v.publishedAt };
    return send(res, 201, v);
  }

  // legal docs
  const dv = p.match(/^\/admin\/documents\/([^/]+)\/versions$/);
  if (dv && m === "GET") {
    const d = documents[dv[1]];
    return send(res, 200, { versions: d ? [{ version: d.version, effectiveDate: d.effectiveDate, publishedAt: d.publishedAt, publishedBy: "Jean", isCurrent: true }] : [] });
  }
  const dpub = p.match(/^\/admin\/documents\/([^/]+)$/);
  if (dpub && m === "POST") {
    const b = await readBody(req);
    const d = documents[dpub[1]];
    if (d) { d.version += 1; d.bodyMarkdown = b.bodyMarkdown; d.effectiveDate = b.effectiveDate; }
    return send(res, 201, { version: d ? d.version : 1, effectiveDate: b.effectiveDate, publishedAt: new Date().toISOString(), isCurrent: true });
  }

  // acceptances
  if (p === "/admin/agreement-acceptances" && m === "GET") {
    let items = state.acceptances.slice();
    if (q.get("type")) items = items.filter((a) => a.type === q.get("type"));
    if (q.get("bookingReference")) items = items.filter((a) => a.bookingReference === q.get("bookingReference"));
    if (q.get("email")) items = items.filter((a) => a.acceptedByEmail.toLowerCase().includes(q.get("email").toLowerCase()));
    const page = Number(q.get("page")) || 1, pageSize = Number(q.get("pageSize")) || 20;
    return send(res, 200, { items: items.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: items.length });
  }
  const ad = p.match(/^\/admin\/agreement-acceptances\/([^/]+)$/);
  if (ad && m === "GET") {
    const a = state.acceptances.find((x) => x.id === ad[1]);
    if (!a) return err(res, 404, "notFound", "No such record.");
    const snap = documents[a.type] || {};
    return send(res, 200, { ...a, documentSnapshot: { type: a.type, version: a.version, effectiveDate: snap.effectiveDate, bodyMarkdown: snap.bodyMarkdown, bodyHash: a.bodyHash } });
  }

  // email templates
  if (p === "/admin/email-templates" && m === "GET") return send(res, 200, { items: admin.emailTemplates.map((t) => ({ key: t.key, subject: t.subject, updatedAt: t.updatedAt })) });
  const et = p.match(/^\/admin\/email-templates\/([^/]+)$/);
  if (et && m === "GET") {
    const t = admin.emailTemplates.find((x) => x.key === et[1]);
    return t ? send(res, 200, t) : err(res, 404, "notFound", "No such template.");
  }
  if (et && m === "PUT") {
    const b = await readBody(req);
    const t = admin.emailTemplates.find((x) => x.key === et[1]);
    if (!t) return err(res, 404, "notFound", "No such template.");
    const used = (b.subject + " " + b.bodyMarkdown).match(/\{\{(\w+)\}\}/g) || [];
    const bad = used.map((u) => u.slice(2, -2)).filter((u) => !t.availableTokens.includes(u));
    if (bad.length) return err(res, 422, "validationError", `Unknown tokens: ${bad.join(", ")}.`);
    Object.assign(t, { subject: b.subject, bodyMarkdown: b.bodyMarkdown, updatedAt: new Date().toISOString() });
    return send(res, 200, t);
  }
  const etp = p.match(/^\/admin\/email-templates\/([^/]+)\/preview$/);
  if (etp && m === "POST") {
    const b = await readBody(req);
    const t = admin.emailTemplates.find((x) => x.key === etp[1]);
    let body = t.bodyMarkdown, subject = t.subject;
    for (const [k, v] of Object.entries(b.sampleContext || {})) { body = body.replaceAll(`{{${k}}}`, v); subject = subject.replaceAll(`{{${k}}}`, v); }
    return send(res, 200, { subject, html: `<!doctype html><body style="font-family:Inter,sans-serif;background:#FAF7F2;padding:24px"><div style="max-width:560px;margin:auto;background:#fff;border-radius:12px;padding:24px"><h1 style="font-family:Georgia,serif;color:#1F5B4E">Kigali Keys</h1><pre style="white-space:pre-wrap;font:inherit">${body}</pre></div></body>` });
  }
  const ett = p.match(/^\/admin\/email-templates\/([^/]+)\/test$/);
  if (ett && m === "POST") {
    // api-contract §26: 200 with { sent, to, status, error? }. The default
    // outbox transport records but doesn't transmit -> "stored". To exercise
    // the smtp-only "sent" / "failed" paths without env juggling, the mock
    // keys the outcome off the template being tested.
    const to = (state.session && state.session.email) || "admin@kigalikeys.rw";
    const outcome = MAIL_TEST_OUTCOME[ett[1]] || { status: "stored" };
    return send(res, 200, { sent: outcome.status !== "failed", to, ...outcome });
  }

  // sent-email log (outbox) — api-contract §26b. Read-only, newest first.
  if (p === "/admin/sent-emails" && m === "GET") {
    let items = sentEmails.items.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (q.get("templateKey") === "none") items = items.filter((e) => e.templateKey == null);
    else if (q.get("templateKey")) items = items.filter((e) => e.templateKey === q.get("templateKey"));
    const qq = (q.get("q") || "").toLowerCase();
    if (qq) items = items.filter((e) => `${e.toAddress} ${e.subject} ${e.bookingReference || ""}`.toLowerCase().includes(qq));
    if (q.get("from")) items = items.filter((e) => e.createdAt.slice(0, 10) >= q.get("from"));
    if (q.get("to")) items = items.filter((e) => e.createdAt.slice(0, 10) <= q.get("to"));
    const page = Number(q.get("page")) || 1, pageSize = Number(q.get("pageSize")) || 20;
    const rows = items.slice((page - 1) * pageSize, page * pageSize)
      .map(({ id, toAddress, templateKey, subject, bookingReference, status, createdAt }) =>
        ({ id, toAddress, templateKey, subject, bookingReference, status, createdAt }));
    return send(res, 200, { items: rows, page, pageSize, total: items.length });
  }
  const se = p.match(/^\/admin\/sent-emails\/([^/]+)$/);
  if (se && m === "GET") {
    const e = sentEmails.items.find((x) => x.id === se[1]);
    if (!e) return err(res, 404, "notFound", "No such email.");
    const { id, toAddress, templateKey, bookingReference, subject, html, status, createdAt } = e;
    return send(res, 200, { id, toAddress, templateKey, bookingReference, subject, html, status, createdAt });
  }

  // users + settings
  if (p === "/admin/users" && m === "GET") return send(res, 200, { users: admin.users });
  if (p === "/admin/users" && m === "POST") {
    const b = await readBody(req);
    if (admin.users.some((u) => u.email === b.email)) return err(res, 409, "conflict", "That email is already an administrator.");
    const u = { id: "usr_" + Math.random().toString(36).slice(2, 6), name: b.name, email: b.email, role: b.role || "admin", status: "invited", lastLoginAt: null };
    admin.users.push(u);
    return send(res, 201, u);
  }
  const up = p.match(/^\/admin\/users\/([^/]+)$/);
  if (up && m === "PATCH") {
    const b = await readBody(req);
    const u = admin.users.find((x) => x.id === up[1]);
    if (!u) return err(res, 404, "notFound", "No such user.");
    if ((b.role === "admin" || b.status === "disabled") && u.role === "owner" && admin.users.filter((x) => x.role === "owner" && x.status === "active").length <= 1)
      return err(res, 409, "conflict", "Cannot demote or disable the last owner.");
    Object.assign(u, b);
    return send(res, 200, u);
  }
  if (up && m === "DELETE") {
    admin.users = admin.users.filter((x) => x.id !== up[1]);
    return send(res, 204, "");
  }
  const uri = p.match(/^\/admin\/users\/([^/]+)\/resend-invite$/);
  if (uri && m === "POST") return send(res, 202, { sent: true });

  if (p === "/admin/settings" && m === "GET") return send(res, 200, state.settings);
  if (p === "/admin/settings" && m === "PUT") {
    const b = await readBody(req);
    state.settings = { ...state.settings, ...b };
    return send(res, 200, state.settings);
  }

  return err(res, 404, "notFound", "No such admin endpoint.");
}

// ---------------------------------------------------------------------------
// booking helpers
// ---------------------------------------------------------------------------
function daysBetween(a, b) {
  if (!a || !b) return 0;
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}
function expandBlocks(blocks) {
  const out = new Set();
  for (const b of blocks) {
    let d = new Date(b.start);
    const end = new Date(b.end);
    while (d < end) { out.add(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); }
  }
  return [...out].sort();
}
function stripInternal({ id, start, end, reason, source, bookingReference }) {
  return { id, start, end, reason, source, ...(bookingReference ? { bookingReference } : {}) };
}
function ref() {
  return "KK-" + Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

async function createBooking(req, res) {
  const key = req.headers["idempotency-key"];
  if (!key) return err(res, 400, "idempotencyKeyMissing", "Idempotency-Key header is required.");
  const body = await readBody(req);
  const seen = state.idem.get("POST /bookings|" + key);
  if (seen) {
    if (JSON.stringify(seen.body) !== JSON.stringify(body)) return err(res, 409, "idempotencyKeyConflict", "This key was used with a different request.");
    return send(res, seen.status, seen.response, { "Idempotency-Replayed": "true" });
  }

  const nights = daysBetween(body?.stay?.checkIn, body?.stay?.checkOut);
  if (!body.guest?.email || nights < state.pricing.minNights)
    return err(res, 422, "validationError", "Check your email address and that the stay meets the minimum nights.");

  const accepts = body.acceptances || [];
  const need = ["stayTerms", "houseRules", ...(body.car?.requested ? ["vehicleRentalAgreement"] : [])];
  for (const t of need) {
    const a = accepts.find((x) => x.type === t);
    if (!a || a.accepted !== true) return err(res, 422, "agreementRequired", `You must accept the ${t}.`);
    const cur = t === "vehicleRentalAgreement" ? vehicle.agreement.version : property.termsVersions[t];
    if (a.version < cur) return err(res, 409, "agreementVersionStale", `The ${t} was updated — please review and accept the current version.`);
    if (t === "vehicleRentalAgreement" && a.bodyHash !== vehicle.agreement.bodyHash)
      return err(res, 409, "agreementVersionStale", "The rental agreement was updated — please review and accept the current version.");
  }

  // date conflict check against approved bookings / manual blocks
  const wanted = expandBlocks([{ start: body.stay.checkIn, end: body.stay.checkOut }]);
  const taken = expandBlocks(state.blocks.filter((b) => b.reason !== "__car"));
  if (wanted.some((d) => taken.includes(d)))
    return err(res, 409, "dateConflict", "One or more of these nights was just booked — please pick again.");

  const reference = ref();
  const now = new Date().toISOString();
  const cur = state.pricing.currency;
  const lineItems = [
    { code: "accommodation", label: `${cur} ${state.pricing.nightlyRate} x ${nights} nights`, amount: state.pricing.nightlyRate * nights },
    { code: "cleaningFee", label: "Cleaning fee", amount: state.pricing.cleaningFee },
  ];
  let carDays = 0;
  if (body.car?.requested) {
    carDays = daysBetween(body.car.pickUp, body.car.dropOff);
    lineItems.push({ code: "carRental", label: `Kia Sorento x ${carDays} days (${cur} ${vehicle.dailyRate}/day, paid on site)`, amount: vehicle.dailyRate * carDays });
  }
  const total = lineItems.reduce((s, li) => s + li.amount, 0);

  const acceptancesRecorded = need.map((t, i) => {
    const version = t === "vehicleRentalAgreement" ? vehicle.agreement.version : property.termsVersions[t];
    const rec = {
      id: `acc_${reference}_${i}`, bookingId: "bkg_" + reference, bookingReference: reference,
      type: t, version, bodyHash: t === "vehicleRentalAgreement" ? vehicle.agreement.bodyHash : (documents[t]?.bodyHash || null),
      acceptedByName: `${body.guest.firstName} ${body.guest.lastName}`, acceptedByEmail: body.guest.email,
      acceptedAt: now, ipAddress: "127.0.0.1", userAgent: req.headers["user-agent"] || "dev",
      documentUrl: `/api/documents/${t}/${version}`, documentSnapshotId: `doc_${t}_v${version}`,
    };
    state.acceptances.unshift(rec);
    return { id: rec.id, type: t, version, acceptedAt: now };
  });

  const booking = {
    id: "bkg_" + reference, reference, status: "pending", submittedAt: now,
    __email: body.guest.email, __token: "tok-" + reference,
    guest: body.guest, message: body.message || "",
    stay: { checkIn: body.stay.checkIn, checkOut: body.stay.checkOut, nights, adults: body.stay.adults, children: body.stay.children || 0 },
    car: body.car?.requested
      ? { requested: true, pickUp: body.car.pickUp, dropOff: body.car.dropOff, carDays, driver: body.car.driver, driverName: body.car.driver?.fullName }
      : { requested: false },
    estimate: { currency: cur, lineItems, estimatedTotal: total },
    acceptances: state.acceptances.filter((a) => a.bookingReference === reference),
    decision: null,
    activityLog: [{ at: now, actor: "guest", event: "submitted" }],
  };
  state.bookings.unshift(booking);

  const response = {
    reference, status: "pending", submittedAt: now,
    stay: booking.stay,
    car: booking.car.requested ? { requested: true, pickUp: booking.car.pickUp, dropOff: booking.car.dropOff, driverName: booking.car.driverName } : { requested: false },
    estimate: { currency: cur, lineItems, estimatedTotal: total },
    acceptancesRecorded,
    statusUrl: `/booking/${reference}`, statusTokenSent: true,
  };
  state.idem.set("POST /bookings|" + key, { status: 201, response, body });
  return send(res, 201, response);
}

async function decide(req, res, id, kind) {
  const key = req.headers["idempotency-key"];
  if (!key) return err(res, 400, "idempotencyKeyMissing", "Idempotency-Key header is required.");
  const body = await readBody(req);
  const store = `POST /admin/bookings/${kind}|` + key;
  const seen = state.idem.get(store);
  if (seen) return send(res, 200, seen.response, { "Idempotency-Replayed": "true" });

  const b = state.bookings.find((x) => x.id === id);
  if (!b) return err(res, 404, "notFound", "No such booking.");
  if (b.status !== "pending") return err(res, 409, "alreadyDecided", `This booking is already ${b.status}.`);
  const now = new Date().toISOString();

  if (kind === "approve") {
    if (!body.addressLine || !body.checkInInstructions) return err(res, 422, "validationError", "Address and check-in instructions are required.");
    if (b.car.requested && !body.carCollection) return err(res, 422, "validationError", "Car collection details are required for a booking with the car.");
    const sum = (body.lineItems || []).reduce((s, li) => s + Number(li.amount || 0), 0);
    if (Number(body.total) !== sum) return err(res, 422, "validationError", "Total must equal the sum of the line items.");
    if (body.blockDates) state.blocks.push({ id: "blk_" + b.reference, start: b.stay.checkIn, end: b.stay.checkOut, reason: `Booking ${b.reference}`, source: "booking", bookingReference: b.reference });
    if (body.blockCarDates && b.car.requested) state.blocks.push({ id: "blkcar_" + b.reference, start: b.car.pickUp, end: b.car.dropOff, reason: "__car", source: "booking", bookingReference: b.reference });
    b.status = "approved";
    b.decision = { type: "approved", decidedAt: now };
    b.approvalDetails = {
      currency: body.currency, lineItems: body.lineItems, total: body.total,
      paymentInstructions: body.paymentInstructions, addressLine: body.addressLine, mapUrl: body.mapUrl,
      checkInInstructions: body.checkInInstructions, carCollection: body.carCollection,
      hostContact: body.hostContact, note: body.note,
    };
    b.activityLog.push({ at: now, actor: "admin", event: "approved" });
  } else {
    if (!body.explanation || body.explanation.length < 20) return err(res, 422, "validationError", "The explanation must be at least 20 characters.");
    b.status = "rejected";
    b.decision = { type: "rejected", decidedAt: now, explanation: body.explanation };
    b.__internalNote = body.internalNote || "";
    b.activityLog.push({ at: now, actor: "admin", event: "rejected" });
  }
  const response = adminBookingView(b);
  state.idem.set(store, { response });
  return send(res, 200, response);
}

function publicBookingView(b) {
  const base = {
    reference: b.reference, status: b.status, submittedAt: b.submittedAt,
    stay: b.stay,
    car: b.car.requested ? { requested: true, pickUp: b.car.pickUp, dropOff: b.car.dropOff } : { requested: false },
    estimate: b.estimate,
    decision: b.decision,
    acceptedDocuments: b.acceptances.map((a) => ({ type: a.type, version: a.version, acceptedAt: a.acceptedAt, documentUrl: a.documentUrl })),
  };
  if (b.status === "approved") base.approvalDetails = b.approvalDetails;
  return base;
}

function adminListRow(b) {
  return {
    id: b.id, reference: b.reference, guestName: `${b.guest.firstName} ${b.guest.lastName}`,
    guestEmail: b.guest.email, submittedAt: b.submittedAt, checkIn: b.stay.checkIn, checkOut: b.stay.checkOut,
    nights: b.stay.nights, guests: b.stay.adults + (b.stay.children || 0), carRequested: b.car.requested,
    status: b.status, estimatedTotal: b.estimate.estimatedTotal, currency: b.estimate.currency,
  };
}

function adminBookingView(b) {
  const wanted = expandBlocks([{ start: b.stay.checkIn, end: b.stay.checkOut }]);
  const taken = expandBlocks(state.blocks.filter((x) => x.reason !== "__car" && x.bookingReference !== b.reference));
  return {
    id: b.id, reference: b.reference, status: b.status, submittedAt: b.submittedAt,
    guest: b.guest, stay: b.stay, message: b.message,
    car: b.car.requested ? { requested: true, pickUp: b.car.pickUp, dropOff: b.car.dropOff, carDays: b.car.carDays, driver: b.car.driver } : { requested: false },
    estimate: b.estimate,
    availabilityConflicts: wanted.filter((d) => taken.includes(d)).map((date) => ({ date, reason: "manualBlock" })),
    acceptances: b.acceptances,
    decision: b.status === "rejected"
      ? { ...b.decision, internalNote: b.__internalNote }
      : b.decision,
    approvalDetails: b.approvalDetails || undefined,
    activityLog: b.activityLog,
  };
}

function seedBookings() {
  const mk = (over) => {
    const now = new Date(Date.now() - (over.ageHrs || 4) * 3600000).toISOString();
    const nights = daysBetween(over.checkIn, over.checkOut);
    const cur = "USD";
    const lineItems = [
      { code: "accommodation", label: `USD 140 x ${nights} nights`, amount: 140 * nights },
      { code: "cleaningFee", label: "Cleaning fee", amount: 35 },
    ];
    if (over.car) lineItems.push({ code: "carRental", label: `Kia Sorento x ${daysBetween(over.carPickUp, over.carDropOff)} days (USD 45/day, paid on site)`, amount: 45 * daysBetween(over.carPickUp, over.carDropOff) });
    const total = lineItems.reduce((s, li) => s + li.amount, 0);
    const reference = over.reference;
    const b = {
      id: "bkg_" + reference, reference, status: "pending", submittedAt: now,
      __email: over.email, __token: "tok-" + reference,
      guest: { firstName: over.firstName, lastName: over.lastName, email: over.email, phone: over.phone, countryOfResidence: over.country, purposeOfStay: over.purpose },
      message: over.message || "",
      stay: { checkIn: over.checkIn, checkOut: over.checkOut, nights, adults: over.adults || 2, children: 0 },
      car: over.car
        ? { requested: true, pickUp: over.carPickUp, dropOff: over.carDropOff, carDays: daysBetween(over.carPickUp, over.carDropOff), driver: over.driver, driverName: over.driver.fullName }
        : { requested: false },
      estimate: { currency: cur, lineItems, estimatedTotal: total },
      acceptances: [], decision: null,
      activityLog: [{ at: now, actor: "guest", event: "submitted" }],
    };
    const need = ["stayTerms", "houseRules", ...(over.car ? ["vehicleRentalAgreement"] : [])];
    b.acceptances = need.map((t, i) => ({
      id: `acc_${reference}_${i}`, bookingId: b.id, bookingReference: reference, type: t,
      version: t === "vehicleRentalAgreement" ? 4 : (t === "stayTerms" ? 3 : 2),
      bodyHash: t === "vehicleRentalAgreement" ? vehicle.agreement.bodyHash : documents[t].bodyHash,
      acceptedByName: `${over.firstName} ${over.lastName}`, acceptedByEmail: over.email, acceptedAt: now,
      ipAddress: "102.22.10.4", userAgent: "Mozilla/5.0 (seed)", documentUrl: `/api/documents/${t}/${t === "vehicleRentalAgreement" ? 4 : (t === "stayTerms" ? 3 : 2)}`,
    }));
    over.need = need;
    state.acceptances.unshift(...b.acceptances);
    return b;
  };

  state.bookings.push(mk({
    reference: "KK-7F3Q2A", firstName: "Lena", lastName: "Okafor", email: "lena@example.com",
    phone: "+2348012345678", country: "NG", purpose: "remoteWork",
    checkIn: "2026-09-05", checkOut: "2026-09-12", ageHrs: 6,
    message: "Arriving around 19:00 on the 5th. Is early check-in possible?",
    car: true, carPickUp: "2026-09-06", carDropOff: "2026-09-10",
    driver: { fullName: "Lena Okafor", dateOfBirth: "1990-04-12", licenceNumber: "A1234567", licenceCountry: "NG", meetsRequirements: true },
  }));
  state.bookings.push(mk({
    reference: "KK-4M2P1B", firstName: "Tomas", lastName: "Herrera", email: "tomas@example.com",
    phone: "+34600112233", country: "ES", purpose: "leisure",
    checkIn: "2026-09-12", checkOut: "2026-09-18", ageHrs: 26,
    message: "Two of us, first trip to Rwanda. Planning to drive to Musanze.",
    car: false,
  }));
}

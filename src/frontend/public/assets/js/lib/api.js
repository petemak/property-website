// Single API client. Every path is exactly as api-contract.md defines it.
// Base path: /api. One error shape: { error: { code, message } }.

const BASE = "/api";

export class ApiError extends Error {
  constructor(code, message, status, replayed) {
    super(message || code || "Request failed");
    this.name = "ApiError";
    this.code = code || "internalError";
    this.status = status;
    this.replayed = replayed || false;
  }
}

async function request(method, path, { body, headers, query, signal } = {}) {
  let url = BASE + path;
  if (query) {
    const qs = new URLSearchParams(
      Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== "")
    ).toString();
    if (qs) url += "?" + qs;
  }

  const opts = {
    method,
    credentials: "same-origin", // admin session cookie is HttpOnly; SameSite=Lax
    headers: { Accept: "application/json", ...(headers || {}) },
    signal,
  };
  if (body instanceof FormData) {
    opts.body = body; // let the browser set the multipart boundary
  } else if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(url, opts);
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw new ApiError("networkError", "Could not reach the server. Check your connection and try again.", 0);
  }

  const replayed = res.headers.get("Idempotency-Replayed") === "true";
  if (res.status === 204) return { data: null, replayed };

  let payload = null;
  const text = await res.text();
  if (text) { try { payload = JSON.parse(text); } catch { payload = null; } }

  if (!res.ok) {
    const e = payload && payload.error ? payload.error : {};
    throw new ApiError(e.code, e.message, res.status, replayed);
  }
  return { data: payload, replayed };
}

const get = (p, o) => request("GET", p, o).then((r) => r.data);

export const api = {
  // ---- Public ----
  getProperty: () => get("/property"),
  getGallery: () => get("/gallery"),
  getAvailability: (from, to) => get("/availability", { query: { from, to } }),
  postQuote: (payload) => request("POST", "/quote", { body: payload }).then((r) => r.data),
  getVehicle: () => get("/vehicle"),
  createBooking: (payload, idempotencyKey) =>
    request("POST", "/bookings", { body: payload, headers: { "Idempotency-Key": idempotencyKey } }),
  getBooking: (reference, { email, token } = {}) =>
    get(`/bookings/${encodeURIComponent(reference)}`, { query: { email, token } }),
  postContact: (payload) => request("POST", "/contact", { body: payload }).then((r) => r.data),
  getDocument: (type, version = "current") => get(`/documents/${type}/${version}`),

  // ---- Admin: auth ----
  adminLogin: (email, password) => request("POST", "/admin/auth/login", { body: { email, password } }).then((r) => r.data),
  adminLogout: () => request("POST", "/admin/auth/logout").then((r) => r.data),
  adminAcceptInvite: (token, password) => request("POST", "/admin/auth/accept-invite", { body: { token, password } }).then((r) => r.data),
  adminSession: () => get("/admin/auth/session"),

  // ---- Admin: bookings ----
  adminBookings: (query) => get("/admin/bookings", { query }),
  adminBooking: (id) => get(`/admin/bookings/${encodeURIComponent(id)}`),
  adminApprove: (id, payload, idempotencyKey) =>
    request("POST", `/admin/bookings/${encodeURIComponent(id)}/approve`, { body: payload, headers: { "Idempotency-Key": idempotencyKey } }).then((r) => r.data),
  adminReject: (id, payload, idempotencyKey) =>
    request("POST", `/admin/bookings/${encodeURIComponent(id)}/reject`, { body: payload, headers: { "Idempotency-Key": idempotencyKey } }).then((r) => r.data),

  // ---- Admin: availability + pricing ----
  adminBlocks: (from, to) => get("/admin/availability/blocks", { query: { from, to } }),
  adminCreateBlock: (payload) => request("POST", "/admin/availability/blocks", { body: payload }).then((r) => r.data),
  adminDeleteBlock: (id) => request("DELETE", `/admin/availability/blocks/${encodeURIComponent(id)}`).then((r) => r.data),
  adminGetPricing: () => get("/admin/pricing"),
  adminPutPricing: (payload) => request("PUT", "/admin/pricing", { body: payload }).then((r) => r.data),

  // ---- Admin: content ----
  adminGetProperty: () => get("/admin/property"),
  adminPutProperty: (payload) => request("PUT", "/admin/property", { body: payload }).then((r) => r.data),

  // ---- Admin: gallery ----
  adminGallery: () => get("/admin/gallery"),
  adminUploadImage: (formData) => request("POST", "/admin/gallery", { body: formData }).then((r) => r.data),
  adminPatchImage: (id, payload) => request("PATCH", `/admin/gallery/${encodeURIComponent(id)}`, { body: payload }).then((r) => r.data),
  adminDeleteImage: (id) => request("DELETE", `/admin/gallery/${encodeURIComponent(id)}`).then((r) => r.data),
  adminOrderGallery: (orderedIds) => request("PUT", "/admin/gallery/order", { body: { orderedIds } }).then((r) => r.data),
  adminSetLeadImage: (imageId) => request("POST", "/admin/gallery/lead", { body: { imageId } }).then((r) => r.data),

  // ---- Admin: vehicle ----
  adminGetVehicle: () => get("/admin/vehicle"),
  adminPutVehicle: (payload) => request("PUT", "/admin/vehicle", { body: payload }).then((r) => r.data),
  adminAgreementVersions: () => get("/admin/vehicle/agreement/versions"),
  adminPublishAgreement: (payload) => request("POST", "/admin/vehicle/agreement", { body: payload }).then((r) => r.data),

  // ---- Admin: legal docs ----
  adminDocVersions: (type) => get(`/admin/documents/${type}/versions`),
  adminPublishDoc: (type, payload) => request("POST", `/admin/documents/${type}`, { body: payload }).then((r) => r.data),

  // ---- Admin: acceptance audit ----
  adminAcceptances: (query) => get("/admin/agreement-acceptances", { query }),
  adminAcceptance: (id) => get(`/admin/agreement-acceptances/${encodeURIComponent(id)}`),

  // ---- Admin: email templates ----
  adminEmailTemplates: () => get("/admin/email-templates"),
  adminEmailTemplate: (key) => get(`/admin/email-templates/${key}`),
  adminPutEmailTemplate: (key, payload) => request("PUT", `/admin/email-templates/${key}`, { body: payload }).then((r) => r.data),
  adminPreviewEmail: (key, sampleContext) => request("POST", `/admin/email-templates/${key}/preview`, { body: { sampleContext } }).then((r) => r.data),
  adminTestEmail: (key) => request("POST", `/admin/email-templates/${key}/test`).then((r) => r.data),

  // ---- Admin: users + settings (owner) ----
  adminUsers: () => get("/admin/users"),
  adminCreateUser: (payload) => request("POST", "/admin/users", { body: payload }).then((r) => r.data),
  adminPatchUser: (id, payload) => request("PATCH", `/admin/users/${encodeURIComponent(id)}`, { body: payload }).then((r) => r.data),
  adminDeleteUser: (id) => request("DELETE", `/admin/users/${encodeURIComponent(id)}`).then((r) => r.data),
  adminResendInvite: (id) => request("POST", `/admin/users/${encodeURIComponent(id)}/resend-invite`).then((r) => r.data),
  adminGetSettings: () => get("/admin/settings"),
  adminPutSettings: (payload) => request("PUT", "/admin/settings", { body: payload }).then((r) => r.data),
};

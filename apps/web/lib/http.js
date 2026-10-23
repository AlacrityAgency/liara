"use strict";
// Security layer for the console API (WEB_CONTRACT: Security). No CORS headers are ever sent.

const crypto = require("crypto");

const SESSION_COOKIE = "sokan_session";
const MAX_BODY_BYTES = 1024 * 1024;

function sendJson(res, status, data, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(JSON.stringify(data));
}

function sendText(res, status, body, contentType) {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}

function parseCookies(header) {
  const out = {};
  if (typeof header !== "string") return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const name = part.slice(0, idx).trim();
    if (name) out[name] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

// Compare digests so the length of the expected token does not leak through timing.
function tokenMatches(given, expected) {
  if (typeof given !== "string" || typeof expected !== "string" || given.length === 0) return false;
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

/** Returns how the request authenticated: "header" (MCP / scripts), "cookie" (browser) or null. */
function authenticate(req, token) {
  const header = req.headers["x-sokan-token"];
  if (typeof header === "string" && tokenMatches(header, token)) return "header";
  const cookie = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (tokenMatches(cookie, token)) return "cookie";
  return null;
}

/**
 * Checks applied to every POST, in order: Origin, CSRF header for cookie sessions, JSON content type.
 * Returns null when the request may proceed, or {status, code, message_fa}.
 */
function checkPost(req, via) {
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== `http://${req.headers.host}`) {
    return { status: 403, code: "FORBIDDEN_ORIGIN", message_fa: "درخواست از مبدأ غیرمجاز رسیده است." };
  }
  if (via === "cookie" && req.headers["x-sokan-csrf"] !== "1") {
    return { status: 403, code: "CSRF_HEADER_REQUIRED", message_fa: "هدر X-Sokan-CSRF برای درخواست‌های مرورگر لازم است." };
  }
  const contentType = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    return { status: 415, code: "UNSUPPORTED_MEDIA_TYPE", message_fa: "فقط application/json پذیرفته می‌شود." };
  }
  return null;
}

/** Reads the body up to MAX_BODY_BYTES. Resolves {ok:true,text} or {ok:false,status}. */
function readBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    req.on("data", (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        settled = true;
        resolve({ ok: false, status: 413 });
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolve({ ok: true, text: Buffer.concat(chunks).toString("utf8") });
    });
    req.on("error", () => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, status: 400 });
    });
  });
}

/** Empty body means {}. Anything that is not a JSON object is rejected. */
function parseJsonObject(text) {
  if (!text || text.trim() === "") return { ok: true, value: {} };
  try {
    const value = JSON.parse(text);
    if (value === null || typeof value !== "object" || Array.isArray(value)) return { ok: false };
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

module.exports = {
  SESSION_COOKIE,
  MAX_BODY_BYTES,
  sendJson,
  sendText,
  parseCookies,
  tokenMatches,
  authenticate,
  checkPost,
  readBody,
  parseJsonObject,
};

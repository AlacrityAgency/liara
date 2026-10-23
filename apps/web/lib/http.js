"use strict";
// Security layer for the console API (WEB_CONTRACT: Security, EVALUATION R1). No CORS headers are ever sent.
// Two credentials: the console token (browser: cookie, or X-Sokan-Token for scripts and tests; role "user")
// and the agent token (MCP: X-Sokan-Token only; role "agent", read and propose, never approve).

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const SESSION_COOKIE = "sokan_session";
const MAX_BODY_BYTES = 1024 * 1024;
const AGENT_TOKEN_FILE = "agent-token";
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

// Everything the agent role may call. Anything else answers 403 (approvals, confirms, env values, demos, chat...).
const AGENT_ALLOWED = [
  { method: "GET", path: /^\/api\/state$/ },
  { method: "GET", path: /^\/api\/approvals\/[^/]+$/ },
  { method: "POST", path: /^\/api\/tools\/[^/]+$/ },
  { method: "GET", path: /^\/api\/incidents\/current\/fix-brief\.md$/ },
];
const AGENT_FORBIDDEN_MESSAGE =
  "این توکن فقط برای Coding Agent است و نمی‌تواند تأیید یا تغییر کند. تأیید فقط در کنسول مرورگر انجام می‌شود.";

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

/** Returns how the request authenticated: "header" (scripts, MCP) or "cookie" (browser), or null. Role-blind. */
function authenticate(req, token) {
  const header = req.headers["x-sokan-token"];
  if (typeof header === "string" && tokenMatches(header, token)) return "header";
  const cookie = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (tokenMatches(cookie, token)) return "cookie";
  return null;
}

/**
 * Role of the request. X-Sokan-Token with the agent token gives "agent". The console token gives "user" by header
 * or by the browser cookie. The agent token is never accepted in the cookie.
 */
function resolveRole(req, consoleToken, agentToken) {
  const header = req.headers["x-sokan-token"];
  if (typeof header === "string" && header.length > 0) {
    if (agentToken && tokenMatches(header, agentToken)) return { role: "agent", via: "header" };
    if (tokenMatches(header, consoleToken)) return { role: "user", via: "header" };
  }
  const cookie = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (tokenMatches(cookie, consoleToken)) return { role: "user", via: "cookie" };
  return null;
}

function agentMayCall(method, pathname) {
  return AGENT_ALLOWED.some((r) => r.method === method && r.path.test(pathname));
}

/** DNS-rebinding guard: only loopback names, plus the configured bind address when it is a specific host. */
function hostAllowed(req, port, bindHost) {
  const host = req.headers.host;
  if (typeof host !== "string") return false;
  const allowed = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (bindHost && !["0.0.0.0", "::", "127.0.0.1", "localhost", "::1"].includes(bindHost)) {
    allowed.push(`${bindHost.includes(":") ? `[${bindHost}]` : bindHost}:${port}`);
  }
  return allowed.includes(host.toLowerCase());
}

function deny(status, code, message_fa) {
  return { kind: "deny", status, body: { ok: false, error: code, code, message_fa } };
}

/**
 * Gate for every request, before routing. Sets the security headers, checks the Host header, authenticates
 * /api/* and enforces the agent allowlist. Returns {kind:"static"} | {kind:"api", role, via} | {kind:"deny", status, body}.
 */
function gateRequest(req, res, url, cfg) {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (!hostAllowed(req, cfg.port, cfg.bindHost)) {
    return deny(403, "FORBIDDEN_HOST", "نام میزبان درخواست مجاز نیست؛ کنسول را از http://127.0.0.1 یا http://localhost باز کنید.");
  }
  if (!url.pathname.startsWith("/api/")) {
    res.setHeader("Content-Security-Policy", "default-src 'self'");
    return { kind: "static" };
  }
  const who = resolveRole(req, cfg.consoleToken, cfg.agentToken);
  if (!who) {
    return deny(401, "UNAUTHORIZED", "ابتدا لینکی را که در ترمینال چاپ شده باز کنید.");
  }
  if (who.role === "agent" && !agentMayCall(req.method, url.pathname)) {
    return deny(403, "AGENT_FORBIDDEN", AGENT_FORBIDDEN_MESSAGE);
  }
  return { kind: "api", role: who.role, via: who.via };
}

function writeAgentToken(dir, token) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, AGENT_TOKEN_FILE);
  fs.writeFileSync(file, `${token}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600); // the mode of an existing file is not changed by writeFileSync
  return file;
}

/**
 * Creates the agent credential (SOKAN_AGENT_TOKEN, else random), writes it to <stateDir>/agent-token (mode 600)
 * and prints it. Returns {agentToken, gate(req, res, url)}.
 */
function createAccessControl({ host, port, consoleToken, env = process.env, stateDir }) {
  const dir = stateDir || env.SOKAN_STATE_DIR || path.join(REPO_ROOT, ".sokan");
  const agentToken = env.SOKAN_AGENT_TOKEN || crypto.randomBytes(16).toString("hex");
  if (agentToken === consoleToken) {
    throw new Error("SOKAN_AGENT_TOKEN must differ from SOKAN_CONSOLE_TOKEN: the agent credential cannot be the browser credential");
  }
  const file = writeAgentToken(dir, agentToken);
  console.log(`MCP agent token: ${agentToken}`);
  console.log(`[SOKAN_WEB] The agent token is also in ${file} (mode 600). MCP uses it; the console token is for the browser only.`);
  const cfg = { port, bindHost: host, consoleToken, agentToken };
  return {
    agentToken,
    gate: (req, res, url) => gateRequest(req, res, url, cfg),
  };
}

/** Checks applied to every POST, in order: Origin, CSRF header for cookie sessions, JSON content type. */
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
  AGENT_TOKEN_FILE,
  AGENT_ALLOWED,
  sendJson,
  sendText,
  parseCookies,
  tokenMatches,
  authenticate,
  resolveRole,
  agentMayCall,
  hostAllowed,
  gateRequest,
  createAccessControl,
  checkPost,
  readBody,
  parseJsonObject,
};

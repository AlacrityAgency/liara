"use strict";
/**
 * Sokan console server (WHITEPAPER-v1 §9-§11, WEB_CONTRACT). Native Node HTTP, no runtime dependencies.
 * Layers: security (lib/http.js) -> routes (this file) -> core state, tools, executor, evidence (lib/*).
 */

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

const { createCore } = require("./lib/core");
const {
  SESSION_COOKIE, sendJson, sendText, authenticate, checkPost, readBody, parseJsonObject,
} = require("./lib/http");
const { TOOL_SPECS, validateToolArgs } = require("../../build/llm/src/index.js");
const { fixBriefToMarkdown } = require("../../build/diagnostics/src/index.js");
const { handleChat } = require("./lib/chat");
const { makeToolRunner, newTurn, selectPlan } = require("./lib/tools");
const { scheduleApproved } = require("./lib/executor");
const { runScenario } = require("./lib/scenarios");
const simple = require("./lib/simple");

const PUBLIC_DIR = path.join(__dirname, "public");
const ADVANCED_DIR = path.join(PUBLIC_DIR, "advanced");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};
const MAX_SSE_CLIENTS = 50;
const APPROVE_MESSAGES = {
  UNKNOWN_APPROVAL: "درخواست تأیید پیدا نشد.",
  NOT_APPROVED: "این درخواست دیگر در وضعیت قابل تأیید نیست.",
  APPROVAL_EXPIRED: "مهلت تأیید تمام شده است؛ دوباره درخواست بدهید.",
  WRONG_CONFIRMATION: "نام اپ تایپ‌شده با نام تأییدیه یکی نیست.",
};
const ENV_KEY_RE = /^[A-Z][A-Z0-9_]{0,63}$/;

const host = process.env.SOKAN_HOST || "127.0.0.1";
const port = Number(process.env.SOKAN_PORT || process.env.PORT || 4000);
const token = process.env.SOKAN_CONSOLE_TOKEN || crypto.randomBytes(16).toString("hex");
const core = createCore({ token, chaosPort: process.env.CHAOS_PORT });
simple.initSimple(core);

function unauthorized(res) {
  sendJson(res, 401, { error: "UNAUTHORIZED", message_fa: "ابتدا لینکی را که در ترمینال چاپ شده باز کنید." });
}

function serveStatic(req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return sendJson(res, 405, { error: "METHOD_NOT_ALLOWED" });
  }
  if (url.searchParams.get("t") === token) {
    res.writeHead(302, {
      Location: "/",
      "Set-Cookie": `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`,
      "Cache-Control": "no-store",
    });
    return res.end();
  }
  let rel;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    return sendJson(res, 400, { error: "BAD_PATH" });
  }
  // "/" is the Simple page; "/advanced" and "/advanced/*" are the full console (public/advanced).
  const isAdvanced = rel === "/advanced" || rel.startsWith("/advanced/");
  const base = isAdvanced ? ADVANCED_DIR : PUBLIC_DIR;
  if (isAdvanced) rel = rel === "/advanced" ? "/" : rel.slice("/advanced".length);
  if (rel === "/") rel = "/index.html";
  const file = path.normalize(path.join(base, rel));
  if (!file.startsWith(base + path.sep)) return sendJson(res, 404, { error: "NOT_FOUND" });
  let target = file;
  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) target = path.join(base, "index.html");
  if (!fs.existsSync(target)) return sendJson(res, 404, { error: "NOT_FOUND" });
  const type = MIME[path.extname(target)] || "application/octet-stream";
  sendText(res, 200, fs.readFileSync(target), type);
}

function openEvents(req, res) {
  if (core.sseClients.size >= MAX_SSE_CLIENTS) return sendJson(res, 503, { error: "TOO_MANY_CLIENTS" });
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Content-Type-Options": "nosniff",
  });
  res.write(": connected\n\n");
  core.sseClients.add(res);
  const heartbeat = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {
      clearInterval(heartbeat);
    }
  }, 15000);
  req.on("close", () => {
    clearInterval(heartbeat);
    core.sseClients.delete(res);
  });
}

async function postEnvs(body) {
  const list = body.variables;
  if (!Array.isArray(list) || list.length === 0 || list.length > 50) {
    return { status: 400, body: { ok: false, error: "INVALID_VARIABLES", message_fa: "فهرست متغیرها خالی یا نامعتبر است." } };
  }
  for (const item of list) {
    if (!item || typeof item !== "object" || !ENV_KEY_RE.test(String(item.key)) || typeof item.value !== "string" || item.value.length === 0 || item.value.length > 4096) {
      return { status: 400, body: { ok: false, error: "INVALID_VARIABLES", message_fa: "نام متغیر یا مقدار آن نامعتبر است." } };
    }
  }
  for (const item of list) {
    core.pendingEnvs.set(item.key, item.value);
    core.registerSecret(item.value);
  }
  core.emit("state", {});
  // Values are stored for the next approval card and never echoed back.
  return { status: 200, body: { ok: true, keys: list.map((i) => i.key), message_fa: "مقدارها ذخیره شد؛ در کارت تأیید به‌صورت masked نمایش داده می‌شوند." } };
}

async function postApproval(id, action, body, res) {
  if (action === "approve") {
    const typed = typeof body.typed === "string" ? body.typed : undefined;
    const decision = core.approvals.approve(id, typed);
    if (!decision.ok) {
      return sendJson(res, 400, { ok: false, code: decision.code, message_fa: APPROVE_MESSAGES[decision.code] || "تأیید انجام نشد." });
    }
    scheduleApproved(core, id, decision.risk === "L3" ? 10000 : 300);
    core.emit("approval", core.approvals.get(id));
    return sendJson(res, 200, { ok: true, approval: core.approvals.get(id) });
  }
  const ok = action === "reject" ? core.approvals.reject(id) : core.approvals.cancel(id);
  core.emit("approval", core.approvals.get(id));
  return sendJson(res, 200, { ok, approval: core.approvals.get(id) });
}

/** Simple mode routes (SIMPLE_SPEC contract). Same gates as the other POST routes: CSRF, JSON, body size. */
async function simpleRoute(req, res, url, via) {
  if (req.method === "GET") {
    const out = await simple.handleGet(core, url.pathname);
    return sendJson(res, out.status, out.body);
  }
  if (req.method !== "POST") {
    return sendJson(res, 405, { ok: false, error: { code: "METHOD_NOT_ALLOWED", what_fa: "این درخواست پشتیبانی نمی‌شود", why_fa: "", next_fa: "" } });
  }
  const denied = checkPost(req, via);
  if (denied) return sendJson(res, denied.status, { ok: false, error: { code: denied.code, what_fa: denied.message_fa, why_fa: "", next_fa: "" } });
  const raw = await readBody(req);
  if (!raw.ok) {
    res.setHeader("Connection", "close");
    return sendJson(res, raw.status, { ok: false, error: { code: raw.status === 413 ? "BODY_TOO_LARGE" : "BAD_REQUEST", what_fa: raw.status === 413 ? "بدنه‌ی درخواست بیش از ۱ مگابایت است." : "درخواست نامعتبر است.", why_fa: "", next_fa: "" } });
  }
  const parsed = parseJsonObject(raw.text);
  if (!parsed.ok) return sendJson(res, 400, { ok: false, error: { code: "INVALID_JSON", what_fa: "بدنه‌ی درخواست JSON معتبر نیست.", why_fa: "", next_fa: "" } });
  const out = await simple.handlePost(core, url.pathname, parsed.value);
  return sendJson(res, out.status, out.body);
}

async function apiRoute(req, res, url, via) {
  const parts = url.pathname.split("/").filter(Boolean); // ["api", ...]
  const method = req.method;

  if (url.pathname.startsWith("/api/simple/")) return simpleRoute(req, res, url, via);

  if (method === "GET" && url.pathname === "/api/state") return sendJson(res, 200, core.buildState());
  if (method === "GET" && url.pathname === "/api/events") return openEvents(req, res);
  if (method === "GET" && url.pathname === "/api/audit/verify") return sendJson(res, 200, core.audit.verify());
  if (method === "GET" && url.pathname === "/api/incidents/current/fix-brief.md") {
    if (!core.state.fixBrief) return sendText(res, 404, "no current incident", "text/plain; charset=utf-8");
    return sendText(res, 200, core.redact(fixBriefToMarkdown(core.state.fixBrief)), "text/markdown; charset=utf-8");
  }
  if (method === "GET" && parts[1] === "approvals" && parts.length === 3) {
    const approval = core.approvals.get(parts[2]);
    return approval ? sendJson(res, 200, approval) : sendJson(res, 404, { error: "NOT_FOUND" });
  }

  const isPost = method === "POST";
  const isKnownPost = [
    "/api/chat", "/api/plans/select", "/api/envs",
  ].includes(url.pathname) || (parts[1] === "tools" && parts.length === 3)
    || (parts[1] === "approvals" && parts.length === 4) || (parts[1] === "demo" && parts.length === 3);
  if (!isKnownPost) return sendJson(res, 404, { error: "NOT_FOUND" });
  if (!isPost) return sendJson(res, 405, { error: "METHOD_NOT_ALLOWED" });

  const denied = checkPost(req, via);
  if (denied) return sendJson(res, denied.status, { ok: false, error: denied.code, code: denied.code, message_fa: denied.message_fa });
  const raw = await readBody(req);
  if (!raw.ok) {
    res.setHeader("Connection", "close");
    return sendJson(res, raw.status, { ok: false, error: raw.status === 413 ? "BODY_TOO_LARGE" : "BAD_REQUEST", message_fa: raw.status === 413 ? "بدنه‌ی درخواست بیش از ۱ مگابایت است." : "درخواست نامعتبر است." });
  }
  const parsed = parseJsonObject(raw.text);
  if (!parsed.ok) return sendJson(res, 400, { ok: false, error: "INVALID_JSON", message_fa: "بدنه‌ی درخواست JSON معتبر نیست." });
  const body = parsed.value;

  if (url.pathname === "/api/chat") {
    const out = await handleChat(core, body);
    return sendJson(res, out.status, out.body);
  }
  if (url.pathname === "/api/plans/select") {
    if (typeof body.planID !== "string" || body.planID.length === 0) {
      return sendJson(res, 400, { ok: false, error: "INVALID_PLAN", message_fa: "شناسه‌ی پلن لازم است." });
    }
    const out = await selectPlan(core, body.planID);
    return sendJson(res, 200, out);
  }
  if (url.pathname === "/api/envs") {
    const out = await postEnvs(body);
    return sendJson(res, out.status, out.body);
  }
  if (parts[1] === "tools") {
    const name = parts[2];
    const spec = TOOL_SPECS.find((t) => t.name === name);
    if (!spec) return sendJson(res, 404, { status: "error", error: "UNKNOWN_TOOL" });
    const args = body.args === undefined ? {} : body.args;
    if (args === null || typeof args !== "object" || Array.isArray(args)) {
      return sendJson(res, 400, { status: "error", error: "INVALID_ARGUMENTS", missing_or_invalid: "args" });
    }
    const invalid = validateToolArgs(spec, args);
    if (invalid !== null) return sendJson(res, 400, { status: "error", error: "INVALID_ARGUMENTS", missing_or_invalid: invalid });
    const out = await makeToolRunner(core, newTurn())(name, args);
    return sendJson(res, out.status === "error" ? 400 : 200, out);
  }
  if (parts[1] === "approvals") {
    if (!["approve", "reject", "cancel"].includes(parts[3])) return sendJson(res, 404, { error: "NOT_FOUND" });
    return postApproval(parts[2], parts[3], body, res);
  }
  if (parts[1] === "demo") {
    const out = await runScenario(core, parts[2]);
    return sendJson(res, out.status, out.body);
  }
  return sendJson(res, 404, { error: "NOT_FOUND" });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://localhost");
    if (!url.pathname.startsWith("/api/")) return serveStatic(req, res, url);
    const via = authenticate(req, token);
    if (!via) return unauthorized(res);
    return await apiRoute(req, res, url, via);
  } catch (err) {
    if (!res.headersSent) {
      sendJson(res, 500, { ok: false, error: "INTERNAL", message_fa: "خطای داخلی سرور؛ دوباره تلاش کنید." });
    }
    core.addLog(`[SOKAN_WEB] unhandled error: ${err && err.message ? err.message : err}`, "system");
  }
});

let shuttingDown = false;
async function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await core.shutdown();
  } catch {
    // best effort
  }
  for (const client of core.sseClients) {
    try {
      client.end();
    } catch {
      // ignore
    }
  }
  server.close(() => process.exit(code));
  setTimeout(() => process.exit(code), 1500).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("exit", () => core.runtime.killNow());

server.listen(port, host, () => {
  const address = server.address();
  const shownHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  core.baseUrl = `http://${shownHost}:${address.port}`;
  console.log(`Sokan console: ${core.baseUrl}/?t=${token}`);
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    console.warn(`[SOKAN_WEB] WARNING: console is listening on ${host}; anyone who can reach it with the token can approve actions.`);
  }
  if (core.mode() === "simulated") console.log("[SOKAN_WEB] mode=simulated (no LIARA_API_TOKEN): actions run against the local chaos-shop only.");
  if (core.simple && core.liara.isLive && !core.envLiara) console.log("[SOKAN_WEB] Liara token loaded from the saved credentials file.");
  core.start();
});

module.exports = { server, core };

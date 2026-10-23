// Console server end-to-end: security layer, chat -> investigation -> approval -> execution -> verification.
// Starts apps/web/server.js as a child process on random ports with no Liara token (simulated target).
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");

const REPO = path.resolve(__dirname, "..");
const SERVER = path.join(REPO, "apps", "web", "server.js");
const TOKEN = "test";
const DEMO_DB_PASSWORD_URL = "postgres://demo:demo@";

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Sokan console server (WEB_CONTRACT)", () => {
  let child;
  let base;
  let chaosPort;
  let stateDir;
  let exitInfo = null;
  const seenBodies = [];

  async function call(method, urlPath, { headers = {}, body, raw } = {}) {
    const res = await fetch(`${base}${urlPath}`, {
      method,
      headers,
      body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    const text = await res.text();
    seenBodies.push(text);
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, headers: res.headers, text, json };
  }

  const authed = (extra = {}) => ({ "X-Sokan-Token": TOKEN, ...extra });
  const jsonHeaders = (extra = {}) => ({ "Content-Type": "application/json", ...extra });

  async function waitFor(fn, timeoutMs, stepMs = 300) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const value = await fn();
      if (value) return value;
      await sleep(stepMs);
    }
    return null;
  }

  before(async () => {
    const sokanPort = await freePort();
    chaosPort = await freePort();
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "sokan-web-test-"));
    base = `http://127.0.0.1:${sokanPort}`;
    const env = {
      PATH: process.env.PATH || "",
      HOME: process.env.HOME || os.tmpdir(),
      SOKAN_CONSOLE_TOKEN: TOKEN,
      SOKAN_PORT: String(sokanPort),
      CHAOS_PORT: String(chaosPort),
      SOKAN_STATE_DIR: stateDir,
    };
    child = spawn(process.execPath, [SERVER], { cwd: REPO, env, stdio: ["ignore", "pipe", "pipe"] });
    child.on("exit", (code, signal) => {
      exitInfo = { code, signal };
    });
    const ready = await new Promise((resolve, reject) => {
      let out = "";
      const timer = setTimeout(() => reject(new Error(`server did not start: ${out}`)), 15000);
      child.stdout.on("data", (d) => {
        out += d.toString();
        if (out.includes("Sokan console:")) {
          clearTimeout(timer);
          resolve(out);
        }
      });
      child.stderr.on("data", (d) => { out += d.toString(); });
    });
    assert.ok(ready.includes(`http://127.0.0.1:${sokanPort}/?t=${TOKEN}`), "console line printed with token");
    // Wait for the simulated target to answer its health probe.
    const healthy = await waitFor(async () => (await call("GET", "/api/state", { headers: authed() })).json?.probes?.some((p) => p.status === 200), 15000);
    assert.ok(healthy, "simulated target is healthy");
  });

  after(async () => {
    if (child && exitInfo === null) {
      child.kill("SIGTERM");
      await waitFor(() => exitInfo !== null, 8000, 100);
    }
    if (stateDir) fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it("returns 401 without a session token and serves the static page", async () => {
    const state = await call("GET", "/api/state");
    assert.strictEqual(state.status, 401);
    assert.strictEqual(state.json.error, "UNAUTHORIZED");
    const events = await call("GET", "/api/events");
    assert.strictEqual(events.status, 401);
    const index = await call("GET", "/");
    assert.strictEqual(index.status, 200);
    assert.match(index.headers.get("content-type") || "", /text\/html/);
  });

  it("sets the session cookie from the printed link and redirects", async () => {
    const res = await call("GET", `/?t=${TOKEN}`);
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.get("location"), "/");
    const cookie = res.headers.get("set-cookie") || "";
    assert.match(cookie, /sokan_session=test/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
  });

  it("rejects text/plain POSTs with 415 and oversized or invalid JSON", async () => {
    const plain = await call("POST", "/api/chat", { headers: authed({ "Content-Type": "text/plain" }), raw: "سلام" });
    assert.strictEqual(plain.status, 415);
    const big = await call("POST", "/api/chat", { headers: authed(jsonHeaders()), raw: JSON.stringify({ message: "a".repeat(1100000) }) });
    assert.strictEqual(big.status, 413);
    const bad = await call("POST", "/api/chat", { headers: authed(jsonHeaders()), raw: "{not json" });
    assert.strictEqual(bad.status, 400);
  });

  it("requires the CSRF header for cookie sessions and rejects foreign origins", async () => {
    const noCsrf = await call("POST", "/api/demo/scenario-reset", { headers: jsonHeaders({ Cookie: `sokan_session=${TOKEN}` }), body: {} });
    assert.strictEqual(noCsrf.status, 403);
    const withCsrf = await call("POST", "/api/demo/scenario-reset", {
      headers: jsonHeaders({ Cookie: `sokan_session=${TOKEN}`, "X-Sokan-CSRF": "1" }), body: {},
    });
    assert.strictEqual(withCsrf.status, 200);
    const foreign = await call("POST", "/api/chat", { headers: authed(jsonHeaders({ Origin: "http://evil.example" })), body: { message: "سلام" } });
    assert.strictEqual(foreign.status, 403);
  });

  it("serves /api/state to MCP header clients without any CORS header", async () => {
    const res = await call("GET", "/api/state", { headers: authed() });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.mode, "simulated");
    assert.strictEqual(res.json.isEphemeralSecret, true);
    assert.ok(res.json.warning_fa, "ephemeral secret is announced");
    assert.ok(Array.isArray(res.json.logs) && Array.isArray(res.json.probes));
    assert.strictEqual(res.headers.get("access-control-allow-origin"), null);
    const audit = await call("GET", "/api/audit/verify", { headers: authed() });
    assert.deepStrictEqual(audit.json, { ok: true });
  });

  it("chat: an error-500 report after scenario-2 yields a missing-env incident and an approval", async () => {
    const demo = await call("POST", "/api/demo/scenario-2-error500", { headers: authed(jsonHeaders()), body: {} });
    assert.strictEqual(demo.status, 200);
    const chat = await call("POST", "/api/chat", { headers: authed(jsonHeaders()), body: { message: "سایتم ارور ۵۰۰ میده" } });
    assert.strictEqual(chat.status, 200);
    assert.ok(chat.json.incident, "incident returned");
    assert.strictEqual(chat.json.incident.hypotheses[0].id, "hyp_missing_env");
    assert.ok(chat.json.fixBrief, "fix brief returned");
    const card = chat.json.approvals.find((a) => a.tool === "app_update_envs");
    assert.ok(card, "remediation approval created");
    assert.strictEqual(card.status, "pending");
    assert.strictEqual(card.params.variables[0].key, "DATABASE_URL");
    assert.notStrictEqual(card.params.variables[0].value, "postgres://demo:demo@127.0.0.1:5432/shop");
  });

  it("approving the remediation executes it and verification passes within ~15s", async () => {
    const state = await call("GET", "/api/state", { headers: authed() });
    const pending = state.json.approvals.find((a) => a.tool === "app_update_envs" && a.status === "pending");
    assert.ok(pending, "pending remediation in state");
    const started = Date.now();
    const approved = await call("POST", `/api/approvals/${pending.id}/approve`, { headers: authed(jsonHeaders()), body: {} });
    assert.strictEqual(approved.status, 200);
    assert.strictEqual(approved.json.ok, true);
    const done = await waitFor(async () => {
      const s = await call("GET", "/api/state", { headers: authed() });
      return s.json.verification && s.json.verification.passed && s.json.incident.status === "resolved" ? s.json : null;
    }, 15000, 500);
    const elapsed = Date.now() - started;
    assert.ok(done, "verification passed and incident resolved");
    assert.ok(elapsed < 15000, `resolved in ${elapsed} ms`);
    assert.strictEqual(done.verification.passed, true);
    const executed = done.approvals.find((a) => a.id === pending.id);
    assert.strictEqual(executed.status, "executed");
    // The approved value reached the simulated target.
    const items = await fetch(`http://127.0.0.1:${chaosPort}/api/items`);
    assert.strictEqual(items.status, 200);
    const itemsBody = await items.text();
    seenBodies.push(itemsBody);
  });

  it("tamper scenario: a real approval rejects altered parameters with PARAM_MISMATCH", async () => {
    const res = await call("POST", "/api/demo/scenario-tamper-test", { headers: authed(jsonHeaders()), body: {} });
    assert.strictEqual(res.json.security_enforced, true);
    assert.strictEqual(res.json.code, "PARAM_MISMATCH");
  });

  it("injection scenario flags the log line and creates no approval", async () => {
    const before = await call("GET", "/api/state", { headers: authed() });
    const res = await call("POST", "/api/demo/scenario-injection", { headers: authed(jsonHeaders()), body: {} });
    assert.strictEqual(res.json.approvals_created, 0);
    assert.strictEqual(res.json.executed, false);
    assert.strictEqual(res.json.flagged[0].kind, "PROMPT_INJECTION");
    const after = await call("GET", "/api/state", { headers: authed() });
    assert.strictEqual(after.json.approvals.length, before.json.approvals.length);
  });

  it("L3 requests return an approval without exposing the confirmation text", async () => {
    const res = await call("POST", "/api/tools/app_delete", { headers: authed(jsonHeaders()), body: { args: { app: "chaos-shop" }, source: "mcp" } });
    assert.strictEqual(res.json.status, "approval_required");
    const got = await call("GET", `/api/approvals/${res.json.approvalId}`, { headers: authed() });
    assert.strictEqual(got.json.riskLevel, "L3");
    assert.strictEqual(got.json.requiresTypedConfirmation, true);
    await call("POST", `/api/approvals/${res.json.approvalId}/cancel`, { headers: authed(jsonHeaders()), body: {} });
  });

  it("never returns the demo database password or the typed confirmation field", async () => {
    const all = seenBodies.join("\n");
    assert.ok(!all.includes(DEMO_DB_PASSWORD_URL), "demo DB credentials not present in any response");
    assert.ok(!all.includes("confirmationText"), "confirmationText not present in any response");
  });

  it("kills the simulated target when the server stops", async () => {
    assert.strictEqual(await portOpen(chaosPort), true, "target listening before shutdown");
    child.kill("SIGTERM");
    const exited = await waitFor(() => exitInfo !== null, 8000, 100);
    assert.ok(exited, "server exited");
    const gone = await waitFor(async () => !(await portOpen(chaosPort)), 5000, 200);
    assert.ok(gone, "simulated target port is closed");
  });
});

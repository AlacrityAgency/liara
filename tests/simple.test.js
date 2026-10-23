// Simple mode (SIMPLE_SPEC contract) end to end.
// Server A: simulated flow (try -> project -> plans -> deploy -> diagnose -> fix) against the local chaos-shop.
// Server B: live flow against a local Liara stub (SOKAN_LIARA_BASE_URL / SOKAN_LIARA_DNS_URL): connect, deploy,
// domain chain, restart with saved credentials, disconnect. Every child process is killed by PID at the end.
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const REPO = path.resolve(__dirname, "..");
const SERVER = path.join(REPO, "apps", "web", "server.js");
const DEMO_DIR = path.join(REPO, "demo", "chaos-shop");
const TOKEN = "test";
// Fake credentials, assembled at runtime so no secret-looking literal sits in the source.
const LIVE_TOKEN = ["live", "test", "token"].join("-");
const BAD_TOKEN = ["wrong", "test", "token"].join("-");
const DB_URL = ["postgres:/", "/vibe:", "pw", "@db.example.test/shop"].join("");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    socket.setTimeout(500, () => { socket.destroy(); resolve(false); });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
  });
}

async function waitFor(fn, timeoutMs, stepMs = 300) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await sleep(stepMs);
  }
  return null;
}

// Every response body and SSE payload the tests see, checked at the end for leaks.
const seen = [];

function exitOf(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once("exit", () => resolve());
  });
}

/** Starts apps/web/server.js on random ports with an isolated state directory. */
async function startServer(stateDir, extraEnv = {}) {
  const sokanPort = await freePort();
  const chaosPort = await freePort();
  const env = {
    PATH: process.env.PATH || "",
    HOME: process.env.HOME || os.tmpdir(),
    SOKAN_CONSOLE_TOKEN: TOKEN,
    SOKAN_PORT: String(sokanPort),
    CHAOS_PORT: String(chaosPort),
    SOKAN_STATE_DIR: stateDir,
    ...extraEnv,
  };
  const child = spawn(process.execPath, [SERVER], { cwd: REPO, env, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`server did not start: ${out}`)), 15000);
    child.stdout.on("data", (d) => {
      out += d.toString();
      if (out.includes("Sokan console:")) { clearTimeout(timer); resolve(); }
    });
    child.stderr.on("data", (d) => { out += d.toString(); });
    child.once("exit", () => { clearTimeout(timer); reject(new Error(`server exited: ${out}`)); });
  });
  const base = `http://127.0.0.1:${sokanPort}`;
  return {
    child,
    base,
    chaosPort,
    async stop() {
      child.kill("SIGTERM");
      await exitOf(child);
      // The simulated target must not outlive the console.
      const gone = await waitFor(async () => !(await portOpen(chaosPort)), 8000, 200);
      assert.ok(gone, "simulated target process was stopped with the console");
    },
  };
}

async function api(base, method, urlPath, body) {
  const headers = { "X-Sokan-Token": TOKEN };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${base}${urlPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const text = await res.text();
  seen.push(text);
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, text, json };
}

/** Collects SSE events into an array until closed. */
function openEvents(base) {
  const events = [];
  const controller = new AbortController();
  (async () => {
    try {
      const res = await fetch(`${base}/api/events`, { headers: { "X-Sokan-Token": TOKEN }, signal: controller.signal });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          let type = null;
          let data = "";
          for (const line of block.split("\n")) {
            if (line.startsWith("event: ")) type = line.slice(7);
            else if (line.startsWith("data: ")) data += line.slice(6);
          }
          if (type && data) {
            seen.push(data);
            events.push({ type, data: JSON.parse(data) });
          }
        }
      }
    } catch {
      // aborted on close
    }
  })();
  return { events, close: () => controller.abort() };
}

async function waitResult(events, jobId, timeoutMs = 60000) {
  return waitFor(() => events.find((e) => e.type === "simple_result" && e.data.jobId === jobId) || null, timeoutMs, 200);
}

// ---------- Liara stub (account, apps, releases, DNS) ----------

function startStub() {
  const calls = [];
  const projects = new Map();
  const zones = new Map();
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString("utf8");
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
    const url = new URL(req.url, "http://stub");
    const p = url.pathname;
    calls.push({ method: req.method, path: p, body, auth: req.headers.authorization || null });
    const send = (status, obj) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    if (req.method === "GET" && p.startsWith("/site/")) {
      res.writeHead(200, { "Content-Type": "text/plain" });
      return res.end("ok");
    }
    if (p.startsWith("/api/")) {
      // DNS service (no bearer check in the stub).
      const zoneMatch = p.match(/^\/api\/v1\/zones\/([^/]+)(\/.*)?$/);
      if (req.method === "POST" && p === "/api/v1/zones") {
        const zone = { name: body.name, status: "PENDING", nameServers: ["ns1.liara.ir", "ns2.liara.ir"] };
        zones.set(zone.name, zone);
        return send(201, { status: "success", data: zone });
      }
      if (zoneMatch && !zoneMatch[2]) {
        const zone = zones.get(decodeURIComponent(zoneMatch[1]));
        return zone ? send(200, { status: "success", data: zone }) : send(404, { message: "zone not found" });
      }
      if (zoneMatch && zoneMatch[2] === "/check" && req.method === "PUT") {
        const zone = zones.get(decodeURIComponent(zoneMatch[1]));
        if (zone) zone.status = "ACTIVE";
        return send(200, { status: "success", data: "ok" });
      }
      if (zoneMatch && zoneMatch[2] === "/dns-records" && req.method === "POST") {
        return send(201, { status: "success", data: { id: "rec_1", ...body } });
      }
      return send(404, { message: "not found" });
    }
    if (req.headers.authorization !== `Bearer ${LIVE_TOKEN}`) return send(401, { message: "Unauthorized" });
    if (req.method === "GET" && p === "/v1/me") {
      return send(200, {
        user: { _id: "u1", fullname: "Vibe Coder", email: "vibe@example.test" },
        plans: {
          projects: {
            free: { price: 0, available: true, region: "iran", RAM: { amount: 0.5 }, CPU: { amount: 0.5 }, volume: 1 },
            "g2-small": { price: 100, available: true, region: "iran", RAM: { amount: 0.5 }, CPU: { amount: 0.5 }, volume: 10 },
            "g2-medium": { price: 220, available: true, region: "iran", RAM: { amount: 1 }, CPU: { amount: 1 }, volume: 20 },
            "g2-pro": { price: 440, available: true, region: "iran", RAM: { amount: 2 }, CPU: { amount: 2 }, volume: 40 },
          },
          projectBundlePlans: {
            free: { free: { available: true, displayPrice: 0 } },
            "g2-small": { standard: { available: true, displayPrice: 30000 } },
            "g2-medium": { standard: { available: true, displayPrice: 50000 }, plus: { available: true, displayPrice: 120000 } },
            "g2-pro": { standard: { available: true, displayPrice: 90000 } },
          },
        },
      });
    }
    if (req.method === "GET" && p === "/v1/billing") return send(200, { user: { balance: 10000000, minCreditAmount: 0 } });
    const appMatch = p.match(/^\/v[12]\/projects\/([^/]+)(\/.*)?$/);
    if (appMatch && req.method === "GET" && !appMatch[2]) {
      const name = decodeURIComponent(appMatch[1]);
      const proj = projects.get(name);
      return proj ? send(200, { project: proj }) : send(404, { message: "project not found" });
    }
    if (appMatch && req.method === "GET" && appMatch[2] === "/applets") return send(404, { message: "no applets in stub" });
    if (req.method === "POST" && p === "/v1/projects") {
      projects.set(body.name, {
        _id: `id_${body.name}`, project_id: body.name, type: body.platform, status: "running", scale: 1,
        planID: body.planID, port: 3100, envs: [], isDeployed: true,
      });
      return send(201, {});
    }
    if (req.method === "POST" && p === "/v1/projects/update-envs") return send(200, {});
    if (req.method === "POST" && p === "/v1/domains") return send(201, { domain: { name: body.name } });
    if (req.method === "POST" && p === "/v1/domains/provision-ssl-certs") return send(200, {});
    if (appMatch && req.method === "POST" && appMatch[2] === "/sources") return send(200, { sourceID: "src_1" });
    if (appMatch && req.method === "POST" && appMatch[2] === "/releases") return send(200, { releaseID: "rel_1" });
    const buildMatch = p.match(/^\/v2\/releases\/([^/]+)\/build-logs$/);
    if (buildMatch) return send(200, { release: { _id: buildMatch[1], state: "READY" }, buildOutput: [] });
    return send(404, { message: "stub: unhandled" });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        base: `http://127.0.0.1:${port}`,
        calls,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

// ---------- unit-level checks ----------

describe("Simple mode helpers", () => {
  it("sanitizes app names to Liara rules", () => {
    const { sanitizeAppName } = require("../apps/web/lib/simple.js");
    assert.strictEqual(sanitizeAppName("chaos-shop"), "chaos-shop");
    assert.strictEqual(sanitizeAppName("@scope/My Site!"), "my-site");
    assert.strictEqual(sanitizeAppName("2fast"), "fast");
    assert.strictEqual(sanitizeAppName("a"), "a-site");
    const long = sanitizeAppName("x".repeat(60));
    assert.ok(long.length <= 32 && /^[a-z][a-z0-9-]*[a-z0-9]$/.test(long), long);
  });

  it("normalizes domains and refuses junk", () => {
    const { normalizeDomain } = require("../apps/web/lib/simple.js");
    assert.strictEqual(normalizeDomain("https://Example.IR/path"), "example.ir");
    assert.strictEqual(normalizeDomain("not a domain"), null);
    assert.strictEqual(normalizeDomain(""), null);
  });

  it("packSource never uploads .sokan/ (local state and credentials)", async () => {
    const { packSource } = require("../build/liara-client/src/index.js");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sokan-pack-"));
    try {
      fs.mkdirSync(path.join(dir, ".sokan"));
      fs.writeFileSync(path.join(dir, ".sokan", "credentials.json"), "{}");
      fs.writeFileSync(path.join(dir, "package.json"), "{}");
      const archive = await packSource(dir);
      try {
        assert.deepStrictEqual(archive.files, ["package.json"]);
      } finally {
        fs.rmSync(archive.path, { force: true });
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------- simulated flow ----------

describe("Simple API, simulated (try) flow", () => {
  let server;
  let stateDir;
  let events;

  before(async () => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "sokan-simple-a-"));
    server = await startServer(stateDir);
    events = openEvents(server.base);
  });

  after(async () => {
    events.close();
    if (server) await server.stop();
    if (stateDir) fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it("requires the session token on every simple route", async () => {
    const res = await fetch(`${server.base}/api/simple/session`);
    assert.strictEqual(res.status, 401);
  });

  it("starts disconnected and switches to the simulated demo with /try", async () => {
    const before = await api(server.base, "GET", "/api/simple/session");
    assert.strictEqual(before.json.connected, false);
    assert.strictEqual(before.json.mode, null);
    const tried = await api(server.base, "POST", "/api/simple/try", {});
    assert.strictEqual(tried.json.ok, true);
    assert.strictEqual(tried.json.mode, "simulated");
  });

  it("analyzes the demo project, hides chaos flags and never returns env values", async () => {
    const res = await api(server.base, "POST", "/api/simple/project", { dir: DEMO_DIR });
    assert.strictEqual(res.status, 200);
    const project = res.json.project;
    assert.strictEqual(project.appName, "chaos-shop");
    assert.strictEqual(project.platform, "node");
    assert.ok(project.summary_fa.includes("Node.js"));
    const keys = project.envs.map((e) => e.key);
    assert.ok(keys.includes("DATABASE_URL"));
    assert.ok(!keys.some((k) => k.startsWith("CHAOS_")), "chaos flags are not asked for");
    assert.ok(!res.text.includes("postgres://demo"), "no env value in the response");
  });

  it("refuses folders outside the home and working-directory tree", async () => {
    const res = await api(server.base, "POST", "/api/simple/project", { dir: "/etc" });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.json.error.code, "PROJECT_OUTSIDE_ALLOWED");
    assert.strictEqual(res.json.ok, false);
  });

  it("lists three plans with simulated estimates and a recommended one", async () => {
    const res = await api(server.base, "GET", "/api/simple/plans");
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.plans.length, 3);
    assert.ok(res.json.plans.every((p) => p.priceSource === "estimate"));
    const rec = res.json.plans.find((p) => p.recommended);
    assert.strictEqual(rec.planID, "g2-medium");
    assert.strictEqual(rec.monthlyTomans, 220 * 720);
  });

  it("prepares a deploy card, masks its values in state, and deploys the simulated site", async () => {
    const prep = await api(server.base, "POST", "/api/simple/deploy/prepare", { planID: "recommended" });
    assert.strictEqual(prep.status, 200, prep.text);
    const confirm = prep.json.confirm;
    assert.strictEqual(confirm.risk, "L2");
    assert.ok(confirm.cost_fa.includes("تومان در ماه"), confirm.cost_fa);
    assert.ok(confirm.bullets_fa.length >= 3);
    const state = await api(server.base, "GET", "/api/state");
    const card = state.json.approvals.find((a) => a.id === confirm.approvalId);
    assert.ok(card, "approval visible to the console");
    assert.ok(!JSON.stringify(card.params).includes("postgres://demo:demo@"), "approved DB value is masked");

    const done = await api(server.base, "POST", `/api/simple/confirm/${confirm.approvalId}`, {});
    assert.strictEqual(done.json.ok, true);
    const result = await waitResult(events.events, done.json.jobId);
    assert.ok(result, "simple_result arrived");
    assert.strictEqual(result.data.ok, true, result.data.message_fa);
    assert.strictEqual(result.data.url, `http://127.0.0.1:${server.chaosPort}`);
    const progress = events.events.filter((e) => e.type === "simple_progress" && e.data.jobId === done.json.jobId);
    assert.ok(progress.some((e) => e.data.step === "pack") && progress.some((e) => e.data.step === "done"));

    const session = await waitFor(async () => {
      const s = await api(server.base, "GET", "/api/simple/session");
      return s.json.site && s.json.site.status === "up" ? s.json : null;
    }, 20000, 500);
    assert.ok(session, "site reported up");
    assert.strictEqual(session.site.appName, "chaos-shop");
    assert.ok(fs.existsSync(path.join(stateDir, "site.json")), "site remembered on disk");
  });

  it("diagnoses the scenario-2 error, confirms the fix and verifies it", async () => {
    const demo = await api(server.base, "POST", "/api/demo/scenario-2-error500", {});
    assert.strictEqual(demo.status, 200);
    const dx = await api(server.base, "POST", "/api/simple/diagnose", { symptom_fa: "سایتم خطای ۵۰۰ میده" });
    assert.strictEqual(dx.json.ok, true);
    assert.strictEqual(dx.json.found, true, dx.text);
    assert.ok(dx.json.problem_fa && dx.json.solution_fa);
    assert.ok(dx.json.confirm, "a one-tap fix card");
    const done = await api(server.base, "POST", `/api/simple/confirm/${dx.json.confirm.approvalId}`, {});
    const result = await waitResult(events.events, done.json.jobId);
    assert.ok(result, "fix result arrived");
    assert.strictEqual(result.data.ok, true, result.data.message_fa);
    assert.ok(result.data.message_fa.startsWith("درست شد ✅"), result.data.message_fa);
    assert.strictEqual(result.data.verification.passed, true);
  });

  it("returns the domain guide for .ir with five steps, and no card in simulation", async () => {
    const res = await api(server.base, "POST", "/api/simple/domain", { domain: "example.ir" });
    assert.strictEqual(res.json.isIr, true);
    assert.strictEqual(res.json.steps.length, 5);
    assert.strictEqual(res.json.confirm, undefined);
    const bad = await api(server.base, "POST", "/api/simple/domain", { domain: "not a domain" });
    assert.strictEqual(bad.status, 400);
    assert.strictEqual(bad.json.error.code, "INVALID_DOMAIN");
  });

  it("serves the simple page at / and the console at /advanced", async () => {
    const root = await fetch(`${server.base}/`);
    assert.strictEqual(root.status, 200);
    assert.match(root.headers.get("content-type") || "", /text\/html/);
    const advancedIndex = path.join(REPO, "apps", "web", "public", "advanced", "index.html");
    const adv = await fetch(`${server.base}/advanced`);
    if (fs.existsSync(advancedIndex)) {
      assert.strictEqual(adv.status, 200);
      assert.match(adv.headers.get("content-type") || "", /text\/html/);
    } else {
      assert.strictEqual(adv.status, 404);
    }
  });

  it("rejects POST without a JSON content type and keeps simple errors in the contract shape", async () => {
    const res = await fetch(`${server.base}/api/simple/try`, { method: "POST", headers: { "X-Sokan-Token": TOKEN }, body: "{}" });
    assert.strictEqual(res.status, 415);
    const cancel = await api(server.base, "POST", "/api/simple/cancel/apr_missing", {});
    assert.strictEqual(cancel.status, 409);
    assert.strictEqual(cancel.json.ok, false);
    assert.strictEqual(cancel.json.error.code, "NOT_CANCELLABLE");
  });
});

// ---------- live flow against the Liara stub ----------

describe("Simple API, live flow against a Liara stub", () => {
  let stub;
  let server;
  let stateDir;
  let events;

  before(async () => {
    stub = await startStub();
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "sokan-simple-b-"));
    server = await startServer(stateDir, {
      SOKAN_LIARA_BASE_URL: stub.base,
      SOKAN_LIARA_DNS_URL: stub.base,
      SOKAN_LIARA_APP_URL: `${stub.base}/site/{name}`,
    });
    events = openEvents(server.base);
  });

  after(async () => {
    events.close();
    if (server) await server.stop();
    if (stub) await stub.close();
    if (stateDir) fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it("rejects a bad token with 401 and never echoes it", async () => {
    const res = await api(server.base, "POST", "/api/simple/connect", { token: BAD_TOKEN });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.json.ok, false);
    assert.strictEqual(res.json.error.code, "UNAUTHORIZED");
    assert.ok(!res.text.includes(BAD_TOKEN));
  });

  it("connects with a valid token, saves it mode 600 and reports the account", async () => {
    const res = await api(server.base, "POST", "/api/simple/connect", { token: LIVE_TOKEN, remember: true });
    assert.strictEqual(res.status, 200, res.text);
    assert.strictEqual(res.json.ok, true);
    assert.strictEqual(res.json.account.name, "Vibe Coder");
    assert.ok(!res.text.includes(LIVE_TOKEN), "token never echoed");
    const file = path.join(stateDir, "credentials.json");
    assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
    assert.strictEqual(fs.statSync(stateDir).mode & 0o777, 0o700);
    const session = await api(server.base, "GET", "/api/simple/session");
    assert.strictEqual(session.json.connected, true);
    assert.strictEqual(session.json.mode, "live");
    assert.strictEqual(session.json.account.balanceTomans, 10000000);
  });

  it("reads real plans with bundles and the balance", async () => {
    await api(server.base, "POST", "/api/simple/project", { dir: DEMO_DIR });
    const res = await api(server.base, "GET", "/api/simple/plans");
    assert.strictEqual(res.status, 200, res.text);
    const rec = res.json.plans.find((p) => p.recommended);
    assert.strictEqual(rec.planID, "g2-medium");
    assert.strictEqual(rec.bundlePlanID, "standard", "cheapest valid bundle is picked automatically");
    assert.strictEqual(rec.monthlyTomans, 220 * 720 + 50000);
    assert.strictEqual(rec.priceSource, "liara");
    assert.strictEqual(res.json.shortfallTomans, 0);
  });

  it("deploys live: createApp on 404 with bundle, envs in the release body, real URL", async () => {
    const envRes = await api(server.base, "POST", "/api/simple/envs", { variables: [{ key: "DATABASE_URL", value: DB_URL }] });
    assert.strictEqual(envRes.json.ok, true);
    assert.ok(!envRes.text.includes(DB_URL), "env values are not echoed");
    const prep = await api(server.base, "POST", "/api/simple/deploy/prepare", { planID: "recommended" });
    assert.strictEqual(prep.status, 200, prep.text);
    assert.ok(prep.json.confirm.cost_fa.includes("تومان در ماه"));
    const before = stub.calls.length;
    const done = await api(server.base, "POST", `/api/simple/confirm/${prep.json.confirm.approvalId}`, {});
    const result = await waitResult(events.events, done.json.jobId);
    assert.ok(result, "live deploy result arrived");
    assert.strictEqual(result.data.ok, true, result.data.message_fa);
    assert.strictEqual(result.data.url, `${stub.base}/site/chaos-shop`);

    const calls = stub.calls.slice(before);
    const getIdx = calls.findIndex((c) => c.method === "GET" && c.path === "/v1/projects/chaos-shop");
    const createIdx = calls.findIndex((c) => c.method === "POST" && c.path === "/v1/projects");
    assert.ok(getIdx >= 0 && createIdx > getIdx, "existence checked before creating");
    const createBody = calls[createIdx].body;
    assert.strictEqual(createBody.name, "chaos-shop");
    assert.strictEqual(createBody.planID, "g2-medium");
    assert.strictEqual(createBody.bundlePlanID, "standard");
    const updEnv = calls.find((c) => c.path === "/v1/projects/update-envs");
    assert.strictEqual(updEnv.body.project, "chaos-shop");
    assert.deepStrictEqual(updEnv.body.variables, [{ key: "DATABASE_URL", value: DB_URL }]);
    const release = calls.find((c) => c.method === "POST" && c.path === "/v2/projects/chaos-shop/releases");
    assert.ok(release, "release created for the approved project");
    assert.strictEqual(release.body.envs.DATABASE_URL, DB_URL, "envs travel in the release body");
    assert.ok(calls.every((c) => !c.path.startsWith("/v1/projects/") || c.path.startsWith("/v1/projects/chaos-shop") || c.path === "/v1/projects" || c.path === "/v1/projects/update-envs"));
    assert.ok(calls.filter((c) => c.path.startsWith("/v1/")).every((c) => c.auth === `Bearer ${LIVE_TOKEN}`));

    const session = await waitFor(async () => {
      const s = await api(server.base, "GET", "/api/simple/session");
      return s.json.site && s.json.site.status === "up" ? s.json : null;
    }, 20000, 500);
    assert.ok(session, "live site reported up");
    assert.strictEqual(session.site.url, `${stub.base}/site/chaos-shop`);
  });

  it("walks the domain chain: zone and NS, check, then record and SSL", async () => {
    const guide = await api(server.base, "POST", "/api/simple/domain", { domain: "example.ir" });
    assert.strictEqual(guide.json.isIr, true);
    assert.ok(guide.json.confirm, "zone creation waits for a confirmation");
    const zoneDone = await api(server.base, "POST", `/api/simple/confirm/${guide.json.confirm.approvalId}`, {});
    const zoneResult = await waitResult(events.events, zoneDone.json.jobId);
    assert.strictEqual(zoneResult.data.ok, true, zoneResult.data.message_fa);
    assert.deepStrictEqual(zoneResult.data.nameservers, ["ns1.liara.ir", "ns2.liara.ir"]);

    const check = await api(server.base, "POST", "/api/simple/domain/check", { domain: "example.ir" });
    assert.strictEqual(check.json.propagated, true);
    assert.ok(check.json.confirm, "record step waits for a confirmation");
    const recDone = await api(server.base, "POST", `/api/simple/confirm/${check.json.confirm.approvalId}`, {});
    const recResult = await waitResult(events.events, recDone.json.jobId);
    assert.strictEqual(recResult.data.ok, true, recResult.data.message_fa);
    assert.strictEqual(recResult.data.url, "https://example.ir");
    const recordCall = stub.calls.find((c) => c.method === "POST" && c.path === "/api/v1/zones/example.ir/dns-records");
    assert.deepStrictEqual(recordCall.body.contents, [{ domain: "chaos-shop.liara.run" }]);
    const sslCall = stub.calls.find((c) => c.path === "/v1/domains/provision-ssl-certs");
    assert.strictEqual(sslCall.body.domain, "example.ir");
  });

  it("restarts with the saved credentials and keeps the site", async () => {
    const oldChaos = server.chaosPort;
    server.child.kill("SIGTERM");
    await exitOf(server.child);
    events.close();
    assert.ok(await waitFor(async () => !(await portOpen(oldChaos)), 8000, 200), "old simulated target stopped");
    server = await startServer(stateDir, {
      SOKAN_LIARA_BASE_URL: stub.base,
      SOKAN_LIARA_DNS_URL: stub.base,
      SOKAN_LIARA_APP_URL: `${stub.base}/site/{name}`,
    });
    events = openEvents(server.base);
    const session = await api(server.base, "GET", "/api/simple/session");
    assert.strictEqual(session.json.connected, true, "saved token loaded on startup");
    assert.strictEqual(session.json.site.appName, "chaos-shop");
  });

  it("disconnect wipes the saved credentials and drops back to disconnected", async () => {
    const res = await api(server.base, "POST", "/api/simple/disconnect", {});
    assert.strictEqual(res.json.ok, true);
    assert.ok(!fs.existsSync(path.join(stateDir, "credentials.json")), "credentials file removed");
    const session = await api(server.base, "GET", "/api/simple/session");
    assert.strictEqual(session.json.connected, false);
  });

  it("never returns the token in any response or event", () => {
    assert.ok(seen.length > 0);
    assert.ok(seen.every((text) => !text.includes(LIVE_TOKEN)), "token found in a response or event");
  });
});

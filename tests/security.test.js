// Console security (EVALUATION R1, R3): agent vs console roles, host guard, headers, and the MCP bin end to end.
// Starts apps/web/server.js as a child process on random ports (simulated target, no Liara token).
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const { spawn } = require("node:child_process");

const REPO = path.resolve(__dirname, "..");
const SERVER = path.join(REPO, "apps", "web", "server.js");
const BIN = path.join(REPO, "build", "mcp", "src", "bin.js");
const CONSOLE = "console-test-token-0001";
const AGENT = "agent-test-token-0002";

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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Raw request, so the test can set the Host header itself. */
function raw(port, { method = "GET", urlPath = "/", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: urlPath, headers }, (res) => {
      let text = "";
      res.on("data", (c) => (text += c));
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(text); } catch { json = null; }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on("error", reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

describe("Console roles and headers (EVALUATION R1)", () => {
  let child;
  let port;
  let stateDir;
  let stdout = "";
  let exited = false;

  before(async () => {
    port = await freePort();
    const chaosPort = await freePort();
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "sokan-security-"));
    child = spawn(process.execPath, [SERVER], {
      cwd: REPO,
      env: {
        PATH: process.env.PATH || "",
        HOME: process.env.HOME || os.tmpdir(),
        SOKAN_CONSOLE_TOKEN: CONSOLE,
        SOKAN_AGENT_TOKEN: AGENT,
        SOKAN_PORT: String(port),
        CHAOS_PORT: String(chaosPort),
        SOKAN_STATE_DIR: stateDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.on("exit", () => { exited = true; });
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", () => {});
    for (let i = 0; i < 100 && !stdout.includes("Sokan console:"); i++) await sleep(150);
    assert.ok(stdout.includes("Sokan console:"), "console started");
  });

  after(async () => {
    if (child && !exited) {
      child.kill("SIGTERM");
      for (let i = 0; i < 50 && !exited; i++) await sleep(100);
    }
    if (stateDir) fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it("prints the agent token separately and writes it to agent-token with mode 600", () => {
    assert.ok(stdout.includes(`MCP agent token: ${AGENT}`));
    const file = path.join(stateDir, "agent-token");
    assert.strictEqual(fs.readFileSync(file, "utf8").trim(), AGENT);
    assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
  });

  it("rejects a Host header that is not loopback (DNS rebinding)", async () => {
    const res = await raw(port, { headers: { Host: "evil.example" } });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.json.code, "FORBIDDEN_HOST");
  });

  it("sends X-Frame-Options, Referrer-Policy and a default-src CSP on the page", async () => {
    const res = await raw(port, { urlPath: "/", headers: { Host: `127.0.0.1:${port}` } });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers["x-frame-options"], "DENY");
    assert.strictEqual(res.headers["referrer-policy"], "no-referrer");
    assert.strictEqual(res.headers["content-security-policy"], "default-src 'self'");
  });

  it("answers 401 without a token, and accepts the console token and the agent token in the header", async () => {
    const host = `127.0.0.1:${port}`;
    assert.strictEqual((await raw(port, { urlPath: "/api/state", headers: { Host: host } })).status, 401);
    assert.strictEqual((await raw(port, { urlPath: "/api/state", headers: { Host: host, "X-Sokan-Token": CONSOLE } })).status, 200);
    assert.strictEqual((await raw(port, { urlPath: "/api/state", headers: { Host: host, "X-Sokan-Token": AGENT } })).status, 200);
  });

  it("the agent token is not a browser credential: it does not work in the session cookie", async () => {
    const res = await raw(port, { urlPath: "/api/state", headers: { Host: `127.0.0.1:${port}`, Cookie: `sokan_session=${AGENT}` } });
    assert.strictEqual(res.status, 401);
  });

  it("the agent role is 403 on approve, reject, cancel, confirm, connect, envs, demo and other routes", async () => {
    const host = `127.0.0.1:${port}`;
    const agentPost = (urlPath) => raw(port, {
      method: "POST", urlPath,
      headers: { Host: host, "X-Sokan-Token": AGENT, "Content-Type": "application/json" },
      body: {},
    });
    const blocked = [
      "/api/approvals/apr_1/approve", "/api/approvals/apr_1/reject", "/api/approvals/apr_1/cancel",
      "/api/simple/confirm/apr_1", "/api/simple/connect", "/api/simple/disconnect",
      "/api/envs", "/api/simple/envs", "/api/demo/scenario-reset", "/api/chat",
    ];
    for (const urlPath of blocked) {
      const res = await agentPost(urlPath);
      assert.strictEqual(res.status, 403, `${urlPath} -> ${res.status}`);
      assert.strictEqual(res.json.code, "AGENT_FORBIDDEN");
    }
    const audit = await raw(port, { urlPath: "/api/audit/verify", headers: { Host: host, "X-Sokan-Token": AGENT } });
    assert.strictEqual(audit.status, 403);
  });
});

describe("MCP bin against a live console (EVALUATION R3)", () => {
  let child;
  let port;
  let stateDir;
  let exited = false;

  before(async () => {
    port = await freePort();
    const chaosPort = await freePort();
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "sokan-security-mcp-"));
    child = spawn(process.execPath, [SERVER], {
      cwd: REPO,
      env: {
        PATH: process.env.PATH || "", HOME: process.env.HOME || os.tmpdir(),
        SOKAN_CONSOLE_TOKEN: CONSOLE, SOKAN_AGENT_TOKEN: AGENT,
        SOKAN_PORT: String(port), CHAOS_PORT: String(chaosPort), SOKAN_STATE_DIR: stateDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.on("exit", () => { exited = true; });
    let out = "";
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.stderr.on("data", () => {});
    for (let i = 0; i < 100 && !out.includes("Sokan console:"); i++) await sleep(150);
    assert.ok(out.includes("Sokan console:"), "console started");
  });

  after(async () => {
    if (child && !exited) {
      child.kill("SIGTERM");
      for (let i = 0; i < 50 && !exited; i++) await sleep(100);
    }
    if (stateDir) fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it("incident_get_fix_brief returns markdown, app_restart returns approval_required, and agent approve is 403", async () => {
    const host = `127.0.0.1:${port}`;
    // A diagnosis must exist first; the console user runs it (role user, console token).
    const inv = await raw(port, {
      method: "POST", urlPath: "/api/tools/sre_investigate",
      headers: { Host: host, "X-Sokan-Token": CONSOLE, "Content-Type": "application/json" },
      body: { args: { symptom_fa: "سایت خطا می‌دهد" } },
    });
    assert.strictEqual(inv.status, 200, inv.text);

    const proc = spawn(process.execPath, [BIN], {
      env: { PATH: process.env.PATH, SOKAN_AGENT_TOKEN: AGENT, SOKAN_CONSOLE_URL: `http://127.0.0.1:${port}` },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const lines = readline.createInterface({ input: proc.stdout })[Symbol.asyncIterator]();
    let id = 0;
    const rpc = async (method, params) => {
      id++;
      proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      const { value } = await lines.next();
      return JSON.parse(value);
    };
    const callTool = async (name, args) => {
      const res = await rpc("tools/call", { name, arguments: args });
      return { isError: res.result.isError, data: res.result.isError ? res.result.content[0].text : JSON.parse(res.result.content[0].text) };
    };
    try {
      await rpc("initialize", { protocolVersion: "2025-06-18" });
      proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);

      const brief = await callTool("incident_get_fix_brief", {});
      assert.strictEqual(brief.isError, false, String(brief.data));
      // L0 results keep the console envelope: {status, data: {incidentId, markdown}}.
      assert.strictEqual(brief.data.status, "ok");
      assert.ok(typeof brief.data.data.markdown === "string" && brief.data.data.markdown.startsWith("# Fix Brief"));
      assert.ok(brief.data.data.incidentId);

      const restart = await callTool("app_restart", { app: "chaos-shop" });
      assert.strictEqual(restart.data.status, "approval_required");
      const approvalId = restart.data.approvalId;
      assert.ok(approvalId);

      const approve = await raw(port, {
        method: "POST", urlPath: `/api/approvals/${approvalId}/approve`,
        headers: { Host: host, "X-Sokan-Token": AGENT, "Content-Type": "application/json" },
        body: {},
      });
      assert.strictEqual(approve.status, 403, "the agent cannot approve");

      const status = await callTool("approval_status", { approvalId });
      assert.strictEqual(status.data.id, approvalId);
      assert.notStrictEqual(status.data.status, "executed", "still not executed after the refused approve");
    } finally {
      proc.stdin.end();
      proc.kill();
    }
  });
});

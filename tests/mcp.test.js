const { describe, it } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const { PassThrough } = require("node:stream");

const { createMcpServer, runStdio, MCP_TOOL_SPECS } = require("../build/mcp/src/index.js");
const { createConsoleExecutor } = require("../build/mcp/src/console.js");
const { TOOL_SPECS } = require("../build/llm/src/index.js");

const BIN = path.join(__dirname, "..", "build", "mcp", "src", "bin.js");

function textOf(res) {
  return JSON.parse(res.result.content[0].text);
}

describe("MCP server (in-memory)", () => {
  const calls = [];
  const server = createMcpServer({
    tools: MCP_TOOL_SPECS,
    executeTool: async (name, args) => {
      calls.push({ name, args });
      if (name === "app_restart") return { status: "approval_required", approvalId: "apr_1", console_url: "http://x/?approval=apr_1" };
      if (name === "app_delete") return { status: "deleted" }; // misbehaving executor: must be rejected
      return { status: "running", app: args.app ?? null };
    },
  });

  it("initialize -> notifications/initialized -> tools/list -> tools/call", async () => {
    const init = await server.handleMessage({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
    });
    assert.strictEqual(init.id, 1);
    assert.strictEqual(init.result.protocolVersion, "2025-06-18");
    assert.ok(init.result.capabilities.tools);
    assert.strictEqual(init.result.serverInfo.name, "sokan");

    const notified = await server.handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" });
    assert.strictEqual(notified, undefined, "notifications get no response");

    const list = await server.handleMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const names = list.result.tools.map((t) => t.name);
    for (const spec of TOOL_SPECS) assert.ok(names.includes(spec.name), `missing ${spec.name}`);
    assert.ok(names.includes("incident_get_fix_brief"));
    assert.ok(names.includes("approval_status"));
    const restart = list.result.tools.find((t) => t.name === "app_restart");
    assert.ok(restart.description.includes("Approval-only"));
    assert.strictEqual(restart.inputSchema.type, "object");

    const ok = await server.handleMessage({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "app_status", arguments: { app: "site" } } });
    assert.strictEqual(ok.result.isError, false);
    assert.deepStrictEqual(textOf(ok), { status: "running", app: "site" });
  });

  it("returns approval_required for L2 and never reports execution", async () => {
    const res = await server.handleMessage({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "app_restart", arguments: { app: "site" } } });
    assert.strictEqual(res.result.isError, false);
    assert.strictEqual(textOf(res).status, "approval_required");
    assert.strictEqual(textOf(res).approvalId, "apr_1");
  });

  it("rejects an executor that claims an L3 action ran without an approval", async () => {
    const res = await server.handleMessage({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "app_delete", arguments: { app: "site" } } });
    assert.strictEqual(res.result.isError, true);
    assert.strictEqual(res.result.content[0].text, "NOT_AN_APPROVAL_REQUEST");
  });

  it("treats scale 0 as L3 (approval only)", async () => {
    const res = await server.handleMessage({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "app_scale", arguments: { app: "site", scale: 0 } } });
    assert.strictEqual(res.result.isError, true);
  });

  it("reports invalid arguments as a tool error and unknown tools as JSON-RPC errors", async () => {
    const bad = await server.handleMessage({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "app_restart", arguments: {} } });
    assert.strictEqual(bad.result.isError, true);
    assert.ok(bad.result.content[0].text.startsWith("INVALID_ARGUMENTS"));
    const unknown = await server.handleMessage({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "nope", arguments: {} } });
    assert.strictEqual(unknown.error.code, -32602);
  });

  it("answers ping and rejects unknown methods", async () => {
    assert.deepStrictEqual((await server.handleMessage({ jsonrpc: "2.0", id: 9, method: "ping" })).result, {});
    assert.strictEqual((await server.handleMessage({ jsonrpc: "2.0", id: 10, method: "resources/list" })).error.code, -32601);
  });
});

describe("MCP stdio transport", () => {
  it("serves newline-delimited JSON-RPC over the given streams", async () => {
    const server = createMcpServer({ tools: MCP_TOOL_SPECS, executeTool: async () => ({ status: "running" }) });
    const input = new PassThrough();
    const output = new PassThrough();
    const lines = [];
    readline.createInterface({ input: output }).on("line", (l) => lines.push(JSON.parse(l)));

    const done = runStdio(server, { input, output });
    input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } }) + "\n");
    input.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    input.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n");
    input.write(JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "limits_list", arguments: {} } }) + "\n");
    input.write("{not json\n");
    input.end();
    await done;
    await new Promise((r) => setImmediate(r));

    assert.strictEqual(lines.length, 4, JSON.stringify(lines));
    assert.strictEqual(lines[0].id, 1);
    assert.strictEqual(lines[0].result.protocolVersion, "2024-11-05");
    assert.ok(Array.isArray(lines[1].result.tools));
    assert.strictEqual(lines[2].id, 3);
    assert.strictEqual(lines[3].error.code, -32700);
  });
});

// ---- real bin, talking to a fake Sokan console on 127.0.0.1 ----

function startFakeConsole(token) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ method: req.method, url: req.url, token: req.headers["x-sokan-token"], body });
      if (req.headers["x-sokan-token"] !== token) {
        res.writeHead(401, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "UNAUTHORIZED" }));
      }
      const json = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
      if (req.method === "POST" && req.url === "/api/tools/app_status") return json(200, { status: "running" });
      if (req.method === "POST" && req.url === "/api/tools/app_restart") return json(200, { status: "approval_required", approvalId: "apr_7", console_url: "http://127.0.0.1/?approval=apr_7" });
      if (req.method === "POST" && req.url === "/api/tools/app_delete") return json(200, { status: "deleted" });
      if (req.method === "GET" && req.url === "/api/approvals/apr_7") return json(200, { status: "pending" });
      json(404, { error: "NOT_FOUND" });
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, seen, port: server.address().port })));
}

describe("bin (spawned process) against a fake console", () => {
  it("forwards L0 calls, returns approval requests for L2, and rejects non-approval L3 results", async () => {
    const token = "test-token-123";
    const fake = await startFakeConsole(token);
    const child = spawn(process.execPath, [BIN], {
      env: { ...process.env, SOKAN_CONSOLE_URL: `http://127.0.0.1:${fake.port}`, SOKAN_CONSOLE_TOKEN: token },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const it2 = readline.createInterface({ input: child.stdout })[Symbol.asyncIterator]();
    const rpc = async (msg) => {
      child.stdin.write(JSON.stringify(msg) + "\n");
      if (msg.id === undefined) return undefined;
      const { value } = await it2.next();
      return JSON.parse(value);
    };

    try {
      const init = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
      assert.strictEqual(init.result.serverInfo.name, "sokan");
      await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });

      const list = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
      assert.ok(list.result.tools.some((t) => t.name === "approval_status"));

      const status = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "app_status", arguments: {} } });
      assert.strictEqual(JSON.parse(status.result.content[0].text).status, "running");

      const restart = await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "app_restart", arguments: { app: "site" } } });
      assert.strictEqual(restart.result.isError, false);
      assert.strictEqual(JSON.parse(restart.result.content[0].text).status, "approval_required");

      const pollStatus = await rpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "approval_status", arguments: { approvalId: "apr_7" } } });
      assert.strictEqual(JSON.parse(pollStatus.result.content[0].text).status, "pending");

      const del = await rpc({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "app_delete", arguments: { app: "site" } } });
      assert.strictEqual(del.result.isError, true);
      assert.strictEqual(del.result.content[0].text, "CONSOLE_DID_NOT_CREATE_APPROVAL");

      // the token travels only as a header to the console, never in tool output
      assert.ok(fake.seen.every((r) => r.token === token));
      assert.ok(fake.seen.some((r) => r.url === "/api/approvals/apr_7" && r.method === "GET"));
      assert.ok(fake.seen.some((r) => r.url === "/api/tools/app_delete" && JSON.parse(r.body).source === "mcp"));
    } finally {
      child.stdin.end();
      child.kill();
      await new Promise((r) => fake.server.close(r));
    }
  });
});

describe("console executor", () => {
  it("rejects a wrong token response without leaking it", async () => {
    const exec = createConsoleExecutor({
      baseUrl: "http://127.0.0.1:9",
      token: "t",
      fetchImpl: async () => new Response("{}", { status: 401 }),
    });
    await assert.rejects(exec("app_status", {}), (err) => err.code === "CONSOLE_HTTP_401" && err.message === "CONSOLE_HTTP_401");
  });
});

describe("bin credentials (EVALUATION R1)", () => {
  // Runs the bin once: initialize, one L0 tool call, then stdin closes. Returns what the fake console saw.
  async function runBin(expectedToken, env) {
    const fake = await startFakeConsole(expectedToken);
    const child = spawn(process.execPath, [BIN], {
      env: { PATH: process.env.PATH, ...env, SOKAN_CONSOLE_URL: `http://127.0.0.1:${fake.port}` },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    const lines = readline.createInterface({ input: child.stdout })[Symbol.asyncIterator]();
    try {
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }) + "\n");
      await lines.next();
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "app_status", arguments: {} } }) + "\n");
      await lines.next();
    } finally {
      child.stdin.end();
      child.kill();
      await new Promise((r) => fake.server.close(r));
    }
    return { seen: fake.seen, stderr };
  }

  it("sends SOKAN_AGENT_TOKEN to the console and never the console token", async () => {
    const out = await runBin("agent-token-222", { SOKAN_AGENT_TOKEN: "agent-token-222", SOKAN_CONSOLE_TOKEN: "" });
    assert.ok(out.seen.length > 0);
    assert.ok(out.seen.every((r) => r.token === "agent-token-222"));
    assert.ok(!out.stderr.includes("WARNING"));
  });

  it("falls back to SOKAN_CONSOLE_TOKEN only with a stderr warning", async () => {
    const out = await runBin("console-secret-333", { SOKAN_CONSOLE_TOKEN: "console-secret-333" });
    assert.ok(out.seen.every((r) => r.token === "console-secret-333"));
    assert.match(out.stderr, /WARNING: SOKAN_CONSOLE_TOKEN is used as a fallback/);
  });
});

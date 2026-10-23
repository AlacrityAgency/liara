const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const CLI_BIN = path.join(ROOT, "packages", "cli", "bin", "sokan.js");
const DEMO = path.join(ROOT, "demo", "chaos-shop");
const TOKEN = "test-liara-token-0123456789";
const DB_URL = "postgres://app:Sup3r-Secret-Pass@db.example.test:5432/shop";

const children = new Set();
const tempDirs = [];
const stubs = [];

after(() => {
  for (const child of children) child.kill("SIGKILL");
  for (const stub of stubs) stub.server.close();
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** A project folder: a copy of the demo app, optionally with a .env that supplies DATABASE_URL. */
function demoProject({ withEnv = true } = {}) {
  const dir = path.join(tempDir("sokan-proj-"), "chaos-shop");
  fs.cpSync(DEMO, dir, { recursive: true });
  if (withEnv) fs.writeFileSync(path.join(dir, ".env"), `DATABASE_URL=${DB_URL}\n`);
  return dir;
}

const iso = (minutesAgo = 0) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

const ME = {
  user: { fullname: "تست", email: "test@example.invalid" },
  plans: {
    projects: {
      free: { price: 0, available: true, region: "iran", RAM: { amount: 0.5 }, CPU: { amount: 1 }, volume: 1 },
      "g2-1": { price: 1000, available: true, region: "iran", RAM: { amount: 1 }, CPU: { amount: 1 }, volume: 10 },
      "g2-2": { price: 2000, available: true, region: "iran", RAM: { amount: 2 }, CPU: { amount: 2 }, volume: 20 },
    },
    projectBundlePlans: {
      free: { free: { available: true, displayPrice: 0 } },
      "g2-1": {
        standard: { available: true, displayPrice: 150000 },
        pro: { available: true, displayPrice: 400000 },
      },
      "g2-2": {
        standard: { available: true, displayPrice: 300000 },
        pro: { available: true, displayPrice: 600000 },
      },
    },
  },
};

const project = (name, planID = "g2-1") => ({
  _id: "p_1",
  project_id: name,
  name,
  type: "node",
  status: "running",
  planID,
  port: 3100,
  scale: 1,
  envs: [],
  isDeployed: true,
  hourlyPrice: 1000,
});

/**
 * Tiny stand-in for the Liara API plus the site probe. Every request is recorded in `requests`.
 * options.created: the app already exists. options.oom: the app is out of memory until restarted.
 * options.buildError: the build fails with this stderr line.
 */
function startStub(options = {}) {
  const state = { created: !!options.created, restarted: false, balance: options.balance ?? 2_000_000 };
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://stub.local");
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let body = raw;
      if ((req.headers["content-type"] || "").includes("application/json") && raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          body = raw;
        }
      }
      requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body });
      const send = (status, payload) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      route(req.method, url.pathname, state, options, send);
    });
  });
  stubs.push({ server });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}`, requests, state, server });
    });
  });
}

function route(method, pathname, state, options, send) {
  let m;
  if (method === "GET" && pathname === "/probe") {
    return options.oom && !state.restarted ? send(500, { message: "boom" }) : send(200, { ok: true });
  }
  if (method === "GET" && pathname === "/v1/me") return send(200, ME);
  if (method === "GET" && pathname === "/v1/billing") return send(200, { user: { balance: state.balance, minCreditAmount: 0 } });
  if (method === "POST" && pathname === "/v1/projects") {
    state.created = true;
    return send(200, { project: project("chaos-shop") });
  }
  if (method === "POST" && pathname === "/v1/projects/update-envs") return send(200, {});
  if (method === "POST" && pathname === "/api/v1/zones") {
    return send(200, { status: "success", data: { name: "example.ir", ns: ["ns1.liara.test", "ns2.liara.test"] } });
  }
  if (method === "PUT" && (m = pathname.match(/^\/api\/v1\/zones\/([^/]+)\/check$/))) {
    return send(200, { status: "success", data: "delegation confirmed" });
  }
  if (method === "POST" && (m = pathname.match(/^\/api\/v1\/zones\/([^/]+)\/dns-records$/))) {
    return send(200, { status: "success", data: { name: "www", type: "CNAME", contents: ["chaos-shop.liara.run"] } });
  }
  if (method === "POST" && pathname === "/v1/domains") {
    return send(200, { domain: { name: "www.example.ir", CNameRecord: "chaos-shop.liara.run" } });
  }
  if (method === "POST" && pathname === "/v1/domains/provision-ssl-certs") return send(200, { code: "ok" });
  if (method === "POST" && (m = pathname.match(/^\/v2\/projects\/([^/]+)\/sources$/))) return send(200, { sourceID: "src_1" });
  if (method === "POST" && (m = pathname.match(/^\/v2\/projects\/([^/]+)\/releases$/))) return send(200, { releaseID: "rel_1" });
  if (method === "GET" && (m = pathname.match(/^\/v2\/releases\/([^/]+)\/build-logs$/))) {
    if (options.buildError) {
      return send(200, {
        release: { _id: m[1], state: "FAILED" },
        buildOutput: [{ stream: "STDERR", line: options.buildError, createdAt: iso() }],
      });
    }
    return send(200, { release: { _id: m[1], state: "READY" }, buildOutput: [] });
  }
  if (method === "POST" && (pathname === "/v1/projects/chaos-shop/actions/restart" || pathname === "/v1/projects/chaos-shop/resize")) {
    state.restarted = true;
    return send(200, {});
  }
  if (method === "GET" && (m = pathname.match(/^\/v1\/projects\/([^/]+)$/))) {
    if (!state.created) return send(404, { message: "app not found" });
    return send(200, { project: project(decodeURIComponent(m[1])) });
  }
  if (method === "GET" && pathname === "/v1/projects/chaos-shop/logs") {
    return send(200, [{ datetime: iso(1), message: "[boot] listening on 3100", type: "app" }]);
  }
  if (method === "GET" && pathname === "/v1/projects/chaos-shop/applets") {
    const applets = options.oom && !state.restarted
      ? [{ state: "crashed", reason: "OOMKilled", release: { releaseID: "rel_1" } }]
      : [{ state: "running" }];
    return send(200, { applets });
  }
  if (method === "GET" && pathname === "/v1/projects/chaos-shop/events") {
    const events = options.oom && !state.restarted
      ? [{ _id: "ev_1", type: "applet", message: "Container terminated: OOMKilled (exit code 137)", createdAt: iso(2) }]
      : [];
    return send(200, { events });
  }
  if (method === "GET" && pathname === "/v1/projects/chaos-shop/releases") {
    return send(200, { releases: [{ _id: "rel_1", state: "READY", createdAt: iso(20), finishedAt: iso(19) }] });
  }
  if (method === "GET" && pathname === "/v1/projects/chaos-shop/metrics/memory") {
    const values = [900, 920, 940, 960, 975, 980].map((mb, i) => [Math.floor(Date.now() / 1000) - (6 - i) * 120, mb]);
    return send(200, { result: [{ values }] });
  }
  if (method === "GET" && pathname === "/v1/projects/chaos-shop/metrics/cpu") {
    const values = [10, 12, 11].map((pct, i) => [Math.floor(Date.now() / 1000) - (3 - i) * 120, pct]);
    return send(200, { result: [{ values }] });
  }
  return send(404, { message: `stub: no route for ${method} ${pathname}` });
}

/** Runs the CLI as a child process; answers are piped to stdin. */
function runCli(args, { cwd, env, input = "", timeoutMs = 60_000 }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_BIN, ...args], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    children.add(child);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`sokan timed out\n${stdout}\n${stderr}`));
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      children.delete(child);
      resolve({ code, stdout, stderr });
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(input);
  });
}

/** Environment for the child: no inherited Liara token, own SOKAN_HOME, the stub as the API. */
function cliEnv(stub, home, extra = {}) {
  return {
    PATH: process.env.PATH,
    HOME: home,
    SOKAN_HOME: path.join(home, ".sokan"),
    SOKAN_LIARA_BASE_URL: stub.url,
    SOKAN_PROBE_URL_OVERRIDE: `${stub.url}/probe`,
    NO_COLOR: "1",
    ...extra,
  };
}

const callsOf = (requests) => requests.map((r) => `${r.method} ${r.path}`);

describe("sokan CLI: deploy", () => {
  it("asks token, env, name, plan and one confirmation, then creates, deploys and reports the live URL", async () => {
    const stub = await startStub();
    const home = tempDir("sokan-home-");
    const dir = demoProject();
    // token, app name (Enter = chaos-shop), plan (Enter = recommended g2-1), confirmation
    const res = await runCli([], { cwd: dir, env: cliEnv(stub, home), input: `${TOKEN}\n\n\ny\n` });
    const out = res.stdout + res.stderr;

    assert.strictEqual(res.code, 0, out);
    assert.match(res.stdout, /یک سایت Node\.js روی پورت ۳۱۰۰ پیدا کردم/);
    assert.match(res.stdout, /فایل \.env پروژه را خواندم/);
    assert.match(res.stdout, /این کار ماهی ۸۷۰٬۰۰۰ تومان هزینه دارد/);
    assert.match(res.stdout, /✅ سایتت آنلاین شد: https:\/\/chaos-shop\.liara\.run/);
    assert.ok(!out.includes(TOKEN), "the Liara token must never be printed");
    assert.ok(!out.includes("Sup3r-Secret-Pass"), "env values must never be printed");

    const reqs = stub.requests;
    const first = (method, p) => reqs.findIndex((r) => r.method === method && r.path === p);
    const createAt = first("POST", "/v1/projects");
    const sourceAt = first("POST", "/v2/projects/chaos-shop/sources");
    const releaseAt = first("POST", "/v2/projects/chaos-shop/releases");
    const envAt = first("POST", "/v1/projects/update-envs");
    assert.ok(first("GET", "/v1/projects/chaos-shop") < createAt, `order: ${callsOf(reqs)}`);
    assert.ok(createAt < envAt && envAt < sourceAt && sourceAt < releaseAt, `order: ${callsOf(reqs)}`);

    const created = reqs[createAt].body;
    assert.strictEqual(created.name, "chaos-shop");
    assert.strictEqual(created.planID, "g2-1");
    assert.strictEqual(created.bundlePlanID, "standard", "cheapest valid bundle for the plan");
    assert.strictEqual(created.platform, "node");
    assert.deepStrictEqual(reqs[envAt].body.variables, [{ key: "DATABASE_URL", value: DB_URL }]);
    assert.deepStrictEqual(reqs[releaseAt].body, { sourceID: "src_1", port: 3100, type: "node", envs: { DATABASE_URL: DB_URL } });

    const credentials = path.join(home, ".sokan", "credentials.json");
    assert.strictEqual(fs.statSync(credentials).mode & 0o777, 0o600);
    assert.strictEqual(fs.statSync(path.join(home, ".sokan")).mode & 0o777, 0o700);
    assert.strictEqual(JSON.parse(fs.readFileSync(credentials, "utf8")).token, TOKEN);

    const site = JSON.parse(fs.readFileSync(path.join(dir, ".sokan", "site.json"), "utf8"));
    assert.strictEqual(site.appName, "chaos-shop");
    assert.strictEqual(site.url, "https://chaos-shop.liara.run");
  });

  it("cancelling the confirmation with n exits 2 and sends no create or deploy request", async () => {
    const stub = await startStub();
    const home = tempDir("sokan-home-");
    const dir = demoProject();
    const res = await runCli([], {
      cwd: dir,
      env: cliEnv(stub, home, { LIARA_API_TOKEN: TOKEN }),
      input: "\n\nn\n",
    });
    const out = res.stdout + res.stderr;

    assert.strictEqual(res.code, 2, out);
    assert.match(res.stdout, /لغو شد/);
    assert.ok(!out.includes(TOKEN));
    assert.ok(!stub.requests.some((r) => r.method === "POST"), `no POST expected, got ${callsOf(stub.requests)}`);
  });

  it("a failed build prints one plain sentence, the log tail and a fix brief, and exits 1", async () => {
    const stub = await startStub({ buildError: 'npm ERR! Missing script: "build"' });
    const home = tempDir("sokan-home-");
    const dir = demoProject();
    const res = await runCli([], { cwd: dir, env: cliEnv(stub, home, { LIARA_API_TOKEN: TOKEN }), input: "\n\ny\n" });

    assert.strictEqual(res.code, 1, res.stdout + res.stderr);
    assert.match(res.stderr, /اسکریپت "build" در package\.json پیدا نشد/);
    assert.match(res.stdout, /جزئیات فنی/);
    const brief = path.join(dir, ".sokan", "fix-brief.md");
    assert.ok(fs.existsSync(brief), "fix brief written");
    assert.ok(!(res.stdout + res.stderr).includes(TOKEN));
  });
});

describe("sokan CLI: fix", () => {
  it("collects out-of-memory evidence and prints one problem and one solution, then re-checks the site", async () => {
    const stub = await startStub({ created: true, oom: true });
    const home = tempDir("sokan-home-");
    const dir = demoProject({ withEnv: false });
    fs.mkdirSync(path.join(dir, ".sokan"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".sokan", "site.json"),
      JSON.stringify({
        appName: "chaos-shop",
        url: "https://chaos-shop.liara.run",
        platform: "node",
        port: 3100,
        planID: "g2-1",
        lastDeployAt: iso(60),
      })
    );
    const res = await runCli(["fix"], { cwd: dir, env: cliEnv(stub, home, { LIARA_API_TOKEN: TOKEN }), input: "y\n" });
    const out = res.stdout + res.stderr;

    assert.strictEqual(res.code, 0, out);
    assert.match(res.stdout, /مشکل: .+/);
    assert.match(res.stdout, /راه‌حل: .+/);
    assert.match(res.stdout, /قبل: خطای ۵۰۰\s+بعد: ۲۰۰/);
    assert.match(res.stdout, /درست شد/);
    const action = stub.requests.find((r) => r.method === "POST" && /\/(actions\/restart|resize)$/.test(r.path));
    assert.ok(action, `an approved action was sent: ${callsOf(stub.requests)}`);
    if (action.path.endsWith("/resize")) assert.strictEqual(action.body.planID, "g2-2", "next plan with more RAM");
    assert.ok(fs.existsSync(path.join(dir, ".sokan", "fix-brief.md")));
    assert.ok(!out.includes(TOKEN));
  });
});

describe("sokan CLI: status, logs, domain, mcp", () => {
  const writeSite = (dir) => {
    fs.mkdirSync(path.join(dir, ".sokan"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".sokan", "site.json"),
      JSON.stringify({ appName: "chaos-shop", url: "https://chaos-shop.liara.run", platform: "node", port: 3100, planID: "g2-1", monthlyTomans: 720000, lastDeployAt: iso(60) })
    );
  };

  it("status reads the app, the live probe and the monthly cost; logs prints recent lines", async () => {
    const stub = await startStub({ created: true });
    const home = tempDir("sokan-home-");
    const dir = demoProject({ withEnv: false });
    writeSite(dir);
    const env = cliEnv(stub, home, { LIARA_API_TOKEN: TOKEN });

    const status = await runCli(["status"], { cwd: dir, env });
    assert.strictEqual(status.code, 0, status.stdout + status.stderr);
    assert.match(status.stdout, /برنامه: chaos-shop/);
    assert.match(status.stdout, /وضعیت سایت: ۲۰۰ \(سالم\)/);
    assert.match(status.stdout, /هزینه‌ی ماهانه: ۷۲۰٬۰۰۰ تومان/);

    const logs = await runCli(["logs"], { cwd: dir, env });
    assert.strictEqual(logs.code, 0, logs.stdout + logs.stderr);
    assert.match(logs.stdout, /listening on 3100/);
    assert.ok(!(logs.stdout + logs.stderr).includes(TOKEN));
  });

  it("domain prints the nameservers, and --check adds the domain, a CNAME record and SSL after confirmation", async () => {
    const stub = await startStub({ created: true });
    const home = tempDir("sokan-home-");
    const dir = demoProject({ withEnv: false });
    writeSite(dir);
    const env = cliEnv(stub, home, { LIARA_API_TOKEN: TOKEN, SOKAN_DNS_BASE_URL: stub.url });

    const first = await runCli(["domain", "example.ir"], { cwd: dir, env });
    assert.strictEqual(first.code, 0, first.stdout + first.stderr);
    assert.match(first.stdout, /ns1\.liara\.test/);
    assert.match(first.stdout, /sokan domain example\.ir --check/);

    const check = await runCli(["domain", "www.example.ir", "--check"], { cwd: dir, env, input: "y\n" });
    assert.strictEqual(check.code, 0, check.stdout + check.stderr);
    const addAt = stub.requests.findIndex((r) => r.method === "POST" && r.path === "/v1/domains");
    const recordAt = stub.requests.findIndex((r) => r.method === "POST" && /^\/api\/v1\/zones\/[^/]+\/dns-records$/.test(r.path));
    const sslAt = stub.requests.findIndex((r) => r.method === "POST" && r.path === "/v1/domains/provision-ssl-certs");
    assert.ok(addAt >= 0 && recordAt > addAt && sslAt > recordAt, callsOf(stub.requests).join(" | "));
    assert.strictEqual(stub.requests[addAt].body.project, "chaos-shop");
    assert.strictEqual(stub.requests[recordAt].body.name, "www");
    assert.deepStrictEqual(stub.requests[recordAt].body.contents, ["chaos-shop.liara.run"]);
  });

  it("mcp starts the stdio server and exits when its input closes", async () => {
    const res = await runCli(["mcp"], { cwd: ROOT, env: { PATH: process.env.PATH, HOME: os.tmpdir(), SOKAN_HOME: tempDir("sokan-home-") } });
    assert.strictEqual(res.code, 0, res.stdout + res.stderr);
  });
});

describe("CLI plan labels use MB from the client", () => {
  const { planLabel, threePlanOptions } = require("../build/cli/src/liara.js");
  it("prints GB for >=1024 MB and MB below, and recommends the first >=1 GB plan", () => {
    assert.match(planLabel({ planID: "g2-m", ram: 1024, cpu: 1 }), /۱ گیگ رم/);
    assert.match(planLabel({ planID: "g2-s", ram: 512, cpu: 0.5 }), /۵۱۲ مگ رم/);
    const opts = [
      { planID: "g2-s", ram: 512, monthlyPrice: 1 },
      { planID: "g2-m", ram: 1024, monthlyPrice: 2 },
      { planID: "g2-l", ram: 2048, monthlyPrice: 3 },
    ];
    assert.strictEqual(threePlanOptions(opts).recommended, 1);
  });
});

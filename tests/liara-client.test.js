const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { spawnSync } = require("node:child_process");

const {
  LiaraClient,
  LIARA_LIMITS,
  packSource,
  PackError,
  DEFAULT_TIMEOUT_MS,
  UPLOAD_TIMEOUT_MS,
  DEFAULT_RETRY_DELAYS_MS,
} = require("../build/liara-client/src/index.js");

const API = "https://api.liara.ir";
const DNS = "https://dns-service.liara.ir";
const TOKEN = "test-token";

// Scripted fetch: records every call and answers with handler(call, n).
function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const call = {
      url,
      method: init.method || "GET",
      headers: { ...(init.headers || {}) },
      body: init.body,
      signal: init.signal,
    };
    calls.push(call);
    return handler(call, calls.length);
  };
  fn.calls = calls;
  return fn;
}

const json = (status, body) =>
  new Response(body === undefined ? "" : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

// Never answers; only the AbortController signal ends it.
const hang = (call) =>
  new Promise((_, reject) => call.signal.addEventListener("abort", () => reject(new Error("aborted"))));

function liveClient(fetchImpl, extra = {}) {
  return new LiaraClient({
    apiToken: TOKEN,
    fetchImpl,
    retryDelaysMs: [0, 0, 0],
    ...extra,
  });
}

describe("LiaraClient: simulated mode", () => {
  it("returns SIMULATED_MODE without calling fetch when no token is set", async () => {
    const saved = process.env.LIARA_API_TOKEN;
    delete process.env.LIARA_API_TOKEN;
    try {
      const f = fakeFetch(() => json(200, {}));
      const client = new LiaraClient({ fetchImpl: f });
      assert.strictEqual(client.isLive, false);
      const res = await client.getAccount();
      assert.strictEqual(res.ok, false);
      assert.strictEqual(res.error.code, "SIMULATED_MODE");
      const dep = await client.deploy("app1", os.tmpdir(), { port: 3000, platform: "node" });
      assert.strictEqual(dep.error.code, "SIMULATED_MODE");
      assert.strictEqual(f.calls.length, 0);
    } finally {
      if (saved !== undefined) process.env.LIARA_API_TOKEN = saved;
    }
  });
});

describe("LiaraClient: request() robustness", () => {
  it("treats 204 and empty 200 bodies as ok with data undefined", async () => {
    const f = fakeFetch((call) => (call.url.endsWith("/restart") ? new Response(null, { status: 204 }) : new Response("", { status: 200 })));
    const client = liveClient(f);
    const restart = await client.restartApp("app1");
    assert.deepStrictEqual(restart, { ok: true, data: undefined });
    const cancel = await client.cancelRelease("rel-1");
    assert.deepStrictEqual(cancel, { ok: true, data: undefined });
  });

  it("treats non-JSON 2xx bodies as ok with data undefined", async () => {
    const f = fakeFetch(() => new Response("<html>ok</html>", { status: 200 }));
    const res = await liveClient(f).getEvents("app1");
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.data, undefined);
  });

  it("retries GET on 5xx with the configured backoff and then succeeds", async () => {
    const f = fakeFetch((call, n) => (n < 3 ? json(500, { message: "boom" }) : json(200, { user: {} })));
    const res = await liveClient(f).validateToken();
    assert.strictEqual(res.ok, true);
    assert.strictEqual(f.calls.length, 3);
  });

  it("retries GET on network errors", async () => {
    const f = fakeFetch((call, n) => {
      if (n === 1) throw new TypeError("fetch failed");
      return json(200, { projects: [] });
    });
    const res = await liveClient(f).listApps();
    assert.strictEqual(res.ok, true);
    assert.strictEqual(f.calls.length, 2);
  });

  it("gives up on GET after the retry budget and reports the last 5xx", async () => {
    const f = fakeFetch(() => json(503, { message: "down" }));
    const res = await liveClient(f).getAccount();
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.error.code, "HTTP_503");
    assert.strictEqual(f.calls.length, 1 + 3, "one attempt plus three retries");
  });

  it("never retries POST on 5xx or network errors", async () => {
    const f5 = fakeFetch(() => json(500, { message: "boom" }));
    const r5 = await liveClient(f5).restartApp("app1");
    assert.strictEqual(r5.error.code, "HTTP_500");
    assert.strictEqual(f5.calls.length, 1);

    const fNet = fakeFetch(() => {
      throw new TypeError("socket hang up");
    });
    const rNet = await liveClient(fNet).scaleApp("app1", 1);
    assert.strictEqual(rNet.error.code, "NETWORK_ERROR");
    assert.strictEqual(fNet.calls.length, 1);
  });

  it("never retries DELETE or PUT", async () => {
    const f = fakeFetch(() => json(502, { message: "bad gateway" }));
    await liveClient(f).deleteApp("app1");
    assert.strictEqual(f.calls.length, 1);
    const g = fakeFetch(() => json(502, { message: "bad gateway" }));
    await liveClient(g).checkZone("example.ir");
    assert.strictEqual(g.calls.length, 1);
  });

  it("honors Retry-After on GET 429 and retries", async () => {
    const f = fakeFetch((call, n) =>
      n === 1
        ? new Response("{}", { status: 429, headers: { "retry-after": "0", "content-type": "application/json" } })
        : json(200, { projects: [] })
    );
    const res = await liveClient(f).listApps();
    assert.strictEqual(res.ok, true);
    assert.strictEqual(f.calls.length, 2);
  });

  it("does not retry POST on 429 and maps it to RATE_LIMITED", async () => {
    const f = fakeFetch(() => new Response("{}", { status: 429, headers: { "retry-after": "0" } }));
    const res = await liveClient(f).createApp({ name: "a", planID: "p", platform: "node" });
    assert.strictEqual(res.error.code, "RATE_LIMITED");
    assert.strictEqual(f.calls.length, 1);
  });

  it("aborts a hung request after the per-call timeout (POST: no retry)", async () => {
    const f = fakeFetch(hang);
    const started = Date.now();
    const res = await liveClient(f).request("/v1/projects/app1/actions/restart", { method: "POST", timeoutMs: 20 });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.error.code, "TIMEOUT");
    assert.strictEqual(f.calls.length, 1);
    assert.ok(Date.now() - started < 2000);
    assert.ok(f.calls[0].signal.aborted);
  });

  it("retries a timed-out GET", async () => {
    const f = fakeFetch(hang);
    const res = await liveClient(f).request("/v1/me", { timeoutMs: 20 });
    assert.strictEqual(res.error.code, "TIMEOUT");
    assert.strictEqual(f.calls.length, 1 + 3);
  });

  it("exposes the documented default timeouts", () => {
    assert.strictEqual(DEFAULT_TIMEOUT_MS, 15000);
    assert.strictEqual(UPLOAD_TIMEOUT_MS, 120000);
    assert.deepStrictEqual([...DEFAULT_RETRY_DELAYS_MS], [500, 1000, 2000]);
  });

  it("appends teamID to PaaS calls only", async () => {
    const f = fakeFetch(() => json(200, { user: {} }));
    const client = liveClient(f, { teamID: "team-42" });
    await client.validateToken();
    assert.strictEqual(f.calls[0].url, `${API}/v1/me?teamID=team-42`);
    const d = fakeFetch(() => json(200, { status: "success", data: {} }));
    await liveClient(d, { teamID: "team-42" }).getZone("example.ir");
    assert.strictEqual(d.calls[0].url, `${DNS}/api/v1/zones/example.ir`);
  });
});

describe("LiaraClient: exact request shape per method", () => {
  // Each entry: [label, invoke(client), method, path, expectedBody | undefined]
  const cases = [
    ["validateToken", (c) => c.validateToken(), "GET", "/v1/me"],
    ["getAccount", (c) => c.getAccount(), "GET", "/v1/me"],
    ["getPlans", (c) => c.getPlans(), "GET", "/v1/me"],
    ["getBalance", (c) => c.getBalance(), "GET", "/v1/billing"],
    ["getGitIntegrations", (c) => c.getGitIntegrations(), "GET", "/v1/me/git-integrations"],
    ["listApps", (c) => c.listApps(), "GET", "/v1/projects"],
    ["getApp", (c) => c.getApp("my-app"), "GET", "/v1/projects/my-app"],
    [
      "createApp",
      (c) => c.createApp({ name: "my-app", planID: "p1", platform: "node" }),
      "POST",
      "/v1/projects",
      { name: "my-app", planID: "p1", platform: "node" },
    ],
    ["restartApp", (c) => c.restartApp("my-app"), "POST", "/v1/projects/my-app/actions/restart"],
    ["scaleApp", (c) => c.scaleApp("my-app", 1), "POST", "/v1/projects/my-app/actions/scale", { scale: 1 }],
    ["resizePlan", (c) => c.resizePlan("my-app", "p2"), "POST", "/v1/projects/my-app/resize", { planID: "p2" }],
    [
      "updateEnvs",
      (c) => c.updateEnvs("my-app", [{ key: "A", value: "1" }]),
      "POST",
      "/v1/projects/update-envs",
      { project: "my-app", variables: [{ key: "A", value: "1" }] },
    ],
    [
      "updatePort",
      (c) => c.updatePort("my-app", 3000),
      "POST",
      "/v1/projects/update-port",
      { project: "my-app", port: 3000 },
    ],
    ["setZeroDowntime(on)", (c) => c.setZeroDowntime("my-app", true), "POST", "/v1/projects/my-app/zero-downtime/enable"],
    ["setZeroDowntime(off)", (c) => c.setZeroDowntime("my-app", false), "POST", "/v1/projects/my-app/zero-downtime/disable"],
    ["deleteApp", (c) => c.deleteApp("my-app"), "DELETE", "/v1/projects/my-app"],
    ["listReleases", (c) => c.listReleases("my-app"), "GET", "/v1/projects/my-app/releases"],
    ["getApplets", (c) => c.getApplets("my-app"), "GET", "/v1/projects/my-app/applets"],
    ["getLogs", (c) => c.getLogs("my-app", 1700000000), "GET", "/v1/projects/my-app/logs?since=1700000000"],
    ["getEvents", (c) => c.getEvents("my-app"), "GET", "/v1/projects/my-app/events"],
    ["getMetricsSummary", (c) => c.getMetricsSummary("my-app"), "GET", "/v1/projects/my-app/metrics/summary"],
    [
      "getMetricsSeries",
      (c) => c.getMetricsSeries("my-app", "network-transmit", 1700000000),
      "GET",
      "/v1/projects/my-app/metrics/network-transmit?since=1700000000",
    ],
    [
      "createRelease",
      (c) => c.createRelease("my-app", { sourceID: "src-1", port: 8080, type: "node", envs: { A: "1" } }),
      "POST",
      "/v2/projects/my-app/releases",
      { sourceID: "src-1", port: 8080, type: "node", envs: { A: "1" } },
    ],
    ["getRelease", (c) => c.getRelease("rel-1"), "GET", "/v1/releases/rel-1"],
    [
      "getBuildLogs",
      (c) => c.getBuildLogs("rel-1", "2024-01-01T00:00:01.000Z"),
      "GET",
      "/v2/releases/rel-1/build-logs?since=2024-01-01T00%3A00%3A01.000Z",
    ],
    ["cancelRelease", (c) => c.cancelRelease("rel-1"), "POST", "/v2/releases/rel-1/cancel"],
    ["listDomains", (c) => c.listDomains("my-app"), "GET", "/v1/domains?project=my-app"],
    [
      "addDomain",
      (c) => c.addDomain("example.com", "my-app"),
      "POST",
      "/v1/domains",
      { name: "example.com", project: "my-app", type: "PROJECT" },
    ],
    ["checkDomain", (c) => c.checkDomain("dom-1"), "GET", "/v1/domains/dom-1/check"],
    [
      "provisionSsl",
      (c) => c.provisionSsl("example.com"),
      "POST",
      "/v1/domains/provision-ssl-certs",
      { domain: "example.com" },
    ],
    ["deleteDomain", (c) => c.deleteDomain("dom-1"), "DELETE", "/v1/domains/dom-1"],
    ["getDatabases", (c) => c.getDatabases(), "GET", "/v1/databases"],
    ["getDatabase", (c) => c.getDatabase("db-1"), "GET", "/v1/databases/db-1"],
    ["createDbBackup", (c) => c.createDbBackup("db-1"), "POST", "/v1/databases/db-1/backups"],
  ];

  for (const [label, invoke, method, p, body] of cases) {
    it(`${label}: ${method} ${p}`, async () => {
      const f = fakeFetch(() => json(200, {}));
      await invoke(liveClient(f));
      assert.strictEqual(f.calls.length, 1);
      const call = f.calls[0];
      assert.strictEqual(call.method, method);
      assert.strictEqual(call.url, `${API}${p}`);
      assert.strictEqual(call.headers.Authorization, `Bearer ${TOKEN}`);
      if (body === undefined) {
        assert.strictEqual(call.body, undefined);
      } else {
        assert.strictEqual(call.headers["Content-Type"], "application/json");
        assert.deepStrictEqual(JSON.parse(call.body), body);
      }
    });
  }

  const dnsCases = [
    ["createZone", (c) => c.createZone("example.ir"), "POST", "/api/v1/zones", { name: "example.ir" }],
    ["getZone", (c) => c.getZone("example.ir"), "GET", "/api/v1/zones/example.ir"],
    ["checkZone", (c) => c.checkZone("example.ir"), "PUT", "/api/v1/zones/example.ir/check"],
    ["listRecords", (c) => c.listRecords("example.ir"), "GET", "/api/v1/zones/example.ir/dns-records"],
    [
      "upsertRecord(create)",
      (c) => c.upsertRecord("example.ir", { name: "@", type: "A", ttl: 300, contents: [{ ip: "1.2.3.4" }] }),
      "POST",
      "/api/v1/zones/example.ir/dns-records",
      { name: "@", type: "A", ttl: 300, contents: [{ ip: "1.2.3.4" }] },
    ],
    [
      "upsertRecord(edit)",
      (c) => c.upsertRecord("example.ir", { id: "rec-9", name: "www", type: "A", contents: [{ ip: "5.6.7.8" }] }),
      "PUT",
      "/api/v1/zones/example.ir/dns-records/rec-9",
      { name: "www", type: "A", contents: [{ ip: "5.6.7.8" }] },
    ],
  ];
  for (const [label, invoke, method, p, body] of dnsCases) {
    it(`${label}: ${method} ${p} on dns-service`, async () => {
      const f = fakeFetch(() => json(200, { status: "success", data: {} }));
      await invoke(liveClient(f));
      const call = f.calls[0];
      assert.strictEqual(call.method, method);
      assert.strictEqual(call.url, `${DNS}${p}`);
      assert.strictEqual(call.headers.Authorization, `Bearer ${TOKEN}`);
      if (body === undefined) assert.strictEqual(call.body, undefined);
      else assert.deepStrictEqual(JSON.parse(call.body), body);
    });
  }

  it("uploadSource posts a multipart form with field file (no JSON content type)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "liara-upload-"));
    try {
      const archive = path.join(dir, "source.tar.gz");
      fs.writeFileSync(archive, zlib.gzipSync(Buffer.from("payload")));
      const f = fakeFetch(() => json(200, { sourceID: "src-7" }));
      const res = await liveClient(f).uploadSource("my-app", archive);
      assert.deepStrictEqual(res, { ok: true, data: { sourceID: "src-7" } });
      const call = f.calls[0];
      assert.strictEqual(call.method, "POST");
      assert.strictEqual(call.url, `${API}/v2/projects/my-app/sources`);
      assert.ok(call.body instanceof FormData);
      const file = call.body.get("file");
      assert.ok(file instanceof Blob);
      assert.strictEqual(file.size, fs.statSync(archive).size);
      assert.strictEqual(call.headers["Content-Type"], undefined);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("LiaraClient: response normalization", () => {
  it("getBalance reads balance from the user object of /v1/billing", async () => {
    const f = fakeFetch(() => json(200, { user: { balance: 12345, minCreditAmount: 50000 } }));
    const res = await liveClient(f).getBalance();
    assert.deepStrictEqual(res, { ok: true, data: { balance: 12345, minCreditAmount: 50000 } });
  });

  it("getPlans extracts plans.projects and computes monthly price as hourly * 720", async () => {
    const f = fakeFetch(() =>
      json(200, {
        plans: {
          projects: {
            "g2-small": { price: 100, available: true, region: "iran", CPU: { amount: 1 }, RAM: { amount: 2 }, volume: 10 },
            free: { price: 0, available: false, region: "iran" },
          },
        },
      })
    );
    const res = await liveClient(f).getPlans();
    assert.strictEqual(res.ok, true);
    const small = res.data.find((p) => p.planID === "g2-small");
    assert.strictEqual(small.hourlyPrice, 100);
    assert.strictEqual(small.monthlyPrice, 72000);
    assert.strictEqual(small.available, true);
    assert.strictEqual(res.data.find((p) => p.planID === "free").available, false);
  });

  it("getPlans is defensive when plans are missing", async () => {
    const f = fakeFetch(() => json(200, {}));
    const res = await liveClient(f).getPlans();
    assert.deepStrictEqual(res, { ok: true, data: [] });
  });

  it("getLogs defaults since to roughly now minus 30 minutes", async () => {
    const f = fakeFetch(() => json(200, []));
    await liveClient(f).getLogs("my-app");
    const since = Number(new URL(f.calls[0].url).searchParams.get("since"));
    const expected = Math.floor(Date.now() / 1000) - 1800;
    assert.ok(Math.abs(since - expected) <= 5, `since=${since} expected~${expected}`);
  });

  it("listApps maps project_id to name", async () => {
    const f = fakeFetch(() => json(200, { projects: [{ _id: "x", project_id: "my-app", scale: 1, planID: "p" }] }));
    const res = await liveClient(f).listApps();
    assert.strictEqual(res.data.projects[0].name, "my-app");
  });
});

describe("LiaraClient: packSource", () => {
  let root;
  const hasTar = spawnSync("tar", ["--version"]).status === 0;

  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "liara-pack-"));
    const write = (rel, content) => {
      const abs = path.join(root, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    };
    write("package.json", '{"name":"demo"}');
    write("src/index.js", "console.log('hi')");
    write("src/deep/util.js", "module.exports = 1");
    write("logs/app.log", "noise");
    write("dist/bundle.js", "built");
    write(".env", "LIARA_API_TOKEN=secret");
    write(".env.production", "DB_PASSWORD=secret");
    write("config/server.pem", "-----BEGIN PRIVATE KEY-----");
    write("node_modules/left-pad/index.js", "module.exports = 0");
    write("src/node_modules/nested/index.js", "module.exports = 0");
    write(".git/HEAD", "ref: refs/heads/main");
    write(".liaraignore", "# comments are ignored\nlogs/\ndist\n*.tmp\n");
    write("scratch.tmp", "temp");
  });

  after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("excludes secrets, node_modules, .git and honors .liaraignore", async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "liara-pack-out-"));
    try {
      const result = await packSource(root, { outPath: path.join(outDir, "src.tar.gz") });
      assert.deepStrictEqual(result.files, [".liaraignore", "package.json", "src/deep/util.js", "src/index.js"]);
      assert.strictEqual(result.sizeBytes, fs.statSync(result.path).size);
      const archive = zlib.gunzipSync(fs.readFileSync(result.path)).toString("latin1");
      // Secret contents and excluded file names must not appear anywhere in the archive.
      for (const forbidden of [
        "LIARA_API_TOKEN=secret",
        "DB_PASSWORD",
        "BEGIN PRIVATE KEY",
        "left-pad",
        "refs/heads/main",
        "noise",
        "dist/bundle.js",
        "scratch.tmp",
      ]) {
        assert.ok(!archive.includes(forbidden), `archive must not contain ${forbidden}`);
      }
      assert.ok(archive.includes("console.log('hi')"));
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("uses .gitignore when .liaraignore is absent", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "liara-pack-git-"));
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "liara-pack-git-out-"));
    try {
      fs.writeFileSync(path.join(dir, "index.js"), "x");
      fs.writeFileSync(path.join(dir, "debug.log"), "x");
      fs.mkdirSync(path.join(dir, "build"));
      fs.writeFileSync(path.join(dir, "build", "out.js"), "x");
      fs.writeFileSync(path.join(dir, ".gitignore"), "*.log\n/build/\n");
      const result = await packSource(dir, { outPath: path.join(outDir, "a.tar.gz") });
      assert.deepStrictEqual(result.files, [".gitignore", "index.js"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("is deterministic: the same tree produces identical bytes", async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "liara-pack-det-"));
    try {
      const a = await packSource(root, { outPath: path.join(outDir, "a.tar.gz") });
      const b = await packSource(root, { outPath: path.join(outDir, "b.tar.gz") });
      assert.ok(fs.readFileSync(a.path).equals(fs.readFileSync(b.path)));
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("produces an archive that the system tar can list", { skip: !hasTar && "tar not installed" }, async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "liara-pack-tar-"));
    try {
      const result = await packSource(root, { outPath: path.join(outDir, "src.tar.gz") });
      const listed = spawnSync("tar", ["-tzf", result.path], { encoding: "utf8" });
      assert.strictEqual(listed.status, 0, listed.stderr);
      const entries = listed.stdout.split("\n").filter(Boolean).map((l) => l.replace(/\/$/, ""));
      assert.ok(entries.includes("src/index.js"));
      assert.ok(entries.includes("package.json"));
      assert.ok(!entries.some((e) => e.includes("node_modules") || e.startsWith(".env")));
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("round-trips long paths through PAX headers", { skip: !hasTar && "tar not installed" }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "liara-pack-long-"));
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "liara-pack-long-out-"));
    try {
      const longName = "d".repeat(120) + ".txt";
      fs.writeFileSync(path.join(dir, longName), "long");
      const result = await packSource(dir, { outPath: path.join(outDir, "l.tar.gz") });
      const listed = spawnSync("tar", ["-tzf", result.path], { encoding: "utf8" });
      assert.strictEqual(listed.status, 0, listed.stderr);
      assert.strictEqual(listed.stdout.trim(), longName);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("rejects archives over the size limit with a human error", async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "liara-pack-big-"));
    try {
      await assert.rejects(
        packSource(root, { outPath: path.join(outDir, "x.tar.gz"), maxBytes: 16 }),
        (err) => {
          assert.ok(err instanceof PackError);
          assert.strictEqual(err.humanError.code, "PACK_TOO_LARGE");
          assert.ok(err.humanError.what_fa && err.humanError.why_fa && err.humanError.next_fa);
          return true;
        }
      );
      assert.deepStrictEqual(fs.readdirSync(outDir), []);
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });
});

describe("LiaraClient: deploy()", () => {
  let project;
  before(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), "liara-deploy-"));
    fs.writeFileSync(path.join(project, "index.js"), "console.log(1)");
  });
  after(() => {
    fs.rmSync(project, { recursive: true, force: true });
  });

  // Router for the release flow. `logs` is the scripted sequence of build-log responses.
  function deployFetch(logs) {
    let logCalls = 0;
    return fakeFetch((call) => {
      const { method, url } = call;
      if (method === "POST" && url === `${API}/v2/projects/app1/sources`) return json(200, { sourceID: "src-1" });
      if (method === "POST" && url === `${API}/v2/projects/app1/releases`) return json(200, { releaseID: "rel-1" });
      if (method === "GET" && url.startsWith(`${API}/v2/releases/rel-1/build-logs`)) {
        const step = logs[Math.min(logCalls, logs.length - 1)];
        logCalls += 1;
        return json(200, step);
      }
      return json(404, { message: "not found" });
    });
  }

  it("happy path: pack, upload, release, poll build logs until READY", async () => {
    const script = [
      { release: { state: "BUILDING" }, buildOutput: [{ stream: "STDOUT", line: "Step 1/3", createdAt: "2024-01-01T00:00:01Z" }] },
      { release: { state: "DEPLOYING" }, buildOutput: [] },
      { release: { state: "READY" }, buildOutput: [] },
    ];
    const f = deployFetch(script);
    const events = [];
    const result = await liveClient(f).deploy("app1", project, {
      port: 3000,
      platform: "node",
      pollIntervalMs: 0,
      onEvent: (e) => events.push(e),
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.releaseID, "rel-1");
    assert.strictEqual(result.state, "READY");
    assert.deepStrictEqual(
      events.map((e) => e.stage),
      ["pack", "pack", "upload", "release", "build", "release", "ready"]
    );
    assert.strictEqual(events.find((e) => e.stage === "build").line, "Step 1/3");
    for (const e of events) assert.strictEqual(typeof e.message_fa, "string");

    const releaseCall = f.calls.find((c) => c.url === `${API}/v2/projects/app1/releases`);
    assert.deepStrictEqual(JSON.parse(releaseCall.body), { sourceID: "src-1", port: 3000, type: "node" });

    const logCalls = f.calls.filter((c) => c.url.includes("/build-logs"));
    assert.strictEqual(logCalls.length, 3);
    assert.strictEqual(new URL(logCalls[1].url).searchParams.get("since"), "2024-01-01T00:00:01Z");
  });

  it("failure path: STDERR build output fails the deploy with BUILD_FAILED", async () => {
    const f = deployFetch([
      {
        release: { state: "BUILDING" },
        buildOutput: [{ stream: "STDERR", line: "npm ERR! missing script: build", createdAt: "t1" }],
      },
    ]);
    const events = [];
    const result = await liveClient(f).deploy("app1", project, {
      port: 3000,
      platform: "node",
      pollIntervalMs: 0,
      onEvent: (e) => events.push(e),
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.releaseID, "rel-1");
    assert.strictEqual(result.error.code, "BUILD_FAILED");
    assert.ok(result.error.why_fa.includes("missing script: build"));
    assert.strictEqual(events[events.length - 1].stage, "failed");
  });

  it("failure path: FAILED release state reports the fail reason", async () => {
    const f = deployFetch([{ release: { state: "FAILED", failReason: "disk_not_found data" }, buildOutput: [] }]);
    const result = await liveClient(f).deploy("app1", project, { port: 3000, platform: "node", pollIntervalMs: 0 });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.state, "FAILED");
    assert.strictEqual(result.error.code, "RELEASE_FAILED");
    assert.ok(result.error.why_fa.includes("disk_not_found"));
  });

  it("failure path: UNHEALTHY is reported as a failed deploy", async () => {
    const f = deployFetch([{ release: { state: "UNHEALTHY" }, buildOutput: [] }]);
    const result = await liveClient(f).deploy("app1", project, { port: 3000, platform: "node", pollIntervalMs: 0 });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error.code, "RELEASE_UNHEALTHY");
  });

  it("failure path: upload rejection stops before creating a release", async () => {
    const f = fakeFetch((call) => {
      if (call.url.endsWith("/sources")) return json(413, { message: "too big" });
      return json(500, {});
    });
    const events = [];
    const result = await liveClient(f).deploy("app1", project, {
      port: 3000,
      platform: "node",
      pollIntervalMs: 0,
      onEvent: (e) => events.push(e),
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error.code, "PAYLOAD_TOO_LARGE");
    assert.ok(!f.calls.some((c) => c.url.endsWith("/releases")));
    assert.strictEqual(events[events.length - 1].stage, "failed");
  });

  it("stops at the total deadline", async () => {
    const f = deployFetch([{ release: { state: "BUILDING" }, buildOutput: [] }]);
    const result = await liveClient(f).deploy("app1", project, {
      port: 3000,
      platform: "node",
      pollIntervalMs: 0,
      timeoutMs: 0,
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error.code, "DEPLOY_TIMEOUT");
  });
});

describe("LIARA_LIMITS", () => {
  it("lists the known API limits with the three human fields plus workaround", () => {
    assert.ok(Array.isArray(LIARA_LIMITS));
    assert.ok(LIARA_LIMITS.length >= 6);
    const ids = new Set();
    for (const item of LIARA_LIMITS) {
      for (const key of ["id", "what_fa", "why_fa", "workaround_fa"]) {
        assert.strictEqual(typeof item[key], "string");
        assert.ok(item[key].length > 0, `${item.id}.${key} must not be empty`);
      }
      ids.add(item.id);
    }
    assert.strictEqual(ids.size, LIARA_LIMITS.length);
    for (const topic of ["top_up_payment", "irnic_ns_change", "github_oauth_connect", "dedicated_rollback"]) {
      assert.ok(ids.has(topic), `missing limit ${topic}`);
    }
  });
});

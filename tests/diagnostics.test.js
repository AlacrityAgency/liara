const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  DiagnosticEngine,
  extractSignals,
  STANDARD_RUNBOOKS,
  symptomMatch,
  takeSnapshot,
  verify,
  failingPathsFromEvidence,
  fixBriefToMarkdown,
  createFixBrief,
  isMitigationOnlyRemediation,
} = require("../build/diagnostics/src/index.js");

// ---------- helpers ----------

const T0 = Date.parse("2026-10-22T14:00:00Z");
const at = (min, sec = 0) => new Date(T0 + min * 60000 + sec * 1000).toISOString();

let logSeq = 0;
const L = (min, text, sec = 0) => ({ id: `log_${++logSeq}`, ts: at(min, sec), text });
const P = (min, path, status, ms = 120, sec = 0) => ({
  id: `probe_${++logSeq}`,
  ts: at(min, sec),
  path,
  status,
  ms,
});

/** Full evidence object with every collector present (empty arrays, never null, unless a test says so). */
function ev(over = {}) {
  return {
    app: { name: "chaos-shop", port: 3000, envKeys: [], scale: 1, memoryLimitMB: 512 },
    applets: [{ state: "running", restarts: 0 }],
    events: [],
    releases: [],
    memory: [],
    cpu: [],
    logs: [],
    probes: [],
    db: null,
    window: { start: at(0), end: at(30) },
    ...over,
  };
}

const memSeries = (values, stepMin = 2, startMin = 0) =>
  values.map((mb, i) => ({ ts: at(startMin + i * stepMin), mb }));

const SYMPTOM = "خطای ۵۰۰ در سایت";

// ---------- golden set (top-1 hypothesis) ----------

const GOLDEN = [
  {
    name: "Node Prisma: DATABASE_URL missing after a release",
    expected: "missing_env",
    evidence: ev({
      releases: [{ id: "rel_8f2", state: "READY", createdAt: at(-1), finishedAt: at(0, 30), source: "liara" }],
      logs: [
        L(1, "Error: PrismaClientInitializationError: Environment variable not found: DATABASE_URL", 5),
        L(1, "    at Object.getItems (src/routes/items.js:42:15)", 5),
      ],
      probes: [P(1, "/api/items", 500, 120, 10)],
    }),
  },
  {
    name: "Django: connection refused to postgres on 5432",
    expected: "db_unreachable",
    evidence: ev({
      logs: [
        L(2, "Traceback (most recent call last):"),
        L(2, '  File "/app/shop/views.py", line 42, in items'),
        L(2, '  File "/app/.venv/lib/python3.12/site-packages/django/db/backends/base/base.py", line 275, in ensure_connection'),
        L(2, 'django.db.utils.OperationalError: connection to server at "db" (172.18.0.2), port 5432 failed: Connection refused', 1),
      ],
      probes: [P(2, "/shop/items", 500)],
    }),
  },
  {
    name: "Python psycopg2: could not connect to server (no port in the line)",
    expected: "db_unreachable",
    evidence: ev({
      logs: [
        L(3, "psycopg2.OperationalError: could not connect to server: Connection refused"),
        L(3, 'Is the server running on host "postgres" and accepting TCP/IP connections?'),
      ],
      probes: [P(3, "/orders", 500)],
    }),
  },
  {
    name: "Postgres: remaining connection slots exhausted",
    expected: "db_pool",
    evidence: ev({
      logs: [1, 2, 3, 4].map((i) =>
        L(4, "FATAL: remaining connection slots are reserved for non-replication superuser connections", i)
      ),
      probes: [P(4, "/api/items", 500)],
    }),
  },
  {
    name: "Prisma pool: timed out fetching a new connection",
    expected: "db_pool",
    evidence: ev({
      logs: [1, 2, 3, 4, 5].map((i) =>
        L(5, "PrismaClientKnownRequestError: Timed out fetching a new connection from the connection pool", i)
      ),
      probes: [P(5, "/api/items", 500)],
    }),
  },
  {
    name: "Redis ETIMEDOUT on 6379 is a cache failure, not a database failure",
    expected: "cache_unreachable",
    evidence: ev({
      logs: [
        L(6, "Error: connect ETIMEDOUT 10.0.0.7:6379", 3),
        L(6, "    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1606:16)", 3),
        L(6, "[ioredis] Unhandled error event: Error: connect ETIMEDOUT", 4),
      ],
      probes: [P(6, "/api/items", 500)],
    }),
  },
  {
    name: "ENOSPC: disk full while writing",
    expected: "disk_full",
    evidence: ev({
      disk: { usedPct: 100 },
      logs: [
        L(7, "Error: ENOSPC: no space left on device, write", 2),
        L(7, "    at Object.writeSync (node:fs:900:3)", 2),
        L(7, "    at Logger.write (src/logger.js:18:9)", 2),
      ],
      probes: [P(7, "/api/items", 500)],
    }),
  },
  {
    name: "Linear memory growth without OOM",
    expected: "leak_no_oom",
    evidence: ev({
      memory: memSeries([150, 162, 174, 186, 198, 210, 222, 234, 246, 258, 270, 282]),
      window: { start: at(0), end: at(22) },
    }),
  },
  {
    name: "OOM with flat memory near the limit (plan too small)",
    expected: "undersized_plan",
    evidence: ev({
      applets: [{ state: "stopped", reason: "OOMKilled", restarts: 1 }],
      memory: memSeries([488, 492, 495, 490, 493, 491, 494, 489, 492, 496, 490, 493]),
      window: { start: at(0), end: at(22) },
    }),
  },
  {
    name: "OOM together with a linear leak",
    expected: "oom_leak",
    evidence: ev({
      applets: [{ state: "stopped", reason: "OOMKilled", restarts: 2 }],
      memory: memSeries([200, 225, 250, 275, 300, 325, 350, 375, 400, 425, 450, 475]),
      window: { start: at(0), end: at(22) },
    }),
  },
  {
    name: "CPU pinned at 97 percent",
    expected: "cpu_saturation",
    evidence: ev({
      cpu: [97, 98, 96, 99, 97, 98].map((pct, i) => ({ ts: at(i), pct })),
      memory: memSeries([120, 121, 120, 122, 121, 120]),
      probes: [P(3, "/api/report", 200, 900)],
    }),
  },
  {
    name: "Crash loop: container restarted repeatedly on boot",
    expected: "crash_loop",
    evidence: ev({
      applets: [{ state: "stopped", reason: "Error", restarts: 6 }],
      events: [
        { id: "e1", ts: at(1), type: "restart", message: "Container restarted (exit code 1)" },
        { id: "e2", ts: at(4), type: "restart", message: "Container restarted (exit code 1)" },
        { id: "e3", ts: at(7), type: "restart", message: "Container restarted (exit code 1)" },
      ],
      logs: [
        L(1, "Error: Cannot find module 'express'", 2),
        L(1, "    at Module._resolveFilename (node:internal/modules/cjs/loader:1228:15)", 2),
        L(1, "    at Object.<anonymous> (/app/server.js:3:15)", 2),
      ],
    }),
  },
  {
    name: "Port mismatch: app listens on 3100, platform expects 3000",
    expected: "port_mismatch",
    evidence: ev({
      releases: [{ id: "rel_c1", state: "UNHEALTHY", createdAt: at(0), source: "liara" }],
      logs: [L(0, "App listening on port 3100", 20)],
      probes: [P(1, "/", 502)],
    }),
  },
  {
    name: "Application stopped (scale 0)",
    expected: "app_stopped",
    evidence: ev({
      app: { name: "chaos-shop", port: 3000, envKeys: [], scale: 0, memoryLimitMB: 512 },
      applets: [],
    }),
  },
  {
    name: "Slow external payment API",
    expected: "upstream_slow",
    evidence: ev({
      cpu: [15, 16, 14, 15].map((pct, i) => ({ ts: at(i), pct })),
      memory: memSeries([120, 121, 120, 122]),
      logs: [
        L(2, "Error: upstream request timeout to https://api.payments.example.ir/verify", 1),
        L(3, "Error: upstream request timeout to https://api.payments.example.ir/verify", 1),
      ],
      probes: [P(2, "/api/checkout", 200, 6500), P(3, "/api/checkout", 200, 6900)],
    }),
  },
  {
    name: "Laravel: SQLSTATE 2002 connection refused",
    expected: "db_unreachable",
    evidence: ev({
      logs: [
        L(2, "[2026-10-22 14:02:11] local.ERROR: SQLSTATE[HY000] [2002] Connection refused (SQL: select * from `items`)"),
      ],
      probes: [P(2, "/api/items", 500)],
    }),
  },
  {
    name: "Go: panic index out of range in handlers/items.go",
    expected: "code_exception",
    evidence: ev({
      logs: [
        L(2, "panic: runtime error: index out of range [3] with length 3"),
        L(2, ""),
        L(2, "goroutine 1 [running]:"),
        L(2, "main.getItems(0xc000010000)"),
        L(2, "\t/app/handlers/items.go:42 +0x1c"),
      ],
      probes: [P(2, "/api/items", 500)],
    }),
  },
  {
    name: "Deploy regression: TypeError starts 1.5 minutes after a Liara release",
    expected: "deploy_regression",
    evidence: ev({
      releases: [{ id: "rel_9", state: "READY", createdAt: at(-1), finishedAt: at(0, 30), source: "liara" }],
      logs: [1, 2, 3, 4, 5, 6, 7, 8].flatMap((i) => [
        L(2, "TypeError: Cannot read properties of undefined (reading 'map')", i),
        L(2, "    at Object.getItems (src/routes/items.js:42:15)", i),
      ]),
      probes: [P(2, "/api/items", 500)],
    }),
  },
  {
    name: "Python KeyError on a missing setting",
    expected: "missing_env",
    evidence: ev({
      logs: [L(1, "KeyError: 'STRIPE_KEY'"), L(1, '  File "/app/shop/pay.py", line 9, in charge')],
      probes: [P(1, "/pay", 500)],
    }),
  },
];

describe("Golden set: top-1 hypothesis (WHITEPAPER §8.4, EVALUATION M6/M7)", () => {
  for (const g of GOLDEN) {
    it(g.name, () => {
      const incident = DiagnosticEngine.diagnose(g.evidence, SYMPTOM);
      assert.ok(incident.hypotheses.length > 0, "at least one hypothesis");
      assert.strictEqual(incident.hypotheses[0].id, `hyp_${g.expected}`,
        `top-1 was ${incident.hypotheses[0].id}; all: ${incident.hypotheses.map((h) => `${h.id}=${h.score}`).join(", ")}`);
    });
  }

  it("Python, Laravel and Go errors each produce an APP_EXCEPTION cluster", () => {
    const byName = (name) => GOLDEN.find((g) => g.name.startsWith(name)).evidence;
    for (const name of ["Django", "Laravel", "Go:"]) {
      const { signals } = extractSignals(byName(name));
      assert.ok(signals.some((s) => s.kind === "APP_EXCEPTION"), `${name} has APP_EXCEPTION`);
    }
  });

  it("keeps the golden set at 15 or more samples", () => {
    assert.ok(GOLDEN.length >= 15, `have ${GOLDEN.length}`);
  });

  it("every signal strength is within 0..1", () => {
    for (const g of GOLDEN) {
      const { signals } = extractSignals(g.evidence);
      for (const s of signals) {
        assert.ok(s.strength >= 0 && s.strength <= 1, `${g.name}: ${s.kind} strength ${s.strength}`);
      }
    }
  });
});

// ---------- signals ----------

describe("Signals (WHITEPAPER §8.3)", () => {
  it("DB_UNREACHABLE does not fire on Redis lines", () => {
    const { signals } = extractSignals(ev({
      logs: [L(1, "Error: connect ETIMEDOUT 10.0.0.7:6379")],
    }));
    assert.ok(!signals.some((s) => s.kind === "DB_UNREACHABLE"));
    assert.ok(signals.some((s) => s.kind === "CACHE_UNREACHABLE"));
  });

  it("DB_UNREACHABLE does not fire on a generic ECONNREFUSED to a non-DB port", () => {
    const { signals } = extractSignals(ev({
      logs: [L(1, "Error: connect ECONNREFUSED 10.0.0.9:8080")],
    }));
    assert.ok(!signals.some((s) => s.kind === "DB_UNREACHABLE"));
  });

  it("pool exhaustion lines are DB_POOL_EXHAUSTED, not DB_UNREACHABLE", () => {
    const { signals } = extractSignals(ev({
      logs: [L(1, "too many connections for role \"app\"", 1), L(1, "Timed out fetching a new connection from the connection pool", 2)],
    }));
    assert.ok(signals.some((s) => s.kind === "DB_POOL_EXHAUSTED"));
    assert.ok(!signals.some((s) => s.kind === "DB_UNREACHABLE"));
  });

  it("DEPLOY_REGRESSION needs a trusted release (source liara or local)", () => {
    const logs = [L(2, "TypeError: boom", 0)];
    const release = { id: "rel_1", state: "READY", createdAt: at(-1), finishedAt: at(1, 50) };
    const untrusted = extractSignals(ev({ releases: [release], logs, probes: [P(2, "/", 500)] }));
    assert.ok(!untrusted.signals.some((s) => s.kind === "DEPLOY_REGRESSION"), "unknown source must not fire");

    const trusted = extractSignals(ev({ releases: [{ ...release, source: "local" }], logs, probes: [P(2, "/", 500)] }));
    assert.ok(trusted.signals.some((s) => s.kind === "DEPLOY_REGRESSION"));
  });

  it("DEPLOY_REGRESSION does not fire without errors", () => {
    const { signals } = extractSignals(ev({
      releases: [{ id: "rel_1", state: "READY", createdAt: at(-1), finishedAt: at(1), source: "liara" }],
      probes: [P(2, "/", 200)],
    }));
    assert.ok(!signals.some((s) => s.kind === "DEPLOY_REGRESSION"));
  });

  it("DEPLOY_REGRESSION does not fire when errors start more than 10 minutes after the release", () => {
    const { signals } = extractSignals(ev({
      releases: [{ id: "rel_1", state: "READY", createdAt: at(-1), finishedAt: at(0), source: "liara" }],
      logs: [L(15, "TypeError: late", 0)],
    }));
    assert.ok(!signals.some((s) => s.kind === "DEPLOY_REGRESSION"));
  });

  it("DEPLOY_REGRESSION does not fire for the synthetic release used by the demo server", () => {
    const { signals } = extractSignals(ev({
      releases: [{ id: "rel_current", state: "READY", createdAt: at(-5), finishedAt: at(-3) }],
      logs: [L(-1, "TypeError: boom")],
    }));
    assert.ok(!signals.some((s) => s.kind === "DEPLOY_REGRESSION"));
  });

  it("CRASH_LOOP counts restart events inside the window", () => {
    const { signals } = extractSignals(ev({
      events: [
        { id: "e1", ts: at(0), type: "restart", message: "restarted" },
        { id: "e2", ts: at(3), type: "restart", message: "restarted" },
        { id: "e3", ts: at(6), type: "restart", message: "restarted" },
      ],
    }));
    assert.ok(signals.some((s) => s.kind === "CRASH_LOOP"));
  });

  it("MEMORY_LEAK_TREND carries a minutes-to-limit estimate from the slope", () => {
    const { signals } = extractSignals(ev({
      memory: memSeries([150, 162, 174, 186, 198, 210, 222, 234, 246, 258, 270, 282]),
    }));
    const leak = signals.find((s) => s.kind === "MEMORY_LEAK_TREND");
    assert.ok(leak, "leak signal");
    assert.ok(Math.abs(leak.data.slopeMBPerMin - 6) < 0.05, `slope ${leak.data.slopeMBPerMin}`);
    assert.ok(Math.abs(leak.data.minutesToLimit - 38) <= 1, `minutesToLimit ${leak.data.minutesToLimit}`);
  });

  it("Python traceback with a dotted exception name becomes an APP_EXCEPTION cluster", () => {
    const { signals } = extractSignals(ev({
      logs: [
        L(1, "Traceback (most recent call last):"),
        L(1, '  File "/app/shop/views.py", line 42, in items'),
        L(1, "django.db.utils.OperationalError: boom"),
      ],
    }));
    assert.ok(signals.some((s) => s.kind === "APP_EXCEPTION"));
  });
});

// ---------- scoring ----------

describe("Scoring (WHITEPAPER §8.4)", () => {
  it("returns at most 3 hypotheses, sorted by score", () => {
    const incident = DiagnosticEngine.diagnose(GOLDEN[0].evidence, SYMPTOM);
    assert.ok(incident.hypotheses.length <= 3);
    for (let i = 1; i < incident.hypotheses.length; i++) {
      assert.ok(incident.hypotheses[i - 1].score >= incident.hypotheses[i].score);
    }
  });

  it("does not put runbooks with missing required signals in rejected", () => {
    const incident = DiagnosticEngine.diagnose(GOLDEN[8].evidence, SYMPTOM); // leak without OOM
    assert.deepStrictEqual(incident.rejected, []);
  });

  it("rejected lists a runbook only when contradicting evidence drives its score below 0.5", () => {
    const { scoreRunbook } = require("../build/diagnostics/src/index.js");
    const rb = STANDARD_RUNBOOKS.find((r) => r.id === "upstream_slow");
    const byKind = new Map([
      ["UPSTREAM_SLOW", { kind: "UPSTREAM_SLOW", firstSeen: at(0), detail_fa: "", evidence: ["ev_1"], strength: 0.6 }],
      ["CPU_SATURATION", { kind: "CPU_SATURATION", firstSeen: at(0), detail_fa: "", evidence: ["ev_2"], strength: 1 }],
      ["MEMORY_PRESSURE", { kind: "MEMORY_PRESSURE", firstSeen: at(0), detail_fa: "", evidence: ["ev_3"], strength: 1 }],
    ]);
    const scored = scoreRunbook(rb, byKind, { userText: "", missingEvidence: [] });
    assert.strictEqual(scored.applicable, true);
    assert.strictEqual(scored.rejected, true);
    assert.ok(scored.score < 0.5);

    // Without the contradicting signals the same runbook is not rejected.
    const clean = scoreRunbook(rb, new Map([["UPSTREAM_SLOW", byKind.get("UPSTREAM_SLOW")]]), { userText: "", missingEvidence: [] });
    assert.strictEqual(clean.rejected, false);
  });

  it("a runbook with a missing required signal is not applicable and not rejected", () => {
    const { scoreRunbook } = require("../build/diagnostics/src/index.js");
    const rb = STANDARD_RUNBOOKS.find((r) => r.id === "db_unreachable");
    const scored = scoreRunbook(rb, new Map(), { userText: "", missingEvidence: [] });
    assert.strictEqual(scored.applicable, false);
    assert.strictEqual(scored.rejected, false);
  });

  it("fills evidence_against when a contradicting signal is present", () => {
    // Linear leak plus OOM: leak_no_oom is contradicted by OOM, oom_leak is supported.
    const incident = DiagnosticEngine.diagnose(GOLDEN[9].evidence, SYMPTOM);
    const leakNoOom = incident.hypotheses.find((h) => h.id === "hyp_leak_no_oom");
    assert.ok(leakNoOom, "leak_no_oom is still listed");
    assert.ok(leakNoOom.evidence_against.length > 0);
  });

  it("confidence follows score: high >= 0.8, medium >= 0.5, else low", () => {
    const incident = DiagnosticEngine.diagnose(GOLDEN[0].evidence, SYMPTOM);
    const top = incident.hypotheses[0];
    assert.strictEqual(top.confidence, "high");
    assert.ok(top.score >= 0.8);
  });

  it("caps confidence at medium when a collector the runbook depends on failed", () => {
    // Applets collector failed (null). The OOM is visible only in the logs.
    const incident = DiagnosticEngine.diagnose(
      ev({
        applets: null,
        memory: memSeries([488, 492, 495, 490, 493, 491, 494, 489, 492, 496, 490, 493]),
        logs: [L(3, "FATAL ERROR: Reached heap limit. JavaScript heap out of memory", 0)],
      }),
      SYMPTOM
    );
    const top = incident.hypotheses.find((h) => h.id === "hyp_undersized_plan");
    assert.ok(top, "undersized_plan listed");
    assert.strictEqual(top.confidence, "medium");
    assert.ok(top.missingEvidence.includes("applets_get"));
    assert.ok(incident.missingEvidence.includes("applets_get"));
  });

  it("symptomMatch reads Persian and English keywords, with Persian digits", () => {
    const cpu = STANDARD_RUNBOOKS.find((r) => r.id === "cpu_saturation");
    assert.ok(symptomMatch(cpu, "سایتم کند شده") > 0);
    assert.ok(symptomMatch(cpu, "site is slow") > 0);
    const missing = STANDARD_RUNBOOKS.find((r) => r.id === "missing_env");
    assert.ok(symptomMatch(missing, "خطای ۵۰۰") > 0);
    assert.ok(symptomMatch(missing, "error 500") > 0);
  });

  it("symptomMatch does not match a short keyword inside another word", () => {
    const mem = STANDARD_RUNBOOKS.find((r) => r.id === "undersized_plan");
    assert.strictEqual(symptomMatch(mem, "رمزم فراموش شده"), 0);
    assert.ok(symptomMatch(mem, "رم سرور پر است") > 0);
  });
});

// ---------- verifier ----------

describe("Verifier (WHITEPAPER §8.6)", () => {
  const before = takeSnapshot(
    ev({
      window: { start: at(0), end: at(2) },
      logs: Array.from({ length: 24 }, (_, i) => L(1, "TypeError: Cannot read properties of undefined", i)),
      probes: [P(1, "/api/items", 500, 80)],
    }),
    ["/api/items"]
  );

  it("passes when the failing path returns 2xx and the error rate drops to zero", () => {
    const after = takeSnapshot(
      ev({
        window: { start: at(3), end: at(5) },
        probes: [P(5, "/api/items", 200, 95)],
      }),
      ["/api/items"]
    );
    const result = verify(before, after, [
      { kind: "probe_ok", path: "/api/items" },
      { kind: "error_rate_below", perMin: 1 },
    ]);
    assert.strictEqual(result.passed, true);
    assert.ok(result.summary_fa.includes("نرخ خطا از ۱۲ در دقیقه به ۰ رسید"), result.summary_fa);
    assert.ok(result.summary_fa.includes("/api/items پاسخ ۲۰۰"), result.summary_fa);
  });

  it("fails when the failing path still returns 500, and says so in Persian", () => {
    const after = takeSnapshot(
      ev({
        window: { start: at(3), end: at(5) },
        logs: [L(4, "TypeError: still broken", 1)],
        probes: [P(5, "/api/items", 500, 90)],
      }),
      ["/api/items"]
    );
    const result = verify(before, after, [{ kind: "probe_ok", path: "/api/items" }]);
    assert.strictEqual(result.passed, false);
    assert.ok(result.checks[0].detail_fa.includes("۵۰۰"));
    assert.ok(result.summary_fa.startsWith("راستی‌آزمایی ناموفق"));
  });

  it("fails a probe criterion when the path was never probed (no false success)", () => {
    const after = takeSnapshot(ev({ window: { start: at(3), end: at(5) } }), ["/api/items"]);
    const result = verify(after, after, [{ kind: "probe_ok", path: "/api/items" }]);
    assert.strictEqual(result.passed, false);
  });

  it("fails when no success criteria are given", () => {
    const result = verify(before, before, []);
    assert.strictEqual(result.passed, false);
  });

  it("checks memory and applets from the after snapshot", () => {
    const after = takeSnapshot(
      ev({
        memory: memSeries([300, 310, 305]),
        applets: [{ state: "running", restarts: 0 }],
      })
    );
    const ok = verify(before, after, [
      { kind: "mem_below_pct", pct: 80 },
      { kind: "applets_running" },
      { kind: "restarts_stable" },
    ]);
    assert.strictEqual(ok.passed, true);
    const tight = verify(before, after, [{ kind: "mem_below_pct", pct: 50 }]);
    assert.strictEqual(tight.passed, false);
  });

  it("no_error_signature passes only when the signature is gone from the after window", () => {
    const beforeDb = takeSnapshot(ev({ logs: [L(1, "PrismaClientInitializationError: boom")] }));
    const stillThere = takeSnapshot(ev({ logs: [L(1, "PrismaClientInitializationError: boom again")] }));
    const gone = takeSnapshot(ev({ logs: [] }));
    assert.strictEqual(verify(beforeDb, stillThere, [{ kind: "no_error_signature", signature: "PrismaClientInitializationError" }]).passed, false);
    assert.strictEqual(verify(beforeDb, gone, [{ kind: "no_error_signature", signature: "PrismaClientInitializationError" }]).passed, true);
  });

  it("failingPathsFromEvidence extracts access-log and probe paths and puts /health last", () => {
    const data = ev({
      logs: [
        L(1, '10.0.0.2 - - "GET /api/items HTTP/1.1" 500 123'),
        L(1, "[GIN] 2026/10/22 - 14:01:00 | 500 |  1.2ms | 10.0.0.2 | GET \"/api/orders?id=3\""),
      ],
      probes: [P(1, "/health", 200), P(1, "/api/items", 500)],
    });
    const paths = failingPathsFromEvidence(data);
    assert.strictEqual(paths[0], "/api/items");
    assert.ok(paths.includes("/api/orders"));
    // A healthy /health is not a failing path, so the verifier does not probe it.
    assert.ok(!paths.includes("/health"));

    // When /health also fails, it is listed last: the feature route is the first thing to check.
    const withFailingHealth = failingPathsFromEvidence(ev({
      probes: [P(1, "/health", 500), P(1, "/api/items", 500)],
    }));
    assert.deepStrictEqual(withFailingHealth, ["/api/items", "/health"]);
  });
});

// ---------- fix brief ----------

describe("Fix Brief (WHITEPAPER §9.2)", () => {
  it("fills every §9.2 field for a missing-env incident", () => {
    const data = GOLDEN[0].evidence;
    const incident = DiagnosticEngine.diagnose(data, SYMPTOM);
    const brief = DiagnosticEngine.createFixBrief(incident, data);
    assert.strictEqual(brief.incident_id, incident.id);
    assert.ok(brief.summary_fa && brief.summary_fa.length > 0);
    assert.ok(brief.summary_en && brief.summary_en.length > 0);
    assert.strictEqual(brief.probable_cause.title, incident.hypotheses[0].title_fa);
    assert.ok(brief.reproduction.startsWith("curl -i https://chaos-shop.liara.run/api/items"), brief.reproduction);
    assert.ok(brief.acceptance.length >= 1);
    assert.ok(brief.acceptance.some((a) => a.test.includes("/api/items")));
    assert.strictEqual(brief.deploy_back, "sokan_deploy");
    assert.ok(brief.suggested_change.includes("متغیر"));
    assert.deepStrictEqual(brief.suspected_locations[0], { file: "src/routes/items.js", line: 42, frame: "src/routes/items.js:42" });
  });

  it("runs excerpts through the redact callback", () => {
    const data = ev({
      logs: [
        L(1, "Error: connect ECONNREFUSED postgres://admin:superSecret123@db:5432/main", 1),
        L(1, "    at Object.run (src/db/client.js:24:11)", 1),
      ],
      probes: [P(1, "/api/items", 500)],
    });
    const incident = DiagnosticEngine.diagnose(data, SYMPTOM);
    const brief = createFixBrief(incident, data, (t) => t.replace(/superSecret\d+/g, "[REDACTED]"));
    const all = JSON.stringify(brief);
    assert.ok(!all.includes("superSecret123"));
    assert.ok(all.includes("[REDACTED]"));
  });

  it("suspected locations skip node_modules frames and EADDRINUSE noise", () => {
    const data = ev({
      logs: [
        L(1, "Error: listen EADDRINUSE: address already in use :::3000", 1),
        L(1, "    at Server.setupListenHandle [as _listen2] (node:net:1940:16)", 1),
        L(2, "TypeError: x is undefined", 1),
        L(2, "    at handler (/app/node_modules/express/lib/router.js:10:5)", 1),
        L(2, "    at handler2 (/app/src/routes/items.js:42:15)", 1),
      ],
    });
    const incident = DiagnosticEngine.diagnose(data, SYMPTOM);
    const brief = DiagnosticEngine.createFixBrief(incident, data);
    const files = brief.suspected_locations.map((l) => l.file);
    assert.ok(files.includes("src/routes/items.js"));
    assert.ok(!files.some((f) => f.includes("node_modules") || f.startsWith("node:")), files.join(","));
    assert.ok(!brief.suspected_locations.some((l) => l.file.includes("net")));
  });

  it("fixBriefToMarkdown renders the sections a Coding Agent needs", () => {
    const data = GOLDEN[0].evidence;
    const incident = DiagnosticEngine.diagnose(data, SYMPTOM);
    const md = fixBriefToMarkdown(DiagnosticEngine.createFixBrief(incident, data));
    assert.ok(md.startsWith("# Fix Brief"));
    assert.ok(md.includes("## Acceptance"));
    assert.ok(md.includes("curl -i https://chaos-shop.liara.run/api/items"));
    assert.ok(md.includes("sokan_deploy"));
  });

  it("gives each runbook its own suggested change text", () => {
    const texts = new Set(STANDARD_RUNBOOKS.map((r) => r.suggested_change_fa));
    assert.strictEqual(texts.size, STANDARD_RUNBOOKS.length);
  });
});

// ---------- runbook catalog ----------

describe("Runbook catalog (WHITEPAPER §8.5)", () => {
  const { riskOf, TOOL_RISK } = require("../build/policy/src/index.js");
  const REQUIRED = [
    "missing_env", "deploy_regression", "oom_leak", "leak_no_oom", "undersized_plan", "cpu_saturation",
    "port_mismatch", "db_unreachable", "db_pool", "cache_unreachable", "disk_full", "upstream_slow",
    "crash_loop", "app_stopped",
  ];

  it("has every runbook from the §8.5 table", () => {
    const ids = STANDARD_RUNBOOKS.map((r) => r.id);
    for (const id of REQUIRED) assert.ok(ids.includes(id), `missing ${id}`);
  });

  it("every remediation uses a policy tool name (or the handoff) and a machine-checkable criterion", () => {
    for (const rb of STANDARD_RUNBOOKS) {
      assert.ok(rb.remediations.length > 0, `${rb.id} has remediations`);
      for (const r of rb.remediations) {
        if (r.tool !== "coding_agent_handoff") {
          assert.ok(Object.prototype.hasOwnProperty.call(TOOL_RISK, r.tool), `${rb.id}: ${r.tool} not in TOOL_RISK`);
          assert.strictEqual(riskOf(r.tool, r.params_template), r.risk, `${rb.id}: risk of ${r.tool}`);
        }
        assert.ok(r.successCriteria && typeof r.successCriteria.kind === "string", `${rb.id}: criterion`);
      }
    }
  });

  it("oom_leak needs both OOM and leak, and leak_no_oom is contradicted by OOM", () => {
    const oom = STANDARD_RUNBOOKS.find((r) => r.id === "oom_leak");
    assert.deepStrictEqual(oom.requiredSignals.sort(), ["MEMORY_LEAK_TREND", "OOM_KILLED"]);
    const leak = STANDARD_RUNBOOKS.find((r) => r.id === "leak_no_oom");
    assert.ok(leak.against.OOM_KILLED > 0);
  });

  it("probe criteria in a golden sample use the failing path, not /health", () => {
    const incident = DiagnosticEngine.diagnose(GOLDEN[0].evidence, SYMPTOM);
    const probeCriteria = incident.hypotheses[0].remediations
      .map((r) => r.successCriteria)
      .filter((c) => c && c.kind === "probe_ok");
    assert.ok(probeCriteria.length > 0);
    for (const c of probeCriteria) assert.strictEqual(c.path, "/api/items");
  });
});

// ---------- golden evidence from the simulated target (WEB scenario-3 leak and scenario-4 CPU) ----------
// The shapes below are what apps/web/lib/evidence.js produces for the chaos-shop child process.

const ramp = (startMb, stepMb, n, stepSec = 1, startMin = 0) =>
  Array.from({ length: n }, (_, i) => ({ ts: at(startMin, i * stepSec), mb: startMb + stepMb * i }));

const SIM_APP = { name: "chaos-shop", port: 3100, envKeys: ["DATABASE_URL", "CHAOS_LEAK", "CHAOS_MEM_LIMIT_MB"], scale: 1 };
const LOCAL_RELEASE = { id: "rel_9f3a1c", state: "READY", createdAt: at(-26), finishedAt: at(-25), source: "local" };

/** scenario-3: leak with a 120 MB container cap; the first container is OOM-killed after about ten seconds. */
function simOomLeakEvidence(over = {}) {
  return ev({
    app: { ...SIM_APP, memoryLimitMB: 120, memoryLimitLabel_fa: "سقف کانتینر آزمایشی" },
    applets: [{ state: "restarting", reason: "OOMKilled", restarts: 2, release: "rel_9f3a1c" }],
    events: [
      { id: "evt_1", ts: at(0, 0), type: "start", message: "process started pid=101 port=3100" },
      { id: "evt_2", ts: at(0, 10), type: "crash", message: "container exited unexpectedly: OOMKilled" },
      { id: "evt_3", ts: at(0, 12), type: "start", message: "process started pid=102 port=3100" },
      { id: "evt_4", ts: at(0, 22), type: "crash", message: "container exited unexpectedly: OOMKilled" },
    ],
    releases: [LOCAL_RELEASE],
    memory: ramp(46, 8, 11),
    cpu: [],
    logs: [
      L(0, "[mem] rss=46MB heap=5MB", 2),
      L(0, "[mem] rss=70MB heap=5MB", 4),
      L(0, "[mem] rss=94MB heap=5MB", 6),
      L(0, "[mem] rss=110MB heap=5MB", 8),
      L(0, "FATAL: Container memory limit exceeded (rss=124MB limit=120MB) — OOMKilled", 10),
      L(0, "[SOKAN_RUNNER] target process stopped: OOMKilled", 10),
    ],
    probes: [
      P(0, "/health", 200, 3, 1),
      P(0, "/health", 200, 3, 5),
      P(0, "/health", null, 3, 10),
      P(0, "/health", 200, 3, 16),
    ],
    window: { start: at(-1), end: at(0, 30) },
    ...over,
  });
}

/** scenario-4: sustained busy loop on /api/products; RSS stays flat; a few slow probes. */
function simCpuEvidence(over = {}) {
  return ev({
    app: { ...SIM_APP, memoryLimitMB: 512, memoryLimitLabel_fa: "سقف پلن", scale: 1 },
    applets: [{ state: "running", restarts: 0, release: "rel_9f3a1c" }],
    events: [{ id: "evt_1", ts: at(0, 0), type: "start", message: "process started pid=201 port=3100" }],
    releases: [LOCAL_RELEASE],
    memory: ramp(44, 0, 1).concat(ramp(45, 0.5, 6, 1, 0).map((p, i) => ({ ts: at(0, i + 1), mb: [45, 44, 46, 45, 45, 44][i] }))),
    cpu: [99, 100, 98, 100, 99, 100, 99, 100, 97].map((pct, i) => ({ ts: at(0, i + 1), pct })),
    logs: [
      L(0, "[CHAOS_CPU] busy loop 512ms on /api/products", 1),
      L(0, "[access] GET /api/products 200 812ms", 2),
      L(0, "prisma:query SELECT * FROM \"Review\" WHERE \"productId\" = 1 LIMIT 10", 2),
      L(0, "[CHAOS_CPU] busy loop 640ms on /api/products", 3),
      L(0, "[access] GET /api/products 200 1190ms", 4),
    ],
    probes: [
      P(0, "/health", 200, 4, 2),
      P(0, "/api/products", 200, 2500, 2),
      P(0, "/api/products", 200, 3100, 5),
      P(0, "/api/products", 200, 3900, 8),
    ],
    window: { start: at(-1), end: at(0, 30) },
    ...over,
  });
}

const STALE_EXCEPTION = [
  L(-20, "PrismaClientInitializationError: Environment variable not found: DATABASE_URL", 0),
  L(-20, "    at PrismaClient.initialize (src/db/client.js:24:11)", 0),
];

describe("Golden evidence from the simulated target: OOM and leak (scenario-3)", () => {
  it("OOM plus leak in the simulated shape gives oom_leak on top, with app_restart and a Fix Brief", () => {
    const incident = DiagnosticEngine.diagnose(simOomLeakEvidence(), SYMPTOM);
    assert.strictEqual(incident.hypotheses[0].id, "hyp_oom_leak",
      incident.hypotheses.map((h) => `${h.id}=${h.score}`).join(", "));
    assert.strictEqual(incident.hypotheses[0].confidence, "high");
    const kinds = incident.signals.map((s) => s.kind);
    assert.ok(kinds.includes("OOM_KILLED") && kinds.includes("MEMORY_LEAK_TREND") && kinds.includes("MEMORY_PRESSURE"));
    assert.ok(!kinds.includes("APP_STOPPED"), "a restarting container is not a stopped app");
    const actions = incident.hypotheses[0].remediations.map((r) => r.action);
    assert.deepStrictEqual(actions, ["app_restart", "coding_agent_handoff"]);
  });

  it("undersized_plan is listed with the leak trend as evidence against it", () => {
    const incident = DiagnosticEngine.diagnose(simOomLeakEvidence(), SYMPTOM);
    const undersized = incident.hypotheses.find((h) => h.id === "hyp_undersized_plan");
    assert.ok(undersized, "undersized_plan is still listed");
    assert.ok(undersized.evidence_against.length > 0, "evidence_against is filled");
    assert.ok(undersized.evidence_against.some((ref) => /positive linear trend/.test(
      incident.evidence.find((e) => e.id === ref)?.summary ?? ""
    )), "the contradicting evidence is the memory trend");
  });

  it("an OOM exit identified only by its event still produces OOM_KILLED", () => {
    const { signals } = extractSignals(ev({
      events: [{ id: "evt_1", ts: at(0, 10), type: "crash", message: "container exited unexpectedly: exit code 137" }],
    }));
    const oom = signals.find((s) => s.kind === "OOM_KILLED");
    assert.ok(oom, "exit code 137 is an OOM kill");
    assert.ok(oom.evidence.length >= 1);
  });

  it("a crash loop caused by OOM kills does not outrank oom_leak, even with a stale exception in the window", () => {
    const data = simOomLeakEvidence({
      applets: [{ state: "restarting", reason: "OOMKilled", restarts: 3, release: "rel_9f3a1c" }],
      logs: [...simOomLeakEvidence().logs, ...STALE_EXCEPTION],
    });
    const incident = DiagnosticEngine.diagnose(data, SYMPTOM);
    assert.ok(incident.signals.some((s) => s.kind === "CRASH_LOOP"), "the restarts are visible as a crash loop");
    assert.ok(incident.signals.some((s) => s.kind === "APP_EXCEPTION"), "the stale exception is visible");
    assert.strictEqual(incident.hypotheses[0].id, "hyp_oom_leak");
    const crash = incident.hypotheses.find((h) => h.id === "hyp_crash_loop");
    if (crash) assert.ok(crash.evidence_against.length > 0, "OOM is listed against crash_loop");
  });

  it("upstream_slow does not fire on slow probes that coincide with memory pressure and OOM", () => {
    const data = simOomLeakEvidence({
      probes: [
        P(0, "/api/products", 200, 6500, 1),
        P(0, "/api/products", 200, 6900, 3),
        P(0, "/health", null, 3, 10),
      ],
    });
    const incident = DiagnosticEngine.diagnose(data, SYMPTOM);
    assert.ok(!incident.signals.some((s) => s.kind === "UPSTREAM_SLOW"), "slow probes alone are not upstream evidence");
    assert.notStrictEqual(incident.hypotheses[0].id, "hyp_upstream_slow");
  });

  it("upstream_slow still fires when the timeouts are logged against an external host", () => {
    const data = simOomLeakEvidence({
      logs: [
        ...simOomLeakEvidence().logs,
        L(0, "upstream timeout after 2000ms: GET https://api.payment.example/v1/rates", 9),
      ],
    });
    const incident = DiagnosticEngine.diagnose(data, SYMPTOM);
    assert.ok(incident.signals.some((s) => s.kind === "UPSTREAM_SLOW"));
  });
});

describe("Golden evidence from the simulated target: CPU saturation (scenario-4)", () => {
  it("sustained CPU at ~100 percent gives cpu_saturation on top, with a resize card", () => {
    const incident = DiagnosticEngine.diagnose(simCpuEvidence(), "سایت خیلی کند شده");
    assert.strictEqual(incident.hypotheses[0].id, "hyp_cpu_saturation",
      incident.hypotheses.map((h) => `${h.id}=${h.score}`).join(", "));
    assert.strictEqual(incident.hypotheses[0].confidence, "high");
    assert.ok(incident.hypotheses[0].remediations.some((r) => r.action === "app_resize_plan"));
    assert.ok(!incident.signals.some((s) => s.kind === "MEMORY_LEAK_TREND"), "flat RSS is not a leak");
  });

  it("a single stale exception does not outrank saturated CPU, and is rejected by it", () => {
    const data = simCpuEvidence({ logs: [...simCpuEvidence().logs, ...STALE_EXCEPTION] });
    const incident = DiagnosticEngine.diagnose(data, "سایت خیلی کند شده");
    assert.strictEqual(incident.hypotheses[0].id, "hyp_cpu_saturation");
    assert.ok(!incident.hypotheses.some((h) => h.id === "hyp_code_exception"), "code_exception is not offered");
    const rejected = incident.rejected.find((r) => r.title_fa === STANDARD_RUNBOOKS.find((rb) => rb.id === "code_exception").title_fa);
    assert.ok(rejected, "code_exception is listed as rejected");
    assert.ok(rejected.reason_fa.includes("CPU_SATURATION"));
  });

  it("three busy samples in a long idle series do not count as saturation (p95 stays low)", () => {
    const pcts = Array.from({ length: 100 }, (_, i) => (i >= 97 ? 95 : 10));
    const { signals } = extractSignals(simCpuEvidence({ cpu: pcts.map((pct, i) => ({ ts: at(0, i), pct })) }));
    assert.ok(!signals.some((s) => s.kind === "CPU_SATURATION"));
    const busy = Array.from({ length: 100 }, (_, i) => (i >= 2 ? 95 : 10));
    const { signals: more } = extractSignals(simCpuEvidence({ cpu: busy.map((pct, i) => ({ ts: at(0, i), pct })) }));
    assert.ok(more.some((s) => s.kind === "CPU_SATURATION"), "a sustained run does");
  });
});

// ---------- round 2 (EVALUATION §5): ranking by directness, verification, new patterns ----------

const tops = (incident) => incident.hypotheses.map((h) => h.id);
const kindsOf = (incident) => incident.signals.map((s) => s.kind);
const upstreamLines = () => [
  L(0, "upstream timeout after 2000ms: GET https://api.payment.example/v1/rates", 30),
  L(0, "[access] GET /api/checkout 504 2001ms", 31),
];

describe("R4: a harness restart is not a release, and the release must bring the symptom in", () => {
  const restartRelease = { id: "rel_sim_restart", state: "READY", createdAt: at(-1), finishedAt: at(0, 10), source: "local", kind: "restart" };
  const sameRelease = { ...restartRelease, kind: undefined };

  it("upstream timeouts after a harness restart rank upstream_slow above deploy_regression", () => {
    const data = ev({
      releases: [restartRelease],
      logs: upstreamLines(),
      probes: [P(0, "/api/checkout", 504, 2100, 31)],
    });
    const incident = DiagnosticEngine.diagnose(data, "سایت خیلی کند شده");
    assert.ok(!kindsOf(incident).includes("DEPLOY_REGRESSION"), "a restart is not a release");
    assert.strictEqual(incident.hypotheses[0].id, "hyp_upstream_slow", tops(incident).join(", "));
  });

  it("without the restart mark the same timing is still a regression (the mark is what changes the answer)", () => {
    const data = ev({ releases: [sameRelease], logs: upstreamLines(), probes: [P(0, "/api/checkout", 504, 2100, 31)] });
    const incident = DiagnosticEngine.diagnose(data, "سایت خیلی کند شده");
    assert.ok(kindsOf(incident).includes("DEPLOY_REGRESSION"));
  });

  it("a restart never produces DEPLOY_REGRESSION, even with errors that follow it", () => {
    const { signals } = extractSignals(ev({ releases: [restartRelease], logs: [L(0, "Error: boom", 30)] }));
    assert.ok(!signals.some((s) => s.kind === "DEPLOY_REGRESSION"));
  });

  it("errors that were already there before the release are not the release's symptom", () => {
    const { signals } = extractSignals(ev({
      releases: [{ id: "rel_9", state: "READY", createdAt: at(-1), finishedAt: at(0, 10), source: "liara" }],
      logs: [L(-5, "Error: earlier failure", 0), L(0, "Error: boom", 30)],
    }));
    assert.ok(!signals.some((s) => s.kind === "DEPLOY_REGRESSION"), "errors before finishedAt rule the release out");
  });

  it("an incident whose only remediations are handoffs is diagnosed, never awaiting_approval without cards", () => {
    const incident = DiagnosticEngine.diagnose(ev({ logs: upstreamLines(), probes: [P(0, "/api/checkout", 504, 2100, 31)] }), "سایت خیلی کند شده");
    assert.strictEqual(incident.hypotheses[0].id, "hyp_upstream_slow");
    assert.strictEqual(incident.status, "diagnosed");
  });

  it("an incident with an L2 remediation is awaiting_approval", () => {
    const incident = DiagnosticEngine.diagnose(GOLDEN[0].evidence, SYMPTOM);
    assert.strictEqual(incident.status, "awaiting_approval");
  });
});

describe("R5: verification discriminates (port, leak, CPU under load)", () => {
  it("port_mismatch is verified by a public path that answers below 500, not by applets_running", () => {
    const rb = STANDARD_RUNBOOKS.find((r) => r.id === "port_mismatch");
    assert.deepStrictEqual(rb.remediations[0].successCriteria.kind, "probe_not_5xx");
    const before = takeSnapshot(ev({ probes: [P(0, "/", null, 3, 1)] }), ["/"]);
    const down = takeSnapshot(ev({ probes: [P(1, "/", 502, 3, 1)] }), ["/"]);
    const up404 = takeSnapshot(ev({ probes: [P(1, "/", 404, 3, 1)] }), ["/"]);
    const refused = takeSnapshot(ev({ probes: [P(1, "/", 0, 3, 1)] }), ["/"]);
    const criteria = [{ kind: "probe_not_5xx", path: "/" }];
    assert.strictEqual(verify(before, down, criteria).passed, false, "502 from the proxy is not success");
    assert.strictEqual(verify(before, refused, criteria).passed, false, "status 0 is not success");
    const ok = verify(before, up404, criteria);
    assert.strictEqual(ok.passed, true, "a 404 means the app answers");
    assert.strictEqual(ok.outcome, "resolved");
  });

  it("a restart for a leak is verified as mitigated, and the text points to the Fix Brief", () => {
    assert.strictEqual(isMitigationOnlyRemediation("oom_leak", "app_restart"), true);
    assert.strictEqual(isMitigationOnlyRemediation("leak_no_oom", "app_restart"), true);
    assert.strictEqual(isMitigationOnlyRemediation("port_mismatch", "app_update_port"), false);
    const snap = takeSnapshot(ev({ applets: [{ state: "running", restarts: 0 }] }));
    const result = verify(snap, snap, [{ kind: "restarts_stable" }], { mitigationOnly: true });
    assert.strictEqual(result.passed, true);
    assert.strictEqual(result.outcome, "mitigated");
    assert.ok(/Fix Brief/.test(result.summary_fa) && /کد/.test(result.summary_fa));
  });

  it("cpu_below_pct with underLoad fails on an idle sample and passes only when the sample was taken under load", () => {
    const rb = STANDARD_RUNBOOKS.find((r) => r.id === "cpu_saturation");
    const criterion = rb.remediations[0].successCriteria;
    assert.strictEqual(criterion.underLoad, true);
    const idle = ev({ cpu: Array.from({ length: 10 }, (_, i) => ({ ts: at(0, i), pct: 5 })) });
    const before = takeSnapshot(idle);
    assert.strictEqual(verify(before, takeSnapshot(idle), [criterion]).passed, false, "idle sample is not proof");
    assert.strictEqual(verify(before, takeSnapshot(idle, [], { underLoad: true }), [criterion]).passed, true);
  });
});

describe("R9: patterns and golden top hypotheses", () => {
  it("Java OutOfMemoryError (heap space and GC overhead phrasings) is OOM_KILLED", () => {
    for (const text of [
      "java.lang.OutOfMemoryError: Java heap space",
      "Exception in thread \"main\" java.lang.OutOfMemoryError: GC overhead limit exceeded",
    ]) {
      const { signals } = extractSignals(ev({ logs: [L(0, text, 5)] }));
      assert.ok(signals.some((s) => s.kind === "OOM_KILLED"), text);
    }
  });

  it("a bare Killed line and an exit code 137 are OOM_KILLED", () => {
    assert.ok(extractSignals(ev({ logs: [L(0, "Killed", 5)] })).signals.some((s) => s.kind === "OOM_KILLED"));
    assert.ok(extractSignals(ev({ logs: [L(0, "container exited with code 137", 5)] })).signals.some((s) => s.kind === "OOM_KILLED"));
  });

  it("nginx 502 (connect refused or upstream closed) is PROXY_UPSTREAM_DOWN and gives app_unreachable_proxy with a restart", () => {
    for (const text of [
      '2026/10/22 14:01:02 [error] 1#1: *5 connect() failed (111: Connection refused) while connecting to upstream, upstream: "http://127.0.0.1:3000/"',
      "2026/10/22 14:01:02 [error] 1#1: *6 upstream prematurely closed connection while reading response header from upstream",
    ]) {
      const incident = DiagnosticEngine.diagnose(ev({ logs: [L(0, text, 5)], probes: [P(0, "/", 502, 4, 6)] }), "سایت ۵۰۲ می‌دهد");
      assert.ok(kindsOf(incident).includes("PROXY_UPSTREAM_DOWN"), text);
      assert.strictEqual(incident.hypotheses[0].id, "hyp_app_unreachable_proxy", tops(incident).join(", "));
      assert.ok(incident.hypotheses[0].remediations.some((r) => r.action === "app_restart"));
      assert.ok(!kindsOf(incident).includes("UPSTREAM_SLOW"), "a proxy failure is not an upstream timeout");
    }
  });

  it("EADDRINUSE is PORT_CONFLICT and gives port_conflict on top", () => {
    const incident = DiagnosticEngine.diagnose(ev({
      logs: [L(0, "Error: listen EADDRINUSE: address already in use :::3000", 5)],
      probes: [P(0, "/", null, 3, 6)],
    }), "بالا نمیاد");
    assert.strictEqual(incident.hypotheses[0].id, "hyp_port_conflict", tops(incident).join(", "));
  });

  it("a certificate verification error is TLS_ERROR and gives tls_error on top, as a code handoff", () => {
    const incident = DiagnosticEngine.diagnose(ev({
      logs: [L(0, "Error: unable to verify the first certificate", 5)],
    }), "خطای https");
    assert.strictEqual(incident.hypotheses[0].id, "hyp_tls_error", tops(incident).join(", "));
    assert.deepStrictEqual(incident.hypotheses[0].remediations.map((r) => r.action), ["coding_agent_handoff"]);
  });

  it("a Python traceback ending in DoesNotExist (no 'Error' in the name) is APP_EXCEPTION", () => {
    const logs = [
      L(0, "Traceback (most recent call last):", 1),
      L(0, '  File "/app/shop/views.py", line 42, in item', 1),
      L(0, "app.models.DoesNotExist: Item matching query does not exist.", 2),
    ];
    const { signals } = extractSignals(ev({ logs }));
    const exc = signals.find((s) => s.kind === "APP_EXCEPTION");
    assert.ok(exc, "the exception is recognised");
    assert.ok(/DoesNotExist/.test(exc.detail_fa), "the detail names the exception");
  });

  it("'Cannot find module' and a Next.js module-not-found error are BUILD_ERROR with build_error on top", () => {
    const node = DiagnosticEngine.diagnose(ev({ logs: [L(0, "Error: Cannot find module 'express'", 5)] }), "دیپلوی خطا داد");
    assert.strictEqual(node.hypotheses[0].id, "hyp_build_error", tops(node).join(", "));
    const next = DiagnosticEngine.diagnose(ev({
      logs: [L(0, "Failed to compile.", 4), L(0, "Module not found: Can't resolve './components/Header'", 5)],
    }), "دیپلوی خطا داد");
    assert.strictEqual(next.hypotheses[0].id, "hyp_build_error", tops(next).join(", "));
    assert.strictEqual(next.status, "diagnosed", "a build error has only a code handoff");
  });

  it("an error with no matching runbook gives unclassified_errors (low confidence, Fix Brief attached), not nothing", () => {
    const incident = DiagnosticEngine.diagnose(ev({ logs: [L(0, "FATAL: widget registry corrupted (code W-17)", 5)] }), "خطا");
    assert.strictEqual(incident.hypotheses.length, 1);
    const h = incident.hypotheses[0];
    assert.strictEqual(h.id, "hyp_unclassified_errors");
    assert.strictEqual(h.confidence, "low");
    assert.ok(h.evidence_for.length > 0 && incident.evidence.some((e) => e.id === h.evidence_for[0]));
    assert.strictEqual(incident.status, "diagnosed");
    const brief = createFixBrief(incident, ev({ logs: [L(0, "FATAL: widget registry corrupted (code W-17)", 5)] }), (t) => t);
    assert.ok(brief.evidence.length > 0, "the Fix Brief carries the error excerpt");
  });
});

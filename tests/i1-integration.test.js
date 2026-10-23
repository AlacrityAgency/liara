"use strict";
// Cross-module checks: verifier outcomes (mitigated, probe_not_5xx, underLoad), release kinds, audit integrity in
// buildState, and one leak scenario driven through investigate -> approve -> executeApproved (EVALUATION R5).

const { describe, it } = require("node:test");
const assert = require("node:assert");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const diag = require("../build/diagnostics/src/index.js");
const { verify, takeSnapshot, isMitigationOnlyRemediation } = diag;

/**
 * Waits until the diagnosis on the live simulated target ranks oom_leak first. A fixed sleep was flaky under load:
 * before the leak trend and the OOM are both visible, the top hypothesis is another memory runbook (round 3 item 8).
 */
async function waitForLeakDiagnosis(core, timeoutMs) {
  const { collectEvidence } = require("../apps/web/lib/evidence.js");
  const deadline = Date.now() + timeoutMs;
  let top = null;
  for (;;) {
    const windowStart = new Date(Date.now() - 30 * 60000).toISOString();
    const data = await collectEvidence(core, { windowStart, probePaths: [] });
    top = diag.DiagnosticEngine.diagnose(data, "سایتم مشکل داره").hypotheses[0] || null;
    if (top && top.runbookId === "oom_leak") return top;
    if (Date.now() > deadline) throw new Error(`leak diagnosis not reached; top was ${top && top.runbookId}`);
    await core.sleep(1000);
  }
}

const WINDOW = { start: "2026-10-23T10:00:00.000Z", end: "2026-10-23T10:10:00.000Z" };
const evidence = (over = {}) => ({
  app: { name: "demo", port: 3000, envKeys: [], scale: 1, memoryLimitMB: 512 },
  applets: [{ state: "running", restarts: 0 }],
  events: [], releases: [], memory: null, cpu: null, logs: [], probes: [], db: null, window: WINDOW, ...over,
});
const probe = (path, status, ts = WINDOW.end) => ({ id: `p_${path}_${status}`, ts, path, status, ms: 12 });

describe("verifier outcomes used by the executor", () => {
  const before = takeSnapshot(evidence({ probes: [probe("/health", 200)] }), ["/health"]);
  const after = takeSnapshot(evidence({ probes: [probe("/health", 200)] }), ["/health"]);
  const criteria = [{ kind: "applets_running" }];

  it("passes as resolved, or as mitigated when the remediation only relieves the symptom", () => {
    assert.strictEqual(verify(before, after, criteria).outcome, "resolved");
    const mitigated = verify(before, after, criteria, { mitigationOnly: true });
    assert.strictEqual(mitigated.outcome, "mitigated");
    assert.strictEqual(mitigated.passed, true);
    assert.match(mitigated.summary_fa, /Fix Brief/);
  });

  it("a failed check is unresolved whatever the mitigation flag says", () => {
    const down = takeSnapshot(evidence({ applets: [{ state: "stopped", restarts: 0 }] }), ["/health"]);
    assert.strictEqual(verify(before, down, criteria, { mitigationOnly: true }).outcome, "unresolved");
  });

  it("only a leak remediation through app_restart is mitigation-only", () => {
    assert.strictEqual(isMitigationOnlyRemediation("oom_leak", "app_restart"), true);
    assert.strictEqual(isMitigationOnlyRemediation("leak_no_oom", "app_restart"), true);
    assert.strictEqual(isMitigationOnlyRemediation("oom_leak", "app_resize_plan"), false);
    assert.strictEqual(isMitigationOnlyRemediation("missing_env", "app_restart"), false);
    assert.strictEqual(isMitigationOnlyRemediation("undersized_plan", "app_restart"), true, "a log-only OOM restart is mitigation");
    assert.strictEqual(isMitigationOnlyRemediation("undersized_plan", "app_resize_plan"), false);
  });

  it("probe_not_5xx is healthy only on 2xx and 3xx, and 4xx counts only with allow4xx (round 3 item 4)", () => {
    const check = { kind: "probe_not_5xx", path: "/" };
    const snap = (status) => takeSnapshot(evidence({ probes: [probe("/", status)] }), ["/"]);
    assert.strictEqual(verify(snap(200), snap(200), [check]).passed, true);
    assert.strictEqual(verify(snap(502), snap(301), [check]).passed, true);
    assert.strictEqual(verify(snap(200), snap(404), [check]).passed, false, "a 404 is not healthy by default");
    assert.strictEqual(verify(snap(200), snap(502), [check]).passed, false);
    assert.strictEqual(verify(snap(200), snap(0), [check]).passed, false);
    assert.strictEqual(verify(snap(200), takeSnapshot(evidence(), ["/"]), [check]).passed, false);
    const allow = { ...check, allow4xx: true };
    assert.strictEqual(verify(snap(502), snap(404), [allow]).passed, true, "allow4xx accepts an app that answers 404");
    assert.strictEqual(verify(snap(200), snap(502), [allow]).passed, false, "allow4xx still rejects 5xx");
  });

  it("cpu_below_pct with underLoad needs samples taken while load was driven", () => {
    const criterion = { kind: "cpu_below_pct", pct: 70, underLoad: true };
    const cpu = [{ ts: WINDOW.end, pct: 10 }];
    const idle = takeSnapshot(evidence({ cpu }), [], { underLoad: false });
    const loaded = takeSnapshot(evidence({ cpu }), [], { underLoad: true });
    assert.strictEqual(verify(idle, idle, [criterion]).passed, false);
    assert.strictEqual(verify(idle, loaded, [criterion]).passed, true);
  });
});

describe("release kinds and audit integrity", () => {
  it("buildState reports auditOk and releases carry their kind", async () => {
    const { createCore } = require("../apps/web/lib/core.js");
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "sokan-i1-state-"));
    const core = createCore({ token: "i1-state", stateDir, env: { SOKAN_STATE_DIR: stateDir }, chaosPort: 3241 });
    try {
      const now = new Date().toISOString();
      assert.strictEqual(core.buildState().auditOk, true);
      core.addRelease({ id: "rel_restart", kind: "restart", state: "READY", createdAt: now, finishedAt: now, envKeys: [], message: "demo", source: "local", envSnapshot: {} });
      core.addRelease({ id: "rel_deploy", kind: "release", state: "READY", createdAt: now, finishedAt: now, envKeys: [], message: "deploy", source: "local", envSnapshot: {} });
      const kinds = Object.fromEntries(core.buildState().releases.map((r) => [r.id, r.kind]));
      assert.deepStrictEqual(kinds, { rel_restart: "restart", rel_deploy: "release" });
    } finally {
      await core.shutdown();
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });
});

describe("tampered audit log is reported in the state (round 3 item 6)", () => {
  it("auditOk is false and warning_fa names the tampering after an edit to audit.jsonl", async () => {
    const { createCore } = require("../apps/web/lib/core.js");
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "sokan-i1-audit-"));
    const env = { SOKAN_STATE_DIR: stateDir, SOKAN_SECRET: "i1-audit-secret-000001" };
    const cores = [];
    try {
      const first = createCore({ token: "i1-audit", stateDir, env, chaosPort: 3242 });
      cores.push(first);
      first.audit.append({ event: "executed", tool: "app_restart", riskLevel: "L2", caller: "user", paramsHash: "h".repeat(64), approvalId: "apr_1", success: true });
      first.audit.append({ event: "executed", tool: "app_restart", riskLevel: "L2", caller: "user", paramsHash: "h".repeat(64), approvalId: "apr_2", success: true });
      const file = path.join(stateDir, "audit.jsonl");
      fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace('"approvalId":"apr_1"', '"approvalId":"apr_X"'));
      // A fresh core re-reads the file at start, so the cached integrity result cannot hide the edit.
      const reloaded = createCore({ token: "i1-audit", stateDir, env, chaosPort: 3242 });
      cores.push(reloaded);
      const state = reloaded.buildState();
      assert.strictEqual(state.auditOk, false);
      assert.strictEqual(state.warning_fa, "دفتر ممیزی دستکاری شده یا ناقص است");
    } finally {
      for (const c of cores) await c.shutdown();
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });
});

describe("leak scenario through the executor", () => {
  it("a restart that holds ends with outcome mitigated and the incident says so", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "sokan-i1-"));
    const { createCore } = require("../apps/web/lib/core.js");
    const { runScenario } = require("../apps/web/lib/scenarios.js");
    const { investigate } = require("../apps/web/lib/investigate.js");
    const { executeApproved } = require("../apps/web/lib/executor.js");
    const { newTurn } = require("../apps/web/lib/tools.js");
    const core = createCore({ token: "i1-test", stateDir, env: { SOKAN_STATE_DIR: stateDir }, chaosPort: 3240 });
    try {
      core.start();
      await core.sleep(1500);
      assert.strictEqual((await runScenario(core, "scenario-3-leak")).status, 200);
      await waitForLeakDiagnosis(core, 90000);
      const turn = newTurn();
      await investigate(core, turn, { symptom: "سایتم مشکل داره" });
      assert.strictEqual(turn.approvals.length, 1);
      const restartId = turn.approvals[0];
      assert.strictEqual(core.approvals.get(restartId).tool, "app_restart");
      core.approvals.approve(restartId);
      const out = await executeApproved(core, restartId);
      assert.strictEqual(out.ok, true);
      assert.strictEqual(out.outcome, "mitigated");
      assert.strictEqual(out.resolved, false);
      assert.strictEqual(core.state.incident.status, "mitigated");
    } finally {
      await core.shutdown();
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  }, 120000);
});

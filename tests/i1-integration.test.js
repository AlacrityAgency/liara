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
  });

  it("probe_not_5xx accepts any answer below 500 and rejects 5xx, status 0 and no probe", () => {
    const check = { kind: "probe_not_5xx", path: "/" };
    const snap = (status) => takeSnapshot(evidence({ probes: [probe("/", status)] }), ["/"]);
    assert.strictEqual(verify(snap(502), snap(404), [check]).passed, true);
    assert.strictEqual(verify(snap(200), snap(502), [check]).passed, false);
    assert.strictEqual(verify(snap(200), snap(0), [check]).passed, false);
    assert.strictEqual(verify(snap(200), takeSnapshot(evidence(), ["/"]), [check]).passed, false);
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
      await core.sleep(4000);
      const turn = newTurn();
      await investigate(core, turn, { symptom: "سایتم مشکل داره" });
      assert.strictEqual(turn.approvals.length, 1);
      core.approvals.approve(turn.approvals[0]);
      const out = await executeApproved(core, turn.approvals[0]);
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

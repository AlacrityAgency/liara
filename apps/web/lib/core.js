"use strict";
// Shared server state: target app (simulated child or live Liara app), logs, probes, releases, approvals,
// SSE fan-out and the /api/state view. Every outgoing string passes through the redactor.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const {
  ApprovalService, AuditLedger, SecretRedactor, maskParams, paramsHash,
} = require("../../../build/policy/src/index.js");
const { LiaraClient, LIARA_LIMITS } = require("../../../build/liara-client/src/index.js");
const { LlmClient, Orchestrator } = require("../../../build/llm/src/index.js");
const { ChaosRuntime, DEMO_DIR } = require("./runtime");

const TARGET_NAME = "chaos-shop";
const DEFAULT_CHAOS_PORT = 3100;
// Demo-only database URL for the simulated target. It is never used in live mode.
const DEMO_DB_URL = "postgres://demo:demo@127.0.0.1:5432/shop";
const SIM_DEFAULT_ENVS = Object.freeze({ DATABASE_URL: DEMO_DB_URL });
const PLAN_LADDER = Object.freeze([
  { planID: "g2-small", ramMB: 512, cpu: 0.5 },
  { planID: "g2-medium", ramMB: 1024, cpu: 1 },
  { planID: "g2-pro", ramMB: 2048, cpu: 2 },
]);
const REPO_ROOT = path.resolve(__dirname, "../../..");
const LOG_RING = 500;
const PROBE_RING = 300;
const TICK_MS = 3000;

const unique = (xs) => Array.from(new Set(xs));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createCore(options = {}) {
  const env = options.env || process.env;
  const stateDir = options.stateDir || env.SOKAN_STATE_DIR || path.join(REPO_ROOT, ".sokan");
  const secret = env.SOKAN_SECRET && env.SOKAN_SECRET.length > 0 ? env.SOKAN_SECRET : undefined;

  // Audit: persistent JSONL with HMAC chain only when SOKAN_SECRET is set (WHITEPAPER §10.4).
  const audit = secret
    ? new AuditLedger({ filePath: path.join(stateDir, "audit.jsonl"), key: secret })
    : new AuditLedger();
  const approvals = new ApprovalService({ secret, audit });
  const redactor = new SecretRedactor({ env });
  const liara = options.liara || new LiaraClient({ apiToken: env.LIARA_API_TOKEN, teamID: env.LIARA_TEAM_ID });
  const llm = options.llm || LlmClient.fromEnv(env);
  const orchestrator = new Orchestrator(llm);
  const chaosPort = Number(options.chaosPort || env.CHAOS_PORT || DEFAULT_CHAOS_PORT);

  let logSeq = 0;
  let eventSeq = 0;
  let probeSeq = 0;
  let tickBusy = false;
  let lastAccountAt = 0;
  let actionTail = Promise.resolve();

  const core = {
    env,
    stateDir,
    token: options.token,
    liara,
    llm,
    orchestrator,
    approvals,
    audit,
    redactor,
    baseUrl: options.baseUrl || `http://127.0.0.1:${env.SOKAN_PORT || env.PORT || 4000}`,
    sseClients: new Set(),
    pendingEnvs: new Map(),   // key -> value (never echoed)
    pendingMeta: new Map(),   // approvalId -> what to execute and how to verify
    logs: [],
    probes: [],
    events: [],
    releases: [],
    cpuSamples: [],
    app: {
      port: chaosPort,
      planID: PLAN_LADDER[0].planID,
      ramMB: PLAN_LADDER[0].ramMB,
      appEnvs: { ...SIM_DEFAULT_ENVS },
      deleted: false,
      deploying: false,
    },
    state: {
      pipeline: { stage: "idle", steps: [] },
      incident: null,
      fixBrief: null,
      verification: null,
      plans: null,
      account: null,
      liveApp: null,
      watchPaths: [],
      lastRestartAt: null,
    },
  };

  // ---------- helpers ----------
  core.isLive = () => liara.isLive;
  core.mode = () => (liara.isLive ? "live" : "simulated");
  core.appName = () => (liara.isLive ? (env.SOKAN_APP || null) : TARGET_NAME);
  core.redact = (text) => redactor.redactText(String(text ?? ""));
  core.clean = (obj) => redactor.redactDeep(obj);
  core.registerSecret = (value) => redactor.addLiteral(String(value ?? ""));
  core.consoleUrl = (id) => `${core.baseUrl}/?approval=${encodeURIComponent(id)}`;
  core.childEnv = () => ({ ...core.app.appEnvs });
  core.runtime = new ChaosRuntime({
    onLine: (line, stream) => core.addLog(line, stream),
    onEvent: (ev) => core.addEvent(ev.type, ev.message),
  });

  core.emit = (type, data) => {
    let payload;
    try {
      payload = `event: ${type}\ndata: ${JSON.stringify(redactor.redactDeep(data ?? {}))}\n\n`;
    } catch {
      return;
    }
    for (const res of core.sseClients) {
      try {
        res.write(payload);
      } catch {
        core.sseClients.delete(res);
      }
    }
  };

  core.addLog = (line, stream = "stdout") => {
    const entry = {
      id: `log_${++logSeq}`,
      ts: new Date().toISOString(),
      stream,
      line: redactor.redactText(String(line)),
    };
    core.logs.push(entry);
    if (core.logs.length > LOG_RING) core.logs.shift();
    core.emit("log", { id: entry.id, ts: entry.ts, stream: entry.stream, line: entry.line });
    return entry;
  };

  core.addEvent = (type, message) => {
    const entry = {
      id: `evt_${++eventSeq}`,
      ts: new Date().toISOString(),
      type,
      message: redactor.redactText(String(message)),
    };
    core.events.push(entry);
    if (core.events.length > 200) core.events.shift();
    return entry;
  };

  core.addRelease = (release) => {
    core.releases.push(release);
    if (core.releases.length > 50) core.releases.shift();
    return release;
  };

  core.setAppEnv = (key, value) => {
    core.app.appEnvs[key] = String(value);
    core.registerSecret(value);
  };

  core.removeAppEnv = (key) => {
    delete core.app.appEnvs[key];
  };

  core.targetBase = () => {
    if (liara.isLive) return `https://${core.appName()}.liara.run`;
    return `http://127.0.0.1:${core.app.port}`;
  };

  /** Probes one path now, records it and broadcasts it. Heap and RSS are read from /health when present. */
  core.probeNow = async (urlPath) => {
    const t0 = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    let status = null;
    let text = "";
    try {
      const res = await fetch(`${core.targetBase()}${urlPath}`, { signal: controller.signal, redirect: "manual" });
      status = res.status;
      text = urlPath === "/health" ? await res.text() : (await res.arrayBuffer().then(() => "", () => ""));
    } catch {
      status = null;
    } finally {
      clearTimeout(timer);
    }
    const record = {
      id: `prb_${++probeSeq}`,
      ts: new Date().toISOString(),
      path: urlPath,
      status,
      ms: Date.now() - t0,
      ok: status !== null && status >= 200 && status < 400,
    };
    if (urlPath === "/health" && text) {
      try {
        const memory = JSON.parse(text).memory || {};
        if (typeof memory.heapUsedMB === "number") record.heapUsedMB = memory.heapUsedMB;
        if (typeof memory.rssMB === "number") record.rssMB = memory.rssMB;
      } catch {
        // not JSON: no memory numbers
      }
    }
    core.probes.push(record);
    if (core.probes.length > PROBE_RING) core.probes.shift();
    core.emit("probe", record);
    return record;
  };

  core.refreshAccount = async () => {
    lastAccountAt = Date.now();
    if (!liara.isLive) {
      core.state.account = null;
      return;
    }
    const r = await liara.getBalance();
    if (r.ok) core.state.account = { balance: r.data.balance };
  };

  core.refreshLiveApp = async () => {
    if (!liara.isLive || !core.appName()) return;
    const r = await liara.getApp(core.appName());
    if (r.ok) core.state.liveApp = r.data.project;
  };

  async function tick() {
    if (tickBusy) return;
    tickBusy = true;
    try {
      const paths = unique(["/health", ...core.state.watchPaths]);
      for (const p of paths) await core.probeNow(p);
      if (!liara.isLive) {
        const sample = core.runtime.cpuSample();
        if (sample) {
          core.cpuSamples.push(sample);
          if (core.cpuSamples.length > 100) core.cpuSamples.shift();
        }
      } else if (Date.now() - lastAccountAt > 30000) {
        await core.refreshAccount().catch(() => undefined);
        await core.refreshLiveApp().catch(() => undefined);
      }
    } catch {
      // probing must never take the console down
    } finally {
      tickBusy = false;
    }
  }

  core.timer = setInterval(() => { tick(); }, TICK_MS);

  // ---------- approvals ----------
  core.publicApproval = (id) => approvals.get(id);

  /**
   * Creates a pending L2/L3 approval. A pending approval with the same tool and params hash is reused,
   * so repeated chat messages do not stack identical cards.
   */
  core.requestApproval = (tool, params, card, meta = {}, opts = {}) => {
    const hash = paramsHash(tool, params);
    const existing = approvals.list().find((a) => a.status === "pending" && a.paramsHash === hash);
    if (existing) return { approval: existing, created: false };
    const outcome = approvals.request(tool, params, card, "agent", { confirmationText: opts.confirmationText });
    if (outcome.kind !== "pending") return { approval: null, created: false };
    pendingMeta(outcome.approval.id, meta);
    core.emit("approval", outcome.approval);
    return { approval: outcome.approval, created: true };
  };

  function pendingMeta(id, meta) {
    core.pendingMeta.set(id, meta);
  }

  /** Serialises executions so only one action touches the target at a time. */
  core.enqueueAction = (fn) => {
    const next = actionTail.then(fn, fn);
    actionTail = next.catch(() => undefined);
    return next;
  };

  // ---------- views ----------
  core.appView = () => {
    if (liara.isLive) {
      const live = core.state.liveApp;
      return {
        name: core.appName(),
        status: live ? (live.scale > 0 ? "running" : "stopped") : "unknown",
        url: core.targetBase(),
        planID: live?.planID,
        port: live?.port,
      };
    }
    const running = core.runtime.running;
    let status = "stopped";
    if (core.app.deploying) status = "deploying";
    else if (running) status = "running";
    return {
      name: TARGET_NAME,
      status,
      url: core.targetBase(),
      planID: core.app.planID,
      port: core.app.port,
      memoryLimitMB: core.memoryLimitMB(),
      restarts: core.runtime.crashes,
      deleted: core.app.deleted,
    };
  };

  core.memoryLimitMB = () => {
    const cap = Number(core.app.appEnvs.CHAOS_MEM_LIMIT_MB);
    return Number.isFinite(cap) && cap > 0 ? cap : core.app.ramMB;
  };

  core.buildState = () => {
    const s = core.state;
    const ephemeral = approvals.isEphemeralSecret;
    return core.clean({
      mode: core.mode(),
      isEphemeralSecret: ephemeral,
      warning_fa: ephemeral
        ? "کلید ثابت (SOKAN_SECRET) تنظیم نشده است؛ تأییدها و Audit با ری‌استارت کنسول از بین می‌روند."
        : null,
      llm: llm.isConfigured ? { configured: true, model: llm.model } : { configured: false },
      app: core.appView(),
      account: s.account,
      pipeline: s.pipeline,
      approvals: approvals.list().slice(-50),
      incident: s.incident,
      fixBrief: s.fixBrief,
      verification: s.verification,
      probes: core.probes.slice(-50),
      logs: core.logs.slice(-200),
      audit: audit.list().slice(-50),
      limits: LIARA_LIMITS,
      plans: s.plans,
      pendingEnvKeys: Array.from(core.pendingEnvs.keys()),
      releases: core.releases.slice(-10).map(releaseView),
      events: core.events.slice(-30),
    });
  };

  core.releaseView = releaseView;
  core.start = () => {
    core.runtime.start(core.childEnv(), core.app.port).catch(() => undefined);
    setTimeout(() => { tick(); }, 300);
  };
  core.shutdown = async () => {
    clearInterval(core.timer);
    await core.runtime.stop();
  };
  core.DEMO_DIR = DEMO_DIR;
  core.SIM_DEFAULT_ENVS = SIM_DEFAULT_ENVS;
  core.PLAN_LADDER = PLAN_LADDER;
  core.TARGET_NAME = TARGET_NAME;
  core.sleep = sleep;
  core.stateDir = stateDir;
  core.ensureDir = (dir) => fs.mkdirSync(dir, { recursive: true });
  core.maskParams = maskParams;
  core.randomId = (prefix) => `${prefix}_${crypto.randomBytes(4).toString("hex")}`;
  return core;
}

function releaseView(r) {
  return {
    id: r.id,
    state: r.state,
    createdAt: r.createdAt,
    finishedAt: r.finishedAt,
    envKeys: r.envKeys,
    message: r.message,
    source: r.source,
  };
}

module.exports = { createCore, TARGET_NAME, DEMO_DB_URL, SIM_DEFAULT_ENVS, PLAN_LADDER, DEMO_DIR, sleep, unique };

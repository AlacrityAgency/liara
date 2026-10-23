"use strict";
// Executor (WEB_CONTRACT: Executor rules). Parameters come only from the approval record. Every mutating
// action is wrapped in: before-snapshot -> execute -> wait for running -> observe -> after-snapshot -> verify.
// Live executors act on params.project (the approved app), never on whatever app the console has selected.

const crypto = require("crypto");
const { verify } = require("../../../build/diagnostics/src/index.js");
const { LIARA_LIMITS } = require("../../../build/liara-client/src/index.js");
const { DEMO_DIR, PLAN_LADDER, sleep, unique } = require("./core");
const { snapshot } = require("./evidence");

const DEFAULT_CRITERIA = Object.freeze({
  app_restart: [{ kind: "applets_running" }],
  app_update_envs: [{ kind: "applets_running" }],
  app_resize_plan: [{ kind: "applets_running" }],
  app_update_port: [{ kind: "applets_running" }],
  app_scale: [{ kind: "applets_running" }],
  deploy: [{ kind: "applets_running" }],
  release_rollback: [{ kind: "applets_running" }],
  dns_zone_setup: [],
  app_delete: [],
});

const SIM = (text) => `(شبیه‌سازی محلی) ${text}`;
const ok = (detail_fa) => ({ ok: true, detail_fa });
const fail = (what_fa, why_fa, next_fa) => ({ ok: false, error: { what_fa, why_fa, next_fa } });
const liaraFail = (r, what_fa) => fail(r.error?.what_fa || what_fa, r.error?.why_fa || "", r.error?.next_fa || "");
const newReleaseId = () => `rel_${crypto.randomBytes(3).toString("hex")}`;

/** The app named by the approved params. Live actions without it are refused, never sent to a guessed app. */
function approvedProject(p) {
  return typeof p.project === "string" && p.project.length > 0 ? p.project : null;
}
const PROJECT_MISSING = () => fail(
  "اپ مشخص نیست",
  "نام اپ در تأییدیه ثبت نشده است؛ اجرا متوقف شد.",
  "درخواست تأیید تازه بسازید.",
);

async function waitReady(core, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const probe = await core.probeNow("/health");
    if (probe.status === 200) return true;
    await sleep(300);
  }
  return false;
}

async function simRestart(core) {
  await core.runtime.start(core.childEnv(), core.app.port);
  core.addEvent("action", "new process started after approved change");
  await waitReady(core, 10000);
}

function ladderRam(planID) {
  const plan = PLAN_LADDER.find((p) => p.planID === planID);
  return plan ? plan.ramMB : null;
}

function deployStage(core, stage, message_fa, line) {
  core.emit("deploy_progress", { stage, message_fa, ...(line ? { line } : {}) });
}

/** Default progress sink: the console's deploy_progress event. Simple mode passes its own sink. */
function defaultProgress(core) {
  return (stage, message_fa, line) => deployStage(core, stage, message_fa, line);
}

async function deploySim(core, p, progress = defaultProgress(core)) {
  core.app.deploying = true;
  const started = new Date().toISOString();
  try {
    for (const [stage, text] of [["pack", "بسته‌بندی شبیه‌سازی‌شده"], ["upload", "آپلود شبیه‌سازی‌شده"], ["release", "ایجاد ریلیز محلی"], ["build", "ساخت محلی"]]) {
      progress(stage, SIM(text));
      await sleep(250);
    }
    for (const v of p.variables || []) core.setAppEnv(v.key, v.value);
    if (p.planID) {
      core.app.planID = p.planID;
      core.app.ramMB = ladderRam(p.planID) || core.app.ramMB;
    }
    if (p.port) core.app.port = Number(p.port);
    core.app.deleted = false;
    await simRestart(core);
    const state = core.runtime.running && (await core.probeNow("/health")).status === 200 ? "READY" : "UNHEALTHY";
    progress("ready", SIM(state === "READY" ? "نسخه‌ی محلی آماده است" : "نسخه‌ی محلی پاسخ نداد"));
    core.addRelease({
      id: newReleaseId(),
      state,
      createdAt: started,
      finishedAt: new Date().toISOString(),
      envKeys: Object.keys(core.app.appEnvs),
      message: "local deploy",
      source: "local",
      envSnapshot: { ...core.app.appEnvs },
    });
    return state === "READY"
      ? { ok: true, detail_fa: SIM("نسخه‌ی جدید روی اپ شبیه‌سازی‌شده مستقر شد."), releaseID: undefined }
      : fail(SIM("استقرار انجام شد ولی برنامه پاسخ نداد."), "پورت یا متغیرهای برنامه را بررسی کنید.", "پیش از تأیید دوباره، پورت و env را اصلاح کنید.");
  } finally {
    core.app.deploying = false;
  }
}

/**
 * Live deploy of the approved app: getApp -> createApp only on 404 (any other error stops here) -> updateEnvs ->
 * deploy (pack, upload, release with envs in the body, build logs). `progress(stage, message_fa, line?)` gets every step.
 */
async function deployLive(core, p, progress = defaultProgress(core)) {
  const name = approvedProject(p);
  if (!name) return PROJECT_MISSING();
  const liara = core.liara;
  const existing = await liara.getApp(name);
  if (!existing.ok) {
    if (existing.error?.code !== "NOT_FOUND") return liaraFail(existing, "خواندن اپ از لیارا انجام نشد");
    progress("create", "ساخت اپ جدید در لیارا");
    const created = await liara.createApp({
      name,
      planID: p.planID,
      platform: p.platform || "node",
      ...(p.bundlePlanID ? { bundlePlanID: p.bundlePlanID } : {}),
    });
    if (!created.ok) return liaraFail(created, "ساخت اپ انجام نشد");
  }
  const variables = Array.isArray(p.variables) ? p.variables : [];
  if (variables.length > 0) {
    progress("envs", "تنظیم متغیرهای محیطی");
    const set = await liara.updateEnvs(name, variables);
    if (!set.ok) return liaraFail(set, "تنظیم متغیرها انجام نشد");
  }
  const envs = variables.length > 0 ? Object.fromEntries(variables.map((v) => [v.key, v.value])) : undefined;
  const dir = p.dir || core.env.SOKAN_PROJECT_DIR || DEMO_DIR;
  const result = await liara.deploy(name, dir, {
    port: Number(p.port) || 3000,
    platform: p.platform || "node",
    ...(envs ? { envs } : {}),
    onEvent: (ev) => progress(ev.stage, ev.message_fa, ev.line),
  });
  if (!result.ok) return fail(result.error?.what_fa || "استقرار انجام نشد", result.error?.why_fa || "", result.error?.next_fa || "");
  return { ok: true, detail_fa: `نسخه‌ی جدید منتشر شد (ریلیز ${result.releaseID || "نامشخص"}).`, releaseID: result.releaseID };
}

/** Maps a tool name to its executor. Each entry is (core, params, meta) -> {ok, detail_fa} | {ok:false, error}. */
const EXECUTORS = {
  async app_restart(core, p) {
    if (core.isLive()) {
      const app = approvedProject(p);
      if (!app) return PROJECT_MISSING();
      const r = await core.liara.restartApp(app);
      return r.ok ? ok("ری‌استارت درخواست شد و برنامه دوباره بالا می‌آید.") : liaraFail(r, "ری‌استارت انجام نشد");
    }
    await simRestart(core);
    return ok(SIM("اپ ری‌استارت شد."));
  },

  async app_update_envs(core, p) {
    const keys = p.variables.map((v) => v.key).join("، ");
    if (core.isLive()) {
      const app = approvedProject(p);
      if (!app) return PROJECT_MISSING();
      const r = await core.liara.updateEnvs(app, p.variables);
      return r.ok ? ok(`متغیرهای ${keys} تنظیم شد؛ مقدارها در گزارش نمایش داده نمی‌شوند.`) : liaraFail(r, "تنظیم متغیرها انجام نشد");
    }
    for (const v of p.variables) core.setAppEnv(v.key, v.value);
    await simRestart(core);
    return ok(SIM(`متغیرهای ${keys} تنظیم شد و اپ ری‌استارت شد؛ مقدارها نمایش داده نمی‌شوند.`));
  },

  async app_resize_plan(core, p) {
    if (core.isLive()) {
      const app = approvedProject(p);
      if (!app) return PROJECT_MISSING();
      const r = await core.liara.resizePlan(app, p.planID);
      return r.ok ? ok(`پلن به ${p.planID} تغییر کرد.`) : liaraFail(r, "تغییر پلن انجام نشد");
    }
    core.app.planID = p.planID;
    core.app.ramMB = ladderRam(p.planID) || core.app.ramMB;
    await simRestart(core);
    return ok(SIM(`پلن به ${p.planID} (${core.app.ramMB} مگابایت) تغییر کرد.`));
  },

  async app_update_port(core, p) {
    if (core.isLive()) {
      const app = approvedProject(p);
      if (!app) return PROJECT_MISSING();
      const r = await core.liara.updatePort(app, p.port);
      return r.ok ? ok(`پورت اپ به ${p.port} تغییر کرد.`) : liaraFail(r, "تغییر پورت انجام نشد");
    }
    core.app.port = p.port;
    await simRestart(core);
    return ok(SIM(`پورت اپ به ${p.port} تغییر کرد.`));
  },

  async app_scale(core, p) {
    if (core.isLive()) {
      const app = approvedProject(p);
      if (!app) return PROJECT_MISSING();
      const r = await core.liara.scaleApp(app, p.scale);
      return r.ok ? ok(`تعداد نمونه‌ها به ${p.scale} تنظیم شد.`) : liaraFail(r, "تغییر تعداد نمونه‌ها انجام نشد");
    }
    if (p.scale === 0) {
      await core.runtime.stop();
      return ok(SIM("اپ متوقف شد (scale = 0)."));
    }
    await core.runtime.start(core.childEnv(), core.app.port);
    await waitReady(core, 10000);
    return ok(SIM(`تعداد نمونه‌ها به ${p.scale} تنظیم شد.`));
  },

  async app_delete(core, p) {
    if (core.isLive()) {
      const app = approvedProject(p);
      if (!app) return PROJECT_MISSING();
      const r = await core.liara.deleteApp(app);
      return r.ok ? ok("اپ حذف شد.") : liaraFail(r, "حذف اپ انجام نشد");
    }
    await core.runtime.stop();
    core.app.deleted = true;
    return ok(SIM("اپ شبیه‌سازی‌شده حذف شد."));
  },

  async deploy(core, p, meta = {}) {
    if (core.isLive()) return deployLive(core, p, meta.progress);
    return deploySim(core, p, meta.progress);
  },

  async release_rollback(core, p) {
    if (core.isLive()) {
      const app = approvedProject(p);
      if (!app) return PROJECT_MISSING();
      const current = await core.liara.getRelease(p.releaseId);
      const image = current.ok ? current.data?.release?.image : undefined;
      if (!image) {
        return fail(
          "بازگشت خودکار به ریلیز قبلی ممکن نیست",
          LIARA_LIMITS.find((l) => l.id === "dedicated_rollback").why_fa,
          LIARA_LIMITS.find((l) => l.id === "dedicated_rollback").workaround_fa,
        );
      }
      const r = await core.liara.createRelease(app, { image, port: core.app.port || 3000, type: "docker" });
      return r.ok ? ok("ریلیز قبلی دوباره منتشر شد.") : liaraFail(r, "بازگشت به ریلیز قبلی انجام نشد");
    }
    const target = core.releases.find((r) => r.id === p.releaseId && r.envSnapshot);
    if (!target) {
      return fail(SIM("بازگشت انجام نشد."), "ریلیز مقصد در تاریخچه‌ی محلی پیدا نشد.", "شناسه‌ی یک ریلیز READY قبلی را انتخاب کنید.");
    }
    core.app.appEnvs = { ...target.envSnapshot };
    for (const value of Object.values(core.app.appEnvs)) core.registerSecret(value);
    await simRestart(core);
    core.addRelease({
      id: newReleaseId(), state: "READY", createdAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
      envKeys: Object.keys(core.app.appEnvs), message: `rollback to ${target.id}`, source: "local",
      envSnapshot: { ...core.app.appEnvs },
    });
    return ok(SIM(`به ریلیز ${target.id} بازگشته شد.`));
  },

  async dns_zone_setup(core, p) {
    if (!core.isLive()) return fail(SIM("تنظیم دامنه فقط در حالت زنده انجام می‌شود."), "حالت شبیه‌سازی به DNS لیارا دسترسی ندارد.", "حالت زنده را با LIARA_API_TOKEN فعال کنید.");
    const app = approvedProject(p);
    if (!app) return PROJECT_MISSING();
    const zone = await core.liara.createZone(p.domain);
    if (!zone.ok) return liaraFail(zone, "ساخت Zone انجام نشد");
    const added = await core.liara.addDomain(p.domain, app);
    return added.ok ? ok(`دامنه ${p.domain} به Zone و اپ اضافه شد؛ تغییر NS را در ایرنیک انجام دهید.`) : liaraFail(added, "افزودن دامنه انجام نشد");
  },
};

const WAIT_SETTLE_MS_LIVE = 90000;
const OBSERVE_MS_LIVE = 60000;
const OBSERVE_ROUNDS_SIM = 6;

async function settle(core, project) {
  if (core.isLive()) {
    const app = project || core.appName();
    const deadline = Date.now() + WAIT_SETTLE_MS_LIVE;
    while (Date.now() < deadline) {
      const r = await core.liara.getApplets(app);
      const applets = r.ok ? (Array.isArray(r.data) ? r.data : r.data?.applets || []) : [];
      if (applets.some((a) => String(a.state).toLowerCase() === "running")) return;
      await sleep(3000);
    }
    return;
  }
  if (core.runtime.running) await waitReady(core, 10000);
}

async function observe(core, paths) {
  if (core.isLive()) {
    for (let i = 0; i < OBSERVE_MS_LIVE / 10000; i++) {
      for (const p of paths) await core.probeNow(p);
      await sleep(10000);
    }
    return;
  }
  for (let i = 0; i < OBSERVE_ROUNDS_SIM; i++) {
    for (const p of paths) await core.probeNow(p);
    await sleep(900);
  }
}

function legacySnapshot(v) {
  return {
    ts: v.ts,
    appletState: v.appletsRunning ? "running" : "stopped",
    errorsPerMinute: Math.round(v.errorRatePerMin),
    probeOk: v.probe.filter((p) => p.status !== null && p.status >= 200 && p.status < 400).length,
    probeTotal: v.probe.length,
    p95Ms: null,
    memoryPeakPct: v.memP95Pct,
    cpuPct: v.cpuP95Pct,
  };
}

function setPipeline(core, stage, steps) {
  core.state.pipeline = { stage, steps };
  core.emit("state", {});
}

function step(core, id, status) {
  const steps = core.state.pipeline.steps.map((s) => (s.id === id ? { ...s, status } : s));
  setPipeline(core, id, steps);
}

/**
 * Runs one approved action end to end. authorize() must accept the approval first; the function returns
 * {ok, resolved, tool, approvalId, detail_fa?, error?, verification}. `opts.onStep(stage, message_fa)` is optional.
 */
async function executeApproved(core, approvalId, opts = {}) {
  const report = opts.onStep || (() => undefined);
  const meta = core.pendingMeta.get(approvalId) || {};
  const record = core.approvals.get(approvalId);
  if (!record) return { ok: false, resolved: false, tool: null, approvalId, error: { what_fa: "تأیید پیدا نشد", why_fa: "", next_fa: "" } };
  const tool = record.tool;
  const params = core.approvals.getApprovedParams(approvalId);
  if (!params) return { ok: false, resolved: false, tool, approvalId, error: { what_fa: "تأیید هنوز فعال نیست", why_fa: "", next_fa: "" } };
  const auth = core.approvals.authorize(tool, params, approvalId, "user");
  if (!auth.ok) {
    core.pendingMeta.delete(approvalId);
    const error = { what_fa: "اجرا متوقف شد", why_fa: `کد رد: ${auth.code}`, next_fa: "درخواست تأیید جدید بسازید." };
    core.emit("action_result", {
      approvalId, tool, ok: false, mode: core.mode(),
      result_fa: `${core.mode() === "simulated" ? "(شبیه‌سازی محلی) " : ""}اجرا به‌دلیل عدم تطابق تأیید متوقف شد.`,
      error,
    });
    return { ok: false, resolved: false, tool, approvalId, error };
  }
  const mode = core.mode();
  const started = Date.now();
  const incident = core.state.incident && meta.incidentId === core.state.incident.id ? core.state.incident : null;
  // Scaling to zero is a deliberate stop, so there is nothing to verify as "running".
  const criteria = meta.criteria
    || (tool === "app_scale" && params.scale === 0 ? [] : DEFAULT_CRITERIA[tool] || []);
  const probePaths = unique([
    ...(meta.probePaths || []),
    ...criteria.filter((c) => c.path).map((c) => c.path),
    ...(criteria.length > 0 ? ["/health"] : []),
  ]);
  const steps = [
    { id: "execute", label_fa: "اجرای اقدام تأییدشده", status: "running" },
    { id: "settle", label_fa: "انتظار تا آماده شدن برنامه", status: "pending" },
    { id: "observe", label_fa: "مشاهده و پروب مسیرها", status: "pending" },
    { id: "verify", label_fa: "راستی‌آزمایی", status: "pending" },
  ];
  setPipeline(core, "execute", steps);
  if (incident) incident.status = "remediating";
  core.emit("state", {});

  const windowStart = incident ? incident.window.start : new Date(Date.now() - 30 * 60000).toISOString();
  let before = null;
  if (criteria.length > 0) before = await snapshot(core, windowStart, probePaths);

  const actionStart = new Date().toISOString();
  let exec;
  report("fix", "در حال اعمال تغییر");
  try {
    exec = await EXECUTORS[tool](core, params, { ...meta, progress: undefined });
  } catch (err) {
    exec = fail("اجرای اقدام با خطا متوقف شد.", core.redact(err && err.message ? err.message : "خطای ناشناخته"), "وضعیت را بررسی کنید و دوباره تلاش کنید.");
  }
  if (!exec) exec = fail("اقدام ناشناخته است.", `ابزار ${tool} اجرا نمی‌شود.`, "این ابزار در کنسول پشتیبانی نمی‌شود.");
  step(core, "execute", exec.ok ? "done" : "failed");

  let verification = null;
  let after = null;
  if (exec.ok && criteria.length > 0) {
    step(core, "settle", "running");
    await settle(core, params.project);
    step(core, "settle", "done");
    step(core, "observe", "running");
    await observe(core, probePaths);
    step(core, "observe", "done");
    step(core, "verify", "running");
    report("verify", "در حال راستی‌آزمایی");
    after = await snapshot(core, actionStart, probePaths);
    verification = verify(before.snapshot, after.snapshot, criteria);
    step(core, "verify", verification.passed ? "done" : "failed");
  } else {
    step(core, "settle", exec.ok ? "done" : "failed");
    step(core, "observe", exec.ok ? "done" : "failed");
    step(core, "verify", "failed");
  }

  // resolved: the incident is fixed (needs a passing verification). auditOk: the action ran and was not refuted.
  const resolved = exec.ok && verification !== null && verification.passed;
  const auditOk = exec.ok && (verification === null || verification.passed);
  const durationMs = Date.now() - started;
  core.state.verification = verification;
  if (incident) {
    incident.status = resolved ? "resolved" : "unresolved";
    if (before && after) {
      incident.verification = {
        before: legacySnapshot(before.snapshot),
        after: legacySnapshot(after.snapshot),
        passed: resolved,
        verdict: resolved ? "resolved" : "partial",
      };
    }
    incident.actions.push({
      tool,
      params: core.maskParams(params),
      approvalId,
      executedAt: actionStart,
      success: exec.ok,
      detail: core.redact(exec.ok ? exec.detail_fa : exec.error.what_fa),
    });
  }
  const resultText = exec.ok ? exec.detail_fa : exec.error.what_fa;
  core.approvals.recordResult(tool, params, "user", auditOk, core.redact(resultText), approvalId, { mode, durationMs });
  core.pendingMeta.delete(approvalId);
  core.emit("approval", core.approvals.get(approvalId));
  if (incident) core.emit("incident", incident);
  core.state.watchPaths = meta.watchPaths || core.state.watchPaths;
  core.emit("action_result", {
    approvalId,
    tool,
    ok: exec.ok,
    mode,
    result_fa: mode === "simulated" && !resultText.startsWith("(شبیه‌سازی") ? SIM(resultText) : resultText,
    ...(verification ? { verification } : {}),
    ...(exec.ok ? {} : { error: exec.error }),
  });
  core.emit("state", {});
  return {
    ok: exec.ok,
    resolved,
    tool,
    approvalId,
    detail_fa: resultText,
    ...(exec.ok ? {} : { error: exec.error }),
    verification,
  };
}

/** Schedules a delayed run for an approved approval (L3 waits out the cancel window). */
function scheduleApproved(core, approvalId, delayMs) {
  return core.approvals.scheduleExecution(approvalId, delayMs, () => core.enqueueAction(() => executeApproved(core, approvalId)));
}

module.exports = {
  EXECUTORS,
  DEFAULT_CRITERIA,
  executeApproved,
  scheduleApproved,
  deployLive,
  deploySim,
  approvedProject,
};

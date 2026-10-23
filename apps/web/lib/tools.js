"use strict";
// Tool runner shared by the Orchestrator (chat), POST /api/tools/:name (MCP) and the plan selector.
// L0/L1 run now. L2/L3 only create an approval record; nothing is executed here.

const fs = require("fs");
const path = require("path");
const { findTool, validateToolArgs, effectiveRisk } = require("../../../build/llm/src/index.js");
const { ProjectAnalyzer } = require("../../../build/analyzer/src/index.js");
const { LIARA_LIMITS } = require("../../../build/liara-client/src/index.js");
const { investigate, addApproval } = require("./investigate");
const { livePlans } = require("./evidence");
const { DEMO_DIR, REPO_ROOT, PLAN_LADDER, SIM_DEFAULT_ENVS } = require("./core");

// Monthly estimate = hourly tariff x 720 h (the Liara catalogue formula). Used when the live catalogue is not readable.
const ESTIMATE_HOURLY_TOMANS = { "g2-small": 100, "g2-medium": 220, "g2-pro": 440 };
const HOURS_PER_MONTH = 720;
const APP_LIST_TTL_MS = 60000;

const IRNIC_STEPS = [
  "وارد سایت nic.ir شوید و با حساب ایرنیک خود وارد شوید.",
  "از بخش «دامنه‌های من» دامنه‌ی مورد نظر را باز کنید و گزینه‌ی «تغییر سرورهای نام» (NS) را بزنید.",
  "NSهای اختصاصی را که سُکان نشان می‌دهد، یکی‌یکی جایگزین NSهای فعلی کنید.",
  "تغییرات را ثبت کنید. انتشار NS بسته به ایرنیک و کش DNS زمان می‌برد.",
  "به سُکان برگردید؛ سُکان انتشار NS را پایش می‌کند و بعد دامنه را در لیارا تأیید می‌کند.",
];
const GENERIC_STEPS = [
  "به پنل ثبت‌کننده‌ی دامنه وارد شوید.",
  "رکورد CNAME یا A را مطابق مقدار نمایش‌داده‌شده در سُکان ثبت کنید.",
  "پس از انتشار DNS به سُکان برگردید تا دامنه در لیارا تأیید شود.",
];

const CONFIDENCE_FA = { high: "بالا", medium: "متوسط", low: "پایین" };

function newTurn() {
  return { approvals: [], incident: null, fixBrief: null, plans: null, limits: null, needs: [], profile: null };
}

const err = (error, extra = {}) => ({ status: "error", error, ...extra });

function allowedProjectDir(core, requested) {
  const allowed = [DEMO_DIR, core.env.SOKAN_PROJECT_DIR].filter(Boolean).map((d) => path.resolve(REPO_ROOT, d));
  if (!requested) return allowed[allowed.length - 1];
  const resolved = path.resolve(REPO_ROOT, String(requested));
  return allowed.includes(resolved) ? resolved : null;
}

async function analyze(core, requested) {
  const dir = allowedProjectDir(core, requested);
  if (!dir || !fs.existsSync(dir)) return { error: "PATH_NOT_ALLOWED" };
  return { profile: await ProjectAnalyzer.analyze(dir) };
}

function summarizeProfile(profile) {
  return {
    app: profile.suggestedLiaraJson?.app,
    platform: profile.detectedPlatform,
    port: profile.detectedPort,
    // Demo flags of the simulated target are not part of a real project's configuration.
    required_env_names: (profile.requiredEnvs || []).filter((k) => !k.startsWith("CHAOS_")),
    database: profile.databaseRequirement,
    liara_json: profile.suggestedLiaraJson,
  };
}

/** Required env names that the deploy card must fill (platform and chaos switches are not asked for). */
function deployEnvKeys(profile) {
  return (profile.requiredEnvs || []).filter((k) => k !== "PORT" && k !== "NODE_ENV" && !k.startsWith("CHAOS_") && !k.startsWith("DEBUG_"));
}

/**
 * Apps this console may manage. Simulated: the chaos-shop target. Live: SOKAN_APP, or every app of the account.
 * The account list is cached for a minute so chat messages do not each call Liara.
 */
const appListCache = new WeakMap();
async function manageableApps(core) {
  if (!core.isLive()) return [core.appName()].filter(Boolean);
  if (core.appName()) return [core.appName()];
  const cached = appListCache.get(core);
  if (cached && Date.now() - cached.at < APP_LIST_TTL_MS) return cached.names;
  const r = await core.liara.listApps().catch(() => null);
  const names = r && r.ok ? (r.data.projects || []).map((p) => p.name).filter(Boolean) : [];
  appListCache.set(core, { at: Date.now(), names });
  return names;
}

/** Chat context: the single known app as default, and all names for the "which app?" question. */
async function appContext(core) {
  const apps = await manageableApps(core);
  return { apps, defaultApp: apps.length === 1 ? apps[0] : undefined };
}

/** Plan options: analyzer tiers, priced from the Liara catalogue in live mode only. */
async function planOptions(core, profile, traffic = "medium") {
  const rec = ProjectAnalyzer.recommendPlans(profile, traffic, undefined);
  const catalog = core.isLive() ? await livePlans(core).catch(() => null) : null;
  const tiers = ["economy", "recommended", "scalable"];
  const notes = {
    economy: "کمترین هزینه؛ مناسب تست؛ در ترافیک بالا احتمال کمبود حافظه هست",
    recommended: "حاشیه‌ی امن حافظه برای ترافیک معمول",
    scalable: "هزینه‌ی بیشتر؛ برای پیک ترافیک و کارهای سنگین",
  };
  return rec.options.map((opt, i) => {
    let planID = opt.planId;
    let ramMB = opt.ramMB;
    let cpu = opt.cpuCores;
    let price = opt.monthlyPriceTomans;
    let priceSource = "estimate";
    if (catalog) {
      const pick = catalog
        .filter((p) => p.available && typeof p.ram === "number" && p.ram >= opt.ramMB)
        .sort((a, b) => (a.ram ?? 0) - (b.ram ?? 0))[0];
      if (pick) {
        planID = pick.planID;
        ramMB = pick.ram;
        cpu = pick.cpu ?? cpu;
        price = Math.round(pick.monthlyPrice);
        priceSource = "liara";
      }
    }
    return {
      id: `plan_${tiers[i]}`,
      tier: tiers[i],
      label_fa: opt.name,
      planID,
      ramMB,
      cpu,
      monthlyPriceTomans: price,
      fits_fa: `مناسب برای حدود ${ramMB} مگابایت حافظه`,
      risk_fa: notes[tiers[i]],
      recommended: tiers[i] === "recommended",
      priceSource,
    };
  });
}

function estimatePlan(planID) {
  const rung = PLAN_LADDER.find((p) => p.planID === planID);
  const hourly = ESTIMATE_HOURLY_TOMANS[planID];
  return {
    planID,
    ramMB: rung?.ramMB,
    cpu: rung?.cpu,
    monthlyPriceTomans: hourly ? hourly * HOURS_PER_MONTH : undefined,
    priceSource: hourly ? "estimate" : undefined,
  };
}

/** The plan the app runs on now, with its monthly price (Liara catalogue when readable, else the estimate). */
async function currentPlan(core) {
  if (!core.isLive()) return estimatePlan(core.app.planID);
  const planID = core.state.liveApp?.planID;
  if (!planID) return { planID: undefined, priceSource: undefined };
  const catalog = await livePlans(core).catch(() => null);
  const pick = Array.isArray(catalog) ? catalog.find((p) => p.planID === planID) : undefined;
  if (pick) {
    return { planID, ramMB: pick.ram, cpu: pick.cpu, monthlyPriceTomans: Math.round(pick.monthlyPrice), priceSource: "liara" };
  }
  return estimatePlan(planID);
}

function previousGoodRelease(core) {
  const ready = core.releases.filter((r) => r.state === "READY" && r.envSnapshot);
  return ready.length >= 2 ? ready[ready.length - 2] : null;
}

/** Values for variables the approval will set. Only the form (POST /api/envs) or the simulated demo default. */
function valuesFor(core, keys) {
  const variables = [];
  const missing = [];
  for (const key of keys) {
    let value;
    if (core.pendingEnvs.has(key)) value = core.pendingEnvs.get(key);
    else if (!core.isLive() && SIM_DEFAULT_ENVS[key] !== undefined) value = SIM_DEFAULT_ENVS[key];
    if (value === undefined) missing.push(key);
    else variables.push({ key, value });
  }
  return { variables, missing };
}

const MISSING_VALUES = (keys) => err("MISSING_VALUES", {
  keys,
  next_fa: "مقدار این متغیرها را در فرم متغیرهای اپ وارد کنید (از گفت‌وگو پذیرفته نمی‌شود).",
});

function describeEnvs(core, variables) {
  return core.maskParams({ variables }).variables.map((v) => `${v.key} = ${v.value}`).join("؛ ");
}

/** Builds approval params (canonical names used by the executor) and the card for one L2/L3 tool. */
async function prepareMutation(core, turn, name, args) {
  const allowed = await manageableApps(core);
  const app = args.app || args.project || (allowed.length === 1 ? allowed[0] : undefined);
  if (!app) {
    return allowed.length > 1
      ? err("APP_NAME_REQUIRED", { apps: allowed })
      : err("APP_NAME_REQUIRED", { next_fa: "نام اپ را در متغیر SOKAN_APP تنظیم کنید." });
  }
  if (!allowed.includes(app)) return err("UNKNOWN_APP", { allowed: allowed.join("، "), next_fa: `فقط اپ‌های ${allowed.join("، ")} قابل مدیریت هستند.` });
  const base = { why_fa: "درخواست از گفت‌وگو؛ تا تأیید نکنید تغییری اعمال نمی‌شود.", cost_fa: "بدون هزینه", rollback_fa: "بسته به اقدام؛ در کارت توضیح داده می‌شود" };

  switch (name) {
    case "app_restart":
      return {
        tool: "app_restart", params: { project: app },
        card: { ...base, title_fa: "ری‌استارت اپ", what_fa: `ری‌استارت اپ ${app}`, impact_fa: "حدود ۱۰ ثانیه قطعی", rollback_fa: "نیازی نیست", successCriteria_fa: "برنامه در وضعیت running و /health پاسخ ۲۰۰" },
      };

    case "app_update_envs": {
      const keys = Object.keys(args.envs || {});
      if (keys.length === 0) return err("INVALID_ARGUMENTS", { missing_or_invalid: "envs" });
      const { variables, missing } = valuesFor(core, keys);
      if (missing.length) return MISSING_VALUES(missing);
      return {
        tool: "app_update_envs", params: { project: app, variables },
        card: { ...base, title_fa: "تغییر متغیرهای محیطی", what_fa: `${describeEnvs(core, variables)} در اپ ${app}`, impact_fa: "ری‌استارت کوتاه برنامه", rollback_fa: "حذف یا تغییر مجدد متغیر و ری‌استارت", successCriteria_fa: "برنامه بالا بیاید و مسیر اصلی پاسخ ۲۰۰ بدهد" },
      };
    }

    case "app_resize_plan": {
      const catalog = core.isLive() ? ((await livePlans(core)) || []).map((p) => p.planID) : PLAN_LADDER.map((p) => p.planID);
      if (!catalog.includes(args.plan_id)) return err("UNKNOWN_PLAN", { next_fa: "یکی از پلن‌های پیشنهادی را انتخاب کنید." });
      return {
        tool: "app_resize_plan", params: { project: app, planID: args.plan_id },
        card: { ...base, title_fa: "تغییر پلن منابع", what_fa: `تغییر پلن ${app} به ${args.plan_id}`, cost_fa: "ممکن است هزینه‌ی ماهانه داشته باشد", impact_fa: "ری‌استارت کوتاه", rollback_fa: "بازگشت به پلن قبلی", successCriteria_fa: "برنامه با پلن جدید در وضعیت running" },
      };
    }

    case "app_update_port":
      return {
        tool: "app_update_port", params: { project: app, port: Number(args.port) },
        card: { ...base, title_fa: "تغییر پورت داخلی", what_fa: `تغییر پورت ${app} به ${args.port}`, impact_fa: "ری‌استارت کوتاه", rollback_fa: "بازگشت به پورت قبلی", successCriteria_fa: "applet در وضعیت running" },
      };

    case "app_scale": {
      const scale = Number(args.scale);
      return {
        tool: "app_scale", params: { project: app, scale }, confirmationText: app,
        card: { ...base, title_fa: scale === 0 ? "خاموش کردن اپ" : "تغییر تعداد نمونه‌ها", what_fa: `تنظیم تعداد نمونه‌های ${app} روی ${scale}`, impact_fa: scale === 0 ? "قطع کامل سرویس تا روشن شدن دوباره" : "ری‌استارت نمونه‌ها", rollback_fa: "تنظیم دوباره تعداد نمونه‌ها", successCriteria_fa: "نمونه‌ها در وضعیت مطلوب" },
      };
    }

    case "app_delete":
      return {
        tool: "app_delete", params: { project: app }, confirmationText: app,
        card: { ...base, title_fa: "حذف کامل اپ", what_fa: `حذف کامل اپ ${app} و همه‌ی منابع آن`, why_fa: "درخواست حذف؛ این اقدام برگشت‌ناپذیر است.", impact_fa: "قطعی کامل و غیرقابل بازگشت", rollback_fa: "غیرقابل بازگشت", successCriteria_fa: "اپ از لیارا حذف شده باشد" },
      };

    case "release_rollback": {
      let releaseId = args.release_id;
      if (!releaseId) {
        if (core.isLive()) {
          const r = await core.liara.listReleases(app);
          const list = r.ok ? (Array.isArray(r.data) ? r.data : r.data?.releases || []) : [];
          const ready = list.filter((x) => String(x.state).toUpperCase() === "READY");
          releaseId = ready[1] ? String(ready[1]._id || ready[1].id) : undefined;
        } else {
          releaseId = previousGoodRelease(core)?.id;
        }
      }
      if (!releaseId) {
        const limit = LIARA_LIMITS.find((l) => l.id === "dedicated_rollback");
        return err("ROLLBACK_NO_TARGET", { what_fa: "ریلیز سالم قبلی پیدا نشد", why_fa: limit.why_fa, next_fa: limit.workaround_fa });
      }
      return {
        tool: "release_rollback", params: { project: app, releaseId },
        card: { ...base, title_fa: "بازگشت به ریلیز قبلی", what_fa: `بازگشت ${app} به ریلیز ${releaseId}`, impact_fa: "ری‌استارت کوتاه با نسخه‌ی قبلی", rollback_fa: "انتشار دوباره‌ی نسخه‌ی جدید", successCriteria_fa: "نرخ خطا کمتر از ۱ در دقیقه" },
      };
    }

    case "deploy": {
      const analyzed = await analyze(core, args.project_path);
      if (analyzed.error) return err(analyzed.error);
      turn.profile = analyzed.profile;
      const keys = deployEnvKeys(analyzed.profile);
      const { variables, missing } = valuesFor(core, keys);
      if (missing.length) return MISSING_VALUES(missing);
      const planID = args.plan_id || PLAN_LADDER[1].planID;
      return {
        tool: "deploy",
        params: { project: app, planID, port: core.isLive() ? analyzed.profile.detectedPort : core.app.port, platform: analyzed.profile.detectedPlatform, variables },
        card: { ...base, title_fa: "ساخت اپ و استقرار نسخه", what_fa: `ساخت/به‌روزرسانی اپ ${app} با پلن ${planID}، تنظیم ${describeEnvs(core, variables) || "بدون متغیر"}، و استقرار نسخه‌ی فعلی`, impact_fa: "زمان ساخت حدود یک دقیقه؛ نسخه‌ی قبلی تا آماده شدن نسخه‌ی جدید بالاست", rollback_fa: "بازگشت به ریلیز قبلی", successCriteria_fa: "ریلیز READY و /health پاسخ ۲۰۰" },
      };
    }

    default:
      return err("UNKNOWN_TOOL");
  }
}

/** Creates (or reuses) the approval for an L2/L3 call. Returns the orchestrator-compatible approval_required shape. */
async function requestMutation(core, turn, name, args) {
  const prepared = await prepareMutation(core, turn, name, args);
  if (prepared.status === "error") return prepared;
  const r = core.requestApproval(prepared.tool, prepared.params, prepared.card, { source: "chat" }, { confirmationText: prepared.confirmationText });
  if (!r.approval) return err("NOT_AN_APPROVAL_REQUEST");
  addApproval(turn, r.approval.id);
  return {
    status: "approval_required",
    approvalId: r.approval.id,
    console_url: core.consoleUrl(r.approval.id),
    risk: r.approval.riskLevel,
    mode: core.mode(),
    title_fa: prepared.card.title_fa,
    what_fa: prepared.card.what_fa,
  };
}

function domainGuide(domain, tld) {
  if (tld === "ir") {
    return {
      registrar: "irnic",
      steps_fa: IRNIC_STEPS,
      automated_fa: ["ساخت Zone در DNS لیارا و افزودن دامنه به اپ (با تأیید شما)", "پایش انتشار NS و تأیید دامنه در لیارا"],
      manual_fa: ["تغییر NS در ایرنیک؛ ایرنیک API عمومی برای این کار ندارد"],
    };
  }
  if (tld) {
    return {
      registrar: "generic",
      steps_fa: GENERIC_STEPS,
      automated_fa: ["ساخت Zone و افزودن دامنه به اپ (با تأیید شما)", "پایش انتشار DNS و تأیید دامنه در لیارا"],
      manual_fa: ["ثبت رکورد DNS در پنل ثبت‌کننده‌ی دامنه"],
    };
  }
  return {
    registrar: "unknown",
    steps_fa: GENERIC_STEPS,
    automated_fa: [],
    manual_fa: [],
    note_fa: "نام کامل دامنه را بگویید (مثلاً example.ir) تا مراحل دقیق‌تر شود.",
  };
}

function lastProbeView(p) {
  if (!p) return null;
  return { path: p.path, status: p.status, ms: p.ms, ok: p.ok, rssMB: p.rssMB, heapUsedMB: p.heapUsedMB };
}

async function runL0(core, turn, name, args) {
  switch (name) {
    case "project_analyze": {
      const analyzed = await analyze(core, args.project_path);
      if (analyzed.error) return err(analyzed.error, { next_fa: "فقط پوشه‌ی نمونه یا SOKAN_PROJECT_DIR قابل تحلیل است." });
      turn.profile = analyzed.profile;
      return { status: "ok", data: summarizeProfile(analyzed.profile) };
    }

    case "plans_recommend": {
      const analyzed = await analyze(core, args.project_path);
      if (analyzed.error) return err(analyzed.error);
      turn.profile = analyzed.profile;
      const options = await planOptions(core, analyzed.profile, args.expected_traffic || "medium");
      turn.plans = options;
      core.state.plans = { options };
      return { status: "ok", data: { plans: options.map((o) => ({ planID: o.planID, tier: o.tier, ramMB: o.ramMB, monthlyPriceTomans: o.monthlyPriceTomans, priceSource: o.priceSource })) } };
    }

    case "account_status": {
      const plan = await currentPlan(core);
      if (!core.isLive()) {
        return { status: "ok", data: { mode: "simulated", plan, note_fa: "موجودی حساب فقط در حالت زنده خوانده می‌شود." } };
      }
      const bal = await core.liara.getBalance();
      if (!bal.ok) return { status: "ok", data: { mode: "live", plan, note_fa: "موجودی حساب الان از لیارا خوانده نشد." } };
      const balance = bal.data.balance;
      const months = plan.monthlyPriceTomans > 0 ? Math.round((balance / plan.monthlyPriceTomans) * 10) / 10 : null;
      return { status: "ok", data: { mode: "live", plan, balance_tomans: balance, months_covered: months } };
    }

    case "app_status": {
      const allowed = await manageableApps(core);
      if (args.app && !allowed.includes(args.app)) return err("UNKNOWN_APP", { allowed: allowed.join("، ") });
      const probes = core.probes;
      const lastHealth = [...probes].reverse().find((p) => p.path === "/health") || null;
      const cpu = core.cpuSamples && core.cpuSamples.length > 0 ? core.cpuSamples[core.cpuSamples.length - 1] : null;
      return {
        status: "ok",
        data: {
          app: core.appView(),
          last_probe: lastProbeView(lastHealth),
          recent_probes: probes.slice(-3).map((p) => ({ path: p.path, status: p.status, ms: p.ms })),
          cpu_pct: cpu ? cpu.pct : undefined,
          recent_releases: core.releases.slice(-3).map((r) => core.releaseView(r)),
          incident: core.state.incident ? { id: core.state.incident.id, status: core.state.incident.status } : null,
        },
      };
    }

    case "limits_list":
      turn.limits = LIARA_LIMITS;
      return { status: "ok", data: { limits: LIARA_LIMITS.map((l) => ({ what_fa: l.what_fa, why_fa: l.why_fa, workaround_fa: l.workaround_fa })) } };

    case "domain_connect_guide": {
      const domain = args.domain ? String(args.domain).trim().toLowerCase() : "";
      const tld = args.tld
        ? String(args.tld).trim().toLowerCase().replace(/^\./, "")
        : (domain.includes(".") ? domain.split(".").pop() : "");
      const data = { domain: domain || null, ...domainGuide(domain, tld) };
      if (core.isLive() && domain && core.appName()) {
        const r = core.requestApproval("dns_zone_setup", { domain, project: core.appName() }, {
          title_fa: "ساخت Zone و افزودن دامنه", what_fa: `ساخت Zone برای ${domain} و افزودن آن به اپ ${core.appName()}`,
          why_fa: "اتصال دامنه‌ی کاربر", cost_fa: "بدون هزینه", impact_fa: "بدون قطعی", rollback_fa: "حذف دامنه از کنسول لیارا",
          successCriteria_fa: "Zone ساخته شود و دامنه در لیست دامنه‌های اپ باشد",
        });
        if (r.approval) {
          addApproval(turn, r.approval.id);
          data.approval = { approvalId: r.approval.id, console_url: core.consoleUrl(r.approval.id), risk: r.approval.riskLevel };
        }
      }
      return { status: "ok", data };
    }

    case "sre_investigate": {
      const out = await investigate(core, turn, { symptom: String(args.symptom_fa || "") });
      // The top hypothesis' explanation is not in the investigate payload; take it from the stored incident.
      const top = turn.incident?.hypotheses?.[0];
      if (out.status === "ok" && out.data?.top_hypothesis && top) {
        out.data.top_hypothesis.explain_fa = top.explain_fa;
        out.data.top_hypothesis.confidence_fa = CONFIDENCE_FA[top.confidence] || top.confidence;
      }
      return out;
    }

    default:
      return err("UNKNOWN_TOOL");
  }
}

/** The executeTool given to the Orchestrator. Also used by the HTTP tool endpoint with a throwaway turn. */
function makeToolRunner(core, turn = newTurn()) {
  return async function executeTool(name, args) {
    const spec = findTool(name);
    if (!spec) return err("UNKNOWN_TOOL");
    const input = args ?? {};
    const invalid = validateToolArgs(spec, input);
    if (invalid !== null) return err("INVALID_ARGUMENTS", { missing_or_invalid: invalid });
    const risk = effectiveRisk(spec, input);
    return risk === "L0" || risk === "L1"
      ? runL0(core, turn, name, input)
      : requestMutation(core, turn, name, input);
  };
}

/** POST /api/plans/select: creates the combined create + env + deploy card for one plan. */
async function selectPlan(core, planID) {
  const options = core.state.plans?.options || (await planOptions(core, (await analyze(core)).profile));
  const option = options.find((o) => o.planID === planID || o.id === planID);
  if (!option) return { reply_fa: "این پلن در فهرست پیشنهادی نیست. اول پلن‌ها را بخواهید.", approvals: [] };
  if (core.isLive()) {
    const bal = await core.liara.getBalance();
    if (bal.ok && bal.data.balance < option.monthlyPriceTomans) {
      const short = option.monthlyPriceTomans - bal.data.balance;
      return {
        reply_fa: `موجودی شما برای این پلن کافی نیست؛ کسری ${short.toLocaleString("fa-IR")} تومان است. از کنسول لیارا شارژ کنید: https://console.liara.ir/ و بعد بگویید ادامه دهم.`,
        approvals: [],
      };
    }
  }
  const turn = newTurn();
  const profile = (await analyze(core)).profile;
  const { missing } = valuesFor(core, deployEnvKeys(profile));
  if (missing.length) {
    return { reply_fa: `برای ساخت اپ، مقدار متغیرهای ${missing.join("، ")} لازم است. آن‌ها را در فرم متغیرها وارد کنید.`, approvals: [], needs: missing };
  }
  const r = await requestMutation(core, turn, "deploy", { plan_id: option.planID });
  if (r.status !== "approval_required") return { reply_fa: r.next_fa || "کارت تأیید ساخته نشد.", approvals: [] };
  const approvals = turn.approvals.map((id) => core.publicApproval(id)).filter(Boolean);
  return {
    reply_fa: `کارت تأیید ساخت اپ با پلن ${option.planID} آماده است. تا تأیید نکنید چیزی ساخته نمی‌شود.`,
    approvals,
  };
}

module.exports = {
  newTurn, makeToolRunner, selectPlan, planOptions, analyze, allowedProjectDir, valuesFor, deployEnvKeys,
  manageableApps, appContext,
};

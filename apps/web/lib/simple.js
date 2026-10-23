"use strict";
// Simple mode: the vibe-coder flow (connect -> project -> plan -> publish -> site / diagnose / domain).
// Thin layer over core state, the executor, investigate() and the Liara client. Contract: SIMPLE_SPEC.md.
// Responses are {ok:true, ...} or {ok:false, error:{code, what_fa, why_fa, next_fa}}. The token never leaves this file's
// request handling: it is only ever in the Liara client and the credentials file.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { fixBriefToMarkdown, fa } = require("../../../build/diagnostics/src/index.js");
const { ProjectAnalyzer } = require("../../../build/analyzer/src/index.js");
const { LiaraClient } = require("../../../build/liara-client/src/index.js");
const { SECRET_PARAM_KEY } = require("../../../build/policy/src/index.js");
const { DEMO_DIR, PLAN_LADDER, SIM_DEFAULT_ENVS, sleep, unique } = require("./core");
const { loadCredentials, saveCredentials, clearCredentials } = require("./credentials");
const { readSite, writeSite } = require("./site");
const { deployLive, deploySim, executeApproved } = require("./executor");
const { investigate } = require("./investigate");
const { livePlans } = require("./evidence");
const { newTurn } = require("./tools");

const TOKEN_PAGE_URL = "https://console.liara.ir/API";
const TOPUP_URL = "https://console.liara.ir/settings/billing";
const ENV_KEY_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
const ESTIMATE_HOURLY_TOMANS = { "g2-small": 100, "g2-medium": 220, "g2-pro": 440 };
const HOURS_PER_MONTH = 720;
const PROBE_TIMEOUT_MS = 4000;
const LIVE_URL_WAIT_MS = 90000;
const SIM_URL_WAIT_MS = 5000;
const URL_POLL_MS = 3000;
const STATUS_TTL_MS = 5000;
const ACCOUNT_TTL_MS = 60000;
const ME_TTL_MS = 300000;

const TIERS = [
  { tier: "economy", label_fa: "اقتصادی", minRamMB: 512, rung: 0, recommended: false, fits_fa: "مناسب سایت کوچک و تست؛ در ترافیک زیاد ممکن است کم بیاورد." },
  { tier: "recommended", label_fa: "پیشنهادی", minRamMB: 1024, rung: 1, recommended: true, fits_fa: "حاشیه‌ی امن برای بیشتر سایت‌ها." },
  { tier: "scalable", label_fa: "رشد", minRamMB: 2048, rung: 2, recommended: false, fits_fa: "برای ترافیک بالا و کارهای سنگین." },
];

const PLATFORM_LABELS = {
  node: "Node.js", next: "Next.js", react: "React", vue: "Vue", angular: "Angular", static: "استاتیک",
  python: "Python", django: "Django", flask: "Flask", php: "PHP", laravel: "Laravel", go: "Go",
  dotnet: ".NET", docker: "داکر",
};

// Plain words for the top hypothesis (no ids, no jargon). Keys are hypothesis ids without the "hyp_" prefix.
const PLAIN = {
  missing_env: ["یکی از تنظیمات ضروری سایت در لیارا وارد نشده است.", "تنظیم جاافتاده را اضافه می‌کنم و سایت را دوباره راه می‌اندازم."],
  deploy_regression: ["نسخه‌ی تازه‌ی سایت بعد از انتشار خراب شده است.", "به نسخه‌ی قبلی که درست کار می‌کرد برمی‌گردم."],
  oom_leak: ["سایت حافظه‌اش پر می‌شود و از کار می‌افتد.", "سایت را یک‌بار دوباره راه می‌اندازم تا حافظه آزاد شود."],
  leak_no_oom: ["سایت کم‌کم حافظه‌اش را پر می‌کند.", "سایت را دوباره راه می‌اندازم تا پیش از پر شدن حافظه آزاد شود."],
  undersized_plan: ["پلن فعلی سایت برای حجم کارش کوچک است.", "پلن را به نسخه‌ی بزرگ‌تر تغییر می‌دهم."],
  cpu_saturation: ["پردازنده‌ی سایت زیر بار سنگین است.", "پلنی با پردازنده‌ی بیشتر را پیشنهاد می‌کنم."],
  port_mismatch: ["پورت سایت با پورتی که برنامه روی آن گوش می‌دهد یکی نیست.", "پورت را به پورت درست تغییر می‌دهم."],
  db_unreachable: ["سایت به پایگاه داده وصل نمی‌شود.", "اتصال پایگاه داده را اصلاح و سایت را دوباره راه می‌اندازم."],
  db_pool: ["اتصال‌های پایگاه داده‌ی سایت تمام شده است.", "متن راهنما را برای Cursor یا Claude کپی کنید تا کد اصلاح شود."],
  cache_unreachable: ["سایت به سرویس کش وصل نمی‌شود.", "آدرس کش را اصلاح و سایت را دوباره راه می‌اندازم."],
  disk_full: ["فضای دیسک سایت پر شده است.", "پلن با فضای بیشتر را پیشنهاد می‌کنم."],
  upstream_slow: ["یک سرویس بیرونی که سایت به آن وصل است کند شده.", "متن راهنما را برای Cursor یا Claude کپی کنید تا زمان انتظار کد اصلاح شود."],
  crash_loop: ["سایت پشت‌سرهم خراب و دوباره راه‌اندازی می‌شود.", "به نسخه‌ی پایدار قبلی برمی‌گردم."],
  app_stopped: ["سایت خاموش است.", "سایت را روشن می‌کنم."],
  code_exception: ["در کد سایت خطایی رخ می‌دهد که جلوی پاسخ را می‌گیرد.", "این را باید در کد برطرف کرد؛ متن راهنما را برای Cursor یا Claude کپی کنید."],
};

const IR_STEPS = [
  "وارد سایت ایرنیک (nic.ir) شوید و با حساب خود وارد شوید.",
  "دامنه‌ی خود را باز کنید و گزینه‌ی «تغییر سرورهای نام» (NS) را بزنید.",
  null, // NS 1 (filled from the zone)
  null, // NS 2
  "تغییرات را ذخیره کنید. انتشار تغییر چند دقیقه تا چند ساعت طول می‌کشد؛ بعد «انجام دادم، بررسی کن» را بزنید.",
];
const GENERIC_STEPS = [
  "وارد پنل مدیریت دامنه (ثبت‌کننده‌ی دامنه) شوید.",
  "بخش سرورهای نام (NS) دامنه را پیدا کنید.",
  null,
  null,
  "تغییرات را ذخیره کنید؛ انتشار آن چند دقیقه تا چند ساعت طول می‌کشد. بعد «انجام دادم، بررسی کن» را بزنید.",
];

// ---------- small helpers ----------

const faNum = (n) => Math.round(Number(n) || 0).toLocaleString("fa-IR");
const bad = (status, code, what_fa, why_fa = "", next_fa = "", extra = {}) => ({
  status,
  body: { ok: false, error: { code, what_fa, why_fa, next_fa }, ...extra },
});
const good = (body = {}) => ({ status: 200, body: { ok: true, ...body } });

function state(core) {
  const s = core.simple;
  if (s.client !== core.liara) {
    // Cached account, plans and statuses belong to the previous client (connect, disconnect or try).
    s.client = core.liara;
    s.account = null;
    s.accountAt = 0;
    s.me = null;
    s.meAt = 0;
    s.statusCache = new Map();
  }
  return s;
}

function modeOf(core) {
  if (core.liara.isLive) return "live";
  return state(core).tried ? "simulated" : null;
}

const notConnected = () => bad(
  409,
  "NOT_CONNECTED",
  "هنوز وصل نشده‌اید",
  "کلید لیارا را وارد کنید یا حالت آزمایشی را انتخاب کنید.",
  `کلید را از ${TOKEN_PAGE_URL} بگیرید، یا «بدون حساب امتحان کن» را بزنید.`,
);

function fromLiara(core, status, error, what_fa) {
  return bad(
    error?.code === "UNAUTHORIZED" ? 401 : status,
    error?.code || "LIARA_ERROR",
    core.redact(error?.what_fa || what_fa),
    core.redact(error?.why_fa || ""),
    core.redact(error?.next_fa || ""),
  );
}

function makeLiara(core, token, teamID) {
  return new LiaraClient({ apiToken: token, teamID, baseUrl: core.liaraBaseUrl, dnsBaseUrl: core.liaraDnsUrl, isSimulated: false });
}

function simulatedLiara(core) {
  return new LiaraClient({ isSimulated: true, baseUrl: core.liaraBaseUrl, dnsBaseUrl: core.liaraDnsUrl });
}

// ---------- project ----------

// Names the platform, the shell or Sokan itself sets: never asked for in the project form.
const RESERVED_ENV = new Set(["PORT", "NODE_ENV", "HOME", "PATH", "USER", "SHELL", "PWD", "LANG", "TERM", "TMPDIR"]);
const RESERVED_PREFIX = ["CHAOS_", "DEBUG_", "SOKAN_", "LIARA_", "NPM_", "NODE_"];
const isUserEnvKey = (key) => ENV_KEY_RE.test(key)
  && !RESERVED_PREFIX.some((p) => key.startsWith(p))
  && !RESERVED_ENV.has(key);

/** Liara app name: lowercase a-z0-9-, starts with a letter, 3 to 32 characters, no trailing dash. */
function sanitizeAppName(raw) {
  let s = String(raw ?? "").trim().toLowerCase().replace(/^@[^/]+\//, "");
  s = s.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  s = s.replace(/^[0-9-]+/, "");
  if (!s) s = "my-site";
  if (s.length > 32) s = s.slice(0, 32).replace(/-+$/, "");
  if (s.length < 3) s = `${s}-site`.slice(0, 32).replace(/-+$/, "");
  return s;
}

function readPkgName(dir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    return typeof pkg.name === "string" ? pkg.name : null;
  } catch {
    return null;
  }
}

/** KEY=VALUE pairs of the project's .env. Values only ever go to the pending env store. */
function readDotEnv(dir) {
  const out = new Map();
  let text = "";
  try {
    text = fs.readFileSync(path.join(dir, ".env"), "utf8");
  } catch {
    return out;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m || !ENV_KEY_RE.test(m[1])) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (value.length > 0 && value.length <= 4096) out.set(m[1], value);
  }
  return out;
}

function realOrResolve(p) {
  try {
    return fs.realpathSync(path.resolve(p));
  } catch {
    return path.resolve(p);
  }
}

/** Home, the server's working directory, SOKAN_PROJECT_DIR and the demo target. Never a filesystem root. */
function allowedRoots(core) {
  return unique([os.homedir(), process.cwd(), core.env.SOKAN_PROJECT_DIR, DEMO_DIR]
    .filter(Boolean)
    .map(realOrResolve))
    .filter((root) => root !== path.parse(root).root);
}

function defaultDir(core) {
  return core.env.SOKAN_PROJECT_DIR || process.cwd();
}

function resolveProjectDir(core, requested) {
  let input = requested === undefined || requested === null || requested === "" ? defaultDir(core) : String(requested);
  if (input.startsWith("~")) input = path.join(os.homedir(), input.slice(1));
  let real;
  try {
    real = fs.realpathSync(path.resolve(process.cwd(), input));
  } catch {
    return { error: "NOT_FOUND" };
  }
  let isDir = false;
  try {
    isDir = fs.statSync(real).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) return { error: "NOT_DIR" };
  const inside = allowedRoots(core).some((root) => real === root || real.startsWith(root + path.sep));
  if (!inside) return { error: "OUTSIDE" };
  return { dir: real };
}

async function buildProject(core, dir) {
  const profile = await ProjectAnalyzer.analyze(dir);
  const dotEnv = readDotEnv(dir);
  for (const [key, value] of dotEnv) {
    if (!core.pendingEnvs.has(key)) {
      core.pendingEnvs.set(key, value);
      core.registerSecret(value);
    }
  }
  const keys = unique([...(profile.requiredEnvs || []), ...dotEnv.keys()]).filter(isUserEnvKey);
  const platform = profile.detectedPlatform;
  const label = PLATFORM_LABELS[platform] || platform;
  const port = profile.detectedPort;
  return {
    dir,
    platform,
    platformLabel_fa: label,
    port,
    summary_fa: `یک سایت ${label} پیدا کردم. روی پورت ${fa(port)} اجرا می‌شود.`,
    appName: sanitizeAppName(readPkgName(dir) || path.basename(dir)),
    keys,
    dotEnvKeys: new Set(dotEnv.keys()),
  };
}

function hasValue(core, key) {
  if (core.pendingEnvs.has(key)) return true;
  return !core.liara.isLive && SIM_DEFAULT_ENVS[key] !== undefined;
}

function projectView(core, project) {
  return {
    dir: project.dir,
    platform: project.platform,
    platformLabel_fa: project.platformLabel_fa,
    port: project.port,
    summary_fa: project.summary_fa,
    appName: project.appName,
    envs: project.keys.map((key) => ({
      key,
      secret: SECRET_PARAM_KEY.test(key),
      hasValue: hasValue(core, key),
      fromDotEnv: project.dotEnvKeys.has(key),
    })),
  };
}

function selectProject(core, project) {
  state(core).project = project;
  if (core.liara.isLive) core.liveAppName = project.appName;
}

async function ensureDefaultProject(core) {
  const r = resolveProjectDir(core, undefined);
  if (r.error) return null;
  const project = await buildProject(core, r.dir);
  selectProject(core, project);
  return project;
}

async function postProject(core, body) {
  const r = resolveProjectDir(core, body.dir);
  if (r.error === "NOT_FOUND") return bad(404, "PROJECT_NOT_FOUND", "پوشه‌ی پروژه پیدا نشد", "مسیر را بررسی کنید.", "مسیر پوشه‌ی سایت را دوباره وارد کنید.");
  if (r.error === "NOT_DIR") return bad(400, "PROJECT_NOT_DIR", "این مسیر یک پوشه نیست", "به جای آن مسیر پوشه‌ی سایت را بدهید.", "مسیر پوشه‌ی سایت را وارد کنید.");
  if (r.error === "OUTSIDE") {
    return bad(
      403,
      "PROJECT_OUTSIDE_ALLOWED",
      "این پوشه خارج از مسیر مجاز است",
      "برای امنیت، فقط پوشه‌های داخل خانه‌ی شما یا پوشه‌ای که سُکان از آن اجرا شده قابل انتخاب‌اند.",
      "پوشه‌ی سایت را داخل خانه‌تان نگه دارید یا سُکان را از داخل پوشه‌ی سایت اجرا کنید.",
    );
  }
  let project;
  try {
    project = await buildProject(core, r.dir);
  } catch (err) {
    return bad(500, "ANALYZE_FAILED", "تحلیل پروژه انجام نشد", core.redact(err && err.message ? err.message : ""), "پوشه را بررسی کنید و دوباره تلاش کنید.");
  }
  selectProject(core, project);
  return good({ project: projectView(core, project) });
}

function postAppName(core, body) {
  const s = state(core);
  if (!s.project) return bad(409, "NO_PROJECT", "هنوز پروژه‌ای انتخاب نشده", "اول پوشه‌ی سایت را مشخص کنید.", "مرحله‌ی پروژه را کامل کنید.");
  if (typeof body.name !== "string" || body.name.trim().length === 0 || body.name.length > 100) {
    return bad(400, "INVALID_APP_NAME", "نام اپ معتبر نیست", "نام اپ فقط حروف انگلیسی کوچک، عدد و خط تیره دارد.", "یک نام کوتاه انگلیسی بنویسید.");
  }
  s.project.appName = sanitizeAppName(body.name);
  if (core.liara.isLive) core.liveAppName = s.project.appName;
  return good({ appName: s.project.appName });
}

function postEnvs(core, body) {
  const list = body.variables;
  if (!Array.isArray(list) || list.length === 0 || list.length > 50) {
    return bad(400, "INVALID_VARIABLES", "فهرست متغیرها خالی یا نامعتبر است.", "", "نام و مقدار هر متغیر را وارد کنید.");
  }
  for (const item of list) {
    if (!item || typeof item !== "object" || typeof item.key !== "string" || !ENV_KEY_RE.test(item.key)
      || typeof item.value !== "string" || item.value.length === 0 || item.value.length > 4096) {
      return bad(400, "INVALID_VARIABLES", "نام یا مقدار یکی از متغیرها نامعتبر است.", "نام متغیر فقط حروف بزرگ انگلیسی، عدد و زیرخط دارد.", "دوباره وارد کنید.");
    }
  }
  for (const item of list) {
    core.pendingEnvs.set(item.key, item.value);
    core.registerSecret(item.value);
  }
  core.emit("state", {});
  // Values are stored for the next approval card and never echoed back.
  return good({ keys: list.map((i) => i.key) });
}

// ---------- account, connection ----------

async function loadMe(core) {
  const s = state(core);
  if (s.me && Date.now() - s.meAt < ME_TTL_MS) return s.me;
  const r = await core.liara.validateToken();
  if (!r.ok) return null;
  s.me = r.data || {};
  s.meAt = Date.now();
  return s.me;
}

async function accountView(core) {
  const s = state(core);
  if (s.account && Date.now() - s.accountAt < ACCOUNT_TTL_MS) return s.account;
  const me = await loadMe(core);
  if (!me) return s.account;
  const user = me.user || {};
  const bal = await core.liara.getBalance();
  s.account = {
    name: core.redact(String(user.fullname || user.email || "حساب لیارا")),
    ...(user.email ? { email: core.redact(String(user.email)) } : {}),
    ...(bal.ok ? { balanceTomans: bal.data.balance } : {}),
  };
  s.accountAt = Date.now();
  return s.account;
}

async function postConnect(core, body) {
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token || token.length > 512 || /\s/.test(token)) {
    return bad(400, "INVALID_TOKEN", "کلید وارد‌شده درست به نظر نمی‌رسد", "کلید خالی است یا فاصله دارد.", `کلید را از ${TOKEN_PAGE_URL} کپی کنید.`);
  }
  const teamID = typeof body.teamID === "string" && body.teamID.trim() ? body.teamID.trim().slice(0, 64) : undefined;
  const remember = body.remember !== false;
  core.registerSecret(token);
  const client = makeLiara(core, token, teamID);
  const me = await client.validateToken();
  if (!me.ok) {
    return fromLiara(core, 502, me.error, "اتصال به لیارا انجام نشد");
  }
  core.setLiara(client);
  const s = state(core);
  s.tried = false;
  s.me = me.data || {};
  s.meAt = Date.now();
  const saved = remember ? saveCredentials(core.stateDir, { token, teamID }) : (clearCredentials(core.stateDir), false);
  const account = await accountView(core);
  return good({ account: account || { name: "حساب لیارا" }, remembered: saved });
}

function postTry(core) {
  state(core).tried = true;
  core.setLiara(simulatedLiara(core));
  return good({ mode: "simulated" });
}

function postDisconnect(core) {
  const s = state(core);
  clearCredentials(core.stateDir);
  s.tried = false;
  s.me = null;
  s.account = null;
  core.setLiara(core.envLiara || simulatedLiara(core));
  return good({
    mode: core.envLiara ? "live" : null,
    ...(core.envLiara ? { note_fa: "کلید از متغیر LIARA_API_TOKEN می‌آید و از این صفحه حذف نمی‌شود." } : {}),
  });
}

async function session(core) {
  const s = state(core);
  const body = { ok: true, connected: core.liara.isLive, mode: modeOf(core), auditOk: core.auditOk() };
  if (core.liara.isLive) {
    const account = await accountView(core).catch(() => null);
    if (account) body.account = account;
    if (!s.project) await ensureDefaultProject(core).catch(() => null);
  }
  if (s.project) body.project = projectView(core, s.project);
  if (s.site) body.site = await siteView(core, s.site);
  return good(body);
}

// ---------- plans ----------

function cheapestBundle(me, planID) {
  const bundles = me?.plans?.projectBundlePlans?.[planID];
  if (!bundles || typeof bundles !== "object") return null;
  const list = Object.entries(bundles)
    .filter(([, b]) => b && typeof b === "object" && b.available === true)
    .map(([id, b]) => ({ id, price: Number(b.displayPrice) || 0 }))
    .sort((a, b) => a.price - b.price);
  return list[0] || null;
}

/** Three plan options. Live: the cheapest available plan with enough RAM, priced from the account catalogue. */
async function planOptions(core) {
  const live = core.liara.isLive;
  if (!live) {
    const list = TIERS.map((t) => {
      const rung = PLAN_LADDER[t.rung];
      const monthly = ESTIMATE_HOURLY_TOMANS[rung.planID] * HOURS_PER_MONTH;
      return {
        planID: rung.planID, bundlePlanID: null, tier: t.tier, label_fa: t.label_fa, ramMB: rung.ramMB, cpu: rung.cpu,
        monthlyTomans: monthly, fits_fa: t.fits_fa, recommended: t.recommended, priceSource: "estimate",
      };
    });
    return { list };
  }
  const catalog = await livePlans(core);
  if (!catalog) {
    return { error: bad(502, "PLANS_UNAVAILABLE", "فهرست پلن‌های لیارا خوانده نشد", "", "چند لحظه بعد دوباره تلاش کنید.") };
  }
  const me = await loadMe(core);
  const list = [];
  for (const t of TIERS) {
    const pick = catalog
      .filter((p) => p.available && p.planID !== "free" && (!p.region || p.region === "iran") && typeof p.ram === "number" && p.ram >= t.minRamMB)
      .sort((a, b) => a.monthlyPrice - b.monthlyPrice)[0];
    if (!pick) continue;
    const bundle = cheapestBundle(me, pick.planID);
    list.push({
      planID: pick.planID,
      bundlePlanID: bundle ? bundle.id : null,
      tier: t.tier,
      label_fa: t.label_fa,
      ramMB: pick.ram,
      cpu: pick.cpu ?? null,
      monthlyTomans: Math.round(pick.monthlyPrice + (bundle ? bundle.price : 0)),
      fits_fa: t.fits_fa,
      recommended: t.recommended,
      priceSource: "liara",
    });
  }
  return { list, catalog };
}

async function getPlans(core) {
  if (!modeOf(core)) return notConnected();
  const opts = await planOptions(core);
  if (opts.error) return opts.error;
  const body = {
    ok: true,
    plans: opts.list,
    topupUrl: TOPUP_URL,
  };
  if (core.liara.isLive) {
    const bal = await core.liara.getBalance();
    if (bal.ok) {
      body.balanceTomans = bal.data.balance;
      const rec = opts.list.find((o) => o.recommended);
      if (rec) body.shortfallTomans = Math.max(0, rec.monthlyTomans - bal.data.balance);
    }
  }
  return good(body);
}

// ---------- deploy ----------

function siteAppName(s) {
  return (s.site && s.site.appName) || (s.project && s.project.appName) || null;
}

function confirmView(core, approval) {
  return {
    approvalId: approval.id,
    title_fa: approval.card.title_fa,
    bullets_fa: Array.isArray(approval.card.bullets_fa) ? approval.card.bullets_fa : [],
    cost_fa: approval.card.cost_fa,
    risk: approval.riskLevel,
    expiresAt: approval.expiresAt,
    mode: core.mode(),
  };
}

async function monthlyOfExisting(core, planID, fallback) {
  const catalog = await livePlans(core);
  const pick = Array.isArray(catalog) ? catalog.find((p) => p.planID === planID) : undefined;
  return pick ? Math.round(pick.monthlyPrice) : fallback;
}

/** Builds the one-tap deploy (or redeploy) card. Nothing runs until POST /api/simple/confirm/:id. */
async function prepareDeploy(core, body, kind) {
  const s = state(core);
  const mode = modeOf(core);
  if (!mode) return notConnected();
  const project = s.project;
  if (!project) return bad(409, "NO_PROJECT", "هنوز پروژه‌ای انتخاب نشده", "پوشه‌ی سایت را در مرحله‌ی پروژه مشخص کنید.", "پوشه‌ی سایت را انتخاب کنید.");
  const live = core.liara.isLive;
  const appName = project.appName;
  let planID;
  let bundlePlanID;
  let monthly;
  if (kind === "redeploy") {
    if (!s.site) return bad(409, "NO_SITE", "هنوز سایتی منتشر نشده", "اول سایت را برای بار اول منتشر کنید.", "«سایتم را بالا بیاور» را بزنید.");
    planID = s.site.planID;
    bundlePlanID = s.site.bundlePlanID;
    monthly = s.site.monthlyTomans || 0;
  } else {
    const requested = typeof body.planID === "string" ? body.planID : "";
    const opts = await planOptions(core);
    if (opts.error) return opts.error;
    const option = opts.list.find((o) => o.planID === requested || o.tier === requested);
    if (!option) return bad(400, "PLAN_NOT_FOUND", "این پلن در فهرست پیشنهادی نیست", "", "یکی از سه پلن پیشنهادی را انتخاب کنید.");
    planID = option.planID;
    bundlePlanID = option.bundlePlanID;
    monthly = option.monthlyTomans;
  }

  let exists = false;
  if (live) {
    const app = await core.liara.getApp(appName);
    if (app.ok) {
      exists = true;
      // An existing app keeps its own plan; the card shows that plan and its real monthly price.
      planID = app.data.project.planID || planID;
      monthly = await monthlyOfExisting(core, planID, monthly);
      bundlePlanID = undefined;
    } else if (app.error?.code !== "NOT_FOUND") {
      return fromLiara(core, 502, app.error, "خواندن اپ از لیارا انجام نشد");
    }
    if (kind === "redeploy" && !exists) {
      return bad(409, "APP_MISSING", "اپ در حساب لیارا پیدا نشد", "شاید از پنل لیارا حذف شده باشد.", "سایت را دوباره از اول منتشر کنید.");
    }
    if (!exists) {
      const bal = await core.liara.getBalance();
      if (bal.ok && bal.data.balance < monthly) {
        const shortfall = monthly - bal.data.balance;
        return bad(
          402,
          "INSUFFICIENT_BALANCE",
          `موجودی کافی نیست؛ ${faNum(shortfall)} تومان کم داری`,
          "هزینه‌ی ماه اول این پلن از موجودی حساب بیشتر است.",
          "حساب را شارژ کنید و بعد «شارژ کردم» را بزنید.",
          { shortfallTomans: shortfall, topupUrl: TOPUP_URL },
        );
      }
    }
  }

  const variables = [];
  const missing = [];
  for (const key of project.keys) {
    if (core.pendingEnvs.has(key)) variables.push({ key, value: core.pendingEnvs.get(key) });
    else if (!live && SIM_DEFAULT_ENVS[key] !== undefined) variables.push({ key, value: SIM_DEFAULT_ENVS[key] });
    else missing.push(key);
  }
  if (missing.length > 0) {
    return bad(
      400,
      "MISSING_ENV_VALUES",
      "مقدار چند متغیر هنوز وارد نشده",
      `متغیرهای ${missing.join("، ")} لازم‌اند.`,
      "مقدار آن‌ها را در فرم متغیرها وارد کنید.",
      { keys: missing },
    );
  }

  const params = {
    project: appName,
    planID,
    ...(bundlePlanID && !exists ? { bundlePlanID } : {}),
    port: live ? project.port : core.app.basePort,
    platform: project.platform,
    dir: project.dir,
    variables,
  };
  const keysText = variables.map((v) => v.key).join("، ");
  const bullets = [
    `سایت ${appName} ${exists ? "به‌روز" : "ساخته"} می‌شود.`,
    variables.length > 0 ? `مقدار ${faNum(variables.length)} متغیر (${keysText}) تنظیم می‌شود.` : "متغیری تنظیم نمی‌شود.",
    "حدود یک دقیقه طول می‌کشد و در این مدت سایت ممکن است کند یا قطع شود.",
  ];
  const costFa = live
    ? (exists
      ? `هزینه‌ی تازه‌ای ندارد؛ هزینه‌ی ماهانه‌ی پلن فعلی ${faNum(monthly)} تومان است`
      : `${faNum(monthly)} تومان در ماه`)
    : `(شبیه‌سازی محلی) پرداختی انجام نمی‌شود؛ هزینه‌ی واقعی حدود ${faNum(monthly)} تومان در ماه است`;
  const card = {
    title_fa: exists || kind === "redeploy" ? "انتشار نسخه‌ی جدید" : "ساخت و انتشار سایت",
    what_fa: `انتشار ${appName} روی پلن ${planID}`,
    why_fa: "شما خواستید سایتتان آنلاین شود.",
    cost_fa: costFa,
    impact_fa: "حدود یک دقیقه؛ در این مدت سایت ممکن است کند یا قطع باشد.",
    rollback_fa: "اگر سایت خراب شد، «سایتم مشکل داره» را بزنید.",
    successCriteria_fa: "سایت به آدرس اینترنتی‌اش جواب بدهد.",
    bullets_fa: bullets,
  };
  const r = core.requestApproval("deploy", params, card, { source: "simple", kind });
  if (!r.approval) return bad(500, "APPROVAL_FAILED", "کارت تأیید ساخته نشد", "", "دوباره تلاش کنید.");
  s.costs.set(r.approval.id, { monthlyTomans: monthly, appName, planID, bundlePlanID: bundlePlanID || null });
  return good({ confirm: confirmView(core, r.approval) });
}

function postCancel(core, id) {
  if (!core.approvals.cancel(id)) {
    return bad(409, "NOT_CANCELLABLE", "این کار دیگر لغو نمی‌شود", "شاید قبلاً انجام شده یا لغو شده است.", "دوباره از اول شروع کنید.");
  }
  return good();
}

async function postConfirm(core, id, body) {
  const approval = core.approvals.get(id);
  if (!approval) return bad(404, "APPROVAL_NOT_FOUND", "این کار پیدا نشد", "", "دوباره از اول شروع کنید.");
  if (approval.status !== "pending") {
    return bad(409, "NOT_PENDING", "این کار قبلاً انجام شده یا لغو شده", "", "دوباره از اول شروع کنید.");
  }
  const typed = typeof body.typed === "string" ? body.typed : undefined;
  const decision = core.approvals.approve(id, typed);
  if (!decision.ok) return bad(400, decision.code, "تأیید انجام نشد", "", "دوباره تلاش کنید.");
  const jobId = core.randomId("job");
  core.approvals.scheduleExecution(id, decision.risk === "L3" ? 10000 : 300, () => core.enqueueAction(() => runJob(core, id, jobId)));
  core.emit("approval", core.approvals.get(id));
  progress(core, jobId, "create", 2, "کار شروع شد");
  return good({ jobId });
}

function progress(core, jobId, step, percent, message_fa, detail) {
  core.emit("simple_progress", { jobId, step, percent, message_fa, ...(detail ? { detail } : {}) });
}

function finish(core, jobId, ok, message_fa, extra = {}) {
  core.emit("simple_result", { jobId, ok, message_fa, mode: core.mode(), ...extra });
}

/** Maps the executor's live deploy stages to the Simple progress steps. */
function deployProgressMapper(core, jobId, lines) {
  return (stage, message_fa, line) => {
    if (line) {
      lines.push(line);
      progress(core, jobId, "build", Math.min(80, 60 + lines.length), message_fa, line);
      return;
    }
    const map = {
      create: ["create", 10],
      envs: ["envs", 20],
      pack: ["pack", 30],
      upload: ["upload", 45],
      release: ["build", 55],
      build: ["build", 60],
      ready: ["start", 85],
    };
    const hit = map[stage];
    if (hit) progress(core, jobId, hit[0], hit[1], message_fa);
  };
}

function probeUrl(url, timeoutMs = PROBE_TIMEOUT_MS) {
  return fetch(url, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs) })
    .then(async (res) => {
      await res.arrayBuffer().catch(() => undefined);
      return { known: true, up: res.status < 500 };
    })
    .catch(() => ({ known: true, up: false }));
}

async function waitForUrl(core, jobId, url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  for (;;) {
    const r = await probeUrl(url);
    if (r.up) return true;
    if (Date.now() >= deadline) return false;
    attempt += 1;
    progress(core, jobId, "check", Math.min(98, 90 + attempt), "سایت را بررسی می‌کنم تا جواب بدهد");
    await sleep(URL_POLL_MS);
  }
}

function buildFailureText(lines, error) {
  const joined = lines.join("\n");
  if (/Cannot find module|MODULE_NOT_FOUND/i.test(joined)) return "یک کتابخانه‌ی پروژه پیدا نشد؛ فایل package.json و نصب وابستگی‌ها را بررسی کنید.";
  if (/npm ERR!|npm error/i.test(joined)) return "ساخت سایت با خطای npm متوقف شد.";
  if (/Permission denied/i.test(joined)) return "ساخت سایت به یک فایل بدون دسترسی برخورد.";
  if (/out of memory|heap/i.test(joined)) return "ساخت سایت از حافظه‌ی لازم بیشتر خواست.";
  return error?.what_fa || "ساخت سایت ناموفق بود.";
}

function buildFailureBrief(error, lines) {
  const tail = lines.slice(-30).join("\n");
  return [
    "# خطای انتشار سایت (Sokan)",
    "",
    `خطا: ${error?.what_fa || "نامشخص"}`,
    error?.why_fa ? `دلیل: ${error.why_fa}` : "",
    "",
    "## آخرین خط‌های بیلد",
    "",
    "```",
    tail || "(لاگی ثبت نشد)",
    "```",
    "",
  ].filter((x) => x !== undefined).join("\n");
}

async function runDeploy(core, id, jobId, params) {
  const s = state(core);
  const auth = core.approvals.authorize("deploy", params, id, "user");
  if (!auth.ok) {
    finish(core, jobId, false, "اجرا به‌دلیل عدم تطابق تأیید متوقف شد.", { error: { code: auth.code, what_fa: "اجرا متوقف شد", why_fa: `کد رد: ${auth.code}`, next_fa: "دوباره از اول شروع کنید." } });
    return;
  }
  const live = core.liara.isLive;
  const mode = core.mode();
  const started = Date.now();
  const lines = [];
  const emitStage = deployProgressMapper(core, jobId, lines);
  let result;
  try {
    result = live ? await deployLive(core, params, emitStage) : await deploySim(core, params, emitStage);
  } catch (err) {
    result = { ok: false, error: { what_fa: "انتشار با خطا متوقف شد.", why_fa: core.redact(err && err.message ? err.message : ""), next_fa: "دوباره تلاش کنید." } };
  }
  const durationMs = Date.now() - started;
  if (!result.ok) {
    const text = buildFailureText(lines, result.error);
    core.approvals.recordResult("deploy", params, "user", false, core.redact(text), id, { mode, durationMs });
    progress(core, jobId, "failed", 100, text);
    finish(core, jobId, false, text, {
      error: { code: "DEPLOY_FAILED", what_fa: text, why_fa: core.redact(result.error?.why_fa || ""), next_fa: core.redact(result.error?.next_fa || "") },
      ...(lines.length > 0 ? { fixBriefMarkdown: core.redact(buildFailureBrief(result.error, lines)) } : {}),
    });
    return;
  }
  const url = live ? core.liveUrl(params.project) : `http://127.0.0.1:${core.app.port}`;
  progress(core, jobId, "check", 90, "سایت را بررسی می‌کنم تا جواب بدهد");
  const reachable = await waitForUrl(core, jobId, url, live ? LIVE_URL_WAIT_MS : SIM_URL_WAIT_MS);
  core.approvals.recordResult("deploy", params, "user", true, core.redact(result.detail_fa || ""), id, { mode, durationMs: Date.now() - started });
  const cost = s.costs.get(id) || {};
  const site = {
    appName: params.project,
    url,
    planID: params.planID,
    ...(params.bundlePlanID ? { bundlePlanID: params.bundlePlanID } : {}),
    ...(cost.monthlyTomans !== undefined ? { monthlyTomans: cost.monthlyTomans } : {}),
    lastDeployAt: new Date().toISOString(),
  };
  writeSite(core.stateDir, site);
  s.site = site;
  if (!reachable) {
    progress(core, jobId, "failed", 100, "سایت ساخته شد ولی هنوز جواب نمی‌دهد.");
    finish(core, jobId, false, "نسخه منتشر شد، ولی سایت هنوز جواب نمی‌دهد. چند دقیقه بعد دوباره «سایتم مشکل داره» را بزنید.", { url });
    return;
  }
  progress(core, jobId, "done", 100, "سایت آنلاین است");
  finish(core, jobId, true, "سایتت آنلاین شد 🎉", { url });
}

async function runDnsFinalize(core, id, jobId, params) {
  const auth = core.approvals.authorize("dns_finalize", params, id, "user");
  if (!auth.ok) {
    finish(core, jobId, false, "اجرا به‌دلیل عدم تطابق تأیید متوقف شد.", { error: { code: auth.code, what_fa: "اجرا متوقف شد", why_fa: "", next_fa: "دوباره از اول شروع کنید." } });
    return;
  }
  progress(core, jobId, "domain", 30, "رکورد DNS را ثبت می‌کنم");
  const record = await core.liara.upsertRecord(params.domain, {
    name: params.recordName,
    type: params.recordType,
    ttl: 300,
    contents: [{ domain: params.target }],
  });
  if (!record.ok) {
    const text = core.redact(record.error?.what_fa || "ثبت رکورد DNS انجام نشد");
    core.approvals.recordResult("dns_finalize", params, "user", false, text, id, { mode: core.mode() });
    progress(core, jobId, "failed", 100, text);
    finish(core, jobId, false, text, { error: fromLiaraError(core, record.error) });
    return;
  }
  progress(core, jobId, "fix", 70, "گواهی امن (SSL) را درخواست می‌کنم");
  const ssl = await core.liara.provisionSsl(params.domain);
  core.approvals.recordResult("dns_finalize", params, "user", ssl.ok, ssl.ok ? "ok" : "ssl", id, { mode: core.mode() });
  if (!ssl.ok) {
    const text = "رکورد ثبت شد، ولی گواهی امن هنوز صادر نشد. چند دقیقه بعد دوباره امتحان کنید.";
    progress(core, jobId, "failed", 100, text);
    finish(core, jobId, false, text, { error: fromLiaraError(core, ssl.error) });
    return;
  }
  progress(core, jobId, "done", 100, "دامنه آماده است");
  finish(core, jobId, true, `دامنه‌ات آماده است: https://${params.domain}`, { url: `https://${params.domain}` });
}

function fromLiaraError(core, error) {
  return {
    code: error?.code || "LIARA_ERROR",
    what_fa: core.redact(error?.what_fa || ""),
    why_fa: core.redact(error?.why_fa || ""),
    next_fa: core.redact(error?.next_fa || ""),
  };
}

const MITIGATED_TEXT = "موقتاً درست شد؛ راه‌حل اصلی در کد است — Fix Brief را به Cursor/Claude بده";

function fixMessage(out) {
  const v = out.verification;
  const check = v && Array.isArray(v.checks)
    ? v.checks.find((c) => c.criterion && c.criterion.kind === "probe_ok" && typeof c.before === "number" && typeof c.after === "number")
    : null;
  if (check) {
    const label = (code) => (code >= 500 ? `خطای ${fa(code)}` : `پاسخ ${fa(code)}`);
    return `درست شد ✅ — قبل: ${label(check.before)}، بعد: ${label(check.after)}`;
  }
  return "درست شد ✅";
}

async function runFix(core, id, jobId) {
  const out = await executeApproved(core, id, {
    onStep: (step, message) => progress(core, jobId, step === "fix" ? "fix" : "verify", step === "fix" ? 25 : 80, message),
  });
  const verification = out.verification ? { passed: out.verification.passed, summary_fa: core.redact(out.verification.summary_fa) } : undefined;
  if (!out.ok) {
    progress(core, jobId, "failed", 100, "این کار انجام نشد.");
    finish(core, jobId, false, core.redact(out.error?.what_fa || "این کار انجام نشد."), { error: fromLiaraError(core, out.error) });
    return;
  }
  if (out.resolved) {
    progress(core, jobId, "done", 100, "درست شد");
    finish(core, jobId, true, fixMessage(out), { outcome: "resolved", ...(verification ? { verification } : {}) });
    return;
  }
  if (out.outcome === "mitigated") {
    // The restart only relieves the symptom; the real fix is in the code, so the user gets the Fix Brief.
    const brief = core.state.fixBrief ? core.redact(fixBriefToMarkdown(core.state.fixBrief)) : undefined;
    progress(core, jobId, "done", 100, "موقتاً مهار شد");
    finish(core, jobId, true, MITIGATED_TEXT, {
      outcome: "mitigated",
      ...(verification ? { verification } : {}),
      ...(brief ? { fixBriefMarkdown: brief } : {}),
    });
    return;
  }
  progress(core, jobId, "failed", 100, "هنوز درست نشده");
  finish(core, jobId, false, `هنوز درست نشده. ${verification ? verification.summary_fa : ""} «سایتم مشکل داره» را دوباره بزنید تا تحلیل تازه شود.`.trim(), {
    ...(verification ? { verification } : {}),
  });
}

async function runZoneSetup(core, id, jobId) {
  const zoneParams = core.approvals.getApprovedParams(id);
  const out = await executeApproved(core, id, {
    onStep: (step, message) => progress(core, jobId, "domain", step === "fix" ? 40 : 80, message),
  });
  if (!out.ok) {
    finish(core, jobId, false, core.redact(out.error?.what_fa || "تنظیم دامنه انجام نشد."), { error: fromLiaraError(core, out.error) });
    return;
  }
  const domain = (zoneParams && zoneParams.domain) || null;
  const nameservers = domain ? await fetchNameservers(core, domain) : [];
  progress(core, jobId, "done", 100, "منطقه‌ی DNS ساخته شد");
  finish(core, jobId, true, nameservers.length > 0
    ? `دامنه به لیارا اضافه شد. این سرورهای نام را در ایرنیک ثبت کنید: ${nameservers.join("، ")}`
    : "دامنه به لیارا اضافه شد. سرورهای نام را از بخش دامنه بخوانید.", { nameservers });
}

async function runJob(core, id, jobId) {
  const approval = core.approvals.get(id);
  if (!approval) return;
  const params = core.approvals.getApprovedParams(id) || {};
  try {
    if (approval.tool === "deploy") return await runDeploy(core, id, jobId, params);
    if (approval.tool === "dns_finalize") return await runDnsFinalize(core, id, jobId, params);
    if (approval.tool === "dns_zone_setup") return await runZoneSetup(core, id, jobId);
    return await runFix(core, id, jobId);
  } catch (err) {
    progress(core, jobId, "failed", 100, "کار با خطا متوقف شد.");
    finish(core, jobId, false, "کار با خطا متوقف شد. دوباره تلاش کنید.", {
      error: { code: "INTERNAL", what_fa: "کار با خطا متوقف شد.", why_fa: core.redact(err && err.message ? err.message : ""), next_fa: "دوباره تلاش کنید." },
    });
    return undefined;
  }
}

// ---------- site ----------

async function probeSiteStatus(core, site) {
  const s = state(core);
  const cached = s.statusCache.get(site.url);
  if (cached && Date.now() - cached.at < STATUS_TTL_MS) return cached.status;
  let status = "down";
  if (!core.liara.isLive) {
    const http = await probeUrl(`${site.url}/health`);
    status = http.up ? "up" : "down";
  } else {
    const [http, applets] = await Promise.all([probeUrl(site.url), core.liara.getApplets(site.appName)]);
    const list = applets.ok ? (Array.isArray(applets.data) ? applets.data : applets.data?.applets || []) : null;
    const running = list ? list.some((a) => String(a.state).toLowerCase() === "running") : null;
    if (http.up && running !== false) status = "up";
    else if (http.up || running === true) status = "degraded";
    else status = "down";
  }
  s.statusCache.set(site.url, { at: Date.now(), status });
  return status;
}

async function siteView(core, site) {
  return {
    appName: site.appName,
    url: site.url,
    status: await probeSiteStatus(core, site),
    ...(site.lastDeployAt ? { lastDeployAt: site.lastDeployAt } : {}),
    ...(site.monthlyTomans !== undefined ? { monthlyTomans: site.monthlyTomans } : {}),
    ...(site.planID ? { planID: site.planID } : {}),
  };
}

// ---------- diagnose ----------

async function diagnose(core, body) {
  if (!modeOf(core)) return notConnected();
  if (core.liara.isLive && !core.appName()) {
    return bad(409, "NO_SITE", "هنوز سایتی انتخاب نشده", "اول سایت را منتشر کنید یا پروژه را انتخاب کنید.", "پوشه‌ی سایت را انتخاب کنید.");
  }
  const symptom = typeof body.symptom_fa === "string" && body.symptom_fa.trim() ? body.symptom_fa.trim().slice(0, 300) : "سایتم مشکل داره";
  const turn = newTurn();
  const out = await investigate(core, turn, { symptom });
  const brief = core.state.fixBrief ? core.redact(fixBriefToMarkdown(core.state.fixBrief)) : "";
  if (out.status !== "ok") {
    return bad(409, out.error || "DIAGNOSE_FAILED", "اول باید سایت مشخص شود", out.next_fa || "", "پوشه‌ی سایت را انتخاب کنید.");
  }
  const data = out.data;
  const incident = core.state.incident;
  const details = {
    hypotheses: (incident?.hypotheses || []).map((h) => ({ title_fa: h.title_fa, confidence: h.confidence, score: h.score })),
    evidence: (incident?.evidence || []).slice(0, 20).map((e) => ({ id: e.id, summary_fa: e.summary })),
  };
  const top = data.top_hypothesis;
  const created = data.approvals_created || [];
  const confident = !!top && (top.confidence === "high" || top.confidence === "medium");
  if (!confident) {
    for (const id of created) core.approvals.cancel(id);
    if (incident && incident.status === "awaiting_approval") incident.status = "diagnosed";
    return good({
      found: false,
      incidentStatus: incident?.status,
      problem_fa: "با اطلاعات فعلی نتوانستم علت قطعی را پیدا کنم.",
      solution_fa: "متن راهنما را برای Cursor یا Claude کپی کنید، یا لاگ‌ها را ببینید.",
      fixBriefMarkdown: brief,
      details,
    });
  }
  const key = top.id.replace(/^hyp_/, "");
  const [problem_fa, plain] = PLAIN[key] || [top.title_fa, top.remediations[0]?.label_fa || ""];
  const needs = (data.needs_values || []).flatMap((n) => n.keys || []);
  const solution_fa = needs.length > 0
    ? `برای این کار مقدار ${needs.join("، ")} لازم است؛ آن را در فرم متغیرها وارد کنید.`
    : plain;
  // One card at a time: the first executable remediation is offered; the rest are withdrawn.
  for (const id of created.slice(1)) core.approvals.cancel(id);
  const first = created[0] ? core.approvals.get(created[0]) : undefined;
  const confirm = first && first.status === "pending" ? confirmView(core, first) : undefined;
  return good({
    found: true,
    incidentStatus: incident?.status,
    problem_fa,
    solution_fa,
    ...(confirm ? { confirm } : {}),
    fixBriefMarkdown: brief,
    details,
  });
}

// ---------- domain ----------

function normalizeDomain(raw) {
  if (typeof raw !== "string") return null;
  const d = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
  return /^([a-z0-9-]+\.)+[a-z]{2,20}$/.test(d) ? d : null;
}

/** Name servers from a Liara DNS zone response ({status, data: Zone}). */
function zoneNameservers(zoneResponse) {
  const zone = (zoneResponse && zoneResponse.data) || zoneResponse || {};
  const list = zone.nameServers || zone.currentNameServers || [];
  return Array.isArray(list) ? list.filter((x) => typeof x === "string") : [];
}

async function fetchNameservers(core, domain) {
  const r = await core.liara.getZone(domain);
  return r.ok ? zoneNameservers(r.data) : [];
}

function domainSteps(isIr, nameservers) {
  const base = isIr ? IR_STEPS : GENERIC_STEPS;
  return base.map((text, i) => {
    const n = i + 1;
    if (i === 2 || i === 3) {
      const ns = nameservers[i - 2];
      return ns
        ? { n, text_fa: `سرور نام ${i === 2 ? "اول" : "دوم"} را وارد کنید:`, copy: ns }
        : { n, text_fa: "سرورهای نام بعد از تأیید اتصال دامنه در همین بخش نمایش داده می‌شوند." };
    }
    return { n, text_fa: text };
  });
}

async function domainInfo(core, body) {
  const s = state(core);
  if (!modeOf(core)) return notConnected();
  const domain = normalizeDomain(body.domain);
  if (!domain) return bad(400, "INVALID_DOMAIN", "این دامنه درست به نظر نمی‌رسد", "مثلاً example.ir را بنویسید.", "نام دامنه را بدون http و مسیر وارد کنید.");
  const isIr = domain.endsWith(".ir");
  const live = core.liara.isLive;
  let nameservers = [];
  let confirm;
  if (live) {
    const z = await core.liara.getZone(domain);
    if (z.ok) {
      nameservers = zoneNameservers(z.data);
    } else if (z.error?.code === "NOT_FOUND") {
      const app = siteAppName(s);
      if (!app) return bad(409, "NO_SITE", "اول سایت را منتشر کنید", "دامنه را به سایتی وصل می‌کنیم که منتشر شده باشد.", "«سایتم را بالا بیاور» را بزنید.");
      const r = core.requestApproval("dns_zone_setup", { domain, project: app }, {
        title_fa: "ساخت منطقه‌ی DNS و اتصال دامنه",
        what_fa: `ساخت منطقه‌ی DNS برای ${domain} و اتصال آن به سایت ${app}`,
        why_fa: "اتصال دامنه‌ی شما به سایت",
        cost_fa: "هزینه‌ی دامنه را ثبت‌کننده‌ی دامنه می‌گیرد",
        impact_fa: "بدون قطعی سایت",
        rollback_fa: "حذف دامنه از کنسول لیارا",
        successCriteria_fa: "منطقه‌ی DNS ساخته شود و دامنه به سایت وصل شود",
        bullets_fa: [`منطقه‌ی DNS برای ${domain} ساخته می‌شود.`, `دامنه به سایت ${app} وصل می‌شود.`, "بعد از آن باید سرورهای نام را در ثبت‌کننده‌ی دامنه عوض کنید."],
      }, { source: "simple" });
      if (r.approval) confirm = confirmView(core, r.approval);
    } else {
      return fromLiara(core, 502, z.error, "خواندن دامنه از لیارا انجام نشد");
    }
  }
  return good({
    isIr,
    domain,
    steps: domainSteps(isIr, nameservers),
    nameservers,
    ...(confirm ? { confirm } : {}),
    ...(live ? {} : { note_fa: "اتصال واقعی دامنه فقط با حساب لیارا انجام می‌شود؛ این مراحل راهنما هستند." }),
  });
}

async function domainCheck(core, body) {
  const s = state(core);
  if (!modeOf(core)) return notConnected();
  const domain = normalizeDomain(body.domain);
  if (!domain) return bad(400, "INVALID_DOMAIN", "این دامنه درست به نظر نمی‌رسد", "مثلاً example.ir را بنویسید.", "نام دامنه را بدون http و مسیر وارد کنید.");
  if (!core.liara.isLive) {
    return good({ propagated: false, message_fa: "بررسی واقعی دامنه فقط با حساب لیارا انجام می‌شود." });
  }
  const first = await core.liara.getZone(domain);
  if (!first.ok) {
    if (first.error?.code === "NOT_FOUND") {
      return good({ propagated: false, message_fa: "هنوز منطقه‌ی DNS این دامنه ساخته نشده. اول اتصال دامنه را تأیید کنید." });
    }
    return fromLiara(core, 502, first.error, "خواندن دامنه از لیارا انجام نشد");
  }
  await core.liara.checkZone(domain);
  const again = await core.liara.getZone(domain);
  const zone = (again.ok && again.data && again.data.data) || (first.data && first.data.data) || {};
  const nameservers = zoneNameservers(again.ok ? again.data : first.data);
  if (zone.status !== "ACTIVE") {
    return good({
      propagated: false,
      nameservers,
      message_fa: "هنوز سرورهای نام به‌درستی ثبت نشده‌اند یا انتشار کامل نشده است. چند دقیقه بعد دوباره بررسی کنید.",
    });
  }
  const app = siteAppName(s);
  if (!app) return bad(409, "NO_SITE", "اول سایت را منتشر کنید", "", "«سایتم را بالا بیاور» را بزنید.");
  const target = `${app}.liara.run`;
  const r = core.requestApproval("dns_finalize", { project: app, domain, recordName: "@", recordType: "ALIAS", target }, {
    title_fa: "اتصال دامنه به سایت و گواهی امن",
    what_fa: `ثبت رکورد ALIAS برای ${domain} به ${target} و درخواست گواهی امن (SSL)`,
    why_fa: "دامنه آماده است و باید به سایت وصل شود",
    cost_fa: "بدون هزینه‌ی جدید در لیارا",
    impact_fa: "بدون قطعی سایت",
    rollback_fa: "حذف رکورد DNS از کنسول لیارا",
    successCriteria_fa: "دامنه با گواهی امن به سایت جواب بدهد",
    bullets_fa: [`رکورد DNS برای ${domain} ثبت می‌شود.`, "گواهی امن (SSL) درخواست می‌شود.", "تا چند دقیقه بعد دامنه با https باز می‌شود."],
  }, { source: "simple" });
  return good({
    propagated: true,
    nameservers,
    message_fa: "دامنه آماده‌ی اتصال است. رکورد را ثبت کنم؟",
    ...(r.approval ? { confirm: confirmView(core, r.approval) } : {}),
  });
}

// ---------- logs ----------

function getLogs(core) {
  return good({ lines: core.logs.slice(-100).map((l) => ({ ts: l.ts, line: l.line })) });
}

// ---------- routing ----------

/** Persisted state at startup: the saved token (unless LIARA_API_TOKEN is set) and the last site. */
function initSimple(core) {
  core.simple = {
    client: null,
    tried: false,
    account: null,
    accountAt: 0,
    me: null,
    meAt: 0,
    project: null,
    site: null,
    costs: new Map(),
    statusCache: new Map(),
  };
  if (!core.envLiara) {
    const saved = loadCredentials(core.stateDir);
    if (saved) {
      core.registerSecret(saved.token);
      core.setLiara(makeLiara(core, saved.token, saved.teamID));
    }
  }
  core.simple.site = readSite(core.stateDir);
  state(core);
  return core.simple;
}

const GET_ROUTES = {
  "/api/simple/session": session,
  "/api/simple/plans": getPlans,
  "/api/simple/logs": getLogs,
};

async function handleGet(core, pathname) {
  const route = GET_ROUTES[pathname];
  if (!route) return bad(404, "NOT_FOUND", "این مسیر پیدا نشد", "", "");
  return route(core);
}

async function handlePost(core, pathname, body) {
  const confirm = pathname.match(/^\/api\/simple\/(confirm|cancel)\/([A-Za-z0-9_]{1,64})$/);
  if (confirm) {
    return confirm[1] === "confirm" ? postConfirm(core, confirm[2], body) : postCancel(core, confirm[2]);
  }
  switch (pathname) {
    case "/api/simple/connect": return postConnect(core, body);
    case "/api/simple/try": return postTry(core);
    case "/api/simple/disconnect": return postDisconnect(core);
    case "/api/simple/project": return postProject(core, body);
    case "/api/simple/app-name": return postAppName(core, body);
    case "/api/simple/envs": return postEnvs(core, body);
    case "/api/simple/deploy/prepare": return prepareDeploy(core, body, "deploy");
    case "/api/simple/redeploy/prepare": return prepareDeploy(core, body, "redeploy");
    case "/api/simple/diagnose": return diagnose(core, body);
    case "/api/simple/domain": return domainInfo(core, body);
    case "/api/simple/domain/check": return domainCheck(core, body);
    default: return bad(404, "NOT_FOUND", "این مسیر پیدا نشد", "", "");
  }
}

module.exports = {
  initSimple,
  handleGet,
  handlePost,
  sanitizeAppName,
  normalizeDomain,
  resolveProjectDir,
  planOptions,
  // exported for tests and the server only
  _internal: { PLAIN, domainSteps, probeSiteStatus },
};

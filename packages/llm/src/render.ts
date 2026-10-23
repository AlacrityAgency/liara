// Deterministic Persian text for tool results. Used when no LLM is configured, when an LLM call fails,
// and as summary_fa next to the raw result the LLM receives. Nothing here touches the network.
import { findTool } from "./tools";

type Obj = Record<string, unknown>;

export const CHOOSE_FA = "یکی از این‌ها را انتخاب کنید:";
export const SIMULATED_NOTE_FA = "(حالت شبیه‌سازی؛ هیچ تغییر واقعی روی لیارا اعمال نشده است.)";

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strings = (v: unknown): string[] => list(v).map(str).filter((s): s is string => s !== undefined);

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

export function faDigits(text: string): string {
  return text.replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);
}

/** Persian digits, ٬ as thousands separator and ٫ as decimal separator (does not depend on the ICU build). */
export function faNumber(n: number, maxFraction = 0): string {
  const factor = 10 ** maxFraction;
  const rounded = Math.round(n * factor) / factor;
  const [int, frac] = String(Math.abs(rounded)).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, "٬");
  return faDigits(`${rounded < 0 ? "-" : ""}${grouped}${frac ? `٫${frac}` : ""}`);
}

export function faToman(n: number): string {
  return `${faNumber(Math.round(n))} تومان`;
}

/** Adds the simulated-mode note once; replies that already carry it are returned unchanged. */
export function withSimulatedNote(reply: string, mode: "live" | "simulated"): string {
  const text = reply.trim();
  if (mode !== "simulated" || /شبیه.?سازی/.test(text)) return text;
  return text ? `${text}\n${SIMULATED_NOTE_FA}` : SIMULATED_NOTE_FA;
}

export interface ApprovalNoteInput {
  approvalId: string;
  risk: string;
  console_url?: string;
  title_fa?: string;
  what_fa?: string;
}

export function renderApprovalNote(a: ApprovalNoteInput): string {
  const head = a.title_fa ? `کارت تأیید «${a.title_fa}» ساخته شد` : "درخواست تأیید ساخته شد";
  const what = a.what_fa ? `: ${a.what_fa.replace(/[.۔]\s*$/, "")}` : "";
  const link = a.console_url ? ` برای تأیید به کنسول بروید: ${a.console_url}` : "";
  return `${head}${what}. این اقدام هنوز اجرا نشده است و تا تأیید شما چیزی تغییر نمی‌کند (شناسه: ${a.approvalId}، ریسک ${a.risk}).${link}`;
}

const STATUS_FA: Record<string, string> = {
  running: "روشن",
  stopped: "خاموش",
  deploying: "در حال استقرار",
  unknown: "نامشخص",
};
const INCIDENT_FA: Record<string, string> = {
  investigating: "در حال بررسی",
  awaiting_approval: "منتظر تأیید",
  remediating: "در حال رفع",
  resolved: "حل شد",
  unresolved: "حل نشد",
};
const CONFIDENCE_FA: Record<string, string> = { high: "بالا", medium: "متوسط", low: "پایین" };
const EVIDENCE_TYPE_FA: Record<string, string> = {
  log: "لاگ",
  metric: "متریک",
  event: "رویداد",
  release: "ریلیز",
  applet: "اپلت",
  probe: "پروب",
};
const TIER_FA: Record<string, string> = { economy: "اقتصادی", economic: "اقتصادی", recommended: "پیشنهادی", scalable: "مقیاس‌پذیر" };
const DB_FA: Record<string, string> = { postgres: "PostgreSQL", mysql: "MySQL", mongodb: "MongoDB", redis: "Redis" };

const clip = (s: string): string => {
  const t = s.replace(/[.\s]+$/u, "").trim();
  return t.length > 160 ? `${t.slice(0, 157)}…` : t;
};

function errorText(name: string, r: Obj): string {
  const desc = findTool(name)?.description_fa ?? "این کار";
  const parts: string[] = [];
  switch (str(r.error)) {
    case "APP_NAME_REQUIRED":
      parts.push(strings(r.apps).length > 0
        ? `چند اپ در دسترس است: ${strings(r.apps).join("، ")}. کدام را می‌گویید؟`
        : "نام اپ مشخص نیست؛ نام اپ را در متغیر SOKAN_APP تنظیم کنید.");
      break;
    case "UNKNOWN_APP":
      parts.push(`فقط اپ ${str(r.allowed) ?? "تعریف‌شده"} قابل مدیریت است.`);
      break;
    case "MISSING_VALUES":
      parts.push(`برای «${desc}» مقدار متغیرهای ${strings(r.keys).join("، ")} لازم است.`);
      break;
    case "INVALID_ARGUMENTS":
      parts.push(`برای «${desc}» اطلاعات ورودی کامل یا معتبر نیست.`);
      break;
    case "PATH_NOT_ALLOWED":
      parts.push("فقط پوشه‌ی نمونه یا SOKAN_PROJECT_DIR قابل تحلیل است.");
      break;
    case "UNKNOWN_PLAN":
      parts.push("این پلن در فهرست پیشنهادی نیست.");
      break;
    case "ROLLBACK_NO_TARGET":
      break;
    default:
      parts.push(`اجرای «${desc}» ناموفق بود.`);
  }
  for (const key of ["message_fa", "what_fa", "why_fa", "next_fa"]) {
    const s = str(r[key]);
    if (s) parts.push(s);
  }
  return parts.join(" ");
}

function renderAccount(d: Obj): string {
  const plan = isObj(d.plan) ? d.plan : {};
  const planID = str(plan.planID);
  const ram = num(plan.ramMB);
  const price = num(plan.monthlyPriceTomans);
  const lines: string[] = [];
  if (planID && price !== undefined) {
    const source = plan.priceSource === "liara" ? "از فهرست زنده‌ی لیارا" : "تخمینی؛ قیمت زنده خوانده نشد";
    lines.push(`پلن فعلی: ${planID}${ram !== undefined ? `، ${faNumber(ram)} مگابایت حافظه` : ""}.`);
    lines.push(`هزینه‌ی ماهانه: ${faToman(price)} (${source}).`);
  } else if (planID) {
    lines.push(`پلن فعلی: ${planID}؛ قیمت آن الان در دسترس نیست.`);
  } else {
    lines.push("پلن فعلی خوانده نشد؛ هزینه‌ی ماهانه محاسبه نشد.");
  }
  const balance = num(d.balance_tomans);
  if (balance !== undefined) {
    lines.push(`موجودی حساب: ${faToman(balance)}.`);
    const months = num(d.months_covered);
    if (months !== undefined) lines.push(`با این موجودی و هزینه‌ی فعلی حدود ${faNumber(months, 1)} ماه کفایت می‌کند.`);
  }
  const note = str(d.note_fa);
  if (note) lines.push(note);
  lines.push("شارژ و پرداخت فقط از کنسول رسمی لیارا انجام می‌شود: https://console.liara.ir/");
  return lines.join("\n");
}

function renderLimits(d: Obj): string {
  const items = list(d.limits).filter(isObj);
  if (items.length === 0) return "فهرست محدودیت‌ها در دسترس نیست.";
  const lines = ["کارهایی که API لیارا انجام نمی‌دهد، و کاری که سُکان برای هر کدام انجام می‌دهد:"];
  items.forEach((item, i) => {
    lines.push(`${faNumber(i + 1)}. ${str(item.what_fa) ?? ""}`);
    const why = str(item.why_fa);
    if (why) lines.push(`چرا: ${why}`);
    const workaround = str(item.workaround_fa);
    if (workaround) lines.push(`راه‌حل: ${workaround}`);
  });
  lines.push("هر اقدامی که روی اپ اثر بگذارد فقط بعد از تأیید شما اجرا می‌شود.");
  return lines.join("\n");
}

function renderDomain(d: Obj): string {
  const domain = str(d.domain);
  const lines = [domain ? `راهنمای اتصال دامنه‌ی ${domain}:` : "راهنمای اتصال دامنه:"];
  strings(d.steps_fa).forEach((step, i) => lines.push(`${faNumber(i + 1)}. ${step}`));
  if (str(d.registrar) === "irnic") {
    lines.push("NSهای اختصاصی دامنه بعد از ساخت Zone در سُکان نشان داده می‌شود؛ همان‌ها را در ایرنیک ثبت کنید.");
  }
  const automated = strings(d.automated_fa);
  if (automated.length > 0) {
    lines.push("کارهایی که سُکان خودکار انجام می‌دهد:");
    automated.forEach((s) => lines.push(`• ${s}`));
  }
  const manual = strings(d.manual_fa);
  if (manual.length > 0) {
    lines.push("کارهایی که شما باید انجام دهید:");
    manual.forEach((s) => lines.push(`• ${s}`));
  }
  const note = str(d.note_fa);
  if (note) lines.push(note);
  if (isObj(d.approval)) {
    lines.push(renderApprovalNote({
      approvalId: str(d.approval.approvalId) ?? "",
      risk: str(d.approval.risk) ?? "L2",
      console_url: str(d.approval.console_url),
      title_fa: "ساخت Zone و افزودن دامنه",
    }));
  }
  return lines.join("\n");
}

function renderAppStatus(d: Obj): string {
  const app = isObj(d.app) ? d.app : {};
  const name = str(app.name) ?? "اپ";
  if (app.deleted === true) return `اپ ${name} حذف شده است.`;
  const status = str(app.status) ?? "unknown";
  const head = [`وضعیت ${name}: ${STATUS_FA[status] ?? status}`];
  const planID = str(app.planID);
  if (planID) head.push(`پلن ${planID}`);
  const port = num(app.port);
  if (port !== undefined) head.push(`پورت ${faDigits(String(port))}`);
  const lines = [`${head.join("، ")}.`];
  if (status === "unknown") lines.push("وضعیت لحظه‌ای این اپ از لیارا خوانده نشد.");

  const probe = isObj(d.last_probe) ? d.last_probe : undefined;
  if (probe) {
    const code = num(probe.status);
    const ms = num(probe.ms);
    lines.push(`آخرین پروب ${str(probe.path) ?? "/"}: ${code !== undefined ? faDigits(String(code)) : "بدون پاسخ"}`
      + `${ms !== undefined ? `، ${faDigits(String(ms))} میلی‌ثانیه` : ""} (${probe.ok === true ? "سالم" : "ناسالم"}).`);
    const rss = num(probe.rssMB);
    if (rss !== undefined) {
      const limit = num(app.memoryLimitMB);
      lines.push(`حافظه: ${faNumber(rss)} مگابایت${limit !== undefined ? ` از ${faNumber(limit)} مگابایت` : ""}.`);
    }
  } else {
    lines.push("هنوز پروبی ثبت نشده است.");
  }
  const cpu = num(d.cpu_pct);
  if (cpu !== undefined) lines.push(`پردازنده: ${faDigits(String(cpu))}٪.`);
  const restarts = num(app.restarts);
  if (restarts !== undefined) lines.push(`ری‌استارت ثبت‌شده از شروع کنسول: ${faDigits(String(restarts))} بار.`);
  const inc = isObj(d.incident) ? d.incident : undefined;
  lines.push(inc
    ? `آخرین incident: ${INCIDENT_FA[str(inc.status) ?? ""] ?? str(inc.status) ?? "نامشخص"} (${str(inc.id) ?? ""}).`
    : "هیچ incident ثبت نشده است.");
  return lines.join("\n");
}

function renderProject(d: Obj): string {
  const lines: string[] = [];
  const port = num(d.port);
  lines.push(`پلتفرم پیشنهادی: ${str(d.platform) ?? "نامشخص"}${port !== undefined ? `، پورت ${faDigits(String(port))}` : ""}.`);
  const app = str(d.app);
  if (app) lines.push(`نام پیشنهادی اپ: ${app}.`);
  const envs = strings(d.required_env_names).filter((k) => !k.startsWith("CHAOS_"));
  lines.push(envs.length > 0
    ? `متغیرهای محیطی لازم: ${envs.join("، ")}. مقدار آن‌ها را در فرم متغیرها وارد کنید.`
    : "متغیر محیطی خاصی لازم نیست.");
  const db = str(d.database);
  if (db && db !== "none") lines.push(`پایگاه‌داده‌ی لازم: ${DB_FA[db] ?? db}.`);
  if (isObj(d.liara_json)) lines.push(`liara.json پیشنهادی: ${JSON.stringify(d.liara_json)}`);
  return lines.join("\n");
}

function renderPlans(d: Obj): string {
  const plans = list(d.plans).filter(isObj);
  if (plans.length === 0) return "پلنی برای پیشنهاد پیدا نشد.";
  const lines = [`${faNumber(plans.length)} پلن پیشنهادی:`];
  plans.forEach((p, i) => {
    const tier = TIER_FA[str(p.tier) ?? ""] ?? "";
    const ram = num(p.ramMB);
    const price = num(p.monthlyPriceTomans);
    const estimate = p.priceSource === "estimate" ? " (تخمینی)" : "";
    lines.push(`${faNumber(i + 1)}. ${tier} (${str(p.planID) ?? "؟"}${ram !== undefined ? `، ${faNumber(ram)} مگابایت` : ""}): `
      + `${price !== undefined ? faToman(price) : "قیمت نامشخص"} در ماه${estimate}`);
  });
  return lines.join("\n");
}

/** One line per cited evidence id: the signal's sentence when a signal holds it, else the evidence summary. */
function evidenceLines(top: Obj, signals: Obj[], evidence: Obj[]): string[] {
  const refs = strings(top.evidence_for);
  const used = new Set<string>();
  const out: string[] = [];
  for (const sig of signals) {
    const ids = strings(sig.evidence).filter((id) => refs.includes(id) && !used.has(id));
    if (ids.length === 0) continue;
    ids.forEach((id) => used.add(id));
    out.push(`شاهد: ${clip(faDigits(str(sig.detail_fa) ?? ""))} ${ids.map((id) => `[${id}]`).join(" ")}`);
  }
  for (const id of refs) {
    if (used.has(id)) continue;
    const ev = evidence.find((e) => str(e.id) === id);
    if (!ev) continue;
    used.add(id);
    const type = EVIDENCE_TYPE_FA[str(ev.type) ?? ""] ?? "داده";
    out.push(`شاهد (${type}): ${clip(faDigits(str(ev.summary) ?? ""))} [${id}]`);
  }
  return out.slice(0, 4);
}

function renderInvestigation(d: Obj): string {
  const lines: string[] = [];
  const top = isObj(d.top_hypothesis) ? d.top_hypothesis : undefined;
  if (!top) {
    lines.push("تحلیل شواهد انجام شد، اما با داده‌های فعلی علت مشخصی پیدا نشد.");
  } else {
    const conf = CONFIDENCE_FA[str(top.confidence) ?? ""] ?? str(top.confidence) ?? "";
    const explain = str(top.explain_fa);
    lines.push(`تحلیل شواهد انجام شد. محتمل‌ترین علت: **${str(top.title_fa) ?? ""}** (اطمینان ${conf}).${explain ? ` ${explain}` : ""}`);
    lines.push(...evidenceLines(top, list(d.signals).filter(isObj), list(d.evidence).filter(isObj)));
  }
  const missing = strings(d.missing_evidence);
  if (missing.length > 0) lines.push(`این منابع داده برنگرداندند و سالم فرض نشده‌اند: ${missing.join("، ")}.`);
  const flags = list(d.flags).filter(isObj);
  if (flags.length > 0) lines.push(`در داده‌ها ${faNumber(flags.length)} متن شبیه دستور پیدا شد؛ دستور اجرا نشد و فقط به‌عنوان یافته ثبت شد.`);
  for (const need of list(d.needs_values).filter(isObj)) {
    const keys = strings(need.keys);
    if (keys.length > 0) lines.push(`برای ساخت کارت تأیید، مقدار این متغیرها لازم است: ${keys.join("، ")}. آن‌ها را در فرم متغیرها وارد کنید.`);
  }
  const created = list(d.approvals_created).length;
  if (created > 0) lines.push(`${faNumber(created)} کارت تأیید برای راهکار ساخته شد؛ تا تأیید نکنید چیزی روی اپ تغییر نمی‌کند.`);
  return lines.join("\n");
}

const RENDERERS = new Map<string, (data: Obj) => string>([
  ["account_status", renderAccount],
  ["limits_list", renderLimits],
  ["domain_connect_guide", renderDomain],
  ["app_status", renderAppStatus],
  ["project_analyze", renderProject],
  ["plans_recommend", renderPlans],
  ["sre_investigate", renderInvestigation],
]);

/**
 * Persian reply for one tool result, or null when the tool has no renderer (the caller then uses the tool description).
 * Covers ok results, errors (with what/why/next) and approval requests (L2/L3).
 */
export function renderToolReply(name: string, result: unknown): string | null {
  if (!isObj(result)) return null;
  if (result.status === "approval_required") {
    const approvalId = str(result.approvalId);
    if (!approvalId) return null;
    return renderApprovalNote({
      approvalId,
      risk: str(result.risk) ?? "L2",
      console_url: str(result.console_url),
      title_fa: str(result.title_fa),
      what_fa: str(result.what_fa),
    });
  }
  if (result.status === "error") return errorText(name, result);
  const render = RENDERERS.get(name);
  if (!render) return null;
  return render(isObj(result.data) ? result.data : {});
}

/** Renders the reply for the LLM as well: the raw result plus summary_fa when a renderer exists. */
export function withSummary(name: string, result: unknown): unknown {
  if (!isObj(result)) return result;
  const summary = renderToolReply(name, result);
  return summary ? { summary_fa: summary, ...result } : result;
}

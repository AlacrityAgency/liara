import * as fs from "node:fs";
import * as path from "node:path";
import { ProjectAnalyzer } from "../../../analyzer/src/index";
import type { DeployEvent, LiaraClient, PlanSummary } from "../../../liara-client/src/index";
import type { FixBrief } from "../../../contracts/src/index";
import { fixBriefToMarkdown } from "../../../diagnostics/src/index";
import { CancelledError, CliError } from "../errors";
import { explainBuildFailure } from "../build-errors";
import type { Ctx } from "../context";
import { ensureToken } from "../account";
import {
  BILLING_PAGE,
  BundleChoice,
  cheapestBundle,
  formatToman,
  humanError,
  isValidAppName,
  makeClient,
  planCandidates,
  planLabel,
  probeTarget,
  sanitizeAppName,
  siteUrl,
  threePlanOptions,
  waitForSite,
} from "../liara";
import { addSecret, bad, clean, color, fa, good, Progress, say, toman, warn } from "../render";
import { readDotEnv, writeFixBrief, writeSite } from "../store";

const PLATFORM_LABEL: Record<string, string> = {
  next: "Next.js",
  react: "React",
  vue: "Vue",
  angular: "Angular",
  node: "Node.js",
  static: "استاتیک",
  python: "Python",
  django: "Django",
  flask: "Flask",
  php: "PHP",
  laravel: "Laravel",
  go: "Go",
  dotnet: ".NET",
  docker: "Docker",
};

/** Variables the platform or the demo sets itself; never asked for. */
const SKIP_ENV = /^(CHAOS_|DEBUG_|LIARA_|NODE_ENV$|PORT$|HOST$)/;
const SECRET_ENV = /(SECRET|PASS|TOKEN|KEY|AUTH|PRIVATE|CREDENTIAL|DSN|URI|CONNECTION|URL)/i;

function defaultAppName(dir: string): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as { name?: unknown };
    if (typeof pkg.name === "string" && pkg.name) return sanitizeAppName(pkg.name.replace(/^@[^/]+\//, ""));
  } catch {
    // no package.json: use the folder name
  }
  return sanitizeAppName(path.basename(dir));
}

async function chooseAppName(ctx: Ctx): Promise<string> {
  if (ctx.options.name) {
    if (!isValidAppName(ctx.options.name)) throw new CliError("نام برنامه باید بین ۳ تا ۳۲ حرف کوچک انگلیسی، عدد یا خط تیره باشد.");
    return ctx.options.name;
  }
  const fallback = defaultAppName(ctx.dir);
  for (;;) {
    const answer = (await ctx.prompts.ask(`اسم برنامه در لیارا؟ (Enter = ${fallback}):`)).toLowerCase();
    const name = answer || fallback;
    if (isValidAppName(name)) return name;
    bad("نام باید فقط حروف کوچک انگلیسی، عدد و خط تیره باشد و بین ۳ تا ۳۲ نویسه.");
  }
}

/** Required variables: --env flags, then the project's .env, then a prompt (hidden for secrets). */
async function collectEnvs(ctx: Ctx, required: string[]): Promise<Record<string, string>> {
  const values: Record<string, string> = { ...ctx.options.env };
  for (const value of Object.values(values)) addSecret(value);
  const dotEnv = readDotEnv(ctx.dir);
  if (dotEnv) say("فایل .env پروژه را خواندم.");

  for (const key of required.filter((k) => !SKIP_ENV.test(k) && values[k] === undefined)) {
    const fromFile = dotEnv?.[key];
    if (fromFile) {
      values[key] = fromFile;
      addSecret(fromFile);
      continue;
    }
    const secret = SECRET_ENV.test(key);
    const answer = await ctx.prompts.ask(
      `مقدار ${key} را وارد کن${secret ? " (مخفی تایپ می‌شود)" : ""}؛ Enter برای رد کردن:`,
      secret
    );
    if (answer) {
      values[key] = answer;
      addSecret(answer);
    } else {
      warn(`بدون ${key} ممکن است سایت کار نکند.`);
    }
  }
  return values;
}

interface PlanChoice {
  plan: PlanSummary;
  bundle: BundleChoice;
  costTomans: number;
}

/** Shows up to three plans with real prices and asks for one (Enter takes the recommended one). */
async function choosePlan(ctx: Ctx, client: LiaraClient): Promise<PlanChoice> {
  const plansResult = await client.getPlans();
  if (!plansResult.ok) throw humanError(plansResult.error);
  const { options, recommended } = threePlanOptions(planCandidates(plansResult.data ?? []));
  if (options.length === 0) throw new CliError("هیچ پلنی برای این حساب فعال نیست.");

  const account = await client.getAccount();
  const bundleMap = account.ok
    ? (account.data as { plans?: { projectBundlePlans?: unknown } } | undefined)?.plans?.projectBundlePlans
    : undefined;
  const priced = options.map((plan) => {
    const bundle = cheapestBundle(bundleMap, plan.planID);
    return { plan, bundle, costTomans: plan.monthlyPrice + bundle.priceTomans };
  });

  say("پلن‌های موجود (قیمت واقعی لیارا):");
  priced.forEach((p, i) => {
    const star = i === recommended ? " ⭐ پیشنهادی" : "";
    const cost = p.costTomans > 0 ? formatToman(p.costTomans) : "رایگان";
    say(`  ${fa(i + 1)}. ${planLabel(p.plan)}  —  ${cost} در ماه${star}`);
  });

  let index: number;
  if (ctx.options.plan) {
    index = priced.findIndex((p) => p.plan.planID === ctx.options.plan);
    if (index < 0) throw new CliError(`پلن «${ctx.options.plan}» در حساب تو پیدا نشد.`);
  } else {
    index = await ctx.prompts.choose("کدام پلن؟", priced.length, recommended);
  }
  return priced[index];
}

/** Waits for the balance to cover the first month; the user tops up and presses Enter to re-check. */
async function ensureBalance(ctx: Ctx, client: LiaraClient, costTomans: number): Promise<void> {
  if (costTomans <= 0) return;
  for (;;) {
    const balance = await client.getBalance();
    if (!balance.ok) throw humanError(balance.error);
    const current = balance.data?.balance ?? 0;
    if (current >= costTomans) {
      say(`موجودی حساب: ${formatToman(current)}`);
      return;
    }
    bad(`موجودی کافی نیست؛ ${formatToman(costTomans - current)} کم داری.`);
    say(`شارژ حساب: ${BILLING_PAGE}`);
    const answer = (await ctx.prompts.ask("شارژ کردی؟ Enter برای بررسی دوباره (q برای انصراف):")).toLowerCase();
    if (answer === "q") throw new CancelledError();
  }
}

function toVariables(values: Record<string, string>): Array<{ key: string; value: string }> {
  return Object.entries(values).map(([key, value]) => ({ key, value }));
}

/** Maps client stage events onto one progress line. Build output only moves the bar. */
function progressHandler(progress: Progress, lines: string[]): (event: DeployEvent) => void {
  let buildLines = 0;
  return (event) => {
    switch (event.stage) {
      case "pack":
        progress.update(10, "بسته‌بندی سورس پروژه");
        break;
      case "upload":
        progress.update(30, "آپلود سورس به لیارا");
        break;
      case "release":
        progress.update(45, "ساخت نسخه‌ی جدید");
        break;
      case "build":
        if (event.line) lines.push(event.line);
        buildLines += 1;
        progress.update(Math.min(90, 55 + buildLines), "ساخت برنامه (بیلد)");
        break;
      case "ready":
        progress.update(100, "برنامه مستقر شد");
        break;
      default:
        break;
    }
  };
}

function writeDeployBrief(dir: string, reason: string, tail: string[]): string {
  const brief: FixBrief = {
    incident_id: `deploy_${Date.now().toString(36)}`,
    symptom: "دیپلوی سایت ناموفق بود",
    hypothesis: reason,
    confidence: "medium",
    evidence: [{ type: "log", kind: "build", text: "آخرین خطوط بیلد", excerpt: tail.join("\n") }],
    suspected_locations: [],
    suggested_change: reason,
    verification: "دوباره sokan را اجرا کن؛ سایت باید پاسخ ۲۰۰ بدهد.",
  };
  return writeFixBrief(dir, fixBriefToMarkdown(brief));
}

/**
 * Deploy flow: token, analysis, env, name, plan, balance, one confirmation, create (new apps only),
 * env, deploy with progress, health check, site state.
 */
export async function runDeploy(ctx: Ctx): Promise<number> {
  if (!fs.existsSync(ctx.dir) || !fs.statSync(ctx.dir).isDirectory()) {
    throw new CliError(`پوشه‌ی پروژه پیدا نشد: ${ctx.dir}`);
  }
  const token = await ensureToken(ctx.prompts);
  const profile = await ProjectAnalyzer.analyze(ctx.dir);
  const label = PLATFORM_LABEL[profile.detectedPlatform] ?? profile.detectedPlatform;
  say(`یک سایت ${label} روی پورت ${fa(profile.detectedPort)} پیدا کردم.`);

  const client = makeClient(token);
  const envs = await collectEnvs(ctx, profile.requiredEnvs);
  const name = await chooseAppName(ctx);

  const existing = await client.getApp(name);
  let planID: string;
  let monthlyTomans: number;
  let bundle: BundleChoice = { priceTomans: 0 };
  let isNew = false;
  if (existing.ok) {
    planID = existing.data?.project.planID ?? "";
    monthlyTomans = existing.data?.project.monthlyPrice ?? 0;
    say(`برنامه «${name}» از قبل در حساب تو هست؛ نسخه‌ی جدید روی همان منتشر می‌شود.`);
  } else if (existing.error?.code === "NOT_FOUND") {
    isNew = true;
    const choice = await choosePlan(ctx, client);
    planID = choice.plan.planID;
    bundle = choice.bundle;
    monthlyTomans = choice.costTomans;
    await ensureBalance(ctx, client, monthlyTomans);
  } else {
    throw humanError(existing.error);
  }

  const question = isNew
    ? monthlyTomans > 0
      ? `این کار ماهی ${formatToman(monthlyTomans)} هزینه دارد.`
      : "این کار هزینه‌ای ندارد."
    : "این کار هزینه‌ی جدیدی ندارد؛ سایت چند ثانیه ری‌استارت می‌شود.";
  if (!(await ctx.prompts.confirm(`${question} ادامه بدهم؟`))) throw new CancelledError();

  if (isNew) {
    const created = await client.createApp({
      name,
      planID,
      platform: profile.detectedPlatform,
      bundlePlanID: bundle.bundlePlanID,
    });
    if (!created.ok) throw humanError(created.error);
    say("برنامه در لیارا ساخته شد.");
  }

  const variables = toVariables(envs);
  if (variables.length > 0) {
    const updated = await client.updateEnvs(name, variables);
    if (!updated.ok) throw humanError(updated.error);
  }

  const progress = new Progress();
  const lines: string[] = [];
  const result = await client.deploy(name, ctx.dir, {
    port: profile.detectedPort,
    platform: profile.detectedPlatform,
    envs: variables.length > 0 ? envs : undefined,
    onEvent: progressHandler(progress, lines),
  });
  progress.done();

  if (!result.ok) {
    const tail = [...lines, result.error?.why_fa ?? ""].filter(Boolean).slice(-20);
    bad(explainBuildFailure(result.error, tail));
    if (tail.length > 0) {
      say(color.dim("جزئیات فنی (آخرین خطوط، بدون اطلاعات محرمانه):"));
      for (const line of tail) say(color.dim(`  ${line}`));
    }
    const briefPath = writeDeployBrief(ctx.dir, explainBuildFailure(result.error, tail), tail.map((l) => clean(l)));
    say(`این فایل را به Cursor/Claude بده: ${briefPath}`);
    return 1;
  }

  const url = siteUrl(name);
  say(color.dim("در انتظار بالا آمدن سایت…"));
  const status = await waitForSite(probeTarget(name));
  writeSite(ctx.dir, {
    appName: name,
    url,
    platform: profile.detectedPlatform,
    port: profile.detectedPort,
    planID,
    bundlePlanID: bundle.bundlePlanID,
    monthlyTomans,
    lastReleaseID: result.releaseID,
    lastDeployAt: new Date().toISOString(),
  });
  if (status < 200 || status >= 300) {
    bad(`سایت منتشر شد ولی هنوز پاسخ سالم نمی‌دهد (وضعیت ${fa(status)}). چند دقیقه بعد «sokan status» را بزن یا «sokan fix» را اجرا کن.`);
    return 1;
  }
  good(`✅ سایتت آنلاین شد: ${url}`);
  say(color.dim(`هزینه‌ی ماهانه: ${toman(monthlyTomans)} تومان · وضعیت: sokan status · مشکل: sokan fix`));
  return 0;
}


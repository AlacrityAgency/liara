import type { RiskLevel } from "@sokan/contracts";
import type { DiagCriterion, DiagSignalKind } from "./types";

/**
 * One recommended action. `tool` is a policy TOOL_RISK name (packages/policy/src/engine.ts), or
 * "coding_agent_handoff" (an L0 handoff that creates a Fix Brief, not an infrastructure change).
 * Placeholders such as "{{failingPath}}" are resolved from the evidence at diagnose time.
 */
export interface RunbookRemediation {
  tool: string;
  risk: RiskLevel;
  params_template: Record<string, unknown>;
  title_fa: string;
  cost_fa: string;
  impact_fa: string;
  rollback_fa: string;
  successCriteria: DiagCriterion;
  successCriteria_fa: string;
}

export interface DiagnosticRunbook {
  id: string;
  title_fa: string;
  title_en: string;
  /** Persian and English keywords used by symptomMatch (WHITEPAPER §8.4). */
  symptoms: string[];
  /** Base log-odds, before any signal. Negative means "needs evidence". */
  prior: number;
  /** Every signal here must be present, otherwise the runbook does not apply (hard requirement). */
  requiredSignals: DiagSignalKind[];
  /** At least one of these must be present, when the list is given. */
  requiredAny?: DiagSignalKind[];
  /** Weight of each supporting or required signal. Contribution = weight * strength. */
  weights: Partial<Record<DiagSignalKind, number>>;
  /** Weight of each contradicting signal. Contribution = -weight * strength (subtracts, never hard-rejects). */
  against: Partial<Record<DiagSignalKind, number>>;
  /** Collectors this runbook needs. If one failed, confidence is capped at medium. */
  dependsOn: string[];
  explain_fa: string;
  confirmingTest_fa: string;
  suggested_change_fa: string;
  remediations: RunbookRemediation[];
  /**
   * Used instead of explain/confirm text when the OOM evidence is a log line without a memory series (round 3 item 3).
   * `prepend` goes before the regular remediations, so the restart with observation comes first.
   */
  logOnlyOom?: { explain_fa: string; confirmingTest_fa: string; prepend: RunbookRemediation[] };
}

const FAILING_PATH = "{{failingPath}}";

export const STANDARD_RUNBOOKS: DiagnosticRunbook[] = [
  {
    id: "missing_env",
    title_fa: "فقدان متغیر محیطی ضروری",
    title_en: "Missing required environment variable",
    symptoms: ["500", "۵۰۰", "خطا", "error", "env", "متغیر", "deploy", "دیپلوی", "undefined"],
    prior: -0.5,
    requiredSignals: ["MISSING_ENV"],
    weights: { MISSING_ENV: 3, DEPLOY_REGRESSION: 1, APP_EXCEPTION: 0.5, CRASH_LOOP: 0.5 },
    against: { OOM_KILLED: 2 },
    dependsOn: ["logs_get"],
    explain_fa: "یکی از متغیرهای محیطی که برنامه برای اتصال یا شروع به کار نیاز دارد در تنظیمات لیارا وجود ندارد.",
    confirmingTest_fa: "بررسی فهرست متغیرهای تنظیم‌شده در برابر لاگ خطا و فایل .env.example",
    suggested_change_fa:
      "متغیر محیطی گمشده را در تنظیمات لیارا با مقدار امن اضافه کنید و برنامه را ری‌استارت کنید. در کد هم، پیش از استفاده از متغیر، وجود آن را بررسی کنید و با پیام خطای روشن متوقف شوید تا خطای ۵۰۰ مبهم تولید نشود.",
    remediations: [
      {
        tool: "app_update_envs",
        risk: "L2",
        params_template: {},
        title_fa: "افزودن متغیرهای محیطی جاافتاده و راه‌اندازی مجدد",
        cost_fa: "بدون هزینه؛ ری‌استارت حدود ۱۰ ثانیه قطعی دارد",
        impact_fa: "ری‌استارت برنامه؛ نیاز به وارد کردن مقدار امن (مقدار در کارت تأیید نشان داده نمی‌شود)",
        rollback_fa: "حذف متغیر اضافه‌شده و ری‌استارت",
        successCriteria: { kind: "probe_ok", path: FAILING_PATH },
        successCriteria_fa: "مسیر خراب پاسخ ۲xx یا ۳xx بدهد و خطای متغیر گمشده دیگر در لاگ نباشد",
      },
    ],
  },
  {
    id: "deploy_regression",
    title_fa: "خرابی پس از انتشار نسخه‌ی جدید",
    title_en: "Regression after the latest release",
    symptoms: ["خطا", "error", "500", "۵۰۰", "دیپلوی", "deploy", "ریلیز", "release", "بعد از آپدیت", "بعد از دیپلوی"],
    prior: -1,
    requiredSignals: ["DEPLOY_REGRESSION"],
    weights: { DEPLOY_REGRESSION: 2, APP_EXCEPTION: 1 },
    // A specific cause (missing env, port) explains the regression better, so it competes here.
    against: { OOM_KILLED: 1, MISSING_ENV: 2.5, PORT_MISMATCH: 2 },
    dependsOn: ["release_list", "logs_get"],
    explain_fa: "خطاها بلافاصله پس از انتشار یک نسخه‌ی موفق شروع شده‌اند؛ تغییرات آن نسخه احتمالاً علت است.",
    confirmingTest_fa: "مقایسه‌ی زمان پایان ریلیز با زمان شروع خطا و بررسی تغییرات همان ریلیز",
    suggested_change_fa:
      "تغییرات ریلیز آخر را بررسی کنید: کد یا وابستگی جدیدی که مسیر خراب را تغییر داده باید پیش از انتشار دوباره آزمایش شود. تا اصلاح آماده نیست، به ریلیز READY قبلی برگردید.",
    remediations: [
      {
        tool: "release_rollback",
        risk: "L2",
        params_template: {},
        title_fa: "بازگشت به ریلیز پایدار قبلی (Rollback)",
        cost_fa: "بدون هزینه؛ ری‌استارت کوتاه",
        impact_fa: "برنامه با نسخه‌ی قبلی بالا می‌آید؛ تغییرات ریلیز جدید موقتاً غیرفعال می‌شود",
        rollback_fa: "انتشار دوباره‌ی ریلیز جدید پس از اصلاح",
        successCriteria: { kind: "error_rate_below", perMin: 1 },
        successCriteria_fa: "نرخ خطا کمتر از ۱ در دقیقه در پنجره‌ی مشاهده",
      },
      {
        tool: "coding_agent_handoff",
        risk: "L0",
        params_template: {},
        title_fa: "ارجاع به Coding Agent برای اصلاح کد ریلیز",
        cost_fa: "بدون هزینه",
        impact_fa: "بدون تغییر در برنامه‌ی زنده",
        rollback_fa: "ادامه‌ی Rollback در صورت نیاز",
        successCriteria: { kind: "probe_ok", path: FAILING_PATH },
        successCriteria_fa: "پس از اصلاح و دیپلوی، مسیر خراب پاسخ ۲xx بدهد",
      },
    ],
  },
  {
    id: "oom_leak",
    title_fa: "اتمام حافظه بر اثر نشت حافظه",
    title_en: "Memory leak causing OOM kills",
    symptoms: ["رم", "حافظه", "memory", "leak", "نشت", "oom", "کرش", "crash", "restart", "ری‌استارت", "کند", "slow", "502", "503"],
    prior: -0.5,
    requiredSignals: ["OOM_KILLED", "MEMORY_LEAK_TREND"],
    weights: { OOM_KILLED: 2.5, MEMORY_LEAK_TREND: 2.5, MEMORY_PRESSURE: 1, CRASH_LOOP: 0.5 },
    against: {},
    dependsOn: ["applets_get", "metrics_memory"],
    explain_fa: "حافظه‌ی برنامه به‌طور خطی رشد می‌کند و به سقف پلن می‌رسد؛ سیستم‌عامل کانتینر را به دلیل OOM متوقف کرده است.",
    confirmingTest_fa: "بررسی نمودار حافظه قبل از توقف و تطبیق با رویداد OOM در applets",
    suggested_change_fa:
      "کش‌های سراسری بدون سقف، شنونده‌های رویداد که حذف نمی‌شوند یا بافرهایی که پس از پایان درخواست آزاد نمی‌شوند را در stack trace و پروفایل heap پیدا کنید. برای کش‌ها سقف (LRU/TTL) بگذارید و در مسیرهای پایان درخواست removeListener یا clear را اجرا کنید.",
    remediations: [
      {
        tool: "app_restart",
        risk: "L2",
        params_template: {},
        title_fa: "ری‌استارت موقت برای آزادسازی حافظه",
        cost_fa: "بدون هزینه؛ حدود ۱۰ ثانیه قطعی",
        impact_fa: "قطع کوتاه سرویس؛ نشت پس از ری‌استارت دوباره شروع می‌شود",
        rollback_fa: "نیازی نیست؛ ری‌استارت برگشت‌پذیر است",
        successCriteria: { kind: "restarts_stable" },
        successCriteria_fa: "بدون OOM جدید در ۳۰ دقیقه و برنامه در وضعیت running",
      },
      {
        tool: "coding_agent_handoff",
        risk: "L0",
        params_template: {},
        title_fa: "Fix Brief برای رفع نشت حافظه در کد",
        cost_fa: "بدون هزینه",
        impact_fa: "بدون تغییر در برنامه‌ی زنده",
        rollback_fa: "—",
        successCriteria: { kind: "mem_below_pct", pct: 80 },
        successCriteria_fa: "پس از اصلاح، p95 حافظه زیر ۸۰٪ سقف بماند",
      },
    ],
  },
  {
    id: "leak_no_oom",
    title_fa: "روند نشت حافظه (هنوز OOM رخ نداده)",
    title_en: "Memory leak trend without OOM yet",
    symptoms: ["رم", "حافظه", "memory", "leak", "نشت", "کند", "slow", "تدریجی", "gradual"],
    prior: 0,
    requiredSignals: ["MEMORY_LEAK_TREND"],
    weights: { MEMORY_LEAK_TREND: 2.5, MEMORY_PRESSURE: 0.5 },
    against: { OOM_KILLED: 2 },
    dependsOn: ["metrics_memory"],
    explain_fa: "حافظه‌ی برنامه به‌طور مداوم و خطی بالا می‌رود. هنوز OOM رخ نداده، اما با همین روند به سقف می‌رسد.",
    confirmingTest_fa: "بررسی شیب حافظه در ۳۰ دقیقه‌ی اخیر و زمان تخمینی رسیدن به سقف",
    suggested_change_fa:
      "رشد خطی حافظه یعنی نشت در حال پیشرفت است. در کد دنبال آرایه‌ها، Mapها یا کش‌های سراسری بدون سقف، و تایمرها یا شنونده‌هایی که پاک نمی‌شوند بگردید. تا رفع علت، ری‌استارت زمان‌بندی‌شده‌ی پیش از رسیدن به سقف را موقتاً نگه دارید.",
    remediations: [
      {
        tool: "coding_agent_handoff",
        risk: "L0",
        params_template: {},
        title_fa: "Fix Brief برای رفع نشت حافظه در کد",
        cost_fa: "بدون هزینه",
        impact_fa: "بدون تغییر در برنامه‌ی زنده",
        rollback_fa: "—",
        successCriteria: { kind: "mem_below_pct", pct: 80 },
        successCriteria_fa: "شیب حافظه پس از اصلاح صفر یا منفی شود و p95 زیر ۸۰٪ بماند",
      },
      {
        tool: "app_restart",
        risk: "L2",
        params_template: {},
        title_fa: "ری‌استارت موقت پیش از رسیدن به سقف",
        cost_fa: "بدون هزینه؛ حدود ۱۰ ثانیه قطعی",
        impact_fa: "قطع کوتاه سرویس؛ حافظه آزاد می‌شود و نشت دوباره شروع می‌شود",
        rollback_fa: "نیازی نیست",
        successCriteria: { kind: "mem_below_pct", pct: 70 },
        successCriteria_fa: "پس از ری‌استارت p95 حافظه زیر ۷۰٪ سقف باشد",
      },
    ],
  },
  {
    id: "undersized_plan",
    title_fa: "پلن کوچک‌تر از نیاز برنامه",
    title_en: "Plan memory too small for the workload",
    symptoms: ["رم", "حافظه", "memory", "پلن", "plan", "کم", "کوچک", "oom", "کرش", "crash"],
    prior: 0,
    requiredSignals: [],
    requiredAny: ["OOM_KILLED", "MEMORY_PRESSURE"],
    weights: { OOM_KILLED: 1.5, MEMORY_PRESSURE: 2 },
    against: { MEMORY_LEAK_TREND: 2.5 },
    dependsOn: ["metrics_memory", "applets_get"],
    explain_fa: "مصرف حافظه‌ی برنامه ثابت و نزدیک سقف پلن است و رشد خطی دیده نمی‌شود؛ پلن برای بار کاری فعلی کوچک است.",
    confirmingTest_fa: "مقایسه‌ی p95 حافظه با سقف پلن در ساعات اوج ترافیک و نبود شیب رشد",
    logOnlyOom: {
      explain_fa: "این فرضیه فقط از روی رخداد OOM ساخته شده است. اگر نشت باشد، پس از ری‌استارت دوباره به سقف می‌رسد؛ اگر پلن کوچک باشد، همان بار کاری دوباره آن را پر می‌کند.",
      confirmingTest_fa: "ابتدا ری‌استارت (بی‌هزینه) و مشاهده‌ی حافظه در چند ساعت؛ اگر دوباره به سقف رسید، پلن را ارتقا دهید.",
      prepend: [{
        tool: "app_restart",
        risk: "L2",
        params_template: {},
        title_fa: "ری‌استارت برای مشاهده‌ی حافظه (گام اول)",
        cost_fa: "بدون هزینه؛ حدود ۱۰ ثانیه قطعی",
        impact_fa: "قطع کوتاه سرویس؛ حافظه آزاد می‌شود و تاریخچه‌ی حافظه شروع می‌شود",
        rollback_fa: "نیازی نیست؛ ری‌استارت برگشت‌پذیر است",
        successCriteria: { kind: "restarts_stable" },
        successCriteria_fa: "برنامه بالا بیاید و OOM جدیدی ثبت نشود؛ سپس روند حافظه بررسی شود",
      }],
    },
    suggested_change_fa:
      "حافظه‌ی مصرفی ثابت و نزدیک سقف است و نشت خطی دیده نمی‌شود. پلن با RAM بیشتر انتخاب کنید (right-sizing). در کد هم اندازه‌ی کش‌ها، تعداد workerها و بافرها را با سقف جدید هماهنگ کنید.",
    remediations: [
      {
        tool: "app_resize_plan",
        risk: "L2",
        params_template: {},
        title_fa: "ارتقای پلن به رم بالاتر",
        cost_fa: "هزینه‌ی ماهانه‌ی پلن بالاتر (از plans_recommend خوانده می‌شود)",
        impact_fa: "قطع کوتاه هنگام تغییر پلن",
        rollback_fa: "بازگشت به پلن قبلی با همان ابزار",
        successCriteria: { kind: "mem_below_pct", pct: 80 },
        successCriteria_fa: "p95 حافظه پس از ارتقا زیر ۸۰٪ سقف جدید",
      },
    ],
  },
  {
    id: "cpu_saturation",
    title_fa: "اشباع پردازنده",
    title_en: "CPU saturation",
    symptoms: ["کند", "slow", "timeout", "تایم‌اوت", "504", "۵۰۴", "cpu", "سی‌پی‌یو", "پردازنده"],
    prior: -0.5,
    requiredSignals: ["CPU_SATURATION"],
    weights: { CPU_SATURATION: 3, UPSTREAM_SLOW: 0.5, APP_EXCEPTION: 0.2 },
    against: { MEMORY_PRESSURE: 0.5 },
    dependsOn: ["metrics_cpu"],
    explain_fa: "پردازنده‌ی اختصاص‌یافته به اپلیکیشن به‌طور پیوسته در سقف ظرفیت کار می‌کند و باعث تأخیر در پاسخ‌دهی شده است.",
    confirmingTest_fa: "بررسی میانگین ۵ دقیقه‌ای نمودار مصرف پردازنده و مسیرهای پرهزینه در لاگ",
    suggested_change_fa:
      "مسیر داغ CPU را پروفایل کنید (حلقه‌های سنگین، رمزنگاری همزمان، پردازش JSON یا تصویر بزرگ) و کار سنگین را به کش یا صف پس‌زمینه منتقل کنید. تا آن زمان پلن با هسته‌ی بیشتر کمک‌کننده است.",
    remediations: [
      {
        tool: "app_resize_plan",
        risk: "L2",
        params_template: {},
        title_fa: "ارتقای هسته‌ی پردازنده در پلن",
        cost_fa: "هزینه‌ی ماهانه‌ی پلن بالاتر",
        impact_fa: "قطع کوتاه هنگام تغییر پلن",
        rollback_fa: "بازگشت به پلن قبلی",
        successCriteria: { kind: "cpu_below_pct", pct: 70, underLoad: true },
        successCriteria_fa: "p95 مصرف CPU پس از ارتقا، هنگام اعمال بار، زیر ۷۰٪ باشد",
      },
      {
        tool: "coding_agent_handoff",
        risk: "L0",
        params_template: {},
        title_fa: "Fix Brief برای مسیر داغ پردازنده",
        cost_fa: "بدون هزینه",
        impact_fa: "بدون تغییر در برنامه‌ی زنده",
        rollback_fa: "—",
        successCriteria: { kind: "cpu_below_pct", pct: 70, underLoad: true },
        successCriteria_fa: "پس از اصلاح، p95 CPU هنگام بار زیر ۷۰٪ بماند",
      },
    ],
  },
  {
    id: "port_mismatch",
    title_fa: "ناهمخوانی پورت برنامه با پورت پلتفرم لیارا",
    title_en: "App port does not match the platform port",
    symptoms: ["unhealthy", "deploy", "502", "504", "پورت", "port", "دسترسی", "connection"],
    prior: -0.5,
    requiredSignals: ["PORT_MISMATCH"],
    weights: { PORT_MISMATCH: 3, DEPLOY_REGRESSION: 1 },
    against: {},
    dependsOn: ["logs_get", "release_list"],
    explain_fa: "برنامه روی پورتی متفاوت از پورت مشخص‌شده در تنظیمات لیارا به درخواست‌ها گوش می‌دهد، در نتیجه درخواست‌ها به برنامه نمی‌رسند.",
    confirmingTest_fa: "تطبیق پورت اعلام‌شده در لاگ با تنظیمات پورت پروژه",
    suggested_change_fa:
      "پورت گوش‌دادن برنامه را با متغیر PORT یا تنظیم listen یکی کنید. اگر پورت برنامه درست است، پورت تنظیم‌شده‌ی لیارا را به همان پورت لاگ‌شده تغییر دهید (app_update_port).",
    remediations: [
      {
        tool: "app_update_port",
        risk: "L2",
        params_template: { port: "{{listenedPort}}" },
        title_fa: "تغییر پورت برنامه در لیارا به پورت صحیح لاگ‌شده",
        cost_fa: "بدون هزینه؛ ری‌استارت کوتاه",
        impact_fa: "ری‌استارت برنامه با پورت جدید",
        rollback_fa: "بازگرداندن پورت قبلی با app_update_port",
        // A 404 from the app proves the port is right; status 0 or 5xx still means the port is wrong.
        successCriteria: { kind: "probe_not_5xx", path: FAILING_PATH, allow4xx: true },
        successCriteria_fa: "مسیر عمومی (مسیر خراب یا /) پاسخ برنامه را بدهد (۲xx، ۳xx یا ۴xx)؛ پاسخ ۰ یا ۵xx یعنی هنوز قطع است",
      },
    ],
  },
  {
    id: "db_unreachable",
    title_fa: "عدم دسترسی به پایگاه داده",
    title_en: "Database unreachable",
    symptoms: ["500", "۵۰۰", "error", "خطا", "db", "دیتابیس", "دیتا بیس", "database", "اتصال", "connection", "postgres", "mysql"],
    prior: -0.5,
    requiredSignals: ["DB_UNREACHABLE"],
    weights: { DB_UNREACHABLE: 2.5, APP_EXCEPTION: 0.5, UPSTREAM_SLOW: 0.3 },
    against: { DB_POOL_EXHAUSTED: 2 },
    dependsOn: ["logs_get"],
    explain_fa: "اپلیکیشن نمی‌تواند با سرور پایگاه‌داده ارتباط برقرار کند؛ آدرس، پورت یا دسترسی شبکه اشتباه است، یا سرور دیتابیس در دسترس نیست.",
    confirmingTest_fa: "بررسی DATABASE_URL (میزبان و پورت)، لاگ خطای اتصال و وضعیت سرویس دیتابیس",
    suggested_change_fa:
      "آدرس میزبان و پورت پایگاه‌داده را در DATABASE_URL بررسی کنید (میزبان داخلی لیارا و پورت درست). سپس وضعیت سرویس دیتابیس را ببینید. در کد هم timeout اتصال و retry با backoff بگذارید تا قطعی کوتاه، کل درخواست را خراب نکند.",
    remediations: [
      {
        tool: "db_get",
        risk: "L0",
        params_template: {},
        title_fa: "بررسی وضعیت سرویس دیتابیس",
        cost_fa: "بدون هزینه",
        impact_fa: "فقط خواندن",
        rollback_fa: "—",
        successCriteria: { kind: "probe_ok", path: FAILING_PATH },
        successCriteria_fa: "سرویس دیتابیس در دسترس باشد و مسیر خراب پاسخ ۲xx بدهد",
      },
      {
        tool: "app_update_envs",
        risk: "L2",
        params_template: {},
        title_fa: "اصلاح مقدار DATABASE_URL و راه‌اندازی مجدد",
        cost_fa: "بدون هزینه؛ ری‌استارت کوتاه",
        impact_fa: "ری‌استارت برنامه؛ مقدار امن در کارت تأیید پنهان است",
        rollback_fa: "بازگرداندن مقدار قبلی",
        successCriteria: { kind: "probe_ok", path: FAILING_PATH },
        successCriteria_fa: "اتصال در لاگ موفق باشد و مسیر خراب پاسخ ۲xx بدهد",
      },
    ],
  },
  {
    id: "db_pool",
    title_fa: "تمام شدن اتصال‌های پایگاه‌داده (Connection Pool)",
    title_en: "Database connection pool exhausted",
    symptoms: ["pool", "اتصال", "connection", "کانکشن", "timeout", "تایم‌اوت", "کند", "slow", "500", "۵۰۰"],
    prior: -0.5,
    requiredSignals: ["DB_POOL_EXHAUSTED"],
    weights: { DB_POOL_EXHAUSTED: 3, APP_EXCEPTION: 0.5 },
    against: { DB_UNREACHABLE: 2 },
    dependsOn: ["logs_get"],
    explain_fa: "برنامه بیش از ظرفیت اتصال‌های مجاز دیتابیس درخواست می‌کند؛ اتصال‌ها بسته نمی‌شوند یا pool کوچک است.",
    confirmingTest_fa: "شمارش اتصال‌های باز دیتابیس و اندازه‌ی pool در تنظیمات کلاینت",
    suggested_change_fa:
      "اندازه‌ی pool را با تعداد نمونه‌ها و سقف max_connections دیتابیس تنظیم کنید و اتصال‌ها را در پایان هر درخواست آزاد کنید (در finally یا hook مربوطه). اتصال‌هایی که بدون بستن رها می‌شوند را پیدا کنید.",
    remediations: [
      {
        tool: "coding_agent_handoff",
        risk: "L0",
        params_template: {},
        title_fa: "Fix Brief برای اندازه‌ی pool و آزادسازی اتصال‌ها",
        cost_fa: "بدون هزینه",
        impact_fa: "بدون تغییر در برنامه‌ی زنده",
        rollback_fa: "—",
        successCriteria: { kind: "no_error_signature", signature: "{{poolSignature}}" },
        successCriteria_fa: "خطای pool دیگر در لاگ دیده نشود",
      },
    ],
  },
  {
    id: "cache_unreachable",
    title_fa: "عدم دسترسی به کش (Redis)",
    title_en: "Cache (Redis) unreachable",
    symptoms: ["redis", "ردیس", "کش", "cache", "خطا", "error", "کند", "slow", "timeout", "۵۰۰", "500"],
    prior: -0.5,
    requiredSignals: ["CACHE_UNREACHABLE"],
    weights: { CACHE_UNREACHABLE: 3, APP_EXCEPTION: 0.5 },
    against: {},
    dependsOn: ["logs_get"],
    explain_fa: "برنامه نمی‌تواند به سرور Redis متصل شود. این مشکل کش است، نه پایگاه‌داده.",
    confirmingTest_fa: "بررسی REDIS_URL و پاسخ‌دادن Redis به اتصال از محیط برنامه",
    suggested_change_fa:
      "آدرس Redis (مثلاً REDIS_URL) و دسترس‌پذیری آن را بررسی کنید. کد باید در قطع کش، به منبع اصلی fallback کند، timeout کوتاه داشته باشد و خطای کش را به ۵۰۰ تبدیل نکند.",
    remediations: [
      {
        tool: "app_update_envs",
        risk: "L2",
        params_template: {},
        title_fa: "اصلاح آدرس Redis (REDIS_URL) و راه‌اندازی مجدد",
        cost_fa: "بدون هزینه؛ ری‌استارت کوتاه",
        impact_fa: "ری‌استارت برنامه؛ مقدار امن در کارت تأیید پنهان است",
        rollback_fa: "بازگرداندن مقدار قبلی",
        successCriteria: { kind: "probe_ok", path: FAILING_PATH },
        successCriteria_fa: "مسیر خراب پاسخ ۲xx بدهد و خطای Redis در لاگ تکرار نشود",
      },
      {
        tool: "coding_agent_handoff",
        risk: "L0",
        params_template: {},
        title_fa: "Fix Brief برای fallback و timeout کش",
        cost_fa: "بدون هزینه",
        impact_fa: "بدون تغییر در برنامه‌ی زنده",
        rollback_fa: "—",
        successCriteria: { kind: "probe_ok", path: FAILING_PATH },
        successCriteria_fa: "با قطع کش، مسیر خراب همچنان پاسخ ۲xx بدهد",
      },
    ],
  },
  {
    id: "disk_full",
    title_fa: "پر شدن فضای دیسک",
    title_en: "Disk full",
    symptoms: ["دیسک", "فضا", "disk", "space", "ذخیره", "ENOSPC", "خطا", "error", "500", "۵۰۰"],
    prior: -0.5,
    requiredSignals: ["DISK_FULL"],
    weights: { DISK_FULL: 3, APP_EXCEPTION: 0.3 },
    against: {},
    dependsOn: ["logs_get"],
    explain_fa: "فضای دیسک برنامه پر شده و نوشتن فایل یا لاگ با خطای ENOSPC شکست می‌خورد.",
    confirmingTest_fa: "بررسی درصد مصرف دیسک و فایل‌های بزرگ لاگ یا کش",
    suggested_change_fa:
      "فایل‌های لاگ و کش موقت را پاک یا rotate کنید و نوشتن بی‌وقفه‌ی لاگ را محدود کنید. اگر داده‌ی ماندگار زیاد است، پلن با دیسک بزرگ‌تر را بررسی کنید.",
    remediations: [
      {
        tool: "app_resize_plan",
        risk: "L2",
        params_template: {},
        title_fa: "ارتقای پلن با دیسک بزرگ‌تر",
        cost_fa: "هزینه‌ی ماهانه‌ی پلن بالاتر",
        impact_fa: "قطع کوتاه هنگام تغییر پلن",
        rollback_fa: "بازگشت به پلن قبلی",
        successCriteria: { kind: "disk_used_below", pct: 80 },
        successCriteria_fa: "مصرف دیسک زیر ۸۰٪ باشد",
      },
      {
        tool: "coding_agent_handoff",
        risk: "L0",
        params_template: {},
        title_fa: "Fix Brief برای کاهش نوشتن لاگ و فایل‌های موقت",
        cost_fa: "بدون هزینه",
        impact_fa: "بدون تغییر در برنامه‌ی زنده",
        rollback_fa: "—",
        successCriteria: { kind: "disk_used_below", pct: 80 },
        successCriteria_fa: "مصرف دیسک زیر ۸۰٪ بماند",
      },
    ],
  },
  {
    id: "upstream_slow",
    title_fa: "کندی سرویس خارجی یا درگاه پرداخت",
    title_en: "Slow external upstream",
    symptoms: ["کند", "slow", "timeout", "تایم‌اوت", "تاخیر", "تأخیر", "پرداخت", "درگاه", "api", "502", "504"],
    prior: -0.5,
    requiredSignals: ["UPSTREAM_SLOW"],
    weights: { UPSTREAM_SLOW: 2.5, APP_EXCEPTION: 0.3 },
    against: { CPU_SATURATION: 2, MEMORY_PRESSURE: 1.5, OOM_KILLED: 2, CRASH_LOOP: 1.5 },
    dependsOn: ["http_probe", "logs_get"],
    explain_fa: "کندی از سرویس خارجی یا وابستگی بیرونی می‌آید؛ منابع خود برنامه (CPU و RAM) فشار ندارند.",
    confirmingTest_fa: "بررسی زمان پاسخ میزبان خارجی و تایم‌اوت‌ها در لاگ، با CPU و RAM عادی",
    suggested_change_fa:
      "برای سرویس خارجی timeout کوتاه، retry محدود با backoff و circuit breaker بگذارید. پاسخ‌های پرتکرار و قابل کش را cache کنید و در صورت امکان کار کند را به پس‌زمینه ببرید.",
    remediations: [
      {
        tool: "coding_agent_handoff",
        risk: "L0",
        params_template: {},
        title_fa: "Fix Brief برای timeout، retry و کش وابستگی خارجی",
        cost_fa: "بدون هزینه",
        impact_fa: "بدون تغییر در برنامه‌ی زنده",
        rollback_fa: "—",
        successCriteria: { kind: "probe_latency_below", path: FAILING_PATH, ms: 1000 },
        successCriteria_fa: "زمان پاسخ مسیر کند زیر ۱۰۰۰ میلی‌ثانیه شود",
      },
    ],
  },
  {
    id: "crash_loop",
    title_fa: "چرخه‌ی کرش و ری‌استارت مکرر",
    title_en: "Crash loop",
    symptoms: ["کرش", "crash", "ری‌استارت", "restart", "بالا نمیاد", "بالا نمی‌آید", "boot", "loop", "500", "۵۰۰", "خطا", "error"],
    prior: -0.5,
    requiredSignals: ["CRASH_LOOP", "APP_EXCEPTION"],
    weights: { CRASH_LOOP: 2.5, APP_EXCEPTION: 1.5, DEPLOY_REGRESSION: 0.8 },
    // Exits caused by OOM kills belong to oom_leak / undersized_plan, not to a boot exception.
    against: { APP_STOPPED: 2, OOM_KILLED: 2 },
    dependsOn: ["applets_get", "logs_get"],
    explain_fa: "برنامه پشت سر هم کرش می‌کند و دوباره اجرا می‌شود؛ استثنای تکرارشونده در لاگ علت احتمالی است.",
    confirmingTest_fa: "استخراج stack trace آخرین کرش و تطبیق با زمان ری‌استارت‌ها",
    suggested_change_fa:
      "علت خروج پروسه را از stack trace پیدا کنید (خطای import، پیکربندی یا استثنای مرحله‌ی بوت) و همان را اصلاح کنید. تا آن زمان به ریلیز READY قبلی برگردید.",
    remediations: [
      {
        tool: "release_rollback",
        risk: "L2",
        params_template: {},
        title_fa: "بازگشت به ریلیز پایدار قبلی (Rollback)",
        cost_fa: "بدون هزینه؛ ری‌استارت کوتاه",
        impact_fa: "برنامه با نسخه‌ی قبلی راه‌اندازی می‌شود",
        rollback_fa: "انتشار دوباره‌ی ریلیز جدید پس از اصلاح",
        successCriteria: { kind: "applets_running" },
        successCriteria_fa: "نمونه‌ی برنامه در حال اجرا باشد و ری‌استارت جدید نخورد",
      },
      {
        tool: "coding_agent_handoff",
        risk: "L0",
        params_template: {},
        title_fa: "Fix Brief برای استثنای بوت",
        cost_fa: "بدون هزینه",
        impact_fa: "بدون تغییر در برنامه‌ی زنده",
        rollback_fa: "—",
        successCriteria: { kind: "restarts_stable" },
        successCriteria_fa: "پس از اصلاح، ری‌استارت جدیدی ثبت نشود",
      },
    ],
  },
  {
    id: "app_stopped",
    title_fa: "اپلیکیشن خاموش است",
    title_en: "Application is stopped",
    symptoms: ["خاموش", "stopped", "down", "آفلاین", "offline", "متوقف", "بالا نیست", "بالا نمیاد", "آنلاین"],
    prior: -0.5,
    requiredSignals: ["APP_STOPPED"],
    weights: { APP_STOPPED: 3 },
    against: { CRASH_LOOP: 1 },
    dependsOn: ["app_get", "applets_get"],
    explain_fa: "اپلیکیشن در حال اجرا نیست: تعداد نمونه‌ها صفر است یا هیچ نمونه‌ای روشن نیست.",
    confirmingTest_fa: "بررسی scale و وضعیت applets در لیارا",
    suggested_change_fa:
      "برنامه خاموش است. اگر خاموشی عمدی نیست، تعداد نمونه را به ۱ برگردانید (app_scale). اگر خودبه‌خود خاموش شده، لاگ آخرین خروج را بررسی کنید.",
    remediations: [
      {
        tool: "app_scale",
        risk: "L2",
        params_template: { scale: 1 },
        title_fa: "روشن کردن برنامه (تعداد نمونه ۱)",
        cost_fa: "هزینه‌ی یک نمونه‌ی فعال",
        impact_fa: "برنامه بالا می‌آید و هزینه شروع می‌شود",
        rollback_fa: "خاموش کردن با scale 0 (L3)",
        successCriteria: { kind: "applets_running" },
        successCriteria_fa: "حداقل یک نمونه‌ی برنامه در حال اجرا باشد",
      },
    ],
  },
  {
    id: "code_exception",
    title_fa: "خطای مدیریت‌نشده در کد برنامه",
    title_en: "Unhandled exception in application code",
    symptoms: ["500", "۵۰۰", "خطا", "error", "exception", "panic", "استثنا", "باگ", "bug"],
    prior: -1,
    requiredSignals: ["APP_EXCEPTION"],
    weights: { APP_EXCEPTION: 2 },
    // A few stray errors do not explain a saturated resource: the saturation wins.
    against: { CPU_SATURATION: 1.5, MEMORY_PRESSURE: 1, OOM_KILLED: 1.5 },
    dependsOn: ["logs_get"],
    explain_fa: "یک استثنای مدیریت‌نشده در کد برنامه رخ داده که باعث بازگرداندن خطای داخلی سرور می‌شود.",
    confirmingTest_fa: "استخراج stack trace و تعیین فایل و خط دقیق خطا",
    suggested_change_fa:
      "stack trace خطای پرتکرار را بخوانید، فایل و خط مشخص‌شده را بررسی کنید، ورودی‌های null یا undefined را محافظت کنید و خطا را با پیام معنی‌دار مدیریت کنید.",
    remediations: [
      {
        tool: "coding_agent_handoff",
        risk: "L0",
        params_template: {},
        title_fa: "تولید Fix Brief ساختاریافته برای رفع باگ در کد",
        cost_fa: "بدون هزینه",
        impact_fa: "بدون تغییر در برنامه‌ی زنده",
        rollback_fa: "—",
        successCriteria: { kind: "probe_ok", path: FAILING_PATH },
        successCriteria_fa: "پس از اصلاح و دیپلوی، مسیر خراب پاسخ ۲xx بدهد",
      },
    ],
  },
  {
    id: "app_unreachable_proxy",
    title_fa: "پروکسی به برنامه نمی‌رسد (502)",
    title_en: "Reverse proxy cannot reach the application (502)",
    symptoms: ["502", "۵۰۲", "bad gateway", "پروکسی", "nginx", "دروازه", "بالا نمیاد", "بالا نمی‌آید", "باز نمی", "خطا", "error"],
    prior: -0.5,
    requiredSignals: ["PROXY_UPSTREAM_DOWN"],
    weights: { PROXY_UPSTREAM_DOWN: 3, APP_EXCEPTION: 0.5, CRASH_LOOP: 0.5 },
    against: { APP_STOPPED: 1 },
    dependsOn: ["logs_get"],
    explain_fa: "پروکسی (nginx) نتوانست به پروسه‌ی برنامه وصل شود یا اتصال در میانه‌ی پاسخ بسته شد؛ برنامه یا بالا نیست یا روی پورتی غیر از پورت پروکسی گوش می‌دهد.",
    confirmingTest_fa: "بررسی پیام connect() failed یا upstream prematurely closed و زمان آخرین خروج برنامه در رویدادها",
    suggested_change_fa:
      "اگر پیام connection refused است، پورت گوش‌دادن برنامه را با پورت تنظیم‌شده یکی کنید. اگر اتصال در میانه‌ی پاسخ بسته شده، آخرین stack trace را بخوانید: برنامه احتمالاً کرش می‌کند. ری‌استارت فقط اثر موقت دارد.",
    remediations: [
      {
        tool: "app_restart",
        risk: "L2",
        params_template: {},
        title_fa: "ری‌استارت برنامه و اتصال دوباره‌ی پروکسی",
        cost_fa: "بدون هزینه؛ حدود ۱۰ ثانیه قطعی",
        impact_fa: "قطع کوتاه سرویس",
        rollback_fa: "نیازی نیست",
        successCriteria: { kind: "probe_not_5xx", path: FAILING_PATH },
        successCriteria_fa: "مسیر خراب پاسخ ۲xx یا ۳xx بدهد",
      },
      {
        tool: "coding_agent_handoff",
        risk: "L0",
        params_template: {},
        title_fa: "Fix Brief برای کرش یا پورت نادرست برنامه",
        cost_fa: "بدون هزینه",
        impact_fa: "بدون تغییر در برنامه‌ی زنده",
        rollback_fa: "—",
        successCriteria: { kind: "probe_not_5xx", path: FAILING_PATH },
        successCriteria_fa: "پس از اصلاح، مسیر خراب پاسخ ۲xx یا ۳xx بدهد",
      },
    ],
  },
  {
    id: "port_conflict",
    title_fa: "تداخل پورت (پورت در حال استفاده است)",
    title_en: "Port already in use (EADDRINUSE)",
    symptoms: ["پورت", "port", "EADDRINUSE", "address", "در حال استفاده", "بالا نمیاد", "بالا نمی‌آید", "کرش", "crash", "خطا", "error"],
    prior: -0.5,
    requiredSignals: ["PORT_CONFLICT"],
    weights: { PORT_CONFLICT: 3, CRASH_LOOP: 0.5, APP_EXCEPTION: 0.2 },
    against: {},
    dependsOn: ["logs_get"],
    explain_fa: "پروسه‌ی دیگری روی همان پورت گوش می‌دهد (EADDRINUSE). معمولاً دو نمونه‌ی برنامه، یا یک پروسه‌ی قدیمی که پایان نیافته، روی یک پورت ثابت بالا می‌آیند.",
    confirmingTest_fa: "بررسی تعداد نمونه‌ها (scale) و پورت ثابت در کد که با متغیر PORT یکی نیست",
    suggested_change_fa:
      "پورت را فقط از متغیر PORT بخوانید و در کد عدد ثابت نگذارید. هر نمونه یک پروسه‌ی واحد اجرا کند. اگر پروسه‌ی قدیمی باقی می‌ماند، خاتمه‌ی تمیز (SIGTERM) و بستن سرور را پیاده کنید.",
    remediations: [
      {
        tool: "app_restart",
        risk: "L2",
        params_template: {},
        title_fa: "ری‌استارت برای آزادسازی پورت",
        cost_fa: "بدون هزینه؛ حدود ۱۰ ثانیه قطعی",
        impact_fa: "قطع کوتاه سرویس",
        rollback_fa: "نیازی نیست",
        successCriteria: { kind: "applets_running" },
        successCriteria_fa: "نمونه‌ی برنامه بالا بیاید و خطای EADDRINUSE دوباره دیده نشود",
      },
      {
        tool: "coding_agent_handoff",
        risk: "L0",
        params_template: {},
        title_fa: "Fix Brief برای خواندن پورت از متغیر محیطی",
        cost_fa: "بدون هزینه",
        impact_fa: "بدون تغییر در برنامه‌ی زنده",
        rollback_fa: "—",
        successCriteria: { kind: "probe_not_5xx", path: FAILING_PATH },
        successCriteria_fa: "پس از اصلاح، مسیر خراب پاسخ ۲xx یا ۳xx بدهد",
      },
    ],
  },
  {
    id: "tls_error",
    title_fa: "خطای گواهی TLS",
    title_en: "TLS certificate verification failed",
    symptoms: ["ssl", "tls", "گواهی", "certificate", "https", "امنیت", "ارتباط امن", "خطا", "error"],
    prior: -0.5,
    requiredSignals: ["TLS_ERROR"],
    weights: { TLS_ERROR: 3, APP_EXCEPTION: 0.3 },
    against: {},
    dependsOn: ["logs_get"],
    explain_fa: "اعتبارسنجی گواهی TLS شکست خورده: زنجیره‌ی گواهی ناقص است، گواهی منقضی شده، یا گواهی خودامضا است.",
    confirmingTest_fa: "تعیین میزبانی که گواهی‌اش رد شده (در پیام خطا) و بررسی تاریخ انقضای آن",
    suggested_change_fa:
      "اگر سرویس مقابل گواهی معتبر دارد، زنجیره‌ی CA را در محیط برنامه تنظیم کنید (مثلاً NODE_EXTRA_CA_CERTS یا CA bundle در پایتون). اگر گواهی منقضی شده، تمدید آن با صاحب سرویس است. هرگز اعتبارسنجی TLS را در کد خاموش نکنید.",
    remediations: [
      {
        tool: "coding_agent_handoff",
        risk: "L0",
        params_template: {},
        title_fa: "Fix Brief برای تنظیم اعتبارسنجی گواهی",
        cost_fa: "بدون هزینه",
        impact_fa: "بدون تغییر در برنامه‌ی زنده",
        rollback_fa: "—",
        successCriteria: { kind: "probe_not_5xx", path: FAILING_PATH },
        successCriteria_fa: "پس از اصلاح، مسیر خراب پاسخ ۲xx یا ۳xx بدهد",
      },
    ],
  },
  {
    id: "build_error",
    title_fa: "خطای ساخت برنامه (Build)",
    title_en: "Application build failed",
    symptoms: ["build", "بیلد", "ساخت", "deploy", "دیپلوی", "module", "ماژول", "compile", "کامپایل", "next", "نکست"],
    prior: -0.5,
    requiredSignals: ["BUILD_ERROR"],
    weights: { BUILD_ERROR: 3 },
    against: {},
    dependsOn: ["logs_get"],
    explain_fa: "ساخت یا اجرای برنامه شکست خورده است: ماژول یا فایلی پیدا نشده، یا کامپایل به خطا خورده است. این خطا از کد یا وابستگی‌ها می‌آید، نه از تنظیمات لیارا.",
    confirmingTest_fa: "خواندن نام دقیق ماژول یا فایل گم‌شده در پیام خطا و بررسی وجود آن در package.json و lock file",
    suggested_change_fa:
      "نام ماژول یا مسیر import را در پیام خطا بخوانید. اگر پکیج نصب نشده، آن را به package.json اضافه کنید و lock file را commit کنید. اگر پکیج فقط در devDependencies است ولی برای ساخت یا اجرا لازم است، آن را به dependencies ببرید. همان دستور ساخت (مثلاً next build یا npm run build) را پیش از دیپلوی روی ماشین خود اجرا کنید.",
    remediations: [
      {
        tool: "coding_agent_handoff",
        risk: "L0",
        params_template: {},
        title_fa: "Fix Brief برای رفع خطای ساخت",
        cost_fa: "بدون هزینه",
        impact_fa: "بدون تغییر در برنامه‌ی زنده",
        rollback_fa: "—",
        successCriteria: { kind: "probe_not_5xx", path: FAILING_PATH },
        successCriteria_fa: "پس از ساخت موفق و دیپلوی، مسیر خراب پاسخ ۲xx یا ۳xx بدهد",
      },
    ],
  },
];

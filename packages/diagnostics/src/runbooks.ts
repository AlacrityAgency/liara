import type { SignalKind, Remediation } from "@sokan/contracts";

export interface DiagnosticRunbook {
  id: string;
  title_fa: string;
  symptoms: string[];
  requiredSignals: SignalKind[];
  supportingSignals: SignalKind[];
  contradictingSignals?: SignalKind[];
  explain_fa: string;
  remediations: Remediation[];
  confirmingTest_fa?: string;
}

export const RUNBOOKS: DiagnosticRunbook[] = [
  {
    id: "rb_missing_env",
    title_fa: "فقدان متغیر محیطی ضروری",
    symptoms: ["500", "error", "crash", "deploy"],
    requiredSignals: ["MISSING_ENV"],
    supportingSignals: ["DEPLOY_REGRESSION", "APP_EXCEPTION", "CRASH_LOOP"],
    contradictingSignals: ["OOM_KILLED"],
    explain_fa: "یکی از متغیرهای محیطی که برنامه برای اتصال یا شروع به کار نیاز دارد در تنظیمات لیارا وجود ندارد.",
    confirmingTest_fa: "بررسی فهرست متغیرهای تنظیم‌شده در برابر لاگ خطا و فایل .env.example",
    remediations: [
      {
        id: "rem_update_envs",
        action: "app_update_envs",
        params: {},
        riskLevel: "L2",
        label_fa: "افزودن متغیرهای محیطی جاافتاده و راه‌اندازی مجدد",
        note_fa: "نیاز به وارد کردن مقدار امن دارد",
        successCriteria_fa: "برطرف شدن خطای ۵۰۰ در پروب و عدم تکرار خطای missing env در لاگ",
      },
    ],
  },
  {
    id: "rb_oom_killed",
    title_fa: "اتمام حافظه و توقف کانتینر توسط OOM",
    symptoms: ["slow", "502", "503", "restarts", "crash", "oom"],
    requiredSignals: ["OOM_KILLED"],
    supportingSignals: ["MEMORY_PRESSURE", "MEMORY_LEAK_TREND", "CRASH_LOOP"],
    explain_fa: "کانتینر شما بیش از سقف حافظه‌ی پلن مصرف کرده و سیستم عامل لینوکس آن را متوقف کرده است.",
    confirmingTest_fa: "بررسی نمودار حافظه قبل از توقف و تطبیق با رویداد OOM در applets",
    remediations: [
      {
        id: "rem_scale_up",
        action: "app_resize_plan",
        params: {},
        riskLevel: "L2",
        label_fa: "ارتقای پلن به رم بالاتر",
        note_fa: "برای زمانی که نیاز پایه برنامه بیشتر از پلن فعلی است",
        successCriteria_fa: "عدم وقوع OOM تا ۳۰ دقیقه و اوج مصرف حافظه زیر ۸۰٪ سقف جدید",
      },
      {
        id: "rem_restart_temp",
        action: "app_restart",
        params: {},
        riskLevel: "L2",
        label_fa: "ری‌استارت موقت برای آزادسازی حافظه",
        note_fa: "راه‌حل موقت برای بازگشت سرویس در زمان بررسی علت ریشه‌ای",
        successCriteria_fa: "بازگشت برنامه به وضعیت READY و پاسخ‌دهی ۲۰۰ به پروب",
      },
      {
        id: "rem_code_fix",
        action: "coding_agent_handoff",
        params: {},
        riskLevel: "L0",
        label_fa: "ارجاع به ایجنت کدنویس برای رفع نشت حافظه در کد",
        note_fa: "در صورت وجود روند خطی نشت حافظه",
        successCriteria_fa: "اصلاح حلقه‌ها، کش‌های سراسری یا آزادسازی بافرها در کد",
      },
    ],
  },
  {
    id: "rb_port_mismatch",
    title_fa: "ناهمخوانی پورت برنامه با پورت پلتفرم لیارا",
    symptoms: ["unhealthy", "deploy", "502", "504"],
    requiredSignals: ["PORT_MISMATCH"],
    supportingSignals: ["DEPLOY_REGRESSION"],
    explain_fa: "برنامه روی پورتی متفاوت از پورت مشخص‌شده در تنظیمات لیارا به درخواست‌ها گوش می‌دهد، در نتیجه درخواست‌ها به برنامه نمی‌رسند.",
    confirmingTest_fa: "تطبیق پورت اعلام شده در لاگ با تنظیمات پورت پروژه",
    remediations: [
      {
        id: "rem_update_port",
        action: "app_update_port",
        params: {},
        riskLevel: "L2",
        label_fa: "تغییر پورت برنامه در لیارا به پورت صحیح لاگ‌شده",
        successCriteria_fa: "تغییر وضعیت کانتینر به HEALTHY و پاسخ‌دهی موفق به پروب",
      },
    ],
  },
  {
    id: "rb_db_unreachable",
    title_fa: "عدم دسترسی به پایگاه داده",
    symptoms: ["500", "error", "db", "slow"],
    requiredSignals: ["DB_UNREACHABLE"],
    supportingSignals: ["APP_EXCEPTION", "UPSTREAM_SLOW"],
    explain_fa: "اپلیکیشن نمی‌تواند با پایگاه داده ارتباط برقرار کند؛ یا آدرس اشتباه است یا دسترسی قطع است یا سرور دیتابیس تحت فشار است.",
    confirmingTest_fa: "بررسی پینگ، لاگ خطای اتصال و وضعیت سرویس دیتابیس",
    remediations: [
      {
        id: "rem_check_db_creds",
        action: "app_update_envs",
        params: {},
        riskLevel: "L2",
        label_fa: "بررسی و اصلاح مقدار DATABASE_URL",
        successCriteria_fa: "اتصال موفقیت‌آمیز در لاگ و پروب ۲۰۰",
      },
    ],
  },
  {
    id: "rb_cpu_saturation",
    title_fa: "اشباع پردازنده",
    symptoms: ["slow", "timeout", "504"],
    requiredSignals: ["CPU_SATURATION"],
    supportingSignals: ["UPSTREAM_SLOW", "TRAFFIC_SPIKE"],
    explain_fa: "پردازنده‌ی اختصاص‌یافته به اپلیکیشن به صورت پیوسته در سقف ظرفیت کار می‌کند و باعث تأخیر در پاسخ‌دهی شده است.",
    confirmingTest_fa: "بررسی میانگین ۵ دقیقه‌ای نمودار مصرف پردازنده",
    remediations: [
      {
        id: "rem_resize_cpu",
        action: "app_resize_plan",
        params: {},
        riskLevel: "L2",
        label_fa: "ارتقای هسته پردازنده در پلن",
        successCriteria_fa: "کاهش مصرف CPU به زیر ۷۰٪ و زمان پاسخگویی زیر ۵۰۰ میلی‌ثانیه",
      },
    ],
  },
  {
    id: "rb_code_exception",
    title_fa: "خطای مدیریت‌نشده در کد برنامه",
    symptoms: ["500", "error"],
    requiredSignals: ["APP_EXCEPTION"],
    supportingSignals: ["CRASH_LOOP"],
    explain_fa: "یک استثنای مدیریت‌نشده در کد برنامه رخ داده که باعث بازگرداندن خطای داخلی سرور می‌شود.",
    confirmingTest_fa: "استخراج stack trace و تعیین فایل و خط دقیق خطا",
    remediations: [
      {
        id: "rem_fix_brief",
        action: "coding_agent_handoff",
        params: {},
        riskLevel: "L0",
        label_fa: "تولید Fix Brief ساختاریافته برای رفع باگ در کد",
        successCriteria_fa: "اصلاح باگ توسط برنامه‌نویس یا دستیار کدنویسی",
      },
    ],
  },
  {
    id: "rb_memory_leak",
    title_fa: "نشت تدریجی حافظه (Memory Leak) و اشباع رم",
    symptoms: ["memory", "leak", "slow", "502", "503"],
    requiredSignals: ["MEMORY_LEAK_TREND"],
    supportingSignals: ["MEMORY_PRESSURE", "UPSTREAM_SLOW", "DEPLOY_REGRESSION"],
    contradictingSignals: ["APP_STOPPED"],
    explain_fa: "نشت تدریجی حافظه باعث افزایش مداوم رم و در نهایت کندی یا از دسترس خارج شدن سرویس می‌شود.",
    confirmingTest_fa: "بررسی شیب نمودار حافظه و لاگ‌های نشت حافظه",
    remediations: [
      {
        id: "rem_leak_resize",
        action: "app_resize_plan",
        params: { newPlanId: "ram-1g-cpu-0.5" },
        riskLevel: "L2",
        label_fa: "ارتقای پلن به پلن بالاتر (۱ گیگابایت رم) و ری‌استارت کنترل‌شده سرویس برای آزادسازی حافظه",
        note_fa: "ارتقای پلن به پلن بالاتر (۱ گیگابایت رم) و ری‌استارت کنترل‌شده سرویس برای آزادسازی حافظه",
        successCriteria_fa: "آزادسازی حافظه و بازگشت سرویس به وضعیت پایدار",
      },
    ],
  },
  {
    id: "rb_disk_full",
    title_fa: "پر شدن فضای دیسک (Disk Full)",
    symptoms: ["disk", "enospc", "500", "error"],
    requiredSignals: ["DISK_FULL"],
    supportingSignals: ["APP_EXCEPTION"],
    contradictingSignals: ["APP_STOPPED"],
    explain_fa: "فضای دیسک سرویس پر شده و امکان نوشتن فایل یا لاگ جدید وجود ندارد.",
    confirmingTest_fa: "بررسی درصد مصرف دیسک و لاگ‌های خطای ENOSPC",
    remediations: [
      {
        id: "rem_disk_resize",
        action: "app_resize_plan",
        params: { newPlanId: "ram-1g-cpu-0.5" },
        riskLevel: "L2",
        label_fa: "افزایش فضای دیسک/پلن و پاک‌سازی فایل‌های موقت",
        note_fa: "افزایش فضای دیسک/پلن و پاک‌سازی فایل‌های موقت",
        successCriteria_fa: "آزادسازی فضای دیسک و رفع خطای ENOSPC",
      },
    ],
  },
  {
    id: "rb_upstream_slow",
    title_fa: "کندی یا تایم‌اوت سرویس‌های بالادستی (Upstream Slow)",
    symptoms: ["slow", "timeout", "504", "502"],
    requiredSignals: ["UPSTREAM_SLOW"],
    supportingSignals: ["CPU_SATURATION", "TRAFFIC_SPIKE"],
    contradictingSignals: ["APP_STOPPED"],
    explain_fa: "سرویس‌های خارجی یا بالادستی با تأخیر پاسخ می‌دهند یا پاسخ نمی‌دهند که باعث تجمع درخواست‌ها شده است.",
    confirmingTest_fa: "بررسی زمان پاسخ پروب‌ها و خطاهای upstream timeout در لاگ",
    remediations: [
      {
        id: "rem_upstream_restart",
        action: "app_restart",
        params: {},
        riskLevel: "L2",
        label_fa: "ری‌استارت سرویس و بازنشانی استخر اتصالات بیرونی (Connection Pool)",
        note_fa: "ری‌استارت سرویس و بازنشانی استخر اتصالات بیرونی (Connection Pool)",
        successCriteria_fa: "بازنشانی اتصالات شبکه و کاهش زمان پاسخگویی",
      },
    ],
  },
  {
    id: "rb_app_stopped",
    title_fa: "خاموش بودن یا توقف اپلیکیشن (App Stopped)",
    symptoms: ["down", "stopped", "503"],
    requiredSignals: ["APP_STOPPED"],
    supportingSignals: ["CRASH_LOOP"],
    contradictingSignals: [],
    explain_fa: "اپلیکیشن در وضعیت خاموش یا بدون نمونه اجرایی قرار دارد.",
    confirmingTest_fa: "بررسی تعداد نمونه‌های فعال (scale) اپلیکیشن",
    remediations: [
      {
        id: "rem_start_app",
        action: "app_restart",
        params: {},
        riskLevel: "L2",
        label_fa: "روشن کردن و راه‌اندازی مجدد سرویس متوقف‌شده",
        note_fa: "روشن کردن و راه‌اندازی مجدد سرویس متوقف‌شده",
        successCriteria_fa: "روشن شدن کانتینر و پاسخ‌دهی موفق به پروب",
      },
    ],
  },
];

export const STANDARD_RUNBOOKS: DiagnosticRunbook[] = RUNBOOKS;

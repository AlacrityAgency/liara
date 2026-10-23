export interface LiaraLimit {
  id: string;
  what_fa: string;
  why_fa: string;
  workaround_fa: string;
}

/** What the Liara API cannot do, and how Sokan handles it. Shown to the user verbatim. */
export const LIARA_LIMITS: readonly LiaraLimit[] = [
  {
    id: "top_up_payment",
    what_fa: "شارژ حساب و پرداخت",
    why_fa: "پرداخت باید با خود کاربر و در کنسول رسمی لیارا انجام شود؛ API عمومی برای شارژ وجود ندارد.",
    workaround_fa: "محاسبه‌ی کسری موجودی، نمایش لینک کنسول و بررسی مجدد موجودی از /v1/billing.",
  },
  {
    id: "irnic_ns_change",
    what_fa: "تغییر NameServer دامنه در ایرنیک",
    why_fa: "ایرنیک API عمومی و احراز هویت‌شده برای تغییر NS ندارد.",
    workaround_fa: "تولید چک‌لیست با مقادیر قابل کپی و پایش انتشار NS از طریق بررسی Zone در سرویس DNS لیارا.",
  },
  {
    id: "github_oauth_connect",
    what_fa: "اتصال اولیه‌ی GitHub از طریق سُکان",
    why_fa: "در OpenAPI فقط خواندن وضعیت اتصال (GET /v1/me/git-integrations) وجود دارد، نه ایجاد اتصال.",
    workaround_fa: "آپلود مستقیم سورس با دیپلوی، یا تولید workflow برای GitHub Actions با @liara/cli.",
  },
  {
    id: "request_latency_metrics",
    what_fa: "متریک سطح درخواست (زمان پاسخ p95 و نرخ خطای ۵xx)",
    why_fa: "API لیارا فقط مصرف CPU، حافظه، شبکه و دیسک را گزارش می‌دهد.",
    workaround_fa: "پروب HTTP مستقل (httpProbe) و تحلیل لاگ‌های دسترسی برنامه.",
  },
  {
    id: "native_alerts_webhooks",
    what_fa: "هشدار (Alert) و Webhook بومی",
    why_fa: "در مشخصات OpenAPI هیچ اندپوینت هشدار یا وب‌هوک دیده نشد.",
    workaround_fa: "پایش دوره‌ای توسط سُکان با متریک‌ها، رویدادها و پروب خارجی.",
  },
  {
    id: "dedicated_rollback",
    what_fa: "Rollback با یک فراخوانی اختصاصی",
    why_fa: "اندپوینت جداگانه برای بازگشت به نسخه‌ی قبلی در OpenAPI و CLI وجود ندارد.",
    workaround_fa: "ایجاد ریلیز جدید (createRelease) با منبع یا تصویر نسخه‌ی سالم قبلی؛ باید با تست زنده تأیید شود.",
  },
];

import type { HumanError } from "@sokan/contracts";

export function mapHttpError(status: number, message?: string, context?: Record<string, unknown>): HumanError {
  switch (status) {
    case 401:
      return {
        code: "UNAUTHORIZED",
        what_fa: "عدم امکان احراز هویت با لیارا",
        why_fa: "توکن دسترسی API واردشده منقضی شده یا اشتباه است.",
        next_fa: "از کنسول لیارا (بخش حساب کاربری > دسترسی API) یک توکن معتبر دریافت کرده و وارد کنید.",
      };
    case 402:
      return {
        code: "PAYMENT_REQUIRED",
        what_fa: "موجودی حساب کافی نیست",
        why_fa: `اعتبار کیف پول کمتر از هزینه دوره اول این پلن است (${context?.cost_fa ?? "نیاز به شارژ"}).`,
        next_fa: "لطفاً از طریق کنسول رسمی لیارا حساب خود را شارژ کنید؛ پس از افزایش موجودی ادامه را بزنید.",
      };
    case 403:
      return {
        code: "FORBIDDEN",
        what_fa: "محدودیت دسترسی یا سقف پلن رایگان",
        why_fa: "امکان اجرای این عملیات در سطح دسترسی یا پلن جاری وجود ندارد.",
        next_fa: "بررسی تنظیمات تیم یا انتخاب پلن‌های استاندارد با منابع اختصاصی.",
      };
    case 404:
      return {
        code: "NOT_FOUND",
        what_fa: "منبع یا برنامه پیدا نشد",
        why_fa: "نام پروژه یا شناسه واردشده در حساب شما وجود ندارد.",
        next_fa: "نام برنامه را با فهرست برنامه‌ها (دستور app_list) مقایسه کنید.",
      };
    case 409:
      return {
        code: "CONFLICT",
        what_fa: "نام برنامه قبلاً رزرو شده است",
        why_fa: "این نام در شبکه جهانی لیارا قبلاً توسط کاربر دیگری ثبت شده است.",
        next_fa: "یک نام یکتا انتخاب کنید (مثلاً با اضافه کردن یک عدد یا پسوند تصادفی).",
      };
    case 413:
      return {
        code: "PAYLOAD_TOO_LARGE",
        what_fa: "حجم سورس کد بیش از سقف مجاز (۲۵۶ مگابایت)",
        why_fa: "پوشه‌های حجیم یا فایل‌های بیلد محلی در فایل سورس آپلودی قرار دارند.",
        next_fa: "فایل .liaraignore یا .gitignore را بررسی کنید تا node_modules یا فایل‌های غیرضروری استثنا شوند.",
      };
    case 429:
      return {
        code: "RATE_LIMITED",
        what_fa: "تعداد درخواست‌ها به لیارا بیش از حد مجاز است",
        why_fa: "لیارا موقتاً درخواست‌های بیشتری را از این حساب نمی‌پذیرد.",
        next_fa: "چند ثانیه صبر کرده و دوباره تلاش کنید.",
      };
    case 428:
      return {
        code: "PRECONDITION_REQUIRED",
        what_fa: "سقف مجاز انتشار روزانه تکمیل شده",
        why_fa: "تعداد دفعات دیپلوی در طول ۲۴ ساعت اخیر به سقف پلن رسیده است.",
        next_fa: "ارتقای Feature Bundle در کنسول یا تلاش مجدد در روز آینده.",
      };
    default:
      return {
        code: `HTTP_${status}`,
        what_fa: "خطا در ارتباط با سرورهای لیارا",
        why_fa: message || `پاسخ ناموفق با کد وضعیت ${status}`,
        next_fa: "چند لحظه دیگر تلاش کنید یا وضعیت سرویس‌های ابری لیارا را بررسی نمایید.",
      };
  }
}

export function simulatedModeError(): HumanError {
  return {
    code: "SIMULATED_MODE",
    what_fa: "اجرا در حالت شبیه‌ساز محلی (Local Simulation)",
    why_fa: "توکن معتبر LIARA_API_TOKEN ارائه نشده است؛ عملیات به صورت شبیه‌سازی محلی اداره می‌شود.",
    next_fa: "برای اتصال واقعی به ابر لیارا، متغیر LIARA_API_TOKEN را با توکن حساب خود مقداردهی کنید.",
  };
}

export function timeoutError(timeoutMs: number): HumanError {
  return {
    code: "TIMEOUT",
    what_fa: "پاسخ لیارا در زمان مقرر دریافت نشد",
    why_fa: `درخواست پس از ${Math.round(timeoutMs / 1000)} ثانیه متوقف شد.`,
    next_fa: "اتصال اینترنت را بررسی کرده و دوباره تلاش کنید.",
  };
}

export function networkError(message: string): HumanError {
  return {
    code: "NETWORK_ERROR",
    what_fa: "عدم برقراری ارتباط با شبکه لیارا",
    why_fa: `خطای شبکه: ${message}`,
    next_fa: "وضعیت اتصال اینترنت و دسترسی به api.liara.ir را بررسی کنید.",
  };
}

export function packTooLargeError(largest: Array<{ name: string; bytes: number }>): HumanError {
  const list = largest
    .slice(0, 3)
    .map((d) => `${d.name} (${formatMB(d.bytes)})`)
    .join("، ");
  return {
    code: "PACK_TOO_LARGE",
    what_fa: "حجم سورس بیش از ۲۵۶ مگابایت است",
    why_fa: list ? `بزرگ‌ترین پوشه‌ها و فایل‌های شامل‌شده: ${list}.` : "مجموع فایل‌های شامل‌شده بیش از حد مجاز است.",
    next_fa: "یک فایل .liaraignore بسازید و پوشه‌های حجیم غیرضروری (داده، ویدئو، خروجی بیلد) را در آن استثنا کنید.",
  };
}

export function packFailedError(reason: string): HumanError {
  return {
    code: "PACK_FAILED",
    what_fa: "بسته‌بندی سورس انجام نشد",
    why_fa: reason,
    next_fa: "مسیر پوشه‌ی پروژه را بررسی کرده و دوباره تلاش کنید.",
  };
}

export function deployTimeoutError(): HumanError {
  return {
    code: "DEPLOY_TIMEOUT",
    what_fa: "دیپلوی در مدت ۱۰ دقیقه کامل نشد",
    why_fa: "بیلد یا بررسی سلامت ریلیز بیش از حد طول کشید.",
    next_fa: "وضعیت ریلیز را در کنسول لیارا بررسی کنید و در صورت نیاز آن را لغو کنید.",
  };
}

export function buildFailedError(line: string): HumanError {
  return {
    code: "BUILD_FAILED",
    what_fa: "بیلد پروژه با خطا متوقف شد",
    why_fa: `آخرین خطای گزارش‌شده: ${line}`,
    next_fa: "لاگ بیلد را بررسی کنید؛ معمولاً ناشی از اسکریپت build، وابستگی‌ها یا نسخه‌ی پلتفرم است.",
  };
}

export function buildCanceledError(): HumanError {
  return {
    code: "BUILD_CANCELED",
    what_fa: "بیلد لغو شد",
    why_fa: "فرآیند بیلد پیش از پایان متوقف شد.",
    next_fa: "در صورت نیاز دیپلوی را دوباره اجرا کنید.",
  };
}

export function buildTimeoutError(): HumanError {
  return {
    code: "BUILD_TIMEOUT",
    what_fa: "بیلد بیش از حد طول کشید",
    why_fa: "زمان بیلد در سمت لیارا به پایان رسید (حدود ۲۰ دقیقه).",
    next_fa: "بیلد را سبک‌تر کنید (وابستگی‌های کمتر، کش بیلد) و دوباره تلاش کنید.",
  };
}

export function releaseFailedError(reason?: string): HumanError {
  return {
    code: "RELEASE_FAILED",
    what_fa: "ریلیز جدید ساخته نشد",
    why_fa: reason ? `دلیل اعلام‌شده توسط لیارا: ${reason}` : "لیارا ریلیز را ناموفق اعلام کرد.",
    next_fa: "لاگ‌های ریلیز را در کنسول لیارا بررسی کنید.",
  };
}

export function releaseUnhealthyError(): HumanError {
  return {
    code: "RELEASE_UNHEALTHY",
    what_fa: "برنامه مستقر شد اما سالم نیست",
    why_fa: "بررسی سلامت کانتینر پاسخ مطلوب نداد.",
    next_fa: "لاگ‌های برنامه را بررسی کنید و مطمئن شوید پورت برنامه با مقدار تنظیم‌شده یکی است.",
  };
}

export function unknownError(context: string): HumanError {
  return {
    code: "UNKNOWN",
    what_fa: "خطای ناشناخته",
    why_fa: context,
    next_fa: "دوباره تلاش کنید؛ در صورت تکرار، جزئیات را برای پشتیبانی ارسال کنید.",
  };
}

function formatMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} مگابایت`;
}

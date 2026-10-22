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

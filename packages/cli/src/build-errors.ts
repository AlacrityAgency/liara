import type { HumanError } from "../../contracts/src/index";

/** One plain Persian sentence for a failed build, from the error code and the last log lines. */
export function explainBuildFailure(error: HumanError | undefined, lines: string[]): string {
  const text = lines.join("\n");
  const code = error?.code ?? "";
  if (/Missing script:?\s*["']?build|missing script.*build/i.test(text)) {
    return 'اسکریپت "build" در package.json پیدا نشد. یک خط "build" در بخش scripts اضافه کن.';
  }
  if (/heap out of memory|JavaScript heap|ENOMEM|Allocation failed/i.test(text)) {
    return "بیلد به سقف حافظه رسید (heap out of memory). بیلد را سبک‌تر کن یا از بیلد روی سرور لیارا استفاده کن.";
  }
  if (/ERESOLVE/.test(text)) {
    return "وابستگی‌ها با هم تداخل دارند (ERESOLVE). نسخه‌ی کتابخانه‌ها را در package.json هماهنگ کن.";
  }
  if (/ModuleNotFoundError|No module named/.test(text)) {
    return "یک کتابخانه‌ی پایتون در requirements.txt نیست. آن را اضافه کن و دوباره منتشر کن.";
  }
  if (code === "PAYLOAD_TOO_LARGE" || /\b413\b|Payload Too Large/i.test(text)) {
    return "حجم سورس از سقف ۲۵۶ مگابایت بیشتر است. پوشه‌ی node_modules و فایل‌های بزرگ را از سورس بیرون بگذار.";
  }
  if (code === "TIMEOUT") return "بیلد بیش از حد طول کشید و متوقف شد.";
  return error?.what_fa ?? "ساخت برنامه در لیارا شکست خورد.";
}

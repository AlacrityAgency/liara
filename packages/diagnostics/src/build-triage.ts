import type { BuildLogTriageResult } from "@sokan/contracts";

/**
 * Build-Log Diagnostic Triager
 * Parses complex Docker and framework build logs into actionable, human-readable triage advice.
 */
export function triageBuildLogs(logText: string): BuildLogTriageResult {
  const text = String(logText || "");

  // 1. Dependency / Package manager errors
  if (/npm ERR! code ERESOLVE|Could not resolve dependency|ERR_PNPM_|yarn error|No matching distribution found/i.test(text)) {
    const keyLine = text.split("\n").find((l) => /npm ERR!|ERR_PNPM_|Could not resolve|No matching distribution/i.test(l)) || "";
    return {
      success: false,
      failureCategory: "DEPENDENCY_ERROR",
      rootCause_fa: "تداخل وابستگی‌ها یا عدم یافتن پکیج مورد نیاز در مرحله نصب پکیج‌ها (npm/pip/yarn).",
      suggestedFix_fa: "فایل‌های lockfile (مانند package-lock.json) را به روز کنید یا فلگ --legacy-peer-deps را در تنظیمات بیلد قرار دهید.",
      keyLogSnippet: keyLine.slice(0, 200),
    };
  }

  // 2. TypeScript & Compilation errors
  if (/TS\d{4}:|Type error:|SyntaxError:|Cannot find module|Module not found:|Compilation failed/i.test(text)) {
    const keyLine = text.split("\n").find((l) => /TS\d{4}|Cannot find module|SyntaxError|Module not found/i.test(l)) || "";
    return {
      success: false,
      failureCategory: "COMPILATION_ERROR",
      rootCause_fa: "خطای کامپایل سورس‌کد یا عدم یافتن فایل/ماژول در فرآیند بیلد تایپ‌اسکریپت یا وب‌پک.",
      suggestedFix_fa: "مسیر ایمپورت‌های ماژول را در سورس بررسی کرده و از اجرای بدون خطای دستور build به صورت لوکال اطمینان حاصل کنید.",
      keyLogSnippet: keyLine.slice(0, 200),
    };
  }

  // 3. Out of Memory during build
  if (/JavaScript heap out of memory|fatal error: runtime: out of memory|Killed.*build/i.test(text)) {
    return {
      success: false,
      failureCategory: "OUT_OF_MEMORY",
      rootCause_fa: "فرآیند بیلد کانتینر به دلیل اتمام سقف مجاز حافظه رم متوقف شد (OOM).",
      suggestedFix_fa: "فلگ NODE_OPTIONS=\"--max-old-space-size=1536\" را در متغیرهای بیلد تعریف کنید یا کدهای حجیم را بهینه‌سازی نمایید.",
      keyLogSnippet: "JavaScript heap out of memory",
    };
  }

  // 4. Missing required build-time env
  if (/Missing required environment variable|is not defined|env variable.*is missing/i.test(text)) {
    const keyLine = text.split("\n").find((l) => /environment variable|is missing/i.test(l)) || "";
    return {
      success: false,
      failureCategory: "MISSING_ENV",
      rootCause_fa: "یک متغیر محیطی ضروری که در زمان بیلد نیاز بوده، تعریف نشده است.",
      suggestedFix_fa: "متغیرهای مورد نیاز فرانت‌اند (نظیر NEXT_PUBLIC_*) را در تب متغیرهای لیارا پیش از بیلد ثبت کنید.",
      keyLogSnippet: keyLine.slice(0, 200),
    };
  }

  // Check if build was clean
  if (/Build completed successfully|Successfully built|Ready to deploy|Release created successfully/i.test(text)) {
    return {
      success: true,
      failureCategory: "UNKNOWN",
      rootCause_fa: "فرآیند بیلد بدون خطا و با موفقیت کامل انجام شده است.",
      suggestedFix_fa: "نیاز به اقدام اصلاحی نیست؛ پروژه آماده استقرار است.",
      keyLogSnippet: "Build completed successfully",
    };
  }

  return {
    success: false,
    failureCategory: "UNKNOWN",
    rootCause_fa: "فرآیند بیلد با کد خطای غیرصفر متوقف شده است.",
    suggestedFix_fa: "لاگ‌های تفصیلی بیلد را در کنسول بررسی کنید یا دستور استقرار را مجدداً تکرار فرمایید.",
    keyLogSnippet: text.slice(-250),
  };
}

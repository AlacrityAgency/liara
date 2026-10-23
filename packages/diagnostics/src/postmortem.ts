import type { Incident, PostmortemReport } from "@sokan/contracts";

/**
 * Automated 1-Click Postmortem Generator
 * Compiles a structured, industry-standard Markdown postmortem directly from Incident evidence and Audit Ledger.
 */
export function generatePostmortem(
  incident: Incident,
  auditLog: Array<{ tool: string; executedAt: string; success: boolean; detail?: string }> = []
): PostmortemReport {
  const startMs = Date.parse(incident.window.start);
  const endMs = Date.parse(incident.window.end);
  const durationSeconds = Math.max(1, Math.round((endMs - startMs) / 1000));

  const timeline: Array<{ ts: string; event_fa: string }> = [];

  // 1. Initial trigger
  timeline.push({
    ts: incident.window.start,
    event_fa: `آغاز پایش و اعلام علامت اختلال: «${incident.symptom}»`,
  });

  // 2. Signals first seen
  for (const sig of incident.signals) {
    timeline.push({
      ts: sig.firstSeen,
      event_fa: `استخراج سیگنال قطعی (${sig.kind}): ${sig.detail_fa}`,
    });
  }

  // 3. Actions taken
  for (const act of incident.actions.length > 0 ? incident.actions : auditLog) {
    timeline.push({
      ts: act.executedAt,
      event_fa: `اجرای عملیات اصلاحی (${act.tool}): وضعیت ${act.success ? "موفق" : "ناموفق"}`,
    });
  }

  // 4. Verification
  if (incident.verification) {
    timeline.push({
      ts: incident.verification.after.ts,
      event_fa: `راستی‌آزمایی وضعیت پس از اقدام اصلاحی: حکم نهایی [${incident.verification.verdict}]`,
    });
  }

  // Deduplicate and sort timeline
  timeline.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));

  // Action items
  const actionItems_fa: string[] = [];
  if (incident.signals.some((s) => s.kind === "MISSING_ENV")) {
    actionItems_fa.push("ثبت کلیدهای ضروری محیطی در فایل liara.json برای جلوگیری از فراموشی در دیپلوی بعدی.");
  }
  if (incident.signals.some((s) => s.kind === "MEMORY_LEAK_TREND" || s.kind === "OOM_KILLED")) {
    actionItems_fa.push("بررسی سورس‌کد جهت بستن کانکشن‌های باز دیتابیس یا خالی‌کردن آرایه‌های حافظه موقت.");
    actionItems_fa.push("تنظیم هشدار زودهنگام در آستانه ۸۰٪ مصرف رم پلن.");
  }
  if (incident.signals.some((s) => s.kind === "PORT_MISMATCH")) {
    actionItems_fa.push("تثبیت متغیر محیطی PORT در تنظیمات پلتفرم لیارا بر مبنای پورت گوش‌دهنده سرور.");
  }
  if (actionItems_fa.length === 0) {
    actionItems_fa.push("افزودن تست‌های یکپارچه‌سازی قبل از انتشار در خط لوله CI/CD.");
    actionItems_fa.push("پایش مداوم پروب‌های سلامت خارجی و تعریف آستانه هشدار تاخیر p95.");
  }

  const topHypothesis = incident.hypotheses[0];

  const markdown = `# گزارش کالبدشکافی حادثه (Incident Postmortem) — ${incident.app}

> **شناسه حادثه:** \`${incident.id}\`  
> **زمان وقوع:** ${incident.window.start}  
> **زمان خاتمه:** ${incident.window.end}  
> **مدت زمان تا حل (MTTR):** ${durationSeconds} ثانیه  
> **وضعیت نهایی:** ${incident.status === "resolved" ? "برطرف‌شده (Resolved)" : "نیازمند پیگیری (Investigating)"}

---

## ۱. خلاصه‌ی مدیریتی (Executive Summary)
در تاریخ ${new Date(startMs).toLocaleDateString("fa-IR")} اختلالی با علامت «${incident.symptom}» بر روی برنامه **${incident.app}** گزارش شد. موتور عارضه‌یابی سُکان با جمع‌آوری شواهد لاگ و پروب‌ها، ریشه مشکل را شناسایی کرده و راهکار اصلاحی را به مرحله اجرا گذاشت.

## ۲. سیر زمانی وقایع (Incident Timeline)
${timeline.map((t) => `- **${new Date(t.ts).toLocaleTimeString("fa-IR")}:** ${t.event_fa}`).join("\n")}

## ۳. ریشه‌یابی و تحلیل شواهد (Root Cause Analysis)
- **علت محتمل اصلی:** ${topHypothesis ? topHypothesis.title_fa : "نامشخص"} (ضریب اطمینان: ${topHypothesis ? topHypothesis.confidence : "N/A"})
- **شرح فنی:** ${topHypothesis ? topHypothesis.explain_fa : "شواهد قطعی استخراج نشد."}
${incident.changeCorrelation?.hasDeployCorrelation ? `- **همبستگی تغییرات:** ${incident.changeCorrelation.summary_fa}` : ""}

## ۴. اقدامات اصلاحی اعمال‌شده (Remediation & Recovery)
${(incident.actions.length > 0 ? incident.actions : auditLog)
  .map((a) => `- ابزار: \`${a.tool}\` | زمان: ${a.executedAt} | نتیجه: ${a.success ? "موفقیت‌آمیز" : "ناموفق"}`)
  .join("\n") || "- هیچ اقدام مستقیمی ثبت نشده است."}

## ۵. برنامه‌ی اقدام پیشگیرانه (Action Items)
${actionItems_fa.map((ai, idx) => `${idx + 1}. ${ai}`).join("\n")}
`;

  return {
    id: `pm_${incident.id}`,
    incidentId: incident.id,
    appName: incident.app,
    generatedAt: new Date().toISOString(),
    durationSeconds,
    markdown,
    timeline,
    actionItems_fa,
  };
}

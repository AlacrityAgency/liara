import type { PredictiveShieldResult } from "@sokan/contracts";
import { linearRegression } from "./stats";

/**
 * Predictive OOM & Traffic Wave Shield
 * Computes memory gradient and predicts time to OOM before service outage occurs.
 */
export function evaluatePredictiveShield(
  memoryPoints: Array<{ ts: string; mb: number }>,
  memoryLimitMB: number
): PredictiveShieldResult {
  if (!memoryPoints || memoryPoints.length < 3 || !memoryLimitMB) {
    return {
      isThreatDetected: false,
      estimatedMinutesToImpact: null,
      memorySlopeMBPerMin: 0,
      riskLevel: "safe",
      recommendedAction_fa: "داده‌های سری زمانی حافظه برای پیش‌بینی امواج ترافیک هنوز کافی نیست.",
      alert_fa: "وضعیت پایدار است.",
    };
  }

  const points = memoryPoints.map((p) => ({
    x: (Date.parse(p.ts) - Date.parse(memoryPoints[0].ts)) / 60000,
    y: p.mb,
  }));
  const reg = linearRegression(points);
  if (!reg) {
    return {
      isThreatDetected: false,
      estimatedMinutesToImpact: null,
      memorySlopeMBPerMin: 0,
      riskLevel: "safe",
      recommendedAction_fa: "تغییرات قابل سنجشی در مصرف حافظه ثبت نشد.",
      alert_fa: "مصرف حافظه یکنواخت است.",
    };
  }

  const currentMB = Math.max(...memoryPoints.map((p) => p.mb));
  const remainingMB = Math.max(0, memoryLimitMB - currentMB);
  const slopeMBPerMin = Math.round(reg.slope * 100) / 100;

  // If memory is growing steadily
  if (reg.slope > 0.4 && reg.r2 > 0.75) {
    const minutesToImpact = Math.max(1, Math.round(remainingMB / reg.slope));

    if (minutesToImpact <= 15 || currentMB / memoryLimitMB >= 0.88) {
      return {
        isThreatDetected: true,
        threatType: "IMMINENT_OOM",
        estimatedMinutesToImpact: minutesToImpact,
        memorySlopeMBPerMin: slopeMBPerMin,
        riskLevel: "critical",
        recommendedAction_fa: "ارتقای فوری پلن رم (app_resize_plan) با تأیید L2 به ۱۰۲۴ مگابایت جهت جلوگیری از توقف برنامه.",
        alert_fa: `هشدار بحرانی: با شیب رشد فعلی (${slopeMBPerMin} مگابایت در دقیقه)، سقف رم پلن تا حدود ${minutesToImpact} دقیقه دیگر پر شده و کانتینر کرش خواهد کرد.`,
      };
    }

    if (minutesToImpact <= 40) {
      return {
        isThreatDetected: true,
        threatType: "IMMINENT_OOM",
        estimatedMinutesToImpact: minutesToImpact,
        memorySlopeMBPerMin: slopeMBPerMin,
        riskLevel: "warning",
        recommendedAction_fa: "نظارت بر شیب رشد رم و آماده‌باش برای ارتقای پلن سخت‌افزاری.",
        alert_fa: `اخطار پیش‌دستانه: روند صعودی مصرف رم شناسایی شد؛ پیش‌بینی پر شدن سقف حافظه در حدود ${minutesToImpact} دقیقه آینده.`,
      };
    }
  }

  return {
    isThreatDetected: false,
    estimatedMinutesToImpact: null,
    memorySlopeMBPerMin: slopeMBPerMin,
    riskLevel: "safe",
    recommendedAction_fa: "نیازی به تغییر منابع نیست؛ مصرف حافظه در محدوده امن و پایدار قرار دارد.",
    alert_fa: `وضعیت پایدار است؛ مصرف فعلی ${currentMB}MB از ${memoryLimitMB}MB (شیب: ${slopeMBPerMin}MB/min).`,
  };
}

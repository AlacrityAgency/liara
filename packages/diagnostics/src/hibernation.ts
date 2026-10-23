import type { HibernationPlan } from "@sokan/contracts";

/**
 * Smart Rial Hibernation Engine (Zero-Waste Micro Hibernation)
 * Evaluates non-production container activity and calculates real cost savings from automatic hibernation.
 */
export function evaluateHibernation(
  appName: string,
  lastActivityMinutes = 90,
  currentMonthlyTomans = 158400,
  isProduction = false
): HibernationPlan {
  if (isProduction) {
    return {
      appName,
      isEligible: false,
      inactivityMinutes: lastActivityMinutes,
      currentMonthlyTomans,
      hibernatedMonthlyTomans: currentMonthlyTomans,
      monthlySavingsTomans: 0,
      savingsPercent: 0,
      wakeUpLatencySeconds: 0,
      rationale_fa: "این برنامه به عنوان سرویس پروداکشن علامت‌گذاری شده است؛ جهت پایداری ۱۰۰٪، خواب خودکار برای آن فعال نمی‌شود.",
    };
  }

  const isEligible = lastActivityMinutes >= 45;
  const savingsPercent = 35; // Assuming 8-9 hours of hibernation per night (8 / 24 ≈ 33.3%)
  const monthlySavingsTomans = isEligible ? Math.round(currentMonthlyTomans * (savingsPercent / 100)) : 0;
  const hibernatedMonthlyTomans = currentMonthlyTomans - monthlySavingsTomans;

  return {
    appName,
    isEligible,
    inactivityMinutes: lastActivityMinutes,
    currentMonthlyTomans,
    hibernatedMonthlyTomans,
    monthlySavingsTomans,
    savingsPercent: isEligible ? savingsPercent : 0,
    wakeUpLatencySeconds: 2.8,
    rationale_fa: isEligible
      ? `این برنامه ${lastActivityMinutes} دقیقه است که درخواستی دریافت نکرده است. با فعال‌سازی خواب هوشمند در ساعات شبانه، ماهانه مبلغ ${monthlySavingsTomans.toLocaleString("fa-IR")} تومان (۳۵٪ هزینه پلن) صرفه‌جویی ریالی خواهد شد.`
      : "ترافیک برنامه در دقایق اخیر فعال بوده است؛ نیازی به خواب زمستانی کانتینر نیست.",
  };
}

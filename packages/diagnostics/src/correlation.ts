import type { ChangeCorrelation, Signal } from "@sokan/contracts";
import type { CollectedEvidence } from "./types";

/**
 * "What Changed?" Change-Incident Correlation Engine
 * Correlates the onset of service failures with deployment releases and infrastructure events.
 */
export function correlateChanges(
  evidence: CollectedEvidence,
  signals: Signal[] = []
): ChangeCorrelation {
  if (!evidence.releases || evidence.releases.length === 0) {
    return {
      hasDeployCorrelation: false,
      correlationScore: 0,
      summary_fa: "هیچ سابقه‌ای از ریلیزهای اخیر در بازه حادثه یافت نشد.",
    };
  }

  // Find latest finished release
  const sortedReleases = [...evidence.releases].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
  );
  const latestRelease = sortedReleases[0];

  // Determine earliest failure time
  let earliestFailureMs = Infinity;
  for (const sig of signals) {
    const ms = Date.parse(sig.firstSeen);
    if (!isNaN(ms) && ms < earliestFailureMs) {
      earliestFailureMs = ms;
    }
  }

  // Fallback to logs or symptom start
  if (earliestFailureMs === Infinity && evidence.logs) {
    const errorLog = evidence.logs.find((l) =>
      /error|exception|fail|500|crash/i.test(l.text)
    );
    if (errorLog) earliestFailureMs = Date.parse(errorLog.ts);
  }
  if (earliestFailureMs === Infinity && evidence.symptomStart) {
    earliestFailureMs = Date.parse(evidence.symptomStart);
  }
  if (earliestFailureMs === Infinity) {
    earliestFailureMs = Date.now();
  }

  const releaseTs = Date.parse(latestRelease.finishedAt || latestRelease.createdAt);
  const deltaSeconds = Math.round((earliestFailureMs - releaseTs) / 1000);

  // If failure happened within 15 minutes (900s) after the release
  if (deltaSeconds >= -60 && deltaSeconds <= 900) {
    const score = Math.max(0.65, Math.min(0.98, 1 - Math.abs(deltaSeconds) / 1000));
    return {
      hasDeployCorrelation: true,
      culpritReleaseId: latestRelease.id,
      culpritCreatedAt: latestRelease.createdAt,
      secondsBetweenReleaseAndFailure: Math.max(0, deltaSeconds),
      correlationScore: Math.round(score * 100) / 100,
      summary_fa: `شروع اختلال دقیقاً ${Math.max(0, deltaSeconds)} ثانیه پس از استقرار ریلیز (${latestRelease.id}) رخ داده است؛ همبستگی مستقیم استقرار شناسایی شد.`,
    };
  }

  return {
    hasDeployCorrelation: false,
    culpritReleaseId: latestRelease.id,
    culpritCreatedAt: latestRelease.createdAt,
    secondsBetweenReleaseAndFailure: deltaSeconds > 0 ? deltaSeconds : undefined,
    correlationScore: 0.2,
    summary_fa: "شروع علائم حادثه همبستگی زمانی مستقیمی با آخرین استقرار (بیش از ۱۵ دقیقه فاصله) نشان نمی‌دهد.",
  };
}

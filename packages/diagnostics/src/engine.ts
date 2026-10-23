import type { Incident, Hypothesis, FixBrief, Snapshot, PostmortemReport, BuildLogTriageResult, PredictiveShieldResult, ChaosVaccinationResult, HibernationPlan } from "@sokan/contracts";
import type { CollectedEvidence } from "./types";
import { extractSignals } from "./extractors";
import { flagInstructions } from "./flags";
import { STANDARD_RUNBOOKS } from "./runbooks";
import { clusterErrors } from "./logparse";
import { percentile } from "./stats";
import { correlateChanges } from "./correlation";
import { generatePostmortem } from "./postmortem";
import { triageBuildLogs } from "./build-triage";
import { evaluatePredictiveShield } from "./predictive";
import { runChaosVaccination } from "./chaos-vaccine";
import { evaluateHibernation } from "./hibernation";

export class DiagnosticEngine {
  /**
   * Run the complete SRE diagnostic pipeline:
   * Evidence -> Signal Extraction -> Instruction Flagging -> Hypothesis Scoring -> Incident Formulation
   */
  public static diagnose(
    evidenceData: CollectedEvidence,
    symptom = "خطا یا کندی در سرویس"
  ): Incident {
    const { signals, evidence, missingEvidence } = extractSignals(evidenceData);
    const flags = flagInstructions(evidenceData.logs ?? []);

    const signalKinds = new Set(signals.map((s) => s.kind));
    const hypotheses: Hypothesis[] = [];
    const rejected: Array<{ title_fa: string; reason_fa: string }> = [];

    for (const rb of STANDARD_RUNBOOKS) {
      // 1. Check contradicting signals
      const hasContradiction = rb.contradictingSignals?.some((c) => signalKinds.has(c));
      if (hasContradiction) {
        rejected.push({
          title_fa: rb.title_fa,
          reason_fa: "وجود سیگنال‌های متعارض که این علت را نامحتمل می‌کند.",
        });
        continue;
      }

      // 2. Check required signals
      const missingRequired = rb.requiredSignals.filter((rs) => !signalKinds.has(rs));
      if (missingRequired.length > 0) {
        rejected.push({
          title_fa: rb.title_fa,
          reason_fa: `سیگنال‌های الزامی (${missingRequired.join(", ")}) در شواهد یافت نشد.`,
        });
        continue;
      }

      // 3. Compute score and evidence citations
      const evidenceForIds: string[] = [];
      const evidenceAgainstIds: string[] = [];

      for (const sig of signals) {
        if (rb.requiredSignals.includes(sig.kind) || rb.supportingSignals.includes(sig.kind)) {
          evidenceForIds.push(...sig.evidence);
        }
      }

      // Base confidence
      const supportingCount = rb.supportingSignals.filter((ss) => signalKinds.has(ss)).length;
      let confidence: Hypothesis["confidence"] = "medium";
      let score = 0.6;

      if (supportingCount >= 1 || rb.requiredSignals.length >= 2) {
        confidence = "high";
        score = 0.95;
      } else if (supportingCount === 0 && evidenceForIds.length > 0) {
        confidence = "medium";
        score = 0.7;
      } else {
        confidence = "low";
        score = 0.4;
      }

      hypotheses.push({
        id: `hyp_${rb.id}`,
        title_fa: rb.title_fa,
        explain_fa: rb.explain_fa,
        confidence,
        score,
        evidence_for: Array.from(new Set(evidenceForIds)),
        evidence_against: evidenceAgainstIds,
        confirming_test: rb.confirmingTest_fa,
        remediations: rb.remediations,
      });
    }

    // Sort hypotheses by score descending
    hypotheses.sort((a, b) => b.score - a.score);

    // If no hypothesis matched but we have errors, create a generic one
    if (hypotheses.length === 0 && signals.length > 0) {
      hypotheses.push({
        id: "hyp_generic",
        title_fa: "بررسی سیگنال‌های شناسایی‌شده",
        explain_fa: "سیگنال‌هایی در داده‌ها یافت شد اما با الگوهای استاندارد مشخص تطبیق نیافت.",
        confidence: "low",
        score: 0.3,
        evidence_for: signals.flatMap((s) => s.evidence),
        evidence_against: [],
        remediations: [],
      });
    }

    const incidentId = `inc_${Date.now().toString(36)}`;
    const changeCorrelation = correlateChanges(evidenceData, signals);

    let predictiveShield: PredictiveShieldResult | undefined;
    if (evidenceData.memory && evidenceData.memory.length > 0 && evidenceData.app?.memoryLimitMB) {
      predictiveShield = evaluatePredictiveShield(evidenceData.memory, evidenceData.app.memoryLimitMB);
    }

    return {
      id: incidentId,
      app: evidenceData.app?.name ?? "unknown-app",
      trigger: "user",
      symptom,
      window: evidenceData.window,
      evidence,
      missingEvidence,
      signals,
      flags,
      hypotheses,
      rejected,
      actions: [],
      changeCorrelation,
      predictiveShield,
      status: hypotheses.length > 0 ? "awaiting_approval" : "investigating",
    };
  }

  /**
   * Take a current snapshot of system metrics for before/after comparison (§10.6).
   */
  public static takeSnapshot(data: CollectedEvidence): Snapshot {
    const errorCount = (data.logs ?? []).filter((l) =>
      /error|exception|fail|500|fatal/i.test(l.text)
    ).length;

    const probeOk = (data.probes ?? []).filter((p) => p.status && p.status >= 200 && p.status < 400).length;
    const probeTotal = data.probes?.length ?? 0;

    const probeLats = (data.probes ?? []).map((p) => p.ms).filter((ms): ms is number => typeof ms === "number");
    const p95Ms = percentile(probeLats, 95);

    let memoryPeakPct: number | null = null;
    if (data.memory && data.memory.length > 0 && data.app?.memoryLimitMB) {
      const maxMb = Math.max(...data.memory.map((m) => m.mb));
      memoryPeakPct = Math.round((maxMb / data.app.memoryLimitMB) * 100);
    }

    let cpuPct: number | null = null;
    if (data.cpu && data.cpu.length > 0) {
      const avg = data.cpu.reduce((a, b) => a + b.pct, 0) / data.cpu.length;
      cpuPct = Math.round(avg);
    }

    return {
      ts: new Date().toISOString(),
      appletState: data.applets?.[0]?.state ?? "unknown",
      errorsPerMinute: errorCount,
      probeOk,
      probeTotal,
      p95Ms,
      memoryPeakPct,
      cpuPct,
    };
  }

  /**
   * Generate a structured FixBrief for handoff to a Coding Agent (§11).
   */
  public static createFixBrief(
    incident: Incident,
    evidenceData: CollectedEvidence
  ): FixBrief {
    const topHyp = incident.hypotheses[0];
    const clusters = evidenceData.logs ? clusterErrors(evidenceData.logs) : [];
    const topCluster = clusters[0];

    const suspected_locations: Array<{ file: string; line?: number }> = [];
    if (topCluster?.frame?.file) {
      suspected_locations.push({
        file: topCluster.frame.file,
        line: topCluster.frame.line,
      });
    }

    const evidenceItems: FixBrief["evidence"] = [];
    for (const c of clusters.slice(0, 3)) {
      evidenceItems.push({
        type: "log",
        ts: c.firstTs,
        text: `${c.errorType}: ${c.message} (${c.count} occurrences)`,
      });
    }

    if (evidenceData.memory && evidenceData.memory.length > 0) {
      const last = evidenceData.memory[evidenceData.memory.length - 1];
      evidenceItems.push({
        type: "metric",
        name: "memory.usage",
        value: `${last.mb}MB`,
      });
    }

    let suggested_change = "بررسی کد، مدیریت خطاهای پیش‌بینی نشده یا بهینه‌سازی کوئری‌ها";
    if (topHyp?.id.includes("missing_env")) {
      suggested_change = "تعریف متغیرهای محیطی گمشده در تنظیمات پروژه یا افزودن fallback در کد";
    } else if (topHyp?.id.includes("oom")) {
      suggested_change = "بررسی آرایه‌های کش بدون محدودیت، شنونده‌های رویداد رهاشده (listener leaks) یا مدیریت بافرها";
    }

    return {
      incident_id: incident.id,
      symptom: incident.symptom,
      hypothesis: topHyp?.title_fa ?? "خطای ناشناخته در کد",
      confidence: topHyp?.confidence ?? "low",
      evidence: evidenceItems,
      suspected_locations,
      suggested_change,
      verification: "پاسخ موفق ۲۰۰ در تست پروب و عدم وجود استثنا در ۶۰ ثانیه اول پس از دیپلوی",
    };
  }

  public static generatePostmortem(
    incident: Incident,
    auditLog?: Array<{ tool: string; executedAt: string; success: boolean; detail?: string }>
  ): PostmortemReport {
    return generatePostmortem(incident, auditLog);
  }

  public static triageBuildLogs(logText: string): BuildLogTriageResult {
    return triageBuildLogs(logText);
  }

  public static evaluatePredictiveShield(
    memoryPoints: Array<{ ts: string; mb: number }>,
    memoryLimitMB: number
  ): PredictiveShieldResult {
    return evaluatePredictiveShield(memoryPoints, memoryLimitMB);
  }

  public static runChaosVaccination(
    appName: string,
    healthProbes?: Array<{ status: number | null; ms: number | null; ok: boolean }>,
    dbReachable?: boolean
  ): ChaosVaccinationResult {
    return runChaosVaccination(appName, healthProbes, dbReachable);
  }

  public static evaluateHibernation(
    appName: string,
    lastActivityMinutes?: number,
    currentMonthlyTomans?: number,
    isProduction?: boolean
  ): HibernationPlan {
    return evaluateHibernation(appName, lastActivityMinutes, currentMonthlyTomans, isProduction);
  }
}

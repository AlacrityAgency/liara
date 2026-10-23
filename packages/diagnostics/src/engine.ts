import type {
  Incident, Hypothesis, FixBrief, Snapshot, Signal, IncidentStatus, Remediation, EvidenceRef, SuccessCriterion,
} from "@sokan/contracts";
import type { CollectedEvidence, DiagIncidentStatus, DiagSignalKind } from "./types";
import { extractSignals, errorOnset } from "./extractors";
import { flagInstructions } from "./flags";
import { STANDARD_RUNBOOKS } from "./runbooks";
import { scoreRunbook, type ScoredRunbook } from "./scoring";
import { createFixBrief as buildFixBrief, type Redactor } from "./brief";
import { failingPathsFromEvidence, takeSnapshot as takeVerifySnapshot } from "./verifier";
import { percentile } from "./stats";
import { clusterErrors } from "./logparse";
import { isErrorLine } from "./patterns";

const DEFAULT_SYMPTOM = "خطا یا کندی در سرویس";
const MAX_HYPOTHESES = 3;

/** Replace "{{key}}" placeholders in a runbook template with values from the evidence. */
function resolveTemplate<T>(value: T, ctx: Record<string, string>): T {
  if (typeof value === "string") {
    const exact = value.match(/^\{\{(\w+)\}\}$/);
    if (exact && ctx[exact[1]] !== undefined) {
      const v = ctx[exact[1]];
      return (/^\d+$/.test(v) ? Number(v) : v) as unknown as T;
    }
    return value.replace(/\{\{(\w+)\}\}/g, (m, k) => ctx[k] ?? m) as unknown as T;
  }
  if (Array.isArray(value)) return value.map((v) => resolveTemplate(v, ctx)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = resolveTemplate(v, ctx);
    return out as T;
  }
  return value;
}

function placeholderContext(data: CollectedEvidence, byKind: ReadonlyMap<DiagSignalKind, Signal>): Record<string, string> {
  const ctx: Record<string, string> = {
    failingPath: failingPathsFromEvidence(data)[0] ?? "/",
    poolSignature: "connection",
  };
  const mismatch = byKind.get("PORT_MISMATCH")?.data?.listenedPort;
  if (mismatch !== undefined && mismatch !== null) ctx.listenedPort = String(mismatch);
  const pool = byKind.get("DB_POOL_EXHAUSTED")?.data?.pattern;
  if (typeof pool === "string") ctx.poolSignature = pool;
  return ctx;
}

const unique = (xs: string[]): string[] => Array.from(new Set(xs));

function toHypothesis(s: ScoredRunbook, ctx: Record<string, string>): Hypothesis {
  const rb = s.runbook;
  const remediations: Remediation[] = rb.remediations.map((r, i) => ({
    id: `rem_${rb.id}_${i}`,
    action: r.tool,
    params: resolveTemplate(r.params_template, ctx),
    riskLevel: r.risk,
    label_fa: r.title_fa,
    successCriteria_fa: r.successCriteria_fa,
    cost_fa: r.cost_fa,
    impact_fa: r.impact_fa,
    rollback_fa: r.rollback_fa,
    // probe_not_5xx and underLoad are diagnostics-only extensions; see types.ts.
    successCriteria: resolveTemplate(r.successCriteria, ctx) as SuccessCriterion,
  }));
  return {
    id: `hyp_${rb.id}`,
    runbookId: rb.id,
    title_fa: rb.title_fa,
    explain_fa: rb.explain_fa,
    confidence: s.confidence,
    score: Math.round(s.score * 1000) / 1000,
    logit: Math.round(s.logit * 1000) / 1000,
    evidence_for: unique(s.supporting.flatMap((x) => x.evidence)),
    evidence_against: unique(s.contradicting.flatMap((x) => x.evidence)),
    confirming_test: rb.confirmingTest_fa,
    remediations,
    ...(s.cappedBy.length > 0 ? { missingEvidence: s.cappedBy } : {}),
  };
}

/**
 * Used when error lines exist but no runbook matched (EVALUATION R9). The top error cluster becomes the evidence,
 * and the only remediation is a Fix Brief for the Coding Agent, so no approval card is created.
 */
function unclassifiedHypothesis(data: CollectedEvidence, evidence: EvidenceRef[]): Hypothesis | null {
  const logs = data.logs ?? [];
  const errorLines = logs.filter((l) => isErrorLine(l.text));
  if (errorLines.length === 0) return null;
  const top = clusterErrors(logs)[0];
  const summary = top
    ? `Exception cluster: ${top.signature} (count: ${top.count})`
    : `Error line: ${errorLines[0].text.slice(0, 140)}`;
  const id = `ev_${evidence.length + 1}`;
  evidence.push({ id, type: "log", ts: top?.firstTs ?? errorLines[0].ts, summary, raw_ref: top?.sampleIds[0] ?? errorLines[0].id });
  const signature = (top ? top.errorType : errorLines[0].text).trim().slice(0, 60);
  return {
    id: "hyp_unclassified_errors",
    title_fa: "خطای دسته‌بندی‌نشده در لاگ",
    explain_fa: "در لاگ خطا دیده می‌شود، اما با هیچ الگوی شناخته‌شده تطبیق نیافت. Fix Brief با خطای پرتکرار ساخته شد تا کد بررسی شود.",
    confidence: "low",
    score: 0.3,
    evidence_for: [id],
    evidence_against: [],
    confirming_test: "خواندن stack trace یا پیام خطای پرتکرار و تطبیق آن با کد",
    remediations: [{
      id: "rem_unclassified_errors_0",
      action: "coding_agent_handoff",
      params: {},
      riskLevel: "L0",
      label_fa: "Fix Brief برای خطای دسته‌بندی‌نشده",
      successCriteria_fa: "خطای پرتکرار دیگر در لاگ دیده نشود",
      cost_fa: "بدون هزینه",
      impact_fa: "بدون تغییر در برنامه‌ی زنده",
      rollback_fa: "—",
      successCriteria: { kind: "no_error_signature", signature },
    }],
  };
}

export class DiagnosticEngine {
  /**
   * Run the SRE diagnostic pipeline (WHITEPAPER §8.2):
   * Evidence -> Signals (with strength) -> Instruction flags -> Weighted runbook scoring -> Incident.
   */
  public static diagnose(evidenceData: CollectedEvidence, symptom = DEFAULT_SYMPTOM): Incident {
    const { signals, evidence, missingEvidence } = extractSignals(evidenceData);
    const flags = flagInstructions(evidenceData.logs ?? []);

    const byKind = new Map<DiagSignalKind, Signal>();
    for (const s of signals) if (!byKind.has(s.kind)) byKind.set(s.kind, s);

    const onsetIso = evidenceData.symptomStart ?? errorOnset(evidenceData);
    const scored = STANDARD_RUNBOOKS.map((rb) =>
      scoreRunbook(rb, byKind, { userText: symptom, onsetIso, missingEvidence })
    );
    const applicable = scored.filter((s) => s.applicable);

    const rejected = applicable
      .filter((s) => s.rejected)
      .map((s) => ({
        title_fa: s.runbook.title_fa,
        reason_fa: `سیگنال‌های متعارض (${s.contradicting.map((c) => c.kind).join(", ")}) این علت را نامحتمل می‌کنند.`,
      }));

    const ctx = placeholderContext(evidenceData, byKind);
    const hypotheses = applicable
      .filter((s) => !s.rejected)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_HYPOTHESES)
      .map((s) => toHypothesis(s, ctx));

    if (hypotheses.length === 0) {
      const unclassified = unclassifiedHypothesis(evidenceData, evidence);
      if (unclassified) hypotheses.push(unclassified);
    }
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

    // "awaiting_approval" only when a card can exist. Handoffs and L0 reads never create one (EVALUATION R4).
    const actionable = hypotheses.some((h) =>
      h.remediations.some((r) => r.action !== "coding_agent_handoff" && r.riskLevel !== "L0")
    );
    const status: DiagIncidentStatus = actionable
      ? "awaiting_approval"
      : hypotheses.length > 0 ? "diagnosed" : "investigating";

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
      // DiagIncidentStatus adds "diagnosed" and "mitigated" to the contract; see types.ts.
      status: status as IncidentStatus,
    };
  }

  /**
   * Legacy snapshot in the contract shape (Incident.verification). The verifier uses
   * `takeSnapshot` from this package, which returns the richer VerifySnapshot.
   */
  public static takeSnapshot(data: CollectedEvidence): Snapshot {
    const v = takeVerifySnapshot(data);
    const probeOk = v.probe.filter((p) => p.status !== null && p.status >= 200 && p.status < 400).length;
    const probeLats = (data.probes ?? []).map((p) => p.ms).filter((ms): ms is number => typeof ms === "number");
    return {
      ts: new Date().toISOString(),
      appletState: data.applets?.[0]?.state ?? "unknown",
      errorsPerMinute: Math.round(v.errorRatePerMin),
      probeOk,
      probeTotal: v.probe.length,
      p95Ms: percentile(probeLats, 95),
      memoryPeakPct: v.memP95Pct,
      cpuPct: v.cpuP95Pct,
    };
  }

  /** Fix Brief for a Coding Agent (WHITEPAPER §9.2). `redact` is applied to every log excerpt. */
  public static createFixBrief(incident: Incident, evidenceData: CollectedEvidence, redact?: Redactor): FixBrief {
    return buildFixBrief(incident, evidenceData, redact);
  }
}

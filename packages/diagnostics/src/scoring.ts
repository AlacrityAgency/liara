import type { Signal, SignalKind } from "@sokan/contracts";
import type { DiagnosticRunbook } from "./runbooks";

/** Normalise Persian/Arabic text: Persian digits to ASCII, Arabic letter variants, ZWNJ and tatweel removed. */
export function normaliseText(input: string): string {
  return input
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[‌ـ]/g, "")
    .toLowerCase();
}

const TOKEN_SPLIT = /[\s،,.;:!?؟()[\]"'`«»/\\|]+/;

/**
 * Fraction of the runbook's keywords found in the user's text, capped at 1.
 * Single keywords match whole tokens (so "رم" does not match inside other words); longer keywords
 * also match a token prefix, which covers Persian inflections. Multi-word keywords match as substrings.
 */
export function symptomMatch(runbook: Pick<DiagnosticRunbook, "symptoms">, userText: string): number {
  const text = normaliseText(userText);
  if (!text.trim()) return 0;
  const tokens = text.split(TOKEN_SPLIT).filter(Boolean);
  let matched = 0;
  for (const raw of runbook.symptoms) {
    const kw = normaliseText(raw);
    const hit = kw.includes(" ")
      ? text.includes(kw)
      : tokens.some((t) => t === kw || (kw.length >= 4 && t.startsWith(kw)));
    if (hit) matched++;
  }
  return Math.min(1, matched / 2);
}

/**
 * How close the signals' first occurrence is to the symptom onset:
 * 1 within 10 minutes, 0.5 within 30 minutes, 0 otherwise or when the onset is unknown.
 */
export function temporalFit(signals: ReadonlyArray<Signal>, onsetIso: string | undefined): number {
  if (!onsetIso) return 0;
  const onset = Date.parse(onsetIso);
  if (!Number.isFinite(onset)) return 0;
  let best = 0;
  for (const s of signals) {
    const t = Date.parse(s.firstSeen);
    if (!Number.isFinite(t)) continue;
    const d = Math.abs(t - onset);
    if (d <= 10 * 60_000) best = Math.max(best, 1);
    else if (d <= 30 * 60_000) best = Math.max(best, 0.5);
  }
  return best;
}

export const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

export function confidenceOf(score: number): "high" | "medium" | "low" {
  return score >= 0.8 ? "high" : score >= 0.5 ? "medium" : "low";
}

export interface ScoredRunbook {
  runbook: DiagnosticRunbook;
  applicable: boolean;
  logit: number;
  score: number;
  confidence: "high" | "medium" | "low";
  /** Signals that support the runbook (weights map, present). */
  supporting: Signal[];
  /** Signals that contradict the runbook (against map, present). */
  contradicting: Signal[];
  /** Missing collectors this runbook depends on, when the cap applied. */
  cappedBy: string[];
  /** Rejected: required signals present, contradictions dominate (score < 0.5). */
  rejected: boolean;
}

export interface ScoreContext {
  userText: string;
  onsetIso?: string;
  missingEvidence: readonly string[];
}

/**
 * WHITEPAPER §8.4:
 *   logit = prior + Σ w·strength (supporting) − Σ w·strength (contradicting)
 *         + 0.5·symptomMatch + 0.3·temporalFit
 *   score = sigmoid(logit)
 * A runbook is not applicable when a required signal is missing. Contradictions only subtract.
 */
export function scoreRunbook(
  rb: DiagnosticRunbook,
  byKind: ReadonlyMap<SignalKind, Signal>,
  ctx: ScoreContext
): ScoredRunbook {
  const requiredOk = rb.requiredSignals.every((k) => byKind.has(k));
  const anyOk = !rb.requiredAny || rb.requiredAny.length === 0 || rb.requiredAny.some((k) => byKind.has(k));
  const applicable = requiredOk && anyOk;

  const supporting: Signal[] = [];
  let logit = rb.prior;
  for (const [kind, weight] of Object.entries(rb.weights) as Array<[SignalKind, number]>) {
    const sig = byKind.get(kind);
    if (!sig) continue;
    supporting.push(sig);
    logit += weight * (sig.strength ?? 0.5);
  }

  const contradicting: Signal[] = [];
  for (const [kind, weight] of Object.entries(rb.against) as Array<[SignalKind, number]>) {
    const sig = byKind.get(kind);
    if (!sig) continue;
    contradicting.push(sig);
    logit -= weight * (sig.strength ?? 0.5);
  }

  logit += 0.5 * symptomMatch(rb, ctx.userText);
  logit += 0.3 * temporalFit([...supporting, ...contradicting], ctx.onsetIso);

  let score = sigmoid(logit);
  let confidence = confidenceOf(score);

  const cappedBy = rb.dependsOn.filter((d) => ctx.missingEvidence.includes(d));
  if (cappedBy.length > 0 && confidence === "high") {
    confidence = "medium";
    score = Math.min(score, 0.79);
  }

  const contradictionTotal = contradicting.reduce(
    (sum, s) => sum + (rb.against[s.kind] ?? 0) * (s.strength ?? 0.5),
    0
  );
  const rejected = applicable && contradictionTotal > 0 && score < 0.5;

  return {
    runbook: rb,
    applicable,
    logit,
    score,
    confidence,
    supporting,
    contradicting,
    cappedBy,
    rejected,
  };
}

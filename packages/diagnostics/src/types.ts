import type { Hypothesis, IncidentStatus, Signal, SignalKind, SuccessCriterion } from "@sokan/contracts";

/** Aliases kept for the diagnostics package; the contracts own the kinds, statuses and criteria. */
export type DiagSignalKind = SignalKind;
export type DiagIncidentStatus = IncidentStatus;
/**
 * Diagnostics-only extension: probe_not_5xx takes `allow4xx` (default false). Without it, only 2xx and 3xx count as
 * healthy (EVALUATION round 3, item 4). The contracts type does not list the field yet.
 */
export type DiagCriterion = SuccessCriterion & { allow4xx?: boolean };

/** Primitive facts a signal carries. Other layers build sentences from these values, not from detail_fa. */
export type SignalFacts = Record<string, number | string | boolean | null>;

/**
 * Structured `data` per signal kind (round 3, item 2). Every value is a primitive or null.
 * MEMORY_*: `pct` is p95 as a percentage of the limit, `rssMB` the value the sentence cites (peak for pressure,
 * current for a leak trend), `limitMB` the plan or heap limit. OOM_KILLED: `limitMB` is null when unknown.
 * UPSTREAM_SLOW: `host` is taken from the log line or null; `p95Ms` comes from probe times or null.
 * DB_UNREACHABLE and CACHE_UNREACHABLE: `host` and `port` are parsed from the log line (null when absent).
 */
export interface SignalDataByKind {
  MISSING_ENV: { variable: string };
  PORT_MISMATCH: { listenPort: number; expectedPort: number };
  MEMORY_PRESSURE: { pct: number; rssMB: number; limitMB: number };
  MEMORY_LEAK_TREND: { pct: number; rssMB: number; limitMB: number; slopeMBPerMin: number; r2: number; growthPct: number; minutesToLimit: number };
  OOM_KILLED: { limitMB: number | null; appletOOM: number; oomLogLines: number; oomEvents: number; hasMemorySeries: boolean };
  CPU_SATURATION: { p95Pct: number; pointsAboveThreshold: number };
  UPSTREAM_SLOW: { host: string | null; p95Ms: number | null; upstreamLines: number; slowProbes: number };
  DB_UNREACHABLE: { host: string | null; port: number | null; lines: number };
  CACHE_UNREACHABLE: { host: string | null; port: number | null; lines: number };
}

/** The strongest supporting signal of a hypothesis, with its structured facts. */
export interface PrimarySignal {
  kind: DiagSignalKind;
  data: SignalFacts;
}

/** A hypothesis as the engine returns it: the contracts shape plus primarySignal (null when none supports it). */
export interface DiagHypothesis extends Hypothesis {
  primarySignal: PrimarySignal | null;
}

/**
 * Input to the diagnostic engine: what the collectors returned for one investigation window.
 * `null` means the collector FAILED or the data source does not exist — it is reported as
 * missing evidence and is never interpreted as "healthy" (Appendix C rule 3).
 */
export interface CollectedEvidence {
  app: {
    name: string;
    port: number;
    envKeys: string[];
    scale: number;
    /** Memory limit used to express usage as a percentage (Liara: plan RAM; local demo: heap limit). */
    memoryLimitMB: number | null;
    memoryLimitLabel_fa?: string;
  } | null;
  applets: Array<{ state: string; reason?: string; restarts: number; release?: string }> | null;
  events: Array<{ id: string; ts: string; type: string; message: string }> | null;
  /**
   * Only releases with `source: "liara"` (read from the Liara API) or `source: "local"` (a
   * release the local runner actually performed) can produce DEPLOY_REGRESSION. Anything else,
   * including synthetic placeholders, is ignored (EVALUATION M1).
   */
  releases: Array<{
    id: string;
    state: string;
    createdAt: string;
    finishedAt?: string;
    envKeys?: string[];
    message?: string;
    source?: "liara" | "local";
    /** "restart": the local harness restarted the process. Restarts are not releases and never cause DEPLOY_REGRESSION (EVALUATION R4). */
    kind?: "release" | "restart";
  }> | null;
  memory: Array<{ ts: string; mb: number; pid?: number }> | null;
  cpu: Array<{ ts: string; pct: number }> | null;
  network?: Array<{ ts: string; rxBytesPerSec: number }> | null;
  disk?: { usedPct: number } | null;
  logs: Array<{ id: string; ts: string; text: string }> | null;
  probes: Array<{ id: string; ts: string; path: string; status: number | null; ms: number | null; error?: string }> | null;
  db: { reachable: boolean; detail?: string } | null;
  /** When the user/probe says the problem started. Defaults to the first error in the window. */
  symptomStart?: string;
  window: { start: string; end: string };
}

export interface Thresholds {
  memoryPressurePct: number;     // WHITEPAPER §8.3: p95 >= 85 % of the plan limit
  cpuSaturationPct: number;      // WHITEPAPER §8.3: p95 >= 90 % with at least 3 points >= 90
  crashLoopCount: number;
  crashLoopWindowMs: number;
  deployRegressionMs: number;    // errors must start within this many ms after a release finishedAt, and be absent before it
  leakMinR2: number;
  leakMinPoints: number;
  leakMinGrowthPct: number;      // WHITEPAPER §8.3: growth >= 20 % across the window
  frequentExceptionCount: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  memoryPressurePct: 85,
  cpuSaturationPct: 90,
  crashLoopCount: 3,
  crashLoopWindowMs: 10 * 60_000,
  deployRegressionMs: 10 * 60_000,
  leakMinR2: 0.8,
  leakMinPoints: 6,
  leakMinGrowthPct: 20,
  frequentExceptionCount: 1,
};

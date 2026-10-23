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
  deployRegressionMs: number;    // errors must start within this many ms after a release finishedAt
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

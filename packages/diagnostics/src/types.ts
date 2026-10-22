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
  releases: Array<{ id: string; state: string; createdAt: string; finishedAt?: string; envKeys?: string[]; message?: string }> | null;
  memory: Array<{ ts: string; mb: number; pid?: number }> | null;
  cpu: Array<{ ts: string; pct: number }> | null;
  network?: Array<{ ts: string; rxBytesPerSec: number }> | null;
  disk?: { usedPct: number } | null;
  logs: Array<{ id: string; ts: string; text: string }> | null;
  probes: Array<{ id: string; ts: string; path: string; status: number | null; ms: number | null; error?: string }> | null;
  db: { reachable: boolean; detail?: string } | null;
  /** When the user/probe says the problem started (defaults to the first error in the window). */
  symptomStart?: string;
  window: { start: string; end: string };
}

export interface Thresholds {
  memoryPressurePct: number;     // §10.3: > 90 %
  cpuSaturationPct: number;      // §10.3: > 85 %
  cpuSaturationMinMs: number;    // §10.3: for more than 5 minutes
  crashLoopCount: number;
  crashLoopWindowMs: number;
  deployRegressionMs: number;    // "N minutes after finishedAt"
  leakMinR2: number;
  leakMinPoints: number;
  frequentExceptionCount: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  memoryPressurePct: 90,
  cpuSaturationPct: 85,
  cpuSaturationMinMs: 5 * 60_000,
  crashLoopCount: 3,
  crashLoopWindowMs: 10 * 60_000,
  deployRegressionMs: 15 * 60_000,
  leakMinR2: 0.8,
  leakMinPoints: 6,
  frequentExceptionCount: 5,
};

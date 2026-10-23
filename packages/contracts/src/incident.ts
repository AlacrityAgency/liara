import type { RiskLevel } from "./security";

/** Appendix B */
export type EvidenceType = "log" | "metric" | "event" | "release" | "applet" | "probe";

export interface EvidenceRef {
  id: string;           // cited by hypotheses (Appendix C rule 2)
  type: EvidenceType;
  ts: string;
  summary: string;
  raw_ref: string;      // pointer to raw data for the UI
}

/** The 14 deterministic signals of WHITEPAPER §10.3 */
export type SignalKind =
  | "OOM_KILLED"
  | "MEMORY_PRESSURE"
  | "MEMORY_LEAK_TREND"
  | "CPU_SATURATION"
  | "CRASH_LOOP"
  | "DEPLOY_REGRESSION"
  | "PORT_MISMATCH"
  | "MISSING_ENV"
  | "DB_UNREACHABLE"
  | "UPSTREAM_SLOW"
  | "DISK_FULL"
  | "APP_EXCEPTION"
  | "TRAFFIC_SPIKE"
  | "APP_STOPPED"
  | "DB_POOL_EXHAUSTED"
  | "CACHE_UNREACHABLE";

export interface Signal {
  kind: SignalKind;
  firstSeen: string;
  detail_fa: string;
  evidence: string[];   // EvidenceRef ids
  /** 0..1, set by the extractor (WHITEPAPER §8.4): occurrence count, R², distance from threshold. */
  strength?: number;
  /** Numeric facts behind the signal (slope, R², p95, minutes to limit …). */
  data?: Record<string, number | string | boolean | null>;
}

/** Text inside data that looks like an instruction (§7.2 point 4). Flagged, never obeyed. */
export interface InstructionFlag {
  evidenceId: string;
  excerpt: string;
}

/** Machine-checkable success criterion evaluated by the verifier (WHITEPAPER §8.6). */
export type SuccessCriterion =
  | { kind: "probe_ok"; path: string }
  | { kind: "probe_latency_below"; path: string; ms: number }
  | { kind: "no_error_signature"; signature: string }
  | { kind: "error_rate_below"; perMin: number }
  | { kind: "mem_below_pct"; pct: number }
  | { kind: "cpu_below_pct"; pct: number }
  | { kind: "disk_used_below"; pct: number }
  | { kind: "applets_running" }
  | { kind: "restarts_stable" }
  | { kind: "release_ready" };

export interface Remediation {
  id: string;
  action: string;       // tool name, or "coding_agent_handoff"
  params: Record<string, unknown>;
  riskLevel: RiskLevel;
  label_fa: string;
  note_fa?: string;
  successCriteria_fa: string;
  cost_fa?: string;
  impact_fa?: string;
  rollback_fa?: string;
  successCriteria?: SuccessCriterion;
}

export interface Hypothesis {
  id: string;
  title_fa: string;
  explain_fa: string;
  confidence: "high" | "medium" | "low";
  score: number;
  evidence_for: string[];
  evidence_against: string[];
  confirming_test?: string;
  remediations: Remediation[];
  /** Runbook id this hypothesis was produced from (e.g. "missing_env"). */
  runbookId?: string;
  /** Log-odds before the sigmoid (WHITEPAPER §8.4). */
  logit?: number;
  /** Collectors that failed and that this hypothesis depends on; confidence is capped at medium. */
  missingEvidence?: string[];
}

export interface ActionRecord {
  tool: string;
  params: Record<string, unknown>;
  approvalId?: string;
  executedAt: string;
  success: boolean;
  detail?: string;
}

/** §10.6 step 1 */
export interface Snapshot {
  ts: string;
  appletState: string;
  errorsPerMinute: number;
  probeOk: number;
  probeTotal: number;
  p95Ms: number | null;
  memoryPeakPct: number | null;   // of the memory limit; null = metric unavailable
  cpuPct: number | null;
}

export type IncidentStatus = "investigating" | "awaiting_approval" | "remediating" | "resolved" | "unresolved";

export interface Incident {
  id: string;
  app: string;
  trigger: "user" | "probe" | "post_deploy" | "coding_agent";
  symptom: string;
  window: { start: string; end: string };
  evidence: EvidenceRef[];
  missingEvidence: string[];      // collectors that failed — never treated as healthy
  signals: Signal[];
  flags: InstructionFlag[];
  hypotheses: Hypothesis[];
  rejected: Array<{ title_fa: string; reason_fa: string }>;
  actions: ActionRecord[];
  verification?: { before: Snapshot; after: Snapshot; passed: boolean; verdict: "resolved" | "partial" | "worse" };
  status: IncidentStatus;
}

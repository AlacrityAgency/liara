export interface ChangeCorrelation {
  hasDeployCorrelation: boolean;
  culpritReleaseId?: string;
  culpritCreatedAt?: string;
  secondsBetweenReleaseAndFailure?: number;
  correlationScore: number; // 0..1
  summary_fa: string;
}

export interface PostmortemReport {
  id: string;
  incidentId: string;
  appName: string;
  generatedAt: string;
  durationSeconds: number;
  markdown: string;
  timeline: Array<{ ts: string; event_fa: string }>;
  actionItems_fa: string[];
}

export interface BuildLogTriageResult {
  success: boolean;
  failureCategory: "DEPENDENCY_ERROR" | "COMPILATION_ERROR" | "MISSING_ENV" | "PORT_ERROR" | "OUT_OF_MEMORY" | "UNKNOWN";
  rootCause_fa: string;
  suggestedFix_fa: string;
  keyLogSnippet: string;
}

export interface PredictiveShieldResult {
  isThreatDetected: boolean;
  threatType?: "IMMINENT_OOM" | "TRAFFIC_WAVE_SURGE" | "CPU_SPIKE";
  estimatedMinutesToImpact: number | null;
  memorySlopeMBPerMin: number;
  riskLevel: "safe" | "warning" | "critical";
  recommendedAction_fa: string;
  alert_fa: string;
}

export interface ChaosExperiment {
  name: string;
  kind: "LATENCY_PULSE" | "CONNECTION_DROP" | "MEMORY_SURGE";
  passed: boolean;
  impactDurationMs: number;
  observation_fa: string;
}

export interface ChaosVaccinationResult {
  targetApp: string;
  executedAt: string;
  resilienceScore: number; // 0..100
  verdict_fa: "تاب‌آوری بالا (مقاوم)" | "تاب‌آوری متوسط (نیازمند بهینه‌سازی)" | "آسیب‌پذیر در برابر قطعی";
  experiments: ChaosExperiment[];
  vulnerabilities_fa: string[];
  remediationAdvice_fa: string;
}

export interface HibernationPlan {
  appName: string;
  isEligible: boolean;
  inactivityMinutes: number;
  currentMonthlyTomans: number;
  hibernatedMonthlyTomans: number;
  monthlySavingsTomans: number;
  savingsPercent: number;
  wakeUpLatencySeconds: number;
  rationale_fa: string;
}

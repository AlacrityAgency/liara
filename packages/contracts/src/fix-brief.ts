/** Fix Brief — WHITEPAPER §11 */
export interface FixBrief {
  incident_id: string;
  symptom: string;
  hypothesis: string;
  confidence: "high" | "medium" | "low";
  evidence: Array<{
    type: string;
    ts?: string;
    text?: string;
    name?: string;
    value?: string;
    /** Evidence id (e.g. "ev_3") this excerpt came from. */
    id?: string;
    kind?: string;
    /** Redacted raw excerpt (log line or stack trace). */
    excerpt?: string;
  }>;
  suspected_locations: Array<{ file: string; line?: number; frame?: string }>;
  suggested_change: string;
  verification: string;

  // WHITEPAPER §9.2 fields. Optional so that older producers and consumers keep working.
  summary_fa?: string;
  summary_en?: string;
  probable_cause?: { title: string; confidence: number };
  reproduction?: string;
  acceptance?: Array<{ test: string; metric?: string }>;
  deploy_back?: "deploy";
}

/** Fix Brief — WHITEPAPER §11 */
export interface FixBrief {
  incident_id: string;
  symptom: string;
  hypothesis: string;
  confidence: "high" | "medium" | "low";
  evidence: Array<{ type: string; ts?: string; text?: string; name?: string; value?: string }>;
  suspected_locations: Array<{ file: string; line?: number }>;
  suggested_change: string;
  verification: string;
}

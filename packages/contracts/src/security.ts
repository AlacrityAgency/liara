/**
 * Risk tiers — WHITEPAPER §7.1
 * L0 observe (auto) · L1 safe/reversible (auto + timeline) · L2 sensitive (approval card + token)
 * L3 critical (typed app name + 10 s cancel window) · OUT_OF_BOUNDS (hand off to the user)
 */
export type RiskLevel = "L0" | "L1" | "L2" | "L3" | "OUT_OF_BOUNDS";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired" | "cancelled" | "executed";

/** Fields of the approval card, WHITEPAPER §12.2 and §8.4 step 4. */
export interface ApprovalCard {
  title_fa: string;            // e.g. "ارتقای پلن"
  what_fa: string;             // چه کاری
  why_fa: string;              // چرا (with evidence)
  cost_fa: string;             // هزینه (or "بدون هزینه") — must come from a fresh read when real
  impact_fa: string;           // اثر (downtime / restart)
  rollback_fa: string;         // بازگشت
  successCriteria_fa: string;  // معیار موفقیت
}

export interface ApprovalRequest {
  id: string;
  tool: string;
  params: Record<string, unknown>;
  paramsHash: string;          // sha256(tool + ":" + canonical_json(params))
  riskLevel: RiskLevel;
  card: ApprovalCard;
  createdAt: string;
  expiresAt: string;           // default createdAt + 5 min (§7.2)
  status: ApprovalStatus;
  /** L3 only: the user must type this exact app name (§7.1). */
  confirmationText?: string;
  /** L3 only: earliest execution time after approval (10 s cancel window, §7.1). */
  executableAfter?: string;
  approvedAt?: string;
}

export interface ApprovalToken {
  approvalId: string;
  paramsHash: string;
  expiresAt: string;
  nonce: string;
  signature: string; // HMAC-SHA256(approvalId:paramsHash:expiresAt:nonce)
}

export type Caller = "user" | "agent" | "probe" | "standing_approval";

export interface AuditRecord {
  seq: number;
  timestamp: string;
  event: "requested" | "approved" | "rejected" | "cancelled" | "executed" | "denied" | "auto_executed";
  tool: string;
  riskLevel: RiskLevel;
  caller: Caller;
  paramsHash: string;
  approvalId?: string;
  success?: boolean;
  detail?: string;
  previousRecordHash: string;
  recordHash: string;
}

/** WHITEPAPER §7.3 `.sokan/policy.yaml` */
export interface StandingApprovalRule {
  action: string;
  /** Trigger id asserted by a deterministic system component, e.g. "probe.down_for >= 3m". */
  when: string;
  maxPerHour?: number;
  maxPerDay?: number;
}

export interface PolicyConfig {
  app: string;
  standingApprovals?: StandingApprovalRule[];
  /** Actions that always need a live approval, even if a standing rule exists. */
  never?: string[];
}

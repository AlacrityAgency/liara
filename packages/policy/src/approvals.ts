import * as crypto from "crypto";
import type {
  ApprovalCard, ApprovalRequest, ApprovalToken, AuditRecord, Caller, PolicyConfig, RiskLevel,
} from "@sokan/contracts";
import { paramsHash, riskOf, StandingApprovals } from "./engine";
import { TokenGuard } from "./tokens";
import { AuditLedger } from "./audit";

export const APPROVAL_TTL_MS = 5 * 60_000;   // §7.2 point 2
export const L3_CANCEL_WINDOW_MS = 10_000;   // §7.1

export type RequestOutcome =
  | { kind: "auto"; risk: RiskLevel; approvalId?: string; via: "tier" | "standing_approval" }
  | { kind: "pending"; risk: RiskLevel; approval: ApprovalRequest };

export type DenyCode =
  | "UNKNOWN_APPROVAL" | "NOT_APPROVED" | "TOOL_MISMATCH" | "APPROVAL_EXPIRED" | "IN_CANCEL_WINDOW"
  | "FORGED_TOKEN" | "TOKEN_EXPIRED" | "PARAM_MISMATCH" | "REPLAY_DETECTED" | "WRONG_CONFIRMATION"
  | "OUT_OF_BOUNDS" | "APPROVAL_REQUIRED";

export type Decision =
  | { ok: true; risk: RiskLevel; approvalId?: string }
  | { ok: false; risk: RiskLevel; code: DenyCode };

export interface ApprovalServiceOptions {
  secret?: string;
  config?: PolicyConfig;
  now?: () => number;
  audit?: AuditLedger;
}

/**
 * The only path from "the agent wants X" to "X runs".
 * Tokens never leave this object: the agent and the UI only see approval ids.
 */
export class ApprovalService {
  readonly audit: AuditLedger;
  private readonly guard: TokenGuard;
  private readonly standing: StandingApprovals;
  private readonly now: () => number;
  private readonly approvals = new Map<string, ApprovalRequest>();
  private readonly tokens = new Map<string, ApprovalToken>();

  constructor(opts: ApprovalServiceOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.guard = new TokenGuard(opts.secret, this.now);
    this.standing = new StandingApprovals(opts.config, this.now);
    this.audit = opts.audit ?? new AuditLedger();
  }

  /** Classify and either allow (L0/L1, standing rule) or create a pending approval (L2/L3). */
  request(
    tool: string, params: Record<string, unknown>, card: ApprovalCard, caller: Caller,
    opts: { systemTriggers?: string[]; confirmationText?: string } = {},
  ): RequestOutcome {
    const risk = riskOf(tool, params);
    const hash = paramsHash(tool, params);
    if (risk === "OUT_OF_BOUNDS") {
      this.log("denied", tool, risk, caller, hash, undefined, false, "OUT_OF_BOUNDS");
      throw new Error("OUT_OF_BOUNDS");
    }
    if (risk === "L0" || risk === "L1") return { kind: "auto", risk, via: "tier" };

    const id = `apr_${crypto.randomBytes(6).toString("hex")}`;
    const t = this.now();
    const approval: ApprovalRequest = {
      id, tool, params, paramsHash: hash, riskLevel: risk, card,
      createdAt: new Date(t).toISOString(),
      expiresAt: new Date(t + APPROVAL_TTL_MS).toISOString(),
      status: "pending",
    };
    if (risk === "L3") {
      approval.confirmationText = opts.confirmationText ?? String(params["project"] ?? params["name"] ?? "");
    }

    if (this.standing.allows(tool, risk, opts.systemTriggers ?? [])) {
      approval.status = "approved";
      approval.approvedAt = approval.createdAt;
      this.approvals.set(id, approval);
      this.tokens.set(id, this.guard.issue(id, hash));
      this.log("approved", tool, risk, "standing_approval", hash, id, true, (opts.systemTriggers ?? []).join(","));
      return { kind: "auto", risk, approvalId: id, via: "standing_approval" };
    }

    this.approvals.set(id, approval);
    this.log("requested", tool, risk, caller, hash, id);
    return { kind: "pending", risk, approval: { ...approval } };
  }

  /** User click. L3 needs the exact app name and starts the 10 s cancel window. */
  approve(id: string, typed?: string): Decision {
    const a = this.approvals.get(id);
    if (!a) return { ok: false, risk: "L2", code: "UNKNOWN_APPROVAL" };
    this.expireIfDue(a);
    if (a.status !== "pending") return { ok: false, risk: a.riskLevel, code: a.status === "expired" ? "APPROVAL_EXPIRED" : "NOT_APPROVED" };
    if (a.riskLevel === "L3" && (typed ?? "").trim() !== a.confirmationText) {
      this.log("denied", a.tool, a.riskLevel, "user", a.paramsHash, id, false, "WRONG_CONFIRMATION");
      return { ok: false, risk: a.riskLevel, code: "WRONG_CONFIRMATION" };
    }
    const t = this.now();
    a.status = "approved";
    a.approvedAt = new Date(t).toISOString();
    if (a.riskLevel === "L3") a.executableAfter = new Date(t + L3_CANCEL_WINDOW_MS).toISOString();
    this.tokens.set(id, this.guard.issue(id, a.paramsHash));
    this.log("approved", a.tool, a.riskLevel, "user", a.paramsHash, id, true);
    return { ok: true, risk: a.riskLevel, approvalId: id };
  }

  reject(id: string): boolean {
    const a = this.approvals.get(id);
    if (!a || a.status !== "pending") return false;
    a.status = "rejected";
    this.log("rejected", a.tool, a.riskLevel, "user", a.paramsHash, id);
    return true;
  }

  /** Cancel a pending approval, or an approved L3 action still inside its cancel window. */
  cancel(id: string): boolean {
    const a = this.approvals.get(id);
    if (!a) return false;
    const inWindow = a.status === "approved" && a.executableAfter !== undefined && this.now() < Date.parse(a.executableAfter);
    if (a.status !== "pending" && !inWindow) return false;
    a.status = "cancelled";
    this.tokens.delete(id);
    this.log("cancelled", a.tool, a.riskLevel, "user", a.paramsHash, id);
    return true;
  }

  /**
   * Gate called immediately before execution. The params passed here are the ones that will be
   * sent to the API; they are re-hashed and must match what the user approved.
   */
  authorize(tool: string, params: Record<string, unknown>, approvalId: string | undefined, caller: Caller = "agent"): Decision {
    const risk = riskOf(tool, params);
    const hash = paramsHash(tool, params);
    if (risk === "L0" || risk === "L1") return { ok: true, risk };
    const deny = (code: DenyCode): Decision => {
      this.log("denied", tool, risk, caller, hash, approvalId, false, code);
      return { ok: false, risk, code };
    };
    if (risk === "OUT_OF_BOUNDS") return deny("OUT_OF_BOUNDS");
    if (!approvalId) return deny("APPROVAL_REQUIRED");
    const a = this.approvals.get(approvalId);
    if (!a) return deny("UNKNOWN_APPROVAL");
    if (a.tool !== tool) return deny("TOOL_MISMATCH");
    if (a.status !== "approved" && a.status !== "executed") return deny(a.status === "expired" ? "APPROVAL_EXPIRED" : "NOT_APPROVED");
    if (a.executableAfter && this.now() < Date.parse(a.executableAfter)) return deny("IN_CANCEL_WINDOW");
    const token = this.tokens.get(approvalId);
    if (!token) return deny("NOT_APPROVED");
    const check = this.guard.verify(token, hash);
    if (!check.valid) return deny(check.error);
    a.status = "executed";
    return { ok: true, risk, approvalId };
  }

  /** Record the outcome of an executed (or auto-executed) action. */
  recordResult(tool: string, params: Record<string, unknown>, caller: Caller, success: boolean, detail?: string, approvalId?: string): AuditRecord {
    const risk = riskOf(tool, params);
    return this.log(approvalId ? "executed" : "auto_executed", tool, risk, caller, paramsHash(tool, params), approvalId, success, detail);
  }

  get(id: string): ApprovalRequest | undefined {
    const a = this.approvals.get(id);
    if (a) this.expireIfDue(a);
    return a ? { ...a } : undefined;
  }

  list(): ApprovalRequest[] {
    return [...this.approvals.values()].map((a) => { this.expireIfDue(a); return { ...a }; });
  }

  private expireIfDue(a: ApprovalRequest): void {
    if (a.status === "pending" && this.now() > Date.parse(a.expiresAt)) {
      a.status = "expired";
      this.log("denied", a.tool, a.riskLevel, "user", a.paramsHash, a.id, false, "APPROVAL_EXPIRED");
    }
  }

  private log(
    event: AuditRecord["event"], tool: string, riskLevel: RiskLevel, caller: Caller, hash: string,
    approvalId?: string, success?: boolean, detail?: string,
  ): AuditRecord {
    return this.audit.append({ event, tool, riskLevel, caller, paramsHash: hash, approvalId, success, detail });
  }
}

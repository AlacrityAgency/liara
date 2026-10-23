import * as crypto from "crypto";
import type {
  ApprovalCard, ApprovalRequest, ApprovalStatus, ApprovalToken, Caller, PolicyConfig, RiskLevel,
} from "@sokan/contracts";
import { paramsHash, riskOf, StandingApprovals } from "./engine";
import { TokenGuard, resolveSecretString } from "./tokens";
import { AuditEntry, AuditLedger, AuditMode } from "./audit";
import { SecretRedactor } from "./redactor";

export const APPROVAL_TTL_MS = 5 * 60_000;   // §7.2 point 2
export const L3_CANCEL_WINDOW_MS = 10_000;   // §7.1

/** Parameter keys (and env-style names) whose values are masked in any public view. */
export const SECRET_PARAM_KEY = /SECRET|TOKEN|PASSWORD|KEY|DATABASE_URL|URI|URL$/i;

const MASK = "••••";

/** Shows only the last four characters. Values of four characters or fewer show nothing but the mask. */
export function maskValue(value: unknown): string {
  const s = String(value);
  return s.length > 4 ? `${MASK}${s.slice(-4)}` : MASK;
}

/**
 * Public copy of tool parameters: secret-looking keys are masked (••••b7c1), every value under
 * `variables[].value` is masked, and string leaves go through the redactor. The input is not modified.
 * Hashes are always computed over the unmasked params.
 */
export function maskParams(params: Record<string, unknown>): Record<string, unknown> {
  return maskNode(params, false) as Record<string, unknown>;
}

function maskNode(node: unknown, forceAll: boolean): unknown {
  if (node === null || node === undefined) return node;
  if (typeof node === "string") return forceAll ? maskValue(node) : SecretRedactor.redactText(node);
  if (typeof node === "number" || typeof node === "boolean" || typeof node === "bigint") {
    return forceAll ? maskValue(node) : node;
  }
  if (Array.isArray(node)) return node.map((item) => maskNode(item, forceAll));
  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    // An env pair ({key: NAME, value: VALUE}): the name is not secret, the value always is.
    return maskObject(obj, forceAll, typeof obj["key"] === "string" && "value" in obj);
  }
  return forceAll ? MASK : node;
}

function maskObject(obj: Record<string, unknown>, forceAll: boolean, envPair: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (envPair && key === "value") {
      out[key] = maskNode(value, true);
    } else if (envPair && key === "key") {
      out[key] = maskNode(value, forceAll);
    } else if (key === "variables" && Array.isArray(value)) {
      // Every value under variables[] is masked, whatever its key says.
      out[key] = value.map((item) => (item && typeof item === "object" && !Array.isArray(item)
        ? maskObject(item as Record<string, unknown>, false, true)
        : maskNode(item, true)));
    } else {
      out[key] = maskNode(value, forceAll || SECRET_PARAM_KEY.test(key));
    }
  }
  return out;
}

/** What the UI and the agent may see of an approval. Never contains the token, the secret or confirmationText. */
export interface PublicApproval {
  id: string;
  tool: string;
  params: Record<string, unknown>;   // masked
  paramsHash: string;
  riskLevel: RiskLevel;
  card: ApprovalCard;
  createdAt: string;
  expiresAt: string;
  status: ApprovalStatus;
  /** L3 only: the user must type the app name. The string itself is not sent (WHITEPAPER §10.3). */
  requiresTypedConfirmation: boolean;
  approvedAt?: string;
  executableAfter?: string;
}

export type RequestOutcome =
  | { kind: "auto"; risk: RiskLevel; approvalId?: string; via: "tier" | "standing_approval" }
  | { kind: "pending"; risk: RiskLevel; approval: PublicApproval };

export type DenyCode =
  | "UNKNOWN_APPROVAL" | "NOT_APPROVED" | "TOOL_MISMATCH" | "APPROVAL_EXPIRED" | "IN_CANCEL_WINDOW"
  | "FORGED_TOKEN" | "TOKEN_EXPIRED" | "PARAM_MISMATCH" | "REPLAY_DETECTED" | "WRONG_CONFIRMATION"
  | "OUT_OF_BOUNDS" | "APPROVAL_REQUIRED";

export type Decision =
  | { ok: true; risk: RiskLevel; approvalId?: string }
  | { ok: false; risk: RiskLevel; code: DenyCode };

export interface ApprovalServiceOptions {
  /** Server secret. Falls back to SOKAN_SECRET. Without either, a random per-process key is used (isEphemeralSecret). */
  secret?: string;
  config?: PolicyConfig;
  now?: () => number;
  audit?: AuditLedger;
}

export interface ExecutionMeta {
  mode?: AuditMode;
  durationMs?: number;
}

/**
 * The only path from "the agent wants X" to "X runs".
 * Tokens never leave this object: the agent and the UI only see approval ids and masked views.
 */
export class ApprovalService {
  readonly audit: AuditLedger;
  /** True when no SOKAN_SECRET or secret option was given: approvals do not survive a restart. */
  readonly isEphemeralSecret: boolean;
  private readonly guard: TokenGuard;
  private readonly standing: StandingApprovals;
  private readonly now: () => number;
  private readonly approvals = new Map<string, ApprovalRequest>();
  private readonly tokens = new Map<string, ApprovalToken>();
  private readonly scheduled = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(opts: ApprovalServiceOptions = {}) {
    this.now = opts.now ?? Date.now;
    const secret = resolveSecretString(opts.secret);
    this.isEphemeralSecret = secret === undefined;
    this.guard = new TokenGuard(secret, this.now);
    this.standing = new StandingApprovals(opts.config, this.now);
    this.audit = opts.audit ?? new AuditLedger({ key: secret });
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
      id, tool,
      // Copy: the executor must run exactly what was hashed here, even if the caller later mutates its object.
      params: structuredClone(params), paramsHash: hash, riskLevel: risk, card,
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
    return { kind: "pending", risk, approval: this.toPublic(approval) };
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

  /**
   * Cancel a pending approval, an approved L3 action still inside its cancel window, or an approved
   * action whose scheduled execution has not run yet.
   * Also clears any execution scheduled with scheduleExecution (WHITEPAPER §10.2 point 4).
   */
  cancel(id: string): boolean {
    const a = this.approvals.get(id);
    if (!a) return false;
    const inWindow = a.status === "approved" && a.executableAfter !== undefined && this.now() < Date.parse(a.executableAfter);
    const scheduledNotRun = a.status === "approved" && this.scheduled.has(id);
    if (a.status !== "pending" && !inWindow && !scheduledNotRun) return false;
    a.status = "cancelled";
    this.clearScheduled(id);
    this.tokens.delete(id);
    this.log("cancelled", a.tool, a.riskLevel, "user", a.paramsHash, id);
    return true;
  }

  /**
   * Schedules `fn` to run after an approved action's delay. For L3 the delay is at least the rest of the
   * cancel window. Calling again replaces the earlier schedule. cancel() clears it. Returns false if the
   * approval is not in the approved state.
   */
  scheduleExecution(id: string, delayMs: number, fn: () => unknown): boolean {
    const a = this.approvals.get(id);
    if (!a || a.status !== "approved") return false;
    let delay = Number.isFinite(delayMs) ? Math.max(0, delayMs) : 0;
    if (a.executableAfter) delay = Math.max(delay, Date.parse(a.executableAfter) - this.now());
    this.clearScheduled(id);
    const handle = setTimeout(() => {
      this.scheduled.delete(id);
      const current = this.approvals.get(id);
      if (!current || current.status !== "approved") return;
      Promise.resolve()
        .then(fn)
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.log("executed", current.tool, current.riskLevel, "agent", current.paramsHash, id, false, `SCHEDULED_FAILED: ${msg}`);
        });
    }, delay);
    this.scheduled.set(id, handle);
    return true;
  }

  isScheduled(id: string): boolean {
    return this.scheduled.has(id);
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

  /**
   * The exact params bound at approval time (a deep copy). The executor must use these, never the
   * params the agent sent. Returns undefined unless the approval is approved or executed.
   */
  getApprovedParams(id: string): Record<string, unknown> | undefined {
    const a = this.approvals.get(id);
    if (!a || (a.status !== "approved" && a.status !== "executed")) return undefined;
    return structuredClone(a.params);
  }

  /** Record the outcome of an executed (or auto-executed) action. */
  recordResult(
    tool: string, params: Record<string, unknown>, caller: Caller, success: boolean,
    detail?: string, approvalId?: string, meta: ExecutionMeta = {},
  ): AuditEntry {
    const risk = riskOf(tool, params);
    return this.log(
      approvalId ? "executed" : "auto_executed", tool, risk, caller, paramsHash(tool, params),
      approvalId, success, detail, meta,
    );
  }

  /** Public view of one approval. Expired pending approvals are marked as expired. */
  get(id: string): PublicApproval | undefined {
    const a = this.approvals.get(id);
    if (!a) return undefined;
    this.expireIfDue(a);
    return this.toPublic(a);
  }

  list(): PublicApproval[] {
    return [...this.approvals.values()].map((a) => { this.expireIfDue(a); return this.toPublic(a); });
  }

  /** Strips confirmationText, tokens and secret values. Usable on any approval record. */
  toPublic(approval: ApprovalRequest): PublicApproval {
    return {
      id: approval.id,
      tool: approval.tool,
      params: maskParams(approval.params),
      paramsHash: approval.paramsHash,
      riskLevel: approval.riskLevel,
      card: SecretRedactor.redactObject(approval.card),
      createdAt: approval.createdAt,
      expiresAt: approval.expiresAt,
      status: approval.status,
      requiresTypedConfirmation: approval.riskLevel === "L3",
      ...(approval.approvedAt ? { approvedAt: approval.approvedAt } : {}),
      ...(approval.executableAfter ? { executableAfter: approval.executableAfter } : {}),
    };
  }

  private clearScheduled(id: string): void {
    const handle = this.scheduled.get(id);
    if (handle !== undefined) {
      clearTimeout(handle);
      this.scheduled.delete(id);
    }
  }

  private expireIfDue(a: ApprovalRequest): void {
    if (a.status === "pending" && this.now() > Date.parse(a.expiresAt)) {
      a.status = "expired";
      this.log("denied", a.tool, a.riskLevel, "user", a.paramsHash, a.id, false, "APPROVAL_EXPIRED");
    }
  }

  private log(
    event: AuditEntry["event"], tool: string, riskLevel: RiskLevel, caller: Caller, hash: string,
    approvalId?: string, success?: boolean, detail?: string, meta: ExecutionMeta = {},
  ): AuditEntry {
    return this.audit.append({
      event, tool, riskLevel, caller, paramsHash: hash, approvalId, success,
      detail: detail === undefined ? undefined : SecretRedactor.redactText(detail),
      ...(meta.mode ? { mode: meta.mode } : {}),
      ...(meta.durationMs !== undefined ? { durationMs: meta.durationMs } : {}),
    });
  }
}

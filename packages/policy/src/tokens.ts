import * as crypto from "crypto";
import type { ApprovalToken } from "@sokan/contracts";

export type TokenCheck =
  | { valid: true }
  | { valid: false; error: "FORGED_TOKEN" | "TOKEN_EXPIRED" | "PARAM_MISMATCH" | "REPLAY_DETECTED" };

/**
 * Resolves the server secret: explicit option first, then SOKAN_SECRET.
 * Returns undefined when neither is set (callers then fall back to an ephemeral per-process key).
 */
export function resolveSecretString(explicit?: string): string | undefined {
  if (explicit && explicit.length > 0) return explicit;
  const fromEnv = process.env["SOKAN_SECRET"];
  return fromEnv && fromEnv.length > 0 ? fromEnv : undefined;
}

/**
 * HMAC approval tokens — WHITEPAPER §7.2 and §10.2.
 * The key lives only in this object (server side); the agent never receives it.
 * Without SOKAN_SECRET or an explicit secret the key is random per process and
 * `isEphemeralSecret` is true, so the UI can warn that approvals do not survive a restart.
 */
export class TokenGuard {
  private readonly key: Buffer;
  readonly isEphemeralSecret: boolean;
  /** nonce -> token expiry (ms). Entries past expiry are pruned: an expired token is rejected before the replay check. */
  private readonly usedNonces = new Map<string, number>();

  constructor(secret?: string, private readonly now: () => number = Date.now) {
    const resolved = resolveSecretString(secret);
    this.isEphemeralSecret = resolved === undefined;
    this.key = resolved !== undefined ? Buffer.from(resolved, "utf8") : crypto.randomBytes(32);
  }

  issue(approvalId: string, paramsHash: string, ttlMs = 5 * 60_000): ApprovalToken {
    const expiresAt = new Date(this.now() + ttlMs).toISOString();
    const nonce = crypto.randomBytes(16).toString("hex");
    return { approvalId, paramsHash, expiresAt, nonce, signature: this.sign(approvalId, paramsHash, expiresAt, nonce) };
  }

  /**
   * Order matters: authenticate first (so a forged token reveals nothing), then expiry,
   * then parameter binding, then single use. The nonce is consumed only on success.
   */
  verify(token: ApprovalToken, expectedParamsHash: string): TokenCheck {
    const expected = Buffer.from(this.sign(token.approvalId, token.paramsHash, token.expiresAt, token.nonce), "hex");
    const given = /^[0-9a-f]{64}$/.test(token.signature) ? Buffer.from(token.signature, "hex") : Buffer.alloc(0);
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
      return { valid: false, error: "FORGED_TOKEN" };
    }
    const t = this.now();
    if (t > Date.parse(token.expiresAt)) return { valid: false, error: "TOKEN_EXPIRED" };
    if (token.paramsHash !== expectedParamsHash) return { valid: false, error: "PARAM_MISMATCH" };
    this.pruneNonces(t);
    if (this.usedNonces.has(token.nonce)) return { valid: false, error: "REPLAY_DETECTED" };
    this.usedNonces.set(token.nonce, Date.parse(token.expiresAt));
    return { valid: true };
  }

  private pruneNonces(t: number): void {
    for (const [nonce, exp] of this.usedNonces) {
      if (t > exp) this.usedNonces.delete(nonce);
    }
  }

  private sign(approvalId: string, paramsHash: string, expiresAt: string, nonce: string): string {
    return crypto.createHmac("sha256", this.key).update(`${approvalId}:${paramsHash}:${expiresAt}:${nonce}`).digest("hex");
  }
}

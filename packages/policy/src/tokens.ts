import * as crypto from "crypto";
import type { ApprovalToken } from "@sokan/contracts";

export type TokenCheck =
  | { valid: true }
  | { valid: false; error: "FORGED_TOKEN" | "TOKEN_EXPIRED" | "PARAM_MISMATCH" | "REPLAY_DETECTED" };

/**
 * HMAC approval tokens — WHITEPAPER §7.2.
 * The key lives only in this object (server side); the agent never receives it.
 */
export class TokenGuard {
  private readonly key: Buffer;
  private readonly usedNonces = new Set<string>();

  constructor(secret?: string, private readonly now: () => number = Date.now) {
    this.key = secret ? Buffer.from(secret, "utf8") : crypto.randomBytes(32);
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
    if (this.now() > Date.parse(token.expiresAt)) return { valid: false, error: "TOKEN_EXPIRED" };
    if (token.paramsHash !== expectedParamsHash) return { valid: false, error: "PARAM_MISMATCH" };
    if (this.usedNonces.has(token.nonce)) return { valid: false, error: "REPLAY_DETECTED" };
    this.usedNonces.add(token.nonce);
    return { valid: true };
  }

  private sign(approvalId: string, paramsHash: string, expiresAt: string, nonce: string): string {
    return crypto.createHmac("sha256", this.key).update(`${approvalId}:${paramsHash}:${expiresAt}:${nonce}`).digest("hex");
  }
}

import * as crypto from "crypto";
import type { AuditRecord } from "@sokan/contracts";

const GENESIS = "0".repeat(64);

function hashRecord(r: Omit<AuditRecord, "recordHash">): string {
  // Every field participates in the hash, so editing any field breaks the chain.
  const body = JSON.stringify([
    r.seq, r.timestamp, r.event, r.tool, r.riskLevel, r.caller, r.paramsHash,
    r.approvalId ?? null, r.success ?? null, r.detail ?? null, r.previousRecordHash,
  ]);
  return crypto.createHash("sha256").update(body).digest("hex");
}

/** Append-only, hash-chained audit log — WHITEPAPER §7.4. (In-memory for the MVP; SQLite per §5.3 is future work.) */
export class AuditLedger {
  private readonly records: AuditRecord[] = [];

  append(entry: Omit<AuditRecord, "seq" | "timestamp" | "previousRecordHash" | "recordHash">): AuditRecord {
    const base = {
      ...entry,
      seq: this.records.length + 1,
      timestamp: new Date().toISOString(),
      previousRecordHash: this.records.at(-1)?.recordHash ?? GENESIS,
    };
    const record: AuditRecord = Object.freeze({ ...base, recordHash: hashRecord(base) });
    this.records.push(record);
    return record;
  }

  list(): readonly AuditRecord[] {
    return this.records;
  }

  /** Returns the seq of the first broken record, or null when the chain is intact. */
  verify(records: readonly AuditRecord[] = this.records): number | null {
    let prev = GENESIS;
    for (const r of records) {
      const { recordHash, ...rest } = r;
      if (r.previousRecordHash !== prev || hashRecord(rest) !== recordHash) return r.seq;
      prev = recordHash;
    }
    return null;
  }
}

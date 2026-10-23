import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import type { AuditRecord } from "@sokan/contracts";
import { resolveSecretString } from "./tokens";

const GENESIS = "0".repeat(64);

export type AuditMode = "live" | "simulated";

/** An audit record plus the execution mode and duration (WHITEPAPER §10.4). */
export interface AuditEntry extends AuditRecord {
  mode?: AuditMode;
  durationMs?: number;
}

export type AuditInput = Omit<AuditEntry, "seq" | "timestamp" | "previousRecordHash" | "recordHash">;

export type VerifyResult = { ok: true } | { ok: false; brokenAt: number };

export interface AuditLedgerOptions {
  /** Append-only JSONL file. Existing content is loaded on start and the chain continues from it. */
  filePath?: string;
  /** HMAC key. Falls back to SOKAN_SECRET. Required when filePath is set. */
  key?: string;
}

/** The authenticated fields of a record. previousRecordHash is covered by the MAC input as well. */
function fieldsOf(r: Omit<AuditEntry, "recordHash">): unknown[] {
  return [
    r.seq, r.timestamp, r.event, r.tool, r.riskLevel, r.caller, r.paramsHash,
    r.approvalId ?? null, r.success ?? null, r.detail ?? null, r.mode ?? null, r.durationMs ?? null,
  ];
}

/** h_i = HMAC(k, h_{i-1} || entry_i) — WHITEPAPER §10.4. */
function macOf(key: Buffer, previous: string, fields: unknown[]): string {
  return crypto.createHmac("sha256", key).update(`${previous}\n${JSON.stringify(fields)}`).digest("hex");
}

function sameHex(a: string, b: unknown): boolean {
  if (typeof b !== "string" || !/^[0-9a-f]{64}$/.test(b)) return false;
  return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

/** Reads a JSONL file. Stops at the first line that is not valid JSON and reports its seq. */
function readRecords(filePath: string): { records: AuditEntry[]; malformedAt?: number } {
  if (!fs.existsSync(filePath)) return { records: [] };
  const lines = fs.readFileSync(filePath, "utf8").split("\n");
  const records: AuditEntry[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line.length === 0) continue;
    try {
      records.push(JSON.parse(line) as AuditEntry);
    } catch {
      return { records, malformedAt: records.length + 1 };
    }
  }
  return { records };
}

/**
 * Append-only, HMAC-chained audit log — WHITEPAPER §7.4 and §10.4.
 * Without filePath it is in memory (tests, demo). With filePath every record is appended to a JSONL file.
 * If the file on disk fails verification at start, the ledger stays readable but refuses to append.
 */
export class AuditLedger {
  readonly filePath?: string;
  /** True when no key was supplied; the chain then cannot be verified after a restart. */
  readonly isEphemeralKey: boolean;
  private readonly key: Buffer;
  private readonly records: AuditEntry[] = [];
  /** seq of the first broken record found in the file at start, if any. */
  private loadBrokenAt?: number;

  constructor(opts: AuditLedgerOptions = {}) {
    const secret = resolveSecretString(opts.key);
    if (opts.filePath && secret === undefined) {
      throw new Error("AUDIT_KEY_REQUIRED: a persistent audit log needs a key option or SOKAN_SECRET");
    }
    this.isEphemeralKey = secret === undefined;
    this.key = secret !== undefined ? Buffer.from(secret, "utf8") : crypto.randomBytes(32);
    this.filePath = opts.filePath;

    if (this.filePath) {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const loaded = readRecords(this.filePath);
      this.records.push(...loaded.records);
      const chain = this.checkChain(loaded.records);
      if (!chain.ok) this.loadBrokenAt = chain.brokenAt;
      else if (loaded.malformedAt !== undefined) this.loadBrokenAt = loaded.malformedAt;
    }
  }

  append(entry: AuditInput): AuditEntry {
    if (this.loadBrokenAt !== undefined) {
      throw new Error(`AUDIT_CHAIN_BROKEN: existing log fails verification at seq ${this.loadBrokenAt}; refusing to append`);
    }
    const previous = this.records.at(-1)?.recordHash ?? GENESIS;
    const base = {
      seq: this.records.length + 1,
      timestamp: new Date().toISOString(),
      event: entry.event,
      tool: entry.tool,
      riskLevel: entry.riskLevel,
      caller: entry.caller,
      paramsHash: entry.paramsHash,
      approvalId: entry.approvalId,
      success: entry.success,
      detail: entry.detail,
      mode: entry.mode,
      durationMs: entry.durationMs,
      previousRecordHash: previous,
    };
    const record: AuditEntry = Object.freeze({ ...base, recordHash: macOf(this.key, previous, fieldsOf(base)) });
    if (this.filePath) {
      // Write before updating memory: a failed write must not leave a record the file does not have.
      fs.appendFileSync(this.filePath, `${JSON.stringify(record)}\n`, { mode: 0o600 });
    }
    this.records.push(record);
    return record;
  }

  list(): readonly AuditEntry[] {
    return this.records;
  }

  /**
   * With `records`: verifies that array. Without it: verifies the file on disk when filePath is set
   * (so edits made after start are caught), otherwise the in-memory records.
   */
  verify(records?: readonly AuditEntry[]): VerifyResult {
    if (records) return this.checkChain(records);
    if (this.filePath) {
      const loaded = readRecords(this.filePath);
      if (loaded.malformedAt !== undefined) return { ok: false, brokenAt: loaded.malformedAt };
      return this.checkChain(loaded.records);
    }
    return this.checkChain(this.records);
  }

  private checkChain(records: readonly AuditEntry[]): VerifyResult {
    let prev = GENESIS;
    for (let i = 0; i < records.length; i++) {
      const r = records[i]!;
      if (r.seq !== i + 1 || r.previousRecordHash !== prev) return { ok: false, brokenAt: r.seq };
      const { recordHash, ...rest } = r;
      if (!sameHex(macOf(this.key, prev, fieldsOf(rest)), recordHash)) return { ok: false, brokenAt: r.seq };
      prev = recordHash;
    }
    return { ok: true };
  }
}

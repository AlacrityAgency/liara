import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import type { AuditRecord } from "@sokan/contracts";
import { resolveSecretString } from "./tokens";

const GENESIS = "0".repeat(64);
/** Signed summary of the chain, rewritten on every append. Lets verify() see a truncated tail. */
export const AUDIT_HEAD_FILE = "audit.head";

export type AuditMode = "live" | "simulated";

/** An audit record plus the execution mode and duration (WHITEPAPER §10.4). */
export interface AuditEntry extends AuditRecord {
  mode?: AuditMode;
  durationMs?: number;
}

export type AuditInput = Omit<AuditEntry, "seq" | "timestamp" | "previousRecordHash" | "recordHash">;

/**
 * CHAIN_BROKEN (no reason field): a record fails its MAC or link. TRUNCATED: records at the end were removed.
 * HEAD_INVALID: audit.head fails its MAC. HEAD_MISMATCH: the record at the head position was replaced.
 */
export type AuditFailureReason = "TRUNCATED" | "HEAD_INVALID" | "HEAD_MISMATCH";
export type VerifyResult = { ok: true } | { ok: false; brokenAt: number; reason?: AuditFailureReason };

export interface AuditLedgerOptions {
  /** Append-only JSONL file. Existing content is loaded on start and the chain continues from it. */
  filePath?: string;
  /** HMAC key. Falls back to SOKAN_SECRET. Required when filePath is set. */
  key?: string;
}

interface HeadRecord {
  count: number;
  lastHash: string;
  hmac: string;
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

function headMacOf(key: Buffer, count: number, lastHash: string): string {
  return crypto.createHmac("sha256", key).update(`AUDIT_HEAD\n${count}\n${lastHash}`).digest("hex");
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
 * Without filePath it is in memory (tests, demo). With filePath every record is appended to a JSONL file
 * and `audit.head` (count, last hash, MAC) is rewritten, so removing records from the end is detected.
 * If the file on disk fails verification at start, the ledger stays readable but refuses to append.
 */
export class AuditLedger {
  readonly filePath?: string;
  /** True when no key was supplied; the chain then cannot be verified after a restart. */
  readonly isEphemeralKey: boolean;
  private readonly key: Buffer;
  private readonly records: AuditEntry[] = [];
  /** seq of the first broken record (or the head position) found in the file at start, if any. */
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
      const state = this.checkLoaded(loaded);
      if (!state.ok) {
        this.loadBrokenAt = state.brokenAt;
        // Surfaced at startup so the operator sees it without opening the console (EVALUATION R10).
        console.warn(
          `[SOKAN_AUDIT] WARNING: audit log ${state.reason ?? "CHAIN_BROKEN"} at seq ${state.brokenAt}; ` +
          "the console keeps reading it but refuses to append until the log is restored."
        );
      }
    }
  }

  /** True when the file on disk verified at start and no tampering was seen since. */
  get startupOk(): boolean {
    return this.loadBrokenAt === undefined;
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
      this.writeHead(this.records.length + 1, record.recordHash);
    }
    this.records.push(record);
    return record;
  }

  list(): readonly AuditEntry[] {
    return this.records;
  }

  /**
   * With `records`: verifies that array. Without it: verifies the file on disk when filePath is set
   * (so edits made after start are caught, including a truncated tail), otherwise the in-memory records.
   */
  verify(records?: readonly AuditEntry[]): VerifyResult {
    if (records) return this.checkChain(records);
    if (this.filePath) return this.checkLoaded(readRecords(this.filePath));
    return this.checkChain(this.records);
  }

  private checkLoaded(loaded: { records: AuditEntry[]; malformedAt?: number }): VerifyResult {
    if (loaded.malformedAt !== undefined) return { ok: false, brokenAt: loaded.malformedAt };
    const chain = this.checkChain(loaded.records);
    if (!chain.ok) return chain;
    return this.checkHead(loaded.records);
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

  /** Compares the signed head with the file. A missing head (logs written before it existed) is not an error. */
  private checkHead(records: readonly AuditEntry[]): VerifyResult {
    const headPath = this.headPath();
    if (!headPath || !fs.existsSync(headPath)) return { ok: true };
    let head: HeadRecord | undefined;
    try {
      head = JSON.parse(fs.readFileSync(headPath, "utf8")) as HeadRecord;
    } catch {
      head = undefined;
    }
    const valid = head !== undefined && head !== null && Number.isInteger(head.count) && head.count >= 0
      && typeof head.lastHash === "string" && sameHex(headMacOf(this.key, head.count, head.lastHash), head.hmac);
    if (!valid) return { ok: false, brokenAt: records.length + 1, reason: "HEAD_INVALID" };
    const h = head!;
    if (records.length < h.count) return { ok: false, brokenAt: records.length + 1, reason: "TRUNCATED" };
    const atHead = h.count === 0 ? GENESIS : records[h.count - 1]!.recordHash;
    if (atHead !== h.lastHash) return { ok: false, brokenAt: h.count, reason: "HEAD_MISMATCH" };
    return { ok: true };
  }

  private headPath(): string | undefined {
    return this.filePath ? path.join(path.dirname(this.filePath), AUDIT_HEAD_FILE) : undefined;
  }

  /** Atomic rewrite (temp file, then rename) so a crash never leaves a half-written head. */
  private writeHead(count: number, lastHash: string): void {
    const headPath = this.headPath();
    if (!headPath) return;
    const head: HeadRecord = { count, lastHash, hmac: headMacOf(this.key, count, lastHash) };
    const tmp = `${headPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(head), { mode: 0o600 });
    fs.renameSync(tmp, headPath);
  }
}

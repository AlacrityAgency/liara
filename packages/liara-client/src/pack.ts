import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { randomBytes } from "node:crypto";
import type { HumanError } from "@sokan/contracts";
import { packFailedError, packTooLargeError } from "./errors";

/** Compressed archive limit enforced by the Liara source upload endpoint (CLI MAX_SOURCE_SIZE). */
export const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
/** Raw (uncompressed) guard so that building the archive in memory stays bounded. */
const MAX_RAW_BYTES = 512 * 1024 * 1024;

const BLOCK = 512;
const RECORD = 10240;

export interface PackOptions {
  /** Where to write the .tar.gz. Defaults to a random file in os.tmpdir(). */
  outPath?: string;
  /** Compressed size limit in bytes (default 256 MB). */
  maxBytes?: number;
}

export interface PackResult {
  path: string;
  sizeBytes: number;
  /** Included regular files, relative POSIX paths, sorted. */
  files: string[];
}

export class PackError extends Error {
  readonly humanError: HumanError;

  constructor(humanError: HumanError) {
    super(humanError.why_fa);
    this.name = "PackError";
    this.humanError = humanError;
  }
}

interface IgnoreRule {
  regex: RegExp;
  negated: boolean;
  dirOnly: boolean;
  anchored: boolean;
}

interface Collected {
  entries: Array<{ rel: string; abs: string; isDir: boolean; mode: number; size: number }>;
  files: string[];
  topSizes: Map<string, number>;
}

/** Names that are never packed, at any depth (secrets and dependency/VCS folders). */
export function isAlwaysExcluded(name: string): boolean {
  if (name === "node_modules" || name === ".git") return true;
  if (name === ".env" || name.startsWith(".env.")) return true;
  return name.endsWith(".pem");
}

/** Parses gitignore-style lines: comments, `!` negation, trailing `/` (dirs), `/` anchoring, `*`, `**`, `?`. */
export function parseIgnoreRules(text: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    let negated = false;
    if (line.startsWith("!")) {
      negated = true;
      line = line.slice(1);
    }
    let dirOnly = false;
    if (line.endsWith("/")) {
      dirOnly = true;
      line = line.replace(/\/+$/, "");
    }
    const anchored = line.includes("/");
    line = line.replace(/^\/+/, "");
    if (!line) continue;
    rules.push({ regex: globToRegExp(line), negated, dirOnly, anchored });
  }
  return rules;
}

function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 2;
        } else {
          re += ".*";
          i += 1;
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}

function isIgnored(rules: IgnoreRule[], relPath: string, name: string, isDir: boolean): boolean {
  let ignored = false;
  for (const rule of rules) {
    if (rule.dirOnly && !isDir) continue;
    const target = rule.anchored ? relPath : name;
    if (rule.regex.test(target)) ignored = !rule.negated;
  }
  return ignored;
}

async function readOptional(file: string): Promise<string | undefined> {
  try {
    return await fs.promises.readFile(file, "utf8");
  } catch {
    return undefined;
  }
}

async function collect(root: string, rules: IgnoreRule[]): Promise<Collected> {
  const out: Collected = { entries: [], files: [], topSizes: new Map() };
  let rawBytes = 0;

  const visit = async (dirAbs: string, relDir: string): Promise<void> => {
    const dirents = await fs.promises.readdir(dirAbs, { withFileTypes: true });
    dirents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const d of dirents) {
      const name = d.name;
      if (isAlwaysExcluded(name)) continue;
      if (d.isSymbolicLink()) continue;
      const isDir = d.isDirectory();
      if (!isDir && !d.isFile()) continue;
      const rel = relDir ? `${relDir}/${name}` : name;
      if (isIgnored(rules, rel, name, isDir)) continue;
      const abs = path.join(dirAbs, name);
      const st = await fs.promises.stat(abs);
      const mode = st.mode & 0o777;
      if (isDir) {
        out.entries.push({ rel, abs, isDir: true, mode, size: 0 });
        await visit(abs, rel);
        continue;
      }
      rawBytes += st.size;
      if (rawBytes > MAX_RAW_BYTES) {
        throw new PackError(packTooLargeError(largest(out.topSizes)));
      }
      const top = rel.split("/")[0];
      out.topSizes.set(top, (out.topSizes.get(top) ?? 0) + st.size);
      out.entries.push({ rel, abs, isDir: false, mode, size: st.size });
      out.files.push(rel);
    }
  };

  await visit(root, "");
  return out;
}

function largest(sizes: Map<string, number>): Array<{ name: string; bytes: number }> {
  return [...sizes.entries()]
    .map(([name, bytes]) => ({ name, bytes }))
    .sort((a, b) => b.bytes - a.bytes || (a.name < b.name ? -1 : 1));
}

/**
 * Packs a project directory into a deterministic .tar.gz (ustar, sorted entries,
 * zero mtime/uid/gid, gzip without timestamp). Honors .liaraignore (or .gitignore
 * when .liaraignore is absent) and always excludes node_modules, .git, .env*, *.pem.
 */
export async function packSource(dir: string, opts: PackOptions = {}): Promise<PackResult> {
  const root = path.resolve(dir);
  const st = await fs.promises.stat(root).catch(() => null);
  if (!st || !st.isDirectory()) {
    throw new PackError(packFailedError(`پوشه‌ی پروژه پیدا نشد: ${root}`));
  }

  const ignoreText =
    (await readOptional(path.join(root, ".liaraignore"))) ??
    (await readOptional(path.join(root, ".gitignore"))) ??
    "";
  const collected = await collect(root, parseIgnoreRules(ignoreText));

  const parts: Buffer[] = [];
  for (const e of collected.entries) {
    if (e.isDir) {
      parts.push(...entryBlocks(`${e.rel}/`, 0, e.mode, "5"));
    } else {
      const data = await fs.promises.readFile(e.abs);
      parts.push(...entryBlocks(e.rel, data.length, e.mode, "0"));
      parts.push(data, padding(data.length));
    }
  }
  parts.push(Buffer.alloc(BLOCK * 2));
  const used = parts.reduce((n, b) => n + b.length, 0);
  parts.push(Buffer.alloc((RECORD - (used % RECORD)) % RECORD));

  const gz = zlib.gzipSync(Buffer.concat(parts), { level: 9 });
  const maxBytes = opts.maxBytes ?? MAX_ARCHIVE_BYTES;
  if (gz.length > maxBytes) {
    throw new PackError(packTooLargeError(largest(collected.topSizes)));
  }

  const outPath =
    opts.outPath ?? path.join(os.tmpdir(), `sokan-source-${randomBytes(8).toString("hex")}.tar.gz`);
  await fs.promises.writeFile(outPath, gz, { mode: 0o600 });
  return { path: outPath, sizeBytes: gz.length, files: collected.files.slice().sort() };
}

function padding(size: number): Buffer {
  return Buffer.alloc((BLOCK - (size % BLOCK)) % BLOCK);
}

function entryBlocks(name: string, size: number, mode: number, typeflag: "0" | "5"): Buffer[] {
  if (Buffer.byteLength(name) <= 100) {
    return [header(name, "", size, mode, typeflag)];
  }
  const split = splitName(name);
  if (split) {
    return [header(split.name, split.prefix, size, mode, typeflag)];
  }
  // PAX extended header carries the full path for names that ustar cannot hold.
  const pax = paxRecord("path", name);
  return [
    header("PaxHeader", "", pax.length, 0o644, "x"),
    pax,
    padding(pax.length),
    header(Buffer.from(name).subarray(0, 100).toString("utf8"), "", size, mode, typeflag),
  ];
}

function splitName(name: string): { name: string; prefix: string } | null {
  for (let i = name.length - 1; i > 0; i--) {
    if (name[i] !== "/") continue;
    const prefix = name.slice(0, i);
    const rest = name.slice(i + 1);
    if (rest && Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(rest) <= 100) {
      return { name: rest, prefix };
    }
  }
  return null;
}

function paxRecord(key: string, value: string): Buffer {
  const body = ` ${key}=${value}\n`;
  const bodyBytes = Buffer.byteLength(body);
  let total = bodyBytes + 1;
  while (String(total).length + bodyBytes !== total) total = String(total).length + bodyBytes;
  return Buffer.from(`${total}${body}`, "utf8");
}

function header(name: string, prefix: string, size: number, mode: number, typeflag: string): Buffer {
  const h = Buffer.alloc(BLOCK);
  writeText(h, 0, 100, name);
  writeOctal(h, 100, 8, mode);
  writeOctal(h, 108, 8, 0); // uid
  writeOctal(h, 116, 8, 0); // gid
  writeOctal(h, 124, 12, size);
  writeOctal(h, 136, 12, 0); // mtime
  h.fill(0x20, 148, 156); // checksum placeholder
  h.write(typeflag, 156, 1, "ascii");
  h.write("ustar\0", 257, 6, "ascii");
  h.write("00", 263, 2, "ascii");
  writeOctal(h, 329, 8, 0);
  writeOctal(h, 337, 8, 0);
  writeText(h, 345, 155, prefix);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  return h;
}

function writeText(buf: Buffer, offset: number, len: number, text: string): void {
  const b = Buffer.from(text, "utf8");
  b.copy(buf, offset, 0, Math.min(len, b.length));
}

function writeOctal(buf: Buffer, offset: number, len: number, n: number): void {
  buf.write(`${n.toString(8).padStart(len - 1, "0")}\0`, offset, len, "ascii");
}

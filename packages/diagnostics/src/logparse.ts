/**
 * Stack-trace parser and error clustering — WHITEPAPER §10.3 (last paragraph).
 * Recognises Node.js, Python, PHP/Laravel and Go traces and groups them by
 * signature = error type + top user-code frame, so "412 occurrences" replaces 412 lines.
 */

export interface LogLine {
  id: string;
  ts: string;
  text: string;
}

export interface Frame {
  file: string;
  line?: number;
  col?: number;
}

export interface ErrorCluster {
  signature: string;
  runtime: "node" | "python" | "php" | "go" | "generic";
  errorType: string;
  message: string;
  frame?: Frame;
  count: number;
  firstTs: string;
  lastTs: string;
  sampleIds: string[];
}

const NODE_ERR = /^\s*(?:Uncaught\s+)?(?:Error:\s+)?([A-Z][A-Za-z0-9_]*(?:Error|Exception)|Error)(?:\s*\[[^\]]*\])?:\s*(.*)$/;
const NODE_FRAME = /^\s+at\s/;
const NODE_LOC = /((?:[A-Za-z]:)?[^\s()]+?):(\d+):(\d+)\)?\s*$/;
const PY_START = /^Traceback \(most recent call last\):/;
const PY_FRAME = /^\s*File "([^"]+)", line (\d+)/;
// Accepts dotted module paths: "django.db.utils.OperationalError", "psycopg2.OperationalError".
const PY_ERR = /^((?:[a-z_][\w]*\.)*[A-Za-z_]\w*(?:Error|Exception|Interrupt|Exit)):\s?(.*)$/;
const PHP_FATAL = /PHP (?:Fatal error|Warning|Parse error):\s+(?:Uncaught\s+)?([^\s:]+)?:?\s*(.*?) in (\S+?)(?::| on line )(\d+)/;
const LARAVEL = /local\.ERROR:\s*(.*)/;
const GO_PANIC = /^panic:\s*(.*)$/;
const GO_FRAME = /^\s+(\/?[^\s:]+\.go):(\d+)/;

function isUserFrame(file: string): boolean {
  return !/node_modules|node:internal|^internal\/|site-packages|\/usr\/lib|\/vendor\/|runtime\/|<anonymous>/.test(file);
}

function shortFile(file: string): string {
  const norm = file.replace(/\\/g, "/");
  const m = norm.match(/(?:^|\/)((?:src|app|lib|routes|pkg|cmd)\/.*)$/);
  return m ? m[1] : norm.split("/").slice(-2).join("/");
}

interface Parsed {
  runtime: ErrorCluster["runtime"];
  errorType: string;
  message: string;
  frame?: Frame;
  id: string;
  ts: string;
}

/** Parse a window of log lines into individual error occurrences. */
export function parseErrors(lines: readonly LogLine[]): Parsed[] {
  const out: Parsed[] = [];
  for (let i = 0; i < lines.length; i++) {
    const { text, id, ts } = lines[i];

    if (PY_START.test(text)) {
      let frame: Frame | undefined;
      let j = i + 1;
      for (; j < lines.length && j < i + 60; j++) {
        const f = lines[j].text.match(PY_FRAME);
        if (f && isUserFrame(f[1])) frame = { file: shortFile(f[1]), line: Number(f[2]) };
        const e = lines[j].text.match(PY_ERR);
        if (e) {
          out.push({ runtime: "python", errorType: e[1], message: e[2], frame, id, ts });
          break;
        }
      }
      i = j;
      continue;
    }

    const php = text.match(PHP_FATAL);
    if (php) {
      out.push({ runtime: "php", errorType: php[1] || "PHPFatal", message: php[2], frame: { file: shortFile(php[3]), line: Number(php[4]) }, id, ts });
      continue;
    }
    const lar = text.match(LARAVEL);
    if (lar) {
      out.push({ runtime: "php", errorType: "LaravelError", message: lar[1].slice(0, 200), id, ts });
      continue;
    }

    const go = text.match(GO_PANIC);
    if (go) {
      let frame: Frame | undefined;
      for (let j = i + 1; j < lines.length && j < i + 40; j++) {
        const f = lines[j].text.match(GO_FRAME);
        if (f && isUserFrame(f[1])) { frame = { file: shortFile(f[1]), line: Number(f[2]) }; break; }
      }
      out.push({ runtime: "go", errorType: "panic", message: go[1], frame, id, ts });
      continue;
    }

    const node = text.match(NODE_ERR);
    if (node) {
      let frame: Frame | undefined;
      let j = i + 1;
      for (; j < lines.length && NODE_FRAME.test(lines[j].text); j++) {
        const f = lines[j].text.match(NODE_LOC);
        if (f && !frame && isUserFrame(f[1])) frame = { file: shortFile(f[1]), line: Number(f[2]), col: Number(f[3]) };
      }
      out.push({ runtime: "node", errorType: node[1], message: node[2], frame, id, ts });
      i = j - 1;
      continue;
    }
  }
  return out;
}

/** Normalise volatile parts of a message (ids, numbers, quoted values) so repeats cluster together. */
function normalise(msg: string): string {
  return msg.replace(/\b[0-9a-f]{8,}\b/gi, "<id>").replace(/\b\d+\b/g, "<n>").slice(0, 160);
}

export function clusterErrors(lines: readonly LogLine[]): ErrorCluster[] {
  const map = new Map<string, ErrorCluster>();
  for (const p of parseErrors(lines)) {
    const where = p.frame ? `${p.frame.file}:${p.frame.line ?? "?"}` : normalise(p.message);
    const signature = `${p.errorType} @ ${where}`;
    const c = map.get(signature);
    if (c) {
      c.count++;
      if (p.ts < c.firstTs) c.firstTs = p.ts;
      if (p.ts > c.lastTs) c.lastTs = p.ts;
      if (c.sampleIds.length < 5) c.sampleIds.push(p.id);
    } else {
      map.set(signature, {
        signature, runtime: p.runtime, errorType: p.errorType, message: p.message, frame: p.frame,
        count: 1, firstTs: p.ts, lastTs: p.ts, sampleIds: [p.id],
      });
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

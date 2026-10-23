import type { SuccessCriterion } from "@sokan/contracts";
import type { CollectedEvidence } from "./types";
import { clusterErrors } from "./logparse";
import { percentile } from "./stats";
import { isErrorLine } from "./patterns";
import { isRunning } from "./extractors";

/** State of the system at one moment, for before/after comparison (WHITEPAPER §8.6). */
export interface VerifySnapshot {
  ts: string;
  /** Probe results. Paths that were requested but not probed carry status null. */
  probe: Array<{ path: string; status: number | null; ms: number | null }>;
  errorRatePerMin: number;
  errorSignatures: Array<{ signature: string; count: number }>;
  topErrorSignature?: string;
  memP95Pct: number | null;
  cpuP95Pct: number | null;
  appletsRunning: number | null;
  restarts: number | null;
  releaseState: string | null;
  diskUsedPct: number | null;
}

export type CheckValue = number | string | boolean | null;

export interface VerifyCheck {
  criterion: SuccessCriterion;
  passed: boolean;
  before: CheckValue;
  after: CheckValue;
  detail_fa: string;
}

export interface VerifyResult {
  passed: boolean;
  checks: VerifyCheck[];
  summary_fa: string;
}

/** Western digits to Persian, decimal point to Persian decimal separator. */
export function fa(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "نامشخص";
  return String(value)
    .replace(/\./g, "٫")
    .replace(/[0-9]/g, (d) => String.fromCharCode(0x06f0 + Number(d)));
}

function windowMinutes(data: CollectedEvidence): number {
  const start = Date.parse(data.window.start);
  const end = Date.parse(data.window.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 1;
  return Math.max(1, (end - start) / 60_000);
}

/**
 * Summarise collected evidence into the comparable state used by verify().
 * `probePaths` lists the paths that must be checked; a path that was not probed is reported as null.
 */
export function takeSnapshot(evidence: CollectedEvidence, probePaths: readonly string[] = []): VerifySnapshot {
  const logs = evidence.logs ?? [];
  const errorLines = logs.filter((l) => isErrorLine(l.text)).length;
  const errorRatePerMin = Math.round((errorLines / windowMinutes(evidence)) * 100) / 100;

  // Raw error lines, grouped by normalised text. Using raw lines (not only parsed stack traces) means
  // pool and DB messages that are not stack traces still count for no_error_signature.
  const groups = new Map<string, number>();
  for (const l of logs) {
    if (!isErrorLine(l.text)) continue;
    const key = l.text.trim().replace(/\b[0-9a-f]{8,}\b/gi, "<id>").replace(/\b\d+\b/g, "<n>").slice(0, 160);
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  const errorSignatures = [...groups].map(([signature, count]) => ({ signature, count }));
  const clusters = clusterErrors(logs);

  // Latest result per path
  const latest = new Map<string, { status: number | null; ms: number | null; ts: string }>();
  for (const p of evidence.probes ?? []) {
    const prev = latest.get(p.path);
    if (!prev || p.ts >= prev.ts) latest.set(p.path, { status: p.status, ms: p.ms, ts: p.ts });
  }
  const paths = probePaths.length > 0 ? [...probePaths] : [...latest.keys()];
  const probe = paths.map((path) => {
    const r = latest.get(path);
    return { path, status: r?.status ?? null, ms: r?.ms ?? null };
  });

  const memP95Pct =
    evidence.memory && evidence.memory.length > 0 && evidence.app?.memoryLimitMB
      ? Math.round(percentile(evidence.memory.map((m) => (m.mb / evidence.app!.memoryLimitMB!) * 100), 95) ?? 0)
      : null;
  const cpuP95Pct =
    evidence.cpu && evidence.cpu.length > 0
      ? Math.round(percentile(evidence.cpu.map((c) => c.pct), 95) ?? 0)
      : null;

  const applets = evidence.applets;
  const appletsRunning = applets ? applets.filter((a) => isRunning(a.state)).length : null;
  const restarts = applets ? applets.reduce((s, a) => s + (a.restarts || 0), 0) : null;

  const newestRelease = [...(evidence.releases ?? [])].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : -1
  )[0];

  return {
    ts: evidence.window.end,
    probe,
    errorRatePerMin,
    errorSignatures,
    topErrorSignature: clusters[0]?.signature,
    memP95Pct,
    cpuP95Pct,
    appletsRunning,
    restarts,
    releaseState: newestRelease?.state ?? null,
    diskUsedPct: evidence.disk?.usedPct ?? null,
  };
}

const isOk = (status: number | null | undefined): boolean =>
  typeof status === "number" && status >= 200 && status < 400;

/**
 * Evaluate success criteria as functions of the before and after snapshots (WHITEPAPER §8.6 step 4).
 * Missing data fails the check; it is never read as success.
 */
export function verify(
  before: VerifySnapshot,
  after: VerifySnapshot,
  successCriteria: readonly SuccessCriterion[]
): VerifyResult {
  if (successCriteria.length === 0) {
    return { passed: false, checks: [], summary_fa: "معیار موفقیتی برای راستی‌آزمایی تعریف نشده است." };
  }

  const checks: VerifyCheck[] = successCriteria.map((c) => evaluate(c, before, after));
  const passed = checks.every((c) => c.passed);
  const details = checks.map((c) => c.detail_fa);
  const failed = checks.filter((c) => !c.passed).map((c) => c.detail_fa);
  const summary_fa = passed
    ? `راستی‌آزمایی موفق: ${details.join("؛ ")}.`
    : `راستی‌آزمایی ناموفق: ${failed.join("؛ ")}.`;
  return { passed, checks, summary_fa };
}

function evaluate(c: SuccessCriterion, before: VerifySnapshot, after: VerifySnapshot): VerifyCheck {
  switch (c.kind) {
    case "probe_ok": {
      const a = after.probe.find((p) => p.path === c.path);
      const b = before.probe.find((p) => p.path === c.path);
      const passed = isOk(a?.status);
      const detail = !a || a.status === null
        ? `${c.path} پروب نشد`
        : passed
          ? `${c.path} پاسخ ${fa(a.status)} در ${fa(a.ms)} میلی‌ثانیه داد${b?.status ? ` (پیش از اقدام: ${fa(b.status)})` : ""}`
          : `${c.path} هنوز پاسخ ${fa(a.status)} می‌دهد؛ انتظار ۲xx یا ۳xx`;
      return { criterion: c, passed, before: b?.status ?? null, after: a?.status ?? null, detail_fa: detail };
    }
    case "probe_latency_below": {
      const a = after.probe.find((p) => p.path === c.path);
      const b = before.probe.find((p) => p.path === c.path);
      const passed = isOk(a?.status) && a?.ms !== null && a?.ms !== undefined && a.ms < c.ms;
      const detail = !a || a.status === null
        ? `${c.path} پروب نشد`
        : `زمان پاسخ ${c.path} از ${fa(b?.ms ?? null)} به ${fa(a.ms)} میلی‌ثانیه رسید${passed ? "" : `؛ هدف زیر ${fa(c.ms)} است`}`;
      return { criterion: c, passed, before: b?.ms ?? null, after: a?.ms ?? null, detail_fa: detail };
    }
    case "no_error_signature": {
      const count = (snap: VerifySnapshot) =>
        snap.errorSignatures
          .filter((e) => e.signature.toLowerCase().includes(c.signature.toLowerCase()))
          .reduce((s, e) => s + e.count, 0);
      const a = count(after);
      const b = count(before);
      const passed = a === 0;
      const detail = passed
        ? `خطای «${c.signature}» دیگر در لاگ دیده نمی‌شود`
        : `خطای «${c.signature}» هنوز ${fa(a)} بار تکرار شده`;
      return { criterion: c, passed, before: b, after: a, detail_fa: detail };
    }
    case "error_rate_below": {
      const a = after.errorRatePerMin;
      const b = before.errorRatePerMin;
      const passed = a < c.perMin;
      const detail = `نرخ خطا از ${fa(b)} در دقیقه به ${fa(a)} ${passed ? "رسید" : `نرسید (هدف: زیر ${fa(c.perMin)})`}`;
      return { criterion: c, passed, before: b, after: a, detail_fa: detail };
    }
    case "mem_below_pct": {
      const a = after.memP95Pct;
      const b = before.memP95Pct;
      const passed = a !== null && a < c.pct;
      const detail = a === null
        ? "داده‌ی حافظه در دسترس نیست"
        : `p95 حافظه ${passed ? `از ${fa(b)}٪ به ${fa(a)}٪ رسید` : `${fa(a)}٪ است؛ هدف زیر ${fa(c.pct)}٪`}`;
      return { criterion: c, passed, before: b, after: a, detail_fa: detail };
    }
    case "cpu_below_pct": {
      const a = after.cpuP95Pct;
      const b = before.cpuP95Pct;
      const passed = a !== null && a < c.pct;
      const detail = a === null
        ? "داده‌ی پردازنده در دسترس نیست"
        : `p95 پردازنده ${passed ? `از ${fa(b)}٪ به ${fa(a)}٪ رسید` : `${fa(a)}٪ است؛ هدف زیر ${fa(c.pct)}٪`}`;
      return { criterion: c, passed, before: b, after: a, detail_fa: detail };
    }
    case "disk_used_below": {
      const a = after.diskUsedPct;
      const b = before.diskUsedPct;
      const passed = a !== null && a < c.pct;
      const detail = a === null
        ? "داده‌ی دیسک در دسترس نیست"
        : `مصرف دیسک ${passed ? `از ${fa(b)}٪ به ${fa(a)}٪ رسید` : `${fa(a)}٪ است؛ هدف زیر ${fa(c.pct)}٪`}`;
      return { criterion: c, passed, before: b, after: a, detail_fa: detail };
    }
    case "applets_running": {
      const a = after.appletsRunning;
      const passed = a !== null && a >= 1;
      const detail = a === null
        ? "وضعیت نمونه‌ها در دسترس نیست"
        : passed
          ? `${fa(a)} نمونه‌ی برنامه در حال اجراست`
          : "هیچ نمونه‌ای در حال اجرا نیست";
      return { criterion: c, passed, before: before.appletsRunning, after: a, detail_fa: detail };
    }
    case "restarts_stable": {
      const a = after.restarts;
      const b = before.restarts;
      const passed = a !== null && b !== null && a <= b;
      const detail = a === null || b === null
        ? "تعداد ری‌استارت در دسترس نیست"
        : passed
          ? "ری‌استارت جدیدی ثبت نشد"
          : `تعداد ری‌استارت از ${fa(b)} به ${fa(a)} رسید`;
      return { criterion: c, passed, before: b, after: a, detail_fa: detail };
    }
    case "release_ready": {
      const a = after.releaseState;
      const passed = a === "READY";
      return {
        criterion: c,
        passed,
        before: before.releaseState,
        after: a,
        detail_fa: passed ? "وضعیت ریلیز READY است" : `وضعیت ریلیز ${a ?? "نامشخص"} است`,
      };
    }
  }
}

const HEALTH_PATHS = new Set(["/health", "/healthz", "/status", "/ping"]);

/**
 * Failing HTTP paths, most reliable first:
 * 1. probes that returned 5xx or failed, 2. access-log lines with a 5xx status, 3. route files named in
 * stack traces (guessed as /api/<name>, last resort). Health endpoints are listed last, because a
 * health check can return 200 while the feature route is broken (WHITEPAPER §8.6 note).
 */
export function failingPathsFromEvidence(evidence: CollectedEvidence): string[] {
  const ranked: string[] = [];
  const push = (raw: string) => {
    const path = raw.split("?")[0];
    if (path.startsWith("/") && !ranked.includes(path)) ranked.push(path);
  };

  for (const p of evidence.probes ?? []) {
    if (p.status === null || p.status >= 500) push(p.path);
  }

  const accessLog = /\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/[^\s"?]*)[^"\n]*"?\s+(5\d\d)\b/;
  const ginLog = /\|\s*(5\d\d)\s*\|[^|]*\|\s*(?:GET|POST|PUT|PATCH|DELETE)\s+"(\/[^"?]*)/;
  for (const l of evidence.logs ?? []) {
    const m = l.text.match(accessLog);
    if (m) push(m[1]);
    const g = l.text.match(ginLog);
    if (g) push(g[2]);
  }

  const routeFile = /(?:routes?|controllers?|handlers?)\/([\w-]+)\.(?:js|ts|mjs|cjs|py|php|go)\b/;
  for (const l of evidence.logs ?? []) {
    const m = l.text.match(routeFile);
    if (m) push(`/api/${m[1]}`);
  }

  return [...ranked.filter((p) => !HEALTH_PATHS.has(p)), ...ranked.filter((p) => HEALTH_PATHS.has(p))];
}

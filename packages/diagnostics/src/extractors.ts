import type { Signal, SignalKind, EvidenceRef } from "@sokan/contracts";
import type { CollectedEvidence, Thresholds } from "./types";
import { DEFAULT_THRESHOLDS } from "./types";
import { linearRegression, percentile } from "./stats";
import { clusterErrors } from "./logparse";
import {
  isCacheUnreachableLine,
  isDbUnreachableLine,
  isDiskLine,
  isErrorLine,
  isOomLine,
  isPoolExhaustionLine,
  isUpstreamSlowLine,
  listenedPort,
  poolLabel,
} from "./patterns";

export interface SignalExtractionResult {
  signals: Signal[];
  evidence: EvidenceRef[];
  missingEvidence: string[];
}

export const clamp = (v: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, v));

export function isRunning(state: string | undefined): boolean {
  return (state ?? "").toLowerCase() === "running";
}

/** Earliest error line or failing probe in the window (ISO string), or undefined when there are no errors. */
export function errorOnset(data: CollectedEvidence): string | undefined {
  const candidates: number[] = [];
  for (const l of data.logs ?? []) {
    if (isErrorLine(l.text)) candidates.push(Date.parse(l.ts));
  }
  for (const p of data.probes ?? []) {
    if (p.status === null || p.status >= 500) candidates.push(Date.parse(p.ts));
  }
  const valid = candidates.filter((t) => Number.isFinite(t));
  if (valid.length === 0) return undefined;
  return new Date(Math.min(...valid)).toISOString();
}

/** Largest number of events that fall inside any sliding window of `windowMs`. */
function maxInWindow(timestamps: number[], windowMs: number): number {
  const sorted = timestamps.filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
  let best = 0;
  let lo = 0;
  for (let hi = 0; hi < sorted.length; hi++) {
    while (sorted[hi] - sorted[lo] > windowMs) lo++;
    best = Math.max(best, hi - lo + 1);
  }
  return best;
}

export function extractSignals(
  data: CollectedEvidence,
  thresholds: Thresholds = DEFAULT_THRESHOLDS
): SignalExtractionResult {
  const signals: Signal[] = [];
  const evidence: EvidenceRef[] = [];
  const missingEvidence: string[] = [];

  let evIdSeq = 1;
  const addEv = (type: EvidenceRef["type"], ts: string, summary: string, raw_ref: string): string => {
    const id = `ev_${evIdSeq++}`;
    evidence.push({ id, type, ts, summary, raw_ref });
    return id;
  };

  // 1. Missing evidence tracking. A null collector is never read as "healthy".
  if (!data.app) missingEvidence.push("app_get");
  if (!data.applets) missingEvidence.push("applets_get");
  if (!data.events) missingEvidence.push("events_get");
  if (!data.releases) missingEvidence.push("release_list");
  if (!data.memory) missingEvidence.push("metrics_memory");
  if (!data.cpu) missingEvidence.push("metrics_cpu");
  if (!data.logs) missingEvidence.push("logs_get");
  if (!data.probes) missingEvidence.push("http_probe");

  const nowTs = new Date().toISOString();
  const logs = data.logs ?? [];
  const applets = data.applets ?? [];
  const add = (s: Signal) => signals.push(s);

  // 2. OOM_KILLED
  const oomApplets = applets.filter(
    (a) => a.reason?.toLowerCase().includes("oom") || a.state?.toLowerCase().includes("oom")
  );
  const oomLogs = logs.filter((l) => isOomLine(l.text));
  if (oomApplets.length > 0 || oomLogs.length > 0) {
    const evIds: string[] = [];
    for (const a of oomApplets) {
      evIds.push(addEv("applet", nowTs, `Applet terminated with OOM: reason=${a.reason ?? "OOMKilled"}`, "applets"));
    }
    for (const l of oomLogs.slice(0, 3)) {
      evIds.push(addEv("log", l.ts, `OOM log: ${l.text.slice(0, 120)}`, l.id));
    }
    add({
      kind: "OOM_KILLED",
      firstSeen: oomLogs[0]?.ts ?? nowTs,
      detail_fa: "کانتینر به دلیل فراتر رفتن از سقف حافظه (OOMKilled) توسط سیستم متوقف شد.",
      evidence: evIds,
      strength: oomApplets.length > 0 ? 1 : clamp(0.7 + 0.1 * oomLogs.length),
      data: { appletOOM: oomApplets.length, oomLogLines: oomLogs.length },
    });
  }

  // 3. MEMORY_PRESSURE and MEMORY_LEAK_TREND (p95 based, WHITEPAPER §8.3)
  const memory = data.memory ?? [];
  const limitMB = data.app?.memoryLimitMB ?? null;
  if (memory.length > 0 && limitMB) {
    const pcts = memory.map((m) => (m.mb / limitMB) * 100);
    const p95 = percentile(pcts, 95) ?? 0;
    const maxMB = Math.max(...memory.map((m) => m.mb));

    if (p95 >= thresholds.memoryPressurePct) {
      const peak = memory.find((m) => m.mb === maxMB);
      const evId = addEv(
        "metric",
        peak?.ts ?? nowTs,
        `Memory p95 ${Math.round(p95)}% of limit ${limitMB}MB (peak ${maxMB}MB)`,
        "metrics/memory"
      );
      add({
        kind: "MEMORY_PRESSURE",
        firstSeen: peak?.ts ?? nowTs,
        detail_fa: `مصرف حافظه (p95) به ${Math.round(p95)}٪ سقف پلن رسید (حداکثر ${maxMB} مگابایت از ${limitMB} مگابایت).`,
        evidence: [evId],
        strength: clamp(0.5 + (0.5 * (p95 - thresholds.memoryPressurePct)) / (100 - thresholds.memoryPressurePct)),
        data: { p95Pct: Math.round(p95), peakMB: maxMB, limitMB },
      });
    }

    if (memory.length >= thresholds.leakMinPoints) {
      const t0 = Date.parse(memory[0].ts) / 1000;
      const pts = memory.map((m) => ({ x: Date.parse(m.ts) / 1000 - t0, y: m.mb }));
      const reg = linearRegression(pts);
      if (reg && reg.slope > 0 && reg.r2 >= thresholds.leakMinR2) {
        const xLast = pts[pts.length - 1].x;
        const startFit = reg.intercept;
        const endFit = reg.intercept + reg.slope * xLast;
        const growthPct = startFit > 0 ? ((endFit - startFit) / startFit) * 100 : 0;
        if (growthPct >= thresholds.leakMinGrowthPct) {
          const slopeMBPerMin = reg.slope * 60;
          const minutesToLimit = Math.max(0, (limitMB - endFit) / slopeMBPerMin);
          const evId = addEv(
            "metric",
            memory[memory.length - 1].ts,
            `Memory positive linear trend: slope=+${slopeMBPerMin.toFixed(2)}MB/min, R²=${reg.r2.toFixed(2)}, growth=${Math.round(growthPct)}%`,
            "metrics/memory"
          );
          add({
            kind: "MEMORY_LEAK_TREND",
            firstSeen: memory[0].ts,
            detail_fa: `شیب رشد مداوم و خطی حافظه مشاهده شد (نشت احتمالی، R²=${reg.r2.toFixed(2)}، رشد ${Math.round(growthPct)}٪).`,
            evidence: [evId],
            strength: clamp(
              0.4 + 0.3 * clamp((reg.r2 - thresholds.leakMinR2) / (1 - thresholds.leakMinR2)) + 0.3 * clamp(growthPct / 100)
            ),
            data: {
              slopeMBPerMin: Math.round(slopeMBPerMin * 100) / 100,
              r2: Math.round(reg.r2 * 1000) / 1000,
              growthPct: Math.round(growthPct),
              minutesToLimit: Math.round(minutesToLimit),
              limitMB,
              currentMB: memory[memory.length - 1].mb,
            },
          });
        }
      }
    }
  }

  // 4. CPU_SATURATION: p95 >= 90 % and at least 3 points at or above 90 % (WHITEPAPER §8.3)
  const cpu = data.cpu ?? [];
  if (cpu.length > 0) {
    const high = cpu.filter((c) => c.pct >= thresholds.cpuSaturationPct);
    const p95 = percentile(cpu.map((c) => c.pct), 95) ?? 0;
    if (high.length >= 3 && p95 >= thresholds.cpuSaturationPct) {
      const evId = addEv(
        "metric",
        high[0].ts,
        `CPU saturation: ${high.length} points >= ${thresholds.cpuSaturationPct}% (p95 ${Math.round(p95)}%)`,
        "metrics/cpu"
      );
      add({
        kind: "CPU_SATURATION",
        firstSeen: high[0].ts,
        detail_fa: `مصرف پردازنده (p95) به ${Math.round(p95)}٪ رسید و برای ${high.length} نقطه بیش از ${thresholds.cpuSaturationPct}٪ بود.`,
        evidence: [evId],
        strength: clamp(0.5 + ((p95 - thresholds.cpuSaturationPct) / 10) * 0.5),
        data: { p95Pct: Math.round(p95), pointsAboveThreshold: high.length },
      });
    }
  }

  // 5. CRASH_LOOP: applets restarts >= 3, or >= 3 restart events inside the window
  const totalRestarts = applets.reduce((sum, a) => sum + (a.restarts || 0), 0);
  const restartEvents = (data.events ?? []).filter((e) =>
    /restart|crash|exit code|back-?off|OOMKilled/i.test(`${e.type} ${e.message ?? ""}`)
  );
  const eventsInWindow = maxInWindow(restartEvents.map((e) => Date.parse(e.ts)), thresholds.crashLoopWindowMs);
  if (totalRestarts >= thresholds.crashLoopCount || eventsInWindow >= thresholds.crashLoopCount) {
    const evIds: string[] = [];
    if (totalRestarts > 0) {
      evIds.push(addEv("applet", nowTs, `Total container restarts: ${totalRestarts}`, "applets"));
    }
    for (const e of restartEvents.slice(0, 3)) {
      evIds.push(addEv("event", e.ts, `Event: ${e.message || e.type}`, e.id));
    }
    add({
      kind: "CRASH_LOOP",
      firstSeen: restartEvents[0]?.ts ?? nowTs,
      detail_fa: `برنامه دچار چرخه‌ی ری‌استارت مکرر شده است (${totalRestarts} ری‌استارت ثبت شد).`,
      evidence: evIds,
      strength: clamp(Math.max(totalRestarts, eventsInWindow) / 6, 0.5, 1),
      data: { restarts: totalRestarts, restartEventsInWindow: eventsInWindow },
    });
  }

  // 6. DEPLOY_REGRESSION: a real release finished at most `deployRegressionMs` before the first error.
  // Synthetic or unknown-source releases never count (EVALUATION M1).
  const onset = errorOnset(data);
  if (onset) {
    const onsetMs = Date.parse(onset);
    let best: { release: NonNullable<CollectedEvidence["releases"]>[number]; diff: number } | null = null;
    for (const r of data.releases ?? []) {
      if (r.state !== "READY" || !r.finishedAt) continue;
      if (r.source !== "liara" && r.source !== "local") continue;
      const diff = onsetMs - Date.parse(r.finishedAt);
      if (diff >= 0 && diff <= thresholds.deployRegressionMs && (!best || diff < best.diff)) best = { release: r, diff };
    }
    if (best) {
      const evId = addEv(
        "release",
        best.release.finishedAt!,
        `Release ${best.release.id} finished ${Math.round(best.diff / 60000)}m before the first error`,
        best.release.id
      );
      add({
        kind: "DEPLOY_REGRESSION",
        firstSeen: best.release.finishedAt!,
        detail_fa: `شروع خطاها ${Math.round(best.diff / 60000)} دقیقه پس از انتشار نسخه‌ی ${best.release.id} بوده است.`,
        evidence: [evId],
        strength: clamp(1 - 0.5 * (best.diff / thresholds.deployRegressionMs)),
        data: { releaseId: best.release.id, minutesAfterRelease: Math.round(best.diff / 60000) },
      });
    }
  }

  // 7. PORT_MISMATCH
  const unhealthyRelease = (data.releases ?? []).find((r) => r.state === "UNHEALTHY");
  const portLog = logs.find((l) => listenedPort(l.text) !== null);
  if (portLog) {
    const listened = listenedPort(portLog.text);
    const configuredPort = data.app?.port;
    if (listened && configuredPort && listened !== configuredPort) {
      const evIds = [addEv("log", portLog.ts, `App logged: "listening on ${listened}"`, portLog.id)];
      if (unhealthyRelease) {
        evIds.push(addEv("release", unhealthyRelease.createdAt, `Release state: UNHEALTHY`, unhealthyRelease.id));
      }
      add({
        kind: "PORT_MISMATCH",
        firstSeen: portLog.ts,
        detail_fa: `ناهمخوانی پورت: برنامه روی پورت ${listened} گوش می‌دهد اما پورت تنظیم‌شده در لیارا ${configuredPort} است.`,
        evidence: evIds,
        strength: 1,
        data: { listenedPort: listened, configuredPort },
      });
    }
  }

  // 8. MISSING_ENV
  const envPattern =
    /Environment variable not found:\s*([A-Z0-9_]+)|KeyError:\s*['"]([A-Z0-9_]+)['"]|Missing required env\s*([A-Z0-9_]+)|process\.env\.([A-Z0-9_]+)\s+is undefined/i;
  const missingEnvLogs = logs.filter((l) => envPattern.test(l.text));
  if (missingEnvLogs.length > 0) {
    const l = missingEnvLogs[0];
    const match = l.text.match(envPattern);
    const varName = match ? match[1] || match[2] || match[3] || match[4] : "UNKNOWN_ENV";
    const appHasKey = (data.app?.envKeys ?? []).includes(varName);
    if (!appHasKey) {
      const evId = addEv("log", l.ts, `Missing env in log: ${l.text.slice(0, 140)}`, l.id);
      add({
        kind: "MISSING_ENV",
        firstSeen: l.ts,
        detail_fa: `متغیر محیطی الزامی ${varName} در تنظیمات اپلیکیشن تعریف نشده است.`,
        evidence: [evId],
        strength: 1,
        data: { variable: varName },
      });
    }
  }

  // 9. DB_UNREACHABLE: only on database ports, DB hosts or DB driver errors (never Redis)
  const dbLines = logs.filter((l) => isDbUnreachableLine(l.text));
  const dbHealthFailed = !!data.db && !data.db.reachable;
  if (dbLines.length > 0 || dbHealthFailed) {
    const evIds: string[] = [];
    for (const l of dbLines.slice(0, 2)) {
      evIds.push(addEv("log", l.ts, `Database connection error: ${l.text.slice(0, 120)}`, l.id));
    }
    if (dbHealthFailed) {
      evIds.push(addEv("metric", nowTs, `DB health check failed: ${data.db?.detail ?? "Unreachable"}`, "db"));
    }
    const portHit = dbLines.some((l) => /(?<!\d)(?:5432|3306|27017)(?!\d)/.test(l.text));
    add({
      kind: "DB_UNREACHABLE",
      firstSeen: dbLines[0]?.ts ?? nowTs,
      detail_fa: "عدم دسترسی به پایگاه‌داده: اتصال به سرور دیتابیس برقرار نشد.",
      evidence: evIds,
      strength: dbHealthFailed ? 1 : portHit ? 0.9 : 0.75,
      data: { lines: dbLines.length },
    });
  }

  // 10. CACHE_UNREACHABLE (Redis)
  const cacheLines = logs.filter((l) => isCacheUnreachableLine(l.text));
  if (cacheLines.length > 0) {
    const evIds = cacheLines.slice(0, 2).map((l) =>
      addEv("log", l.ts, `Cache connection error: ${l.text.slice(0, 120)}`, l.id)
    );
    add({
      kind: "CACHE_UNREACHABLE",
      firstSeen: cacheLines[0].ts,
      detail_fa: "کش (Redis) در دسترس نیست یا اتصال به آن زمان‌بر تایم‌اوت شده است.",
      evidence: evIds,
      strength: clamp(0.8 + 0.05 * cacheLines.length),
      data: { lines: cacheLines.length },
    });
  }

  // 11. DB_POOL_EXHAUSTED
  const poolLines = logs.filter((l) => isPoolExhaustionLine(l.text));
  if (poolLines.length > 0) {
    const evIds = poolLines.slice(0, 2).map((l) =>
      addEv("log", l.ts, `Pool exhaustion: ${l.text.slice(0, 120)}`, l.id)
    );
    add({
      kind: "DB_POOL_EXHAUSTED",
      firstSeen: poolLines[0].ts,
      detail_fa: "اتصال‌های پایگاه‌داده تمام شده‌اند (pool یا سقف اتصال دیتابیس).",
      evidence: evIds,
      strength: clamp(0.7 + 0.1 * poolLines.length),
      data: { lines: poolLines.length, pattern: poolLabel(poolLines[0].text) ?? "connection" },
    });
  }

  // 12. UPSTREAM_SLOW: slow probes or timeouts to external hosts, without CPU or RAM pressure as the cause
  const upstreamLogs = logs.filter((l) => isUpstreamSlowLine(l.text));
  const slowProbes = (data.probes ?? []).filter((p) => p.ms !== null && p.ms > 4000);
  if (upstreamLogs.length > 0 || slowProbes.length >= 2) {
    const evIds: string[] = [];
    for (const l of upstreamLogs.slice(0, 2)) {
      evIds.push(addEv("log", l.ts, `Upstream delay: ${l.text.slice(0, 120)}`, l.id));
    }
    for (const p of slowProbes.slice(0, 2)) {
      evIds.push(addEv("probe", p.ts, `Probe response time high: ${p.ms}ms on ${p.path}`, p.id));
    }
    add({
      kind: "UPSTREAM_SLOW",
      firstSeen: upstreamLogs[0]?.ts ?? slowProbes[0]?.ts ?? nowTs,
      detail_fa: "کندی ناشی از تأخیر یا تایم‌اوت سرویس‌های خارجی یا درگاه‌ها.",
      evidence: evIds,
      strength: clamp(0.6 + 0.1 * (upstreamLogs.length + slowProbes.length)),
      data: { upstreamLines: upstreamLogs.length, slowProbes: slowProbes.length },
    });
  }

  // 13. DISK_FULL
  const diskPct = data.disk?.usedPct ?? 0;
  const enospcLog = logs.find((l) => isDiskLine(l.text));
  if (diskPct >= 90 || enospcLog) {
    const evIds: string[] = [];
    if (enospcLog) evIds.push(addEv("log", enospcLog.ts, `Disk error: ${enospcLog.text.slice(0, 100)}`, enospcLog.id));
    if (diskPct >= 90) evIds.push(addEv("metric", nowTs, `Disk usage ${diskPct}%`, "disks"));
    add({
      kind: "DISK_FULL",
      firstSeen: enospcLog?.ts ?? nowTs,
      detail_fa: `فضای دیسک پر شده است (${diskPct}٪ مصرف).`,
      evidence: evIds,
      strength: enospcLog ? 1 : clamp(0.5 + ((diskPct - 90) / 10) * 0.5),
      data: { usedPct: diskPct },
    });
  }

  // 14. APP_EXCEPTION: the dominant error cluster (Node, Python, PHP/Laravel, Go)
  if (logs.length > 0) {
    const clusters = clusterErrors(logs);
    const top = clusters.find((c) => c.count >= thresholds.frequentExceptionCount);
    if (top) {
      const evId = addEv(
        "log",
        top.firstTs,
        `Exception cluster: ${top.signature} (count: ${top.count})`,
        top.sampleIds[0] ?? "logs"
      );
      add({
        kind: "APP_EXCEPTION",
        firstSeen: top.firstTs,
        detail_fa: `خطای پرتکرار در برنامه شناسایی شد: ${top.errorType} (${top.count} بار تکرار).`,
        evidence: [evId],
        strength: clamp(0.4 + 0.12 * top.count),
        data: { count: top.count, runtime: top.runtime, errorType: top.errorType },
      });
    }
  }

  // 15. APP_STOPPED: scale 0, or no running applet and no restarts (a crash loop is not "stopped")
  const noneRunning = data.applets !== null && applets.every((a) => !isRunning(a.state));
  if ((data.app && data.app.scale === 0) || (noneRunning && totalRestarts === 0)) {
    const evId = addEv("applet", nowTs, "No running applet (scale 0 or all applets stopped)", "app");
    add({
      kind: "APP_STOPPED",
      firstSeen: nowTs,
      detail_fa: "اپلیکیشن خاموش است (تعداد نمونه‌ها صفر است یا هیچ نمونه‌ای در حال اجرا نیست).",
      evidence: [evId],
      strength: 1,
      data: { scale: data.app?.scale ?? null, appletsRunning: applets.filter((a) => isRunning(a.state)).length },
    });
  }

  return { signals, evidence, missingEvidence };
}

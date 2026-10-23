import type { Signal, SignalKind, EvidenceRef } from "@sokan/contracts";
import type { CollectedEvidence, Thresholds } from "./types";
import { DEFAULT_THRESHOLDS } from "./types";
import { linearRegression } from "./stats";
import { clusterErrors } from "./logparse";

export interface SignalExtractionResult {
  signals: Signal[];
  evidence: EvidenceRef[];
  missingEvidence: string[];
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

  // 1. Missing evidence tracking
  if (!data.app) missingEvidence.push("app_get");
  if (!data.applets) missingEvidence.push("applets_get");
  if (!data.events) missingEvidence.push("events_get");
  if (!data.releases) missingEvidence.push("release_list");
  if (!data.memory) missingEvidence.push("metrics_memory");
  if (!data.cpu) missingEvidence.push("metrics_cpu");
  if (!data.logs) missingEvidence.push("logs_get");
  if (!data.probes) missingEvidence.push("http_probe");

  const nowTs = new Date().toISOString();

  // 2. OOM_KILLED
  const oomApplets = (data.applets ?? []).filter(
    (a) => a.reason?.toLowerCase().includes("oom") || a.state?.toLowerCase().includes("oom")
  );
  const oomLogs = (data.logs ?? []).filter(
    (l) => /out of memory|oomkilled|javascript heap out of memory/i.test(l.text)
  );
  if (oomApplets.length > 0 || oomLogs.length > 0) {
    const evIds: string[] = [];
    for (const a of oomApplets) {
      evIds.push(addEv("applet", nowTs, `Applet terminated with OOM: reason=${a.reason ?? "OOMKilled"}`, "applets"));
    }
    for (const l of oomLogs.slice(0, 3)) {
      evIds.push(addEv("log", l.ts, `OOM log: ${l.text.slice(0, 120)}`, l.id));
    }
    signals.push({
      kind: "OOM_KILLED",
      firstSeen: oomLogs[0]?.ts ?? nowTs,
      detail_fa: "کانتینر به دلیل فراتر رفتن از سقف حافظه (OOMKilled) توسط سیستم متوقف شد.",
      evidence: evIds,
    });
  }

  // 3. MEMORY_PRESSURE & MEMORY_LEAK_TREND
  if (data.memory && data.memory.length > 0 && data.app?.memoryLimitMB) {
    const limitMB = data.app.memoryLimitMB;
    const maxMB = Math.max(...data.memory.map((m) => m.mb));
    const maxPct = Math.round((maxMB / limitMB) * 100);

    if (maxPct >= thresholds.memoryPressurePct) {
      const highestPt = data.memory.find((m) => m.mb === maxMB);
      const evId = addEv(
        "metric",
        highestPt?.ts ?? nowTs,
        `Memory peak ${maxMB}MB (${maxPct}% of limit ${limitMB}MB)`,
        "metrics/memory"
      );
      signals.push({
        kind: "MEMORY_PRESSURE",
        firstSeen: highestPt?.ts ?? nowTs,
        detail_fa: `مصرف حافظه به ${maxPct}٪ سقف پلن رسید (حداکثر ${maxMB} مگابایت از ${limitMB} مگابایت).`,
        evidence: [evId],
      });
    }

    if (data.memory.length >= thresholds.leakMinPoints) {
      const t0 = Date.parse(data.memory[0].ts) / 1000;
      const pts = data.memory.map((m) => ({
        x: Date.parse(m.ts) / 1000 - t0,
        y: m.mb,
      }));
      const reg = linearRegression(pts);
      if (reg && reg.slope > 0.01 && reg.r2 >= thresholds.leakMinR2) {
        const evId = addEv(
          "metric",
          data.memory[data.memory.length - 1].ts,
          `Memory positive linear trend: slope=+${(reg.slope * 60).toFixed(2)}MB/min, R²=${reg.r2.toFixed(2)}`,
          "metrics/memory"
        );
        signals.push({
          kind: "MEMORY_LEAK_TREND",
          firstSeen: data.memory[0].ts,
          detail_fa: `شیب رشد مداوم و خطی حافظه مشاهده شد (نشت احتمالی، R²=${reg.r2.toFixed(2)}).`,
          evidence: [evId],
        });
      }
    }
  }

  // 4. CPU_SATURATION
  if (data.cpu && data.cpu.length > 0) {
    const highCpuPts = data.cpu.filter((c) => c.pct >= thresholds.cpuSaturationPct);
    if (highCpuPts.length >= 3) {
      const evId = addEv(
        "metric",
        highCpuPts[0].ts,
        `CPU saturation: ${highCpuPts.length} points >= ${thresholds.cpuSaturationPct}%`,
        "metrics/cpu"
      );
      signals.push({
        kind: "CPU_SATURATION",
        firstSeen: highCpuPts[0].ts,
        detail_fa: `مصرف پردازنده برای چند بازه پی‌درپی بیش از ${thresholds.cpuSaturationPct}٪ بود.`,
        evidence: [evId],
      });
    }
  }

  // 5. CRASH_LOOP
  const totalRestarts = (data.applets ?? []).reduce((sum, a) => sum + (a.restarts || 0), 0);
  const restartEvents = (data.events ?? []).filter((e) => /restart|crash|exit/i.test(e.message || e.type));
  if (totalRestarts >= thresholds.crashLoopCount || restartEvents.length >= thresholds.crashLoopCount) {
    const evIds: string[] = [];
    if (totalRestarts > 0) {
      evIds.push(addEv("applet", nowTs, `Total container restarts: ${totalRestarts}`, "applets"));
    }
    for (const e of restartEvents.slice(0, 3)) {
      evIds.push(addEv("event", e.ts, `Event: ${e.message || e.type}`, e.id));
    }
    signals.push({
      kind: "CRASH_LOOP",
      firstSeen: restartEvents[0]?.ts ?? nowTs,
      detail_fa: `برنامه دچار چرخه‌ی ری‌استارت مکرر شده است (${totalRestarts} ری‌استارت ثبت شد).`,
      evidence: evIds,
    });
  }

  // 6. DEPLOY_REGRESSION
  const recentReleases = (data.releases ?? []).filter(
    (r) => r.state === "READY" && r.finishedAt
  );
  if (recentReleases.length > 0) {
    const latest = recentReleases[0];
    const finishedMs = Date.parse(latest.finishedAt!);
    const symptomMs = data.symptomStart ? Date.parse(data.symptomStart) : Date.now();
    const diffMs = symptomMs - finishedMs;
    if (diffMs >= 0 && diffMs <= thresholds.deployRegressionMs) {
      const evId = addEv(
        "release",
        latest.finishedAt!,
        `Latest release ${latest.id} completed ${Math.round(diffMs / 60000)}m before symptoms`,
        latest.id
      );
      signals.push({
        kind: "DEPLOY_REGRESSION",
        firstSeen: latest.finishedAt!,
        detail_fa: `شروع علائم بلافاصله پس از انتشار نسخه‌ی جدید (${latest.id}) اتفاق افتاده است.`,
        evidence: [evId],
      });
    }
  }

  // 7. PORT_MISMATCH
  const unhealthyRelease = (data.releases ?? []).find((r) => r.state === "UNHEALTHY");
  const portLog = (data.logs ?? []).find((l) => /listening on\s+(?:port\s+)?(\d+)/i.test(l.text));
  if (portLog) {
    const m = portLog.text.match(/listening on\s+(?:port\s+)?(\d+)/i);
    const listenedPort = m ? parseInt(m[1], 10) : null;
    const configuredPort = data.app?.port;
    if (listenedPort && configuredPort && listenedPort !== configuredPort) {
      const evIds = [
        addEv("log", portLog.ts, `App logged: "listening on ${listenedPort}"`, portLog.id),
      ];
      if (unhealthyRelease) {
        evIds.push(addEv("release", unhealthyRelease.createdAt, `Release state: UNHEALTHY`, unhealthyRelease.id));
      }
      signals.push({
        kind: "PORT_MISMATCH",
        firstSeen: portLog.ts,
        detail_fa: `ناهمخوانی پورت: برنامه روی پورت ${listenedPort} گوش می‌دهد اما پورت تنظیم‌شده در لیارا ${configuredPort} است.`,
        evidence: evIds,
      });
    }
  }

  // 8. MISSING_ENV
  const missingEnvLogs = (data.logs ?? []).filter((l) =>
    /Environment variable not found:\s*([A-Z0-9_]+)|KeyError:\s*['"]([A-Z0-9_]+)['"]|Missing required env\s*([A-Z0-9_]+)|process\.env\.([A-Z0-9_]+)\s+is undefined/i.test(l.text)
  );
  if (missingEnvLogs.length > 0) {
    const l = missingEnvLogs[0];
    const match = l.text.match(
      /Environment variable not found:\s*([A-Z0-9_]+)|KeyError:\s*['"]([A-Z0-9_]+)['"]|Missing required env\s*([A-Z0-9_]+)|process\.env\.([A-Z0-9_]+)/i
    );
    const varName = match ? (match[1] || match[2] || match[3] || match[4]) : "UNKNOWN_ENV";
    const appHasKey = (data.app?.envKeys ?? []).includes(varName);

    if (!appHasKey) {
      const evId = addEv("log", l.ts, `Missing env in log: ${l.text.slice(0, 140)}`, l.id);
      signals.push({
        kind: "MISSING_ENV",
        firstSeen: l.ts,
        detail_fa: `متغیر محیطی الزامی ${varName} در تنظیمات اپلیکیشن تعریف نشده است.`,
        evidence: [evId],
      });
    }
  }

  // 9. DB_UNREACHABLE
  const dbLogs = (data.logs ?? []).filter((l) =>
    /ECONNREFUSED|ETIMEDOUT|password authentication failed|too many connections|P1001|Can't reach database server/i.test(l.text)
  );
  if (dbLogs.length > 0 || (data.db && !data.db.reachable)) {
    const evIds: string[] = [];
    for (const l of dbLogs.slice(0, 2)) {
      evIds.push(addEv("log", l.ts, `Database connection error: ${l.text.slice(0, 120)}`, l.id));
    }
    if (data.db && !data.db.reachable) {
      evIds.push(addEv("metric", nowTs, `DB health check failed: ${data.db.detail ?? "Unreachable"}`, "db"));
    }
    signals.push({
      kind: "DB_UNREACHABLE",
      firstSeen: dbLogs[0]?.ts ?? nowTs,
      detail_fa: "عدم دسترسی به پایگاه‌داده یا شکست در برقراری اتصال شبکه.",
      evidence: evIds,
    });
  }

  // 10. UPSTREAM_SLOW
  const upstreamLogs = (data.logs ?? []).filter((l) =>
    /upstream.*timeout|gateway timeout|ETIMEDOUT.*api|slow response from/i.test(l.text)
  );
  const slowProbes = (data.probes ?? []).filter((p) => p.ms && p.ms > 4000);
  if (upstreamLogs.length > 0 || slowProbes.length >= 2) {
    const evIds: string[] = [];
    for (const l of upstreamLogs.slice(0, 2)) {
      evIds.push(addEv("log", l.ts, `Upstream delay: ${l.text.slice(0, 120)}`, l.id));
    }
    for (const p of slowProbes.slice(0, 2)) {
      evIds.push(addEv("probe", p.ts, `Probe response time high: ${p.ms}ms on ${p.path}`, p.id));
    }
    signals.push({
      kind: "UPSTREAM_SLOW",
      firstSeen: upstreamLogs[0]?.ts ?? slowProbes[0]?.ts ?? nowTs,
      detail_fa: "کندی ناشی از تأخیر یا تایم‌اوت سرویس‌های خارجی یا درگاه‌ها.",
      evidence: evIds,
    });
  }

  // 11. DISK_FULL
  const diskPct = data.disk?.usedPct ?? 0;
  const enospcLog = (data.logs ?? []).find((l) => /ENOSPC|no space left on device/i.test(l.text));
  if (diskPct >= 90 || enospcLog) {
    const evIds: string[] = [];
    if (enospcLog) evIds.push(addEv("log", enospcLog.ts, `Disk error: ${enospcLog.text.slice(0, 100)}`, enospcLog.id));
    if (diskPct >= 90) evIds.push(addEv("metric", nowTs, `Disk usage ${diskPct}%`, "disks"));
    signals.push({
      kind: "DISK_FULL",
      firstSeen: enospcLog?.ts ?? nowTs,
      detail_fa: `فضای دیسک پر شده است (${diskPct}% مصرف).`,
      evidence: evIds,
    });
  }

  // 12. APP_EXCEPTION
  if (data.logs && data.logs.length > 0) {
    const clusters = clusterErrors(data.logs);
    const frequent = clusters.filter((c) => c.count >= thresholds.frequentExceptionCount);
    if (frequent.length > 0) {
      const top = frequent[0];
      const evId = addEv(
        "log",
        top.firstTs,
        `Frequent exception: ${top.signature} (count: ${top.count})`,
        top.sampleIds[0] ?? "logs"
      );
      signals.push({
        kind: "APP_EXCEPTION",
        firstSeen: top.firstTs,
        detail_fa: `خطای پرتکرار در برنامه شناسایی شد: ${top.errorType} (${top.count} بار تکرار).`,
        evidence: [evId],
      });
    }
  }

  // 13. APP_STOPPED
  if (data.app && data.app.scale === 0) {
    const evId = addEv("applet", nowTs, "App scale is set to 0 (stopped)", "app");
    signals.push({
      kind: "APP_STOPPED",
      firstSeen: nowTs,
      detail_fa: "اپلیکیشن خاموش است (تعداد نمونه‌ها صفر است).",
      evidence: [evId],
    });
  }

  return { signals, evidence, missingEvidence };
}

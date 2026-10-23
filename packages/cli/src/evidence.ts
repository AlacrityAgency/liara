import type { CollectedEvidence } from "../../diagnostics/src/index";
import type { LiaraClient, LogLine, PlanSummary } from "../../liara-client/src/index";
import type { ActionResult } from "../../contracts/src/index";
import { clean } from "./render";

const RESTART_RE = /restart|crash|exit code|back-?off|OOMKilled/i;

type Settled<T> = PromiseSettledResult<ActionResult<T>>;

/** Data of a settled call, or undefined when it failed. A failed collector is missing evidence, never healthy. */
function dataOf<T>(result: Settled<T>): T | undefined {
  return result.status === "fulfilled" && result.value.ok ? result.value.data : undefined;
}

/** Lists come bare or wrapped as { key: [...] }. */
function unwrapList(value: unknown, key: string): Array<Record<string, unknown>> | undefined {
  if (Array.isArray(value)) return value as Array<Record<string, unknown>>;
  const wrapped = (value as Record<string, unknown> | undefined)?.[key];
  return Array.isArray(wrapped) ? (wrapped as Array<Record<string, unknown>>) : undefined;
}

/** Liara Reports body ({ result: [{ values: [[unixSeconds, value]] }] }) flattened into points. */
function reportPoints(body: unknown, scale: (v: number) => number): Array<{ ts: string; value: number }> | undefined {
  const series = (body as { result?: Array<{ values?: Array<[unknown, unknown]> }> } | undefined)?.result;
  if (!Array.isArray(series)) return undefined;
  const points: Array<{ ts: string; value: number }> = [];
  for (const s of series) {
    for (const [ts, value] of s.values ?? []) {
      const seconds = Number(ts);
      const amount = Number(value);
      if (Number.isFinite(seconds) && Number.isFinite(amount)) {
        points.push({ ts: new Date(seconds * 1000).toISOString(), value: scale(amount) });
      }
    }
  }
  return points.sort((a, b) => (a.ts < b.ts ? -1 : 1));
}

/**
 * Evidence for the diagnostic engine, from the live Liara API: app, applets, events, releases,
 * CPU and memory series, recent logs, and one probe of the site.
 */
export async function collectLiveEvidence(
  client: LiaraClient,
  name: string,
  windowStart: string,
  probe: { status: number; ts: string }
): Promise<CollectedEvidence> {
  const since = Math.floor(Date.parse(windowStart) / 1000);
  const settled = await Promise.allSettled([
    client.getApp(name),
    client.getApplets(name),
    client.getEvents(name),
    client.listReleases(name),
    client.getMetricsSeries(name, "memory", since),
    client.getMetricsSeries(name, "cpu", since),
    client.getLogs(name, since),
    client.getPlans(),
  ]) as [
    Settled<{ project: { port: number; envs: Array<{ key: string }>; scale: number; planID: string } }>,
    Settled<unknown>,
    Settled<unknown>,
    Settled<unknown>,
    Settled<unknown>,
    Settled<unknown>,
    Settled<LogLine[]>,
    Settled<PlanSummary[]>,
  ];
  const now = new Date().toISOString();
  const startMs = Date.parse(windowStart);
  const inWindow = (ts: string): boolean => Date.parse(ts) >= startMs;

  const project = dataOf(settled[0])?.project;
  const plans = dataOf(settled[7]) ?? [];
  const planRam = project ? plans.find((p) => p.planID === project.planID)?.ram : undefined;

  const rawEvents = unwrapList(dataOf(settled[2]), "events");
  const events = rawEvents
    ? rawEvents.map((e, i) => ({
        id: String(e._id ?? e.id ?? `lev_${i}`),
        ts: String(e.createdAt ?? e.timestamp ?? now),
        type: String(e.type ?? e.status ?? "event"),
        message: clean(String(e.message ?? e.reason ?? e.description ?? "")),
      }))
    : null;
  const restarts = events ? events.filter((e) => RESTART_RE.test(`${e.type} ${e.message}`)).length : 0;

  const rawApplets = unwrapList(dataOf(settled[1]), "applets");
  const applets = rawApplets
    ? rawApplets.map((a) => ({
        state: String(a.state ?? "unknown"),
        reason: a.reason ? clean(String(a.reason)) : undefined,
        restarts,
        release: (a.release as { releaseID?: string } | undefined)?.releaseID,
      }))
    : null;

  const rawReleases = unwrapList(dataOf(settled[3]), "releases");
  const releases = rawReleases
    ? rawReleases.map((r) => ({
        id: String(r._id ?? r.id ?? ""),
        state: String(r.state ?? "unknown"),
        createdAt: String(r.createdAt ?? now),
        finishedAt: r.finishedAt ? String(r.finishedAt) : undefined,
        message: r.failReason ? clean(String(r.failReason)) : undefined,
        source: "liara" as const,
      }))
    : null;

  const memory = reportPoints(dataOf(settled[4]), (v) => (v > 1e7 ? v / 1048576 : v));
  const cpu = reportPoints(dataOf(settled[5]), (v) => v);
  const logLines = dataOf(settled[6]);
  const logs = Array.isArray(logLines)
    ? logLines
        .map((l, i) => ({ id: `ll_${i}`, ts: String(l.datetime ?? now), text: clean(String(l.message ?? "")) }))
        .filter((l) => inWindow(l.ts))
    : null;

  return {
    app: project
      ? {
          name,
          port: Number(project.port) || 0,
          envKeys: (project.envs ?? []).map((e) => e.key),
          scale: Number(project.scale) || 0,
          memoryLimitMB: planRam !== undefined ? planRam * 1024 : null,
        }
      : null,
    applets,
    events,
    releases,
    memory: memory ? memory.map((p) => ({ ts: p.ts, mb: p.value })) : null,
    cpu: cpu ? cpu.map((p) => ({ ts: p.ts, pct: p.value })) : null,
    logs,
    probes: [
      { id: "probe_1", ts: probe.ts, path: "/", status: probe.status === 0 ? null : probe.status, ms: null },
    ],
    db: null,
    disk: null,
    window: { start: windowStart, end: now },
  };
}

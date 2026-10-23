"use strict";
// Evidence collection (WEB_CONTRACT: Evidence). Simulated mode reads the real child process; live mode reads
// the Liara API. A failed collector yields null, which the diagnostics treat as missing, never as healthy.

const fs = require("fs");
const { takeSnapshot } = require("../../../build/diagnostics/src/index.js");
const { DEMO_DIR, TARGET_NAME } = require("./core");

const RESTART_RE = /restart|crash|exit code|back-?off|OOMKilled/i;
// Startup lines that name a port; only the current process generation is evidence.
const LISTEN_RE = /listening (?:on|at)\s+(?:port\s+)?\d{2,5}/i;
// Periodic memory line printed by chaos-shop: "[mem] rss=54MB heap=5MB".
const MEM_LINE_RE = /^\[mem\] rss=(\d+)MB/;
let planCache = { at: 0, plans: null };

/** Keeps the points of one process generation: the one with the most points, ties go to the newer one. */
function mostPointsGeneration(points) {
  const byGen = new Map();
  for (const p of points) {
    if (p.gen === null) continue;
    if (!byGen.has(p.gen)) byGen.set(p.gen, []);
    byGen.get(p.gen).push(p);
  }
  let best = [];
  let bestGen = -1;
  for (const [gen, list] of byGen) {
    if (list.length > best.length || (list.length === best.length && gen > bestGen)) {
      best = list;
      bestGen = gen;
    }
  }
  return best;
}

/** Points of the newest process generation that has any. A restart starts a fresh CPU series. */
function newestGeneration(points) {
  let newest = null;
  for (const p of points) {
    if (p.gen !== null && (newest === null || p.gen > newest)) newest = p.gen;
  }
  return newest === null ? [] : points.filter((p) => p.gen === newest);
}

/** Live plan catalogue, cached for ten minutes. Null when the API call fails. */
async function livePlans(core) {
  if (planCache.plans && Date.now() - planCache.at < 600000) return planCache.plans;
  const r = await core.liara.getPlans();
  if (!r.ok) return null;
  planCache = { at: Date.now(), plans: r.data };
  return r.data;
}

function simulatedEvidence(core, windowStart) {
  const now = new Date().toISOString();
  const startMs = Date.parse(windowStart);
  const inWindow = (ts) => Date.parse(ts) >= startMs;
  const envs = core.app.appEnvs;
  const running = core.runtime.running;
  const restarting = !running && core.runtime.desired;
  const lastCrash = core.runtime.lastCrash;
  const runtime = core.runtime;
  const generationOf = (ts) => runtime.generationAt(ts);
  const currentRelease = core.releases[core.releases.length - 1];
  let disk = null;
  try {
    const st = fs.statfsSync(DEMO_DIR);
    disk = { usedPct: Math.round(((st.blocks - st.bfree) / st.blocks) * 100) };
  } catch {
    disk = null;
  }
  return {
    app: {
      name: TARGET_NAME,
      port: core.app.port,
      envKeys: Object.keys(envs).filter((k) => envs[k] !== undefined && envs[k] !== ""),
      // A crashed container that the platform is about to restart is still scaled to one.
      scale: running || restarting ? 1 : 0,
      memoryLimitMB: core.memoryLimitMB(),
      memoryLimitLabel_fa: core.app.appEnvs.CHAOS_MEM_LIMIT_MB ? "سقف کانتینر آزمایشی" : "سقف پلن",
    },
    applets: [{
      state: running ? "running" : core.app.deleted ? "deleted" : restarting ? "restarting" : "stopped",
      reason: lastCrash && inWindow(lastCrash.at) ? lastCrash.reason : undefined,
      restarts: core.runtime.crashes,
      release: currentRelease?.id,
    }],
    events: core.events.filter((e) => inWindow(e.ts)).map((e) => ({ id: e.id, ts: e.ts, type: e.type, message: e.message })),
    releases: core.releases.map((r) => ({
      id: r.id, state: r.state, createdAt: r.createdAt, finishedAt: r.finishedAt, envKeys: r.envKeys, message: r.message, source: "local",
    })),
    // RSS of one process: from /health probes and the [mem] log lines, whichever generation has most points.
    memory: mostPointsGeneration([
      ...core.probes
        .filter((p) => inWindow(p.ts) && p.path === "/health" && typeof p.rssMB === "number")
        .map((p) => ({ ts: p.ts, mb: p.rssMB, gen: generationOf(p.ts) })),
      ...core.logs
        .filter((l) => inWindow(l.ts) && MEM_LINE_RE.test(l.line))
        .map((l) => ({ ts: l.ts, mb: Number(l.line.match(MEM_LINE_RE)[1]), gen: generationOf(l.ts) })),
    ])
      .sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))
      .map((p) => ({ ts: p.ts, mb: p.mb })),
    cpu: newestGeneration(
      core.cpuSamples
        .filter((c) => inWindow(c.ts))
        .map((c) => ({ ts: c.ts, pct: c.pct, gen: generationOf(c.ts) }))
    ).map((c) => ({ ts: c.ts, pct: c.pct })),
    logs: core.logs
      .filter((l) => inWindow(l.ts) && (!LISTEN_RE.test(l.line) || l.gen === core.runtime.starts))
      .map((l) => ({ id: l.id, ts: l.ts, text: l.line })),
    probes: core.probes.filter((p) => inWindow(p.ts)).map((p) => ({ id: p.id, ts: p.ts, path: p.path, status: p.status, ms: p.ms })),
    db: null,
    disk,
    window: { start: windowStart, end: now },
  };
}

function unwrapList(value, key) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value[key])) return value[key];
  return null;
}

/** Flattens a Liara Reports body ({result:[{values:[[ts,value]], applet}]}) into points. */
function reportPoints(body, scale) {
  if (!body || !Array.isArray(body.result)) return null;
  const points = [];
  for (const series of body.result) {
    for (const pair of series.values || []) {
      const ts = Number(pair[0]);
      const value = Number(pair[1]);
      if (!Number.isFinite(ts) || !Number.isFinite(value)) continue;
      points.push({ ts: new Date(ts * 1000).toISOString(), value: scale(value) });
    }
  }
  return points.sort((a, b) => (a.ts < b.ts ? -1 : 1));
}

async function liveEvidence(core, windowStart) {
  const name = core.appName();
  const startMs = Date.parse(windowStart);
  const inWindow = (ts) => Date.parse(ts) >= startMs;
  const since = Math.floor(startMs / 1000);
  const settled = await Promise.allSettled([
    core.liara.getApp(name),
    core.liara.getApplets(name),
    core.liara.getEvents(name),
    core.liara.listReleases(name),
    core.liara.getMetricsSeries(name, "memory", since),
    core.liara.getMetricsSeries(name, "cpu", since),
    core.liara.getLogs(name, since),
    livePlans(core),
  ]);
  const pick = (i) => (settled[i].status === "fulfilled" && settled[i].value && settled[i].value.ok !== false
    ? (settled[i].value.data !== undefined ? settled[i].value.data : settled[i].value)
    : null);
  const now = new Date().toISOString();

  const project = pick(0)?.project ?? null;
  const plans = pick(7);
  const planRam = project && plans ? plans.find((p) => p.planID === project.planID)?.ram : undefined;
  const rawEvents = unwrapList(pick(2), "events");
  const events = rawEvents
    ? rawEvents.map((e, i) => ({
        id: String(e._id || e.id || `lev_${i}`),
        ts: String(e.createdAt || e.timestamp || e.date || now),
        type: String(e.type || e.status || "event"),
        message: core.redact(e.message || e.reason || e.description || ""),
      }))
    : null;
  const restarts = events ? events.filter((e) => RESTART_RE.test(`${e.type} ${e.message}`)).length : 0;
  const rawApplets = unwrapList(pick(1), "applets");
  const applets = rawApplets
    ? rawApplets.map((a) => ({
        state: String(a.state || "unknown"),
        reason: a.reason ? core.redact(a.reason) : undefined,
        restarts,
        release: a.release?.releaseID,
      }))
    : null;
  const rawReleases = unwrapList(pick(3), "releases");
  const releases = rawReleases
    ? rawReleases.map((r) => ({
        id: String(r._id || r.id || ""),
        state: String(r.state || "unknown"),
        createdAt: String(r.createdAt || now),
        finishedAt: r.finishedAt ? String(r.finishedAt) : undefined,
        message: r.failReason ? core.redact(r.failReason) : undefined,
        source: "liara",
      }))
    : null;
  const memPoints = reportPoints(pick(4), (v) => (v > 1e7 ? v / 1048576 : v));
  const cpuPoints = reportPoints(pick(5), (v) => v);
  const rawLogs = pick(6);
  const logs = Array.isArray(rawLogs)
    ? rawLogs
        .map((l, i) => ({ id: `ll_${i}`, ts: String(l.datetime || now), text: core.redact(l.message || "") }))
        .filter((l) => inWindow(l.ts))
    : null;

  return {
    app: project
      ? {
          name,
          port: Number(project.port) || 0,
          envKeys: (project.envs || []).map((e) => e.key),
          scale: Number(project.scale) || 0,
          memoryLimitMB: typeof planRam === "number" ? planRam : null,
        }
      : null,
    applets,
    events,
    releases,
    memory: memPoints ? memPoints.map((p) => ({ ts: p.ts, mb: p.value })) : null,
    cpu: cpuPoints ? cpuPoints.map((p) => ({ ts: p.ts, pct: p.value })) : null,
    logs,
    probes: core.probes.filter((p) => inWindow(p.ts)).map((p) => ({ id: p.id, ts: p.ts, path: p.path, status: p.status, ms: p.ms })),
    db: null,
    disk: null,
    window: { start: windowStart, end: now },
  };
}

/**
 * Probes the given paths now, then collects evidence for the window. The probe results become part of
 * the evidence, so a snapshot taken right after a probe sees it.
 */
async function collectEvidence(core, { windowStart, probePaths = [] }) {
  for (const p of probePaths) await core.probeNow(p);
  if (core.isLive()) return liveEvidence(core, windowStart);
  return simulatedEvidence(core, windowStart);
}

/** Snapshot of the system for before/after comparison (WHITEPAPER §8.6). */
async function snapshot(core, windowStart, probePaths) {
  const evidence = await collectEvidence(core, { windowStart, probePaths });
  return { evidence, snapshot: takeSnapshot(evidence, probePaths) };
}

module.exports = { collectEvidence, snapshot, livePlans };

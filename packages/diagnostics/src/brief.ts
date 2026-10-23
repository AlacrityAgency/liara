import type { FixBrief, Incident } from "@sokan/contracts";
import type { CollectedEvidence, DiagCriterion } from "./types";
import { clusterErrors, clusterFailureLines } from "./logparse";
import { STANDARD_RUNBOOKS } from "./runbooks";
import { failingPathsFromEvidence } from "./verifier";

export type Redactor = (text: string) => string;

const identity: Redactor = (t) => t;

/** The real tool the Coding Agent calls after the fix (round 3 item 5; was "sokan_deploy"). */
export const DEPLOY_TOOL = "deploy" as const;
const DEPLOY_BACK = DEPLOY_TOOL;

/** Frames and errors that point at noise rather than at the bug (EADDRINUSE is a deployment port clash). */
const NOISE_ERROR = /EADDRINUSE|EACCES: permission denied, listen/i;

/** Human-readable check for one criterion, used as acceptance tests for the Coding Agent. */
export function describeCriterion(c: DiagCriterion): { test: string; metric?: string } {
  switch (c.kind) {
    case "probe_not_5xx":
      return {
        test: `GET ${c.path} returns 2xx or 3xx${c.allow4xx ? " (4xx also accepted: the app answers)" : ""}`,
        metric: "probe.status",
      };
    case "probe_ok":
      return { test: `GET ${c.path} returns 2xx or 3xx`, metric: "probe.status" };
    case "probe_latency_below":
      return { test: `GET ${c.path} responds in under ${c.ms} ms`, metric: "probe.ms" };
    case "no_error_signature":
      return { test: `log line matching "${c.signature}" no longer appears`, metric: "errorSignatures" };
    case "error_rate_below":
      return { test: `error rate is below ${c.perMin} per minute`, metric: "errorRatePerMin" };
    case "mem_below_pct":
      return { test: `p95 memory stays below ${c.pct}% of the limit`, metric: "memP95Pct" };
    case "cpu_below_pct":
      return {
        test: `p95 CPU stays below ${c.pct}%${c.underLoad ? " while load is applied" : ""}`,
        metric: "cpuP95Pct",
      };
    case "disk_used_below":
      return { test: `disk usage stays below ${c.pct}%`, metric: "diskUsedPct" };
    case "applets_running":
      return { test: "at least one applet is running", metric: "appletsRunning" };
    case "restarts_stable":
      return { test: "no new container restarts after the change", metric: "restarts" };
    case "release_ready":
      return { test: "release state is READY", metric: "releaseState" };
  }
}

/**
 * Fix Brief for a Coding Agent (WHITEPAPER §9.2). Every excerpt goes through `redact` when given.
 */
export function createFixBrief(
  incident: Incident,
  evidenceData: CollectedEvidence,
  redact: Redactor = identity
): FixBrief {
  const top = incident.hypotheses[0];
  const rb = STANDARD_RUNBOOKS.find((r) => r.id === top?.runbookId);
  const logs = evidenceData.logs ?? [];
  const logById = new Map(logs.map((l) => [l.id, l.text]));
  // Stack-trace clusters point at code locations; repeated failure lines (no stack) are the evidence when there are none.
  const clusters = clusterErrors(logs);
  const errorClusters = clusters.length > 0 ? clusters : clusterFailureLines(logs);
  const failing = failingPathsFromEvidence(evidenceData);
  const path = failing[0] ?? "/";
  const failingProbe = (evidenceData.probes ?? []).find((p) => p.path === path && (p.status === null || p.status >= 400));

  // Suspected locations: user frames only (the parser already drops node_modules and internals), no noise.
  const suspected: FixBrief["suspected_locations"] = [];
  const seenLoc = new Set<string>();
  for (const c of clusters) {
    if (!c.frame || NOISE_ERROR.test(`${c.errorType} ${c.message}`)) continue;
    const key = `${c.frame.file}:${c.frame.line ?? ""}`;
    if (seenLoc.has(key)) continue;
    seenLoc.add(key);
    suspected.push({ file: c.frame.file, line: c.frame.line, frame: `${c.frame.file}:${c.frame.line ?? "?"}` });
    if (suspected.length >= 5) break;
  }

  // Evidence: top error clusters with redacted raw excerpts, then the evidence the hypothesis cites.
  const evidenceItems: FixBrief["evidence"] = [];
  for (const c of errorClusters.filter((x) => !NOISE_ERROR.test(x.message)).slice(0, 3)) {
    const raw = logById.get(c.sampleIds[0]) ?? "";
    evidenceItems.push({
      type: "log",
      ts: c.firstTs,
      text: redact(c.runtime === "generic"
        ? `${c.message} (${c.count} occurrences)`
        : `${c.errorType}: ${c.message} (${c.count} occurrences)`),
      id: c.sampleIds[0],
      kind: "log",
      excerpt: redact(raw.slice(0, 300)),
    });
  }
  const seenEv = new Set<string>();
  for (const id of top?.evidence_for ?? []) {
    if (seenEv.has(id)) continue;
    seenEv.add(id);
    const ev = incident.evidence.find((e) => e.id === id);
    if (!ev) continue;
    evidenceItems.push({
      type: "evidence",
      ts: ev.ts,
      text: redact(ev.summary),
      id: ev.id,
      kind: ev.type,
      excerpt: redact((logById.get(ev.raw_ref) ?? ev.summary).slice(0, 300)),
    });
    if (evidenceItems.length >= 8) break;
  }
  if (evidenceData.memory && evidenceData.memory.length > 0) {
    const last = evidenceData.memory[evidenceData.memory.length - 1];
    evidenceItems.push({ type: "metric", name: "memory.usage", value: `${last.mb}MB` });
  }

  // Acceptance tests: the success criteria of every remediation of the top hypothesis, deduplicated.
  const acceptance: NonNullable<FixBrief["acceptance"]> = [];
  const seenTest = new Set<string>();
  for (const rem of top?.remediations ?? []) {
    if (!rem.successCriteria) continue;
    const d = describeCriterion(rem.successCriteria);
    if (seenTest.has(d.test)) continue;
    seenTest.add(d.test);
    acceptance.push(d);
  }

  const host = evidenceData.app?.name ? `${evidenceData.app.name}.liara.run` : "<app-host>";
  const reproduction =
    `curl -i https://${host}${path}` +
    (failingProbe?.status ? `   # observed status ${failingProbe.status}` : "");

  const loc = suspected[0];
  const suggested =
    (rb?.suggested_change_fa ?? "بررسی کد، مدیریت خطاهای پیش‌بینی نشده یا بهینه‌سازی کوئری‌ها") +
    (loc ? ` محل مشکوک: ${loc.file}${loc.line ? `:${loc.line}` : ""}.` : "");

  const summary_fa = top
    ? `علت محتمل: ${top.title_fa} (اطمینان ${top.confidence === "high" ? "بالا" : top.confidence === "medium" ? "متوسط" : "پایین"}). ${top.explain_fa}` +
      (failing.length > 0 ? ` مسیر خراب: ${path}.` : "")
    : "علت مشخصی یافت نشد؛ داده‌ی بیشتری لازم است.";
  const summary_en = top
    ? `Probable cause: ${rb?.title_en ?? "unclassified error in the logs"} (confidence ${top.confidence}).` +
      (failing.length > 0 ? ` Failing path: ${path}.` : "")
    : "No probable cause found; more evidence is needed.";

  return {
    incident_id: incident.id,
    symptom: incident.symptom,
    hypothesis: top?.title_fa ?? "خطای ناشناخته در کد",
    confidence: top?.confidence ?? "low",
    evidence: evidenceItems,
    suspected_locations: suspected,
    suggested_change: suggested,
    verification: "پاسخ موفق ۲۰۰ در تست پروب و عدم وجود استثنا در ۶۰ ثانیه اول پس از دیپلوی",
    summary_fa,
    summary_en,
    probable_cause: { title: top?.title_fa ?? "نامشخص", confidence: top ? Math.round(top.score * 1000) / 1000 : 0 },
    reproduction,
    acceptance,
    deploy_back: DEPLOY_BACK,
  };
}

/** Markdown rendering for `.sokan/incidents/<id>.md`, so any Coding Agent can read the brief from the repo. */
export function fixBriefToMarkdown(brief: FixBrief): string {
  const out: string[] = [];
  out.push(`# Fix Brief: ${brief.incident_id}`, "");
  out.push(`**Symptom:** ${brief.symptom}`, "");
  out.push("## Summary", "", brief.summary_fa ?? brief.hypothesis, "");
  if (brief.summary_en) out.push(brief.summary_en, "");
  if (brief.probable_cause) {
    out.push("## Probable cause", "", `${brief.probable_cause.title} (score ${brief.probable_cause.confidence})`, "");
  }
  if (brief.evidence.length > 0) {
    out.push("## Evidence", "");
    for (const e of brief.evidence) {
      const label = [e.id, e.kind ?? e.type, e.ts].filter(Boolean).join(" | ");
      out.push(`- ${label}: ${e.text ?? `${e.name ?? ""} ${e.value ?? ""}`.trim()}`);
      if (e.excerpt) out.push("", "  ```", ...e.excerpt.split("\n").map((l) => `  ${l}`), "  ```", "");
    }
    out.push("");
  }
  if (brief.suspected_locations.length > 0) {
    out.push("## Suspected locations", "");
    for (const l of brief.suspected_locations) out.push(`- \`${l.frame ?? `${l.file}${l.line ? `:${l.line}` : ""}`}\``);
    out.push("");
  }
  if (brief.reproduction) out.push("## Reproduction", "", "```bash", brief.reproduction, "```", "");
  out.push("## Suggested change", "", brief.suggested_change, "");
  if (brief.acceptance && brief.acceptance.length > 0) {
    out.push("## Acceptance", "");
    for (const a of brief.acceptance) out.push(`- [ ] ${a.test}${a.metric ? ` (metric: ${a.metric})` : ""}`);
    out.push("");
  }
  out.push(
    "## Handoff",
    "",
    `After the fix, deploy with \`${brief.deploy_back ?? DEPLOY_TOOL}\` (L2, needs approval in the Sokan console), then rerun the acceptance checks.`,
    ""
  );
  return out.join("\n");
}

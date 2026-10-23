"use strict";
// SRE investigation: evidence -> diagnosis -> fix brief -> remediation cards from the top hypothesis.
// Cards hold exactly the masked parameters that will run; the executor later reads only the approved record.

const fs = require("fs");
const path = require("path");
const {
  DiagnosticEngine, failingPathsFromEvidence, fixBriefToMarkdown, isMitigationOnlyRemediation,
} = require("../../../build/diagnostics/src/index.js");
const { collectEvidence } = require("./evidence");
const { PLAN_LADDER, SIM_DEFAULT_ENVS, unique } = require("./core");

const WINDOW_MS = 30 * 60000;

function addApproval(turn, id) {
  if (id && !turn.approvals.includes(id)) turn.approvals.push(id);
}

function refs(ids) {
  return ids && ids.length ? ` شاهد: ${ids.join("، ")}` : "";
}

/** Builds the card and parameters for one remediation, or reports which values are still missing. */
async function buildProposal(core, incident, top, rem) {
  const app = core.appName();
  const signal = (kind) => incident.signals.find((s) => s.kind === kind);
  const evidenceIds = top.evidence_for.slice(0, 4);
  const why = (detail) => `${top.title_fa}.${detail ? ` ${detail}` : ""}${refs(evidenceIds)}`;
  const base = {
    title_fa: rem.label_fa,
    cost_fa: rem.cost_fa || "بدون هزینه",
    impact_fa: rem.impact_fa || "",
    rollback_fa: rem.rollback_fa || "",
    successCriteria_fa: rem.successCriteria_fa,
  };
  const meta = {
    incidentId: incident.id,
    remediationId: rem.id,
    criteria: rem.successCriteria ? [rem.successCriteria] : [],
    // The executor samples CPU while driving load when underLoad is set (EVALUATION R5), and reads
    // mitigationOnly to end such a remediation as "mitigated" instead of "resolved".
    underLoad: !!(rem.successCriteria && rem.successCriteria.underLoad),
    mitigationOnly: isMitigationOnlyRemediation(top.runbookId, rem.action),
    probePaths: failingPathsFromEvidence(core.lastEvidence || { probes: [], logs: [] }),
  };

  switch (rem.action) {
    case "app_update_envs": {
      const keys = unique(incident.signals.filter((s) => s.kind === "MISSING_ENV").map((s) => s.data?.variable))
        .filter((k) => typeof k === "string" && /^[A-Z_][A-Z0-9_]*$/.test(k));
      if (keys.length === 0) return null;
      const missing = [];
      const variables = [];
      for (const key of keys) {
        const value = core.pendingEnvs.has(key)
          ? core.pendingEnvs.get(key)
          : (core.isLive() ? undefined : SIM_DEFAULT_ENVS[key]);
        if (value === undefined) missing.push(key);
        else variables.push({ key, value });
      }
      if (missing.length > 0) return { missing };
      const params = { project: app, variables };
      const masked = core.maskParams(params).variables;
      const what = masked.map((v) => `تنظیم ${v.key} = ${v.value}`).join("؛ ");
      return {
        tool: "app_update_envs",
        params,
        meta,
        card: { ...base, what_fa: `${what} در اپ ${app}`, why_fa: why(signal("MISSING_ENV")?.detail_fa) },
      };
    }

    case "release_rollback": {
      let target = null;
      if (core.isLive()) {
        const r = await core.liara.listReleases(app);
        const list = r.ok ? (Array.isArray(r.data) ? r.data : r.data?.releases || []) : [];
        const ready = list.filter((x) => String(x.state).toUpperCase() === "READY");
        target = ready[1] ? { id: String(ready[1]._id || ready[1].id) } : null;
      } else {
        const ready = core.releases.filter((r) => r.state === "READY" && r.envSnapshot);
        target = ready.length >= 2 ? ready[ready.length - 2] : null;
      }
      if (!target) return null;
      const params = { project: app, releaseId: target.id };
      return {
        tool: "release_rollback",
        params,
        meta,
        card: { ...base, what_fa: `بازگشت اپ ${app} به ریلیز ${target.id}`, why_fa: why(incident.signals[0]?.detail_fa) },
      };
    }

    case "app_restart":
      return {
        tool: "app_restart",
        params: { project: app },
        meta,
        card: { ...base, what_fa: `ری‌استارت اپ ${app}`, why_fa: why(incident.signals[0]?.detail_fa) },
      };

    case "app_update_port": {
      const port = Number(rem.params.port);
      if (!Number.isInteger(port)) return null;
      return {
        tool: "app_update_port",
        params: { project: app, port },
        meta,
        card: { ...base, what_fa: `تغییر پورت اپ ${app} به ${port}`, why_fa: why(signal("PORT_MISMATCH")?.detail_fa) },
      };
    }

    case "app_scale":
      return {
        tool: "app_scale",
        params: { project: app, scale: 1 },
        meta,
        card: { ...base, what_fa: `راه‌اندازی اپ ${app} با یک نمونه`, why_fa: why(signal("APP_STOPPED")?.detail_fa) },
      };

    case "app_resize_plan": {
      if (core.isLive()) return null;
      const idx = PLAN_LADDER.findIndex((p) => p.planID === core.app.planID);
      const next = PLAN_LADDER[Math.min(PLAN_LADDER.length - 1, idx + 1)];
      if (!next || next.planID === core.app.planID) return null;
      return {
        tool: "app_resize_plan",
        params: { project: app, planID: next.planID },
        meta,
        card: { ...base, what_fa: `تغییر پلن ${app} از ${core.app.planID} به ${next.planID} (${next.ramMB} مگابایت)`, why_fa: why(signal("MEMORY_PRESSURE")?.detail_fa), cost_fa: "ممکن است هزینه‌ی ماهانه داشته باشد" },
      };
    }

    default:
      return null;
  }
}

/**
 * Full investigation. Creates pending cards for the top hypothesis' L2 remediations unless
 * proposeCards is false (used by the injection demo, which must create no approvals).
 */
async function investigate(core, turn, { symptom, proposeCards = true }) {
  if (!core.appName()) {
    return {
      status: "error",
      error: "APP_NAME_REQUIRED",
      next_fa: "برای تحلیل اپ زنده، نام اپ را در متغیر SOKAN_APP تنظیم کنید.",
    };
  }
  const windowStart = new Date(Date.now() - WINDOW_MS).toISOString();
  const first = await collectEvidence(core, { windowStart, probePaths: unique(["/health", ...core.state.watchPaths]) });
  let failing = failingPathsFromEvidence(first);
  let evidence = first;
  if (failing.some((p) => p !== "/health")) {
    evidence = await collectEvidence(core, { windowStart, probePaths: unique(["/health", ...failing]) });
    failing = failingPathsFromEvidence(evidence);
  }
  core.lastEvidence = evidence;

  const incident = DiagnosticEngine.diagnose(evidence, symptom);
  incident.id = core.randomId("inc");
  incident.trigger = "user";
  core.state.incident = core.clean(incident);
  core.emit("incident", core.state.incident);
  core.state.watchPaths = failing.filter((p) => p !== "/health").slice(0, 3);

  const brief = DiagnosticEngine.createFixBrief(incident, evidence, (t) => core.redact(t));
  core.state.fixBrief = core.clean(brief);
  try {
    const dir = path.join(core.stateDir, "incidents");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${incident.id}.md`), core.redact(fixBriefToMarkdown(brief)), "utf8");
  } catch {
    // the brief is still served from /api/incidents/current/fix-brief.md
  }

  const needs = [];
  const top = incident.hypotheses[0];
  const created = [];
  if (proposeCards && top && core.appName()) {
    for (const rem of top.remediations) {
      if (rem.riskLevel === "L0" || rem.action === "coding_agent_handoff") continue;
      const proposal = await buildProposal(core, core.state.incident, top, rem);
      if (!proposal) continue;
      if (proposal.missing) {
        needs.push({ tool: rem.action, keys: proposal.missing });
        continue;
      }
      const r = core.requestApproval(proposal.tool, proposal.params, proposal.card, proposal.meta);
      if (r.approval) {
        created.push(r.approval.id);
        addApproval(turn, r.approval.id);
      }
    }
  }

  const stored = core.state.incident;
  // Never leave "awaiting_approval" with no card to approve (EVALUATION R4).
  if (created.length === 0 && stored && stored.status === "awaiting_approval") {
    stored.status = "diagnosed";
    core.emit("incident", stored);
  }
  turn.incident = stored;
  turn.fixBrief = core.state.fixBrief;
  turn.needs = needs;

  const topView = top
    ? {
        id: top.id,
        title_fa: top.title_fa,
        confidence: top.confidence,
        score: top.score,
        evidence_for: top.evidence_for,
        remediations: top.remediations.map((r) => ({ tool: r.action, label_fa: r.label_fa, risk: r.riskLevel })),
      }
    : null;
  const data = {
    incident_id: incident.id,
    symptom: incident.symptom,
    window: incident.window,
    top_hypothesis: topView,
    hypotheses: incident.hypotheses.map((h) => ({ id: h.id, title_fa: h.title_fa, confidence: h.confidence })),
    rejected: incident.rejected,
    signals: incident.signals.map((s) => ({ kind: s.kind, detail_fa: s.detail_fa, evidence: s.evidence })),
    evidence: incident.evidence.map((e) => ({ id: e.id, type: e.type, ts: e.ts, summary: e.summary })),
    missing_evidence: incident.missingEvidence,
    flags: incident.flags.map((f) => ({ kind: "PROMPT_INJECTION", evidenceId: f.evidenceId, excerpt: f.excerpt })),
    approvals_created: created,
    needs_values: needs,
  };
  return { status: "ok", data: core.clean(data) };
}

module.exports = { investigate, addApproval };

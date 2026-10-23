"use strict";
// POST /api/chat: Orchestrator (LLM tool-calling, or the offline IntentRouter when no key is set).
// Replies come from packages/llm formatters; this file only adds the console extras (plans, incident, limits).

const { IntentRouter, isClarify, renderToolReply, withSimulatedNote } = require("../../../build/llm/src/index.js");
const { LIARA_LIMITS } = require("../../../build/liara-client/src/index.js");
const { makeToolRunner, newTurn, appContext } = require("./tools");

const MAX_MESSAGE = 2000;

async function handleChat(core, body) {
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return { status: 400, body: { ok: false, error: "EMPTY_MESSAGE", message_fa: "پیام خالی است." } };
  if (message.length > MAX_MESSAGE) return { status: 400, body: { ok: false, error: "MESSAGE_TOO_LONG", message_fa: "پیام بیش از حد طولانی است." } };

  const history = (Array.isArray(body.history) ? body.history : [])
    .filter((h) => h && (h.role === "user" || h.role === "assistant") && typeof h.content === "string")
    .slice(-10)
    .map((h) => ({ role: h.role, content: core.redact(h.content).slice(0, MAX_MESSAGE) }));

  const mode = core.mode();
  const turn = newTurn();
  const executeTool = makeToolRunner(core, turn);
  const apps = await appContext(core);

  // Offline deploy intent: show the plan cards first; the deploy card comes from POST /api/plans/select.
  if (!core.llm.isConfigured) {
    const route = IntentRouter.route(message, { apps: apps.apps });
    if (!isClarify(route) && route.tool === "deploy") {
      const plansResult = await executeTool("plans_recommend", {});
      const lines = [renderToolReply("plans_recommend", plansResult) || "پلن‌های پیشنهادی آماده نشد."];
      if (turn.plans) lines.push("یکی از پلن‌ها را انتخاب کنید.");
      return {
        status: 200,
        body: {
          reply_fa: core.redact(withSimulatedNote(lines.join("\n"), mode)),
          source: "offline",
          mode,
          approvals: [],
          plans: turn.plans || [],
        },
      };
    }
  }

  const result = await core.orchestrator.handle(message, {
    history,
    mode,
    executeTool,
    defaultApp: apps.defaultApp,
    apps: apps.apps,
  });

  const payload = {
    reply_fa: core.redact(result.reply_fa),
    source: result.source,
    mode,
    approvals: turn.approvals.map((id) => core.publicApproval(id)).filter(Boolean),
  };
  if (turn.plans) payload.plans = turn.plans;
  if (turn.incident) {
    payload.incident = core.state.incident;
    payload.fixBrief = core.state.fixBrief;
  }
  if (turn.limits) payload.limits = LIARA_LIMITS;
  if (result.clarify) payload.clarify = result.clarify;
  return { status: 200, body: payload };
}

module.exports = { handleChat };

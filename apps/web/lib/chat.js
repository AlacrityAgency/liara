"use strict";
// POST /api/chat: Orchestrator (LLM tool-calling, or the offline IntentRouter when no key is set).

const { IntentRouter, isClarify } = require("../../../build/llm/src/index.js");
const { LIARA_LIMITS } = require("../../../build/liara-client/src/index.js");
const { makeToolRunner, newTurn, CONFIDENCE_FA } = require("./tools");

const MAX_MESSAGE = 2000;

function composeOffline(core, turn) {
  const lines = [];
  if (turn.incident) {
    const top = turn.incident.hypotheses[0];
    if (top) {
      const refs = top.evidence_for.slice(0, 3).join("، ");
      lines.push(`تحلیل شواهد انجام شد. **${top.title_fa}** با اطمینان **${CONFIDENCE_FA[top.confidence] || top.confidence}** محتمل‌ترین علت است. ${top.explain_fa}${refs ? ` شاهد: ${refs}` : ""}`);
    } else {
      lines.push("تحلیل شواهد انجام شد، اما با داده‌های فعلی علت مشخصی پیدا نشد.");
    }
    if (turn.approvals.length > 0) lines.push("برای اجرای راهکار کارت تأیید ساخته شد؛ تا تأیید نکنید چیزی روی اپ تغییر نمی‌کند.");
    if (turn.needs.length > 0) {
      const keys = turn.needs.flatMap((n) => n.keys).join("، ");
      lines.push(`برای ساخت کارت تأیید، مقدار این متغیرها لازم است: ${keys}. آن‌ها را در فرم متغیرها وارد کنید.`);
    }
  }
  if (turn.plans) {
    lines.push("سه پلن پیشنهادی آماده است؛ یکی را انتخاب کنید.");
    if (turn.plans.some((p) => p.priceSource === "estimate")) lines.push("قیمت‌ها تخمینی است و از فهرست زنده‌ی لیارا خوانده نشده است.");
  }
  if (lines.length === 0) return null;
  if (core.mode() === "simulated") lines.push("(حالت شبیه‌سازی: هیچ تغییر واقعی روی لیارا اعمال نشده است.)");
  return lines.join("\n");
}

async function handleChat(core, body) {
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return { status: 400, body: { ok: false, error: "EMPTY_MESSAGE", message_fa: "پیام خالی است." } };
  if (message.length > MAX_MESSAGE) return { status: 400, body: { ok: false, error: "MESSAGE_TOO_LONG", message_fa: "پیام بیش از حد طولانی است." } };

  const history = (Array.isArray(body.history) ? body.history : [])
    .filter((h) => h && (h.role === "user" || h.role === "assistant") && typeof h.content === "string")
    .slice(-10)
    .map((h) => ({ role: h.role, content: core.redact(h.content).slice(0, MAX_MESSAGE) }));

  const turn = newTurn();
  const executeTool = makeToolRunner(core, turn);

  // Offline deploy intent: show the plan cards first; the deploy card comes from POST /api/plans/select.
  if (!core.llm.isConfigured) {
    const route = IntentRouter.route(message);
    if (!isClarify(route) && route.tool === "deploy") {
      await executeTool("plans_recommend", {});
      const composed = composeOffline(core, turn) || "سه پلن پیشنهادی آماده است؛ یکی را انتخاب کنید.";
      return {
        status: 200,
        body: {
          reply_fa: core.redact(composed),
          source: "offline",
          mode: core.mode(),
          approvals: [],
          plans: turn.plans || [],
        },
      };
    }
  }

  const result = await core.orchestrator.handle(message, { history, mode: core.mode(), executeTool });

  let reply = result.reply_fa;
  let clarify = null;
  if (result.source === "offline") {
    const route = IntentRouter.route(message);
    if (isClarify(route)) {
      clarify = { clarify_fa: route.clarify_fa, options: route.options.map((o) => ({ label_fa: o, message: o })) };
    }
    const composed = composeOffline(core, turn);
    if (composed) reply = composed;
  }

  const payload = {
    reply_fa: core.redact(reply),
    source: result.source,
    mode: core.mode(),
    approvals: turn.approvals.map((id) => core.publicApproval(id)).filter(Boolean),
  };
  if (turn.plans) payload.plans = turn.plans;
  if (turn.incident) {
    payload.incident = core.state.incident;
    payload.fixBrief = core.state.fixBrief;
  }
  if (turn.limits) payload.limits = LIARA_LIMITS;
  if (clarify) payload.clarify = clarify;
  return { status: 200, body: payload };
}

module.exports = { handleChat };

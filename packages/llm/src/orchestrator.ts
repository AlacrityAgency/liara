import { LlmClient, ChatMessage, OpenAiTool, LlmError } from "./client";
import { SYSTEM_PROMPT_FA, wrapUntrusted } from "./prompt";
import { IntentRouter, isClarify, normalizeFa } from "./router";
import {
  TOOL_SPECS,
  ToolSpec,
  RiskLevel,
  findTool,
  effectiveRisk,
  isApprovalRequired,
  validateToolArgs,
} from "./tools";

export type ExecuteTool = (name: string, args: Record<string, unknown>) => Promise<unknown>;

export interface HistoryItem {
  role: "user" | "assistant";
  content: string;
}

export interface HandleContext {
  history?: HistoryItem[];
  mode: "live" | "simulated";
  executeTool: ExecuteTool;
}

export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
}

export interface ApprovalRef {
  tool: string;
  risk: RiskLevel;
  approvalId: string;
  console_url?: string;
}

export interface HandleResult {
  reply_fa: string;
  toolCalls: ToolCallRecord[];
  approvals: ApprovalRef[];
  source: "llm" | "offline";
}

export interface OrchestratorOptions {
  maxSteps?: number;
  tools?: ToolSpec[];
}

const DEFAULT_MAX_STEPS = 5;
const MAX_HISTORY = 10;
const EVIDENCE_RE = /ev_\d+/g;
const CITATION_RE = /\[((?:ev_\d+)(?:\s*,\s*ev_\d+)*)\]/g;
// Completion claims that must never be made about L2/L3 actions that only have an approval request.
const COMPLETION_CLAIM_RE = /انجام شد|اجرا شد|اجرا کردم|انجام دادم|ریاستارت شد|ریستارت شد|حذف شد|ارتقا یافت|ارتقا پیدا کرد|برگشت داده شد|برگردانده شد|رولبک شد|رول بک شد|بسته شد/;
const FALLBACK_REPLY_FA = "پاسخ کاملی آماده نشد. لطفاً سؤالت را کوتاه‌تر یا دقیق‌تر بپرس.";

export class Orchestrator {
  private readonly maxSteps: number;
  private readonly tools: ToolSpec[];

  constructor(private readonly llm: LlmClient, options: OrchestratorOptions = {}) {
    this.maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
    this.tools = options.tools ?? TOOL_SPECS;
  }

  async handle(message: string, ctx: HandleContext): Promise<HandleResult> {
    if (!this.llm.isConfigured) return this.offline(message, ctx);
    const state: LoopState = { toolCalls: [], approvals: [], evidence: new Set<string>() };
    try {
      return await this.llmLoop(message, ctx, state);
    } catch (err) {
      // Never re-run tools after a partial LLM loop: report what already ran.
      if (state.toolCalls.length > 0) {
        return this.finalize("اطلاعات بالا از ابزارها گرفته شده، اما ادامه‌ی تحلیل با خطا مواجه شد.", ctx, state, "llm");
      }
      if (err instanceof LlmError) return this.offline(message, ctx);
      throw err;
    }
  }

  private async llmLoop(message: string, ctx: HandleContext, state: LoopState): Promise<HandleResult> {
    const tools: OpenAiTool[] = this.tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description_fa, parameters: t.parameters as unknown as Record<string, unknown> },
    }));
    const messages: ChatMessage[] = [
      { role: "system", content: `${SYSTEM_PROMPT_FA}\n\nحالت فعلی: ${ctx.mode === "simulated" ? "simulated (شبیه‌سازی)" : "live"}` },
      ...(ctx.history ?? [])
        .filter((h) => h.role === "user" || h.role === "assistant")
        .slice(-MAX_HISTORY)
        .map((h) => ({ role: h.role, content: h.content }) as ChatMessage),
      { role: "user", content: message },
    ];

    for (let step = 0; step < this.maxSteps; step++) {
      const resp = await this.llm.chat(messages, { tools });
      if (resp.toolCalls.length === 0) {
        return this.finalize(resp.content ?? "", ctx, state, "llm");
      }
      messages.push({ role: "assistant", content: resp.content, tool_calls: resp.toolCalls });
      for (const call of resp.toolCalls) {
        let args: Record<string, unknown> = {};
        let parseError = false;
        try {
          const parsed: unknown = JSON.parse(call.function.arguments || "{}");
          if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
          else parseError = true;
        } catch {
          parseError = true;
        }
        const result = parseError
          ? { status: "error", error: "INVALID_ARGUMENTS_JSON" }
          : await this.runTool(call.function.name, args, ctx, state);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: wrapUntrusted(`tool:${call.function.name}`, JSON.stringify(result)),
        });
      }
    }
    return this.finalize("", ctx, state, "llm");
  }

  // Single choke point for tool execution: validation, risk policy and approval bookkeeping.
  private async runTool(name: string, args: Record<string, unknown>, ctx: HandleContext, state: LoopState): Promise<unknown> {
    const spec = this.tools.find((t) => t.name === name) ?? findTool(name);
    if (!spec) {
      const result = { status: "error", error: "UNKNOWN_TOOL" };
      state.toolCalls.push({ name, args, result });
      return result;
    }
    const invalid = validateToolArgs(spec, args);
    if (invalid !== null) {
      const result = { status: "error", error: "INVALID_ARGUMENTS", missing_or_invalid: invalid };
      state.toolCalls.push({ name, args, result });
      return result;
    }

    const risk = effectiveRisk(spec, args);
    let raw: unknown;
    try {
      raw = await ctx.executeTool(name, args);
    } catch {
      raw = { status: "error", error: "EXECUTION_FAILED" };
    }
    state.toolCalls.push({ name, args, result: raw });
    for (const m of JSON.stringify(raw ?? null).match(EVIDENCE_RE) ?? []) state.evidence.add(m);

    if (risk === "L2" || risk === "L3") {
      // L2/L3 executors must return approval requests. Anything else is not trusted as execution.
      if (isApprovalRequired(raw)) {
        state.approvals.push({ tool: name, risk, approvalId: raw.approvalId, console_url: raw.console_url });
        return raw;
      }
      return { status: "error", error: "NOT_AN_APPROVAL_REQUEST", message_fa: "این ابزار فقط درخواست تأیید می‌سازد." };
    }
    return raw;
  }

  private finalize(text: string, ctx: HandleContext, state: LoopState, source: "llm" | "offline"): HandleResult {
    // Strip citations to evidence that no tool produced; keep the rest of the sentence.
    let reply = text.replace(CITATION_RE, (_whole, group: string) => {
      const ids = group.split(",").map((s) => s.trim());
      const kept = ids.filter((id) => state.evidence.has(id));
      return kept.length ? `[${kept.join("][")}]` : "";
    });
    reply = reply.replace(/\]\[/g, "] [");

    if (state.approvals.length > 0) {
      const note = approvalNote(state.approvals);
      const normalized = normalizeFa(reply);
      if (COMPLETION_CLAIM_RE.test(normalized)) {
        // The model claimed an action ran; replace its claim with the deterministic status.
        reply = note;
      } else if (!state.approvals.every((a) => reply.includes(a.approvalId))) {
        reply = `${reply.trim()}\n\n${note}`.trim();
      }
    }

    if (ctx.mode === "simulated" && !normalizeFa(reply).includes("شبیهسازی")) {
      reply = `${reply.trim()}\n(حالت شبیه‌سازی: هیچ تغییر واقعی روی لیارا اعمال نشده است.)`.trim();
    }
    if (reply.trim() === "") reply = FALLBACK_REPLY_FA;

    return { reply_fa: reply.trim(), toolCalls: state.toolCalls, approvals: state.approvals, source };
  }

  private async offline(message: string, ctx: HandleContext): Promise<HandleResult> {
    const state: LoopState = { toolCalls: [], approvals: [], evidence: new Set<string>() };
    const route = IntentRouter.route(message);
    if (isClarify(route)) {
      return {
        reply_fa: `${route.clarify_fa}\n${route.options.map((o) => `• ${o}`).join("\n")}`,
        toolCalls: [],
        approvals: [],
        source: "offline",
      };
    }
    const spec = this.tools.find((t) => t.name === route.tool);
    if (!spec) return { reply_fa: FALLBACK_REPLY_FA, toolCalls: [], approvals: [], source: "offline" };

    const invalid = validateToolArgs(spec, route.args);
    if (invalid !== null) {
      return {
        reply_fa: `برای «${spec.description_fa}» به اطلاعات بیشتری نیاز است (${invalid}). لطفاً بگو.`,
        toolCalls: [],
        approvals: [],
        source: "offline",
      };
    }

    await this.runTool(spec.name, route.args, ctx, state);
    const result = state.toolCalls[0]?.result;
    let reply: string;
    if (state.approvals.length > 0) {
      reply = approvalNote(state.approvals);
    } else {
      const failed = typeof result === "object" && result !== null && (result as { status?: unknown }).status === "error";
      reply = failed
        ? `اجرای «${spec.description_fa}» ناموفق بود.`
        : `${spec.description_fa}. (مدل زبانی فعال نیست؛ نتیجه‌ی ابزار در داده‌ها ثبت شد.)`;
    }
    return this.finalize(reply, ctx, state, "offline");
  }
}

interface LoopState {
  toolCalls: ToolCallRecord[];
  approvals: ApprovalRef[];
  evidence: Set<string>;
}

function approvalNote(approvals: ApprovalRef[]): string {
  return approvals
    .map((a) => {
      const link = a.console_url ? ` برای تأیید به کنسول بروید: ${a.console_url}` : "";
      return `درخواست تأیید ساخته شد (شناسه: ${a.approvalId}، ریسک ${a.risk}). این اقدام هنوز اجرا نشده است.${link}`;
    })
    .join("\n");
}

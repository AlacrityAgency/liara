import { LlmClient, ChatMessage, OpenAiTool } from "./client";
import { SYSTEM_PROMPT_FA, wrapUntrusted } from "./prompt";
import { IntentRouter, isClarify, normalizeFa } from "./router";
import { CHOOSE_FA, renderApprovalNote, renderToolReply, withSimulatedNote, withSummary } from "./render";
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
  /** The only manageable app, when there is exactly one. Filled into tools that need `app`. */
  defaultApp?: string;
  /** Every manageable app name. Used to ask which app when there is no default. */
  apps?: string[];
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
  title_fa?: string;
  what_fa?: string;
}

export interface ClarifyOption {
  label_fa: string;
  message: string;
}

export interface Clarify {
  clarify_fa: string;
  options: ClarifyOption[];
}

export interface HandleResult {
  reply_fa: string;
  toolCalls: ToolCallRecord[];
  approvals: ApprovalRef[];
  source: "llm" | "offline";
  clarify?: Clarify;
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
const NO_APP_FA = "نام اپ مشخص نیست؛ نام اپ را در متغیر SOKAN_APP تنظیم کنید.";

interface LoopState {
  toolCalls: ToolCallRecord[];
  approvals: ApprovalRef[];
  evidence: Set<string>;
}

const newState = (): LoopState => ({ toolCalls: [], approvals: [], evidence: new Set<string>() });

export class Orchestrator {
  private readonly maxSteps: number;
  private readonly tools: ToolSpec[];

  constructor(private readonly llm: LlmClient, options: OrchestratorOptions = {}) {
    this.maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
    this.tools = options.tools ?? TOOL_SPECS;
  }

  async handle(message: string, ctx: HandleContext): Promise<HandleResult> {
    if (!this.llm.isConfigured) return this.offline(message, ctx);
    const state = newState();
    try {
      return await this.llmLoop(message, ctx, state);
    } catch {
      // Any LLM failure (network, HTTP, timeout, bad body) ends in the same deterministic formatters:
      // results of tools that already ran are rendered as they are, and with no tool run the offline router answers.
      if (state.toolCalls.length === 0) return this.offline(message, ctx);
      const text = state.toolCalls.map((c) => renderToolReply(c.name, c.result)).filter((s): s is string => s !== null).join("\n\n");
      return this.finalize(text, ctx, state, "offline");
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
          // The model sees the same formatted result the user would see (summary_fa) plus the raw data, as untrusted data.
          content: wrapUntrusted(`tool:${call.function.name}`, JSON.stringify(withSummary(call.function.name, result))),
        });
      }
    }
    return this.finalize("", ctx, state, "llm");
  }

  // Single choke point for tool execution: defaults, validation, risk policy and approval bookkeeping.
  private async runTool(name: string, rawArgs: Record<string, unknown>, ctx: HandleContext, state: LoopState): Promise<unknown> {
    const spec = this.tools.find((t) => t.name === name) ?? findTool(name);
    if (!spec) {
      const result = { status: "error", error: "UNKNOWN_TOOL" };
      state.toolCalls.push({ name, args: rawArgs, result });
      return result;
    }
    const args = withAppDefault(spec, rawArgs, ctx);
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
        const card = raw as { title_fa?: unknown; what_fa?: unknown };
        state.approvals.push({
          tool: name,
          risk,
          approvalId: raw.approvalId,
          console_url: raw.console_url,
          title_fa: typeof card.title_fa === "string" ? card.title_fa : undefined,
          what_fa: typeof card.what_fa === "string" ? card.what_fa : undefined,
        });
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
      const note = approvalNotes(state.approvals);
      if (source === "llm" && COMPLETION_CLAIM_RE.test(normalizeFa(reply))) {
        // The model claimed an action ran; replace its claim with the deterministic status.
        reply = note;
      } else if (!state.approvals.every((a) => reply.includes(a.approvalId))) {
        reply = `${reply.trim()}\n${note}`.trim();
      }
    }

    reply = withSimulatedNote(reply, ctx.mode);
    if (reply === "") reply = FALLBACK_REPLY_FA;
    return { reply_fa: reply, toolCalls: state.toolCalls, approvals: state.approvals, source };
  }

  private async offline(message: string, ctx: HandleContext): Promise<HandleResult> {
    const state = newState();
    const route = IntentRouter.route(message, { apps: ctx.apps });
    if (isClarify(route)) {
      return {
        reply_fa: route.clarify_fa,
        toolCalls: [],
        approvals: [],
        source: "offline",
        clarify: { clarify_fa: CHOOSE_FA, options: route.options.map((o) => ({ label_fa: o, message: o })) },
      };
    }
    const spec = this.tools.find((t) => t.name === route.tool);
    if (!spec) return { reply_fa: FALLBACK_REPLY_FA, toolCalls: [], approvals: [], source: "offline" };

    const args = withAppDefault(spec, route.args, ctx);
    if (requiresApp(spec) && !args.app) {
      const apps = ctx.apps ?? [];
      if (apps.length > 1) {
        return {
          reply_fa: `برای «${spec.description_fa}» کدام اپ را می‌گویید؟`,
          toolCalls: [],
          approvals: [],
          source: "offline",
          clarify: { clarify_fa: CHOOSE_FA, options: apps.map((name) => ({ label_fa: name, message: `${message} ${name}` })) },
        };
      }
      return { reply_fa: NO_APP_FA, toolCalls: [], approvals: [], source: "offline" };
    }

    const invalid = validateToolArgs(spec, args);
    if (invalid !== null) {
      return { reply_fa: `برای «${spec.description_fa}» مقدار «${invalid}» لازم است. لطفاً بگو.`, toolCalls: [], approvals: [], source: "offline" };
    }

    await this.runTool(spec.name, args, ctx, state);
    const reply = renderToolReply(spec.name, state.toolCalls[0]?.result) ?? `${spec.description_fa}.`;
    return this.finalize(reply, ctx, state, "offline");
  }
}

function requiresApp(spec: ToolSpec): boolean {
  return (spec.parameters.required ?? []).includes("app");
}

/** Fills `app` from the single known app. An explicit app from the model or the user always wins. */
function withAppDefault(spec: ToolSpec, args: Record<string, unknown>, ctx: HandleContext): Record<string, unknown> {
  if (!requiresApp(spec) || !ctx.defaultApp) return args;
  if (args.app !== undefined && args.app !== "") return args;
  return { ...args, app: ctx.defaultApp };
}

function approvalNotes(approvals: ApprovalRef[]): string {
  return approvals
    .map((a) => renderApprovalNote({
      approvalId: a.approvalId,
      risk: a.risk,
      console_url: a.console_url,
      title_fa: a.title_fa,
      what_fa: a.what_fa,
    }))
    .join("\n");
}

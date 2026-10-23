// OpenAI-compatible chat completions client on the global fetch.
// The API key is read from env only and is never logged or echoed in errors.

export const DEFAULT_LLM_BASE_URL = "https://agentrouter.org/v1";
export const DEFAULT_LLM_MODEL = "gpt-4o-mini";
export const DEFAULT_LLM_TIMEOUT_MS = 30_000;

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface OpenAiTool {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export type ResponseFormat =
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: { name: string; schema: Record<string, unknown>; strict?: boolean } };

export interface ChatOptions {
  tools?: OpenAiTool[];
  tool_choice?: "auto" | "none" | "required";
  response_format?: ResponseFormat;
  temperature?: number;
}

export interface ChatResult {
  content: string | null;
  toolCalls: ToolCall[];
}

export type LlmErrorCode = "NOT_CONFIGURED" | "HTTP" | "TIMEOUT" | "NETWORK" | "BAD_RESPONSE";

export class LlmError extends Error {
  constructor(
    readonly code: LlmErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export interface LlmClientOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

export class LlmClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly modelName: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(options: LlmClientOptions = {}) {
    this.apiKey = (options.apiKey ?? "").trim();
    this.baseUrl = (options.baseUrl || DEFAULT_LLM_BASE_URL).replace(/\/+$/, "");
    this.modelName = options.model || DEFAULT_LLM_MODEL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env, fetchImpl?: FetchLike): LlmClient {
    return new LlmClient({
      apiKey: env.SOKAN_LLM_API_KEY,
      baseUrl: env.SOKAN_LLM_BASE_URL,
      model: env.SOKAN_LLM_MODEL,
      fetchImpl,
    });
  }

  get isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  get model(): string {
    return this.modelName;
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResult> {
    if (!this.isConfigured) throw new LlmError("NOT_CONFIGURED", "SOKAN_LLM_API_KEY is not set");

    const body: Record<string, unknown> = { model: this.modelName, messages };
    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools;
      body.tool_choice = options.tool_choice ?? "auto";
    }
    if (options.response_format) body.response_format = options.response_format;
    if (options.temperature !== undefined) body.temperature = options.temperature;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) throw new LlmError("TIMEOUT", `LLM request timed out after ${this.timeoutMs} ms`);
      throw new LlmError("NETWORK", "LLM request failed to reach the provider");
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      throw new LlmError("HTTP", `LLM provider responded with HTTP ${res.status}`, res.status);
    }

    let data: unknown;
    try {
      data = await res.json();
    } catch {
      throw new LlmError("BAD_RESPONSE", "LLM provider returned non-JSON body");
    }

    const message = (data as { choices?: { message?: Partial<{ content: string | null; tool_calls: ToolCall[] }> }[] })
      ?.choices?.[0]?.message;
    if (!message) throw new LlmError("BAD_RESPONSE", "LLM response has no choices[0].message");

    return {
      content: typeof message.content === "string" ? message.content : null,
      toolCalls: Array.isArray(message.tool_calls) ? message.tool_calls : [],
    };
  }
}

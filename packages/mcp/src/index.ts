// Stdio MCP server (newline-delimited JSON-RPC 2.0), no external dependencies.
// L2/L3 tools only ever produce approval requests; this server cannot approve anything.
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { TOOL_SPECS, ToolSpec, effectiveRisk, isApprovalRequired, validateToolArgs } from "../../llm/src/index";

export const LATEST_PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

// Tools that exist only for the coding agent (not in the web Orchestrator registry).
export const MCP_EXTRA_TOOLS: ToolSpec[] = [
  {
    name: "incident_get_fix_brief",
    risk: "L0",
    description_fa: "Fix Brief یک حادثه برای Coding Agent: شواهد redacted، مکان‌های مشکوک و معیار پذیرش",
    parameters: {
      type: "object",
      properties: { incident_id: { type: "string", description: "شناسه‌ی حادثه" } },
      required: ["incident_id"],
    },
  },
  {
    name: "approval_status",
    risk: "L0",
    description_fa: "وضعیت یک درخواست تأیید (در انتظار، تأییدشده، رد‌شده، منقضی یا اجراشده)",
    parameters: {
      type: "object",
      properties: { approvalId: { type: "string", description: "شناسه‌ی درخواست تأیید" } },
      required: ["approvalId"],
    },
  },
];

export const MCP_TOOL_SPECS: ToolSpec[] = [...TOOL_SPECS, ...MCP_EXTRA_TOOLS];

export type ExecuteTool = (name: string, args: Record<string, unknown>) => Promise<unknown>;

export interface McpServerOptions {
  tools: ToolSpec[];
  executeTool: ExecuteTool;
  name?: string;
  version?: string;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface McpServer {
  readonly tools: ToolSpec[];
  // Returns undefined for notifications (no response is sent).
  handleMessage(message: unknown): Promise<JsonRpcResponse | JsonRpcResponse[] | undefined>;
}

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

const SERVER_INSTRUCTIONS =
  "Sokan tools. L0 tools return data. L2/L3 tools only create an approval request in the Sokan console (approval_required + console_url); " +
  "the user must approve there. Never treat an approval request as executed; poll approval_status to follow it.";

export function createMcpServer(options: McpServerOptions): McpServer {
  const tools = options.tools;
  const byName = new Map(tools.map((t) => [t.name, t]));
  const serverName = options.name ?? "sokan";
  const serverVersion = options.version ?? "0.1.0";

  function ok(id: string | number | null, result: unknown): JsonRpcResponse {
    return { jsonrpc: "2.0", id, result };
  }
  function fail(id: string | number | null, code: number, message: string): JsonRpcResponse {
    return { jsonrpc: "2.0", id, error: { code, message } };
  }
  function toolText(payload: unknown, isError: boolean) {
    return { content: [{ type: "text", text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2) }], isError };
  }

  type CallOutcome =
    | { kind: "unknown_tool"; name: string }
    | { kind: "tool_error"; code: string }
    | { kind: "value"; value: unknown };

  async function callTool(name: string, rawArgs: unknown): Promise<CallOutcome> {
    const spec = byName.get(name);
    if (!spec) return { kind: "unknown_tool", name };
    const args = (rawArgs ?? {}) as Record<string, unknown>;
    if (typeof args !== "object" || Array.isArray(args)) return { kind: "tool_error", code: "INVALID_ARGUMENTS" };
    const invalid = validateToolArgs(spec, args);
    if (invalid !== null) return { kind: "tool_error", code: `INVALID_ARGUMENTS: ${invalid}` };

    const risk = effectiveRisk(spec, args);
    let raw: unknown;
    try {
      raw = await options.executeTool(name, args);
    } catch (err) {
      const code = (err as { code?: unknown })?.code;
      return { kind: "tool_error", code: typeof code === "string" && /^[A-Z0-9_]+$/.test(code) ? code : "EXECUTION_FAILED" };
    }
    if ((risk === "L2" || risk === "L3") && !isApprovalRequired(raw)) {
      return { kind: "tool_error", code: "NOT_AN_APPROVAL_REQUEST" };
    }
    return { kind: "value", value: raw };
  }

  async function handleOne(msg: unknown): Promise<JsonRpcResponse | undefined> {
    if (typeof msg !== "object" || msg === null || Array.isArray(msg)) {
      return fail(null, INVALID_REQUEST, "Invalid Request");
    }
    const req = msg as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
    const hasId = "id" in req && (typeof req.id === "string" || typeof req.id === "number" || req.id === null);
    const id = hasId ? (req.id as string | number | null) : null;

    if (typeof req.method !== "string") {
      // A response from the client (no method) is not for us; anything else is invalid.
      if ("result" in req || "error" in req) return undefined;
      return hasId ? fail(id, INVALID_REQUEST, "Invalid Request") : undefined;
    }
    const isNotification = !("id" in req);
    const params = (typeof req.params === "object" && req.params !== null ? req.params : {}) as Record<string, unknown>;

    switch (req.method) {
      case "initialize": {
        const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
        const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : LATEST_PROTOCOL_VERSION;
        return ok(id, {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: serverName, version: serverVersion },
          instructions: SERVER_INSTRUCTIONS,
        });
      }
      case "notifications/initialized":
      case "notifications/cancelled":
        return undefined;
      case "ping":
        return isNotification ? undefined : ok(id, {});
      case "tools/list":
        return ok(id, {
          tools: tools.map((t) => ({
            name: t.name,
            description: describe(t),
            inputSchema: t.parameters,
            annotations: { readOnlyHint: t.risk === "L0", destructiveHint: t.risk === "L3" },
          })),
        });
      case "tools/call": {
        if (typeof params.name !== "string") return fail(id, INVALID_PARAMS, "Missing tool name");
        const outcome = await callTool(params.name, params.arguments);
        if (outcome.kind === "unknown_tool") return fail(id, INVALID_PARAMS, `Unknown tool: ${outcome.name}`);
        if (outcome.kind === "tool_error") return ok(id, toolText(outcome.code, true));
        return ok(id, toolText(outcome.value, false));
      }
      default:
        return isNotification ? undefined : fail(id, METHOD_NOT_FOUND, `Method not found: ${req.method}`);
    }
  }

  return {
    tools,
    async handleMessage(message: unknown) {
      try {
        if (Array.isArray(message)) {
          const responses: JsonRpcResponse[] = [];
          for (const m of message) {
            const r = await handleOne(m);
            if (r) responses.push(r);
          }
          return responses.length > 0 ? responses : undefined;
        }
        return await handleOne(message);
      } catch {
        const id = typeof message === "object" && message !== null && "id" in message ? (message as { id: string | number | null }).id : null;
        return fail(id, INTERNAL_ERROR, "Internal error");
      }
    },
  };
}

function describe(spec: ToolSpec): string {
  const notes: string[] = [`[${spec.risk}] ${spec.description_fa}`];
  if (spec.risk === "L2" || spec.risk === "L3") {
    notes.push("Approval-only: this call creates an approval request in the Sokan console and does not execute. The user must approve it there.");
  }
  return notes.join(" | ");
}

export interface StdioStreams {
  input: Readable;
  output: Writable;
}

// Serves JSON-RPC over newline-delimited stdio. Resolves when the input ends.
export function runStdio(server: McpServer, streams: StdioStreams = { input: process.stdin, output: process.stdout }): Promise<void> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: streams.input, crlfDelay: Infinity });
    const write = (payload: unknown) => streams.output.write(`${JSON.stringify(payload)}\n`);
    let chain: Promise<void> = Promise.resolve();

    rl.on("line", (line) => {
      const text = line.trim();
      if (text === "") return;
      chain = chain.then(async () => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          write({ jsonrpc: "2.0", id: null, error: { code: PARSE_ERROR, message: "Parse error" } });
          return;
        }
        const response = await server.handleMessage(parsed);
        if (response !== undefined) write(response);
      });
    });
    rl.on("close", () => {
      void chain.then(() => resolve());
    });
  });
}

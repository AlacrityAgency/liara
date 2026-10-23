// Executor that forwards tool calls to the local Sokan console API.
// L2/L3 calls must come back as approval requests; anything else is rejected, so the
// coding agent can never approve or execute a risky action through this path.
import { ToolSpec, effectiveRisk, isApprovalRequired } from "../../llm/src/index";
import { MCP_TOOL_SPECS, ExecuteTool } from "./index";

export interface ConsoleExecutorOptions {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
  tools?: ToolSpec[];
}

export class ConsoleError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ConsoleError";
  }
}

const APPROVAL_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function createConsoleExecutor(options: ConsoleExecutorOptions): ExecuteTool {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? 30_000;
  const fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
  const tools = options.tools ?? MCP_TOOL_SPECS;

  async function request(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: {
          Accept: "application/json",
          "X-Sokan-Token": options.token,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      throw new ConsoleError("CONSOLE_UNREACHABLE");
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new ConsoleError(`CONSOLE_HTTP_${res.status}`);
    try {
      return await res.json();
    } catch {
      throw new ConsoleError("CONSOLE_BAD_RESPONSE");
    }
  }

  return async (name, args) => {
    if (name === "approval_status") {
      const approvalId = String(args.approvalId ?? "");
      if (!APPROVAL_ID_RE.test(approvalId)) throw new ConsoleError("INVALID_APPROVAL_ID");
      return request("GET", `/api/approvals/${encodeURIComponent(approvalId)}`);
    }

    const spec = tools.find((t) => t.name === name);
    if (!spec) throw new ConsoleError("UNKNOWN_TOOL");
    const body = await request("POST", `/api/tools/${encodeURIComponent(name)}`, { args, source: "mcp" });

    const risk = effectiveRisk(spec, args);
    if (risk === "L2" || risk === "L3") {
      if (!isApprovalRequired(body)) throw new ConsoleError("CONSOLE_DID_NOT_CREATE_APPROVAL");
      return {
        status: "approval_required",
        approvalId: body.approvalId,
        console_url: body.console_url ?? `${baseUrl}/?approval=${encodeURIComponent(body.approvalId)}`,
      };
    }
    return body;
  };
}

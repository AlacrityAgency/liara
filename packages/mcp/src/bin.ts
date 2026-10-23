#!/usr/bin/env node
// Entry point: `node build/mcp/src/bin.js` (or `sokan-mcp`). Speaks MCP over stdio.
// Credential: SOKAN_AGENT_TOKEN, the agent token the console prints at startup (also in .sokan/agent-token).
// It cannot approve or confirm anything (EVALUATION R1). SOKAN_CONSOLE_TOKEN is only a deprecated fallback.
import { createMcpServer, runStdio, MCP_TOOL_SPECS } from "./index";
import { createConsoleExecutor } from "./console";

const baseUrl = process.env.SOKAN_CONSOLE_URL || "http://127.0.0.1:4000";

let token = process.env.SOKAN_AGENT_TOKEN || "";
if (!token && process.env.SOKAN_CONSOLE_TOKEN) {
  token = process.env.SOKAN_CONSOLE_TOKEN;
  // stderr only: stdout is reserved for JSON-RPC.
  process.stderr.write(
    "sokan-mcp: WARNING: SOKAN_CONSOLE_TOKEN is used as a fallback. The console token can approve actions; " +
    "set SOKAN_AGENT_TOKEN to the agent token instead (printed at console startup, or in .sokan/agent-token).\n"
  );
}
if (!token) {
  process.stderr.write("sokan-mcp: SOKAN_AGENT_TOKEN is not set; console calls will be rejected.\n");
}

const server = createMcpServer({
  tools: MCP_TOOL_SPECS,
  executeTool: createConsoleExecutor({ baseUrl, token }),
});

runStdio(server).then(() => process.exit(0));

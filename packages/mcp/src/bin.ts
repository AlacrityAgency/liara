#!/usr/bin/env node
// Entry point: `node build/mcp/src/bin.js` (or `sokan-mcp`). Speaks MCP over stdio.
import { createMcpServer, runStdio, MCP_TOOL_SPECS } from "./index";
import { createConsoleExecutor } from "./console";

const baseUrl = process.env.SOKAN_CONSOLE_URL || "http://127.0.0.1:4000";
const token = process.env.SOKAN_CONSOLE_TOKEN || "";

if (!token) {
  // stderr only: stdout is reserved for JSON-RPC.
  process.stderr.write("sokan-mcp: SOKAN_CONSOLE_TOKEN is not set; console calls will be rejected.\n");
}

const server = createMcpServer({
  tools: MCP_TOOL_SPECS,
  executeTool: createConsoleExecutor({ baseUrl, token }),
});

runStdio(server).then(() => process.exit(0));

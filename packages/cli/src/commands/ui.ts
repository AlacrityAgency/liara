import { spawn } from "node:child_process";
import * as path from "node:path";
import type { Ctx } from "../context";
import { clean } from "../render";
import { readSavedToken } from "../store";

/** build/cli/src/commands -> repository root */
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

/** Starts the web console for this folder and forwards its output (it prints the URL line). */
export function runUi(ctx: Ctx): Promise<number> {
  const server = path.join(REPO_ROOT, "apps", "web", "server.js");
  const token = process.env.LIARA_API_TOKEN || readSavedToken() || "";
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [server], {
      cwd: ctx.dir,
      env: { ...process.env, SOKAN_PROJECT_DIR: ctx.dir, LIARA_API_TOKEN: token },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk: Buffer) => process.stdout.write(clean(chunk.toString("utf8"))));
    child.stderr.on("data", (chunk: Buffer) => process.stderr.write(clean(chunk.toString("utf8"))));
    const signals = ["SIGINT", "SIGTERM"] as const;
    const stop = (): void => {
      child.kill("SIGINT");
    };
    for (const signal of signals) process.on(signal, stop);
    child.on("exit", (code) => {
      for (const signal of signals) process.removeListener(signal, stop);
      resolve(code ?? 0);
    });
  });
}

/** Runs the MCP stdio server for Cursor and Claude Code (no approval power). */
export function runMcp(): Promise<number> {
  const bin = path.join(REPO_ROOT, "build", "mcp", "src", "bin.js");
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [bin], { stdio: "inherit", env: process.env });
    child.on("exit", (code) => resolve(code ?? 0));
  });
}

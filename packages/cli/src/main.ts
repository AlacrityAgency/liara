import * as path from "node:path";
import { runLogin, runLogout } from "./account";
import { CancelledError, CliError } from "./errors";
import type { Ctx, Options } from "./context";
import { runDeploy } from "./commands/deploy";
import { runDomain } from "./commands/domain";
import { runFix } from "./commands/fix";
import { runHelp } from "./commands/help";
import { runLogs } from "./commands/logs";
import { runStatus } from "./commands/status";
import { runMcp, runUi } from "./commands/ui";
import { Prompts } from "./prompts";
import { bad, say } from "./render";

const COMMANDS = ["deploy", "status", "logs", "fix", "domain", "login", "logout", "ui", "mcp", "help"] as const;
type Command = (typeof COMMANDS)[number];

interface Parsed {
  command: Command;
  positional: string[];
  options: Options;
  help: boolean;
}

const VALUE_FLAGS = new Set(["--dir", "--name", "--plan", "--app", "--env"]);

/** Hand-rolled parser: flags first or last, `--flag value` or `--flag=value`. */
export function parseArgs(argv: string[], cwd = process.cwd()): Parsed {
  const positional: string[] = [];
  const options: Options = { dir: cwd, env: {}, follow: false, check: false };
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--yes" || arg === "-y") {
      throw new CliError("گزینه‌ی --yes برای کارهایی که هزینه دارند وجود ندارد؛ هر بار خودت تأیید کن.");
    }
    if (arg === "-h" || arg === "--help") {
      help = true;
      continue;
    }
    if (arg === "-f" || arg === "--follow") {
      options.follow = true;
      continue;
    }
    if (arg === "--check") {
      options.check = true;
      continue;
    }
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const flag = eq > 0 ? arg.slice(0, eq) : arg;
      if (!VALUE_FLAGS.has(flag)) throw new CliError(`گزینه‌ی ناشناخته: ${flag}`);
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || value.startsWith("--")) throw new CliError(`مقدار ${flag} لازم است.`);
      if (flag === "--dir") options.dir = path.resolve(cwd, value);
      else if (flag === "--name") options.name = value.toLowerCase();
      else if (flag === "--plan") options.plan = value;
      else if (flag === "--app") options.app = value;
      else {
        const sep = value.indexOf("=");
        if (sep <= 0) throw new CliError("فرمت --env باید KEY=VALUE باشد.");
        options.env[value.slice(0, sep)] = value.slice(sep + 1);
      }
      continue;
    }
    positional.push(arg);
  }

  const [first, ...rest] = positional;
  if (first === undefined) return { command: "deploy", positional: rest, options, help };
  if (!(COMMANDS as readonly string[]).includes(first)) throw new CliError(`دستور ناشناخته: ${first}`);
  return { command: first as Command, positional: rest, options, help };
}

async function dispatch(parsed: Parsed, prompts: Prompts): Promise<number> {
  if (parsed.help) return runHelp();
  const ctx: Ctx = { prompts, dir: parsed.options.dir, options: parsed.options };
  switch (parsed.command) {
    case "deploy":
      return runDeploy(ctx);
    case "status":
      return runStatus(ctx);
    case "logs":
      return runLogs(ctx);
    case "fix":
      return runFix(ctx);
    case "domain":
      return runDomain(ctx, parsed.positional[0]);
    case "login":
      return runLogin(ctx);
    case "logout":
      return runLogout();
    case "ui":
      return runUi(ctx);
    case "mcp":
      return runMcp();
    case "help":
      return runHelp();
  }
}

/** Entry point. Exit codes: 0 done, 1 error, 2 cancelled. */
export async function run(argv: string[]): Promise<void> {
  const prompts = new Prompts();
  let code = 0;
  try {
    code = await dispatch(parseArgs(argv), prompts);
  } catch (err: unknown) {
    if (err instanceof CancelledError) {
      say("لغو شد؛ چیزی تغییر نکرد.");
      code = 2;
    } else if (err instanceof CliError) {
      bad(err.message);
      code = 1;
    } else {
      bad(`خطای غیرمنتظره: ${err instanceof Error ? err.message : String(err)}`);
      code = 1;
    }
  } finally {
    prompts.close();
  }
  process.exitCode = code;
}

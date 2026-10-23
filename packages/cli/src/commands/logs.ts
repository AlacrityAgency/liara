import type { LogLine } from "../../../liara-client/src/index";
import type { Ctx } from "../context";
import { ensureToken } from "../account";
import { humanError, makeClient } from "../liara";
import { fa, say } from "../render";
import { requireSite } from "../store";

const WINDOW_SECONDS = 30 * 60;
const FOLLOW_INTERVAL_MS = 3000;

const clock = (datetime: string | undefined): string => {
  const date = datetime ? new Date(datetime) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return fa(`${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`);
};

/** Logs of the last 30 minutes; with -f, polls every 3 seconds until Ctrl+C. */
export async function runLogs(ctx: Ctx): Promise<number> {
  const site = requireSite(ctx.dir);
  const token = await ensureToken(ctx.prompts);
  const client = makeClient(token);
  const seen = new Set<string>();

  const print = (lines: LogLine[]): void => {
    for (const line of lines) {
      const key = `${line.datetime ?? ""}\u0000${line.message ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      say(`${clock(line.datetime)}  ${line.message ?? ""}`.trimEnd());
    }
    if (seen.size > 5000) seen.clear();
  };

  const first = await client.getLogs(site.appName, Math.floor(Date.now() / 1000) - WINDOW_SECONDS);
  if (!first.ok) throw humanError(first.error);
  print(first.data ?? []);
  if (!ctx.options.follow) return 0;

  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, FOLLOW_INTERVAL_MS));
    const next = await client.getLogs(site.appName, Math.floor(Date.now() / 1000) - 60);
    if (!next.ok) throw humanError(next.error);
    print(next.data ?? []);
  }
}

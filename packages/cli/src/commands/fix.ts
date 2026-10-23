import type { ActionResult, Remediation } from "../../../contracts/src/index";
import { DiagnosticEngine, fixBriefToMarkdown } from "../../../diagnostics/src/index";
import type { LiaraClient, PlanSummary } from "../../../liara-client/src/index";
import { CancelledError } from "../errors";
import type { Ctx } from "../context";
import { ensureToken } from "../account";
import { collectLiveEvidence } from "../evidence";
import { humanError, makeClient, planCandidates, probeOnce, probeTarget, statusFa, waitForSite, isHealthy } from "../liara";
import { bad, clean, color, fa, good, say, toman } from "../render";
import { requireSite, writeFixBrief, type SiteState } from "../store";

const SYMPTOM = "سایتم مشکل داره";
const WINDOW_MS = 30 * 60_000;
/** Remediations this command can apply itself. Anything else is handed to a coding agent. */
const AUTO_TOOLS = new Set(["app_restart", "app_resize_plan", "app_update_port"]);

interface PlannedAction {
  summary: string;
  run: () => Promise<ActionResult<unknown>>;
}

async function planAction(client: LiaraClient, site: SiteState, action: Remediation): Promise<PlannedAction | undefined> {
  switch (action.action) {
    case "app_restart":
      return {
        summary: "سایت چند ثانیه ری‌استارت می‌شود؛ هزینه تغییر نمی‌کند.",
        run: () => client.restartApp(site.appName),
      };
    case "app_update_port": {
      const port = Number(action.params.port);
      if (!Number.isInteger(port) || port <= 0) return undefined;
      return {
        summary: `پورت برنامه به ${fa(port)} تغییر می‌کند.`,
        run: () => client.updatePort(site.appName, port),
      };
    }
    case "app_resize_plan": {
      const plansResult = await client.getPlans();
      if (!plansResult.ok) throw humanError(plansResult.error);
      const plans = plansResult.data ?? [];
      const current: PlanSummary | undefined = plans.find((p) => p.planID === site.planID);
      const currentRam = current?.ram ?? 0;
      const bigger = planCandidates(plans)
        .filter((p) => (p.ram ?? 0) > currentRam)
        .sort((a, b) => (a.ram ?? 0) - (b.ram ?? 0) || a.monthlyPrice - b.monthlyPrice)[0];
      if (!bigger) return undefined;
      const extra = bigger.monthlyPrice - (current?.monthlyPrice ?? 0);
      return {
        summary: `پلن به ${bigger.planID} می‌رود؛ ماهانه ${toman(Math.max(0, extra))} تومان بیشتر می‌شود.`,
        run: () => client.resizePlan(site.appName, bigger.planID),
      };
    }
    default:
      return undefined;
  }
}

/**
 * Collects live evidence, runs the diagnostic engine, shows one problem and one solution, applies
 * the solution after one confirmation, and compares the site before and after.
 */
export async function runFix(ctx: Ctx): Promise<number> {
  const site = requireSite(ctx.dir);
  const token = await ensureToken(ctx.prompts);
  const client = makeClient(token);
  const target = probeTarget(site.appName);

  const probeTs = new Date().toISOString();
  const before = await probeOnce(target);
  const evidence = await collectLiveEvidence(
    client,
    site.appName,
    new Date(Date.now() - WINDOW_MS).toISOString(),
    { status: before, ts: probeTs }
  );

  const incident = DiagnosticEngine.diagnose(evidence, SYMPTOM);
  const brief = DiagnosticEngine.createFixBrief(incident, evidence, (text) => clean(text));
  const briefPath = writeFixBrief(ctx.dir, fixBriefToMarkdown(brief));
  const handOff = `این فایل را به Cursor/Claude بده: ${briefPath}`;

  const top = incident.hypotheses[0];
  if (!top) {
    say("از روی داده‌های فعلی علت مشخصی پیدا نکردم.");
    say(handOff);
    return 0;
  }

  say(`مشکل: ${top.title_fa}`);
  const auto = top.remediations.find((r) => AUTO_TOOLS.has(r.action));
  if (!auto) {
    say(`راه‌حل: ${top.remediations[0]?.label_fa ?? "بررسی لاگ‌ها و اصلاح کد"}`);
    say(handOff);
    return 0;
  }

  say(`راه‌حل: ${auto.label_fa}`);
  const planned = await planAction(client, site, auto);
  if (!planned) {
    say("این راه‌حل را خودکار نمی‌توانم اعمال کنم.");
    say(handOff);
    return 0;
  }
  if (!(await ctx.prompts.confirm(`${planned.summary} ادامه بدهم؟`))) throw new CancelledError();

  const applied = await planned.run();
  if (!applied.ok) throw humanError(applied.error);
  say(color.dim("دستور اعمال شد؛ منتظر می‌مانم تا سایت بالا بیاید…"));

  const after = await waitForSite(target);
  say(`قبل: ${statusFa(before)}   بعد: ${statusFa(after)}`);
  if (isHealthy(after)) {
    good("درست شد ✅");
    return 0;
  }
  bad("هنوز درست نشده. فایل را به Cursor/Claude بده:");
  say(briefPath);
  return 1;
}


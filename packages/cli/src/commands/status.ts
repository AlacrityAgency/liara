import type { Ctx } from "../context";
import { ensureToken } from "../account";
import { makeClient, probeOnce, probeTarget, isHealthy, statusFa } from "../liara";
import { bad, good, say, toman } from "../render";
import { requireSite } from "../store";

export async function runStatus(ctx: Ctx): Promise<number> {
  const site = requireSite(ctx.dir);
  const token = await ensureToken(ctx.prompts);
  const client = makeClient(token);

  const [app, probe] = await Promise.all([client.getApp(site.appName), probeOnce(probeTarget(site.appName))]);
  say(`برنامه: ${site.appName}`);
  say(`آدرس: ${site.url}`);
  if (app.ok && app.data) {
    const project = app.data.project;
    say(`وضعیت لیارا: ${project.status || "نامشخص"}${project.isDeployed ? " · منتشر شده" : ""}`);
    say(`پلن: ${project.planID} · هزینه‌ی ماهانه: ${toman(project.monthlyPrice)} تومان`);
  } else {
    bad(`اطلاعات برنامه از لیارا گرفته نشد (${app.ok ? "" : app.error?.what_fa ?? ""}).`);
    if (site.monthlyTomans !== undefined) say(`آخرین هزینه‌ی ثبت‌شده: ${toman(site.monthlyTomans)} تومان در ماه`);
  }
  const line = `وضعیت سایت: ${statusFa(probe)}`;
  if (isHealthy(probe)) good(line);
  else bad(line);
  say(`آخرین انتشار: ${new Date(site.lastDeployAt).toLocaleString("fa-IR")}`);
  return 0;
}

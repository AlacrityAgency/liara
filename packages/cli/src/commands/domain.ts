import type { DnsRecord } from "../../../liara-client/src/index";
import { CancelledError, CliError } from "../errors";
import type { Ctx } from "../context";
import { ensureToken } from "../account";
import { humanError, makeClient } from "../liara";
import { fa, good, say } from "../render";
import { readSite } from "../store";

const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9-]+\.)+[a-z]{2,63}$/;
/** Second-level labels used under country codes, such as example.co.ir. */
const SLD = new Set(["co", "ac", "gov", "org", "net", "sch", "id", "ltd"]);

/** Nameservers from a zone payload: the first array of strings whose key names them. */
function nameServersOf(data: Record<string, unknown> | undefined): string[] {
  for (const [key, value] of Object.entries(data ?? {})) {
    if (/ns|nameserver|name_server/i.test(key) && Array.isArray(value) && value.every((v) => typeof v === "string")) {
      return value as string[];
    }
  }
  return [];
}

/** Host part (record name) and the label count of the apex domain. */
function splitDomain(domain: string): { host: string | undefined; apex: string } {
  const labels = domain.split(".");
  const apexLength = labels.length >= 3 && SLD.has(labels[labels.length - 2]) ? 3 : 2;
  if (labels.length <= apexLength) return { host: undefined, apex: domain };
  return { host: labels.slice(0, labels.length - apexLength).join("."), apex: labels.slice(-apexLength).join(".") };
}

export async function runDomain(ctx: Ctx, domainArg: string | undefined): Promise<number> {
  const domain = (domainArg ?? "").trim().toLowerCase();
  if (!DOMAIN_RE.test(domain)) throw new CliError("نام دامنه درست نیست؛ مثلاً: sokan domain example.ir");
  const token = await ensureToken(ctx.prompts);
  const client = makeClient(token);

  if (ctx.options.check) {
    const checked = await client.checkZone(domain);
    if (!checked.ok) throw humanError(checked.error);
    const app = readSite(ctx.dir)?.appName;
    if (!app) throw new CliError("ابتدا سایت را منتشر کن (sokan) تا دامنه به آن وصل شود.");
    if (!(await ctx.prompts.confirm(`دامنه ${domain} به ${app} وصل شود و گواهی SSL گرفته شود؟`))) throw new CancelledError();

    const added = await client.addDomain(domain, app);
    if (!added.ok && added.error?.code !== "CONFLICT") throw humanError(added.error);
    const target = (added.ok && added.data?.domain?.CNameRecord) || `${app}.liara.run`;
    good(`دامنه ${domain} به ${app} اضافه شد.`);

    const { host, apex } = splitDomain(domain);
    if (host) {
      const record: DnsRecord = { name: host, type: "CNAME", contents: [target] };
      const upserted = await client.upsertRecord(apex, record);
      if (!upserted.ok) throw humanError(upserted.error);
      good(`رکورد CNAME ${host} → ${target} ساخته شد.`);
    } else {
      say(`دامنه‌ی اصلی (${domain}) را به ${target} وصل کن؛ رکورد این نوع دامنه را در بخش DNS لیارا تنظیم کن.`);
    }

    const ssl = await client.provisionSsl(domain);
    if (!ssl.ok) throw humanError(ssl.error);
    good(`گواهی SSL درخواست شد؛ چند دقیقه بعد https://${domain} آماده است.`);
    return 0;
  }

  let zone = await client.createZone(domain);
  if (!zone.ok) {
    if (zone.error?.code !== "CONFLICT") throw humanError(zone.error);
    zone = await client.getZone(domain);
    if (!zone.ok) throw humanError(zone.error);
  }
  const nameservers = nameServersOf(zone.data?.data);

  const registrar = domain.endsWith(".ir") ? "ایرنیک (nic.ir)" : "پنل ثبت‌کننده‌ی دامنه";
  say(`دامنه ${domain} در DNS لیارا ثبت شد. حالا در ${registrar} این مراحل را انجام بده:`);
  say("  ۱. وارد حساب ثبت‌کننده‌ات شو و دامنه را انتخاب کن.");
  say("  ۲. بخش «تغییر سرورهای نام» (Nameserver) را باز کن.");
  if (nameservers.length > 0) {
    say("  ۳. این سرورهای نام را وارد کن:");
    nameservers.forEach((ns, i) => say(`       ${fa(i + 1)}. ${ns}`));
  } else {
    say("  ۳. سرورهای نام (NS) را در کنسول لیارا (بخش DNS) ببین و وارد کن.");
  }
  say("  ۴. ذخیره کن و چند دقیقه تا چند ساعت صبر کن؛ بعد بزن:");
  say(`       sokan domain ${domain} --check`);
  return 0;
}

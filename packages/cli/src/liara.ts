import type { HumanError } from "../../contracts/src/index";
import { LiaraClient, type PlanSummary } from "../../liara-client/src/index";
import { CliError } from "./errors";
import { fa, toman } from "./render";

export const TOKEN_PAGE = "https://console.liara.ir/API";
export const BILLING_PAGE = "https://console.liara.ir/settings/billing";

/** A client for the real API unless SOKAN_LIARA_BASE_URL points elsewhere (tests). */
export function makeClient(token: string): LiaraClient {
  return new LiaraClient({
    apiToken: token,
    isSimulated: false,
    baseUrl: process.env.SOKAN_LIARA_BASE_URL || undefined,
    dnsBaseUrl: process.env.SOKAN_DNS_BASE_URL || undefined,
  });
}

/** Turns a HumanError from the client into an error for the user (three short lines). */
export function humanError(error: HumanError | undefined): CliError {
  if (!error) return new CliError("ارتباط با لیارا انجام نشد.");
  return new CliError([error.what_fa, error.why_fa, error.next_fa].filter(Boolean).join("\n"));
}

export function siteUrl(appName: string): string {
  return `https://${appName}.liara.run`;
}

/** Where the health check looks. SOKAN_PROBE_URL_OVERRIDE replaces the public URL (tests). */
export function probeTarget(appName: string): string {
  return process.env.SOKAN_PROBE_URL_OVERRIDE || siteUrl(appName);
}

/** Status code of one GET, or 0 when no response came back. */
export async function probeOnce(url: string, timeoutMs = 8000): Promise<number> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    await res.arrayBuffer().catch(() => undefined);
    return res.status;
  } catch {
    return 0;
  } finally {
    clearTimeout(timer);
  }
}

export const isHealthy = (status: number): boolean => status >= 200 && status < 300;

/** Probes until the site answers 2xx or the budget runs out. Returns the last status. */
export async function waitForSite(url: string, timeoutMs = 90_000, intervalMs = 3_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await probeOnce(url);
    if (isHealthy(status) || Date.now() + intervalMs > deadline) return status;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export function statusFa(status: number): string {
  if (status === 0) return "بدون پاسخ";
  if (isHealthy(status)) return `${fa(status)} (سالم)`;
  return `خطای ${fa(status)}`;
}

/**
 * Sanitizes a name for Liara: lowercase a-z, 0-9 and dashes, 3 to 32 characters.
 */
export function sanitizeAppName(raw: string): string {
  let name = raw.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (name.length < 3) name = `${name}-app`.replace(/^-+|-+$/g, "");
  name = name.slice(0, 32).replace(/-+$/g, "");
  return name.length >= 3 ? name : "sokan-site";
}

export function isValidAppName(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(name);
}

export interface BundleChoice {
  bundlePlanID?: string;
  priceTomans: number;
}

/**
 * The cheapest available feature bundle for a plan. The free plan only takes the "free" bundle.
 * `projectBundlePlans` is keyed by planID, then by bundle ID (see knowledge/sources/cli create.ts).
 */
export function cheapestBundle(projectBundlePlans: unknown, planID: string): BundleChoice {
  const group = (projectBundlePlans as Record<string, Record<string, { available?: unknown; displayPrice?: unknown }>> | undefined)?.[planID] ?? {};
  const candidates = Object.entries(group)
    .filter(([key, bundle]) => !!bundle?.available && (planID !== "free" || key === "free"))
    .map(([key, bundle]) => ({ key, price: Number(bundle.displayPrice) || 0 }))
    .sort((a, b) => a.price - b.price);
  const best = candidates[0];
  return best ? { bundlePlanID: best.key, priceTomans: best.price } : { priceTomans: 0 };
}

/** Plans a new app can use: available Iranian free and g2 plans, cheapest first. */
export function planCandidates(plans: PlanSummary[]): PlanSummary[] {
  const preferred = plans
    .filter((p) => p.available && (p.planID === "free" || p.planID.includes("g2")) && (!p.region || p.region === "iran"))
    .sort((a, b) => a.monthlyPrice - b.monthlyPrice);
  if (preferred.length > 0) return preferred;
  return plans.filter((p) => p.available).sort((a, b) => a.monthlyPrice - b.monthlyPrice);
}

/** Up to three options (cheapest, middle, largest) and the index of the recommended one. */
export function threePlanOptions(candidates: PlanSummary[]): { options: PlanSummary[]; recommended: number } {
  const options =
    candidates.length <= 3
      ? candidates
      : [candidates[0], candidates[Math.floor((candidates.length - 1) / 2)], candidates[candidates.length - 1]];
  // PlanSummary.ram is in MB; recommend the first plan with at least 1 GB.
  const found = options.findIndex((p) => p.planID !== "free" && (p.ram ?? 0) >= 1024);
  return { options, recommended: found >= 0 ? found : Math.min(1, options.length - 1) };
}

export function planLabel(plan: PlanSummary): string {
  if (plan.planID === "free") return "رایگان (محدود)";
  const ram =
    plan.ram === undefined ? "" : plan.ram >= 1024 ? `${fa(plan.ram / 1024)} گیگ رم` : `${fa(plan.ram)} مگ رم`;
  const cpu = plan.cpu !== undefined ? `${fa(plan.cpu)} هسته` : "";
  return [ram, cpu].filter(Boolean).join("، ") || plan.planID;
}

export function formatToman(amount: number): string {
  return `${toman(amount)} تومان`;
}

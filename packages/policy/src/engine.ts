import * as crypto from "crypto";
import type { PolicyConfig, RiskLevel } from "@sokan/contracts";

/**
 * Risk tiers per tool — WHITEPAPER §6.2 tables and Appendix A.
 * Unknown tools default to L2 (fail closed: they need an approval).
 */
export const TOOL_RISK: Readonly<Record<string, RiskLevel>> = Object.freeze({
  // L0 — observe
  account_get: "L0", billing_get_balance: "L0", account_free_credit: "L0",
  plans_recommend: "L0", project_analyze: "L0",
  app_list: "L0", app_get: "L0",
  release_build_logs: "L0", release_get: "L0", release_list: "L0",
  logs_get: "L0", logs_search_errors: "L0", events_get: "L0", applets_get: "L0",
  metrics_summary: "L0", metrics_series: "L0", disks_list: "L0", http_probe: "L0",
  sre_investigate: "L0", sre_verify: "L0", incident_get_fix_brief: "L0",
  domain_list: "L0", domain_check: "L0", dns_zone_check_ns: "L0",
  db_list: "L0", db_get: "L0", db_metrics: "L0", approval_status: "L0",
  // L1 — safe, reversible
  source_upload: "L1", release_cancel: "L1", app_set_zero_downtime: "L1",
  domain_add: "L1", domain_enable_ssl: "L1", dns_zone_create: "L1", db_backup_create: "L1",
  // L2 — cost / restart / behaviour change
  app_create: "L2", app_restart: "L2", app_resize_plan: "L2", app_update_envs: "L2",
  app_update_port: "L2", deploy: "L2", release_create: "L2", release_rollback: "L2",
  dns_record_upsert: "L2", domain_set_redirect: "L2", db_resize: "L2", shell_exec_readonly: "L2",
  app_scale: "L2", // scale 0 is promoted to L3 in riskOf()
  // L3 — destructive / full outage
  app_delete: "L3", domain_delete: "L3",
});

/** Deterministic risk classification, including parameter-dependent tiers. */
export function riskOf(tool: string, params: Record<string, unknown> = {}): RiskLevel {
  if (tool === "app_scale" && Number(params["scale"]) === 0) return "L3"; // turning the app off (§6.2)
  return TOOL_RISK[tool] ?? "L2";
}

/** Canonical JSON: object keys sorted recursively, so key order never changes the hash. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

/** hash = sha256(tool + canonical(params)) — §7.2 */
export function paramsHash(tool: string, params: Record<string, unknown>): string {
  return crypto.createHash("sha256").update(`${tool}:${canonicalJson(params)}`).digest("hex");
}

/**
 * Standing approvals — §7.3. A rule applies only when:
 *  - the action is L2 (never L3, never cost changes listed in `never`),
 *  - a deterministic system trigger with exactly the rule's `when` id is asserted (the LLM cannot assert triggers),
 *  - the hourly / daily caps have not been reached.
 */
export class StandingApprovals {
  private readonly uses = new Map<string, number[]>();
  constructor(private readonly config?: PolicyConfig, private readonly now: () => number = Date.now) {}

  allows(tool: string, risk: RiskLevel, systemTriggers: readonly string[]): boolean {
    if (!this.config?.standingApprovals || risk !== "L2") return false;
    if (this.config.never?.includes(tool)) return false;
    const rule = this.config.standingApprovals.find((r) => r.action === tool && systemTriggers.includes(r.when));
    if (!rule) return false;
    const t = this.now();
    const history = (this.uses.get(tool) ?? []).filter((x) => t - x < 86_400_000);
    const lastHour = history.filter((x) => t - x < 3_600_000).length;
    if (rule.maxPerHour !== undefined && lastHour >= rule.maxPerHour) return false;
    if (rule.maxPerDay !== undefined && history.length >= rule.maxPerDay) return false;
    history.push(t);
    this.uses.set(tool, history);
    return true;
  }
}

import * as crypto from "crypto";
import * as fs from "fs";
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

/** WHITEPAPER §7.3: a standing approval never covers an action that changes cost. Enforced regardless of config. */
export const COST_BEARING_TOOLS: readonly string[] = Object.freeze([
  "app_create", "app_resize_plan", "db_resize", "app_scale",
]);

export const DEFAULT_POLICY_PATH = ".sokan/policy.json";

/**
 * Validates a plain config object (parsed JSON) into a PolicyConfig.
 * Accepts `tool` (whitepaper §7.3 wording) or `action` for each rule. Throws on anything that could
 * widen authority: L0/L1/L3 or cost-bearing tools as standing targets, or a missing trigger.
 */
export function normalizePolicyConfig(raw: unknown): PolicyConfig {
  const fail = (msg: string): never => { throw new Error(`POLICY_INVALID: ${msg}`); };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("root must be an object");
  const obj = raw as Record<string, unknown>;
  if (typeof obj["app"] !== "string" || obj["app"].length === 0) fail("app must be a non-empty string");

  const never = obj["never"];
  if (never !== undefined && (!Array.isArray(never) || never.some((x) => typeof x !== "string"))) {
    fail("never must be an array of tool names");
  }

  const rulesRaw = obj["standingApprovals"];
  let standingApprovals: PolicyConfig["standingApprovals"];
  if (rulesRaw !== undefined) {
    if (!Array.isArray(rulesRaw)) fail("standingApprovals must be an array");
    standingApprovals = (rulesRaw as unknown[]).map((rule, i) => {
      if (!rule || typeof rule !== "object") fail(`standingApprovals[${i}] must be an object`);
      const r = rule as Record<string, unknown>;
      const tool = r["tool"] ?? r["action"];
      if (typeof tool !== "string" || tool.length === 0) fail(`standingApprovals[${i}].tool must be a string`);
      const toolName = tool as string;
      if (typeof r["when"] !== "string" || (r["when"] as string).length === 0) {
        fail(`standingApprovals[${i}].when must name a system trigger`);
      }
      const risk = riskOf(toolName, {});
      if (risk !== "L2") fail(`${toolName} is ${risk}; standing approvals are only for L2 actions`);
      if (COST_BEARING_TOOLS.includes(toolName)) fail(`${toolName} is cost-bearing and cannot be a standing approval`);
      const cap = (name: string): number | undefined => {
        const v = r[name];
        if (v === undefined) return undefined;
        if (typeof v !== "number" || !Number.isInteger(v) || v < 1) fail(`standingApprovals[${i}].${name} must be a positive integer`);
        return v as number;
      };
      const rule2: NonNullable<PolicyConfig["standingApprovals"]>[number] = {
        action: toolName,
        when: r["when"] as string,
      };
      const maxPerHour = cap("maxPerHour");
      const maxPerDay = cap("maxPerDay");
      if (maxPerHour !== undefined) rule2.maxPerHour = maxPerHour;
      if (maxPerDay !== undefined) rule2.maxPerDay = maxPerDay;
      return rule2;
    });
  }

  return {
    app: obj["app"] as string,
    ...(standingApprovals ? { standingApprovals } : {}),
    ...(never ? { never: [...(never as string[])] } : {}),
  };
}

/**
 * Reads a policy file (JSON; no YAML dependency). Returns undefined when the file does not exist,
 * which means no standing approvals. Invalid content throws rather than being partly applied.
 */
export function loadPolicyConfig(filePath: string = DEFAULT_POLICY_PATH): PolicyConfig | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    throw new Error(`POLICY_INVALID: ${filePath} is not valid JSON (${(err as Error).message})`);
  }
  return normalizePolicyConfig(raw);
}

/**
 * Standing approvals — §7.3. A rule applies only when:
 *  - the action is L2 (never L3, never cost-bearing, never a tool listed in `never`),
 *  - a deterministic system trigger with exactly the rule's `when` id is asserted (the LLM cannot assert triggers),
 *  - the hourly / daily caps have not been reached.
 */
export class StandingApprovals {
  private readonly uses = new Map<string, number[]>();
  constructor(private readonly config?: PolicyConfig, private readonly now: () => number = Date.now) {}

  allows(tool: string, risk: RiskLevel, systemTriggers: readonly string[]): boolean {
    if (!this.config?.standingApprovals || risk !== "L2") return false;
    if (COST_BEARING_TOOLS.includes(tool)) return false;
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

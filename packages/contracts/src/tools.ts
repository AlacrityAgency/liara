import type { RiskLevel } from "./security";

/** Tool names from WHITEPAPER §6.2 and Appendix A. */
export type ToolName =
  | "account_get" | "billing_get_balance" | "account_free_credit"
  | "plans_recommend" | "project_analyze"
  | "app_list" | "app_get" | "app_create" | "app_restart" | "app_scale" | "app_resize_plan"
  | "app_update_envs" | "app_update_port" | "app_set_zero_downtime" | "app_delete"
  | "deploy" | "source_upload" | "release_create" | "release_build_logs" | "release_get"
  | "release_cancel" | "release_list" | "release_rollback"
  | "logs_get" | "logs_search_errors" | "events_get" | "applets_get"
  | "metrics_summary" | "metrics_series" | "disks_list" | "http_probe" | "shell_exec_readonly"
  | "sre_investigate" | "sre_verify" | "incident_get_fix_brief"
  | "domain_list" | "domain_add" | "domain_check" | "domain_enable_ssl" | "domain_set_redirect" | "domain_delete"
  | "dns_zone_create" | "dns_zone_check_ns" | "dns_record_upsert"
  | "db_list" | "db_get" | "db_metrics" | "db_backup_create" | "db_resize"
  | "approval_status";

/** Release states, §6.2 (from CLI build-logs). */
export type ReleaseState =
  | "BUILDING" | "PUSHING" | "DEPLOYING" | "READY"
  | "FAILED" | "UNHEALTHY" | "TIMEDOUT" | "CANCELED";

export interface ToolSpec {
  name: ToolName;
  riskLevel: RiskLevel;
  source: "OAS" | "CLI" | "OAS+CLI" | "internal" | "composite";
  method?: string;
  path?: string;
}

/** §12.1 rule 5: every error says what happened, why, and what to do now. */
export interface HumanError {
  code: string;
  what_fa: string;
  why_fa: string;
  next_fa: string;
}

export interface ActionResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: HumanError;
  pendingApprovalId?: string;
}

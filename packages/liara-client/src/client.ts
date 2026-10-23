import * as fs from "node:fs";
import * as path from "node:path";
import type { ActionResult, HumanError } from "@sokan/contracts";
import {
  buildCanceledError,
  buildFailedError,
  buildTimeoutError,
  deployTimeoutError,
  mapHttpError,
  networkError,
  packFailedError,
  releaseFailedError,
  releaseUnhealthyError,
  simulatedModeError,
  timeoutError,
  unknownError,
} from "./errors";
import { PackError, packSource } from "./pack";

export const API_BASE_URL = "https://api.liara.ir";
export const DNS_BASE_URL = "https://dns-service.liara.ir";
export const DEFAULT_TIMEOUT_MS = 15_000;
export const UPLOAD_TIMEOUT_MS = 120_000;
export const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [500, 1000, 2000];
export const DEPLOY_TIMEOUT_MS = 10 * 60_000;
export const DEPLOY_POLL_INTERVAL_MS = 2_000;
/** A Retry-After longer than this is not waited for; the error is returned instead. */
const MAX_RETRY_AFTER_MS = 30_000;
const LOG_DEFAULT_WINDOW_SECONDS = 30 * 60;

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface LiaraClientConfig {
  apiToken?: string;
  baseUrl?: string;
  dnsBaseUrl?: string;
  isSimulated?: boolean;
  /** Team account to act on; appended as `teamID` query param to PaaS calls (falls back to LIARA_TEAM_ID). */
  teamID?: string;
  /** Injectable fetch, for tests. */
  fetchImpl?: FetchLike;
  /** Backoff before each GET retry (default 500, 1000, 2000 ms). */
  retryDelaysMs?: number[];
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  /** JSON body; serialized and sent with Content-Type application/json. */
  json?: unknown;
  /** multipart/form-data body; Content-Type is left to fetch so the boundary is set. */
  form?: FormData;
  query?: Record<string, string | number | boolean | undefined>;
  timeoutMs?: number;
  base?: "api" | "dns";
}

export interface AppSummary {
  _id: string;
  name: string;
  type: string;
  status: string;
  scale: number;
  planID: string;
  hourlyPrice: number;
  monthlyPrice: number;
  port: number;
  envs: Array<{ key: string; value: string }>;
  isDeployed: boolean;
  isSimulated?: boolean;
}

export interface MeResponse {
  user?: { _id?: string; fullname?: string; email?: string; isTeam?: boolean; [k: string]: unknown };
  team?: Record<string, unknown>;
  plans?: { projects?: Record<string, PlanRaw>; [k: string]: unknown };
  [k: string]: unknown;
}

interface PlanRaw {
  price?: number;
  available?: boolean;
  region?: string;
  volume?: number;
  CPU?: { amount?: number };
  RAM?: { amount?: number };
  [k: string]: unknown;
}

export interface PlanSummary {
  planID: string;
  hourlyPrice: number;
  /** hourly price * 720 hours, as in the official CLI. Prices are in Toman. */
  monthlyPrice: number;
  available: boolean;
  region?: string;
  cpu?: number;
  /** RAM in MB. The account API reports RAM.amount in GB (the CLI prints it as GB). */
  ram?: number;
  volume?: number;
}

export type MetricKind = "cpu" | "memory" | "network-receive" | "network-transmit";

export interface LogLine {
  type?: string;
  datetime?: string;
  message?: string;
  [k: string]: unknown;
}

export interface ReleaseInfo {
  _id?: string;
  state?: string;
  failReason?: string;
  queue?: number;
  [k: string]: unknown;
}

export interface BuildOutputLine {
  stream: "STDOUT" | "STDERR" | string;
  line: string;
  createdAt: string;
}

export interface BuildLogsResponse {
  release: ReleaseInfo;
  buildOutput: BuildOutputLine[];
}

export interface CreateReleaseInput {
  sourceID?: string;
  image?: string;
  port: number;
  type: string;
  envs?: Record<string, string>;
  message?: string;
  build?: { cache?: boolean; args?: Record<string, string>; dockerfile?: string; location?: string };
  args?: string;
  disks?: Array<{ name: string; mountTo: string }>;
  healthCheck?: { command: string | string[] };
  [extra: string]: unknown;
}

export interface DomainInfo {
  _id?: string;
  name?: string;
  type?: string;
  status?: string;
  certificatesStatus?: string;
  redirectTo?: string;
  redirectStatus?: number;
  CNameRecord?: string;
  project?: { _id?: string; project_id?: string };
  [k: string]: unknown;
}

export interface DnsRecord {
  id?: string;
  name: string;
  type: string;
  ttl?: number;
  contents: unknown[];
}

export type DeployStage = "pack" | "upload" | "release" | "build" | "ready" | "failed";

export interface DeployEvent {
  stage: DeployStage;
  message_fa: string;
  line?: string;
}

export interface DeployOptions {
  port: number;
  /** Env pairs sent in the release body, as the CLI does (`envs`). Optional. */
  envs?: Record<string, string>;
  /** Liara platform, e.g. node, python, docker, static. Sent as `type`. */
  platform: string;
  onEvent?: (event: DeployEvent) => void;
  /** Total budget for the whole deploy (default 10 minutes). */
  timeoutMs?: number;
  /** Build-log poll interval (default 2 seconds). */
  pollIntervalMs?: number;
}

export interface DeployResult {
  ok: boolean;
  releaseID?: string;
  state: string;
  error?: HumanError;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function toNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isTransientCode(code: string): boolean {
  return code === "NETWORK_ERROR" || code === "TIMEOUT" || code === "RATE_LIMITED" || /^HTTP_5\d\d$/.test(code);
}

type Outcome =
  | { kind: "response"; status: number; statusText: string; headers: Headers; text: string }
  | { kind: "timeout" }
  | { kind: "network"; message: string };

export class LiaraClient {
  private readonly token?: string;
  private readonly baseUrl: string;
  private readonly dnsBaseUrl: string;
  private readonly isSimulated: boolean;
  private readonly teamID?: string;
  private readonly fetchImpl: FetchLike;
  private readonly retryDelaysMs: readonly number[];

  constructor(config: LiaraClientConfig = {}) {
    this.token = config.apiToken || process.env.LIARA_API_TOKEN;
    this.baseUrl = (config.baseUrl || API_BASE_URL).replace(/\/+$/, "");
    this.dnsBaseUrl = (config.dnsBaseUrl || DNS_BASE_URL).replace(/\/+$/, "");
    this.isSimulated = config.isSimulated ?? !this.token;
    this.teamID = config.teamID || process.env.LIARA_TEAM_ID || undefined;
    this.fetchImpl = config.fetchImpl ?? ((url, init) => fetch(url, init));
    this.retryDelaysMs = config.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  }

  public get isLive(): boolean {
    return !this.isSimulated && !!this.token;
  }

  /**
   * Single HTTP entry point. Timeout via AbortController; GET-only retry with backoff on
   * network errors, timeouts, 5xx and 429 (Retry-After honored); never retries other methods.
   * Empty or non-JSON 2xx bodies resolve with data undefined.
   */
  public async request<T = unknown>(endpoint: string, opts: RequestOptions = {}): Promise<ActionResult<T>> {
    if (this.isSimulated) {
      return { ok: false, error: simulatedModeError() };
    }

    const method = opts.method ?? "GET";
    const isGet = method === "GET";
    const url = this.buildUrl(endpoint, opts);
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxRetries = isGet ? this.retryDelaysMs.length : 0;

    for (let attempt = 0; ; attempt++) {
      const canRetry = attempt < maxRetries;
      const outcome = await this.send(url, method, opts, timeoutMs);

      if (outcome.kind === "response") {
        if (outcome.status >= 200 && outcome.status < 300) {
          return { ok: true, data: parseBody<T>(outcome.status, outcome.text) };
        }
        const retryable = outcome.status >= 500 || outcome.status === 429;
        if (canRetry && retryable) {
          let wait = this.retryDelaysMs[attempt];
          if (outcome.status === 429) {
            const retryAfter = parseRetryAfter(outcome.headers.get("retry-after"));
            if (retryAfter !== undefined) {
              if (retryAfter > MAX_RETRY_AFTER_MS) {
                return { ok: false, error: mapHttpError(429, undefined) };
              }
              wait = retryAfter;
            }
          }
          await sleep(wait);
          continue;
        }
        return { ok: false, error: mapHttpError(outcome.status, errorMessage(outcome.text, outcome.statusText, outcome.status)) };
      }

      if (canRetry) {
        await sleep(this.retryDelaysMs[attempt]);
        continue;
      }
      if (outcome.kind === "timeout") {
        return { ok: false, error: timeoutError(timeoutMs) };
      }
      return { ok: false, error: networkError(outcome.message) };
    }
  }

  private buildUrl(endpoint: string, opts: RequestOptions): string {
    const useDns = opts.base === "dns";
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(opts.query ?? {})) {
      if (value !== undefined) params.set(key, String(value));
    }
    if (this.teamID && !useDns) params.set("teamID", this.teamID);
    const qs = params.toString();
    return `${useDns ? this.dnsBaseUrl : this.baseUrl}${endpoint}${qs ? `?${qs}` : ""}`;
  }

  private async send(url: string, method: string, opts: RequestOptions, timeoutMs: number): Promise<Outcome> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token ?? ""}`,
      Accept: "application/json",
    };
    let body: BodyInit | undefined;
    if (opts.form) {
      body = opts.form;
    } else if (opts.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.json);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await this.fetchImpl(url, { method, headers, body, signal: controller.signal });
      const text = await res.text();
      return { kind: "response", status: res.status, statusText: res.statusText, headers: res.headers, text };
    } catch (err: unknown) {
      if (controller.signal.aborted) return { kind: "timeout" };
      return { kind: "network", message: err instanceof Error ? err.message : String(err) };
    } finally {
      clearTimeout(timer);
    }
  }

  // --- Account, plans, billing ---

  async getAccount(): Promise<ActionResult<unknown>> {
    return this.request("/v1/me");
  }

  /** Validates the token with GET /v1/me; a 401 maps to UNAUTHORIZED. */
  async validateToken(): Promise<ActionResult<MeResponse>> {
    return this.request<MeResponse>("/v1/me");
  }

  /** Plans from /v1/me `plans.projects`; monthly price = hourly price * 720 (CLI formula). */
  async getPlans(): Promise<ActionResult<PlanSummary[]>> {
    const me = await this.request<MeResponse>("/v1/me");
    if (!me.ok) return { ok: false, error: me.error };
    const projects = me.data?.plans?.projects ?? {};
    const plans: PlanSummary[] = Object.entries(projects)
      .filter(([, raw]) => raw && typeof raw === "object")
      .map(([planID, raw]) => {
        const hourly = toNumber(raw.price);
        return {
          planID,
          hourlyPrice: hourly,
          monthlyPrice: hourly * 720,
          available: raw.available === true,
          region: typeof raw.region === "string" ? raw.region : undefined,
          cpu: typeof raw.CPU?.amount === "number" ? raw.CPU.amount : undefined,
          ram: typeof raw.RAM?.amount === "number" ? Math.round(raw.RAM.amount * 1024) : undefined,
          volume: typeof raw.volume === "number" ? raw.volume : undefined,
        };
      });
    return { ok: true, data: plans };
  }

  async getBalance(): Promise<ActionResult<{ balance: number; minCreditAmount: number }>> {
    type BillingBody = { user?: { balance?: number; minCreditAmount?: number } };
    const res = await this.request<BillingBody>("/v1/billing");
    if (!res.ok) return { ok: false, error: res.error };
    const user = res.data?.user ?? {};
    return { ok: true, data: { balance: toNumber(user.balance), minCreditAmount: toNumber(user.minCreditAmount) } };
  }

  async getGitIntegrations(): Promise<
    ActionResult<{ gitProviderIntegrations: unknown[]; gitRepositoryIntegrations: unknown[] }>
  > {
    return this.request("/v1/me/git-integrations");
  }

  // --- Apps ---

  async listApps(): Promise<ActionResult<{ projects: AppSummary[] }>> {
    const res = await this.request<{ projects?: unknown[] }>("/v1/projects");
    if (!res.ok) return { ok: false, error: res.error };
    const projects = (res.data?.projects ?? []).map((p) => normalizeApp(p as Record<string, unknown>));
    return { ok: true, data: { projects } };
  }

  async getApp(name: string): Promise<ActionResult<{ project: AppSummary }>> {
    const res = await this.request<{ project?: Record<string, unknown> }>(`/v1/projects/${enc(name)}`);
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, data: { project: normalizeApp(res.data?.project ?? {}) } };
  }

  async createApp(body: {
    name: string;
    planID: string;
    platform: string;
    bundlePlanID?: string;
    network?: string;
    readOnlyRootFilesystem?: boolean;
  }): Promise<ActionResult<unknown>> {
    return this.request("/v1/projects", { method: "POST", json: body });
  }

  async restartApp(name: string): Promise<ActionResult<unknown>> {
    return this.request(`/v1/projects/${enc(name)}/actions/restart`, { method: "POST" });
  }

  async scaleApp(name: string, scale: number): Promise<ActionResult<unknown>> {
    return this.request(`/v1/projects/${enc(name)}/actions/scale`, { method: "POST", json: { scale } });
  }

  async resizePlan(name: string, planID: string): Promise<ActionResult<unknown>> {
    return this.request(`/v1/projects/${enc(name)}/resize`, { method: "POST", json: { planID } });
  }

  async updateEnvs(name: string, variables: Array<{ key: string; value: string }>): Promise<ActionResult<unknown>> {
    return this.request("/v1/projects/update-envs", {
      method: "POST",
      json: { project: name, variables },
    });
  }

  async updatePort(name: string, port: number): Promise<ActionResult<unknown>> {
    return this.request("/v1/projects/update-port", { method: "POST", json: { project: name, port } });
  }

  async setZeroDowntime(name: string, enable: boolean): Promise<ActionResult<unknown>> {
    const status = enable ? "enable" : "disable";
    return this.request(`/v1/projects/${enc(name)}/zero-downtime/${status}`, { method: "POST" });
  }

  async deleteApp(name: string): Promise<ActionResult<unknown>> {
    return this.request(`/v1/projects/${enc(name)}`, { method: "DELETE" });
  }

  async listReleases(name: string): Promise<ActionResult<unknown>> {
    return this.request(`/v1/projects/${enc(name)}/releases`);
  }

  async getApplets(name: string): Promise<ActionResult<unknown>> {
    return this.request(`/v1/projects/${enc(name)}/applets`);
  }

  /**
   * Logs since a unix timestamp in seconds (spec: `since` is required). Defaults to now - 30 minutes.
   */
  async getLogs(name: string, since?: number | string): Promise<ActionResult<LogLine[]>> {
    const value = since ?? Math.floor(Date.now() / 1000) - LOG_DEFAULT_WINDOW_SECONDS;
    return this.request<LogLine[]>(`/v1/projects/${enc(name)}/logs`, { query: { since: value } });
  }

  async getEvents(name: string): Promise<ActionResult<unknown>> {
    return this.request(`/v1/projects/${enc(name)}/events`);
  }

  async getMetricsSummary(name: string): Promise<ActionResult<unknown>> {
    return this.request(`/v1/projects/${enc(name)}/metrics/summary`);
  }

  /** Time series in unix seconds (`since` required by the spec). */
  async getMetricsSeries(name: string, kind: MetricKind, since: number): Promise<ActionResult<unknown>> {
    return this.request(`/v1/projects/${enc(name)}/metrics/${kind}`, { query: { since } });
  }

  // --- Source, release, build logs ---

  /** Uploads a .tar.gz as multipart field `file`. Returns the sourceID. */
  async uploadSource(name: string, archivePath: string): Promise<ActionResult<{ sourceID: string }>> {
    let bytes: Buffer;
    try {
      bytes = await fs.promises.readFile(archivePath);
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      return { ok: false, error: packFailedError(`فایل آرشیو خوانده نشد: ${reason}`) };
    }
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(bytes)], { type: "application/gzip" }), path.basename(archivePath));
    return this.request<{ sourceID: string }>(`/v2/projects/${enc(name)}/sources`, {
      method: "POST",
      form,
      timeoutMs: UPLOAD_TIMEOUT_MS,
    });
  }

  async createRelease(name: string, input: CreateReleaseInput): Promise<ActionResult<{ releaseID: string }>> {
    return this.request<{ releaseID: string }>(`/v2/projects/${enc(name)}/releases`, {
      method: "POST",
      json: input,
    });
  }

  async getRelease(releaseID: string): Promise<ActionResult<{ release: ReleaseInfo }>> {
    return this.request(`/v1/releases/${enc(releaseID)}`);
  }

  /** Build output after `since` (the createdAt of the last line seen; empty for the first call). */
  async getBuildLogs(releaseID: string, since?: string): Promise<ActionResult<BuildLogsResponse>> {
    return this.request<BuildLogsResponse>(`/v2/releases/${enc(releaseID)}/build-logs`, {
      query: { since: since ?? "" },
    });
  }

  async cancelRelease(releaseID: string): Promise<ActionResult<unknown>> {
    return this.request(`/v2/releases/${enc(releaseID)}/cancel`, { method: "POST" });
  }

  /**
   * pack -> upload -> create release -> poll build logs every pollIntervalMs until READY or a
   * terminal state, bounded by timeoutMs in total. Simulated mode returns SIMULATED_MODE without packing.
   */
  async deploy(name: string, dir: string, opts: DeployOptions): Promise<DeployResult> {
    const emit = opts.onEvent ?? (() => undefined);
    if (!this.isLive) {
      return { ok: false, state: "SIMULATED", error: simulatedModeError() };
    }
    const deadline = Date.now() + (opts.timeoutMs ?? DEPLOY_TIMEOUT_MS);
    const pollMs = opts.pollIntervalMs ?? DEPLOY_POLL_INTERVAL_MS;
    const fail = (state: string, error: HumanError, releaseID?: string): DeployResult => {
      emit({ stage: "failed", message_fa: error.what_fa });
      return { ok: false, releaseID, state, error };
    };

    emit({ stage: "pack", message_fa: "در حال بسته‌بندی سورس پروژه" });
    let archive: { path: string; sizeBytes: number };
    try {
      archive = await packSource(dir);
    } catch (err: unknown) {
      const error = err instanceof PackError ? err.humanError : unknownError(String(err));
      return fail("PACK_FAILED", error);
    }
    emit({ stage: "pack", message_fa: `بسته‌بندی کامل شد (${(archive.sizeBytes / 1048576).toFixed(1)} مگابایت)` });

    emit({ stage: "upload", message_fa: "در حال آپلود سورس به لیارا" });
    const upload = await this.uploadSource(name, archive.path);
    await fs.promises.rm(archive.path, { force: true }).catch(() => undefined);
    if (!upload.ok || !upload.data) {
      return fail("UPLOAD_FAILED", upload.error ?? unknownError("آپلود سورس بدون شناسه پاسخ داد."));
    }

    emit({ stage: "release", message_fa: "در حال ایجاد ریلیز" });
    const created = await this.createRelease(name, {
      sourceID: upload.data.sourceID,
      port: opts.port,
      type: opts.platform,
      ...(opts.envs ? { envs: opts.envs } : {}),
    });
    if (!created.ok || !created.data) {
      return fail("RELEASE_CREATE_FAILED", created.error ?? unknownError("ایجاد ریلیز بدون شناسه پاسخ داد."));
    }
    const releaseID = created.data.releaseID;

    let since: string | undefined;
    let deployingNotified = false;
    for (;;) {
      if (Date.now() >= deadline) {
        return fail("TIMEOUT", deployTimeoutError(), releaseID);
      }

      const logs = await this.getBuildLogs(releaseID, since);
      if (!logs.ok || !logs.data) {
        const error = logs.error;
        if (!error || !isTransientCode(error.code)) {
          return fail(error?.code ?? "LOGS_FAILED", error ?? unknownError("دریافت لاگ بیلد ناموفق بود."), releaseID);
        }
      } else {
        const { release, buildOutput } = logs.data;
        for (const out of buildOutput ?? []) {
          if (out.stream !== "STDOUT") {
            return fail("BUILD_FAILED", buildFailedError(out.line), releaseID);
          }
          emit({ stage: "build", message_fa: "بیلد در حال انجام است", line: out.line });
          since = out.createdAt;
        }

        // Same terminal-state checks as the CLI: only when no new output arrived.
        if (!buildOutput?.length) {
          const state = release?.state ?? "";
          if (state === "CANCELED") return fail(state, buildCanceledError(), releaseID);
          if (state === "TIMEDOUT") return fail(state, buildTimeoutError(), releaseID);
          if (state === "FAILED") return fail(state, releaseFailedError(release?.failReason), releaseID);
          if (state === "UNHEALTHY") return fail(state, releaseUnhealthyError(), releaseID);
          if (state === "DEPLOYING" && !deployingNotified) {
            deployingNotified = true;
            emit({ stage: "release", message_fa: "ریلیز ساخته شد؛ در حال بررسی سلامت برنامه" });
          }
          if (state === "READY") {
            emit({ stage: "ready", message_fa: "برنامه با موفقیت مستقر شد" });
            return { ok: true, releaseID, state };
          }
        }
      }

      await sleep(pollMs);
    }
  }

  // --- Domains and SSL ---

  async listDomains(project: string): Promise<ActionResult<{ domains: DomainInfo[] }>> {
    return this.request("/v1/domains", { query: { project } });
  }

  async addDomain(name: string, project: string, type = "PROJECT"): Promise<ActionResult<{ domain?: DomainInfo }>> {
    return this.request("/v1/domains", { method: "POST", json: { name, project, type } });
  }

  async checkDomain(id: string): Promise<ActionResult<{ domain: DomainInfo }>> {
    return this.request(`/v1/domains/${enc(id)}/check`);
  }

  /** Requests a Let's Encrypt certificate; the spec takes the domain name. */
  async provisionSsl(domain: string): Promise<ActionResult<{ code?: string }>> {
    return this.request("/v1/domains/provision-ssl-certs", { method: "POST", json: { domain } });
  }

  async deleteDomain(id: string): Promise<ActionResult<unknown>> {
    return this.request(`/v1/domains/${enc(id)}`, { method: "DELETE" });
  }

  // --- DNS (dns-service.liara.ir) ---

  async createZone(name: string): Promise<ActionResult<{ status: string; data: Record<string, unknown> }>> {
    return this.request("/api/v1/zones", { base: "dns", method: "POST", json: { name } });
  }

  async getZone(zone: string): Promise<ActionResult<{ status: string; data: Record<string, unknown> }>> {
    return this.request(`/api/v1/zones/${enc(zone)}`, { base: "dns" });
  }

  /** Re-checks the zone's nameserver delegation (PUT .../check). */
  async checkZone(zone: string): Promise<ActionResult<{ status: string; data: string }>> {
    return this.request(`/api/v1/zones/${enc(zone)}/check`, { base: "dns", method: "PUT" });
  }

  async listRecords(zone: string): Promise<ActionResult<{ status: string; data: DnsRecord[] }>> {
    return this.request(`/api/v1/zones/${enc(zone)}/dns-records`, { base: "dns" });
  }

  /** Creates a record when `id` is absent, otherwise edits record `id` (type cannot change). */
  async upsertRecord(
    zone: string,
    record: DnsRecord
  ): Promise<ActionResult<{ status: string; data: DnsRecord }>> {
    const { id, ...body } = record;
    if (id) {
      return this.request(`/api/v1/zones/${enc(zone)}/dns-records/${enc(id)}`, {
        base: "dns",
        method: "PUT",
        json: body,
      });
    }
    return this.request(`/api/v1/zones/${enc(zone)}/dns-records`, { base: "dns", method: "POST", json: body });
  }

  // --- Databases ---

  async getDatabases(): Promise<ActionResult<{ databases: unknown[] }>> {
    return this.request("/v1/databases");
  }

  async getDatabase(id: string): Promise<ActionResult<unknown>> {
    return this.request(`/v1/databases/${enc(id)}`);
  }

  async createDbBackup(id: string): Promise<ActionResult<unknown>> {
    return this.request(`/v1/databases/${enc(id)}/backups`, { method: "POST" });
  }

  /** External probe helper */
  async httpProbe(url: string, timeoutMs = 5000): Promise<{ ok: boolean; status: number; ms: number }> {
    const t0 = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      const ms = Math.round(performance.now() - t0);
      return { ok: res.ok, status: res.status, ms };
    } catch {
      const ms = Math.round(performance.now() - t0);
      return { ok: false, status: 0, ms };
    } finally {
      clearTimeout(timer);
    }
  }
}

function enc(value: string): string {
  return encodeURIComponent(value);
}

function parseBody<T>(status: number, text: string): T | undefined {
  if (status === 204 || text.trim() === "") return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

function errorMessage(text: string, statusText: string, status: number): string {
  try {
    const body = JSON.parse(text) as { message?: unknown };
    if (typeof body?.message === "string" && body.message) return body.message;
  } catch {
    // not JSON
  }
  return statusText || `HTTP ${status}`;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - Date.now());
}

function normalizeApp(raw: Record<string, unknown>): AppSummary {
  const hourly = toNumber(raw.hourlyPrice);
  const envs = Array.isArray(raw.envs)
    ? (raw.envs as Array<{ key?: unknown; value?: unknown }>).map((e) => ({
        key: String(e.key ?? ""),
        value: String(e.value ?? ""),
      }))
    : [];
  return {
    _id: String(raw._id ?? ""),
    name: String(raw.project_id ?? raw.name ?? ""),
    type: String(raw.type ?? ""),
    status: String(raw.status ?? ""),
    scale: toNumber(raw.scale),
    planID: String(raw.planID ?? ""),
    hourlyPrice: hourly,
    monthlyPrice: hourly * 720,
    port: toNumber(raw.port),
    envs,
    isDeployed: raw.isDeployed === true,
  };
}

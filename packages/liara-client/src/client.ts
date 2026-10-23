import type { ActionResult } from "@sokan/contracts";
import { mapHttpError } from "./errors";

export interface LiaraClientConfig {
  apiToken?: string;
  baseUrl?: string;
  dnsBaseUrl?: string;
  isSimulated?: boolean;
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

export class LiaraClient {
  private readonly token?: string;
  private readonly baseUrl: string;
  private readonly dnsBaseUrl: string;
  private readonly isSimulated: boolean;

  constructor(config: LiaraClientConfig = {}) {
    this.token = config.apiToken || process.env.LIARA_API_TOKEN;
    this.baseUrl = config.baseUrl || "https://api.liara.ir";
    this.dnsBaseUrl = config.dnsBaseUrl || "https://dns-service.liara.ir";
    this.isSimulated = config.isSimulated ?? !this.token;
  }

  public get isLive(): boolean {
    return !this.isSimulated && !!this.token;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
    baseUrlOverride?: string
  ): Promise<ActionResult<T>> {
    if (this.isSimulated) {
      return {
        ok: false,
        error: {
          code: "SIMULATED_MODE",
          what_fa: "اجرا در حالت شبیه‌ساز محلی (Local Simulation)",
          why_fa: "توکن معتبر LIARA_API_TOKEN ارائه نشده است؛ عملیات به صورت شبیه‌سازی محلی اداره می‌شود.",
          next_fa: "برای اتصال واقعی به ابر لیارا، متغیر LIARA_API_TOKEN را با توکن حساب خود مقداردهی کنید.",
        },
      };
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      ...(options.headers as Record<string, string>),
    };

    if (!headers["Content-Type"] && !(options.body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
    }

    const base = baseUrlOverride || this.baseUrl;

    try {
      const res = await fetch(`${base}${path}`, {
        ...options,
        headers,
      });

      if (!res.ok) {
        let msg = res.statusText;
        try {
          const body = await res.json();
          if (body?.message) msg = body.message;
        } catch {
          // ignore json parse error
        }
        return { ok: false, error: mapHttpError(res.status, msg) };
      }

      const data = (await res.json()) as T;
      return { ok: true, data };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: {
          code: "NETWORK_ERROR",
          what_fa: "عدم برقراری ارتباط با شبکه لیارا",
          why_fa: `خطای شبکه: ${message}`,
          next_fa: "وضعیت اتصال اینترنت و دسترسی به api.liara.ir را بررسی کنید.",
        },
      };
    }
  }

  // --- Real API Methods ---

  async getAccount(): Promise<ActionResult<unknown>> {
    return this.request("/v1/me");
  }

  async getBalance(): Promise<ActionResult<{ balance: number; minCreditAmount: number }>> {
    return this.request<{ balance: number; minCreditAmount: number }>("/v1/billing");
  }

  async listApps(): Promise<ActionResult<{ projects: AppSummary[] }>> {
    return this.request<{ projects: AppSummary[] }>("/v1/projects");
  }

  async getApp(name: string): Promise<ActionResult<{ project: AppSummary }>> {
    return this.request<{ project: AppSummary }>(`/v1/projects/${encodeURIComponent(name)}`);
  }

  async createApp(body: { name: string; planID: string; platform: string }): Promise<ActionResult<unknown>> {
    return this.request("/v1/projects", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async restartApp(name: string): Promise<ActionResult<unknown>> {
    return this.request(`/v1/projects/${encodeURIComponent(name)}/actions/restart`, {
      method: "POST",
    });
  }

  async scaleApp(name: string, scale: number): Promise<ActionResult<unknown>> {
    return this.request(`/v1/projects/${encodeURIComponent(name)}/actions/scale`, {
      method: "POST",
      body: JSON.stringify({ scale }),
    });
  }

  async resizePlan(name: string, planID: string): Promise<ActionResult<unknown>> {
    return this.request(`/v1/projects/${encodeURIComponent(name)}/resize`, {
      method: "POST",
      body: JSON.stringify({ planID }),
    });
  }

  async updateEnvs(
    name: string,
    variables: Array<{ key: string; value: string }>
  ): Promise<ActionResult<unknown>> {
    return this.request("/v1/projects/update-envs", {
      method: "POST",
      body: JSON.stringify({ project: name, variables }),
    });
  }

  async updatePort(name: string, port: number): Promise<ActionResult<unknown>> {
    return this.request("/v1/projects/update-port", {
      method: "POST",
      body: JSON.stringify({ project: name, port }),
    });
  }

  async deleteApp(name: string): Promise<ActionResult<unknown>> {
    return this.request(`/v1/projects/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
  }

  async listReleases(name: string): Promise<ActionResult<unknown>> {
    return this.request(`/v1/projects/${encodeURIComponent(name)}/releases`);
  }

  async getApplets(name: string): Promise<ActionResult<unknown>> {
    return this.request(`/v1/projects/${encodeURIComponent(name)}/applets`);
  }

  async getLogs(name: string, since?: string): Promise<ActionResult<unknown>> {
    const q = since ? `?since=${encodeURIComponent(since)}` : "";
    return this.request(`/v2/projects/${encodeURIComponent(name)}/logs${q}`);
  }

  async uploadSource(name: string, body: unknown): Promise<ActionResult<{ sourceID: string }>> {
    const isRawBody =
      typeof body === "string" ||
      body instanceof FormData ||
      (typeof Blob !== "undefined" && body instanceof Blob) ||
      (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer) ||
      (typeof Buffer !== "undefined" && Buffer.isBuffer(body));

    return this.request<{ sourceID: string }>(`/v2/projects/${encodeURIComponent(name)}/sources`, {
      method: "POST",
      body: isRawBody ? (body as BodyInit) : JSON.stringify(body),
    });
  }

  async createRelease(
    name: string,
    payload: { sourceID: string; envVars?: Array<{ key: string; value: string }>; port?: number }
  ): Promise<ActionResult<{ releaseID: string }>> {
    return this.request<{ releaseID: string }>(`/v2/projects/${encodeURIComponent(name)}/releases`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async getBuildLogs(name: string, releaseID: string): Promise<ActionResult<unknown>> {
    return this.request(`/v2/projects/${encodeURIComponent(name)}/releases/${encodeURIComponent(releaseID)}/logs`);
  }

  async rollbackRelease(name: string, releaseID: string): Promise<ActionResult<unknown>> {
    return this.request(`/v2/projects/${encodeURIComponent(name)}/releases/${encodeURIComponent(releaseID)}/rollback`, {
      method: "POST",
    });
  }

  async cancelRelease(name: string, releaseID: string): Promise<ActionResult<unknown>> {
    return this.request(`/v2/projects/${encodeURIComponent(name)}/releases/${encodeURIComponent(releaseID)}/cancel`, {
      method: "POST",
    });
  }

  async listDomains(): Promise<ActionResult<{ domains: Array<{ _id: string; name: string; status: string; project?: string }> }>> {
    return this.request<{ domains: Array<{ _id: string; name: string; status: string; project?: string }> }>("/v1/domains");
  }

  async addDomain(
    name: string,
    project: string
  ): Promise<ActionResult<{ domain: { _id: string; name: string; status: string } }>> {
    return this.request<{ domain: { _id: string; name: string; status: string } }>("/v1/domains", {
      method: "POST",
      body: JSON.stringify({ name, project, type: "PROJECT" }),
    });
  }

  async checkDomain(domainID: string): Promise<ActionResult<{ status: string }>> {
    return this.request<{ status: string }>(`/v1/domains/${encodeURIComponent(domainID)}/check`, {
      method: "PUT",
    });
  }

  async enableSsl(domainID: string): Promise<ActionResult<unknown>> {
    return this.request("/v1/domains/provision-ssl", {
      method: "POST",
      body: JSON.stringify({ domainId: domainID }),
    });
  }

  async createDnsZone(name: string): Promise<ActionResult<{ id: string; name: string; nameservers: string[] }>> {
    return this.request<{ id: string; name: string; nameservers: string[] }>(
      "/api/v1/zones",
      {
        method: "POST",
        body: JSON.stringify({ name }),
      },
      this.dnsBaseUrl
    );
  }

  async checkDnsNameservers(zoneID: string): Promise<ActionResult<{ status: string }>> {
    return this.request<{ status: string }>(
      `/api/v1/zones/${encodeURIComponent(zoneID)}/check`,
      {
        method: "PUT",
      },
      this.dnsBaseUrl
    );
  }

  async upsertDnsRecord(
    zoneID: string,
    record: { type: string; name: string; contents: unknown[]; ttl?: number }
  ): Promise<ActionResult<{ id: string }>> {
    return this.request<{ id: string }>(
      `/api/v1/zones/${encodeURIComponent(zoneID)}/dns-records`,
      {
        method: "POST",
        body: JSON.stringify(record),
      },
      this.dnsBaseUrl
    );
  }

  async getMetricsSummary(name: string): Promise<ActionResult<unknown>> {
    return this.request(`/v1/projects/${encodeURIComponent(name)}/metrics/summary`);
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

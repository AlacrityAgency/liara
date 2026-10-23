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
  private readonly isSimulated: boolean;

  constructor(config: LiaraClientConfig = {}) {
    this.token = config.apiToken || process.env.LIARA_API_TOKEN;
    this.baseUrl = config.baseUrl || "https://api.liara.ir";
    this.isSimulated = config.isSimulated ?? !this.token;
  }

  public get isLive(): boolean {
    return !this.isSimulated && !!this.token;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<ActionResult<T>> {
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
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    };

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
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
    return this.request(`/v1/projects/${encodeURIComponent(name)}/logs${q}`);
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

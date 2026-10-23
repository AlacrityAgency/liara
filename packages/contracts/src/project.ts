export type PlatformType = 
  | "node"
  | "next"
  | "react"
  | "vue"
  | "angular"
  | "static"
  | "python"
  | "django"
  | "flask"
  | "php"
  | "laravel"
  | "go"
  | "dotnet"
  | "docker";

export interface LiaraJson {
  app?: string;
  platform?: PlatformType;
  port?: number;
  build?: {
    location?: "iran" | "germany";
    cache?: boolean;
    args?: Record<string, string>;
  };
  healthCheck?: {
    command: string;
    interval?: number;
    timeout?: number;
    retries?: number;
  };
  cron?: string[];
  disks?: Array<{
    name: string;
    mountTo: string;
  }>;
}

export interface ProjectProfile {
  rootPath: string;
  detectedPlatform: PlatformType;
  confidence: "high" | "medium" | "low";
  runtimeVersion?: string;
  entrypoint?: string;
  buildCommand?: string;
  startCommand?: string;
  detectedPort: number;
  requiredEnvs: string[];
  databaseRequirement?: "postgres" | "mysql" | "mongodb" | "redis" | "none";
  diskRequirement?: boolean;
  cronJobs?: string[];
  healthCheckEndpoint?: string;
  suggestedLiaraJson: LiaraJson;
}

export interface PlanOption {
  planId: string;
  name: string;
  cpuCores: number;
  ramMB: number;
  diskGB: number;
  monthlyPriceTomans: number;
  hourlyPriceTomans: number;
  tier: "economic" | "recommended" | "scalable";
  rationale_fa: string;
}

export interface PlanRecommendation {
  app: string;
  platform: PlatformType;
  estimatedBaseMemoryMB: number;
  trafficLevel: "low" | "medium" | "high";
  options: [PlanOption, PlanOption, PlanOption]; // Economic, Recommended, Scalable
  currentBalanceTomans?: number;
  hasSufficientBalance: boolean;
  requiredTopUpTomans?: number;
}

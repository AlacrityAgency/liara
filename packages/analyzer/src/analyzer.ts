import * as fs from "fs";
import * as path from "path";
import type { ProjectProfile, PlatformType, LiaraJson, PlanRecommendation, PlanOption } from "@sokan/contracts";

export class ProjectAnalyzer {
  /**
   * Analyzes a project directory and extracts runtime, platform, ports, and env requirements (§8.2).
   */
  public static async analyze(projectPath: string): Promise<ProjectProfile> {
    const files = fs.existsSync(projectPath) ? fs.readdirSync(projectPath) : [];

    let platform: PlatformType = "node";
    let confidence: "high" | "medium" | "low" = "low";
    let detectedPort = 3000;
    let runtimeVersion: string | undefined;
    let buildCommand: string | undefined;
    let startCommand: string | undefined;
    let entrypoint: string | undefined;
    let databaseRequirement: ProjectProfile["databaseRequirement"] = "none";
    let diskRequirement = false;
    let healthCheckEndpoint: string | undefined;
    const requiredEnvs: Set<string> = new Set();
    const cronJobs: string[] = [];

    // Helper to safely read file
    const readFile = (rel: string): string => {
      try {
        const full = path.join(projectPath, rel);
        return fs.existsSync(full) ? fs.readFileSync(full, "utf-8") : "";
      } catch {
        return "";
      }
    };

    // 1. Dockerfile check
    if (files.includes("Dockerfile")) {
      platform = "docker";
      confidence = "high";
      const dockerfileContent = readFile("Dockerfile");
      const portMatch = dockerfileContent.match(/EXPOSE\s+(\d+)/i);
      if (portMatch) {
        detectedPort = parseInt(portMatch[1], 10);
      }
    }
    // 2. Node / Next / React / Vue / Angular
    else if (files.includes("package.json")) {
      confidence = "high";
      try {
        const pkg = JSON.parse(readFile("package.json"));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };

        if (deps["next"]) {
          platform = "next";
          detectedPort = 3000;
          buildCommand = "next build";
          startCommand = "next start";
        } else if (deps["react-scripts"] || deps["vite"]) {
          platform = "react";
          detectedPort = 3000;
          buildCommand = "npm run build";
        } else if (deps["vue"] || deps["nuxt"]) {
          platform = "vue";
          detectedPort = 3000;
        } else {
          platform = "node";
          detectedPort = 3000;
        }

        // Check DB dependencies
        if (deps["@prisma/client"] || deps["prisma"] || deps["pg"]) {
          databaseRequirement = "postgres";
          requiredEnvs.add("DATABASE_URL");
        } else if (deps["mysql2"] || deps["mysql"]) {
          databaseRequirement = "mysql";
          requiredEnvs.add("DATABASE_URL");
        } else if (deps["mongoose"] || deps["mongodb"]) {
          databaseRequirement = "mongodb";
          requiredEnvs.add("MONGODB_URI");
        } else if (deps["ioredis"] || deps["redis"]) {
          databaseRequirement = "redis";
          requiredEnvs.add("REDIS_URL");
        }

        // Check disk requirement (e.g. multer, file uploads)
        if (deps["multer"] || deps["formidable"] || files.includes("uploads") || files.includes("storage")) {
          diskRequirement = true;
        }

        if (deps["node-cron"]) {
          cronJobs.push("node-cron detected in dependencies");
        }

        if (pkg.engines?.node) {
          runtimeVersion = pkg.engines.node;
        }
        if (pkg.main) {
          entrypoint = pkg.main;
        }
        if (pkg.scripts?.start) {
          startCommand = "npm start";
        }
      } catch {
        // invalid package.json
      }
    }
    // 3. Python (Django / Flask / FastApi)
    else if (files.includes("requirements.txt") || files.includes("pyproject.toml")) {
      confidence = "high";
      const reqContent = readFile("requirements.txt");
      if (reqContent.includes("django") || files.includes("manage.py")) {
        platform = "django";
        detectedPort = 8000;
        startCommand = "python manage.py runserver 0.0.0.0:8000";
      } else if (reqContent.includes("flask")) {
        platform = "flask";
        detectedPort = 5000;
      } else {
        platform = "python";
        detectedPort = 8000;
      }

      if (reqContent.includes("psycopg") || reqContent.includes("asyncpg")) {
        databaseRequirement = "postgres";
        requiredEnvs.add("DATABASE_URL");
      }
      if (reqContent.includes("celery") || reqContent.includes("schedule")) {
        cronJobs.push("celery/schedule detected in requirements");
      }
    }
    // 4. PHP / Laravel
    else if (files.includes("composer.json") || files.includes("artisan")) {
      confidence = "high";
      if (files.includes("artisan")) {
        platform = "laravel";
        detectedPort = 80;
      } else {
        platform = "php";
        detectedPort = 80;
      }
      if (files.includes("storage")) {
        diskRequirement = true;
      }
    }
    // 5. Go
    else if (files.includes("go.mod")) {
      platform = "go";
      confidence = "high";
      detectedPort = 8080;
    }
    // 6. Static HTML
    else if (files.includes("index.html")) {
      platform = "static";
      confidence = "medium";
      detectedPort = 80;
    }

    // Scan for .env.example or .env
    for (const envFile of [".env.example", ".env"]) {
      const content = readFile(envFile);
      if (content) {
        for (const line of content.split("\n")) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
            const varName = trimmed.split("=")[0].trim();
            if (varName) requiredEnvs.add(varName);
          }
        }
      }
    }

    // Scan source files for ports and environment variables
    const scanResult = ProjectAnalyzer.scanSourceForPortAndEnvs(projectPath, requiredEnvs);
    if (scanResult.detectedPort) {
      detectedPort = scanResult.detectedPort;
    }
    if (scanResult.healthCheckEndpoint) {
      healthCheckEndpoint = scanResult.healthCheckEndpoint;
    }

    // Check existing liara.json
    const liaraJsonRaw = readFile("liara.json");
    let existingLiaraJson: LiaraJson = {};
    if (liaraJsonRaw) {
      try {
        existingLiaraJson = JSON.parse(liaraJsonRaw);
        if (existingLiaraJson.port) detectedPort = existingLiaraJson.port;
        if (existingLiaraJson.platform) platform = existingLiaraJson.platform;
      } catch {
        // ignore
      }
    }

    const suggestedLiaraJson: LiaraJson = {
      platform,
      app: existingLiaraJson.app || path.basename(projectPath),
      port: detectedPort,
      build: {
        location: "iran",
        cache: true,
      },
      healthCheck: {
        command: `curl -f http://localhost:${detectedPort}${healthCheckEndpoint ?? "/"} || exit 1`,
        interval: 30,
        timeout: 5,
        retries: 3,
      },
    };

    return {
      rootPath: projectPath,
      detectedPlatform: platform,
      confidence,
      runtimeVersion,
      entrypoint,
      buildCommand,
      startCommand,
      detectedPort,
      requiredEnvs: Array.from(requiredEnvs),
      databaseRequirement,
      diskRequirement,
      cronJobs: cronJobs.length > 0 ? cronJobs : undefined,
      healthCheckEndpoint,
      suggestedLiaraJson,
    };
  }

  /**
   * Plan recommendation algorithm (§8.3)
   */
  public static recommendPlans(
    profile: ProjectProfile,
    trafficLevel: "low" | "medium" | "high" = "medium",
    currentBalanceTomans?: number
  ): PlanRecommendation {
    // 1. Base memory
    let baseMB = 200;
    switch (profile.detectedPlatform) {
      case "static":
      case "react":
      case "vue":
        baseMB = 64;
        break;
      case "node":
        baseMB = 250;
        break;
      case "next":
        baseMB = 450;
        break;
      case "laravel":
      case "php":
        baseMB = 300;
        break;
      case "django":
      case "flask":
      case "python":
        baseMB = 300;
        break;
      case "go":
        baseMB = 128;
        break;
      default:
        baseMB = 256;
    }

    const trafficFactor = trafficLevel === "low" ? 1.0 : trafficLevel === "medium" ? 1.5 : 2.5;
    const targetMB = Math.round(baseMB * trafficFactor);

    // 2. Formulate 3 tiers (§8.3)
    const economic: PlanOption = {
      planId: "g2-small",
      name: "اقتصادی (Economic)",
      cpuCores: 0.5,
      ramMB: 512,
      diskGB: 10,
      hourlyPriceTomans: 100,
      monthlyPriceTomans: 100 * 720,
      tier: "economic",
      rationale_fa: "حداقل منابع برای راه‌اندازی اولیه و تست با کمترین هزینه.",
    };

    const recommended: PlanOption = {
      planId: targetMB > 800 ? "g2-standard" : "g2-medium",
      name: "پیشنهادی (Recommended)",
      cpuCores: 1.0,
      ramMB: 1024,
      diskGB: 20,
      hourlyPriceTomans: 220,
      monthlyPriceTomans: 220 * 720,
      tier: "recommended",
      rationale_fa: `حاشیه امن حافظه (${targetMB} مگابایت تخمین نیاز) برای جلوگیری از خطای OOM تحت بار معمول.`,
    };

    const scalable: PlanOption = {
      planId: "g2-pro",
      name: "رشد و مقیاس‌پذیر (Scalable)",
      cpuCores: 2.0,
      ramMB: 2048,
      diskGB: 40,
      hourlyPriceTomans: 440,
      monthlyPriceTomans: 440 * 720,
      tier: "scalable",
      rationale_fa: "منابع کافی برای پیک‌های ترافیکی بالا و پردازش‌های سنگین.",
    };

    const costFirstMonth = recommended.monthlyPriceTomans;
    const hasSufficientBalance = currentBalanceTomans !== undefined ? currentBalanceTomans >= costFirstMonth : false;
    const requiredTopUpTomans = !hasSufficientBalance && currentBalanceTomans !== undefined
      ? Math.max(0, costFirstMonth - currentBalanceTomans)
      : undefined;

    return {
      app: profile.suggestedLiaraJson.app || "my-app",
      platform: profile.detectedPlatform,
      estimatedBaseMemoryMB: baseMB,
      trafficLevel,
      options: [economic, recommended, scalable],
      currentBalanceTomans,
      hasSufficientBalance,
      requiredTopUpTomans,
    };
  }

  /**
   * Scans source files (.js, .ts, .py, .php) for port definitions and environment variables.
   */
  public static scanSourceForPortAndEnvs(
    projectPath: string,
    existingEnvs?: Set<string>
  ): {
    detectedPort?: number;
    requiredEnvKeys: string[];
    requiredEnvs: string[];
    healthCheckEndpoint?: string;
  } {
    const foundEnvs: Set<string> = new Set();
    let detectedPort: number | undefined;
    let healthCheckEndpoint: string | undefined;

    const scanDir = (dir: string, depth = 0) => {
      if (depth > 4) return;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
          if (
            e.name === "node_modules" ||
            e.name === ".git" ||
            e.name === ".next" ||
            e.name === "dist" ||
            e.name === "build" ||
            e.name === "vendor" ||
            e.name === ".venv" ||
            e.name === "__pycache__"
          ) {
            continue;
          }
          const full = path.join(dir, e.name);
          if (e.isDirectory()) {
            scanDir(full, depth + 1);
          } else if (/\.(js|ts|jsx|tsx|mjs|cjs|py|php)$/i.test(e.name)) {
            const code = fs.readFileSync(full, "utf-8");

            // 1. Port detection in .js / .ts / source files
            // Direct numeric listen: (app|server|http|fastify).listen(3100)
            const listenMatch = code.match(/(?:app|server|http|fastify)\.listen\(\s*(\d{4,5})/i);
            // Variable listen: (app|server|http|fastify).listen(PORT, ...)
            const listenVarMatch = code.match(/(?:app|server|http|fastify)\.listen\(\s*([a-zA-Z_][a-zA-Z0-9_]*)/i);
            // Fallback or default port in process.env.PORT expressions: process.env.PORT || 3100 or '3100' or ?? 3100
            const envPortMatch = code.match(/process\.env(?:\.PORT|\[['"]PORT['"]\])\s*(?:\|\||\?\?)\s*['"]?(\d{4,5})['"]?/i);
            // Standalone variable definition: const PORT = ... 3100 ...
            const portVarMatch = code.match(
              /(?:const|let|var)\s+PORT\s*(?:=|\|\|)\s*(?:(?:parseInt|Number)\([^)]*\|\|\s*)?['"]?(\d{4,5})['"]?/i
            );
            // Python / Flask / FastAPI: app.run(port=XXXX) or uvicorn.run(..., port=XXXX)
            const pyPortMatch = code.match(/(?:app\.run|uvicorn\.run)\([^)]*port\s*=\s*(\d{4,5})/i);
            // Go: http.ListenAndServe(":XXXX", ...)
            const goPortMatch = code.match(/ListenAndServe\(\s*['"](?::)?(\d{4,5})['"]/i);

            if (listenMatch && listenMatch[1]) {
              detectedPort = parseInt(listenMatch[1], 10);
            } else if (envPortMatch && envPortMatch[1]) {
              detectedPort = parseInt(envPortMatch[1], 10);
            } else if (portVarMatch && portVarMatch[1]) {
              detectedPort = parseInt(portVarMatch[1], 10);
            } else if (pyPortMatch && pyPortMatch[1]) {
              detectedPort = parseInt(pyPortMatch[1], 10);
            } else if (goPortMatch && goPortMatch[1]) {
              detectedPort = parseInt(goPortMatch[1], 10);
            } else if (listenVarMatch && listenVarMatch[1]) {
              const varName = listenVarMatch[1];
              const varRegex = new RegExp(`(?:const|let|var)\\s+${varName}\\s*=[^;]*?['"]?(\\d{4,5})['"]?`, "i");
              const m = code.match(varRegex);
              if (m && m[1]) detectedPort = parseInt(m[1], 10);
            }

            // 2. JS / TS environment variables: process.env.KEY or process.env['KEY']
            const jsEnvMatches = code.matchAll(
              /process\.env(?:\.([A-Za-z0-9_]{2,})|\[\s*['"]([A-Za-z0-9_]{2,})['"]\s*\])/g
            );
            for (const m of jsEnvMatches) {
              const k = m[1] || m[2];
              if (k && !["NODE_ENV", "PORT"].includes(k)) {
                foundEnvs.add(k);
                if (existingEnvs) existingEnvs.add(k);
              }
            }

            // 3. Python and PHP environment variables:
            // os.environ.get('KEY'), os.getenv('KEY'), os.environ['KEY'], env('KEY'), and getenv('KEY')
            const pyPhpMatches = code.matchAll(
              /(?:os\.environ\.get|os\.getenv|env|getenv)\(\s*['"]([A-Za-z0-9_]+)['"]|os\.environ\[\s*['"]([A-Za-z0-9_]+)['"]\s*\]/g
            );
            for (const m of pyPhpMatches) {
              const k = m[1] || m[2];
              if (k && !["PORT", "NODE_ENV"].includes(k)) {
                foundEnvs.add(k);
                if (existingEnvs) existingEnvs.add(k);
              }
            }

            // 4. Health endpoint check
            if (
              code.includes('"/health"') ||
              code.includes("'/health'") ||
              code.includes('"/api/health"')
            ) {
              healthCheckEndpoint = "/health";
            }
          }
        }
      } catch {
        // ignore scan error
      }
    };

    if (fs.existsSync(projectPath)) {
      scanDir(projectPath);
    }

    const envList = Array.from(foundEnvs);
    return {
      detectedPort,
      requiredEnvKeys: envList,
      requiredEnvs: envList,
      healthCheckEndpoint,
    };
  }

  /**
   * Generates a step-by-step Persian setup checklist and required DNS records for custom domains (§8.2 / DNS & Domain).
   * Detects .ir domains and includes IRNIC (nic.ir) configuration guidelines and free SSL provisioning.
   */
  public static generateDomainChecklist(
    domain: string,
    appName: string
  ): {
    isIrDomain: boolean;
    steps_fa: string[];
    records: Array<{ type: string; host: string; value: string }>;
  } {
    const cleanDomain = (domain || "").trim().toLowerCase();
    const isIrDomain = cleanDomain.endsWith(".ir");
    const app = (appName || "").trim();

    const records: Array<{ type: string; host: string; value: string }> = [
      {
        type: "CNAME",
        host: "@",
        value: `${app}.iran.liara.run`,
      },
      {
        type: "CNAME",
        host: "www",
        value: `${app}.iran.liara.run`,
      },
      {
        type: "A",
        host: "@",
        value: "37.152.180.12",
      },
    ];

    const steps_fa: string[] = isIrDomain
      ? [
          "ورود به سامانه مدیریت دامنه‌های ایرنیک (nic.ir) با مشخصات دارنده دامنه.",
          "تنظیم کارگزارهای نام (NameServer) لیارا: در بخش سامانه نام دامنه (DNS) در ایرنیک، کارگزارهای ns1.liara.zone و ns2.liara.zone را ثبت نمایید (انتشار رکوردهای دامنه‌های ir. در ایرنیک معمولاً بین ۲ تا ۲۴ ساعت به طول می‌انجامد).",
          `پیکربندی رکوردهای DNS: در سامانه مدیریت DNS، رکورد CNAME با میزبان @ و www به آدرس ${app}.iran.liara.run و رکورد A با میزبان @ به آی‌پی 37.152.180.12 تعریف کنید.`,
          `ثبت دامنه در کنسول لیارا: وارد بخش دامنه‌های برنامه ${app} شده و دامنه ${cleanDomain} را اضافه کنید.`,
          "بررسی وضعیت اتصال دامنه: بر روی دکمه «بررسی دامنه» کلیک کنید تا صحت رکوردهای DNS تایید گردد.",
          "فعال‌سازی گواهی رایگان SSL (Let's Encrypt): پس از اتصال موفق دامنه، گواهی SSL رایگان لیارا را از تب دامنه‌ها فعال کنید.",
        ]
      : [
          "ورود به پنل ثبت‌کننده دامنه (Registrar) یا سرویس مدیریت DNS (مانند سامانه DNS لیارا یا Cloudflare).",
          "تنظیم کارگزارهای نام (NameServers) لیارا (ns1.liara.zone و ns2.liara.zone) در صورت استفاده از سرویس DNS لیارا.",
          `تنظیم رکوردهای DNS: ثبت رکورد CNAME برای @ و www به مقدار ${app}.iran.liara.run یا رکورد A برای @ به مقدار 37.152.180.12.`,
          `افزودن دامنه ${cleanDomain} در بخش دامنه‌های برنامه ${app} در کنسول لیارا.`,
          "کلیک بر روی گزینه «بررسی دامنه» جهت اطمینان از انتشار رکوردهای DNS.",
          "فعال‌سازی گواهی SSL رایگان از کنسول کاربری لیارا.",
        ];

    return {
      isIrDomain,
      steps_fa,
      records,
    };
  }

  public generateDomainChecklist(
    domain: string,
    appName: string
  ): {
    isIrDomain: boolean;
    steps_fa: string[];
    records: Array<{ type: string; host: string; value: string }>;
  } {
    return ProjectAnalyzer.generateDomainChecklist(domain, appName);
  }
}

export function scanSourceForPortAndEnvs(
  projectPath: string,
  existingEnvs?: Set<string>
) {
  return ProjectAnalyzer.scanSourceForPortAndEnvs(projectPath, existingEnvs);
}

export function generateDomainChecklist(domain: string, appName: string) {
  return ProjectAnalyzer.generateDomainChecklist(domain, appName);
}

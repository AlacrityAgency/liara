// Tool registry shared by the Orchestrator (LLM tool-calling), the MCP server and tests.
// Executors live elsewhere; this module only describes tools and validates arguments.

export type RiskLevel = "L0" | "L1" | "L2" | "L3";

export interface JsonSchema {
  type?: "object" | "string" | "number" | "integer" | "boolean" | "array";
  description?: string;
  enum?: readonly (string | number)[];
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  items?: JsonSchema;
  minimum?: number;
  maximum?: number;
  additionalProperties?: boolean | JsonSchema;
}

export interface ToolSpec {
  name: string;
  risk: RiskLevel;
  description_fa: string;
  parameters: JsonSchema & { type: "object" };
}

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: "project_analyze",
    risk: "L0",
    description_fa: "تحلیل پوشه‌ی پروژه و تشخیص نوع برنامه برای لیارا",
    parameters: {
      type: "object",
      properties: { project_path: { type: "string", description: "مسیر پوشه‌ی پروژه" } },
      required: ["project_path"],
    },
  },
  {
    name: "plans_recommend",
    risk: "L0",
    description_fa: "پیشنهاد پلن مناسب بر اساس پروژه و ترافیک مورد انتظار",
    parameters: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "مسیر پوشه‌ی پروژه (اختیاری)" },
        expected_traffic: { type: "string", enum: ["low", "medium", "high"] },
      },
      required: [],
    },
  },
  {
    name: "account_status",
    risk: "L0",
    description_fa: "وضعیت حساب، صورت‌حساب و هزینه‌ی ماهانه‌ی تقریبی",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "app_status",
    risk: "L0",
    description_fa: "وضعیت اپ: روشن/خاموش، پروب، منابع و ریلیز فعلی",
    parameters: {
      type: "object",
      properties: { app: { type: "string", description: "نام اپ (اختیاری)" } },
      required: [],
    },
  },
  {
    name: "app_restart",
    risk: "L2",
    description_fa: "ری‌استارت اپ (حدود ۱۰ ثانیه قطعی؛ نیازمند تأیید)",
    parameters: {
      type: "object",
      properties: { app: { type: "string", description: "نام اپ" } },
      required: ["app"],
    },
  },
  {
    name: "app_update_envs",
    risk: "L2",
    description_fa: "افزودن یا تغییر متغیرهای محیطی اپ (نیازمند تأیید)",
    parameters: {
      type: "object",
      properties: {
        app: { type: "string", description: "نام اپ" },
        envs: {
          type: "object",
          description: "نام متغیر به مقدار آن",
          additionalProperties: { type: "string" },
        },
      },
      required: ["app", "envs"],
    },
  },
  {
    name: "app_resize_plan",
    risk: "L2",
    description_fa: "تغییر پلن منابع (RAM/CPU) اپ؛ نیازمند تأیید و ممکن است هزینه داشته باشد",
    parameters: {
      type: "object",
      properties: {
        app: { type: "string", description: "نام اپ" },
        plan_id: { type: "string", description: "شناسه‌ی پلن مقصد" },
      },
      required: ["app", "plan_id"],
    },
  },
  {
    name: "app_update_port",
    risk: "L2",
    description_fa: "تغییر پورت داخلی اپ (نیازمند تأیید)",
    parameters: {
      type: "object",
      properties: {
        app: { type: "string", description: "نام اپ" },
        port: { type: "integer", minimum: 1, maximum: 65535 },
      },
      required: ["app", "port"],
    },
  },
  {
    name: "app_scale",
    risk: "L2",
    description_fa: "تغییر تعداد نمونه‌ها؛ scale=0 یعنی خاموش کردن و ریسک L3 دارد",
    parameters: {
      type: "object",
      properties: {
        app: { type: "string", description: "نام اپ" },
        scale: { type: "integer", minimum: 0, maximum: 10 },
      },
      required: ["app", "scale"],
    },
  },
  {
    name: "deploy",
    risk: "L2",
    description_fa: "دیپلوی پروژه روی لیارا (نیازمند تأیید)",
    parameters: {
      type: "object",
      properties: {
        project_path: { type: "string", description: "مسیر پوشه‌ی پروژه" },
        app: { type: "string", description: "نام اپ مقصد (اختیاری)" },
        plan_id: { type: "string", description: "شناسه‌ی پلن (اختیاری)" },
      },
      required: ["project_path"],
    },
  },
  {
    name: "release_rollback",
    risk: "L2",
    description_fa: "برگشت به ریلیز قبلی سالم (نیازمند تأیید)",
    parameters: {
      type: "object",
      properties: {
        app: { type: "string", description: "نام اپ" },
        release_id: { type: "string", description: "شناسه‌ی ریلیز مقصد (اختیاری)" },
      },
      required: ["app"],
    },
  },
  {
    name: "sre_investigate",
    risk: "L0",
    description_fa: "تحقیق SRE برای علت مشکل: خطا، کندی، مصرف منابع، لاگ‌ها",
    parameters: {
      type: "object",
      properties: {
        symptom_fa: { type: "string", description: "شرح مشکل به زبان کاربر" },
        focus: { type: "string", enum: ["general", "logs", "cpu", "memory"] },
      },
      required: ["symptom_fa"],
    },
  },
  {
    name: "limits_list",
    risk: "L0",
    description_fa: "فهرست کارهایی که سُکان انجام می‌دهد و نمی‌دهد",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "domain_connect_guide",
    risk: "L0",
    description_fa: "راهنمای گام‌به‌گام اتصال دامنه (ثبت DNS و ایرنیک)",
    parameters: {
      type: "object",
      properties: { domain: { type: "string", description: "دامنه (اختیاری)" } },
      required: [],
    },
  },
  {
    name: "app_delete",
    risk: "L3",
    description_fa: "حذف دائمی اپ؛ غیرقابل بازگشت و نیازمند تأیید با تایپ نام اپ",
    parameters: {
      type: "object",
      properties: { app: { type: "string", description: "نام اپ" } },
      required: ["app"],
    },
  },
];

const TOOL_BY_NAME = new Map(TOOL_SPECS.map((t) => [t.name, t]));

export function findTool(name: string): ToolSpec | undefined {
  return TOOL_BY_NAME.get(name);
}

// Risk can depend on arguments: scaling to zero is L3 (whitepaper §10.1).
export function effectiveRisk(spec: ToolSpec, args: Record<string, unknown>): RiskLevel {
  if (spec.name === "app_scale" && args.scale === 0) return "L3";
  return spec.risk;
}

export function isApprovalRequired(result: unknown): result is { status: "approval_required"; approvalId: string; console_url?: string } {
  return (
    typeof result === "object" &&
    result !== null &&
    (result as { status?: unknown }).status === "approval_required" &&
    typeof (result as { approvalId?: unknown }).approvalId === "string"
  );
}

// Minimal JSON Schema check: required keys, primitive types, enums, ranges.
// Returns null when valid, otherwise the first problem (as a key name / message).
export function validateToolArgs(spec: ToolSpec, args: unknown): string | null {
  if (typeof args !== "object" || args === null || Array.isArray(args)) return "args";
  const obj = args as Record<string, unknown>;
  for (const key of spec.parameters.required ?? []) {
    if (obj[key] === undefined || obj[key] === null || obj[key] === "") return key;
  }
  for (const [key, schema] of Object.entries(spec.parameters.properties ?? {})) {
    const v = obj[key];
    if (v === undefined) continue;
    if (!matchesType(schema, v)) return key;
  }
  return null;
}

function matchesType(schema: JsonSchema, v: unknown): boolean {
  switch (schema.type) {
    case "string":
      if (typeof v !== "string") return false;
      break;
    case "integer":
      if (!Number.isInteger(v)) return false;
      break;
    case "number":
      if (typeof v !== "number" || !Number.isFinite(v)) return false;
      break;
    case "boolean":
      if (typeof v !== "boolean") return false;
      break;
    case "object":
      if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
      if (typeof schema.additionalProperties === "object") {
        for (const item of Object.values(v as Record<string, unknown>)) {
          if (!matchesType(schema.additionalProperties, item)) return false;
        }
      }
      break;
    case "array":
      if (!Array.isArray(v)) return false;
      break;
  }
  if (schema.enum && !schema.enum.includes(v as string | number)) return false;
  if (typeof v === "number") {
    if (schema.minimum !== undefined && v < schema.minimum) return false;
    if (schema.maximum !== undefined && v > schema.maximum) return false;
  }
  return true;
}

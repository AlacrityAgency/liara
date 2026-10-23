// Offline fallback router (used when no LLM is configured or the LLM call fails).
// Rules are ordered: the first match wins. No \b anchors: \b does not work on Persian text.

export interface RouteMatch {
  tool: string;
  args: Record<string, unknown>;
  confidence: number;
}

export interface RouteClarify {
  clarify_fa: string;
  options: string[];
}

export type RouteResult = RouteMatch | RouteClarify;

export function isClarify(r: RouteResult): r is RouteClarify {
  return "clarify_fa" in r;
}

// Normalizes Persian/Arabic chat text: Arabic ي/ك to Persian, ZWNJ and harakat removed,
// Persian and Arabic-Indic digits to ASCII, punctuation to spaces, lowercase.
export function normalizeFa(input: string): string {
  return input
    .replace(/[‌‍‎‏‪-‮ـً-ٟ]/g, "")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[؟?!،,;:()\[\]"«»]/g, " ")
    .replace(/\.(?=\s|$)/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const GREETING_FA =
  "سلام! من سُکان هستم، همکار DevOps برای اپ‌های لیارا. می‌توانم اپ را دیپلوی کنم، وضعیت و علت مشکل را بررسی کنم، پلن و هزینه را بگویم یا دامنه را وصل کنم. چه کاری می‌خواهی؟";

const HELP_OPTIONS = ["دیپلوی پروژه", "وضعیت اپ", "هزینه‌ی ماهانه", "محدودیت‌ها"];

function hasWord(tokens: string[], words: string[]): boolean {
  return words.some((w) => tokens.includes(w));
}

function digitsIn(t: string): number | undefined {
  const m = t.match(/(\d{1,5})/);
  return m ? Number(m[1]) : undefined;
}

export class IntentRouter {
  static route(text: string): RouteResult {
    const raw = String(text ?? "");
    const t = normalizeFa(raw);
    const tokens = t.split(" ");
    const match = (tool: string, args: Record<string, unknown> = {}, confidence = 0.9): RouteMatch => ({
      tool,
      args,
      confidence,
    });
    const clarify = (question: string, options: string[]): RouteClarify => ({ clarify_fa: question, options });

    if (t === "" || /^(سلام|درود|hello|hi|hey)( عزیز| دوست| سکان)?$/.test(t)) {
      return { clarify_fa: GREETING_FA, options: HELP_OPTIONS };
    }

    // Limits: "چه کارهایی نمی‌تونی بکنی" / "محدودیت‌ها چیه"
    if (/محدودیت|نمیتونی|نمی تونی|نمیتوانی|چه کارهایی/.test(t)) return match("limits_list");

    // Symptoms go to SRE investigation before any action keyword ("حذف کش ... سایت هنوز کنده").
    if (/کند|ارور|خطا|کمک نکرد|هنوز|لاگ|مصرف|سی ?پی ?یو|سیپیو|cpu|چرا|500/.test(t)) {
      let focus = "general";
      if (/لاگ/.test(t)) focus = "logs";
      else if (/cpu|سی ?پی ?یو|سیپیو|پردازنده/.test(t)) focus = "cpu";
      else if (hasWord(tokens, ["رم", "ram"]) || /حافظه/.test(t)) focus = "memory";
      return match("sre_investigate", { symptom_fa: raw.trim(), focus }, 0.8);
    }

    // Destructive delete needs an explicit app/project object and an imperative verb.
    if (/حذف|پاک/.test(t) && hasWord(tokens, ["اپ", "اپلیکیشن", "برنامه", "پروژه"]) && /(کن|کنم|کنی|کنید|کنین|بکن)$/.test(t)) {
      return match("app_delete", {}, 0.85);
    }

    if (/دامنه|ایرنیک|domain|irnic/.test(t)) {
      const domain = tokens.find((w) => /^[a-z0-9-]+\.[a-z.]+$/.test(w));
      return match("domain_connect_guide", domain ? { domain } : {});
    }

    if (hasWord(tokens, ["پلن"]) && /کدوم|کدام|مناسب|پیشنهاد/.test(t)) return match("plans_recommend");

    if (/دیپلوی|deploy|بالا بیار|[آا]نلاین ک|منتشر کن/.test(t)) return match("deploy");

    if (/ری ?ا?ستارت|restart|راه ?اندازی مجدد/.test(t)) return match("app_restart");

    if (/برگرد|رول ?بک|rollback|نسخه (قبل|قبلی)/.test(t)) return match("release_rollback");

    if (/بالاست|وضعیت|چطوره|روشنه|آنلاینه/.test(t)) return match("app_status");

    if (/api ?_?key|متغیر|کلید|env/.test(t)) return match("app_update_envs");

    if (/پورت|port/.test(t)) {
      const port = digitsIn(t);
      if (port === undefined || port < 1 || port > 65535) {
        return clarify("کدام پورت؟ شماره‌ی پورت را بگو (مثلاً 8080).", ["پورت 3000", "پورت 8080"]);
      }
      return match("app_update_port", { port }, 0.9);
    }

    if (/خاموش|متوقف|scale|مقیاس|نمونه/.test(t)) {
      if (/خاموش|متوقف|صفر/.test(t)) return match("app_scale", { scale: 0 });
      const n = digitsIn(t);
      if (n !== undefined && n <= 10) return match("app_scale", { scale: n }, 0.75);
      return clarify("تعداد نمونه‌ها را بگو (۰ یعنی خاموش).", ["خاموش (۰)", "۱", "۲"]);
    }

    if (/ارتقا|رم|ram|حافظه/.test(t)) return match("app_resize_plan", {}, 0.8);

    if (/پول|هزینه|قیمت|صورتحساب|صورت حساب|خرج|ماهانه|تعرفه/.test(t)) return match("account_status");

    return clarify("منظورت را دقیق‌تر بگو. مثلاً می‌توانی بپرسی:", HELP_OPTIONS);
  }
}

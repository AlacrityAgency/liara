import { say } from "../render";

export function runHelp(): number {
  say("سُکان: پروژه‌ی پوشه‌ات را روی لیارا منتشر کن.");
  say("");
  say("  sokan                 سایتت را منتشر کن (یا نسخه‌ی جدید بده)");
  say("  sokan status          وضعیت سایت و هزینه‌ی ماهانه");
  say("  sokan logs [-f]       لاگ‌های برنامه (-f: زنده)");
  say("  sokan fix             پیدا کردن و درست کردن مشکل سایت");
  say("  sokan domain <نام>    وصل کردن دامنه (بعد از تنظیم سرورهای نام: --check)");
  say("  sokan login           ذخیره‌ی کلید API لیارا");
  say("  sokan logout          حذف کلید ذخیره‌شده");
  say("  sokan ui              کنسول وب سُکان برای همین پوشه");
  say("  sokan mcp             سرور MCP برای Cursor و Claude Code");
  say("");
  say("گزینه‌ها: --dir <مسیر>  --name <نام>  --plan <شناسه‌ی پلن>  --env KEY=VALUE");
  say("کارهایی که هزینه دارند همیشه یک بار تأیید می‌خواهند؛ گزینه‌ی --yes وجود ندارد.");
  say("متغیرهای محیطی: LIARA_API_TOKEN، SOKAN_HOME (پوشه‌ی تنظیمات)، NO_COLOR.");
  return 0;
}

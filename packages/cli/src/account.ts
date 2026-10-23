import { CliError } from "./errors";
import type { Prompts } from "./prompts";
import { makeClient, TOKEN_PAGE, humanError } from "./liara";
import { addSecret, bad, good, say } from "./render";
import { deleteSavedToken, readSavedToken, saveToken } from "./store";

/** Asks for the API key (hidden), validates it with GET /v1/me and saves it on success. */
export async function promptToken(prompts: Prompts): Promise<string> {
  say(`راهنما: کلید را از ${TOKEN_PAGE} بگیر.`);
  for (;;) {
    const token = await prompts.ask(`کلید API لیارا (از ${TOKEN_PAGE}):`, true);
    if (!token) {
      bad("کلید خالی است.");
      continue;
    }
    addSecret(token);
    const me = await makeClient(token).validateToken();
    if (me.ok) {
      saveToken(token);
      good("کلید معتبر بود و ذخیره شد.");
      return token;
    }
    // Only a rejected key is asked again; a network or server failure stops here.
    if (me.error?.code !== "UNAUTHORIZED") throw humanError(me.error);
    bad(humanError(me.error).message.split("\n")[0]);
  }
}

/** Token from LIARA_API_TOKEN, else the saved credentials, else a prompt. */
export async function ensureToken(prompts: Prompts): Promise<string> {
  const fromEnv = process.env.LIARA_API_TOKEN?.trim();
  if (fromEnv) {
    addSecret(fromEnv);
    return fromEnv;
  }
  const saved = readSavedToken();
  if (saved) {
    addSecret(saved);
    return saved;
  }
  return promptToken(prompts);
}

export async function runLogin(ctx: { prompts: Prompts }): Promise<number> {
  await promptToken(ctx.prompts);
  return 0;
}

export async function runLogout(): Promise<number> {
  if (!deleteSavedToken()) throw new CliError("کلیدی ذخیره نشده بود.");
  good("کلید ذخیره‌شده حذف شد.");
  if (process.env.LIARA_API_TOKEN) say("توجه: LIARA_API_TOKEN هنوز در محیط تنظیم است و از آن استفاده می‌شود.");
  return 0;
}

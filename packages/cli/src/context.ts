import type { Prompts } from "./prompts";

export interface Options {
  /** Project folder (default: the current directory). */
  dir: string;
  name?: string;
  plan?: string;
  app?: string;
  /** KEY=VALUE pairs from --env. */
  env: Record<string, string>;
  follow: boolean;
  check: boolean;
}

export interface Ctx {
  prompts: Prompts;
  dir: string;
  options: Options;
}

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CliError } from "./errors";

/** ~/.sokan, or SOKAN_HOME (used by the tests). */
export function sokanHome(): string {
  return process.env.SOKAN_HOME || path.join(os.homedir(), ".sokan");
}

function credentialsFile(): string {
  return path.join(sokanHome(), "credentials.json");
}

export function readSavedToken(): string | undefined {
  try {
    const raw = JSON.parse(fs.readFileSync(credentialsFile(), "utf8")) as { token?: unknown };
    return typeof raw.token === "string" && raw.token ? raw.token : undefined;
  } catch {
    return undefined;
  }
}

/** Saves the token with mode 600 in a 700 directory. */
export function saveToken(token: string): void {
  const home = sokanHome();
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  fs.chmodSync(home, 0o700);
  const file = credentialsFile();
  fs.writeFileSync(file, `${JSON.stringify({ token }, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

/** Returns false when nothing was saved. */
export function deleteSavedToken(): boolean {
  try {
    fs.rmSync(credentialsFile());
    return true;
  } catch {
    return false;
  }
}

export interface SiteState {
  appName: string;
  url: string;
  platform: string;
  port: number;
  planID?: string;
  bundlePlanID?: string;
  monthlyTomans?: number;
  lastReleaseID?: string;
  lastDeployAt: string;
}

const projectState = (dir: string): string => path.join(dir, ".sokan");

export function readSite(dir: string): SiteState | undefined {
  try {
    return JSON.parse(fs.readFileSync(path.join(projectState(dir), "site.json"), "utf8")) as SiteState;
  } catch {
    return undefined;
  }
}

export function requireSite(dir: string): SiteState {
  const site = readSite(dir);
  if (!site) throw new CliError("از این پوشه هنوز سایتی منتشر نشده. اول دستور sokan را اجرا کن.");
  return site;
}

export function writeSite(dir: string, site: SiteState): void {
  fs.mkdirSync(projectState(dir), { recursive: true });
  fs.writeFileSync(path.join(projectState(dir), "site.json"), `${JSON.stringify(site, null, 2)}\n`);
}

/** Writes .sokan/fix-brief.md and returns its path. */
export function writeFixBrief(dir: string, markdown: string): string {
  fs.mkdirSync(projectState(dir), { recursive: true });
  const file = path.join(projectState(dir), "fix-brief.md");
  fs.writeFileSync(file, markdown);
  return file;
}

/** KEY=VALUE pairs from the project's .env, or undefined when there is no file. */
export function readDotEnv(dir: string): Record<string, string> | undefined {
  let text: string;
  try {
    text = fs.readFileSync(path.join(dir, ".env"), "utf8");
  } catch {
    return undefined;
  }
  const values: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^export\s+/, "");
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    values[key] = value;
  }
  return values;
}

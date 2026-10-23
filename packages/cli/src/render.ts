import { SecretRedactor } from "../../policy/src/index";

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const useColor = !!process.stdout.isTTY && !process.env.NO_COLOR;

// Every line the CLI prints goes through this redactor. The Liara token is added when it is read,
// and secret-looking variables from the environment are registered at startup.
let redactor = new SecretRedactor({ env: process.env });

export function addSecret(value: string | undefined): void {
  if (value) redactor.addLiteral(value);
}

export function clean(text: string): string {
  return redactor.redactText(text);
}

const paint = (code: string) => (text: string) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);
export const color = {
  bold: paint("1"),
  dim: paint("2"),
  red: paint("31"),
  green: paint("32"),
  yellow: paint("33"),
  cyan: paint("36"),
};

export function say(line = ""): void {
  process.stdout.write(`${clean(line)}\n`);
}

export function good(line: string): void {
  say(color.green(line));
}

export function warn(line: string): void {
  process.stderr.write(`${clean(color.yellow(line))}\n`);
}

export function bad(line: string): void {
  process.stderr.write(`${clean(color.red(line))}\n`);
}

/** Western digits to Persian digits, for display. */
export function fa(value: string | number): string {
  return String(value).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);
}

/** Persian and Arabic digits typed by the user, to Western digits. */
export function normalizeDigits(text: string): string {
  return text.replace(/[۰-۹٠-٩]/g, (d) => {
    const code = d.charCodeAt(0);
    return String(code >= 0x6f0 ? code - 0x6f0 : code - 0x660);
  });
}

/** 1234567 -> "۱٬۲۳۴٬۵۶۷" */
export function toman(amount: number): string {
  return fa(Math.round(amount).toLocaleString("en-US")).replace(/,/g, "٬");
}

/**
 * One line that redraws in place on a terminal. Without a terminal, prints one line per step change.
 */
export class Progress {
  private readonly tty = !!process.stdout.isTTY;
  private lastStep = "";

  update(percent: number, step: string): void {
    const value = Math.max(0, Math.min(100, Math.round(percent)));
    const width = 24;
    const filled = Math.round((value / 100) * width);
    const bar = "█".repeat(filled) + "░".repeat(width - filled);
    const text = clean(`[${bar}] ${fa(value)}٪ ${step}`);
    if (this.tty) {
      process.stdout.write(`\r\x1b[2K${text}`);
    } else if (step !== this.lastStep) {
      process.stdout.write(`${text}\n`);
    }
    this.lastStep = step;
  }

  done(): void {
    if (this.tty && this.lastStep) process.stdout.write("\n");
  }
}

import * as readline from "node:readline";
import { Writable } from "node:stream";
import { CancelledError } from "./errors";
import { fa, normalizeDigits } from "./render";

type Waiter = (line: string | null) => void;
interface TtyWritable extends Writable {
  isTTY?: boolean;
  columns?: number;
}

const YES = ["y", "yes", "بله", "آره", "ب"];

/**
 * Line-based prompts on top of readline. Lines are queued as they arrive, so piped answers work
 * (`printf 'token\ny\n' | sokan`). Secret answers are read with the echo muted.
 * End of input counts as cancellation.
 */
export class Prompts {
  private rl: readline.Interface | undefined;
  private readonly queued: string[] = [];
  private readonly waiters: Waiter[] = [];
  private ended = false;
  private muted = false;

  private open(): void {
    if (this.rl) return;
    const terminal = !!process.stdin.isTTY;
    const output = new Writable({
      write: (chunk, _encoding, callback) => {
        if (!this.muted) process.stdout.write(chunk);
        callback();
      },
    }) as TtyWritable;
    output.isTTY = terminal;
    output.columns = process.stdout.columns;
    const rl = readline.createInterface({ input: process.stdin, output, terminal, prompt: "" });
    rl.on("line", (line) => {
      const waiter = this.waiters.shift();
      if (waiter) waiter(line);
      else this.queued.push(line);
    });
    rl.on("close", () => {
      this.ended = true;
      for (const waiter of this.waiters.splice(0)) waiter(null);
    });
    this.rl = rl;
  }

  private next(): Promise<string | null> {
    const queued = this.queued.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (this.ended) return Promise.resolve(null);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  /** Asks one question. Throws CancelledError when input ends. */
  async ask(question: string, secret = false): Promise<string> {
    this.open();
    const terminal = !!process.stdin.isTTY;
    process.stdout.write(`${question} `);
    this.muted = secret && terminal;
    const line = await this.next();
    this.muted = false;
    if (!terminal || secret) process.stdout.write("\n");
    if (line === null) throw new CancelledError();
    return secret ? line.trim() : normalizeDigits(line).trim();
  }

  /** Numbered choice; Enter picks the default (0-based index). */
  async choose(question: string, count: number, defaultIndex: number): Promise<number> {
    for (;;) {
      const answer = await this.ask(`${question} [${fa(1)}-${fa(count)}، Enter = ${fa(defaultIndex + 1)}]:`);
      if (answer === "") return defaultIndex;
      const picked = Number(answer);
      if (Number.isInteger(picked) && picked >= 1 && picked <= count) return picked - 1;
    }
  }

  /** Yes/no question; anything but yes (Enter included) is no. */
  async confirm(question: string): Promise<boolean> {
    const answer = (await this.ask(`${question} (y/N)`)).toLowerCase();
    return YES.includes(answer);
  }

  close(): void {
    this.rl?.close();
    this.rl = undefined;
  }
}

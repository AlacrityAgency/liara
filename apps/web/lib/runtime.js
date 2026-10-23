"use strict";
// Simulated target: runs demo/chaos-shop as a child process. Exit handling only clears the reference
// when the exiting process is still the current child (EVALUATION M10). Restarts are counted.

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const DEMO_DIR = path.resolve(__dirname, "../../../demo/chaos-shop");
const CHAOS_SCRIPT = path.join(DEMO_DIR, "src", "server.js");
const CLK_TCK = 100; // Linux USER_HZ

class ChaosRuntime {
  /**
   * @param {{onLine:(line:string, stream:string)=>void, onEvent:(ev:object)=>void}} hooks
   */
  constructor(hooks) {
    this.hooks = hooks;
    this.child = null;
    this.desired = false;
    this.env = {};
    this.port = null;
    this.restartTimer = null;
    this.queue = Promise.resolve();
    this.crashes = 0;
    this.starts = 0;
    this.lastCrash = null;
    this.cpuPrev = null;
    // One entry per child process: gen (same counter as `starts`), pid and its lifetime. Metric series are
    // split by generation so a restart does not look like a drop in a leak trend.
    this.generations = [];
  }

  /** Forgets crash counts and finished generations. Used when a demo scenario starts its own observation. */
  resetHistory() {
    this.crashes = 0;
    this.lastCrash = null;
    this.generations = this.generations.filter((g) => !g.endedAt);
  }

  /** Process generation that was alive at `ts` (ISO string), or null when no child was running then. */
  generationAt(ts) {
    const t = Date.parse(ts);
    for (let i = this.generations.length - 1; i >= 0; i--) {
      const g = this.generations[i];
      const end = g.endedAt ? Date.parse(g.endedAt) : Infinity;
      if (t >= Date.parse(g.startedAt) && t <= end) return g.gen;
    }
    return null;
  }

  get running() {
    return this.child !== null;
  }

  get pid() {
    return this.child ? this.child.pid : null;
  }

  /** Serialises start/stop so two actions never race for the same port. */
  enqueue(fn) {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  start(env, port) {
    return this.enqueue(async () => {
      await this.stopChild();
      this.desired = true;
      this.env = { ...env };
      this.port = port;
      this.spawnChild();
    });
  }

  stop() {
    return this.enqueue(async () => {
      this.desired = false;
      clearTimeout(this.restartTimer);
      await this.stopChild();
    });
  }

  /** Synchronous kill for process exit handlers. */
  killNow() {
    this.desired = false;
    clearTimeout(this.restartTimer);
    if (this.child) {
      try {
        this.child.kill("SIGKILL");
      } catch {
        // already gone
      }
    }
  }

  stopChild(timeoutMs = 3000) {
    const proc = this.child;
    if (!proc) return Promise.resolve();
    proc.__sokanStopping = true;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          // already gone
        }
        resolve();
      }, timeoutMs);
      proc.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      try {
        proc.kill("SIGTERM");
      } catch {
        clearTimeout(timer);
        resolve();
      }
    });
  }

  spawnChild() {
    const env = {
      PATH: process.env.PATH || "",
      HOME: process.env.HOME || "/tmp",
      LANG: process.env.LANG || "C.UTF-8",
      ...this.env,
      PORT: String(this.port),
    };
    const proc = spawn(process.execPath, [CHAOS_SCRIPT], { cwd: DEMO_DIR, env, stdio: ["ignore", "pipe", "pipe"] });
    this.child = proc;
    this.starts += 1;
    this.cpuPrev = null;
    this.generations.push({ gen: this.starts, pid: proc.pid, startedAt: new Date().toISOString(), endedAt: null });
    if (this.generations.length > 20) this.generations.shift();
    this.hooks.onEvent({ type: "start", message: `process started pid=${proc.pid} port=${this.port}` });

    const buffers = { stdout: "", stderr: "" };
    const feed = (stream) => (chunk) => {
      const parts = (buffers[stream] + chunk.toString("utf8")).split("\n");
      buffers[stream] = parts.pop();
      for (const line of parts) {
        const clean = line.replace(/\r$/, "");
        if (clean.trim()) this.hooks.onLine(clean, stream);
      }
    };
    proc.stdout.on("data", feed("stdout"));
    proc.stderr.on("data", feed("stderr"));

    proc.on("error", (err) => {
      this.hooks.onLine(`[SOKAN_RUNNER] process error: ${err.code || err.message}`, "system");
    });

    proc.on("exit", (code, signal) => {
      for (const stream of ["stdout", "stderr"]) {
        if (buffers[stream].trim()) this.hooks.onLine(buffers[stream], stream);
        buffers[stream] = "";
      }
      // Race fix: a previous child exiting late must not clear the reference to the current one.
      if (this.child === proc) this.child = null;
      const gen = this.generations.find((g) => g.pid === proc.pid && !g.endedAt);
      if (gen) gen.endedAt = new Date().toISOString();
      const intentional = proc.__sokanStopping === true;
      const reason = code === 137 ? "OOMKilled" : signal ? `signal ${signal}` : `exit code ${code}`;
      this.hooks.onLine(`[SOKAN_RUNNER] target process stopped: ${reason}${intentional ? " (requested)" : ""}`, "system");
      if (intentional) return;

      this.crashes += 1;
      this.lastCrash = { at: new Date().toISOString(), code, signal, reason };
      this.hooks.onEvent({ type: "crash", message: `container exited unexpectedly: ${reason}` });
      if (this.desired) {
        clearTimeout(this.restartTimer);
        // The platform restarts a crashed container; here it is simulated after one second.
        this.restartTimer = setTimeout(() => {
          if (this.desired && this.child === null) this.spawnChild();
        }, 1000);
      }
    });
  }

  /** CPU percent of the child since the previous sample (Linux /proc only); null when unavailable. */
  cpuSample() {
    if (!this.child) return null;
    let stat;
    try {
      stat = fs.readFileSync(`/proc/${this.child.pid}/stat`, "utf8");
    } catch {
      return null;
    }
    const after = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const ticks = Number(after[11]) + Number(after[12]);
    const now = Date.now();
    const prev = this.cpuPrev;
    this.cpuPrev = { ticks, now, pid: this.child.pid };
    if (!prev || prev.pid !== this.child.pid || now <= prev.now) return null;
    const cpuSeconds = (ticks - prev.ticks) / CLK_TCK;
    const pct = Math.round((cpuSeconds / ((now - prev.now) / 1000)) * 1000) / 10;
    return { ts: new Date(now).toISOString(), pct: Math.max(0, pct) };
  }
}

module.exports = { ChaosRuntime, DEMO_DIR };

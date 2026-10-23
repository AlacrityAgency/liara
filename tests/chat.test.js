// POST /api/chat offline (no LIARA token, no LLM key): replies must carry concrete content, never the model-off sentence.
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");

const REPO = path.resolve(__dirname, "..");
const SERVER = path.join(REPO, "apps", "web", "server.js");
const TOKEN = "test";
const MODEL_OFF = "مدل زبانی فعال نیست";
const PERSIAN_DIGIT = /[۰-۹]/;
const NUMBERED_LINE = /^[۰-۹]+\./gm;

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe("POST /api/chat offline replies", () => {
  let child;
  let exited = false;
  let base;
  let stateDir;

  before(async () => {
    const sokanPort = await freePort();
    const chaosPort = await freePort();
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "sokan-chat-"));
    // Explicit env: no LIARA_*, no SOKAN_LLM_* from the developer's shell.
    const env = {
      PATH: process.env.PATH || "",
      HOME: process.env.HOME || os.tmpdir(),
      SOKAN_CONSOLE_TOKEN: TOKEN,
      SOKAN_PORT: String(sokanPort),
      CHAOS_PORT: String(chaosPort),
      SOKAN_STATE_DIR: stateDir,
    };
    base = `http://127.0.0.1:${sokanPort}`;
    child = spawn(process.execPath, [SERVER], { cwd: REPO, env, stdio: ["ignore", "pipe", "pipe"] });
    child.on("exit", () => { exited = true; });
    child.stdout.on("data", () => {});
    child.stderr.on("data", () => {});
    for (let i = 0; i < 100; i++) {
      try {
        const res = await fetch(`${base}/api/state`, { headers: { "X-Sokan-Token": TOKEN } });
        if (res.status === 200) return;
      } catch {
        // not listening yet
      }
      await sleep(200);
    }
    throw new Error("console did not start");
  });

  after(async () => {
    if (child && !exited) {
      child.kill("SIGTERM");
      for (let i = 0; i < 50 && !exited; i++) await sleep(100);
    }
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  async function chat(message) {
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "X-Sokan-Token": TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    assert.strictEqual(res.status, 200, `chat "${message}" status`);
    const json = await res.json();
    assert.ok(!json.reply_fa.includes(MODEL_OFF), `"${message}" must not show the model-off sentence`);
    return json;
  }

  it("cost question: current plan, monthly cost in Persian digits and toman, marked as estimate", async () => {
    const out = await chat("چقدر پول می‌دم ماهانه؟");
    assert.strictEqual(out.source, "offline");
    assert.ok(out.reply_fa.includes("تومان"), out.reply_fa);
    assert.ok(out.reply_fa.includes("g2-small"), "current plan named");
    assert.ok(PERSIAN_DIGIT.test(out.reply_fa), "Persian digits");
    assert.ok(out.reply_fa.includes("تخمینی"), "estimate is said");
  });

  it("limits: numbered list with why and workaround for each item", async () => {
    const out = await chat("چه کارهایی نمی‌تونی بکنی");
    const numbered = out.reply_fa.match(NUMBERED_LINE) || [];
    assert.ok(numbered.length >= 3, `numbered items: ${numbered.length}`);
    assert.ok(out.reply_fa.includes("چرا:"));
    assert.ok(out.reply_fa.includes("راه‌حل:"));
    assert.ok(Array.isArray(out.limits) && out.limits.length >= 3);
  });

  it("domain .ir: numbered IRNIC steps and what Sokan automates versus the user", async () => {
    const out = await chat("دامنه ir وصل کن");
    const numbered = out.reply_fa.match(NUMBERED_LINE) || [];
    assert.ok(numbered.length >= 4, `numbered steps: ${numbered.length}`);
    assert.ok(out.reply_fa.includes("nic.ir"));
    assert.ok(out.reply_fa.includes("کارهایی که سُکان خودکار انجام می‌دهد"));
    assert.ok(out.reply_fa.includes("کارهایی که شما باید انجام دهید"));
  });

  it("status: app name, state, last probe and memory line", async () => {
    const out = await chat("وضعیت سایتم چطوره");
    assert.ok(out.reply_fa.includes("chaos-shop"));
    assert.ok(out.reply_fa.includes("وضعیت"));
    assert.ok(PERSIAN_DIGIT.test(out.reply_fa));
    assert.ok(out.reply_fa.split("\n").length >= 3, "several concrete lines");
  });

  it("restart: an L2 approval for chaos-shop, no clarify question", async () => {
    const out = await chat("ریستارت کن");
    assert.ok(!out.reply_fa.includes("اطلاعات بیشتری"));
    assert.strictEqual(out.clarify, undefined);
    const card = out.approvals.find((a) => a.tool === "app_restart");
    assert.ok(card, "app_restart approval created");
    assert.strictEqual(card.riskLevel, "L2");
    assert.strictEqual(card.params.project, "chaos-shop");
    assert.strictEqual(card.status, "pending");
  });

  it("delete: an L3 approval for chaos-shop", async () => {
    const out = await chat("اپ رو حذف کن");
    assert.ok(!out.reply_fa.includes("اطلاعات بیشتری"));
    const card = out.approvals.find((a) => a.tool === "app_delete");
    assert.ok(card, "app_delete approval created");
    assert.strictEqual(card.riskLevel, "L3");
    assert.strictEqual(card.params.project, "chaos-shop");
  });

  it("greeting: a friendly reply with five help buttons", async () => {
    const out = await chat("سلام");
    assert.ok(out.reply_fa.includes("سُکان") || out.reply_fa.includes("سکان"));
    assert.ok(out.clarify && Array.isArray(out.clarify.options));
    assert.strictEqual(out.clarify.options.length, 5);
    for (const option of out.clarify.options) {
      assert.ok(option.label_fa && option.message, "each button has a label and a message");
    }
    const labels = out.clarify.options.map((o) => o.label_fa).join("|");
    assert.ok(labels.includes("دیپلوی"));
    assert.ok(labels.includes("دامنه"));
  });
});

const { describe, it, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  ApprovalService,
  APPROVAL_TTL_MS,
  AuditLedger,
  SecretRedactor,
  TokenGuard,
  StandingApprovals,
  COST_BEARING_TOOLS,
  loadPolicyConfig,
  normalizePolicyConfig,
  maskParams,
  maskValue,
  paramsHash,
} = require("../build/policy/src/index.js");

const CARD = {
  title_fa: "عنوان",
  what_fa: "کار",
  why_fa: "دلیل",
  cost_fa: "بدون هزینه",
  impact_fa: "اثر",
  rollback_fa: "بازگشت",
  successCriteria_fa: "معیار",
};

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sokan-policy-test-"));
let tmpCounter = 0;
function tmpDir() {
  const dir = path.join(tmpRoot, `case-${++tmpCounter}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

function withEnv(name, value, fn) {
  const prev = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env[name];
    else process.env[name] = prev;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ENV_PARAMS = (value) => ({
  project: "chaos-shop",
  variables: [{ key: "DATABASE_URL", value }],
});

describe("P1. Tamper test with a real approval (§10.2 point 5)", () => {
  it("rejects changed params with PARAM_MISMATCH and still allows the approved params", () => {
    const c = clock();
    const svc = new ApprovalService({ now: c.now, secret: "test-secret-tamper" });
    const approved = ENV_PARAMS("postgres://root:old-secret@127.0.0.1:5432/app");

    const outcome = svc.request("app_update_envs", approved, CARD, "agent");
    assert.strictEqual(outcome.kind, "pending");
    const id = outcome.approval.id;
    assert.strictEqual(svc.approve(id).ok, true);

    // The agent (or an injected prompt) swaps the database host after the user clicked approve.
    const tampered = ENV_PARAMS("postgres://root:old-secret@attacker.example:5432/app");
    const denied = svc.authorize("app_update_envs", tampered, id, "agent");
    assert.strictEqual(denied.ok, false);
    assert.strictEqual(denied.code, "PARAM_MISMATCH");

    // A failed attempt must not consume the approval: the exact approved params still pass.
    const ok = svc.authorize("app_update_envs", approved, id, "agent");
    assert.strictEqual(ok.ok, true);
  });

  it("binds the approval to a deep copy, so later mutation of the caller's object cannot change what runs", () => {
    const svc = new ApprovalService({ secret: "test-secret-copy" });
    const params = ENV_PARAMS("postgres://good");
    const id = svc.request("app_update_envs", params, CARD, "agent").approval.id;
    svc.approve(id);

    params.variables[0].value = "postgres://evil";
    assert.strictEqual(svc.authorize("app_update_envs", params, id).code, "PARAM_MISMATCH");

    const bound = svc.getApprovedParams(id);
    assert.strictEqual(bound.variables[0].value, "postgres://good");
    assert.strictEqual(svc.authorize("app_update_envs", bound, id).ok, true);
  });

  it("rejects a second use of the same approval (replay)", () => {
    const svc = new ApprovalService({ secret: "test-secret-replay" });
    const params = { project: "chaos-shop" };
    const id = svc.request("app_restart", params, CARD, "agent").approval.id;
    svc.approve(id);

    assert.strictEqual(svc.authorize("app_restart", params, id).ok, true);
    const replay = svc.authorize("app_restart", params, id);
    assert.strictEqual(replay.ok, false);
    assert.strictEqual(replay.code, "REPLAY_DETECTED");
  });

  it("changes the params hash when an env value changes", () => {
    const h1 = paramsHash("app_update_envs", ENV_PARAMS("alpha-value-1111"));
    const h2 = paramsHash("app_update_envs", ENV_PARAMS("alpha-value-2222"));
    assert.notStrictEqual(h1, h2);
  });
});

describe("P2. Expiry (§7.2)", () => {
  it("expires a pending approval after the TTL", () => {
    const c = clock();
    const svc = new ApprovalService({ now: c.now, secret: "test-secret-expiry" });
    const id = svc.request("app_restart", { project: "p" }, CARD, "agent").approval.id;

    c.advance(APPROVAL_TTL_MS + 1);
    const decision = svc.approve(id);
    assert.strictEqual(decision.ok, false);
    assert.strictEqual(decision.code, "APPROVAL_EXPIRED");
    assert.strictEqual(svc.get(id).status, "expired");
  });

  it("rejects execution with a token that has expired", () => {
    const c = clock();
    const svc = new ApprovalService({ now: c.now, secret: "test-secret-token-expiry" });
    const params = { project: "p" };
    const id = svc.request("app_restart", params, CARD, "agent").approval.id;
    svc.approve(id);

    c.advance(5 * 60_000 + 1);
    const decision = svc.authorize("app_restart", params, id);
    assert.strictEqual(decision.ok, false);
    assert.strictEqual(decision.code, "TOKEN_EXPIRED");
  });

  it("issues tokens that expire on the same TTL as the approval", () => {
    const c = clock();
    const guard = new TokenGuard("test-secret-ttl", c.now);
    const token = guard.issue("apr_x", "h", APPROVAL_TTL_MS);
    assert.strictEqual(Date.parse(token.expiresAt) - c.now(), APPROVAL_TTL_MS);
  });
});

describe("P3. Cancel clears the scheduled execution (§7.1, M12)", () => {
  it("cancel() prevents a scheduled L2 execution from running", async () => {
    const svc = new ApprovalService({ secret: "test-secret-cancel-l2" });
    const id = svc.request("app_restart", { project: "p" }, CARD, "agent").approval.id;
    svc.approve(id);

    let runs = 0;
    assert.strictEqual(svc.scheduleExecution(id, 30, () => { runs++; }), true);
    assert.strictEqual(svc.isScheduled(id), true);

    assert.strictEqual(svc.cancel(id), true);
    assert.strictEqual(svc.isScheduled(id), false);
    await sleep(60);
    assert.strictEqual(runs, 0);
    assert.strictEqual(svc.get(id).status, "cancelled");
  });

  it("cancel() inside the L3 cancel window clears the timer that would fire after 10 s", async () => {
    const c = clock();
    const svc = new ApprovalService({ now: c.now, secret: "test-secret-cancel-l3" });
    const params = { name: "chaos-shop" };
    const id = svc.request("app_delete", params, CARD, "user", { confirmationText: "chaos-shop" }).approval.id;
    assert.strictEqual(svc.approve(id, "chaos-shop").ok, true);

    let runs = 0;
    svc.scheduleExecution(id, 0, () => { runs++; });
    assert.strictEqual(svc.isScheduled(id), true);
    assert.strictEqual(svc.cancel(id), true);
    assert.strictEqual(svc.isScheduled(id), false);
    assert.strictEqual(svc.authorize("app_delete", params, id).code, "NOT_APPROVED");
    await sleep(20);
    assert.strictEqual(runs, 0);
  });

  it("a scheduled execution runs when it is not cancelled, and only with approved params", async () => {
    const svc = new ApprovalService({ secret: "test-secret-run" });
    const params = { project: "p" };
    const id = svc.request("app_restart", params, CARD, "agent").approval.id;

    assert.strictEqual(svc.scheduleExecution(id, 5, () => {}), false, "pending approvals cannot be scheduled");
    svc.approve(id);

    let seen;
    svc.scheduleExecution(id, 5, () => { seen = svc.getApprovedParams(id); });
    await sleep(40);
    assert.deepStrictEqual(seen, params);
    assert.strictEqual(svc.isScheduled(id), false);
  });

});

describe("P4. Public view hides confirmationText, tokens and secret values (§10.3, C3, M2)", () => {
  it("get() and list() omit confirmationText, token material and the raw secret, and mask values", () => {
    const svc = new ApprovalService({ secret: "test-secret-public" });
    const raw = "s3cr3t-value-b7c1";
    const outcome = svc.request("app_delete", { name: "chaos-shop" }, CARD, "user", {
      confirmationText: "chaos-shop",
    });
    assert.strictEqual(outcome.kind, "pending");
    assert.strictEqual("confirmationText" in outcome.approval, false);
    assert.strictEqual(outcome.approval.requiresTypedConfirmation, true);
    assert.ok(outcome.approval.expiresAt);

    const id2 = svc.request("app_update_envs", ENV_PARAMS(raw), CARD, "agent").approval.id;
    const pub = svc.get(id2);
    const text = JSON.stringify(svc.list()) + JSON.stringify(pub) + JSON.stringify(outcome);

    assert.strictEqual(pub.params.variables[0].value, "••••b7c1");
    assert.ok(!text.includes(raw), "raw env value must not appear in any public view");
    assert.ok(!text.includes("confirmationText"));
    assert.ok(!/signature|nonce/.test(text), "token fields must not appear");
    assert.ok(pub.expiresAt, "expiresAt is part of the public view");
    assert.strictEqual(pub.requiresTypedConfirmation, false);
  });

  it("the pending outcome of request() carries the public view, not the raw approval", () => {
    const svc = new ApprovalService({ secret: "test-secret-outcome" });
    const outcome = svc.request("app_update_envs", ENV_PARAMS("postgres://u:hunter2-long@h/db"), CARD, "agent");
    assert.ok(!JSON.stringify(outcome).includes("hunter2"));
  });

  it("getApprovedParams() returns the unmasked params for the executor only after approval", () => {
    const svc = new ApprovalService({ secret: "test-secret-bound" });
    const id = svc.request("app_update_envs", ENV_PARAMS("real-value-0000"), CARD, "agent").approval.id;
    assert.strictEqual(svc.getApprovedParams(id), undefined, "not available while pending");
    svc.approve(id);
    assert.strictEqual(svc.getApprovedParams(id).variables[0].value, "real-value-0000");
    assert.strictEqual(svc.getApprovedParams("apr_missing"), undefined);
  });

  it("maskParams masks secret-looking keys, every variables[].value, and keeps other data", () => {
    const masked = maskParams({
      project: "chaos-shop",
      planID: "g2-medium",
      DATABASE_URL: "postgres://a:b@h/db",
      nested: { apiToken: "abcdefgh1234", note: "plain" },
      variables: [{ key: "PORT", value: "3100" }, { key: "FLAG", value: "on" }],
      short: { password: "ab" },
    });
    assert.strictEqual(masked.project, "chaos-shop");
    assert.strictEqual(masked.planID, "g2-medium");
    assert.ok(masked.DATABASE_URL.startsWith("••••"));
    assert.ok(!masked.DATABASE_URL.includes("postgres"));
    assert.strictEqual(masked.nested.apiToken, "••••1234");
    assert.strictEqual(masked.nested.note, "plain");
    assert.deepStrictEqual(masked.variables.map((v) => v.value), ["••••", "••••"]);
    assert.strictEqual(masked.short.password, "••••", "short secrets reveal nothing");
    assert.strictEqual(masked.variables[0].key, "PORT");
  });

  it("maskValue shows only the last four characters", () => {
    assert.strictEqual(maskValue("abcdefgh"), "••••efgh");
    assert.strictEqual(maskValue("abcd"), "••••");
  });

  it("maskParams does not modify its input", () => {
    const input = ENV_PARAMS("keep-me-original");
    maskParams(input);
    assert.strictEqual(input.variables[0].value, "keep-me-original");
  });
});

describe("P5. Redactor covers every new pattern (§10.4)", () => {
  const leaks = (text, secrets) => {
    const out = SecretRedactor.redactText(text);
    for (const s of secrets) assert.ok(!out.includes(s), `leaked "${s}" in: ${out}`);
    return out;
  };

  it("Authorization Bearer and Basic headers", () => {
    leaks("Authorization: Bearer shorttok9", ["shorttok9"]);
    leaks("Authorization: Basic dXNlcjpwYXNzd29yZA==", ["dXNlcjpwYXNz"]);
    const bare = leaks("header Basic dXNlcjpwYXNzd29yZHZhbHVl", ["dXNlcjpwYXNz"]);
    assert.ok(bare.includes("Basic [REDACTED_TOKEN]"));
  });

  it("JWT and Liara-style JWT tokens", () => {
    leaks("jwt=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhYmNkZWYifQ.c2lnbmF0dXJlMTIz", ["eyJhbGciOiJIUzI1NiJ9"]);
  });

  it("URI credentials, including a password that contains '@'", () => {
    const out = leaks("dial postgres://admin:p@ss:w0rd@10.0.0.1:5432/db", ["w0rd", "p@ss"]);
    assert.ok(out.includes("10.0.0.1:5432/db"), "host must survive");
    assert.ok(out.includes("admin:[REDACTED]@"));
  });

  it("OpenAI, OpenAI-project and Anthropic style keys", () => {
    leaks("key sk-proj-abcdefghijklmnopqrstuvwx1234 end", ["abcdefghijklmnopqrstuvwx1234"]);
    leaks("key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123 end", ["abcdefghijklmnopqrstuvwxyz0123"]);
    leaks("key sk-abcdefghijklmnopqrstuvwxyz12 end", ["abcdefghijklmnopqrstuvwxyz12"]);
  });

  it("AWS access key IDs and aws_secret_access_key", () => {
    leaks("id AKIAIOSFODNN7EXAMPLE", ["AKIAIOSFODNN7EXAMPLE"]);
    leaks("aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", ["wJalrXUtnFEMI"]);
  });

  it("GitHub classic and fine-grained tokens", () => {
    leaks("token ghp_abcdefghijklmnopqrstuvwxyz0123456789", ["abcdefghijklmnopqrstuvwxyz0123456789"]);
    leaks("token github_pat_11ABCDEFG0123456789_abcdefghijklmnop", ["11ABCDEFG0123456789_abcdefghijklmnop"]);
  });

  it("query-string secrets keep the rest of the URL", () => {
    const out = leaks(
      "GET https://api.example.com/v1/x?api_key=SUPERSECRET111&page=2 and ?token=TOKVAL222 &access_token=ATV333 &password=PWV444",
      ["SUPERSECRET111", "TOKVAL222", "ATV333", "PWV444"],
    );
    assert.ok(out.includes("page=2"));
  });

  it("PEM private key blocks, complete and truncated", () => {
    leaks("-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEAabc\n-----END RSA PRIVATE KEY-----", ["MIIEpAIBAAKCAQEAabc"]);
    leaks("-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANtruncated", ["MIIEvQIBADANtruncated"]);
  });

  it("sensitive env lines", () => {
    leaks("LIARA_API_TOKEN=liara-live-value-123", ["liara-live-value-123"]);
  });

  it("instance redactor masks literal values of length >= 8 and ignores shorter ones", () => {
    const r = new SecretRedactor({ literals: ["liara-tok-9f8e7d6c"] });
    assert.strictEqual(r.addLiteral("abc"), false);
    assert.strictEqual(r.addLiteral("abcdefgh"), true);
    const out = r.redactText("token is liara-tok-9f8e7d6c and abcdefgh and abc");
    assert.ok(!out.includes("liara-tok-9f8e7d6c"));
    assert.ok(!out.includes("abcdefgh"));
    assert.ok(out.endsWith("and abc"));
  });

  it("env option takes values of sensitive-named variables only", () => {
    const r = new SecretRedactor({ env: { LIARA_API_TOKEN: "env-token-value-42", HOME_DIR: "/root/home/dir" } });
    const out = r.redactText("HOME_DIR=/root/home/dir token env-token-value-42");
    assert.ok(!out.includes("env-token-value-42"));
    assert.ok(out.includes("/root/home/dir"));
  });

  it("redactDeep walks objects and arrays and masks sensitive keys", () => {
    const r = new SecretRedactor();
    const input = {
      name: "chaos-shop",
      password: "hunter2hunter2",
      count: 5,
      nested: { list: ["postgres://u:pw-long-secret@h/db", { apiKey: "k-123456789" }] },
    };
    const out = r.redactDeep(input);
    const text = JSON.stringify(out);
    assert.ok(!text.includes("hunter2"));
    assert.ok(!text.includes("pw-long-secret"));
    assert.ok(!text.includes("k-123456789"));
    assert.strictEqual(out.count, 5);
    assert.strictEqual(out.name, "chaos-shop");
    assert.strictEqual(input.password, "hunter2hunter2", "input is not modified");
  });

  it("redactDeep survives circular references", () => {
    const r = new SecretRedactor();
    const a = { label: "x" };
    a.self = a;
    const out = r.redactDeep(a);
    assert.strictEqual(out.self, "[CIRCULAR]");
  });

  it("static redactText and redactObject keep their existing behaviour", () => {
    assert.strictEqual(SecretRedactor.redactObject({ password: "p" }).password, "[REDACTED_SECRET]");
    assert.strictEqual(SecretRedactor.redactText("plain text stays"), "plain text stays");
  });
});

describe("P6. Audit file persistence and tamper detection (§10.4)", () => {
  const KEY = "audit-test-key-0001";

  function entry(extra = {}) {
    return {
      event: "executed",
      tool: "app_restart",
      riskLevel: "L2",
      caller: "agent",
      paramsHash: "h".repeat(64),
      approvalId: "apr_1",
      success: true,
      mode: "simulated",
      durationMs: 12,
      ...extra,
    };
  }

  it("appends JSONL, reloads on start and continues the chain", () => {
    const file = path.join(tmpDir(), "audit.jsonl");
    const first = new AuditLedger({ filePath: file, key: KEY });
    first.append(entry());
    first.append(entry({ tool: "deploy", mode: "live", durationMs: 30 }));
    first.append(entry({ tool: "app_update_envs" }));

    const lines = fs.readFileSync(file, "utf8").trim().split("\n");
    assert.strictEqual(lines.length, 3);
    assert.strictEqual(JSON.parse(lines[1]).mode, "live");

    const second = new AuditLedger({ filePath: file, key: KEY });
    assert.strictEqual(second.list().length, 3);
    assert.deepStrictEqual(second.verify(), { ok: true });

    const next = second.append(entry({ tool: "domain_add" }));
    assert.strictEqual(next.seq, 4);
    assert.strictEqual(next.previousRecordHash, JSON.parse(lines[2]).recordHash);
    assert.deepStrictEqual(new AuditLedger({ filePath: file, key: KEY }).verify(), { ok: true });
  });

  it("detects an edited line after the file was written, and refuses to append on top of it", () => {
    const file = path.join(tmpDir(), "audit.jsonl");
    const ledger = new AuditLedger({ filePath: file, key: KEY });
    ledger.append(entry());
    ledger.append(entry({ tool: "deploy", durationMs: 30 }));
    ledger.append(entry({ tool: "domain_add" }));

    const lines = fs.readFileSync(file, "utf8").trim().split("\n");
    const forged = lines.map((l, i) => (i === 1 ? l.replace('"tool":"deploy"', '"tool":"app_delete"') : l));
    assert.notDeepStrictEqual(forged, lines);
    fs.writeFileSync(file, forged.join("\n") + "\n");

    const reloaded = new AuditLedger({ filePath: file, key: KEY });
    assert.deepStrictEqual(reloaded.verify(), { ok: false, brokenAt: 2 });
    assert.throws(() => reloaded.append(entry()), /AUDIT_CHAIN_BROKEN/);
  });

  it("detects a changed duration on the last line and a removed middle line", () => {
    const file = path.join(tmpDir(), "audit.jsonl");
    const ledger = new AuditLedger({ filePath: file, key: KEY });
    ledger.append(entry());
    ledger.append(entry({ durationMs: 5 }));
    ledger.append(entry({ durationMs: 7 }));

    const lines = fs.readFileSync(file, "utf8").trim().split("\n");
    fs.writeFileSync(file, lines.map((l, i) => (i === 2 ? l.replace('"durationMs":7', '"durationMs":700') : l)).join("\n") + "\n");
    assert.deepStrictEqual(new AuditLedger({ filePath: file, key: KEY }).verify(), { ok: false, brokenAt: 3 });

    // Removing the middle record: the next record's seq no longer follows, so the break is reported at seq 3.
    fs.writeFileSync(file, [lines[0], lines[2]].join("\n") + "\n");
    assert.deepStrictEqual(new AuditLedger({ filePath: file, key: KEY }).verify(), { ok: false, brokenAt: 3 });
  });

  it("a different key cannot verify the file", () => {
    const file = path.join(tmpDir(), "audit.jsonl");
    new AuditLedger({ filePath: file, key: KEY }).append(entry());
    assert.deepStrictEqual(new AuditLedger({ filePath: file, key: "another-key-0002" }).verify(), { ok: false, brokenAt: 1 });
  });

  it("a persistent ledger needs a key", () => {
    const file = path.join(tmpDir(), "audit.jsonl");
    withEnv("SOKAN_SECRET", undefined, () => {
      assert.throws(() => new AuditLedger({ filePath: file }), /AUDIT_KEY_REQUIRED/);
    });
  });

  it("an ApprovalService writes mode and duration into the file", () => {
    const file = path.join(tmpDir(), "svc-audit.jsonl");
    const svc = new ApprovalService({ secret: "svc-audit-secret", audit: new AuditLedger({ filePath: file, key: "svc-audit-secret" }) });
    svc.recordResult("deploy", { project: "p" }, "agent", true, "done", "apr_9", { mode: "simulated", durationMs: 250 });
    const rec = JSON.parse(fs.readFileSync(file, "utf8").trim());
    assert.strictEqual(rec.mode, "simulated");
    assert.strictEqual(rec.durationMs, 250);
    assert.strictEqual(rec.approvalId, "apr_9");
    assert.strictEqual(rec.success, true);
  });

  it("audit details are redacted before they are stored", () => {
    const svc = new ApprovalService({ secret: "svc-detail-secret" });
    svc.recordResult("app_update_envs", {}, "agent", true, "set DATABASE_URL postgres://u:leaky-pass-99@h/db");
    const detail = svc.audit.list().at(-1).detail;
    assert.ok(!detail.includes("leaky-pass-99"));
  });
});

describe("P7. Ephemeral secret flag (§10.2 point 1)", () => {
  it("is true when no secret is configured, and false with SOKAN_SECRET or an option", () => {
    withEnv("SOKAN_SECRET", undefined, () => {
      assert.strictEqual(new ApprovalService().isEphemeralSecret, true);
      assert.strictEqual(new TokenGuard().isEphemeralSecret, true);
      assert.strictEqual(new ApprovalService({ secret: "explicit-option-secret" }).isEphemeralSecret, false);
    });
    withEnv("SOKAN_SECRET", "env-secret-value-1", () => {
      assert.strictEqual(new ApprovalService().isEphemeralSecret, false);
      assert.strictEqual(new TokenGuard().isEphemeralSecret, false);
    });
    withEnv("SOKAN_SECRET", "", () => {
      assert.strictEqual(new ApprovalService().isEphemeralSecret, true, "empty env value counts as unset");
    });
  });

  it("SOKAN_SECRET is the key: a guard without an argument verifies tokens from a guard with that secret", () => {
    withEnv("SOKAN_SECRET", "shared-env-secret", () => {
      const issuer = new TokenGuard("shared-env-secret");
      const verifier = new TokenGuard();
      const token = issuer.issue("apr_e", "hash", 60_000);
      assert.deepStrictEqual(verifier.verify(token, "hash"), { valid: true });
    });
  });

  it("tokens from one secret are forged for another", () => {
    const token = new TokenGuard("secret-one-xxxx").issue("apr_f", "hash", 60_000);
    assert.strictEqual(new TokenGuard("secret-two-yyyy").verify(token, "hash").error, "FORGED_TOKEN");
  });
});

describe("P8. Standing approvals from a plain config (§7.3)", () => {
  it("normalises a policy object, accepting tool or action, and rejects L3, L1 and cost-bearing rules", () => {
    const cfg = normalizePolicyConfig({
      app: "chaos-shop",
      standingApprovals: [{ tool: "app_restart", when: "probe.down_for >= 3m", maxPerHour: 2 }],
      never: ["app_delete"],
    });
    assert.strictEqual(cfg.app, "chaos-shop");
    assert.deepStrictEqual(cfg.standingApprovals, [
      { action: "app_restart", when: "probe.down_for >= 3m", maxPerHour: 2 },
    ]);
    assert.deepStrictEqual(cfg.never, ["app_delete"]);

    assert.throws(() => normalizePolicyConfig({ app: "a", standingApprovals: [{ tool: "app_delete", when: "t" }] }), /POLICY_INVALID/);
    assert.throws(() => normalizePolicyConfig({ app: "a", standingApprovals: [{ tool: "source_upload", when: "t" }] }), /POLICY_INVALID/);
    assert.throws(() => normalizePolicyConfig({ app: "a", standingApprovals: [{ tool: "app_resize_plan", when: "t" }] }), /cost-bearing/);
    assert.throws(() => normalizePolicyConfig({ app: "a", standingApprovals: [{ tool: "app_restart", when: "t", maxPerHour: 0 }] }), /POLICY_INVALID/);
    assert.throws(() => normalizePolicyConfig({ app: "a", standingApprovals: [{ tool: "app_restart" }] }), /POLICY_INVALID/);
    assert.throws(() => normalizePolicyConfig(null), /POLICY_INVALID/);
  });

  it("loadPolicyConfig reads .sokan/policy.json, returns undefined when absent, and throws on bad JSON", () => {
    const dir = tmpDir();
    const file = path.join(dir, ".sokan", "policy.json");
    assert.strictEqual(loadPolicyConfig(file), undefined);

    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({
      app: "chaos-shop",
      standingApprovals: [{ tool: "app_restart", when: "probe.down_for >= 3m", maxPerHour: 2 }],
      never: ["app_delete"],
    }));
    const cfg = loadPolicyConfig(file);
    assert.strictEqual(cfg.standingApprovals[0].action, "app_restart");

    fs.writeFileSync(file, "{ not json");
    assert.throws(() => loadPolicyConfig(file), /POLICY_INVALID/);
  });

  it("a loaded config grants at most maxPerHour automatic restarts, and only for the named trigger", () => {
    const dir = tmpDir();
    const file = path.join(dir, "policy.json");
    fs.writeFileSync(file, JSON.stringify({
      app: "chaos-shop",
      standingApprovals: [{ tool: "app_restart", when: "probe.down_for >= 3m", maxPerHour: 2 }],
    }));
    const c = clock();
    const svc = new ApprovalService({ now: c.now, secret: "standing-secret", config: loadPolicyConfig(file) });
    const params = { project: "chaos-shop" };
    const trigger = ["probe.down_for >= 3m"];

    const a = svc.request("app_restart", params, CARD, "agent", { systemTriggers: trigger });
    const b = svc.request("app_restart", params, CARD, "agent", { systemTriggers: trigger });
    const c3 = svc.request("app_restart", params, CARD, "agent", { systemTriggers: trigger });
    assert.strictEqual(a.kind, "auto");
    assert.strictEqual(a.via, "standing_approval");
    assert.strictEqual(b.kind, "auto");
    assert.strictEqual(c3.kind, "pending", "third restart within the hour needs a human");

    const other = svc.request("app_restart", params, CARD, "agent", { systemTriggers: ["something.else"] });
    assert.strictEqual(other.kind, "pending", "the agent cannot assert a trigger");
  });

  it("standing approvals never cover L3, cost-bearing or never-listed actions, even if config is hand-built", () => {
    const hand = {
      app: "chaos-shop",
      standingApprovals: [
        { action: "app_delete", when: "t" },
        { action: "app_resize_plan", when: "t" },
        { action: "app_restart", when: "t" },
      ],
      never: ["app_restart"],
    };
    const svc = new ApprovalService({ secret: "hand-built", config: hand });
    assert.strictEqual(svc.request("app_delete", { name: "x" }, CARD, "agent", { systemTriggers: ["t"] }).kind, "pending");
    assert.strictEqual(svc.request("app_resize_plan", { project: "p" }, CARD, "agent", { systemTriggers: ["t"] }).kind, "pending");
    assert.strictEqual(svc.request("app_restart", { project: "p" }, CARD, "agent", { systemTriggers: ["t"] }).kind, "pending");

    const direct = new StandingApprovals({ app: "a", standingApprovals: [{ action: "app_create", when: "t" }] }, () => 0);
    assert.strictEqual(direct.allows("app_create", "L2", ["t"]), false);
    assert.ok(COST_BEARING_TOOLS.includes("app_scale"));
  });
});

/**
 * Deterministic secret redaction engine defined in Sokan Whitepaper §7.4 and §10.4.
 * Masks credentials, connection strings, JWTs, API keys and private keys before LLM inspection,
 * logs, or the console API.
 */

import { resolveSecretString } from "./tokens";

const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /auth/i,
  /api[_-]?key/i,
  /private[_-]?key/i,
  /cert/i,
  /credential/i,
  /database[_-]?url/i,
  /conn(?:ection)?[_-]?str(?:ing)?/i
];

const LITERAL_MIN_LENGTH = 8;
const REDACTED_SECRET = "[REDACTED_SECRET]";

const PEM_PRIVATE_KEY_BLOCK = /-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----[\s\S]*?-----END \1-----/g;
const PEM_PRIVATE_KEY_TRUNCATED = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*/g;
const URI_CREDENTIAL_REGEX = /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^:/\s@]+):([^\s/?#]*)@/g;
const QUERY_SECRET_REGEX = /([?&](?:access_token|refresh_token|api_key|apikey|token|password|passwd|pwd|client_secret|secret|auth|key)=)[^&\s#"'<>]+/gi;
const JWT_REGEX = /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g;
const AUTH_HEADER_BEARER_REGEX = /(\bAuthorization\s*:\s*Bearer\s+)[^\s"']+/gi;
const AUTH_HEADER_BASIC_REGEX = /(\bAuthorization\s*:\s*Basic\s+)[^\s"']+/gi;
const BEARER_AUTH_REGEX = /Bearer\s+([a-zA-Z0-9_.~+-]{16,})/gi;
const BARE_BASIC_AUTH_REGEX = /\bBasic\s+[A-Za-z0-9+/]{16,}={0,2}/g;
const OPENAI_STYLE_KEY_REGEX = /\bsk-[A-Za-z0-9_-]{20,}/g; // sk-, sk-proj-, sk-ant-
const AWS_ACCESS_KEY_REGEX = /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g;
const AWS_SECRET_KEY_REGEX = /(aws_secret_access_key["']?\s*[:=]\s*["']?)[A-Za-z0-9/+=]{16,}/gi;
const GITHUB_TOKEN_REGEX = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g;
const ENV_LINE_REGEX = /^([A-Z0-9_]*(?:SECRET|PASSWORD|TOKEN|KEY|PASS|AUTH)[A-Z0-9_]*)=(.+)$/gim;
// EVALUATION R10: provider keys and credentials that appear in logs, config dumps and HTTP headers.
const STRIPE_KEY_REGEX = /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{8,}\b/g;
const SLACK_TOKEN_REGEX = /\bxox[abposr]-[A-Za-z0-9-]{8,}/g;
const GOOGLE_API_KEY_REGEX = /\bAIza[0-9A-Za-z_-]{20,}/g;
const ASSIGNED_SECRET_REGEX = /((?:^|[\s?&;,{(])(?:password|passwd|pwd|secret|client_secret|api[_-]?key|apikey|token|auth)\s*=\s*)[^\s&"';,}]+/gi;
const JSON_SECRET_REGEX = /("(?:password|passwd|pwd|secret|client_secret|apiKey|api_key|apikey|access_token|refresh_token|token)"\s*:\s*")((?:[^"\\]|\\.)*)"/gi;
const X_API_KEY_HEADER_REGEX = /(\bx-api-key\s*:\s*)[^\s"',;]+/gi;
const COOKIE_HEADER_REGEX = /(\b(?:Set-)?Cookie\s*:\s*)[^\r\n]+/gi;
const SOKAN_SESSION_REGEX = /\bsokan_session=[^\s;,"']+/g;
// Colon forms as in YAML and log lines: "secret: x", "token: x", "passwd: x", "api_key: x". Runs after the Bearer rules.
const COLON_SECRET_REGEX = /((?:^|[\s,{(])(?:password|passwd|pwd|secret|client_secret|api[_-]?key|apikey|token)\s*:\s*["']?)[^\s&"';,}]+/gim;
// Stripe webhook signing secrets, npm access tokens and SendGrid API keys (EVALUATION round 3, item 7).
const STRIPE_WEBHOOK_SECRET_REGEX = /\bwhsec_[A-Za-z0-9]{16,}/g;
const NPM_TOKEN_REGEX = /\bnpm_[A-Za-z0-9]{20,}/g;
const SENDGRID_KEY_REGEX = /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g;

export interface SecretRedactorOptions {
  /** Known secret values (for example from .env). Values shorter than 8 characters are ignored. */
  literals?: Iterable<string>;
  /** Environment to scan: values of variables whose names look sensitive become literals. */
  env?: Record<string, string | undefined>;
}

export class SecretRedactor {
  private readonly literals = new Set<string>();

  constructor(opts: SecretRedactorOptions = {}) {
    for (const value of opts.literals ?? []) this.addLiteral(value);
    if (opts.env) {
      for (const [name, value] of Object.entries(opts.env)) {
        if (value && SENSITIVE_KEY_PATTERNS.some((p) => p.test(name))) this.addLiteral(value);
      }
    }
    // The server secret itself must never reach a log or an LLM prompt.
    const secret = resolveSecretString();
    if (secret) this.addLiteral(secret);
  }

  /** Adds a known secret value. Returns false when the value is too short to be safe to match. */
  addLiteral(value: string): boolean {
    if (typeof value !== "string" || value.length < LITERAL_MIN_LENGTH) return false;
    this.literals.add(value);
    return true;
  }

  /** Literal values first (exact matches, longest first), then the pattern rules. */
  redactText(text: string): string {
    if (!text || typeof text !== "string") return text;
    let redacted = text;
    for (const literal of [...this.literals].sort((a, b) => b.length - a.length)) {
      redacted = redacted.split(literal).join(REDACTED_SECRET);
    }
    return SecretRedactor.redactText(redacted);
  }

  /** Recursively redacts strings, and primitive values under sensitive keys, in objects and arrays. */
  redactDeep<T>(obj: T): T {
    return this.redactDeepInner(obj, []);
  }

  /**
   * Redacts sensitive strings, connection URIs, JWTs, API keys, private keys and bearer tokens from free-form text.
   */
  public static redactText(text: string): string {
    if (!text || typeof text !== "string") {
      return text;
    }

    let redacted = text;

    // 1. PEM private key blocks (complete, then truncated)
    redacted = redacted.replace(PEM_PRIVATE_KEY_BLOCK, "[REDACTED_PRIVATE_KEY]");
    redacted = redacted.replace(PEM_PRIVATE_KEY_TRUNCATED, "[REDACTED_PRIVATE_KEY]");

    // 1b. Cookies (whole header value), session cookie, JSON and assigned secrets, x-api-key headers
    redacted = redacted.replace(COOKIE_HEADER_REGEX, (_match, prefix) => `${prefix}[REDACTED_COOKIE]`);
    redacted = redacted.replace(SOKAN_SESSION_REGEX, "sokan_session=[REDACTED]");
    redacted = redacted.replace(JSON_SECRET_REGEX, (_match, prefix) => `${prefix}[REDACTED]"`);
    redacted = redacted.replace(ASSIGNED_SECRET_REGEX, (_match, prefix) => `${prefix}[REDACTED]`);
    redacted = redacted.replace(X_API_KEY_HEADER_REGEX, (_match, prefix) => `${prefix}[REDACTED_API_KEY]`);
    redacted = redacted.replace(STRIPE_KEY_REGEX, "[REDACTED_API_KEY]");
    redacted = redacted.replace(SLACK_TOKEN_REGEX, "[REDACTED_TOKEN]");
    redacted = redacted.replace(GOOGLE_API_KEY_REGEX, "[REDACTED_API_KEY]");

    // 2. URI user:password. The password may contain '@'; it extends to the last '@' before the host.
    redacted = redacted.replace(URI_CREDENTIAL_REGEX, (_match, protocol, user) => `${protocol}${user}:[REDACTED]@`);

    // 3. Secrets in query strings (?token=, &api_key=, ...)
    redacted = redacted.replace(QUERY_SECRET_REGEX, (_match, prefix) => `${prefix}[REDACTED]`);

    // 4. Authorization headers (Bearer and Basic), then bare tokens
    redacted = redacted.replace(AUTH_HEADER_BEARER_REGEX, (_match, prefix) => `${prefix}[REDACTED_TOKEN]`);
    redacted = redacted.replace(AUTH_HEADER_BASIC_REGEX, (_match, prefix) => `${prefix}[REDACTED_TOKEN]`);
    redacted = redacted.replace(JWT_REGEX, "[REDACTED_JWT]");
    redacted = redacted.replace(BEARER_AUTH_REGEX, "Bearer [REDACTED_TOKEN]");
    redacted = redacted.replace(BARE_BASIC_AUTH_REGEX, "Basic [REDACTED_TOKEN]");
    redacted = redacted.replace(COLON_SECRET_REGEX, (_match, prefix) => `${prefix}[REDACTED]`);

    // 5. Provider keys
    redacted = redacted.replace(OPENAI_STYLE_KEY_REGEX, "[REDACTED_API_KEY]");
    redacted = redacted.replace(AWS_ACCESS_KEY_REGEX, "[REDACTED_AWS_KEY]");
    redacted = redacted.replace(AWS_SECRET_KEY_REGEX, (_match, prefix) => `${prefix}[REDACTED_SECRET]`);
    redacted = redacted.replace(GITHUB_TOKEN_REGEX, "[REDACTED_GITHUB_TOKEN]");
    redacted = redacted.replace(STRIPE_WEBHOOK_SECRET_REGEX, "[REDACTED_SECRET]");
    redacted = redacted.replace(NPM_TOKEN_REGEX, "[REDACTED_TOKEN]");
    redacted = redacted.replace(SENDGRID_KEY_REGEX, "[REDACTED_API_KEY]");

    // 6. Sensitive env lines (KEY=value)
    redacted = redacted.replace(ENV_LINE_REGEX, (_match, key) => `${key}=[REDACTED_SECRET]`);

    return redacted;
  }

  /**
   * Recursively traverses an object/array and redacts values whose keys match sensitive patterns.
   */
  public static redactObject<T>(obj: T): T {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (typeof obj === "string") {
      return this.redactText(obj) as unknown as T;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.redactObject(item)) as unknown as T;
    }

    if (typeof obj === "object") {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        const isKeySensitive = SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
        if (isKeySensitive && typeof value === "string") {
          result[key] = REDACTED_SECRET;
        } else {
          result[key] = this.redactObject(value);
        }
      }
      return result as T;
    }

    return obj;
  }

  private redactDeepInner<T>(obj: T, ancestors: object[]): T {
    if (typeof obj === "string") return this.redactText(obj) as unknown as T;
    if (obj === null || typeof obj !== "object") return obj;
    if (obj instanceof Date) return obj;
    if (ancestors.includes(obj)) return "[CIRCULAR]" as unknown as T;

    const path = [...ancestors, obj];
    if (Array.isArray(obj)) return obj.map((item) => this.redactDeepInner(item, path)) as unknown as T;

    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const sensitive = SENSITIVE_KEY_PATTERNS.some((p) => p.test(key));
      if (sensitive && (typeof value === "string" || typeof value === "number")) {
        out[key] = REDACTED_SECRET;
      } else {
        out[key] = this.redactDeepInner(value, path);
      }
    }
    return out as T;
  }
}

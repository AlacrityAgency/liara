/**
 * Deterministic secret redaction engine defined in Sokan Whitepaper §7 and §17
 * Masks credentials, connection strings, JWTs, and API tokens before LLM inspection.
 */

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

const URI_CREDENTIAL_REGEX = /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^:@\s]+):([^@\s]+)@/g;
const JWT_REGEX = /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g;
const BEARER_AUTH_REGEX = /Bearer\s+([a-zA-Z0-9_.~+-]{16,})/gi;
const ENV_LINE_REGEX = /^([A-Z0-9_]*(?:SECRET|PASSWORD|TOKEN|KEY|PASS|AUTH)[A-Z0-9_]*)=(.+)$/gim;

export class SecretRedactor {
  /**
   * Redacts sensitive strings, connection URIs, JWTs, and bearer tokens from free-form text.
   */
  public static redactText(text: string): string {
    if (!text || typeof text !== "string") {
      return text;
    }

    let redacted = text;

    // 1. Redact URI user:password (e.g. postgres://user:pass@host:5432/db)
    redacted = redacted.replace(URI_CREDENTIAL_REGEX, (_match, protocol, user, _pass) => {
      return `${protocol}${user}:[REDACTED]@`;
    });

    // 2. Redact JWT tokens
    redacted = redacted.replace(JWT_REGEX, "[REDACTED_JWT]");

    // 3. Redact Bearer authorization headers
    redacted = redacted.replace(BEARER_AUTH_REGEX, "Bearer [REDACTED_TOKEN]");

    // 4. Redact sensitive env lines
    redacted = redacted.replace(ENV_LINE_REGEX, (_match, key, _val) => {
      return `${key}=[REDACTED_SECRET]`;
    });

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
          result[key] = "[REDACTED_SECRET]";
        } else {
          result[key] = this.redactObject(value);
        }
      }
      return result as T;
    }

    return obj;
  }
}

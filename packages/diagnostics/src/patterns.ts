/**
 * Log-line classifiers shared by the extractors and the verifier.
 * DB vs cache is decided here: a Redis line never counts as a database failure (EVALUATION §3).
 */

/** Connection-level failure wording. */
const CONN_FAILURE =
  /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|connection refused|could not connect|can['’]?t reach|connection (?:timed out|closed|reset)|connection terminated|server closed the connection|timed? ?out/i;

/** Ports that identify a database server. */
const DB_PORT = /(?<!\d)(?:5432|3306|27017)(?!\d)/;

/** Host tokens that identify a database, only when they appear in URL/quoted/`at` position. */
const DB_HOST =
  /(?:\/\/|@|["'`]|\bat\s+)(?:postgres(?:ql)?|pg|mysql|mariadb|mongo(?:db)?|db)(?:[-_][\w-]+)?\b/i;

/** Driver and ORM error names that only appear for database connections. */
const DB_DRIVER =
  /PrismaClientInitializationError|\bP1001\b|\bP1017\b|Sequelize(?:Connection|HostNotFound|Timeout)\w*|psycopg2?\b|sqlalchemy\.exc\.OperationalError|\bOperationalError\b|django\.db\.utils|SQLSTATE\[(?:HY000\]\s*\[2002|08\d{3})|PDOException|Mongo(?:Network|Server|oose)\w*Error/i;

/** Pool exhaustion wording. Matched first, so pool lines never count as DB_UNREACHABLE. */
const POOL_PATTERN =
  /remaining connection slots|too many connections|too many clients already|pool timeout|timed out fetching a new connection|connection pool (?:exhausted|timeout)|timeout acquiring a connection|QueuePool limit|SQLSTATE\[53300\]|SQLSTATE\[HY000\]\s*\[1040\]|connection limit exceeded/i;

const REDIS = /redis|ioredis|(?<!\d)6379(?!\d)/i;

// OOM wording: Node, Java (both phrasings), container exit codes and the shell's "Killed" line (EVALUATION R9).
const OOM = /out of memory|oomkilled|javascript heap out of memory|OutOfMemoryError|Java heap space|GC overhead limit exceeded|^\s*Killed\s*$|(?:exit(?:ed)?|code|status)\s*(?:with\s+)?(?:code\s+)?137\b/i;

// Reverse-proxy failures: nginx cannot reach the app behind it (502). Kept apart from upstream timeouts.
const PROXY_DOWN = /connect\(\) failed|upstream prematurely closed|no live upstreams|502 bad gateway|\b502\b.*upstream/i;

const PORT_CONFLICT = /EADDRINUSE|address already in use/i;

const TLS = /unable to verify the first certificate|CERT_HAS_EXPIRED|certificate has expired|self[- ]signed certificate|UNABLE_TO_VERIFY_LEAF_SIGNATURE|SSL certificate problem/i;

const BUILD = /Cannot find module|Module not found|Failed to compile|Build error occurred|ERR_MODULE_NOT_FOUND|next build failed/i;

// "TypeError", "PrismaClientInitializationError" and "local.ERROR" end in Error/Exception/ERROR, so the
// suffix is matched without a leading word boundary.
const ERROR_LINE =
  /(?:error|exception)\b|\b(?:fatal|panic|traceback|critical|SQLSTATE|ECONNREFUSED|ETIMEDOUT|ENOSPC|ENOTFOUND)\b|\bpanic:|Uncaught/i;

export function isPoolExhaustionLine(text: string): boolean {
  return POOL_PATTERN.test(text);
}

/** Returns the matched pool phrase, lower-cased, e.g. "too many connections". */
export function poolLabel(text: string): string | null {
  const m = text.match(POOL_PATTERN);
  return m ? m[0].toLowerCase() : null;
}

export function isDbUnreachableLine(text: string): boolean {
  if (POOL_PATTERN.test(text) || REDIS.test(text)) return false;
  if (!CONN_FAILURE.test(text)) return false;
  return DB_PORT.test(text) || DB_HOST.test(text) || DB_DRIVER.test(text);
}

export function isCacheUnreachableLine(text: string): boolean {
  return REDIS.test(text) && CONN_FAILURE.test(text);
}

export function isOomLine(text: string): boolean {
  return OOM.test(text);
}

export function isUpstreamSlowLine(text: string): boolean {
  return /upstream.*timeout|gateway timeout|slow response from|(?:ETIMEDOUT|timed? ?out).*(?:https?:\/\/|:443\b|:80\b|\bapi\.)/i.test(text);
}

export function isProxyDownLine(text: string): boolean {
  return PROXY_DOWN.test(text);
}

export function isPortConflictLine(text: string): boolean {
  return PORT_CONFLICT.test(text);
}

export function isTlsLine(text: string): boolean {
  return TLS.test(text);
}

export function isBuildLine(text: string): boolean {
  return BUILD.test(text);
}

export function isDiskLine(text: string): boolean {
  return /ENOSPC|no space left on device/i.test(text);
}

/** Any line that looks like an error. Used to find the onset of a failure. */
export function isErrorLine(text: string): boolean {
  return ERROR_LINE.test(text);
}

// Failure wording that is not an "error" or "exception" line (EVALUATION round 3, item 1).
const FAILURE_WORD = /\b(?:failed|failure|invalid|rejected|denied|refused|timeout|timed\s+out|unauthorized|forbidden)\b/i;
/** Persian «خطا» (error) and «ناموفق» (unsuccessful). */
const FAILURE_FA = /خطا|ناموفق/;

/**
 * HTTP status of an access or request line: `"GET /x HTTP/1.1" 502`, `HTTP/1.1 404`, `status=500`, or a
 * Gin-style table cell `| 500 |`. Returns null when the line has no 4xx or 5xx status.
 */
const ACCESS_STATUS = /"\s+(\d{3})\b|\bHTTP\/\d(?:\.\d)?"?\s+(\d{3})\b|\bstatus(?:Code)?\s*[=:]\s*(\d{3})\b|\|\s*(\d{3})\s*\|/i;

export function accessStatus(text: string): number | null {
  const m = text.match(ACCESS_STATUS);
  if (!m) return null;
  const code = Number(m[1] ?? m[2] ?? m[3] ?? m[4]);
  return code >= 400 && code <= 599 ? code : null;
}

/**
 * A line that counts as a failure on its own: error wording, failure words, Persian خطا/ناموفق, or an HTTP 5xx
 * status (5xx is always a failure). A 4xx status alone is not; logparse admits those only when they repeat and rise.
 */
export function isFailureLine(text: string): boolean {
  if (isErrorLine(text) || FAILURE_WORD.test(text) || FAILURE_FA.test(text)) return true;
  const status = accessStatus(text);
  return status !== null && status >= 500;
}

/** Normalised line used as the cluster and signature key, so repeats with different ids or numbers group together. */
export function failureSignature(text: string): string {
  return text.trim().replace(/\b[0-9a-f]{8,}\b/gi, "<id>").replace(/\b\d+\b/g, "<n>").slice(0, 160);
}

/** Port a process reports it listens on, e.g. "App listening on port 3100". */
export function listenedPort(text: string): number | null {
  const m = text.match(/listening (?:on|at)\s+(?:port\s+|https?:\/\/[^\s:]*:|[\d.]*:|:)?(\d{2,5})\b/i);
  return m ? Number(m[1]) : null;
}

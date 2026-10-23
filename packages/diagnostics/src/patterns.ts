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

/** Port a process reports it listens on, e.g. "App listening on port 3100". */
export function listenedPort(text: string): number | null {
  const m = text.match(/listening (?:on|at)\s+(?:port\s+|https?:\/\/[^\s:]*:|[\d.]*:|:)?(\d{2,5})\b/i);
  return m ? Number(m[1]) : null;
}

/**
 * Rate limiting on passcode attempts.
 *
 * A shared passcode with unlimited guesses isn't a passcode. This slows a
 * guessing attempt from thousands a minute to a handful an hour, which is the
 * difference between "brute-forceable over lunch" and "not worth trying".
 *
 * TWO STORES, ONE BEHAVIOUR.
 *
 * When `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are set, counts
 * live in Redis and are shared by every serverless instance. Without them,
 * counts live in this process's memory — which is what local development and
 * the test suite use, and what production used before this.
 *
 * The in-memory store is not merely weaker, it is broken in a specific way: on
 * Vercel each instance has its own memory and instances come and go, so five
 * attempts is five *per instance*. Parallel requests land on different
 * instances and each gets its own budget. That is the bug this fixes, and it
 * cannot be fixed by counting more carefully in the same place.
 *
 * WHY INCR AND NOT READ-MODIFY-WRITE. Two simultaneous guesses that both read
 * "3 failures", both add one, and both write "4" have spent two attempts and
 * recorded one. Redis INCR is atomic — the count is incremented inside Redis
 * and the new value returned — so concurrent attempts cannot overwrite each
 * other. Using a shared store with a read-then-write would reintroduce the same
 * class of miscount it was brought in to remove.
 *
 * IF REDIS IS UNREACHABLE this falls back to the in-memory limiter rather than
 * failing closed. Failing closed on a store outage would lock the whole team
 * out of their own expense reports to guard a passcode-protected tool holding a
 * statement nobody else wants. The fallback is strictly weaker, never absent,
 * and it says so in the server log.
 */

/** Attempts allowed before a lockout. */
const MAX_ATTEMPTS = 5;
/** The window those attempts are counted over. */
const WINDOW_MS = 15 * 60 * 1000;
/** How long a lockout lasts. */
const LOCKOUT_MS = 15 * 60 * 1000;

export interface RateLimitState {
  allowed: boolean;
  /** Attempts left before a lockout. */
  remaining: number;
  /** Seconds until they can try again, when locked out. */
  retryAfterSeconds: number;
}

/* ---------------------------------------------------------------------------
   In-memory store — the fallback, and what tests and local dev run against.
   --------------------------------------------------------------------------- */

interface Attempt {
  failures: number;
  firstFailureAt: number;
  lockedUntil: number;
}

const attempts = new Map<string, Attempt>();

/** Keep the map from growing without bound on a long-lived instance. */
function prune(now: number) {
  if (attempts.size < 500) return;
  for (const [key, record] of attempts) {
    if (now > record.lockedUntil && now - record.firstFailureAt > WINDOW_MS) {
      attempts.delete(key);
    }
  }
}

function memoryCheck(key: string): RateLimitState {
  const now = Date.now();
  const record = attempts.get(key);

  if (record && now < record.lockedUntil) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil((record.lockedUntil - now) / 1000),
    };
  }
  if (record && now - record.firstFailureAt > WINDOW_MS) {
    attempts.delete(key);
    return { allowed: true, remaining: MAX_ATTEMPTS, retryAfterSeconds: 0 };
  }
  return {
    allowed: true,
    remaining: MAX_ATTEMPTS - (record?.failures ?? 0),
    retryAfterSeconds: 0,
  };
}

function memoryFailure(key: string): RateLimitState {
  const now = Date.now();
  prune(now);

  const record = attempts.get(key) ?? {
    failures: 0,
    firstFailureAt: now,
    lockedUntil: 0,
  };
  if (now - record.firstFailureAt > WINDOW_MS) {
    record.failures = 0;
    record.firstFailureAt = now;
  }
  record.failures++;

  if (record.failures >= MAX_ATTEMPTS) {
    record.lockedUntil = now + LOCKOUT_MS;
  }
  attempts.set(key, record);

  return {
    allowed: record.lockedUntil === 0,
    remaining: Math.max(0, MAX_ATTEMPTS - record.failures),
    retryAfterSeconds:
      record.lockedUntil > 0 ? Math.ceil((record.lockedUntil - now) / 1000) : 0,
  };
}

/* ---------------------------------------------------------------------------
   Redis store — shared across every instance.
   --------------------------------------------------------------------------- */

/** Configured only when BOTH variables are present. Half-configured is off. */
function redisConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ""), token };
}

export function usingSharedStore(): boolean {
  return redisConfig() !== null;
}

/**
 * Run Redis commands over Upstash's REST API.
 *
 * A pipeline is one HTTP round trip, which matters on a login path. Throws on
 * any transport or Redis-level error so the caller can fall back — a rate
 * limiter that silently returns "fine" on error is worse than no limiter,
 * because it looks like it's working.
 */
async function redis(
  config: { url: string; token: string },
  commands: (string | number)[][],
): Promise<unknown[]> {
  const res = await fetch(`${config.url}/pipeline`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(commands),
    // Never serve a cached answer to "how many times has this IP failed".
    cache: "no-store",
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error(`Redis HTTP ${res.status}`);

  const body = (await res.json()) as ({ result: unknown } | { error: string })[];
  return body.map((entry) => {
    if ("error" in entry) throw new Error(`Redis: ${entry.error}`);
    return entry.result;
  });
}

const failKey = (key: string) => `expense-runway:fail:${key}`;
const lockKey = (key: string) => `expense-runway:lock:${key}`;

function warn(error: unknown) {
  console.error(
    "[rateLimit] shared store unavailable, falling back to per-instance " +
      "counting for this request:",
    error instanceof Error ? error.message : error,
  );
}

/* ---------------------------------------------------------------------------
   The public interface. Async because a shared store is a network call.
   --------------------------------------------------------------------------- */

export async function checkRateLimit(key: string): Promise<RateLimitState> {
  const config = redisConfig();
  if (!config) return memoryCheck(key);

  try {
    const [lockTtl, failures] = (await redis(config, [
      ["TTL", lockKey(key)],
      ["GET", failKey(key)],
    ])) as [number, string | null];

    // TTL returns -2 when the key is absent and -1 when it has no expiry.
    if (lockTtl > 0) {
      return { allowed: false, remaining: 0, retryAfterSeconds: lockTtl };
    }
    return {
      allowed: true,
      remaining: Math.max(0, MAX_ATTEMPTS - Number(failures ?? 0)),
      retryAfterSeconds: 0,
    };
  } catch (error) {
    warn(error);
    return memoryCheck(key);
  }
}

export async function recordFailure(key: string): Promise<RateLimitState> {
  const config = redisConfig();
  if (!config) return memoryFailure(key);

  try {
    /* INCR first, then set the window's expiry only if the key doesn't already
       have one (NX). Without NX every new failure would push the window out,
       so a steady drip of guesses could never age out and the counter would
       become permanent rather than rolling. */
    const [failures] = (await redis(config, [
      ["INCR", failKey(key)],
      ["EXPIRE", failKey(key), Math.floor(WINDOW_MS / 1000), "NX"],
    ])) as [number, number];

    if (failures >= MAX_ATTEMPTS) {
      const seconds = Math.floor(LOCKOUT_MS / 1000);
      await redis(config, [["SET", lockKey(key), "1", "EX", seconds]]);
      return { allowed: false, remaining: 0, retryAfterSeconds: seconds };
    }
    return {
      allowed: true,
      remaining: Math.max(0, MAX_ATTEMPTS - failures),
      retryAfterSeconds: 0,
    };
  } catch (error) {
    warn(error);
    return memoryFailure(key);
  }
}

/** A correct passcode clears the slate. */
export async function recordSuccess(key: string): Promise<void> {
  attempts.delete(key);
  const config = redisConfig();
  if (!config) return;
  try {
    await redis(config, [["DEL", failKey(key)], ["DEL", lockKey(key)]]);
  } catch (error) {
    warn(error);
  }
}

/** Only used by tests, so one run doesn't lock out the next. */
export function resetRateLimits() {
  attempts.clear();
}

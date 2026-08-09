/**
 * Rate limiting on passcode attempts.
 *
 * A shared passcode with unlimited guesses isn't a passcode. This slows a
 * guessing attempt from thousands a minute to a handful an hour, which is the
 * difference between "brute-forceable over lunch" and "not worth trying".
 *
 * HONEST LIMITATION: this counts in memory, per server instance. On Vercel each
 * serverless instance has its own memory, and instances come and go, so a
 * determined attacker with many parallel requests gets more attempts than the
 * numbers below suggest. For a team tool behind a passcode, holding a
 * statement nobody else wants, that trade is proportionate — a shared external
 * store would be the fix if this ever needed to be stronger, and it's written
 * down here so nobody assumes it's already handled.
 */

/** Attempts allowed before a lockout. */
const MAX_ATTEMPTS = 5;
/** The window those attempts are counted over. */
const WINDOW_MS = 15 * 60 * 1000;
/** How long a lockout lasts. */
const LOCKOUT_MS = 15 * 60 * 1000;

interface Record {
  failures: number;
  firstFailureAt: number;
  lockedUntil: number;
}

const attempts = new Map<string, Record>();

/** Keep the map from growing without bound on a long-lived instance. */
function prune(now: number) {
  if (attempts.size < 500) return;
  for (const [key, record] of attempts) {
    if (now > record.lockedUntil && now - record.firstFailureAt > WINDOW_MS) {
      attempts.delete(key);
    }
  }
}

export interface RateLimitState {
  allowed: boolean;
  /** Attempts left before a lockout. */
  remaining: number;
  /** Seconds until they can try again, when locked out. */
  retryAfterSeconds: number;
}

export function checkRateLimit(key: string): RateLimitState {
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

export function recordFailure(key: string): RateLimitState {
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

/** A correct passcode clears the slate. */
export function recordSuccess(key: string) {
  attempts.delete(key);
}

/** Only used by tests, so one run doesn't lock out the next. */
export function resetRateLimits() {
  attempts.clear();
}

/**
 * The shared passcode, and the signed cookie that remembers you got past it.
 *
 * There are no accounts. One passcode, held in an environment variable, shared
 * by the team — which is proportionate for a tool used by a handful of people
 * who already have access to the underlying statements.
 *
 * WHY A SIGNED COOKIE RATHER THAN "passcode=correct"
 * A cookie is just text the browser sends back, and anyone can edit their own
 * cookies. If the cookie simply said "I'm allowed in", anyone could type that
 * and walk straight past the gate. Instead it carries an expiry plus a
 * signature computed from the passcode. The signature can be *checked* without
 * the passcode being in it, and it can't be *produced* without knowing the
 * passcode. Change the passcode and every existing session stops working, which
 * is exactly what you want when someone leaves the team.
 *
 * Uses Web Crypto, which works in both the Edge middleware and Node routes, so
 * there is one implementation rather than two that could drift.
 */

const ENCODER = new TextEncoder();

/** How long a session lasts before the passcode is asked for again. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
export const SESSION_COOKIE = "expense_runway_session";

async function hmac(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    ENCODER.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, ENCODER.encode(message));
  return [...new Uint8Array(signature)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Compare without leaking, through timing, how much of the value was right.
 *
 * A plain `===` stops at the first wrong character, so a wrong guess that shares
 * a prefix takes measurably longer. Over many attempts that difference can be
 * used to recover a secret one character at a time. This always walks the whole
 * string.
 */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** `<expiry>.<signature>` — readable, tamper-evident, and self-expiring. */
export async function createSessionToken(passcode: string): Promise<string> {
  const expiry = String(Date.now() + SESSION_TTL_MS);
  return `${expiry}.${await hmac(expiry, passcode)}`;
}

export async function isValidSessionToken(
  token: string | undefined,
  passcode: string,
): Promise<boolean> {
  if (!token) return false;
  const [expiry, signature] = token.split(".");
  if (!expiry || !signature) return false;

  const expiresAt = Number(expiry);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;

  return safeEqual(signature, await hmac(expiry, passcode));
}

/**
 * The passcode itself. Never has a default.
 *
 * If APP_PASSCODE isn't set, the app refuses everyone rather than falling back
 * to something guessable — a default passcode is worse than no passcode,
 * because it looks locked.
 */
export function getPasscode(): string | null {
  const value = process.env.APP_PASSCODE;
  return value && value.length > 0 ? value : null;
}

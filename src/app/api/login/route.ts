/**
 * POST /api/login
 *
 * Checks the passcode, rate-limits guessing, and sets the session cookie.
 *
 * The passcode is never sent back, never logged, and never appears in an error
 * message. A failed attempt says "that's not the passcode" and nothing else —
 * no "close", no "wrong length", nothing that narrows a guess.
 */
import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  createSessionToken,
  getPasscode,
  safeEqual,
} from "@/lib/auth";
import { checkRateLimit, recordFailure, recordSuccess } from "@/lib/rateLimit";

export const runtime = "nodejs";

/** Best available caller identity behind Vercel's proxy. */
function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0].trim() || "unknown";
}

export async function POST(request: Request) {
  const passcode = getPasscode();
  if (!passcode) {
    return NextResponse.json(
      {
        error:
          "This app has no passcode set. Whoever deployed it needs to set APP_PASSCODE.",
      },
      { status: 503 },
    );
  }

  const key = clientKey(request);
  const limit = checkRateLimit(key);
  if (!limit.allowed) {
    const minutes = Math.ceil(limit.retryAfterSeconds / 60);
    return NextResponse.json(
      {
        error: `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } },
    );
  }

  let submitted = "";
  try {
    submitted = String(((await request.json()) as { passcode?: string }).passcode ?? "");
  } catch {
    submitted = "";
  }

  if (!safeEqual(submitted, passcode)) {
    const after = recordFailure(key);
    // Deliberately vague, but the attempt count is honest — being told you have
    // two tries left is useful to the person who mistyped, and no use at all to
    // someone guessing, who can count their own attempts anyway.
    return NextResponse.json(
      {
        error: "That's not the passcode.",
        remaining: after.remaining,
        ...(after.retryAfterSeconds > 0 && {
          error: `Too many attempts. Try again in ${Math.ceil(after.retryAfterSeconds / 60)} minutes.`,
        }),
      },
      { status: 401 },
    );
  }

  recordSuccess(key);

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: SESSION_COOKIE,
    value: await createSessionToken(passcode),
    httpOnly: true, // JavaScript on the page can't read it, so a script injection can't steal it
    sameSite: "lax", // not sent from other sites, which blocks cross-site request forgery
    secure: process.env.NODE_ENV === "production", // HTTPS only once deployed
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  return response;
}

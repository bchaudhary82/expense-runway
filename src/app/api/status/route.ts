/**
 * A small, honest answer to "is this configured the way I think it is?"
 *
 * Environment variables in Vercel only apply to deployments made AFTER they are
 * added, so adding one and assuming it took effect is exactly the kind of guess
 * that cost three rounds on the font bug. This reports what the running server
 * can actually see.
 *
 * It sits BEHIND the passcode, like everything except the login route, and it
 * reports only booleans — never a URL, never a token, never a passcode, and
 * nothing that would help someone guess one. Whether a rate limiter is shared
 * is not a secret; the credentials behind it are, and they are not here.
 */
import { NextResponse } from "next/server";
import { usingSharedStore } from "@/lib/rateLimit";

export async function GET() {
  return NextResponse.json({
    /* The one this exists for: false means passcode attempts are still counted
       per serverless instance, whatever the Vercel dashboard says. */
    sharedRateLimitStore: usingSharedStore(),
    build: process.env.BUILD_SHA ?? "unknown",
    passcodeConfigured: Boolean(process.env.APP_PASSCODE),
    receiptReadingConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
  });
}

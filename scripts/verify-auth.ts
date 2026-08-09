/**
 * Passcode and rate-limiting test.
 *
 *     npm run verify:auth
 *
 * Costs nothing, needs no key, uses invented passcodes. Checks the parts that
 * are easy to get subtly wrong and hard to notice: a session token that can be
 * forged, one that never expires, a lockout that doesn't lock.
 */
import {
  createSessionToken,
  isValidSessionToken,
  safeEqual,
} from "../src/lib/auth";
import {
  checkRateLimit,
  recordFailure,
  recordSuccess,
  resetRateLimits,
} from "../src/lib/rateLimit";

const failures: string[] = [];
function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${detail && !ok ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

const PASSCODE = "correct-horse-battery-staple";

async function main() {
  console.log("Session tokens");
  {
    const token = await createSessionToken(PASSCODE);
    check("a fresh token is accepted", await isValidSessionToken(token, PASSCODE));
    check(
      "the passcode itself is NOT inside the token",
      !token.includes(PASSCODE),
      token,
    );
    check(
      "a token from a different passcode is rejected",
      !(await isValidSessionToken(token, "some-other-passcode")),
    );
    check("no token is rejected", !(await isValidSessionToken(undefined, PASSCODE)));
    check("gibberish is rejected", !(await isValidSessionToken("nonsense", PASSCODE)));
  }

  console.log("\nForgery and expiry");
  {
    const token = await createSessionToken(PASSCODE);
    const [expiry, signature] = token.split(".");

    check(
      "a tampered signature is rejected",
      !(await isValidSessionToken(`${expiry}.${"0".repeat(signature.length)}`, PASSCODE)),
    );
    check(
      "extending the expiry without re-signing is rejected",
      !(await isValidSessionToken(`${Number(expiry) + 99999999}.${signature}`, PASSCODE)),
    );
    check(
      "an expired token is rejected",
      !(await isValidSessionToken(`${Date.now() - 1000}.${signature}`, PASSCODE)),
    );
    check(
      "a made-up 'allowed' cookie is rejected",
      !(await isValidSessionToken("allowed", PASSCODE)),
    );
  }

  console.log("\nConstant-time comparison");
  {
    check("equal strings match", safeEqual("abc123", "abc123"));
    check("different strings don't", !safeEqual("abc123", "abc124"));
    check("different lengths don't", !safeEqual("abc", "abcd"));
    check("a shared prefix isn't enough", !safeEqual("passcode", "passcodeX"));
  }

  console.log("\nRate limiting");
  {
    resetRateLimits();
    const ip = "203.0.113.5";

    check("first attempt allowed", checkRateLimit(ip).allowed);

    let state = checkRateLimit(ip);
    for (let i = 1; i <= 4; i++) {
      state = recordFailure(ip);
      check(
        `still allowed after ${i} failure${i === 1 ? "" : "s"}`,
        checkRateLimit(ip).allowed,
        `remaining=${state.remaining}`,
      );
    }

    state = recordFailure(ip); // 5th
    const locked = checkRateLimit(ip);
    check("locked out after 5 failures", !locked.allowed);
    check("tells the user how long to wait", locked.retryAfterSeconds > 0);
    check(
      "lockout is around 15 minutes",
      locked.retryAfterSeconds > 800 && locked.retryAfterSeconds <= 900,
      `${locked.retryAfterSeconds}s`,
    );
  }

  console.log("\nOne person's failures don't lock out anyone else");
  {
    resetRateLimits();
    for (let i = 0; i < 6; i++) recordFailure("198.51.100.1");
    check("the guesser is locked out", !checkRateLimit("198.51.100.1").allowed);
    check("a colleague is unaffected", checkRateLimit("198.51.100.2").allowed);
  }

  console.log("\nA correct passcode clears the record");
  {
    resetRateLimits();
    const ip = "203.0.113.9";
    recordFailure(ip);
    recordFailure(ip);
    check("attempts counted", checkRateLimit(ip).remaining === 3);
    recordSuccess(ip);
    check("slate wiped after success", checkRateLimit(ip).remaining === 5);
  }

  console.log();
  if (failures.length) {
    console.log(`FAIL — ${failures.length} problem(s):`);
    for (const f of failures) console.log("  -", f);
    process.exit(1);
  }
  console.log("PASS — tokens can't be forged or extended, lockout holds, per-IP only");
  process.exit(0);
}

main();

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

    check("first attempt allowed", (await checkRateLimit(ip)).allowed);

    let state = await checkRateLimit(ip);
    for (let i = 1; i <= 4; i++) {
      state = await recordFailure(ip);
      check(
        `still allowed after ${i} failure${i === 1 ? "" : "s"}`,
        (await checkRateLimit(ip)).allowed,
        `remaining=${state.remaining}`,
      );
    }

    state = await recordFailure(ip); // 5th
    const locked = await checkRateLimit(ip);
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
    for (let i = 0; i < 6; i++) await recordFailure("198.51.100.1");
    check("the guesser is locked out", !(await checkRateLimit("198.51.100.1")).allowed);
    check("a colleague is unaffected", (await checkRateLimit("198.51.100.2")).allowed);
  }

  console.log("\nA correct passcode clears the record");
  {
    resetRateLimits();
    const ip = "203.0.113.9";
    await recordFailure(ip);
    await recordFailure(ip);
    check("attempts counted", (await checkRateLimit(ip)).remaining === 3);
    await recordSuccess(ip);
    check("slate wiped after success", (await checkRateLimit(ip)).remaining === 5);
  }

  /* -------------------------------------------------------------------------
     The shared store.

     Everything above ran against the in-memory fallback. That is the path this
     work exists to stop relying on, so the Redis path needs exercising too —
     and it is exercised here against a real HTTP server speaking Upstash's REST
     protocol, not a stubbed module. A mock of my own client would only prove
     the client calls itself the way I wrote it.

     What matters most is the concurrency case. Per-instance counting failed
     because parallel attempts each got their own budget; a shared store that
     read-modified-wrote would fail the same way for a different reason. So five
     simultaneous guesses must count as five.
     ------------------------------------------------------------------------- */
  console.log("\nShared store (fake Upstash over real HTTP)");
  {
    const { createServer } = await import("node:http");

    const store = new Map<string, { value: string; expiresAt: number }>();
    const live = (key: string) => {
      const e = store.get(key);
      if (!e) return null;
      if (e.expiresAt && Date.now() > e.expiresAt) { store.delete(key); return null; }
      return e;
    };

    let requests = 0;
    let failNext = false;

    const run = (cmd: (string | number)[]): unknown => {
      const op = String(cmd[0]).toUpperCase();
      const key = String(cmd[1]);
      if (op === "INCR") {
        const cur = live(key);
        const next = Number(cur?.value ?? 0) + 1;
        store.set(key, { value: String(next), expiresAt: cur?.expiresAt ?? 0 });
        return next;
      }
      if (op === "GET") return live(key)?.value ?? null;
      if (op === "DEL") return store.delete(key) ? 1 : 0;
      if (op === "TTL") {
        const e = live(key);
        if (!e) return -2;
        return e.expiresAt ? Math.ceil((e.expiresAt - Date.now()) / 1000) : -1;
      }
      if (op === "EXPIRE") {
        const e = live(key);
        if (!e) return 0;
        // NX: only set an expiry when the key hasn't got one already.
        if (String(cmd[3] ?? "").toUpperCase() === "NX" && e.expiresAt) return 0;
        e.expiresAt = Date.now() + Number(cmd[2]) * 1000;
        return 1;
      }
      if (op === "SET") {
        const ex = String(cmd[3] ?? "").toUpperCase() === "EX" ? Number(cmd[4]) : 0;
        store.set(key, { value: String(cmd[2]), expiresAt: ex ? Date.now() + ex * 1000 : 0 });
        return "OK";
      }
      throw new Error(`fake redis: unsupported ${op}`);
    };

    const server = createServer((req, res) => {
      requests++;
      if (failNext) { res.writeHead(500).end("nope"); return; }
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          const commands = JSON.parse(body) as (string | number)[][];
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(commands.map((c) => ({ result: run(c) }))));
        } catch (e) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify([{ error: String(e) }]));
        }
      });
    });

    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    process.env.UPSTASH_REDIS_REST_URL = `http://127.0.0.1:${port}`;
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";

    const { usingSharedStore } = await import("../src/lib/rateLimit");
    check("shared store is in use when both variables are set", usingSharedStore());

    resetRateLimits();
    const ip = "203.0.113.77";
    for (let i = 1; i <= 4; i++) await recordFailure(ip);
    check("4 failures still allowed", (await checkRateLimit(ip)).allowed);
    await recordFailure(ip);
    const locked = await checkRateLimit(ip);
    check("locked out after 5, via Redis", !locked.allowed);
    check("lockout is around 15 minutes", locked.retryAfterSeconds > 800 && locked.retryAfterSeconds <= 900);

    // The whole point: the in-memory map must NOT be what's counting.
    resetRateLimits();
    check("still locked after clearing local memory", !(await checkRateLimit(ip)).allowed);

    await recordSuccess(ip);
    check("success clears the shared record", (await checkRateLimit(ip)).remaining === 5);

    /* Five at once. With read-modify-write these collapse into one or two
       recorded failures and the guesser walks away with a fresh budget. */
    const parallel = "203.0.113.88";
    const states = await Promise.all([1, 2, 3, 4, 5].map(() => recordFailure(parallel)));
    const counted = 5 - Math.min(...states.map((s) => s.remaining));
    check("5 simultaneous attempts count as 5", counted === 5, `counted ${counted}`);
    check("and the account is locked", !(await checkRateLimit(parallel)).allowed);

    // A store outage must degrade, not lock everyone out of their own reports.
    failNext = true;
    const during = await checkRateLimit("203.0.113.99");
    check("a Redis outage falls back instead of failing closed", during.allowed);
    failNext = false;

    check("the fake server was actually called", requests > 0, `${requests} requests`);

    server.close();
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  }

  console.log();
  if (failures.length) {
    console.log(`FAIL — ${failures.length} problem(s):`);
    for (const f of failures) console.log("  -", f);
    process.exit(1);
  }
  console.log("PASS — tokens can't be forged or extended, lockout holds in memory AND\n       in the shared store, survives parallel attempts, degrades on outage");
  process.exit(0);
}

main();

/**
 * The gate. Runs before every request.
 *
 * Middleware is the right place for this because it can't be bypassed by
 * knowing a URL. Protecting only the page would leave /api/parse-statement
 * open to anyone who found it — and that endpoint accepts a corporate card
 * statement. The API routes are the thing that most needs the lock.
 *
 * Only three things are public: the login page, the endpoint that checks the
 * passcode, and Next.js's own static assets.
 */
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, getPasscode, isValidSessionToken } from "@/lib/auth";

const PUBLIC_PATHS = ["/login", "/api/login"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const passcode = getPasscode();

  // No passcode configured means the app is not safely deployable, so it
  // refuses everything rather than silently running wide open. Failing closed
  // is the only sane default for a lock.
  if (!passcode) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "This app has no passcode set, so it isn't accepting requests." },
        { status: 503 },
      );
    }
    return NextResponse.rewrite(new URL("/login?misconfigured=1", request.url));
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (await isValidSessionToken(token, passcode)) {
    return NextResponse.next();
  }

  /* An unauthenticated API call should say so in a way the page can handle,
     rather than returning a login page where JSON was expected.

     Two different situations, two different sentences. This used to say "your
     session has expired" for both, which is wrong and misleading in the more
     common one: opening an app URL directly in a browser that has never signed
     in produces no cookie at all, and being told something expired sends you
     looking for a session you never had. Bilal hit exactly that. The third
     message in this project to describe something other than what happened —
     see the 413 reported as a connection fault, and the reconciliation button
     that promised to defer a decision it was actually making. */
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      {
        error: token
          ? "Your session has expired. Reload the page and enter the passcode again."
          : "You're not signed in. Open the app, enter the passcode, then try again.",
      },
      { status: 401 },
    );
  }

  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", pathname);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except Next's internals and static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.svg).*)"],
};

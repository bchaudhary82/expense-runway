import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * These have to stay out of the server bundle.
   *
   * `@napi-rs/canvas` loads a platform-specific native binary (`.node`), which a
   * bundler can't follow — bundling it produces "Cannot find native binding" at
   * runtime, not at build time. `unpdf` ships its own pdf.js build and pulls the
   * canvas in dynamically, so it goes with it.
   */
  serverExternalPackages: ["@napi-rs/canvas", "unpdf"],

  /**
   * Keep the bundled font in the deployed function.
   *
   * The font lives in the repository at a fixed path and is read at runtime, so
   * a bundler has no reason to think it's needed and will leave it behind
   * unless told. Without it the container has no font at all and every PDF
   * renders with its text missing.
   *
   * It sits in assets/ rather than node_modules because resolving a package
   * path inside the bundled server does not work: createRequire(import.meta.url)
   * throws there, which is exactly how the first attempt at this fix came to be
   * dead code.
   */
  outputFileTracingIncludes: {
    "/api/**": ["./assets/fonts/*.woff"],
  },

  /**
   * Stamp the build with the commit it came from.
   *
   * WHY THIS IS HERE. A whole debugging session went into an intermittent
   * failure without anyone being able to say which version was actually
   * running. A fix would go out, the next run would behave like the old code,
   * and there was no way to tell whether the deploy had landed, whether the
   * browser was holding a cached bundle, or whether the bug was real. That
   * uncertainty is more expensive than the bug.
   *
   * `env` inlines the value at BUILD time, so it reaches the browser without
   * depending on Vercel's "expose system environment variables" setting being
   * on. A commit hash is not a secret — it is the same hash that is public in
   * the repository — so this is safe to show before sign-in, which is the whole
   * point: the version has to be readable without getting into the app.
   */
  env: {
    BUILD_SHA: (process.env.VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 7),
  },
};

export default nextConfig;

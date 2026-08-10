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
   * The font files are read at runtime by path, not imported, so a bundler has
   * no reason to think they're needed and will leave them behind. Without them
   * the container has no font at all and every PDF renders with its text
   * missing — which is precisely the production-only bug this fixes.
   */
  outputFileTracingIncludes: {
    "/api/**": ["./node_modules/@fontsource/dejavu-sans/files/*.woff"],
  },
};

export default nextConfig;

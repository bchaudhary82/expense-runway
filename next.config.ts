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
};

export default nextConfig;

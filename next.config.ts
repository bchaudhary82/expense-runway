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
};

export default nextConfig;

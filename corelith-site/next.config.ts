import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Two other packages in this monorepo carry lockfiles, so Next would otherwise walk up, pick
  // the repository root as the workspace root, and resolve out of the wrong node_modules.
  turbopack: { root: path.resolve(import.meta.dirname) },
  outputFileTracingRoot: path.resolve(import.meta.dirname),

  // The existing Firebase website target is static Hosting. Production headers and redirects live
  // in firebase.json because Next's runtime routing layer is not present after a static export.
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;

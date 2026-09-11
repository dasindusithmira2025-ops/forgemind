import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',

  // This site lives inside the Forgespace monorepo, next to the Paralith desktop app. Both have
  // a lockfile, so Next walks up and picks the repository root as the workspace root -- which
  // makes it resolve packages out of Paralith's node_modules (a different major of lucide-react,
  // for one) and trace the wrong files for deployment. Pinning the root to this directory keeps
  // the website on its own dependencies.
  turbopack: {
    root: path.resolve(import.meta.dirname),
  },
  outputFileTracingRoot: path.resolve(import.meta.dirname),
  images: {
    unoptimized: true,
  },
};

export default nextConfig;

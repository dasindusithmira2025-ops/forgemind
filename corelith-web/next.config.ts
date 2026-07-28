import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This site lives inside the Forgespace monorepo, next to the Paralith desktop app. Both have
  // a lockfile, so Next walks up and picks the repository root as the workspace root -- which
  // makes it resolve packages out of Paralith's node_modules (a different major of lucide-react,
  // for one) and trace the wrong files for deployment. Pinning the root to this directory keeps
  // the website on its own dependencies.
  turbopack: {
    root: path.resolve(import.meta.dirname),
  },
  outputFileTracingRoot: path.resolve(import.meta.dirname),

  // Paralith is the only product, so there is no portfolio index to land on. Anything still
  // pointing at /products (old links, search results) goes straight to the product page.
  async redirects() {
    return [
      {
        source: '/products',
        destination: '/products/paralith',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;

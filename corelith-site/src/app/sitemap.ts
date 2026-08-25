import type { MetadataRoute } from "next";
import { site } from "@/content/site";
import { capabilities } from "@/content/capabilities";
import { caseStudies } from "@/content/work";
import { products } from "@/content/products";

export const dynamic = "force-static";

/**
 * Every route that exists and is worth indexing. Generated from the same
 * content the pages are, so a new capability or case study cannot be published
 * without appearing here.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const url = (path: string) => `${site.domain}${path}`;

  const fixed: { path: string; priority: number }[] = [
    { path: "/", priority: 1 },
    { path: "/capabilities", priority: 0.9 },
    { path: "/work", priority: 0.8 },
    { path: "/products", priority: 0.8 },
    { path: "/research", priority: 0.7 },
    { path: "/company", priority: 0.7 },
    { path: "/start-a-project", priority: 0.9 },
    { path: "/contact", priority: 0.6 },
    { path: "/careers", priority: 0.5 },
    { path: "/insights", priority: 0.4 },
    { path: "/privacy", priority: 0.2 },
    { path: "/terms", priority: 0.2 },
  ];

  return [
    ...fixed.map((entry) => ({
      url: url(entry.path),
      lastModified: now,
      priority: entry.priority,
    })),
    ...capabilities.map((capability) => ({
      url: url(`/capabilities/${capability.slug}`),
      lastModified: now,
      priority: 0.8,
    })),
    ...caseStudies.map((study) => ({
      url: url(`/work/${study.slug}`),
      lastModified: now,
      priority: 0.7,
    })),
    ...products.map((product) => ({
      url: url(`/products/${product.slug}`),
      lastModified: now,
      priority: 0.8,
    })),
  ];
}

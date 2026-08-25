import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { site } from "@/content/site";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { RevealRoot } from "@/components/Reveal";

/**
 * One family.
 *
 * The previous system ran four: a display grotesque, an italic serif for
 * emphasis, a humanist sans for reading, and a mono. The serif was the problem
 * — an italic display face reads as fashion and editorial, not as engineering,
 * and it made the company look like a studio rather than a technology company.
 * Removing it removed the reason for the other three to be different from each
 * other, so the whole stack collapses to Geist.
 *
 * Geist is a modern grotesque drawn for interfaces: it stays structural at 128px
 * where a humanist face softens, and stays legible at 15px where a display face
 * falls apart. Hierarchy is therefore carried by weight, scale, colour and line
 * break — never by changing font genre.
 *
 * Both are variable, so the whole site is two font files covering 100–900 rather
 * than nine static cuts. next/font self-hosts and preloads them and emits a
 * size-adjusted fallback, so there is no third-party request and no layout shift.
 */
const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
});

/**
 * Machine values only: versions, identifiers, schema numbers. It is not a brand
 * element and it never sets a label, a heading or navigation.
 */
const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(site.domain),
  title: {
    default: `${site.name} — ${site.statement}`,
    template: `%s | ${site.name}`,
  },
  description: site.descriptor,
  applicationName: site.name,
  authors: [{ name: site.name, url: site.domain }],
  creator: site.name,
  publisher: site.name,
  keywords: [
    "Corelith Technologies",
    "product engineering",
    "AI systems engineering",
    "software automation",
    "infrastructure engineering",
    "technology strategy",
    "Paralith",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "en",
    url: site.domain,
    siteName: site.name,
    title: `${site.name} — ${site.statement}`,
    description: site.descriptor,
  },
  twitter: {
    card: "summary_large_image",
    title: `${site.name} — ${site.statement}`,
    description: site.descriptor,
  },
  robots: { index: true, follow: true },
  formatDetection: { email: false, address: false, telephone: false },
};

// The site is dark, full stop. The UA chrome is told the same thing so form
// controls, scrollbars and the mobile address bar match the page.
export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#0e1015",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Only facts that can be verified go into the organisation graph. No address,
  // no founding date, no employee count, no social profiles — asserting those
  // in structured data would be fabricating them in a machine-readable format.
  const organisation = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: site.name,
    url: site.domain,
    description: site.descriptor,
    email: site.email.general,
  };

  return (
    // Dark is the only theme. Stamped in the server HTML, so it is right in the
    // first paint with no boot script and nothing to hydrate.
    <html
      lang="en"
      data-theme="dark"
      className={`${geist.variable} ${geistMono.variable}`}
    >
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organisation) }}
        />
      </head>
      <body className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="btn btn-primary sr-only z-[var(--z-skip)] focus:not-sr-only focus:absolute focus:top-3 focus:left-3"
        >
          Skip to content
        </a>
        <SiteHeader />
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteFooter />
        <RevealRoot />
      </body>
    </html>
  );
}

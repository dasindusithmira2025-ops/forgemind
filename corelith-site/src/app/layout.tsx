import type { Metadata, Viewport } from "next";
import { Archivo, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { site } from "@/content/site";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { RevealRoot } from "@/components/Reveal";

/**
 * Three faces, three jobs.
 *
 * ARCHIVO is the signage. A grotesque drawn for signage, expanded to 125%
 * for display: it reads as a plate on a machine, not as a magazine headline.
 * Its width is the voice — industrial, wide, certain — and it is never used
 * below section-heading size.
 *
 * INTER is the control room. The running text, the labels, the navigation:
 * a face drawn for interfaces, quiet on purpose so the machinery can be loud.
 *
 * JETBRAINS MONO is the readout. Machine values only — versions, identifiers,
 * measurements — and nothing else. It is not a brand element and never sets a
 * label, a heading or navigation.
 *
 * All three are variable, so the whole site is three font files rather than
 * a dozen static cuts. next/font self-hosts and preloads them and emits a
 * size-adjusted fallback, so there is no third-party request and no layout
 * shift.
 */
const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-archivo",
  display: "swap",
  axes: ["wdth"],
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
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
  themeColor: "#101318",
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
      className={`${archivo.variable} ${inter.variable} ${jetbrains.variable}`}
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

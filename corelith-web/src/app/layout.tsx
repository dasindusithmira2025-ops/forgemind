import type { Metadata, Viewport } from 'next';
import { Chakra_Petch, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { siteConfig } from '@/config/site';

// The voice of the system: squared terminals and a slight condensation that
// give headlines their printed, graphic character and still set clean copy at
// 16px. One family covers display and reading, which is what keeps the pages
// looking like a poster series rather than a website.
const chakra = Chakra_Petch({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-chakra',
  display: 'swap',
});

// Machine face: stamps, versions, checksums.
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.domain),
  title: {
    default: `${siteConfig.name} — ${siteConfig.tagline}`,
    template: `%s | ${siteConfig.name}`,
  },
  description: siteConfig.description,
  keywords: [
    'Corelith Technologies',
    'Paralith',
    'Paralith IDE',
    'Agentic Development Environment',
    'Multi-Agent Coding',
    'Software Architecture',
    'Developer Platforms',
    'Local-First Development Tools',
  ],
  authors: [{ name: siteConfig.name, url: siteConfig.domain }],
  creator: siteConfig.name,
  publisher: siteConfig.name,
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: siteConfig.domain,
    title: siteConfig.name,
    description: siteConfig.description,
    siteName: siteConfig.name,
  },
  twitter: {
    card: 'summary_large_image',
    title: siteConfig.name,
    description: siteConfig.description,
    creator: '@corelithtech',
  },
  robots: {
    index: true,
    follow: true,
  },
};

// The site is dark-only, so the UA chrome is told as much up front: without
// this the browser paints a white background behind the page during navigation.
// The theme colour is the stock itself, so the mobile chrome matches the top
// band rather than banding against it.
export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#070707',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: siteConfig.name,
    url: siteConfig.domain,
    logo: `${siteConfig.domain}/brand/corelith-lockup.png`,
    description: siteConfig.description,
    sameAs: [siteConfig.social.github, siteConfig.social.twitter, siteConfig.social.linkedin],
  };

  return (
    <html lang="en" className={`${chakra.variable} ${jetbrainsMono.variable}`}>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className="bg-paper text-ink flex min-h-screen flex-col antialiased">
        <a
          href="#main"
          className="btn btn-secondary sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-[60]"
        >
          Skip to content
        </a>
        <Header />
        <main id="main" className="flex-grow">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}

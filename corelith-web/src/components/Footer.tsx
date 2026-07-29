import Link from 'next/link';
import { BrandLogo } from './BrandLogo';
import { footerLinks } from '@/data/navigation';
import { siteConfig } from '@/config/site';

type FooterLink = { label: string; href: string; badge?: string };

const COLUMNS: { heading: string; links: FooterLink[] }[] = [
  { heading: 'Paralith', links: footerLinks.products },
  { heading: 'Company', links: footerLinks.company },
  { heading: 'Trust', links: footerLinks.trust },
];

const SOCIAL = [
  { label: 'GitHub', href: siteConfig.social.github },
  { label: 'X', href: siteConfig.social.twitter },
  { label: 'LinkedIn', href: siteConfig.social.linkedin },
];

export function Footer() {
  return (
    <footer className="tone-paper-2 relative isolate overflow-hidden border-t border-[var(--hair)]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-64 bg-[radial-gradient(60%_100%_at_50%_100%,rgba(122,92,255,0.16)_0%,transparent_70%)]"
      />

      <div className="mx-auto max-w-[var(--measure)] px-6 lg:px-10">
        <div className="grid grid-cols-12 gap-x-8 gap-y-12 py-16">
          <div className="col-span-12 space-y-6 lg:col-span-4">
            <BrandLogo size="lg" showTagline />
            <p className="text-ink-soft max-w-sm text-sm">{siteConfig.description}</p>
            <p className="stamp text-success flex items-center gap-2.5">
              <span aria-hidden="true" className="bg-success pulse inline-block h-1.5 w-1.5 rounded-full" />
              All systems operational
            </p>
          </div>

          {COLUMNS.map((column) => (
            <nav key={column.heading} aria-label={column.heading} className="col-span-6 lg:col-span-2">
              <h2 className="stamp text-ink-faint border-b border-[var(--hair)] pb-3">
                {column.heading}
              </h2>
              <ul className="mt-4 space-y-3">
                {column.links.map((link) => (
                  <li key={link.href}>
                    {/* Inline, not inline-flex: a flex anchor makes the label and
                        the badge separate items, and the badge jumps to the end of
                        the first line as soon as the label wraps. */}
                    <Link
                      href={link.href}
                      className="text-ink-soft hover:text-ink text-sm transition-colors"
                    >
                      {link.label}
                      {link.badge && (
                        <span className="stamp text-ember-ink ml-2 whitespace-nowrap">
                          [{link.badge}]
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}

          <div className="col-span-12 lg:col-span-2">
            <h2 className="stamp text-ink-faint border-b border-[var(--hair)] pb-3">Elsewhere</h2>
            <ul className="mt-4 space-y-3">
              {SOCIAL.map((social) => (
                <li key={social.label}>
                  <a
                    href={social.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-ink-soft hover:text-ink text-sm transition-colors"
                  >
                    {social.label} <span aria-hidden="true">↗</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="stamp text-ink-faint flex flex-col gap-3 border-t border-[var(--hair)] py-6 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} {siteConfig.name}
          </p>
          <p className="flex flex-wrap items-center gap-3">
            <span>{siteConfig.domain.replace('https://www.', '')}</span>
            <span aria-hidden="true" className="text-ember">
              ◆
            </span>
            <span>{siteConfig.legal.jurisdiction}</span>
          </p>
        </div>
      </div>

      {/* Wordmark bled off the bottom edge — the last thing on the page is the
          name, set as large as the sheet allows and faded into the canvas. */}
      <p
        aria-hidden="true"
        className="font-display text-ink -mb-[0.17em] w-full text-center text-[clamp(3rem,15vw,14rem)] leading-[0.75] font-semibold tracking-[-0.05em] uppercase opacity-[0.045] select-none"
      >
        Corelith
      </p>
    </footer>
  );
}

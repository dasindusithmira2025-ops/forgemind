'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { mainNavLinks } from '@/data/navigation';
import { BrandLogo } from './BrandLogo';

export function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 8);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Lock scroll when the mobile drawer is open.
  useEffect(() => {
    document.body.style.overflow = mobileMenuOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileMenuOpen]);

  // Close the drawer on route change. The navigation is what changes the route, so reacting to
  // the committed pathname is the only place that catches every case (link tap, browser back,
  // programmatic push) without duplicating the reset across each handler.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMobileMenuOpen(false);
  }, [pathname]);

  const isCurrent = (href: string) =>
    pathname === href || (href !== '/' && pathname.startsWith(href));

  return (
    <>
      {/* Release strip. Scrolls away with the page — it is news, not chrome. */}
      <div className="border-b border-[var(--hair)] bg-paper-2">
        <div className="mx-auto flex max-w-[var(--measure)] items-center justify-center gap-3 px-6 py-2.5 lg:px-10">
          <span aria-hidden="true" className="node pulse shrink-0" />
          <p className="stamp text-ink-soft truncate">
            Paralith v0.9.4 preview is available
            <Link
              href="/products/paralith#release-notes"
              className="text-core-ink hover:text-ink ml-3 underline decoration-1 underline-offset-4 transition-colors"
            >
              Read the changelog →
            </Link>
          </p>
        </div>
      </div>

      <header
        className={`sticky top-0 z-50 transition-colors duration-200 ${
          scrolled
            ? 'border-b border-[var(--hair)] bg-paper/80 backdrop-blur-xl'
            : 'border-b border-transparent bg-paper/40 backdrop-blur-md'
        }`}
      >
        <div className="mx-auto flex max-w-[var(--measure)] items-center justify-between gap-8 px-6 py-3.5 lg:px-10">
          <BrandLogo size="md" showTagline />

          {/* Desktop navigation — one baseline, hover fills a soft plate. */}
          <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
            {mainNavLinks.map((link) => {
              const active = isCurrent(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? 'page' : undefined}
                  className={`rounded-md px-3.5 py-2 text-sm transition-colors ${
                    active
                      ? 'text-ink bg-[rgba(245,237,224,0.09)]'
                      : 'text-ink-soft hover:text-ink hover:bg-[rgba(245,237,224,0.06)]'
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>

          <div className="hidden items-center gap-3 md:flex">
            <Link href="/contact" className="btn btn-ghost">
              Contact
            </Link>
            <Link href="/products/paralith#download" className="btn btn-primary">
              Get Paralith
              <span aria-hidden="true">→</span>
            </Link>
          </div>

          {/* Mobile trigger */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen((open) => !open)}
            className="flex h-10 w-10 items-center justify-center rounded-md border border-[var(--hair-strong)] bg-surface md:hidden"
            aria-label={mobileMenuOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={mobileMenuOpen}
          >
            <span className="relative block h-3 w-4.5" aria-hidden="true">
              <span
                className={`bg-ink absolute left-0 h-px w-full transition-all duration-200 ${
                  mobileMenuOpen ? 'top-1.5 rotate-45' : 'top-0'
                }`}
              />
              <span
                className={`bg-ink absolute top-1.5 left-0 h-px w-full transition-opacity duration-200 ${
                  mobileMenuOpen ? 'opacity-0' : 'opacity-100'
                }`}
              />
              <span
                className={`bg-ink absolute left-0 h-px w-full transition-all duration-200 ${
                  mobileMenuOpen ? 'top-1.5 -rotate-45' : 'top-3'
                }`}
              />
            </span>
          </button>
        </div>

        {/* Mobile drawer — a numbered contents page, anchored to the header so it
            never drifts out of alignment when the header resizes. */}
        {mobileMenuOpen && (
          <div className="bg-paper absolute inset-x-0 top-full flex max-h-[calc(100dvh-4.25rem)] flex-col overflow-y-auto border-b border-[var(--hair)] md:hidden">
            <nav aria-label="Mobile" className="flex flex-col p-3">
              {mainNavLinks.map((link, i) => {
                const active = isCurrent(link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    aria-current={active ? 'page' : undefined}
                    className={`flex items-baseline gap-4 rounded-lg px-4 py-4 ${
                      active ? 'bg-[rgba(245,237,224,0.09)]' : ''
                    }`}
                  >
                    <span className="stamp text-core-ink w-6 shrink-0">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span>
                      <span className="font-display block text-lg font-semibold tracking-tight">
                        {link.label}
                      </span>
                      <span className="text-ink-soft mt-1 block text-sm">{link.description}</span>
                    </span>
                  </Link>
                );
              })}
            </nav>

            <div className="mt-auto space-y-3 border-t border-[var(--hair)] p-4">
              <Link
                href="/products/paralith#download"
                className="btn btn-primary btn-lg w-full justify-center"
              >
                Download preview <span aria-hidden="true">→</span>
              </Link>
              <Link href="/contact" className="btn btn-secondary btn-lg w-full justify-center">
                Contact the team
              </Link>
            </div>
          </div>
        )}
      </header>
    </>
  );
}

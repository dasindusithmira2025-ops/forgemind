'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { mainNav } from '@/data/navigation';
import type { NavItem, NavPanelAside, NavPanelItem } from '@/types';
import { BrandLogo } from './BrandLogo';

/** Grace period before a panel closes on pointer-out, so a diagonal cursor path
 *  from the trigger to the panel body does not dismiss it mid-travel. */
const CLOSE_DELAY_MS = 120;

export function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const pathname = usePathname();

  const navRef = useRef<HTMLDivElement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 8);
      // The header is sticky, so an open panel would ride down the page with it
      // and sit over content the reader has moved on to. Scrolling is a clear
      // signal the menu is no longer what they are doing.
      setOpenMenuId(null);
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

  // Close everything on route change. The navigation is what changes the route, so reacting to
  // the committed pathname is the only place that catches every case (link tap, browser back,
  // programmatic push) without duplicating the reset across each handler.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMobileMenuOpen(false);
    setOpenMenuId(null);
  }, [pathname]);

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpenMenuId(null), CLOSE_DELAY_MS);
  }, [cancelClose]);

  useEffect(() => cancelClose, [cancelClose]);

  /** Dismiss on Escape, returning focus to the trigger the panel belongs to. */
  useEffect(() => {
    if (!openMenuId) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      triggerRefs.current[openMenuId]?.focus();
      setOpenMenuId(null);
    };

    // A pointer landing anywhere outside the nav dismisses the panel. Bound to the
    // capture phase so it still fires when the press lands on a child that stops
    // propagation on its way up.
    const onPointerDown = (event: PointerEvent) => {
      if (navRef.current?.contains(event.target as Node)) return;
      setOpenMenuId(null);
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [openMenuId]);

  const isCurrent = (href: string) => {
    const path = href.split('#')[0];
    return pathname === path || (path !== '/' && pathname.startsWith(path));
  };

  /** A menu trigger is current when the page sits anywhere under it. */
  const isBranchCurrent = (entry: NavItem) =>
    entry.kind === 'link' ? isCurrent(entry.href) : entry.items.some((item) => isCurrent(item.href));

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
          scrolled || openMenuId
            ? 'border-b border-[var(--hair)] bg-paper/80 backdrop-blur-xl'
            : 'border-b border-transparent bg-paper/40 backdrop-blur-md'
        }`}
      >
        <div className="mx-auto flex max-w-[var(--measure)] items-center justify-between gap-8 px-6 py-3.5 lg:px-10">
          <BrandLogo size="md" showTagline />

          {/* Desktop navigation. Two of the three entries open a panel; the row
              itself stays a single baseline so the header never grows. */}
          <div ref={navRef} className="hidden md:block" onMouseLeave={scheduleClose}>
            <nav aria-label="Primary">
              <ul className="flex items-center gap-1">
                {mainNav.map((entry) => {
                  const active = isBranchCurrent(entry);

                  if (entry.kind === 'link') {
                    return (
                      <li key={entry.href}>
                        <Link
                          href={entry.href}
                          aria-current={active ? 'page' : undefined}
                          onMouseEnter={scheduleClose}
                          className={`block rounded-md px-3.5 py-2 text-sm transition-colors ${
                            active
                              ? 'text-ink bg-[rgba(245,237,224,0.09)]'
                              : 'text-ink-soft hover:text-ink hover:bg-[rgba(245,237,224,0.06)]'
                          }`}
                        >
                          {entry.label}
                        </Link>
                      </li>
                    );
                  }

                  const open = openMenuId === entry.id;
                  const panelId = `nav-panel-${entry.id}`;

                  return (
                    <li
                      key={entry.id}
                      className="relative"
                      onMouseEnter={() => {
                        cancelClose();
                        setOpenMenuId(entry.id);
                      }}
                    >
                      <button
                        type="button"
                        ref={(node) => {
                          triggerRefs.current[entry.id] = node;
                        }}
                        aria-expanded={open}
                        aria-controls={panelId}
                        aria-current={active ? 'page' : undefined}
                        onClick={() => setOpenMenuId(open ? null : entry.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'ArrowDown') {
                            event.preventDefault();
                            setOpenMenuId(entry.id);
                            // Wait for the panel to mount before reaching into it.
                            requestAnimationFrame(() => {
                              document
                                .querySelector<HTMLAnchorElement>(`#${panelId} a[href]`)
                                ?.focus();
                            });
                          }
                        }}
                        className={`flex cursor-pointer items-center gap-1.5 rounded-md px-3.5 py-2 text-sm transition-colors ${
                          active || open
                            ? 'text-ink bg-[rgba(245,237,224,0.09)]'
                            : 'text-ink-soft hover:text-ink hover:bg-[rgba(245,237,224,0.06)]'
                        }`}
                      >
                        {entry.label}
                        <span
                          aria-hidden="true"
                          className={`text-ink-faint text-[9px] leading-none transition-transform duration-200 ${
                            open ? 'rotate-180' : ''
                          }`}
                        >
                          ▼
                        </span>
                      </button>

                      {open && (
                        <NavPanel
                          id={panelId}
                          entry={entry}
                          isCurrent={isCurrent}
                          onMouseEnter={cancelClose}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            </nav>
          </div>

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

        {/* Mobile drawer — the same groups as the desktop panels, flattened into
            one scrolling contents page. Anchored to the header so it never drifts
            out of alignment when the header resizes. */}
        {mobileMenuOpen && (
          <div className="bg-paper absolute inset-x-0 top-full flex max-h-[calc(100dvh-4.25rem)] flex-col overflow-y-auto border-b border-[var(--hair)] md:hidden">
            <nav aria-label="Mobile" className="flex flex-col gap-8 p-4">
              {mainNav.map((entry) => {
                const items: NavPanelItem[] =
                  entry.kind === 'link'
                    ? [
                        {
                          label: entry.label,
                          href: entry.href,
                          description: entry.description,
                        },
                      ]
                    : entry.items;

                return (
                  <section key={entry.kind === 'link' ? entry.href : entry.id}>
                    <p className="stamp text-core-ink border-b border-[var(--hair-strong)] pb-3">
                      {entry.kind === 'menu' ? entry.columnKicker : entry.label}
                    </p>

                    <ul>
                      {items.map((item) => (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            aria-current={isCurrent(item.href) ? 'page' : undefined}
                            className="flex items-baseline justify-between gap-4 border-b border-[var(--hair)] py-4"
                          >
                            <span>
                              <span className="font-display block text-base font-semibold tracking-tight">
                                {item.label}
                              </span>
                              <span className="text-ink-soft mt-1 block text-sm">
                                {item.description}
                              </span>
                            </span>
                            {item.badge && (
                              <span className="stamp text-core-ink shrink-0">{item.badge}</span>
                            )}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </nav>

            <div className="mt-auto space-y-3 border-t border-[var(--hair)] p-4">
              <Link
                href="/products/paralith#download"
                className="btn btn-primary btn-lg w-full justify-center"
              >
                Get Paralith <span aria-hidden="true">→</span>
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

/**
 * A navigation panel: destinations ruled down the left, a facts column on the
 * right. The right column states things the reader can verify rather than
 * advertising — a menu is a poor place to make a claim nobody asked for.
 */
function NavPanel({
  id,
  entry,
  isCurrent,
  onMouseEnter,
}: {
  id: string;
  entry: Extract<NavItem, { kind: 'menu' }>;
  isCurrent: (href: string) => boolean;
  onMouseEnter: () => void;
}) {
  const aside: NavPanelAside = entry.aside;

  return (
    <div
      id={id}
      onMouseEnter={onMouseEnter}
      // Centred on the trigger and clamped to the viewport, so neither panel can
      // push past the edge of the page at narrow desktop widths.
      className="absolute top-full left-1/2 z-50 w-[min(46rem,calc(100vw-3rem))] -translate-x-1/2 pt-3"
    >
      <div className="panel overflow-hidden rounded-xl">
        <div className="grid grid-cols-12">
          {/* Destinations */}
          <div className="col-span-12 p-5 sm:col-span-7">
            <p className="stamp text-ink-faint px-3 pb-3">{entry.columnKicker}</p>

            <ul>
              {entry.items.map((item) => {
                const current = isCurrent(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={current ? 'page' : undefined}
                      className={`group block rounded-md px-3 py-2.5 transition-colors ${
                        current
                          ? 'bg-[rgba(245,237,224,0.07)]'
                          : 'hover:bg-[rgba(245,237,224,0.055)]'
                      }`}
                    >
                      <span className="flex items-center gap-2.5">
                        <span className="text-ink group-hover:text-core-ink text-sm font-semibold transition-colors">
                          {item.label}
                        </span>
                        {item.badge && (
                          <span className="stamp text-core-ink border border-core/45 bg-core/10 rounded-sm px-1.5 py-0.5">
                            {item.badge}
                          </span>
                        )}
                      </span>
                      <span className="text-ink-soft mt-1 block text-xs">{item.description}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Facts column */}
          <div className="bg-paper-2 col-span-12 border-t border-[var(--hair)] p-6 sm:col-span-5 sm:border-t-0 sm:border-l">
            <p className="stamp text-core-ink">{aside.kicker}</p>
            <p className="font-display text-ink mt-4 text-base leading-snug font-semibold tracking-tight text-balance">
              {aside.title}
            </p>
            <p className="text-ink-soft mt-3 text-xs">{aside.body}</p>

            <dl className="mt-5 border-t border-[var(--hair)]">
              {aside.facts.map((fact) => (
                <div
                  key={fact.key}
                  className="flex items-baseline justify-between gap-4 border-b border-[var(--hair)] py-2.5"
                >
                  <dt className="stamp text-ink-faint">{fact.key}</dt>
                  <dd
                    className={`text-right font-mono text-xs ${
                      fact.accent ? 'text-core-ink' : 'text-ink'
                    }`}
                  >
                    {fact.value}
                  </dd>
                </div>
              ))}
            </dl>

            <Link
              href={aside.cta.href}
              className="text-core-ink hover:text-ink stamp mt-5 inline-flex items-center gap-2 transition-colors"
            >
              {aside.cta.label}
              <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

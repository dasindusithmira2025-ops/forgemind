'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { mainNav } from '@/data/navigation';
import type { NavItem } from '@/types';
import { BrandLogo } from './BrandLogo';

/** Grace period before a panel closes on pointer-out, so a diagonal cursor path
 *  from the trigger down into the panel does not dismiss it mid-travel. */
const CLOSE_DELAY_MS = 120;

/** A drawn caret, never a `▼` glyph — a text arrow inherits the font's weight
 *  and baseline and reads as a typo. */
function Caret({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 10 6"
      className={`h-[6px] w-[10px] shrink-0 transition-transform duration-200 ${
        open ? 'rotate-180' : ''
      }`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M1 1L5 5L9 1" />
    </svg>
  );
}

export function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const pathname = usePathname();

  const headerRef = useRef<HTMLElement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const panelRef = useRef<HTMLDivElement | null>(null);
  /** Set when the panel was opened from the keyboard, so focus follows it in. */
  const focusPanelOnOpen = useRef(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 8);
      setOpenMenuId(null);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

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

  /**
   * Move focus into a panel opened with ArrowDown. This has to be an effect
   * rather than a callback on the key handler: the panel does not exist until
   * React commits the state change, and a rAF scheduled from the handler can
   * still run before that commit.
   */
  useEffect(() => {
    if (!openMenuId || !focusPanelOnOpen.current) return;
    focusPanelOnOpen.current = false;
    panelRef.current?.querySelector<HTMLAnchorElement>('a[href]')?.focus();
  }, [openMenuId]);

  useEffect(() => {
    if (!openMenuId) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      triggerRefs.current[openMenuId]?.focus();
      setOpenMenuId(null);
    };

    // Bound to the capture phase so it still fires when the press lands on a
    // child that stops propagation on its way up.
    const onPointerDown = (event: PointerEvent) => {
      if (headerRef.current?.contains(event.target as Node)) return;
      setOpenMenuId(null);
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [openMenuId]);

  /** Does this page sit anywhere under `href`? Used to light a nav trigger. */
  const isUnder = (href: string) => {
    const path = href.split('#')[0];
    return pathname === path || (path !== '/' && pathname.startsWith(path));
  };

  /**
   * Is this destination the page itself? Panel rows use this rather than
   * `isUnder`, because every in-page anchor on the product page would otherwise
   * mark itself current and the whole panel would light up at once.
   */
  const isHere = (href: string) => !href.includes('#') && pathname === href;

  const isBranchCurrent = (entry: NavItem) =>
    entry.kind === 'link' ? isUnder(entry.href) : entry.items.some((item) => isUnder(item.href));

  /**
   * Shared geometry for every item in the bar: 14px, medium, 40px tall.
   * `leading-5` is load-bearing — the body scale sets 14px on a 1.6 line, which
   * would make each item 42px and throw the row off the 40px grid.
   */
  const barItem =
    'flex items-center gap-1.5 px-4 py-2.5 text-sm leading-5 font-medium transition-colors duration-200';

  return (
    <header
      ref={headerRef}
      onMouseLeave={scheduleClose}
      className={`bg-paper sticky top-0 z-50 border-b py-4 transition-colors duration-300 ${
        scrolled || openMenuId ? 'border-[var(--hair)]' : 'border-transparent'
      }`}
    >
      <div className="mx-auto flex h-10 max-w-[var(--measure)] items-center gap-6 px-6 lg:px-10">
        <BrandLogo size="sm" />

        <nav aria-label="Primary" className="hidden min-w-0 flex-1 items-center gap-x-2 px-6 lg:flex">
          {mainNav.map((entry) => {
            const active = isBranchCurrent(entry);

            if (entry.kind === 'link') {
              return (
                <Link
                  key={entry.href}
                  href={entry.href}
                  aria-current={active ? 'page' : undefined}
                  onMouseEnter={scheduleClose}
                  className={`${barItem} hover:text-ink ${active ? 'text-ink' : 'text-ink-soft'}`}
                >
                  {entry.label}
                </Link>
              );
            }

            const open = openMenuId === entry.id;

            return (
              <div
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
                  aria-controls="nav-panel"
                  onClick={() => setOpenMenuId(open ? null : entry.id)}
                  onKeyDown={(event) => {
                    if (event.key !== 'ArrowDown') return;
                    event.preventDefault();
                    focusPanelOnOpen.current = true;
                    setOpenMenuId(entry.id);
                  }}
                  className={`${barItem} hover:text-ink cursor-pointer ${
                    active || open ? 'text-ink' : 'text-ink-soft'
                  }`}
                >
                  {entry.label}
                  <Caret open={open} />
                </button>

                {open && (
                  <div
                    id="nav-panel"
                    ref={panelRef}
                    onMouseEnter={cancelClose}
                    // 520px, anchored to the trigger's left edge, 8px clear of the bar.
                    className="absolute top-full left-0 z-50 mt-2 w-[520px] overflow-hidden rounded-2xl border border-[var(--hair)] bg-[rgba(13,15,19,0.95)] shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5)] backdrop-blur-[64px]"
                  >
                    <div className="grid grid-cols-[1fr_1px_1fr]">
                      {/* Destinations */}
                      <div className="p-2.5">
                        <p className="text-ink-faint px-3 pt-1.5 pb-2 text-[10px] leading-none font-medium tracking-[1.5px]">
                          {entry.heading}
                        </p>

                        <ul>
                          {entry.items.map((item) => {
                            const current = isHere(item.href);
                            return (
                              <li key={item.href}>
                                <Link
                                  href={item.href}
                                  aria-current={current ? 'page' : undefined}
                                  className={`flex items-center gap-2 rounded-md px-3 py-2.5 text-sm leading-5 transition-colors hover:bg-[rgba(242,242,244,0.05)] ${
                                    current ? 'text-core-ink' : 'text-ink'
                                  }`}
                                >
                                  {item.label}
                                  {item.badge && (
                                    <span className="text-ink-faint border border-[var(--hair)] bg-[rgba(242,242,244,0.02)] px-1.5 py-px font-mono text-[9px] leading-normal tracking-[1.35px]">
                                      {item.badge}
                                    </span>
                                  )}
                                </Link>
                              </li>
                            );
                          })}
                        </ul>
                      </div>

                      {/* The divider is a column of the grid, not a border, so it
                          runs the full height whichever side is taller. */}
                      <div aria-hidden="true" className="bg-[rgba(242,242,244,0.06)]" />

                      {/* Summary */}
                      <div className="flex flex-col justify-between p-4">
                        <div>
                          <p className="text-ink text-base leading-snug">{entry.aside.heading}</p>
                          <p className="text-ink-soft mt-2 text-xs leading-relaxed">
                            {entry.aside.body}
                          </p>

                          <ul className="mt-4 space-y-2">
                            {entry.aside.facts.map((fact) => (
                              <li
                                key={fact}
                                className="text-ink-faint flex items-center gap-2.5 font-mono text-[11px]"
                              >
                                <span aria-hidden="true" className="node h-1 w-1 shrink-0" />
                                {fact}
                              </li>
                            ))}
                          </ul>
                        </div>

                        <Link
                          href={entry.aside.cta.href}
                          className="text-core-ink hover:text-ink mt-5 inline-flex items-center gap-2 text-xs font-medium transition-colors"
                        >
                          {entry.aside.cta.label}
                          <span aria-hidden="true">→</span>
                        </Link>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="ml-auto hidden items-center gap-4 lg:flex">
          <Link
            href="/contact"
            className="text-ink-soft hover:text-ink text-sm font-medium transition-colors"
          >
            Contact
          </Link>
          <Link
            href="/products/paralith#download"
            className="bg-core rounded-md px-5 py-2 text-sm leading-tight font-semibold text-white transition-colors duration-300 hover:bg-[#3355d8]"
          >
            Get Paralith
          </Link>
        </div>

        <button
          type="button"
          onClick={() => setMobileMenuOpen((open) => !open)}
          className="ml-auto flex h-9 w-9 items-center justify-center lg:hidden"
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

      {mobileMenuOpen && (
        <div className="bg-paper absolute inset-x-0 top-full flex max-h-[calc(100dvh-4.5rem)] flex-col overflow-y-auto border-b border-[var(--hair)] lg:hidden">
          <nav aria-label="Mobile" className="flex flex-col p-6">
            {mainNav.map((entry) => {
              const items =
                entry.kind === 'link'
                  ? [{ label: entry.label, href: entry.href, description: entry.description }]
                  : entry.items;

              return (
                <ul key={entry.kind === 'link' ? entry.href : entry.id} className="mb-7 last:mb-0">
                  {entry.kind === 'menu' && (
                    <li className="text-ink-faint pb-2 text-[10px] leading-none font-medium tracking-[1.5px]">
                      {entry.heading}
                    </li>
                  )}
                  {items.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={isHere(item.href) ? 'page' : undefined}
                        className="block border-b border-[var(--hair)] py-3.5"
                      >
                        <span
                          className={`block text-base ${
                            isHere(item.href) ? 'text-core-ink' : 'text-ink'
                          }`}
                        >
                          {item.label}
                        </span>
                        <span className="text-ink-faint mt-0.5 block text-xs">
                          {item.description}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              );
            })}
          </nav>

          <div className="mt-auto flex items-center gap-4 border-t border-[var(--hair)] p-6">
            <Link
              href="/products/paralith#download"
              className="bg-core flex-1 rounded-md px-4 py-3 text-center text-sm font-semibold text-white"
            >
              Get Paralith
            </Link>
            <Link href="/contact" className="text-ink-soft px-4 py-3 text-sm font-medium">
              Contact
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}

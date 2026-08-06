'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { mainNav } from '@/data/navigation';
import type { NavItem } from '@/types';
import { BrandLogo } from './BrandLogo';

/** Grace period before a panel closes on pointer-out, so a diagonal cursor path
 *  from the trigger down into the panel does not dismiss it mid-travel. */
const CLOSE_DELAY_MS = 120;

/** The only chevron in the system. A drawn caret, never a `▼` glyph — a text
 *  arrow inherits the font's weight and baseline and reads as a typo. */
function Caret({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 10 6"
      className={`h-[5px] w-[9px] shrink-0 transition-transform duration-200 ${
        open ? 'rotate-180' : ''
      }`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
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
      // The header is sticky, so an open panel would ride down the page with it
      // and sit over content the reader has moved on to.
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

  const openEntry = mainNav.find((entry) => entry.kind === 'menu' && entry.id === openMenuId);

  return (
    <header
      ref={headerRef}
      onMouseLeave={scheduleClose}
      // One hairline, and only once the page has moved. No blur, no shadow, no
      // second strip — the bar sits on the stock rather than floating above it.
      className={`bg-paper sticky top-0 z-50 border-b transition-colors duration-200 ${
        scrolled || openMenuId ? 'border-[var(--hair)]' : 'border-transparent'
      }`}
    >
      <div className="mx-auto flex h-14 max-w-[var(--measure)] items-center gap-10 px-6 lg:px-10">
        <div className="flex items-center gap-3">
          <BrandLogo size="sm" />
          {/* The release lives in the bar as a machine value rather than in a strip
              of its own. It is a fact about the build, which is what mono is for. */}
          <Link
            href="/products/paralith#release-notes"
            // Not `.stamp`: that class force-uppercases, and a version string is
            // written with a lowercase v. `.stamp` is unlayered so a `normal-case`
            // utility loses to it — the treatment is spelled out instead.
            className="text-ink-faint hover:text-core-ink hidden font-mono text-xs leading-none font-medium tracking-[0.13em] transition-colors sm:inline"
          >
            v0.9.4
          </Link>
        </div>

        <nav aria-label="Primary" className="hidden md:block">
          <ul className="flex items-center gap-7">
            {mainNav.map((entry) => {
              const active = isBranchCurrent(entry);
              const open = entry.kind === 'menu' && openMenuId === entry.id;

              // The one hover/active device in the bar: a blue rule struck under
              // the word, the same mark `.flare` puts under an accented headline.
              const rule =
                'after:absolute after:inset-x-0 after:-bottom-1.5 after:h-px after:origin-left after:bg-core-ink after:transition-transform after:duration-200';
              const ruleState = active || open ? 'after:scale-x-100' : 'after:scale-x-0';

              if (entry.kind === 'link') {
                return (
                  <li key={entry.href}>
                    <Link
                      href={entry.href}
                      aria-current={active ? 'page' : undefined}
                      onMouseEnter={scheduleClose}
                      className={`text-ink-soft hover:text-ink relative py-1 text-sm transition-colors hover:after:scale-x-100 ${rule} ${ruleState} ${
                        active ? 'text-ink' : ''
                      }`}
                    >
                      {entry.label}
                    </Link>
                  </li>
                );
              }

              return (
                <li key={entry.id} onMouseEnter={() => {
                  cancelClose();
                  setOpenMenuId(entry.id);
                }}>
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
                    className={`text-ink-soft hover:text-ink relative flex cursor-pointer items-center gap-2 py-1 text-sm transition-colors hover:after:scale-x-100 ${rule} ${ruleState} ${
                      active || open ? 'text-ink' : ''
                    }`}
                  >
                    {entry.label}
                    <Caret open={open} />
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="ml-auto hidden items-center gap-6 md:flex">
          <Link href="/contact" className="text-ink-soft hover:text-ink text-sm transition-colors">
            Contact
          </Link>
          {/* The only filled colour in the bar. The mark carries one blue facet;
              so does the header. */}
          <Link
            href="/products/paralith#download"
            className="bg-core rounded-full px-4 py-2 text-sm leading-none font-medium text-white transition-colors hover:bg-[#3355d8]"
          >
            Get Paralith
          </Link>
        </div>

        <button
          type="button"
          onClick={() => setMobileMenuOpen((open) => !open)}
          className="ml-auto flex h-9 w-9 items-center justify-center md:hidden"
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

      {/* The panel. Full-bleed, printed on the second weight of stock with the
          same halftone every band carries, and closed by a hairline — a band of
          the page that happens to be temporary, not a card floating over it. */}
      {openEntry?.kind === 'menu' && (
        <div
          id="nav-panel"
          ref={panelRef}
          onMouseEnter={cancelClose}
          className="tone-paper-2 absolute inset-x-0 top-full hidden border-b border-[var(--hair)] md:block"
        >
          <div className="mx-auto grid max-w-[var(--measure)] grid-cols-12 gap-x-10 px-6 py-10 lg:px-10">
            <ul className="col-span-7 border-t border-[var(--hair)]">
              {openEntry.items.map((item) => {
                const current = isHere(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={current ? 'page' : undefined}
                      className="group flex items-baseline justify-between gap-8 border-b border-[var(--hair)] py-3.5"
                    >
                      <span
                        className={`group-hover:text-core-ink text-[15px] transition-colors ${
                          current ? 'text-core-ink' : 'text-ink'
                        }`}
                      >
                        {item.label}
                      </span>
                      <span className="text-ink-faint text-right text-xs">{item.description}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>

            <div className="col-span-5 col-start-8">
              <div className="border border-[var(--hair)] bg-[rgba(0,0,0,0.32)] p-2">
                <Image
                  src={openEntry.plate.image}
                  alt={openEntry.plate.imageAlt}
                  width={760}
                  height={476}
                  // A fixed plate height rather than a fixed ratio: the two panels
                  // hold six rows and four, and a ratio-sized plate leaves the
                  // shorter one hanging well below its own list.
                  className={`block h-36 w-full ${
                    openEntry.plate.fit === 'cover'
                      ? 'object-cover object-left-top'
                      : 'scale-[0.45] object-contain'
                  }`}
                />
              </div>

              {/* A value, not a key — the system sets values in normal-case mono
                  and reserves uppercase for the label beside them. */}
              <p className="text-ink-faint mt-4 font-mono text-xs leading-none tracking-[0.13em]">
                {openEntry.plate.caption}
              </p>
              <p className="text-ink-soft mt-2 text-sm">{openEntry.plate.statement}</p>

              <Link
                href={openEntry.plate.cta.href}
                className="text-core-ink hover:text-ink mt-4 inline-flex items-center gap-2 text-sm transition-colors"
              >
                {openEntry.plate.cta.label}
                <span aria-hidden="true">→</span>
              </Link>
            </div>
          </div>
        </div>
      )}

      {mobileMenuOpen && (
        <div className="bg-paper absolute inset-x-0 top-full flex max-h-[calc(100dvh-3.5rem)] flex-col overflow-y-auto border-b border-[var(--hair)] md:hidden">
          <nav aria-label="Mobile" className="flex flex-col p-6">
            {mainNav.map((entry) => {
              const items =
                entry.kind === 'link'
                  ? [{ label: entry.label, href: entry.href, description: entry.description }]
                  : entry.items;

              return (
                <ul key={entry.kind === 'link' ? entry.href : entry.id} className="mb-8 last:mb-0">
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
              className="bg-core flex-1 rounded-full px-4 py-3 text-center text-sm font-medium text-white"
            >
              Get Paralith
            </Link>
            <Link href="/contact" className="text-ink-soft px-4 py-3 text-sm">
              Contact
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}

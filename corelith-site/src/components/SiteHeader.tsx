"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { nav } from "@/content/site";
import { Wordmark } from "@/components/Mark";
import { Arrow } from "@/components/primitives";

/**
 * The bar floats.
 *
 * One translucent pill held inside the gutter with air on all four sides, so
 * the page reads as a single white sheet with a control resting on it rather
 * than as a document under a toolbar. The wordmark sits left, the sections are
 * optically centred, and there is exactly one action on the right — in blue,
 * because it is the only thing on the page asking to be clicked.
 */
export function SiteHeader() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeTimer = useRef<number | null>(null);

  // The pill deepens once the page has moved under it. Passive listener, one
  // boolean — no layout read per frame.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Both menus are transient view state that a navigation invalidates. Resetting
  // during render when the route changes is the correct adjustment — doing it in
  // an effect would render one frame of the old menu over the new page first.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpenMenu(null);
    setMobileOpen(false);
  }

  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileOpen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpenMenu(null);
      setMobileOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Pointer intent: a short close delay so crossing the gap between the trigger
  // and the panel does not dismiss it.
  const scheduleClose = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpenMenu(null), 160);
  };
  const cancelClose = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
  };

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header
      className="sticky top-0 z-[var(--z-nav)] pt-[clamp(10px,1.4vw,18px)]"
      onMouseLeave={scheduleClose}
    >
      <div className="shell">
        <div
          className="glass relative flex h-[64px] items-center justify-between gap-6 rounded-[var(--r-full)] border pr-2 pl-5 transition-[box-shadow,border-color] duration-[320ms] sm:pl-7"
          style={{
            borderColor: scrolled || openMenu || mobileOpen ? "var(--hair)" : "transparent",
            boxShadow: scrolled || openMenu || mobileOpen ? "var(--shadow-pill)" : "none",
          }}
        >
          <Wordmark />

          <nav aria-label="Primary" className="absolute left-1/2 hidden -translate-x-1/2 lg:block">
            <ul className="flex items-center gap-7">
              {nav.map((item) => {
                const active = isActive(item.href);
                const hasMenu = Boolean(item.children?.length);
                const open = openMenu === item.href;
                return (
                  <li
                    key={item.href}
                    className="relative"
                    onMouseEnter={() => {
                      cancelClose();
                      setOpenMenu(hasMenu ? item.href : null);
                    }}
                  >
                    <span className="flex items-center gap-1.5 py-5">
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className="border-b-[1.5px] pb-0.5 text-[15px] tracking-[0.004em] transition-colors duration-[180ms] hover:text-[var(--ink)]"
                        style={{
                          color: active || open ? "var(--ink)" : "var(--ink-2)",
                          borderColor: active ? "var(--ink)" : "transparent",
                        }}
                      >
                        {item.label}
                      </Link>
                      {hasMenu ? (
                        <button
                          type="button"
                          aria-expanded={open}
                          aria-label={`${item.label} — show all six`}
                          onClick={() => setOpenMenu(open ? null : item.href)}
                          onFocus={() => setOpenMenu(item.href)}
                          className="cursor-pointer text-[var(--ink-3)] transition-transform duration-[260ms]"
                          style={{ transform: open ? "rotate(180deg)" : "none" }}
                        >
                          <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" fill="none" aria-hidden="true">
                            <path
                              d="M1 3.5 5 7l4-3.5"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                      ) : null}
                    </span>

                    {/* One column of destinations under its own trigger, sized
                        to the list rather than to the page. A menu is a short
                        answer to "where does this go" — not a second layout. */}
                    {hasMenu && open ? (
                      <div
                        className="sheet absolute top-full left-1/2 w-[440px] -translate-x-1/2 p-6"
                        style={{ boxShadow: "var(--shadow-lg)" }}
                        onMouseEnter={cancelClose}
                        onMouseLeave={scheduleClose}
                      >
                        <p
                          className="mono border-b pb-3 text-[var(--ink-3)]"
                          style={{ borderColor: "var(--hair)" }}
                        >
                          Our {item.label}
                        </p>

                        <ul className="mt-1.5">
                          {item.children!.map((child, i) => (
                            <li key={child.href}>
                              <Link
                                href={child.href}
                                className="group flex items-center gap-3.5 rounded-[var(--r-md)] px-2.5 py-3 transition-colors duration-[180ms] hover:bg-[var(--surface-2)]"
                              >
                                <span
                                  className="index grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border"
                                  style={{ borderColor: "var(--hair)" }}
                                >
                                  {String(i + 1).padStart(2, "0")}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block text-[15px] font-medium text-[var(--ink)]">
                                    {child.label}
                                  </span>
                                  <span className="mt-0.5 block text-[13px] leading-[1.5] text-[var(--ink-2)]">
                                    {child.summary}
                                  </span>
                                </span>
                                <span className="shrink-0 text-[var(--ink-3)] transition-colors duration-[180ms] group-hover:text-[var(--accent)]">
                                  <Arrow />
                                </span>
                              </Link>
                            </li>
                          ))}
                        </ul>

                        <div className="mt-1.5 border-t pt-4" style={{ borderColor: "var(--hair)" }}>
                          <Link href={item.href} className="link-go">
                            <span>All {item.label.toLowerCase()}</span>
                            <span className="go-well" aria-hidden="true">
                              <Arrow />
                            </span>
                          </Link>
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="flex items-center gap-2.5">
            <Link href="/start-a-project" className="btn btn-accent hidden h-12 sm:inline-flex">
              Start a project
              <Arrow />
            </Link>
            <button
              type="button"
              className="btn btn-secondary h-12 lg:hidden"
              aria-expanded={mobileOpen}
              aria-controls="site-menu"
              onClick={() => setMobileOpen((open) => !open)}
            >
              {mobileOpen ? "Close" : "Menu"}
            </button>
          </div>
        </div>
      </div>

      {mobileOpen ? <MobileMenu onNavigate={() => setMobileOpen(false)} /> : null}
    </header>
  );
}

/**
 * Not the desktop bar collapsed into a list. The phone gets its own
 * composition: the full information architecture at display size, with the
 * capability set expanded rather than hidden behind a second tap.
 */
function MobileMenu({ onNavigate }: { onNavigate: () => void }) {
  return (
    <div
      id="site-menu"
      className="fixed inset-x-0 top-0 bottom-0 z-[var(--z-menu)] overflow-y-auto lg:hidden"
      style={{ backgroundColor: "var(--ground)" }}
    >
      <div className="bloom" aria-hidden="true" />
      <div className="shell lit flex min-h-full flex-col pt-[92px] pb-12">
        <nav aria-label="Site">
          <ul>
            {nav.map((item, i) => (
              <li key={item.href} className="border-t" style={{ borderColor: "var(--hair)" }}>
                <Link href={item.href} onClick={onNavigate} className="flex items-baseline gap-4 py-6">
                  <span className="index w-7 shrink-0">{String(i + 1).padStart(2, "0")}</span>
                  <span className="min-w-0 flex-1">
                    <span className="font-display block text-[clamp(30px,8vw,42px)] leading-[1.05] font-semibold tracking-[-0.028em] text-[var(--ink)]">
                      {item.label}
                    </span>
                    {item.summary ? (
                      <span className="mt-2.5 block text-[15px] leading-[1.55] text-[var(--ink-2)]">
                        {item.summary}
                      </span>
                    ) : null}
                  </span>
                </Link>

                {item.children?.length ? (
                  <ul className="mb-6 ml-11 flex flex-col gap-1">
                    {item.children.map((child) => (
                      <li key={child.href}>
                        <Link
                          href={child.href}
                          onClick={onNavigate}
                          className="block py-1.5 text-[15px] text-[var(--ink-2)]"
                        >
                          {child.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </nav>

        <div className="mt-auto pt-10">
          <Link href="/start-a-project" onClick={onNavigate} className="btn btn-primary w-full">
            Start a project
            <Arrow />
          </Link>
        </div>
      </div>
    </div>
  );
}

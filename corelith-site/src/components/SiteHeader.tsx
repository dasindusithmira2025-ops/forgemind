"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { nav } from "@/content/site";
import { Wordmark } from "@/components/Mark";
import { Arrow } from "@/components/primitives";

/**
 * The instrument rail.
 *
 * A machined strip pinned to the top of the room: the wordmark on the left,
 * the sections ranged along it, and exactly one amber action on the right —
 * the lamp that means "go". The strip is glass over moving content, the one
 * place blur is allowed, and it deepens once the page has moved under it.
 */
export function SiteHeader() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeTimer = useRef<number | null>(null);

  // The rail deepens once the page has moved under it. Passive listener, one
  // boolean — no layout read per frame.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
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
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenMenu(null);
        setMobileOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Pointer intent: a short close delay so crossing the gap between the trigger
  // and the panel does not dismiss it.
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpenMenu(null), 140);
  };
  const cancelClose = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
  };

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header
      className={`glass fixed inset-x-0 top-0 z-[var(--z-nav)] transition-[box-shadow,border-color] duration-[var(--t-base)] ${
        scrolled
          ? "border-b border-[var(--hair)] shadow-[0_10px_40px_-18px_rgba(0,0,0,0.8)]"
          : "border-b border-transparent"
      }`}
    >
      <div className="shell flex h-[68px] items-center justify-between gap-6">
        <Wordmark />

        {/* The section rail. Optically centred: the wordmark and the action
            balance it, so the sections sit in the middle of the instrument. */}
        <nav aria-label="Primary" className="absolute left-1/2 hidden -translate-x-1/2 lg:block">
          <ul className="flex items-center gap-1">
            {nav.map((item) =>
              item.children ? (
                <li
                  key={item.href}
                  className="relative"
                  onMouseEnter={() => {
                    cancelClose();
                    setOpenMenu(item.href);
                  }}
                  onMouseLeave={scheduleClose}
                >
                  <Link
                    href={item.href}
                    aria-expanded={openMenu === item.href}
                    className={`nav-trigger ${isActive(item.href) ? "is-active" : ""}`}
                    onFocus={() => setOpenMenu(item.href)}
                  >
                    {item.label}
                  </Link>

                  {openMenu === item.href ? (
                    <div className="panel absolute top-[calc(100%+14px)] left-1/2 w-[440px] -translate-x-1/2 p-2">
                      <span className="panel-rim" aria-hidden="true" />
                      <ul className="grid grid-cols-2 gap-1">
                        {item.children.map((child) => (
                          <li key={child.href}>
                            <Link
                              href={child.href}
                              className={`nav-panel-link ${isActive(child.href) ? "is-active" : ""}`}
                            >
                              <span className="flex flex-col gap-1">
                                <span className="text-[14.5px] font-medium text-[var(--ink)]">
                                  {child.label}
                                </span>
                                <span className="text-[12.5px] leading-[1.45] text-[var(--ink-3)]">
                                  {child.summary}
                                </span>
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </li>
              ) : (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`nav-trigger ${isActive(item.href) ? "is-active" : ""}`}
                  >
                    {item.label}
                  </Link>
                </li>
              ),
            )}
          </ul>
        </nav>

        <div className="flex items-center gap-3">
          <Link href="/start-a-project" className="btn btn-primary hidden sm:inline-flex">
            Start a project
            <Arrow />
          </Link>

          <button
            type="button"
            aria-expanded={mobileOpen}
            aria-controls="mobile-menu"
            onClick={() => setMobileOpen((v) => !v)}
            className="nav-burger lg:hidden"
          >
            <span className="sr-only">{mobileOpen ? "Close menu" : "Open menu"}</span>
            <span aria-hidden="true" className="nav-burger-box">
              <span className="nav-burger-bar" data-open={mobileOpen || undefined} />
              <span className="nav-burger-bar" data-open={mobileOpen || undefined} />
            </span>
          </button>
        </div>
      </div>

      {mobileOpen ? <MobileMenu onNavigate={() => setMobileOpen(false)} /> : null}
    </header>
  );
}

/**
 * Not the desktop rail collapsed into a list. The phone gets its own
 * composition: the full information architecture at display size, with the
 * capability set expanded rather than hidden behind a second tap.
 */
function MobileMenu({ onNavigate }: { onNavigate: () => void }) {
  return (
    <div
      id="mobile-menu"
      className="glass fixed inset-x-0 top-[68px] bottom-0 z-[var(--z-menu)] overflow-y-auto overscroll-contain border-t border-[var(--hair)]"
    >
      <div className="shell flex flex-col gap-10 py-10">
        {nav.map((item) => (
          <div key={item.href}>
            <div className="flex items-center gap-3.5">
              <span aria-hidden="true" className="tick" />
              <Link
                href={item.href}
                onClick={onNavigate}
                className="font-display text-[length:var(--step-sub)] leading-[1.05] font-bold text-[var(--ink)]"
              >
                {item.label}
              </Link>
            </div>

            {item.children ? (
              <ul className="mt-5 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                {item.children.map((child) => (
                  <li key={child.href}>
                    <Link
                      href={child.href}
                      onClick={onNavigate}
                      className="group flex flex-col gap-1.5"
                    >
                      <span className="text-[16px] font-medium text-[var(--ink-2)] transition-colors duration-[180ms] group-hover:text-[var(--accent)]">
                        {child.label}
                      </span>
                      <span className="text-[13.5px] leading-[1.45] text-[var(--ink-3)]">
                        {child.summary}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 pl-[34px] text-[14px] text-[var(--ink-3)]">{item.summary}</p>
            )}
          </div>
        ))}

        <Link
          href="/start-a-project"
          onClick={onNavigate}
          className="btn btn-primary mt-2 self-start"
        >
          Start a project
          <Arrow />
        </Link>
      </div>
    </div>
  );
}

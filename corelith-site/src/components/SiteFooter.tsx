import Link from "next/link";
import { footerNav, site } from "@/content/site";
import { Mark } from "@/components/Mark";

/**
 * The machine plate.
 *
 * The footer closes the page rather than terminating it: one solid amber
 * plate, the same in every theme, the single inversion on the site. A page
 * that ends on graphite ends by running out; a page that ends on a finished
 * machine part has been closed — and because it happens exactly once and
 * always in the same place, it reads as a full stop, not as a decoration.
 */
export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="on-plate relative overflow-hidden">
      {/* The plate's own bevel: a dark edge below, a lit edge above. */}
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-[2px] bg-[rgba(255,225,140,0.55)]"
      />
      <div className="shell pt-[clamp(72px,8vw,124px)] pb-12">
        <div className="grid grid-cols-1 gap-x-10 gap-y-14 md:grid-cols-12">
          <div className="md:col-span-4">
            <div className="flex items-center gap-3 text-[var(--ink)]">
              <Mark className="h-8 w-8" />
              <span className="font-display text-[21px] leading-none font-bold tracking-[-0.01em]">
                Corelith
                <span className="mt-2 block text-[11px] font-medium tracking-[0.2em] text-[var(--ink-2)] uppercase">
                  Technologies
                </span>
              </span>
            </div>

            <p className="font-display mt-9 max-w-[16ch] text-[length:var(--step-sub)] leading-[1.12] font-bold tracking-[-0.01em] text-[var(--ink)]">
              Engineering what comes next.
            </p>

            <p className="mt-7 text-[15px] text-[var(--ink-2)]">{site.presence}</p>
          </div>

          {footerNav.map((group) => (
            <nav key={group.heading} aria-label={group.heading} className="md:col-span-2">
              <h2 className="mono text-[var(--ink-2)]">{group.heading}</h2>
              <ul className="mt-6 flex flex-col gap-3">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-[15px] text-[var(--ink-2)] transition-colors duration-[180ms] hover:text-[var(--ink)]"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="rule-strong mt-[clamp(56px,7vw,104px)]" />

        <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[14px] text-[var(--ink-2)]">
            © {year} {site.legal.entity}. All rights reserved.
          </p>
          <div className="flex flex-wrap items-center gap-x-7 gap-y-2">
            <Link
              href="/privacy"
              className="text-[14px] text-[var(--ink-2)] transition-colors duration-[180ms] hover:text-[var(--ink)]"
            >
              Privacy
            </Link>
            <Link
              href="/terms"
              className="text-[14px] text-[var(--ink-2)] transition-colors duration-[180ms] hover:text-[var(--ink)]"
            >
              Terms
            </Link>
            <a
              href={`mailto:${site.email.security}`}
              className="text-[14px] text-[var(--ink-2)] transition-colors duration-[180ms] hover:text-[var(--ink)]"
            >
              {site.email.security}
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

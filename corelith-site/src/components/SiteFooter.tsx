import Link from "next/link";
import { footerNav, site } from "@/content/site";
import { Mark } from "@/components/Mark";

/**
 * The footer closes the page rather than terminating it.
 *
 * It is the one dark surface on the site, in both themes. A page that ends on
 * white ends by running out; a page that ends on a dark block has been closed,
 * and the inversion is legible as a deliberate full stop rather than as another
 * alternating band because it happens exactly once and always in the same
 * place.
 */
export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="on-close relative overflow-hidden">
      <div
        className="bloom"
        aria-hidden="true"
        style={{ "--bloom-x": "62%", "--bloom-y": "30%", "--bloom-x2": "-10%", "--bloom-y2": "56%" } as React.CSSProperties}
      />
      <div className="shell lit pt-[clamp(72px,8vw,124px)] pb-12">
        <div className="grid grid-cols-1 gap-x-10 gap-y-14 md:grid-cols-12">
          <div className="md:col-span-4">
            <div className="flex items-center gap-3 text-[var(--ink)]">
              <Mark className="h-8 w-8" />
              <span className="font-display text-[21px] leading-none font-medium tracking-[-0.025em]">
                Corelith
                <span className="mt-2 block text-[11px] font-medium tracking-[0.2em] text-[var(--ink-3)] uppercase">
                  Technologies
                </span>
              </span>
            </div>

            <p className="font-display mt-9 max-w-[16ch] text-[length:var(--step-sub)] leading-[1.12] font-semibold tracking-[-0.028em] text-[var(--ink)]">
              Engineering what comes next.
            </p>

            <p className="mt-7 text-[15px] text-[var(--ink-3)]">{site.presence}</p>
          </div>

          {footerNav.map((group) => (
            <nav key={group.heading} aria-label={group.heading} className="md:col-span-2">
              <h2 className="mono text-[var(--ink-3)]">{group.heading}</h2>
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

        <div className="seam mt-[clamp(56px,7vw,104px)]" />

        <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[14px] text-[var(--ink-3)]">
            © {year} {site.legal.entity}. All rights reserved.
          </p>
          <div className="flex flex-wrap items-center gap-x-7 gap-y-2">
            <Link
              href="/privacy"
              className="text-[14px] text-[var(--ink-3)] transition-colors duration-[180ms] hover:text-[var(--ink)]"
            >
              Privacy
            </Link>
            <Link
              href="/terms"
              className="text-[14px] text-[var(--ink-3)] transition-colors duration-[180ms] hover:text-[var(--ink)]"
            >
              Terms
            </Link>
            <a
              href={`mailto:${site.email.security}`}
              className="text-[14px] text-[var(--ink-3)] transition-colors duration-[180ms] hover:text-[var(--ink)]"
            >
              {site.email.security}
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

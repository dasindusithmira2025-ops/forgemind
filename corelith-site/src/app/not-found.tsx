import Link from "next/link";
import type { CSSProperties } from "react";
import { nav } from "@/content/site";
import { Arrow } from "@/components/primitives";
import { FieldStatic } from "@/components/visuals/FieldStatic";

/**
 * The dead end, drawn as an instrument fault.
 *
 * The number is the readout: a code that exists to be quoted back, so it gets
 * the datum line a measurement gets. Everything else on the page is the way
 * back into the sequence — the five sections, ranged like an index of the site
 * — and the field, still running, because the instrument does not stop when
 * one address fails to resolve.
 */
export default function NotFound() {
  const delay = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;

  return (
    <section className="on-ground relative flex min-h-[70vh] items-center overflow-hidden">
      <div
        className="bloom"
        aria-hidden="true"
        style={{ "--bloom-x": "50%", "--bloom-y": "-30%", "--bloom-x2": "-14%", "--bloom-y2": "48%" } as CSSProperties}
      />

      <div className="shell lit grid grid-cols-1 items-center gap-12 py-[clamp(56px,8vw,120px)] lg:grid-cols-12">
        <div className="lg:col-span-7">
          <div className="reveal flex items-baseline gap-4">
            <span className="index">404</span>
            <span className="mono text-[var(--ink-3)]">Page not found</span>
          </div>

          {/* The fault is a real readout, so it gets the datum seam a
              measurement gets: amber at the origin, fading into the room. */}
          <hr className="datum-rule reveal-rule mt-5 max-w-[280px]" />

          <h1 className="reveal-wipe mt-8 max-w-[15ch] text-[length:var(--step-page)]">
            That page is not here.
          </h1>

          <p
            className="reveal mt-7 max-w-[46ch] text-[length:var(--step-lead)] leading-[1.5] text-[var(--ink-2)]"
            style={delay(120)}
          >
            Either it moved, or it never existed. Both are worth knowing about — if you followed a
            link from somewhere, tell us where and we will fix it.
          </p>

          <nav aria-label="Main sections" className="reveal mt-12" style={delay(200)}>
            <p className="mono text-[var(--ink-3)]">Try one of these</p>
            <ul className="mt-4">
              {nav.map((item, i) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="group flex items-baseline gap-5 border-t py-4"
                    style={{ borderColor: "var(--hair)" }}
                  >
                    <span className="index">{String(i + 1).padStart(2, "0")}</span>
                    <span className="text-[17px] font-medium text-[var(--ink)] transition-colors duration-[260ms] group-hover:text-[var(--accent)]">
                      {item.label}
                    </span>
                    <span className="ml-auto text-[var(--ink-3)] transition-transform duration-[260ms] group-hover:translate-x-1.5 group-hover:text-[var(--accent)]">
                      <Arrow />
                    </span>
                  </Link>
                </li>
              ))}
              <li className="border-t" style={{ borderColor: "var(--hair)" }} />
            </ul>
          </nav>
        </div>

        <div className="flex justify-center lg:col-span-5">
          <FieldStatic className="h-[clamp(200px,30vw,380px)] w-[clamp(200px,30vw,380px)] text-[var(--ink-3)]" />
        </div>
      </div>
    </section>
  );
}

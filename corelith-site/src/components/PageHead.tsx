import type { ReactNode } from "react";
import { Dim, hasOrdinal } from "@/components/primitives";

/**
 * The opening of an interior page.
 *
 * Deliberately not the homepage hero: no object, no full viewport, no second
 * call to action. An interior page has already won the click, so it opens with
 * its place in the sequence, one display line, and one checkable measurement —
 * then gets on with the content.
 *
 * It carries the light. The homepage is not the only place allowed to feel
 * like the same company, and a hard rule under a heading was the last piece of
 * chrome dividing these pages into a header and a document.
 */
export function PageHead({
  index,
  datum,
  title,
  lead,
  measure,
  aside,
}: {
  index: string;
  datum: string;
  title: ReactNode;
  lead?: ReactNode;
  /** A real, checkable fact about this page's subject. Omitted when there isn't one. */
  measure?: string;
  aside?: ReactNode;
}) {
  return (
    <section className="on-ground relative overflow-hidden">
      <div
        className="bloom"
        aria-hidden="true"
        style={
          {
            "--bloom-x": "56%",
            "--bloom-y": "-46%",
            "--bloom-x2": "-12%",
            "--bloom-y2": "34%",
          } as React.CSSProperties
        }
      />
      <div className="shell lit pt-[clamp(48px,6vw,96px)] pb-[clamp(56px,7vw,112px)]">
        <div className="flex items-center gap-3.5">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
          {hasOrdinal(index) ? <span className="index">{index}</span> : null}
          <span className="mono text-[var(--ink-3)]">{datum}</span>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-x-16 gap-y-9 lg:grid-cols-12">
          <h1 className="reveal-wipe text-[length:var(--step-page)] lg:col-span-7">{title}</h1>
          {lead ? (
            <div className="reveal self-end lg:col-span-5" style={{ "--d": "140ms" } as React.CSSProperties}>
              <p className="max-w-[var(--measure-text)] text-[length:var(--step-lead)] leading-[1.6] text-[var(--ink-2)]">
                {lead}
              </p>
              {aside}
            </div>
          ) : null}
        </div>

        {measure ? (
          <div className="mt-14">
            <div className="seam reveal-rule mb-7" />
            <Dim className="reveal">{measure}</Dim>
          </div>
        ) : null}
      </div>
      <div className="shell lit">
        <div className="seam" />
      </div>
    </section>
  );
}

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

export type Tone = "ground" | "recessed";

/**
 * Sections outside a numbered sequence pass a dash for their index. A dash is
 * the absence of an ordinal, so it is rendered as absence — printing it left a
 * stray mark floating beside the tick on every unnumbered page.
 */
export const hasOrdinal = (index: string) => /[0-9a-z]/i.test(index);

const toneClass: Record<Tone, string> = {
  ground: "on-ground",
  recessed: "on-recessed",
};

/**
 * A page is a stack of rooms, and there are two of them: the panel room
 * #101318, and the channel #0B0E12 cut into it. The channel is where systems
 * live — capabilities, delivery, research — so a reader learns that a darker
 * band means "inside the machine" without being told.
 *
 * `lit` places the amber atmosphere behind a band. Opt-in rather than default,
 * because light everywhere is light nowhere.
 */
export function Band({
  tone = "ground",
  tight = false,
  lit = false,
  bloom,
  id,
  className = "",
  children,
}: {
  tone?: Tone;
  tight?: boolean;
  lit?: boolean;
  bloom?: CSSProperties;
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className={`${toneClass[tone]} ${tight ? "band-tight" : "band"} relative ${className}`}
      style={bloom}
    >
      {lit ? <div className="bloom" aria-hidden="true" /> : null}
      <div className="lit">{children}</div>
    </section>
  );
}

/**
 * The section marker.
 *
 * An amber tick, an index and the section name, held in the margin beside the
 * content on wide screens and folded above it on narrow ones. The tick is the
 * instrument stroke that opens every measured thing on this site.
 */
export function Rail({
  index,
  datum,
  children,
  className = "",
}: {
  index: string;
  datum: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`shell rail ${className}`}>
      <div className="rail-mark">
        <span aria-hidden="true" className="tick" />
        {hasOrdinal(index) ? <span className="index">{index}</span> : null}
        <span className="mono text-[var(--ink-3)]">{datum}</span>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * A checkable fact about the thing beside it. Only correct where the value is
 * real and verifiable — it is not a metric tile and there is nothing to put in
 * it when there is no number.
 */
export function Dim({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`dim ${className}`}>
      <span className="dim-tick text-[var(--step-fine)] leading-snug">{children}</span>
    </div>
  );
}

export function Arrow({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      className={`h-4 w-4 shrink-0 ${className}`}
    >
      <path
        d="M2.75 8h10.5m0 0L9.5 4.25M13.25 8 9.5 11.75"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A label and the arrow in its well. The well is what makes it read as a control. */
export function GoLink({
  href,
  children,
  className = "",
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link href={href} className={`link-go ${className}`}>
      <span>{children}</span>
      <span className="go-well" aria-hidden="true">
        <Arrow />
      </span>
    </Link>
  );
}

/**
 * The emphasis phrase. Instrument amber, same family, weight and size as the
 * words around it. Tint only — it is the single place display type is allowed
 * to carry colour, and it is the identity.
 */
export function Em({ children }: { children: ReactNode }) {
  return <span className="em">{children}</span>;
}

/**
 * The quiet middle step of the emphasis ramp. A headline that runs ink →
 * quiet amber → amber states the palette in one gesture; the light step is
 * what stops a fully-amber second line reading as a shout.
 */
export function EmLight({ children }: { children: ReactNode }) {
  return <span className="em-light">{children}</span>;
}
/**
 * A centred section opening: heading, then one supporting sentence held to a
 * reading measure under it.
 * Centred rather than ranged left because a section that begins in the middle
 * of the page announces itself as a new subject, and this site needs that more
 * than it needs another left margin. The band beneath it can then be composed
 */
export function SectionIntro({
  heading,
  lead,
  className = "",
}: {
  heading: ReactNode;
  lead?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`text-center ${className}`}>
      <h2
        className="reveal-wipe mx-auto max-w-[20ch] text-[length:var(--step-head)]"
        style={{ "--d": "60ms" } as CSSProperties}
      >
        {heading}
      </h2>
      {lead ? (
        <p
          className="reveal mx-auto mt-6 max-w-[62ch] text-[17px] leading-[1.62] text-[var(--ink-2)]"
          style={{ "--d": "160ms" } as CSSProperties}
        >
          {lead}
        </p>
      ) : null}
    </div>
  );
}

/** Section heading. Eyebrow, display line, and a lead that stays inside a measure. */
export function SectionHead({
  eyebrow,
  heading,
  lead,
  className = "",
}: {
  eyebrow?: string;
  heading: ReactNode;
  lead?: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      {eyebrow ? (
        <p
          className="mono reveal mb-7 text-[var(--ink-3)]"
          style={{ "--d": "40ms" } as CSSProperties}
        >
          {eyebrow}
        </p>
      ) : null}
      <h2
        className="reveal-wipe max-w-[18ch] text-[length:var(--step-head)]"
        style={{ "--d": "110ms" } as CSSProperties}
      >
        {heading}
      </h2>
      {lead ? (
        <p
          className="reveal mt-7 max-w-[var(--measure-text)] text-[length:var(--step-lead)] leading-[1.6] text-[var(--ink-2)]"
          style={{ "--d": "210ms" } as CSSProperties}
        >
          {lead}
        </p>
      ) : null}
    </div>
  );
}

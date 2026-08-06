import type { ReactNode } from 'react';

type Tone = 'paper' | 'paper-2' | 'core';

interface BandProps {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  id?: string;
  /** Hairline rule along the top edge, for two adjacent bands of the same tone. */
  divider?: boolean;
  /** Tighter vertical rhythm, for CTA strips and short matrices. */
  compact?: boolean;
  /**
   * Full-bleed layer behind the measure — a field, a plate wash. Rendered
   * outside the measure container so it can reach the band's own edges, and
   * clipped by the band's `overflow-hidden`.
   */
  backdrop?: ReactNode;
}

/**
 * A full-bleed horizontal band. The page is a stack of these, alternating
 * between the two weights of stock and — sparingly — the core block. Bands
 * separate by stock weight and by the halftone screen they all carry, not by a
 * rule, which is what gives the page its printed, sectioned rhythm.
 *
 * The measure container is a reveal group: anything inside it carrying
 * `data-reveal` is staggered against its siblings by the motion engine, so a
 * band arrives as a composed sheet rather than as one block of everything.
 */
export function Band({
  tone = 'paper',
  children,
  className = '',
  id,
  divider = false,
  compact = false,
  backdrop,
}: BandProps) {
  return (
    <section
      id={id}
      className={`tone-${tone} relative isolate overflow-hidden ${
        divider ? 'border-t border-[var(--hair)]' : ''
      } ${className}`}
    >
      {backdrop}

      <div
        data-reveal-group=""
        className={`relative mx-auto max-w-[var(--measure)] px-6 lg:px-10 ${
          compact ? 'py-14 lg:py-20' : 'py-[var(--band)]'
        }`}
      >
        {children}
      </div>
    </section>
  );
}

interface SectionMarkProps {
  /** Two-digit section index, printed beside the node. */
  index: string;
  kicker: string;
  title: ReactNode;
  deck?: ReactNode;
}

/**
 * The standard section opener: a node and mono index on a full-width rule,
 * the display title on the left seven columns, the deck pushed to the far right
 * four. The asymmetry is the point — centred stacks are what make a page look
 * generated.
 *
 * It also publishes the section to the trim: `data-chapter` is what the right
 * rail reads to keep a running position through the page. A page gets that
 * readout by using this component and doing nothing else.
 */
export function SectionMark({ index, kicker, title, deck }: SectionMarkProps) {
  return (
    <header data-chapter={kicker}>
      <div className="flex items-center gap-4">
        <span aria-hidden="true" data-reveal="up" className="node shrink-0" />
        <p data-reveal="right" className="stamp text-[var(--kicker)] shrink-0">
          <span className="text-ink-faint tabular">{index}</span>
          <span aria-hidden="true" className="text-ink-faint px-2">
            /
          </span>
          {kicker}
        </p>
        {/* The rule draws itself in the direction the line above it is read. */}
        <span
          aria-hidden="true"
          data-reveal="rule"
          className="h-px flex-1 bg-[var(--hair-strong)]"
        />
      </div>

      <div className="mt-8 grid grid-cols-12 gap-x-8 gap-y-6">
        <h2 data-reveal="print" className="col-span-12 text-2xl text-[var(--fg)] sm:text-3xl lg:col-span-7">
          {title}
        </h2>

        {deck && (
          <p
            data-reveal="up"
            className="col-span-12 text-base text-[var(--fg-soft)] lg:col-span-4 lg:col-start-9 lg:self-end"
          >
            {deck}
          </p>
        )}
      </div>
    </header>
  );
}

interface PageMastheadProps {
  kicker: string;
  title: ReactNode;
  deck: ReactNode;
  /** Optional marker rendered beside the kicker (release state, etc.). */
  marker?: ReactNode;
  /** Facts strip printed under the headline. */
  meta?: { key: string; value: string; accent?: boolean }[];
  children?: ReactNode;
  /** Full-bleed layer behind the masthead. */
  backdrop?: ReactNode;
}

/**
 * Every interior page opens the same way: kicker line, oversized headline on
 * the left seven columns, deck on the right four, facts ruled underneath.
 * Consistent enough to navigate by, and none of it centred. It counts as the
 * first chapter in the trim readout, which is what it is.
 */
export function PageMasthead({
  kicker,
  title,
  deck,
  marker,
  meta,
  children,
  backdrop,
}: PageMastheadProps) {
  return (
    <Band tone="paper" backdrop={backdrop}>
      <div data-chapter={kicker} className="grid grid-cols-12 gap-x-8 gap-y-10 pt-6">
        <div data-reveal="right" className="col-span-12 flex flex-wrap items-center gap-4">
          <p className="stamp text-[var(--kicker)]">{kicker}</p>
          {marker}
        </div>

        <h1 data-reveal="print" className="col-span-12 text-3xl sm:text-4xl lg:col-span-7">
          {title}
        </h1>

        <div data-reveal="up" className="col-span-12 self-end lg:col-span-4 lg:col-start-9">
          <p className="border-l border-[var(--hair-strong)] pl-5 text-base text-[var(--fg-soft)]">
            {deck}
          </p>
        </div>

        {meta && <MetaStrip rows={meta} className="col-span-12" />}

        {children && (
          <div data-reveal="up" className="col-span-12">
            {children}
          </div>
        )}
      </div>
    </Band>
  );
}

/**
 * Ruled facts strip. Cells share hairlines instead of floating on gaps, so the
 * row reads as one instrument readout rather than four cards.
 *
 * The cells reveal one after another rather than as a block: a readout that
 * fills left to right is the one place in the system where a stagger is
 * literal — it is what an instrument does when it acquires a value.
 */
export function MetaStrip({
  rows,
  className = '',
}: {
  rows: { key: string; value: string; accent?: boolean }[];
  className?: string;
}) {
  return (
    <dl
      className={`bg-surface grid grid-cols-2 overflow-hidden rounded-lg border border-[var(--hair-strong)] sm:grid-cols-4 ${className}`}
    >
      {rows.map((row) => (
        <div
          key={row.key}
          data-reveal="up"
          className="lit-row border-r border-b border-[var(--hair)] px-5 py-4 last:border-r-0 sm:border-b-0"
        >
          <dt className="stamp text-ink-faint">{row.key}</dt>
          <dd
            className={`mt-2.5 font-mono text-sm ${
              row.accent ? 'text-core-ink' : 'text-[var(--fg)]'
            }`}
          >
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

interface MetaRow {
  key: string;
  value: ReactNode;
  /** Renders the value in the accent tint — for the one row that matters most. */
  accent?: boolean;
}

/**
 * A colophon: mono key on the left, value on the right, hairline between rows.
 * Used anywhere the page states facts rather than makes claims.
 */
export function Colophon({ rows, className = '' }: { rows: MetaRow[]; className?: string }) {
  return (
    <dl className={`border-t border-[var(--hair)] ${className}`}>
      {rows.map((row) => (
        <div
          key={row.key}
          data-reveal="up"
          className="flex items-baseline justify-between gap-6 border-b border-[var(--hair)] py-3"
        >
          <dt className="stamp text-ink-faint">{row.key}</dt>
          <dd
            className={`text-right font-mono text-sm ${
              row.accent ? 'text-core-ink' : 'text-[var(--fg)]'
            }`}
          >
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Edge-to-edge ticker. The duplicated copy is required: the track translates a
 * full -50% and the second copy is what keeps the loop seamless.
 */
export function Ticker({ items }: { items: string[] }) {
  return (
    <div className="tone-paper-2 border-y border-[var(--hair)]">
      <div className="marquee overflow-hidden whitespace-nowrap">
        <span className="marquee-track">
          {[0, 1].map((copy) => (
            <span key={copy} className="flex shrink-0 items-center" aria-hidden={copy === 1}>
              {items.map((item) => (
                <span key={item} className="stamp text-ink-soft flex items-center py-3.5">
                  <span className="px-7">{item}</span>
                  <span aria-hidden="true" className="text-core/70">
                    ◆
                  </span>
                </span>
              ))}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}

/** A status chip. Hairline pill, mono label, no pulse unless it is really live. */
export function Tag({
  children,
  variant = 'default',
}: {
  children: ReactNode;
  variant?: 'default' | 'accent' | 'success';
}) {
  const variants = {
    default: 'border-[var(--hair-strong)] text-ink-soft',
    accent: 'border-core/50 bg-core/10 text-core-ink',
    success: 'border-success/45 bg-success/10 text-success',
  };

  return <span className={`stamp chip ${variants[variant]}`}>{children}</span>;
}

/**
 * The closing strip every page ends on: statement on the left, the two actions
 * that page should hand off to on the right.
 */
export function ClosingBand({
  title,
  body,
  children,
}: {
  title: ReactNode;
  body: ReactNode;
  children: ReactNode;
}) {
  return (
    <Band tone="core" compact divider>
      <div className="grid grid-cols-12 items-end gap-x-8 gap-y-10">
        <div className="col-span-12 lg:col-span-7">
          <h2 data-reveal="print" className="text-2xl sm:text-3xl">
            {title}
          </h2>
          <p data-reveal="up" className="text-ink-soft mt-6 max-w-xl text-base">
            {body}
          </p>
        </div>

        <div
          data-reveal="up"
          className="col-span-12 flex flex-wrap gap-4 lg:col-span-5 lg:justify-end"
        >
          {children}
        </div>
      </div>
    </Band>
  );
}

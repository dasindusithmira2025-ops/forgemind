import { Metadata } from 'next';
import Link from 'next/link';
import { TechDiagram } from '@/components/TechDiagram';
import { Band, ClosingBand, PageMasthead, SectionMark } from '@/components/Editorial';

export const metadata: Metadata = {
  title: 'How Paralith works',
  description:
    'How Paralith handles a task: several agents working in parallel on your own machine, a plain summary of every change, and checks that have to pass before anything lands.',
};

const PILLARS = [
  {
    kicker: 'Speed',
    title: 'More than one thing at a time',
    body: 'Work is split across agents that run together rather than queueing behind each other, so a morning of separate small jobs happens in one pass while you carry on with your own.',
    assurance: 'Your window stays yours.',
  },
  {
    kicker: 'Context',
    title: 'It already knows your project',
    body: 'Paralith carries what it has learned about your project between sessions. You spend your time describing the task instead of re-establishing the same background every time.',
    assurance: 'No setup ritual.',
  },
  {
    kicker: 'Control',
    title: 'You are the one who approves',
    body: 'Every change comes back as something you can read and judge in a minute — what changed, and what was deliberately left alone. None of it reaches your project until you say so.',
    assurance: 'Nothing lands behind your back.',
  },
];

export default function TechnologyPage() {
  return (
    <>
      <PageMasthead
        kicker="How it works"
        title={
          <>
            Serious machinery. <span className="flare">Plain</span> to use.
          </>
        }
        deck="You describe the work, several agents take it on at once, and you approve what comes back. The complicated part is our problem, not yours."
        meta={[
          { key: 'Your code', value: 'Stays on your machine', accent: true },
          { key: 'Agents', value: 'Run in parallel' },
          { key: 'Changes', value: 'Reviewed by you' },
          { key: 'Telemetry', value: 'Off by default' },
        ]}
      />

      {/* ── Pipeline ─────────────────────────────────────────────────────── */}
      <Band tone="paper-2" divider>
        <SectionMark
          index="01"
          kicker="From ask to done"
          title="Four steps, start to finish."
          deck="Select a step to see what it means for you. The whole path runs on your own machine."
        />

        <div className="mt-14">
          <TechDiagram />
        </div>
      </Band>

      {/* ── Pillars ──────────────────────────────────────────────────────── */}
      <Band tone="paper">
        <SectionMark
          index="02"
          kicker="What you get out of it"
          title="Three things that change day to day."
          deck="Not a feature list — the three differences you would actually notice in a week of using it."
        />

        <div className="mt-14 border-t border-[var(--hair-strong)]">
          {PILLARS.map((pillar, i) => (
            <article
              key={pillar.title}
              className="grid grid-cols-12 gap-x-8 gap-y-6 border-b border-[var(--hair)] py-10"
            >
              <div className="col-span-12 flex items-baseline gap-4 lg:col-span-3 lg:flex-col lg:gap-3">
                <span aria-hidden="true" className="numeral text-ink text-xl lg:text-2xl">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <p className="stamp text-core-ink">{pillar.kicker}</p>
              </div>

              <div className="col-span-12 lg:col-span-5">
                <h3 className="text-lg lg:text-xl">{pillar.title}</h3>
                <p className="text-ink-soft mt-4 text-base">{pillar.body}</p>
              </div>

              <p className="stamp text-core-ink col-span-12 self-center border-t border-[var(--hair)] pt-5 lg:col-span-3 lg:col-start-10 lg:border-t-0 lg:pt-0">
                {pillar.assurance}
              </p>
            </article>
          ))}
        </div>
      </Band>

      <ClosingBand
        title={
          <>
            Your work stays <span className="flare">yours</span>.
          </>
        }
        body="The same commitments hold for how we handle your data, how we ship releases, and how we deal with anything that goes wrong."
      >
        <Link href="/security" className="btn btn-primary btn-lg">
          Security &amp; trust
          <span aria-hidden="true">→</span>
        </Link>
        <Link href="/products/paralith" className="btn btn-secondary btn-lg">
          See it in Paralith
        </Link>
      </ClosingBand>
    </>
  );
}

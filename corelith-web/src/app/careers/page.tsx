import { Metadata } from 'next';
import Link from 'next/link';
import { careersData } from '@/data/careers';
import { Band, PageMasthead, SectionMark } from '@/components/Editorial';

export const metadata: Metadata = {
  title: 'Careers & Culture',
  description:
    'Engineering culture, standards, craftsmanship, and careers at Corelith Technologies.',
};

export default function CareersPage() {
  const openCount = careersData.openPositions.length;

  return (
    <>
      <PageMasthead
        kicker="Careers & engineering culture"
        title={
          <>
            Engineering with <span className="flare">craft</span> and autonomy.
          </>
        }
        deck={careersData.cultureDescription}
        meta={[
          { key: 'Open roles', value: openCount === 0 ? 'None listed' : String(openCount), accent: true },
          { key: 'Location', value: 'Distributed' },
          { key: 'Cadence', value: 'Async-first' },
          { key: 'Team size', value: 'Deliberately small' },
        ]}
      />

      {/* ── Values ───────────────────────────────────────────────────────── */}
      <Band tone="paper-2" divider>
        <SectionMark
          index="01"
          kicker="How we work"
          title={careersData.cultureTitle}
          deck="Three things we actually optimise for. Everything else is negotiable."
        />

        <div className="mt-14 grid grid-cols-1 gap-5 lg:grid-cols-3">
          {careersData.values.map((value, i) => (
            <article key={value.title} className="panel panel-hover flex flex-col gap-5 p-7">
              <div className="flex items-start justify-between gap-4">
                <h3 className="max-w-[16ch] text-lg text-[var(--fg)] lg:text-xl">{value.title}</h3>
                <span aria-hidden="true" className="numeral text-[var(--fg)] text-2xl">
                  {String(i + 1).padStart(2, '0')}
                </span>
              </div>
              <p className="text-base text-[var(--fg-soft)]">{value.description}</p>
            </article>
          ))}
        </div>
      </Band>

      {/* ── Openings ─────────────────────────────────────────────────────── */}
      <Band tone="paper">
        <SectionMark
          index="02"
          kicker="Current openings"
          title="Nothing posted right now."
          deck="We are not advertising public roles this cycle — and we would rather say so than keep an evergreen listing open."
        />

        <div className="mt-14 grid grid-cols-12 gap-x-8 gap-y-10">
          <div className="col-span-12 lg:col-span-7">
            <p className="text-base text-[var(--fg-soft)]">
              We still read every introduction. If you work on agentic systems, desktop developer
              tooling, low-latency performance, or interface engineering, write to us with something
              you have built — not a résumé summary of it.
            </p>

            <dl className="mt-10 border-t border-[var(--hair)]">
              {[
                { k: 'What to send', v: 'Code, a write-up, or a demo' },
                { k: 'What we skip', v: 'Take-home busywork' },
                { k: 'Response', v: 'Within one week' },
              ].map((row) => (
                <div
                  key={row.k}
                  className="flex items-baseline justify-between gap-6 border-b border-[var(--hair)] py-3"
                >
                  <dt className="stamp text-[var(--fg-soft)]">{row.k}</dt>
                  <dd className="font-mono text-sm text-[var(--fg)]">{row.v}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="col-span-12 flex items-end lg:col-span-4 lg:col-start-9">
            <Link href="/contact?category=careers" className="btn btn-primary btn-lg w-full">
              Introduce yourself
              <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </Band>
    </>
  );
}

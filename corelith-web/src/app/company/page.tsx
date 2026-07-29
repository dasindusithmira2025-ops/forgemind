import { Metadata } from 'next';
import Link from 'next/link';
import { companyData } from '@/data/company';
import { PrinciplesGrid } from '@/components/PrinciplesGrid';
import { Band, ClosingBand, PageMasthead, SectionMark } from '@/components/Editorial';

export const metadata: Metadata = {
  title: 'Company & Mission',
  description:
    'Learn about Corelith Technologies: our mission, engineering standards, product principles, and long-term software vision.',
};

const STANCES = [
  { k: 'Craftsmanship', v: 'No template crutches' },
  { k: 'Verification', v: 'Empirical metrics' },
  { k: 'Data governance', v: 'Local-first defaults' },
];

export default function CompanyPage() {
  return (
    <>
      <PageMasthead
        kicker="Company & purpose"
        title={
          <>
            Software for the people shaping <span className="flare">what comes next</span>.
          </>
        }
        deck={companyData.about}
        meta={[
          { key: 'Structure', value: 'Independent', accent: true },
          { key: 'Model', value: 'Product-led' },
          { key: 'Team', value: 'Distributed' },
          { key: 'Focus', value: 'Developer tools' },
        ]}
      />

      {/* ── Directive ────────────────────────────────────────────────────── */}
      <Band tone="ember" divider>
        <div className="grid grid-cols-12 gap-x-8 gap-y-10">
          <p className="stamp text-ember-ink col-span-12 lg:col-span-2">Operating mission</p>

          <blockquote className="col-span-12 lg:col-span-9">
            <p className="font-display text-xl leading-[1.2] font-semibold tracking-tight text-balance sm:text-2xl lg:text-3xl">
              {companyData.tagline}
            </p>

            <dl className="mt-12 grid grid-cols-1 overflow-hidden rounded-lg border border-[var(--hair-strong)] bg-surface sm:grid-cols-3">
              {STANCES.map((stance) => (
                <div key={stance.k} className="border-r border-[var(--hair)] px-5 py-4 last:border-r-0">
                  <dt className="stamp text-ink-faint">{stance.k}</dt>
                  <dd className="mt-2.5 font-mono text-sm">{stance.v}</dd>
                </div>
              ))}
            </dl>
          </blockquote>
        </div>
      </Band>

      {/* ── Principles ───────────────────────────────────────────────────── */}
      <Band tone="paper" id="philosophy" className="scroll-mt-24" divider>
        <SectionMark
          index="02"
          kicker="Foundational standards"
          title="Engineering & product philosophy."
          deck="Six standards that govern every piece of software Corelith ships. They are constraints, not values on a wall."
        />

        <div className="mt-14">
          <PrinciplesGrid />
        </div>
      </Band>

      <ClosingBand
        title={
          <>
            Small teams, <span className="flare">high agency</span>.
          </>
        }
        body="If those standards read like a description of how you already work, we should talk."
      >
        <Link href="/careers" className="btn btn-primary btn-lg">
          Careers & culture
          <span aria-hidden="true">→</span>
        </Link>
        <Link href="/contact" className="btn btn-secondary btn-lg">
          Contact us
        </Link>
      </ClosingBand>
    </>
  );
}

import Link from 'next/link';
import { ParalithLaunchFilm } from '@/components/ParalithLaunchFilm';
import { CapabilitiesGrid } from '@/components/CapabilitiesGrid';
import { PrinciplesGrid } from '@/components/PrinciplesGrid';
import { Band, ClosingBand, MetaStrip, SectionMark, Ticker } from '@/components/Editorial';
import { companyData } from '@/data/company';
import { products } from '@/data/products';

const paralith = products.find((p) => p.id === 'paralith')!;

const TICKER = [
  'Several agents at once',
  'Remembers your project',
  'Terminals built in',
  'Checked before it lands',
  'Works across your monitors',
  'Stays on your machine',
];

const PILLARS = [
  {
    title: 'Agents work in parallel',
    body: 'Hand over several jobs at once and they are taken on at the same time — none of them freezing the window you are actually working in.',
    metric: 'Several at once',
  },
  {
    title: 'It remembers your project',
    body: 'Paralith carries what it knows about your project from one session to the next, so an agent picking up a task already has the background you would otherwise repeat.',
    metric: 'No re-explaining',
  },
  {
    title: 'Nothing lands unchecked',
    body: 'Every change is checked before it can reach your project. If a check fails, the change waits for you to look at it — there is no override switch.',
    metric: 'Checked every time',
  },
];

export default function HomePage() {
  return (
    <>
      {/* ── 01 · Hero ────────────────────────────────────────────────────── */}
      <Band tone="paper">
        <div className="grid grid-cols-12 gap-x-8 gap-y-10">
          <div className="col-span-12">
            <span className="chip stamp text-ink-soft">
              <span aria-hidden="true" className="node" />
              Corelith Technologies
              <span aria-hidden="true" className="text-ink-faint">
                /
              </span>
              <span className="text-ember-ink">Paralith v0.9.4 preview</span>
            </span>
          </div>

          {/* Short enough that `text-wrap: balance` can hold it to two even lines
              at every width — authored <br>s orphan the last word below 1600px. */}
          <h1 className="col-span-12 text-4xl lg:col-span-10 lg:text-5xl">
            Agents do the work.
            <br />
            Nothing ships <span className="flare">unverified</span>.
          </h1>

          <div className="col-span-12 self-start lg:col-span-5">
            <p className="text-ink-soft border-l border-[var(--hair-strong)] pl-5 text-base">
              Paralith puts your projects, your terminals, and a team of AI agents in one workspace
              — and keeps every line of your code on your own machine while they work.
            </p>
          </div>

          <div className="col-span-12 flex flex-wrap items-center gap-4 self-start lg:col-span-6 lg:col-start-7 lg:justify-end">
            <Link href="/products/paralith#download" className="btn btn-primary btn-lg">
              Download the preview
              <span aria-hidden="true">→</span>
            </Link>
            <Link href="/products/paralith" className="btn btn-secondary btn-lg">
              Read the spec
            </Link>
          </div>

          <MetaStrip
            className="col-span-12"
            rows={[
              { key: 'Product', value: 'Paralith' },
              { key: 'Release', value: 'v0.9.4 preview', accent: true },
              { key: 'Runs on', value: 'Windows · macOS · Linux' },
              { key: 'Your code', value: 'Stays local' },
            ]}
          />

          <div className="col-span-12 mt-2">
            <ParalithLaunchFilm />
          </div>
        </div>
      </Band>

      <Ticker items={TICKER} />

      {/* ── 02 · The flagship ────────────────────────────────────────────── */}
      <Band tone="paper">
        <SectionMark
          index="02"
          kicker="The flagship"
          title="Development, coordinated."
          deck={paralith.shortDescription}
        />

        <div className="mt-14 grid grid-cols-1 gap-5 lg:grid-cols-3">
          {PILLARS.map((pillar) => (
            <article key={pillar.title} className="panel panel-hover flex flex-col gap-5 p-7">
              <h3 className="max-w-[16ch] text-lg text-ink lg:text-xl">{pillar.title}</h3>
              <p className="text-ink-soft text-base">{pillar.body}</p>
              <p className="stamp text-[var(--kicker)] mt-auto border-t border-[var(--hair)] pt-5">
                {pillar.metric}
              </p>
            </article>
          ))}
        </div>

        <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-4">
          <Link href="/products/paralith" className="btn btn-primary">
            Explore Paralith
            <span aria-hidden="true">→</span>
          </Link>
          <p className="stamp text-ink-faint">
            Signed installers ◆ SHA-256 published ◆ No telemetry by default
          </p>
        </div>
      </Band>

      {/* ── 03 · Scope ───────────────────────────────────────────────────── */}
      <Band tone="paper-2" divider>
        <SectionMark
          index="03"
          kicker="Engineering scope"
          title="What Corelith builds."
          deck="Four domains where technical depth and interface precision both have to hold. We do not staff a fifth."
        />

        <div className="mt-14">
          <CapabilitiesGrid />
        </div>
      </Band>

      {/* ── 04 · Directive ───────────────────────────────────────────────── */}
      <Band tone="ember" divider>
        <div className="grid grid-cols-12 gap-x-8 gap-y-8">
          <p className="stamp text-ember-ink col-span-12 lg:col-span-2">Directive</p>

          <blockquote className="col-span-12 lg:col-span-9">
            <p className="font-display text-xl leading-[1.2] font-semibold tracking-tight text-balance sm:text-2xl lg:text-3xl">
              Corelith exists to turn ambitious software ideas into products people can depend on.
            </p>
            <p className="text-ink-soft mt-8 max-w-2xl text-base">
              We combine engineering discipline, intelligent automation, and careful product design
              to build systems that remain useful after the novelty disappears.
            </p>
            <footer className="stamp text-ink-faint mt-10 border-t border-[var(--hair)] pt-5">
              {companyData.mission}
            </footer>
          </blockquote>
        </div>
      </Band>

      {/* ── 05 · Standards ───────────────────────────────────────────────── */}
      <Band tone="paper" divider>
        <SectionMark
          index="05"
          kicker="Product philosophy"
          title="How Corelith builds software."
          deck="Six standards every release is measured against before it ships. They are constraints, not aspirations."
        />

        <div className="mt-14">
          <PrinciplesGrid />
        </div>
      </Band>

      <ClosingBand
        title={
          <>
            Take the <span className="flare">preview</span> for a run.
          </>
        }
        body="Read the specification, pull the signed build for your platform, or write to the engineering team directly."
      >
        <Link href="/products/paralith#download" className="btn btn-primary btn-lg">
          Download preview
          <span aria-hidden="true">→</span>
        </Link>
        <Link href="/contact" className="btn btn-secondary btn-lg">
          Contact engineering
        </Link>
      </ClosingBand>
    </>
  );
}

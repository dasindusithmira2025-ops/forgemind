import { Metadata } from 'next';
import Link from 'next/link';
import { TechDiagram } from '@/components/TechDiagram';
import { Band, ClosingBand, PageMasthead, SectionMark } from '@/components/Editorial';

export const metadata: Metadata = {
  title: 'Technology & Architecture',
  description:
    'Deep-dive into Corelith Technologies engineering architecture: agentic execution engines, persistent AST memory graphs, sandboxed PTY runtime, and zero-telemetry security.',
};

const PILLARS = [
  {
    kicker: 'Memory',
    title: 'Persistent AST graph',
    body: 'An incremental syntax-tree graph is built on local disk. Agents resolve symbol relationships, import edges, and Git diffs by lookup instead of re-reading the tree on every request.',
    facts: [
      { k: 'Languages', v: 'Rust · TS · Python · Go' },
      { k: 'Storage', v: 'Encrypted SQLite' },
      { k: 'Refresh', v: 'Incremental' },
    ],
  },
  {
    kicker: 'Execution',
    title: 'Native PTY sandbox',
    body: 'Terminal sessions run inside asynchronous pseudo-terminal boundaries. Output is audited, and file-destructive operations stop for an explicit decision rather than proceeding on a heuristic.',
    facts: [
      { k: 'Shells', v: 'pwsh · bash · zsh' },
      { k: 'Isolation', v: 'Per session' },
      { k: 'Approval', v: 'Explicit' },
    ],
  },
  {
    kicker: 'Integrity',
    title: 'Empirical verification',
    body: 'Static analysis, lint, build, and unit suites gate every agent-authored change. The gate is fail-closed: a suite that cannot run counts as a suite that did not pass.',
    facts: [
      { k: 'Gate', v: 'Fail-closed' },
      { k: 'Evidence', v: 'Logs retained' },
      { k: 'Rollback', v: 'Deterministic' },
    ],
  },
];

export default function TechnologyPage() {
  return (
    <>
      <PageMasthead
        kicker="Technology foundation"
        title={
          <>
            Intelligent systems on <span className="flare">rigorous</span> architecture.
          </>
        }
        deck="Local-first AST indexing, parallel agent orchestration, native terminal integration, and continuous verification — four engines, one boundary."
        meta={[
          { key: 'Index', value: 'Local, encrypted', accent: true },
          { key: 'Runtime', value: 'Native PTY' },
          { key: 'Egress', value: 'Strict proxy' },
          { key: 'Telemetry', value: 'Opt-in only' },
        ]}
      />

      {/* ── Pipeline ─────────────────────────────────────────────────────── */}
      <Band tone="panel" divider>
        <SectionMark
          index="01"
          kicker="Execution pipeline"
          title="Four stages, one boundary."
          deck="Select a stage to inspect its isolation guarantees. Nothing crosses the local boundary to make any of it work."
        />

        <div className="mt-14">
          <TechDiagram />
        </div>
      </Band>

      {/* ── Pillars ──────────────────────────────────────────────────────── */}
      <Band tone="void">
        <SectionMark
          index="02"
          kicker="Engine detail"
          title="What each engine actually does."
          deck="Three subsystems carry the weight. Everything else in Paralith is coordination around them."
        />

        <div className="mt-14 border-t border-[var(--hair-strong)]">
          {PILLARS.map((pillar, i) => (
            <article
              key={pillar.title}
              className="grid grid-cols-12 gap-x-8 gap-y-6 border-b border-[var(--hair)] py-10"
            >
              <div className="col-span-12 flex items-baseline gap-4 lg:col-span-3 lg:flex-col lg:gap-3">
                <span aria-hidden="true" className="numeral text-lume text-xl lg:text-2xl">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <p className="stamp text-iris-lift">{pillar.kicker}</p>
              </div>

              <div className="col-span-12 lg:col-span-5">
                <h3 className="text-lg lg:text-xl">{pillar.title}</h3>
                <p className="text-mute mt-4 text-base">{pillar.body}</p>
              </div>

              <dl className="col-span-12 lg:col-span-3 lg:col-start-10">
                {pillar.facts.map((fact) => (
                  <div
                    key={fact.k}
                    className="flex items-baseline justify-between gap-4 border-b border-[var(--hair)] py-2.5 first:border-t"
                  >
                    <dt className="stamp text-faint">{fact.k}</dt>
                    <dd className="text-lume font-mono text-xs">{fact.v}</dd>
                  </div>
                ))}
              </dl>
            </article>
          ))}
        </div>
      </Band>

      <ClosingBand
        title={
          <>
            The boundary is the <span className="flare">product</span>.
          </>
        }
        body="Read how the same guarantees are enforced in distribution, disclosure, and day-to-day data handling."
      >
        <Link href="/security" className="btn btn-primary btn-lg">
          Security posture
          <span aria-hidden="true">→</span>
        </Link>
        <Link href="/products/paralith" className="btn btn-secondary btn-lg">
          See it in Paralith
        </Link>
      </ClosingBand>
    </>
  );
}

'use client';

import { useState } from 'react';

const STAGES = [
  {
    id: 1,
    title: 'Local index',
    tag: 'On disk',
    description:
      'Syntax trees and Git lineage are indexed into encrypted local storage. Nothing about the shape of your codebase leaves the machine to make this work.',
    specs: [
      { k: 'Storage', v: 'AES-256-GCM, local' },
      { k: 'Scope', v: 'Per workspace' },
      { k: 'Egress', v: 'None' },
    ],
  },
  {
    id: 2,
    title: 'Agent controller',
    tag: 'Parallel',
    description:
      'Agents resolve intent against the local index and compose atomic diff patches. Work is scheduled across a bounded pool so one long task cannot starve the rest.',
    specs: [
      { k: 'Concurrency', v: 'Bounded pool' },
      { k: 'Output', v: 'Atomic patches' },
      { k: 'Context', v: 'Indexed symbols' },
    ],
  },
  {
    id: 3,
    title: 'PTY sandbox',
    tag: 'Isolated',
    description:
      'Commands execute inside native pseudo-terminals under explicit permission boundaries. Destructive calls stop and wait for a human decision.',
    specs: [
      { k: 'Boundary', v: 'Native PTY' },
      { k: 'Approval', v: 'Explicit' },
      { k: 'Audit', v: 'Full transcript' },
    ],
  },
  {
    id: 4,
    title: 'Verification',
    tag: 'Gate',
    description:
      'Lint, build, and unit suites run before anything reaches a branch. A red suite holds the patch in review; there is no path around this stage.',
    specs: [
      { k: 'Gate', v: 'Fail-closed' },
      { k: 'Rollback', v: 'Deterministic' },
      { k: 'Evidence', v: 'Logs retained' },
    ],
  },
];

/**
 * The execution pipeline as a signal-flow diagram: four ruled stages on a
 * connector rail, one open at a time. Tone-agnostic — it reads its foreground
 * roles from the band it sits in.
 */
export function TechDiagram() {
  const [activeId, setActiveId] = useState(1);
  const active = STAGES.find((s) => s.id === activeId)!;

  return (
    <div>
      {/* Connector rail — the stages are a signal path, so the diagram says so
          before the tabs do. */}
      <div aria-hidden="true" className="relative h-6">
        <span className="rule absolute top-1/2 right-0 left-0" />
        <span className="absolute inset-x-0 top-1/2 flex justify-between">
          {STAGES.map((stage) => (
            <span
              key={stage.id}
              className={`h-1.5 w-1.5 -translate-y-1/2 rounded-full transition-colors ${
                stage.id === activeId ? 'bg-iris shadow-[0_0_12px_var(--color-iris)]' : 'bg-edge'
              }`}
            />
          ))}
        </span>
      </div>

      <div
        role="tablist"
        aria-label="Execution pipeline stage"
        className="grid grid-cols-1 overflow-hidden rounded-t-lg border-t border-l border-[var(--hair-strong)] sm:grid-cols-2 lg:grid-cols-4"
      >
        {STAGES.map((stage) => {
          const isActive = stage.id === activeId;
          return (
            <button
              key={stage.id}
              type="button"
              role="tab"
              id={`stage-tab-${stage.id}`}
              aria-selected={isActive}
              aria-controls="stage-panel"
              onClick={() => setActiveId(stage.id)}
              className={`relative flex flex-col gap-3 border-r border-b border-[var(--hair-strong)] p-5 text-left transition-colors ${
                isActive
                  ? 'bg-iris/[0.12] text-iris-lift'
                  : 'text-[var(--fg-soft)] hover:bg-white/[0.03] hover:text-[var(--fg)]'
              }`}
            >
              {/* Active marker rides the top edge so the panel below reads as
                  hanging off this stage rather than floating beside it. */}
              <span
                aria-hidden="true"
                className={`bg-iris absolute inset-x-0 top-0 h-px transition-opacity ${
                  isActive ? 'opacity-100' : 'opacity-0'
                }`}
              />
              <span className="flex items-baseline justify-between gap-3">
                <span className="stamp">Stage {String(stage.id).padStart(2, '0')}</span>
                <span aria-hidden="true" className="stamp">
                  {stage.id < STAGES.length ? '→' : '■'}
                </span>
              </span>
              <span
                className={`font-display text-lg font-semibold tracking-tight ${
                  isActive ? 'text-lume' : 'text-[var(--fg)]'
                }`}
              >
                {stage.title}
              </span>
              <span className="stamp">{stage.tag}</span>
            </button>
          );
        })}
      </div>

      <div
        id="stage-panel"
        role="tabpanel"
        aria-labelledby={`stage-tab-${activeId}`}
        className="grid grid-cols-12 gap-x-8 gap-y-6 rounded-b-lg border-r border-b border-l border-[var(--hair-strong)] bg-white/[0.02] p-5 lg:p-8"
      >
        <p className="col-span-12 text-base text-[var(--fg)] lg:col-span-7">
          {active.description}
        </p>

        <dl className="col-span-12 lg:col-span-4 lg:col-start-9">
          {active.specs.map((spec) => (
            <div
              key={spec.k}
              className="flex items-baseline justify-between gap-4 border-b border-[var(--hair)] py-2.5 first:border-t"
            >
              <dt className="stamp text-[var(--fg-soft)]">{spec.k}</dt>
              <dd className="font-mono text-xs text-[var(--fg)]">{spec.v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

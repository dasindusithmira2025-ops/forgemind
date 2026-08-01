'use client';

import { useState } from 'react';

const STAGES = [
  {
    id: 1,
    title: 'You describe it',
    tag: 'In your words',
    description:
      'Say what you want changed the way you would say it to a colleague. There is no prompt syntax to learn and no configuration to fill in first.',
    assurance: 'You stay in plain language.',
  },
  {
    id: 2,
    title: 'Agents get to work',
    tag: 'Several at once',
    description:
      'The work is split across several agents that run at the same time, on your machine. You keep using the window you were already working in while they go.',
    assurance: 'Nothing blocks what you are doing.',
  },
  {
    id: 3,
    title: 'You see what changed',
    tag: 'In summary',
    description:
      'Each finished piece of work comes back as a short written summary of what changed and what deliberately did not, so you can judge it without reading every line.',
    assurance: 'You decide what lands.',
  },
  {
    id: 4,
    title: 'It has to pass first',
    tag: 'Every time',
    description:
      'Changes are checked before they reach your project. If a check fails, the change is held for you to look at instead of going in anyway.',
    assurance: 'There is no override switch.',
  },
];

/**
 * How a task moves through Paralith, as a signal-flow strip: four ruled stages
 * on a connector rail, one open at a time.
 *
 * This is deliberately the *user's* path through the product rather than the
 * system's — what you do, what you get back, and what you are guaranteed at
 * each point. Tone-agnostic: it reads its foreground roles from the band it
 * sits in.
 */
export function TechDiagram() {
  const [activeId, setActiveId] = useState(1);
  const active = STAGES.find((s) => s.id === activeId)!;

  return (
    <div>
      {/* Connector rail — the stages are a path, so the diagram says so before
          the tabs do. */}
      <div aria-hidden="true" className="relative h-6">
        <span className="rule absolute top-1/2 right-0 left-0" />
        <span className="absolute inset-x-0 top-1/2 flex justify-between">
          {STAGES.map((stage) => (
            <span
              key={stage.id}
              className={`h-2 w-2 -translate-y-1/2 rounded-full transition-colors ${
                stage.id === activeId ? 'bg-core' : 'bg-[var(--hair-strong)]'
              }`}
            />
          ))}
        </span>
      </div>

      <div
        role="tablist"
        aria-label="How a task moves through Paralith"
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
                  ? 'bg-core/[0.09] text-core-ink'
                  : 'text-[var(--fg-soft)] hover:bg-[rgba(245,237,224,0.05)] hover:text-[var(--fg)]'
              }`}
            >
              {/* Active marker rides the top edge so the panel below reads as
                  hanging off this stage rather than floating beside it. */}
              <span
                aria-hidden="true"
                className={`bg-core absolute inset-x-0 top-0 h-0.5 transition-opacity ${
                  isActive ? 'opacity-100' : 'opacity-0'
                }`}
              />
              <span className="flex items-baseline justify-between gap-3">
                <span className="stamp">Step {String(stage.id).padStart(2, '0')}</span>
                <span aria-hidden="true" className="stamp">
                  {stage.id < STAGES.length ? '→' : '■'}
                </span>
              </span>
              <span
                className={`font-display text-lg font-semibold tracking-tight ${
                  isActive ? 'text-core-ink' : 'text-[var(--fg)]'
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
        className="bg-surface grid grid-cols-12 items-start gap-x-8 gap-y-6 rounded-b-lg border-r border-b border-l border-[var(--hair-strong)] p-5 lg:p-8"
      >
        <p className="col-span-12 text-base text-[var(--fg)] lg:col-span-7">{active.description}</p>

        <p className="stamp col-span-12 self-center border-t border-[var(--hair)] pt-5 text-[var(--kicker)] lg:col-span-4 lg:col-start-9 lg:border-t-0 lg:pt-0">
          {active.assurance}
        </p>
      </div>
    </div>
  );
}

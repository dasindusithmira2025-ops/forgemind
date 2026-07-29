'use client';

import { useState } from 'react';

type View = 'work' | 'review' | 'checks';

const VIEWS: { id: View; label: string }[] = [
  { id: 'work', label: 'Work' },
  { id: 'review', label: 'Review' },
  { id: 'checks', label: 'Checks' },
];

const AGENTS = [
  { name: 'Alpha', role: 'building', state: 'running', progress: 68 },
  { name: 'Beta', role: 'testing', state: 'running', progress: 41 },
  { name: 'Gamma', role: 'reviewing', state: 'done', progress: 100 },
];

const SESSION = [
  { k: 'Running', v: '2' },
  { k: 'Awaiting you', v: '1' },
  { k: 'Done today', v: '6' },
];

const WORK: { title: string; agent: string; state: 'running' | 'queued' | 'done' }[] = [
  { title: 'Rework the settings screen into three steps', agent: 'Alpha', state: 'running' },
  { title: 'Cover the export flow with tests', agent: 'Beta', state: 'running' },
  { title: 'Bring the changelog up to date', agent: '—', state: 'queued' },
  { title: 'Clear the unused import warnings', agent: 'Gamma', state: 'done' },
];

const REVIEW = [
  'Split the settings screen into three shorter steps.',
  'Kept every existing validation rule exactly as it was.',
  'Nothing changed about how your saved settings are stored.',
];

const CHECKS = [
  { label: 'Tests', value: 'Passed' },
  { label: 'Types', value: 'Clean' },
  { label: 'Build', value: 'Succeeded' },
];

const STATE_STYLES: Record<'running' | 'queued' | 'done', string> = {
  running: 'text-ember-ink',
  queued: 'text-ink-faint',
  done: 'text-success',
};

/**
 * The product plate: Paralith's surface drawn rather than screenshotted, so it
 * stays crisp at any width and can be read by a screen reader.
 *
 * It deliberately shows the product at the level a person uses it — work in
 * progress, a change waiting for approval, checks that passed — rather than the
 * machinery underneath. Three views share one frame, and the tab strip is what
 * makes the point that these are panels of one workspace, not three tools.
 *
 * The plate is trimmed with crop marks. That is the one decorative liberty on
 * the page and it is earned: Paralith holds work in proof until it has been
 * checked and signed off, so the thing the page is proudest of is framed the
 * way a press proof is. The marks sit on a wrapper because the frame itself
 * clips its own overflow.
 */
export function ParalithHeroVisual() {
  const [view, setView] = useState<View>('work');

  return (
    <div className="crop">
      <div className="panel overflow-hidden rounded-xl">
      {/* Window chrome */}
      <div className="bg-paper-2 flex flex-col gap-3 border-b border-[var(--hair)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="chip stamp text-ink-soft py-1.5">
            <span aria-hidden="true" className="node" />
            corelith
            <span aria-hidden="true" className="text-ink-faint">
              /
            </span>
            main
          </span>
          <span className="stamp text-ink-faint hidden sm:inline">Workspace</span>
        </div>

        <div role="tablist" aria-label="Paralith view" className="flex items-center gap-1">
          {VIEWS.map((v) => {
            const active = view === v.id;
            return (
              <button
                key={v.id}
                type="button"
                role="tab"
                id={`plate-tab-${v.id}`}
                aria-selected={active}
                aria-controls="plate-panel"
                onClick={() => setView(v.id)}
                className={`stamp rounded-md px-3 py-2 transition-colors ${
                  active
                    ? 'text-ink bg-[rgba(245,237,224,0.09)]'
                    : 'text-ink-faint hover:text-ink-soft hover:bg-[rgba(245,237,224,0.06)]'
                }`}
              >
                {v.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12">
        {/* Left rail — who is working, and what the session has produced. */}
        <aside className="col-span-12 border-b border-[var(--hair)] lg:col-span-4 lg:border-r lg:border-b-0 xl:col-span-3">
          <div className="p-4">
            <p className="stamp text-ink-faint mb-3.5">Agents</p>
            <ul className="space-y-3.5">
              {AGENTS.map((agent) => {
                const running = agent.state === 'running';
                return (
                  <li key={agent.name}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-ink flex items-center gap-2 text-sm">
                        <span
                          aria-hidden="true"
                          className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                            running ? 'bg-ember pulse' : 'bg-success'
                          }`}
                        />
                        {agent.name}
                        <span className="text-ink-faint">{agent.role}</span>
                      </span>
                      <span
                        className={`stamp shrink-0 ${running ? 'text-ember-ink' : 'text-success'}`}
                      >
                        {agent.state}
                      </span>
                    </div>
                    <div
                      aria-hidden="true"
                      className="mt-2 h-0.5 w-full overflow-hidden rounded-full bg-[rgba(245,237,224,0.14)]"
                    >
                      <span
                        className={`block h-full rounded-full ${running ? 'bg-ember' : 'bg-success'}`}
                        style={{ width: `${agent.progress}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <dl className="grid grid-cols-3 border-t border-[var(--hair)] lg:grid-cols-1">
            {SESSION.map((cell) => (
              <div
                key={cell.k}
                className="border-r border-[var(--hair)] px-4 py-3 last:border-r-0 lg:flex lg:items-baseline lg:justify-between lg:gap-3 lg:border-r-0 lg:border-b lg:last:border-b-0"
              >
                <dt className="stamp text-ink-faint">{cell.k}</dt>
                <dd className="font-display text-ink mt-1.5 text-lg font-semibold lg:mt-0">
                  {cell.v}
                </dd>
              </div>
            ))}
          </dl>
        </aside>

        {/* Active panel */}
        <div
          id="plate-panel"
          role="tabpanel"
          aria-labelledby={`plate-tab-${view}`}
          className="col-span-12 min-h-[22rem] p-4 lg:col-span-8 xl:col-span-9"
        >
          {view === 'work' && (
            <div className="space-y-3.5">
              <p className="stamp text-ink-faint">Running now</p>

              <ul className="border-t border-[var(--hair)]">
                {WORK.map((item) => (
                  <li
                    key={item.title}
                    className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1.5 border-b border-[var(--hair)] py-3.5"
                  >
                    <span className="text-ink text-sm">{item.title}</span>
                    <span className="flex shrink-0 items-center gap-3">
                      <span className="stamp text-ink-faint">{item.agent}</span>
                      <span className={`stamp ${STATE_STYLES[item.state]}`}>{item.state}</span>
                    </span>
                  </li>
                ))}
              </ul>

              <p className="stamp text-ink-faint">
                All of it at once, without taking over the window you are working in
              </p>
            </div>
          )}

          {view === 'review' && (
            <div className="space-y-3.5">
              <p className="stamp text-ink-faint">Waiting for your approval</p>

              <div className="well p-5">
                <h3 className="text-ink text-lg">Rework the settings screen into three steps</h3>
                <p className="stamp text-ink-faint mt-2.5">Alpha · 4 files changed</p>

                <ul className="mt-5 space-y-2.5 border-t border-[var(--hair)] pt-4">
                  {REVIEW.map((line) => (
                    <li key={line} className="text-ink-soft flex gap-3 text-sm">
                      <span aria-hidden="true" className="text-success shrink-0">
                        ✓
                      </span>
                      {line}
                    </li>
                  ))}
                </ul>
              </div>

              <p className="stamp text-ember-ink">
                Nothing reaches your project until you say so
              </p>
            </div>
          )}

          {view === 'checks' && (
            <div className="space-y-3.5">
              <p className="stamp text-ink-faint">Before anything lands</p>

              <div className="well divide-y divide-[var(--hair)]">
                {CHECKS.map((check) => (
                  <div key={check.label} className="flex items-baseline justify-between gap-4 p-5">
                    <p className="text-ink text-base">{check.label}</p>
                    <p className="stamp text-success flex items-center gap-2.5">
                      <span aria-hidden="true" className="bg-success h-1.5 w-1.5 rounded-full" />
                      {check.value}
                    </p>
                  </div>
                ))}
              </div>

              <p className="stamp text-ink-faint">
                A failed check holds the change — there is no override
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Status bar */}
      <dl className="bg-paper-2 grid grid-cols-2 border-t border-[var(--hair)] sm:grid-cols-4">
        {[
          { k: 'Build', v: 'v0.9.4-preview' },
          { k: 'Runs on', v: 'Win · macOS · Linux' },
          { k: 'Your code', v: 'Stays on your machine' },
          { k: 'Approval', v: 'Always yours' },
        ].map((cell) => (
          <div key={cell.k} className="border-r border-[var(--hair)] px-4 py-3 last:border-r-0">
            <dt className="stamp text-ink-faint">{cell.k}</dt>
            <dd className="text-ink-soft mt-1.5 font-mono text-xs">{cell.v}</dd>
          </div>
        ))}
        </dl>
      </div>
    </div>
  );
}

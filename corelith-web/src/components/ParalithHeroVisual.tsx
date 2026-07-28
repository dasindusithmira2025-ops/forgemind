'use client';

import { useState } from 'react';

type View = 'agents' | 'terminal' | 'verification';

const VIEWS: { id: View; label: string }[] = [
  { id: 'agents', label: 'Agent canvas' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'verification', label: 'Verification' },
];

const INDEXED = [
  { path: 'src/core/agent_engine.rs', nodes: 412 },
  { path: 'src/pty/terminal.ts', nodes: 268 },
  { path: 'src/memory/graph.rs', nodes: 349 },
  { path: 'tests/verification.rs', nodes: 191 },
];

const AGENTS = [
  { name: 'alpha', role: 'refactor', state: 'running', progress: 68 },
  { name: 'beta', role: 'verifier', state: 'running', progress: 41 },
  { name: 'gamma', role: 'indexer', state: 'idle', progress: 100 },
];

const DIFF: { gutter: '+' | '-' | ' '; text: string; tone: 'add' | 'del' | 'ctx' }[] = [
  { gutter: ' ', text: 'impl AgentEngine {', tone: 'ctx' },
  { gutter: '-', text: '    pub fn execute(&self, task: &TaskSpec) -> Result<()> {', tone: 'del' },
  { gutter: '+', text: '    pub async fn execute_verified(', tone: 'add' },
  { gutter: '+', text: '        &self,', tone: 'add' },
  { gutter: '+', text: '        task: &TaskSpec,', tone: 'add' },
  { gutter: '+', text: '    ) -> Result<ExecutionReport> {', tone: 'add' },
  { gutter: '+', text: '        let ctx = self.memory.query_ast(&task.symbols).await?;', tone: 'add' },
  { gutter: '+', text: '        let pty = self.terminals.acquire_isolated().await?;', tone: 'add' },
  { gutter: '+', text: '        let report = self.verifier.run_suite(&pty).await?;', tone: 'add' },
  { gutter: '+', text: '        Ok(ExecutionReport::new(ctx, report))', tone: 'add' },
  { gutter: ' ', text: '    }', tone: 'ctx' },
  { gutter: ' ', text: '}', tone: 'ctx' },
];

const TERMINAL: { kind: 'cmd' | 'info' | 'pass' | 'warn'; text: string }[] = [
  { kind: 'cmd', text: 'paralith verify --strict' },
  { kind: 'info', text: 'loading local memory graph … 1,420 nodes' },
  { kind: 'info', text: 'worker pool online … 8 threads' },
  { kind: 'pass', text: 'cargo test --all … 142 passed in 0.84s' },
  { kind: 'pass', text: 'eslint · tsc --noEmit … 0 diagnostics' },
  { kind: 'warn', text: 'rm -rf ./dist held — destructive call needs approval' },
  { kind: 'pass', text: 'sha256 generated and signed' },
];

const CHECKS = [
  { label: 'Unit & integration', value: '142/142', pct: 100 },
  { label: 'Coverage', value: '94.8%', pct: 95 },
  { label: 'Memory latency', value: '1.2 ms', pct: 88 },
];

const TONE: Record<'add' | 'del' | 'ctx', string> = {
  add: 'text-signal',
  del: 'text-danger/80',
  ctx: 'text-mute',
};

/**
 * The product plate: Paralith's own surface, drawn rather than screenshotted so
 * it stays crisp at any width and can be read by a screen reader. Three real
 * views of the application share one frame — the tab strip is what makes the
 * point that these are panels in one workspace, not three separate tools.
 */
export function ParalithHeroVisual() {
  const [view, setView] = useState<View>('agents');

  return (
    <div className="relative">
      {/* Ground glow. Sits behind the frame and gives the plate its weight. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-x-10 -bottom-10 -z-10 h-48 rounded-[50%] bg-iris/25 blur-[80px]"
      />

      <div className="panel overflow-hidden rounded-xl">
        {/* Window chrome */}
        <div className="flex flex-col gap-3 border-b border-[var(--hair)] bg-white/[0.02] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="chip stamp text-mute py-1.5">
              <span aria-hidden="true" className="node" />
              corelith
              <span aria-hidden="true" className="text-faint">
                /
              </span>
              main
            </span>
            <span className="stamp text-faint hidden sm:inline">Workspace · Delivery</span>
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
                      ? 'text-lume bg-white/[0.08]'
                      : 'text-faint hover:text-mute hover:bg-white/[0.04]'
                  }`}
                >
                  {v.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12">
          {/* Left rail — indexed sources and the agent roster. */}
          <aside className="col-span-12 border-b border-[var(--hair)] lg:col-span-4 lg:border-r lg:border-b-0 xl:col-span-3">
            <div className="p-4">
              <p className="stamp text-faint mb-3">Project memory</p>
              <ul className="space-y-2">
                {INDEXED.map((file) => (
                  <li key={file.path} className="flex items-baseline justify-between gap-3">
                    <span className="text-mute truncate font-mono text-xs">{file.path}</span>
                    <span className="text-faint shrink-0 font-mono text-xs">{file.nodes}</span>
                  </li>
                ))}
              </ul>
              <p className="stamp text-faint mt-3 border-t border-[var(--hair)] pt-3">
                1,420 nodes · local
              </p>
            </div>

            <div className="border-t border-[var(--hair)] p-4">
              <p className="stamp text-faint mb-3">Agents</p>
              <ul className="space-y-3.5">
                {AGENTS.map((agent) => {
                  const running = agent.state === 'running';
                  return (
                    <li key={agent.name}>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-lume flex items-center gap-2 font-mono text-xs">
                          <span
                            aria-hidden="true"
                            className={`inline-block h-1.5 w-1.5 rounded-full ${
                              running ? 'bg-iris pulse' : 'bg-signal'
                            }`}
                          />
                          {agent.name}
                          <span className="text-faint">{agent.role}</span>
                        </span>
                        <span
                          className={`stamp shrink-0 ${running ? 'text-iris-lift' : 'text-signal'}`}
                        >
                          {agent.state}
                        </span>
                      </div>
                      <div
                        aria-hidden="true"
                        className="mt-2 h-0.5 w-full overflow-hidden rounded-full bg-white/[0.07]"
                      >
                        <span
                          className={`block h-full rounded-full ${
                            running ? 'bg-iris' : 'bg-signal'
                          }`}
                          style={{ width: `${agent.progress}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </aside>

          {/* Active panel */}
          <div
            id="plate-panel"
            role="tabpanel"
            aria-labelledby={`plate-tab-${view}`}
            className="col-span-12 min-h-[22rem] p-4 lg:col-span-8 xl:col-span-9"
          >
            {view === 'agents' && (
              <div className="space-y-3">
                <p className="stamp text-faint flex flex-wrap items-center gap-2">
                  Patch stream
                  <span aria-hidden="true" className="text-iris">
                    →
                  </span>
                  <span className="text-mute">src/core/agent_engine.rs</span>
                </p>

                <div className="well overflow-x-auto p-4">
                  <pre className="font-mono text-xs leading-relaxed">
                    <code>
                      {DIFF.map((line, i) => (
                        <span key={i} className={`block ${TONE[line.tone]}`}>
                          <span aria-hidden="true" className="text-faint mr-3 inline-block w-6 text-right select-none">
                            {i + 41}
                          </span>
                          <span className="inline-block w-3 select-none">{line.gutter}</span>
                          {line.text}
                        </span>
                      ))}
                    </code>
                  </pre>
                </div>

                <p className="stamp text-signal flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span>AST context resolved</span>
                  <span aria-hidden="true" className="text-faint">
                    ◆
                  </span>
                  <span>0 diagnostics</span>
                  <span aria-hidden="true" className="text-faint">
                    ◆
                  </span>
                  <span className="text-iris-lift">Patch held for review</span>
                </p>
              </div>
            )}

            {view === 'terminal' && (
              <div className="space-y-3">
                <p className="stamp text-faint">PTY session 1 · pid 4892 · pwsh</p>

                <div className="well overflow-x-auto p-4">
                  <pre className="font-mono text-xs leading-relaxed">
                    <code>
                      {TERMINAL.map((line, i) => (
                        <span key={i} className="block">
                          {line.kind === 'cmd' ? (
                            <>
                              <span className="text-iris" aria-hidden="true">
                                ❯{' '}
                              </span>
                              <span className="text-lume">{line.text}</span>
                            </>
                          ) : (
                            <>
                              <span
                                className={
                                  line.kind === 'pass'
                                    ? 'text-signal'
                                    : line.kind === 'warn'
                                      ? 'text-warn'
                                      : 'text-faint'
                                }
                              >
                                [{line.kind === 'info' ? 'info' : line.kind}]
                              </span>{' '}
                              <span className="text-mute">{line.text}</span>
                            </>
                          )}
                        </span>
                      ))}
                      <span className="block">
                        <span className="text-iris" aria-hidden="true">
                          ❯{' '}
                        </span>
                        <span
                          aria-hidden="true"
                          className="bg-iris pulse inline-block h-3.5 w-1.5 align-middle"
                        />
                      </span>
                    </code>
                  </pre>
                </div>

                <p className="stamp text-warn">Destructive commands require explicit approval</p>
              </div>
            )}

            {view === 'verification' && (
              <div className="space-y-3">
                <p className="stamp text-faint">Verification gate · run 2 191</p>

                <div className="well divide-y divide-[var(--hair)]">
                  {CHECKS.map((check) => (
                    <div key={check.label} className="p-4">
                      <div className="flex items-baseline justify-between gap-4">
                        <p className="stamp text-mute">{check.label}</p>
                        <p className="font-display text-lume text-lg font-semibold">
                          {check.value}
                        </p>
                      </div>
                      <div
                        aria-hidden="true"
                        className="mt-3 h-1 w-full overflow-hidden rounded-full bg-white/[0.07]"
                      >
                        <span
                          className="bg-signal block h-full rounded-full"
                          style={{ width: `${check.pct}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <p className="stamp text-signal">
                  Gate is fail-closed — no agent edit reaches a branch until every check is green
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Status bar */}
        <dl className="grid grid-cols-2 border-t border-[var(--hair)] bg-white/[0.02] sm:grid-cols-4">
          {[
            { k: 'Build', v: 'v0.9.4-preview' },
            { k: 'Targets', v: 'Win · macOS · Linux' },
            { k: 'Network', v: 'No egress' },
            { k: 'Memory', v: 'Local, encrypted' },
          ].map((cell) => (
            <div
              key={cell.k}
              className="border-r border-[var(--hair)] px-4 py-3 last:border-r-0"
            >
              <dt className="stamp text-faint">{cell.k}</dt>
              <dd className="text-mute mt-1.5 font-mono text-xs">{cell.v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

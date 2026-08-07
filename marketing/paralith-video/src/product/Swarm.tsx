import React from 'react';
import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowLeft,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  Eye,
  GitBranch,
  ListChecks,
  MessageSquare,
  Pause,
  Plus,
  Search,
  Send,
  ShieldCheck,
  SquareTerminal,
  TestTube2,
} from 'lucide-react';
import { Img, staticFile } from 'remotion';
import { ProductWindow } from './ProductWindow';
import { PROJECT } from './scenario';
import {
  SWARM,
  SWARM_AGENTS,
  SWARM_EDGES,
  SWARM_EVIDENCE,
  layoutAgents,
  swarmMetrics,
  tasksAt,
  testsAt,
  type SwarmAgentData,
  type SwarmRole,
  type SwarmStage,
} from './swarmScenario';

/**
 * The Swarm surface: `features/swarms/SwarmOverview.tsx`, class for class.
 *
 * One row of the product's own grid is deliberately missing, and it is the only such omission in
 * the twin. `SwarmOverview` renders a `ModelDefaults` section between the health strip and the
 * view tabs whose classes — `.swarm-model-defaults`, `.swarm-model-default-grid` — are not styled
 * anywhere in `Paralith-tauri/src/index.css`, which is the application's only stylesheet. In the
 * shipping product that block therefore paints as unstyled markup: bare labels, native selects,
 * default buttons. Reproducing it faithfully would put exactly the kind of malformed interface on
 * screen that this film is not allowed to show, and restyling it here would be the film inventing
 * a design the product does not have. It is left out, and the gap is filed against the product
 * instead.
 *
 * Nothing here is stateful. The film drives reveal order from the timeline, which is why the
 * roster, the edges and the task rows all take a "how many are on screen yet" count rather than
 * animating themselves.
 */

const ROLE_ICON: Record<SwarmRole, React.ReactNode> = {
  builder: <Code2 size={17} />,
  reviewer: <ShieldCheck size={17} />,
  scout: <Search size={17} />,
  debugger: <AlertTriangle size={17} />,
  integrator: <GitBranch size={17} />,
  coordinator: <Bot size={17} />,
};

/** `swarmPresentation.ts` — the five simplified stages shown in the Overview, in order. */
const PHASES = [
  { key: 'understanding', label: 'Understanding' },
  { key: 'planning', label: 'Planning' },
  { key: 'building', label: 'Building' },
  { key: 'verifying', label: 'Verifying' },
  { key: 'ready', label: 'Ready' },
] as const;

export type SwarmPhase = (typeof PHASES)[number]['key'];

export type WorkTab = 'overview' | 'tasks' | 'tests' | 'evidence';

export interface SwarmViewProps {
  phase: SwarmPhase;
  /** Rendered through the product's `lifecycleLabel`, so `ready_for_review` reads "Ready for review". */
  lifecycle: string;
  elapsed: string;
  view: 'canvas' | 'work';
  workTab?: WorkTab;
  /** How much of the roster has been staffed on camera. The canvas draws the first N agents. */
  agentsRevealed?: number;
  edgesRevealed?: number;
  /** Rows of the task graph that have been planned on camera. */
  tasksRevealed?: number;
  /** Characters of the mission typed into the command bar. */
  missionTyped?: number;
  readyBanner?: boolean;
  selectedAgentId?: string;
}

/** `ready_for_review` and `completed` are the finished Swarm; everything else is still building. */
const stageOf = (lifecycle: string): SwarmStage =>
  lifecycle === 'ready_for_review' || lifecycle === 'completed' ? 'ready' : 'building';

const lifecycleLabel = (state: string) =>
  state === 'ready_for_review'
    ? 'Ready for review'
    : state === 'decision_required'
      ? 'Decision required'
      : state.charAt(0).toUpperCase() + state.slice(1);

const phaseIndex = (phase: SwarmPhase) => PHASES.findIndex((entry) => entry.key === phase);

/** Both stages hold the same rows; only their statuses differ. */
const TASK_COUNT = tasksAt('building').length;

export const SwarmView: React.FC<SwarmViewProps> = ({
  phase,
  lifecycle,
  elapsed,
  view,
  workTab = 'tasks',
  agentsRevealed = SWARM_AGENTS.length,
  edgesRevealed = SWARM_EDGES.length,
  tasksRevealed = TASK_COUNT,
  missionTyped,
  readyBanner = false,
  selectedAgentId,
}) => {
  const agents = SWARM_AGENTS.slice(0, agentsRevealed);
  const stage = stageOf(lifecycle);
  const metrics = swarmMetrics(stage);
  const current = phaseIndex(phase);
  const activeAgents = agents.filter((agent) => agent.status === 'active' || agent.status === 'reviewing').length;

  return (
    <main className="repo-shell swarm-shell">
      {/*
        The Swarms route is not the workspace shell. `SwarmsScreen.tsx` renders a full-screen
        `repo-shell` with a `settings-titlebar` and no sidebar and no status bar — the Workspace
        sidebar and the running/pane counters simply are not on this screen. An earlier draft of
        this twin wrapped the Swarm in `AppShell` and put the Workspace sidebar beside it, which
        is a screen PARALITH has never drawn.
      */}
      <header className="settings-titlebar">
        <button type="button" className="button button-ghost">
          <ArrowLeft size={15} /> Back
        </button>
        <div className="brand brand--monochrome">
          <Img className="brand-logo" src={staticFile('brand/wordmark.png')} style={{ width: 92, height: 22 }} />
        </div>
        <h1>Swarms</h1>
        <div className="titlebar-spacer" />
        <span className="repo-shell-project">{PROJECT.name}</span>
      </header>

      <div className="swarm-workspace">
        <aside className="swarm-list-col" aria-label="Swarms">
          <header className="swarm-list-head">
            <span className="section-label">Swarms</span>
            <div>
              <button type="button" className="ws-section-add" aria-label="Show Swarm history">
                <Archive size={14} />
              </button>
              <button type="button" className="ws-section-add" aria-label="New swarm">
                <Plus size={15} />
              </button>
            </div>
          </header>
          <ul className="swarm-list" role="list">
            <li>
              <button type="button" className="swarm-list-item is-active" aria-current>
                <span className="swarm-status-dot tone-blue" aria-hidden />
                <span className="swarm-list-item-body">
                  <span className="swarm-list-item-name">{SWARM.name}</span>
                  <span className="swarm-list-item-meta">
                    {lifecycleLabel(lifecycle)}
                    {stage === 'building' ? ' · 62%' : ''}
                  </span>
                </span>
              </button>
            </li>
            <li>
              <button type="button" className="swarm-list-item">
                <span className="swarm-status-dot tone-green" aria-hidden />
                <span className="swarm-list-item-body">
                  <span className="swarm-list-item-name">Webhook backoff</span>
                  <span className="swarm-list-item-meta">Completed</span>
                </span>
              </button>
            </li>
          </ul>
        </aside>

        <div className="swarm-main">
        <div className="swarm-live-shell">
          <header className="swarm-live-header">
            <div className="swarm-live-identity">
              <span className="swarm-status-dot tone-blue" />
              <div>
                <h2>{SWARM.name}</h2>
                <button type="button">
                  {SWARM.mission} <Eye size={12} />
                </button>
              </div>
            </div>
            <div className="swarm-live-meta">
              <span>{lifecycleLabel(lifecycle)}</span>
              <span>{elapsed}</span>
              <span>{activeAgents} active</span>
            </div>
            <div className="swarm-live-actions">
              <button type="button" className="button button-ghost">
                <Pause size={14} /> Pause
              </button>
            </div>
          </header>

          {readyBanner ? (
            <div className="swarm-ready-banner">
              <CheckCircle2 size={17} />
              <div>
                <strong>Ready for review</strong>
                <span>1 independent Reviewer record persisted.</span>
              </div>
              <button type="button" className="button button-ghost">
                Review changes
              </button>
              <button type="button" className="button button-primary">
                Accept result
              </button>
            </div>
          ) : null}

          <section className="swarm-health-strip">
            <ol>
              {PHASES.map((entry, index) => (
                <li
                  key={entry.key}
                  className={index < current ? 'is-complete' : index === current ? 'is-active' : 'is-upcoming'}
                >
                  <span>{index < current ? '✓' : index + 1}</span>
                  <strong>{entry.label}</strong>
                </li>
              ))}
            </ol>
            <div className="swarm-health-metrics">
              <Metric value={metrics.completed} label="completed" />
              <Metric value={metrics.active} label="active tasks" />
              <Metric value={metrics.queued} label="queued" />
              <Metric value={metrics.passing} label="tests passing" />
              <Metric value={metrics.conflicts} label="conflicts" attention />
              <div className="swarm-milestone">
                <span>Milestone</span>
                <strong>{lifecycleLabel(lifecycle)}</strong>
              </div>
            </div>
          </section>

          <nav className="swarm-view-tabs" aria-label="Swarm views">
            <button type="button" className={view === 'canvas' ? 'is-active' : ''}>
              <Bot size={14} />
              Canvas
            </button>
            <button type="button">
              <MessageSquare size={14} />
              Chat
            </button>
            <button type="button">
              <Activity size={14} />
              Activity
            </button>
            <button type="button" className={view === 'work' ? 'is-active' : ''}>
              <ListChecks size={14} />
              Work
            </button>
          </nav>

          <div className="swarm-live-body has-rail">
            <main className="swarm-primary-surface">
              {view === 'canvas' ? (
                <AgentCanvas agents={agents} edgesRevealed={edgesRevealed} selectedAgentId={selectedAgentId} />
              ) : (
                <WorkView tab={workTab} tasksRevealed={tasksRevealed} stage={stage} />
              )}
            </main>
            <HealthRail agents={agents} stage={stage} milestone={lifecycleLabel(lifecycle)} />
          </div>

          <div className="swarm-command-bar">
            <select value="@swarm" onChange={() => undefined}>
              <option value="@swarm">@swarm</option>
            </select>
            <input
              readOnly
              value={missionTyped === undefined ? '' : SWARM.mission.slice(0, missionTyped)}
              placeholder="Give the team a scoped instruction…"
            />
            <button type="button" className="button button-secondary">
              <Send size={14} /> Send
            </button>
          </div>
        </div>
        </div>
      </div>
    </main>
  );
};

/**
 * The agent canvas.
 *
 * Positions come from the product's own `layoutAgents`, ported into `swarmScenario.ts`, and the
 * edges are drawn from the roster's real reporting and review relationships rather than from a
 * decorative graph. The "MISSION CONTROL" badge in the corner is not drawn here — it is a
 * `::after` on `.swarm-canvas` in the product's own stylesheet.
 */
const AgentCanvas: React.FC<{
  agents: readonly SwarmAgentData[];
  edgesRevealed: number;
  selectedAgentId?: string;
}> = ({ agents, edgesRevealed, selectedAgentId }) => {
  const positions = layoutAgents(SWARM_AGENTS);
  const present = new Set(agents.map((agent) => agent.id));
  const edges = SWARM_EDGES.filter(
    (edge) => present.has(edge.from) && present.has(edge.to),
  ).slice(0, edgesRevealed);

  return (
    <section className="swarm-canvas" aria-label="Live agent canvas">
      <svg className="swarm-connections" viewBox="0 0 1000 600" preserveAspectRatio="none" aria-hidden>
        {edges.map((edge) => {
          const from = positions.get(edge.from);
          const to = positions.get(edge.to);
          if (!from || !to) return null;
          return (
            <g key={`${edge.from}-${edge.to}`}>
              <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
              <circle cx={to.x} cy={to.y} r="4" />
            </g>
          );
        })}
      </svg>

      {agents.map((agent) => {
        const position = positions.get(agent.id)!;
        return (
          <button
            type="button"
            key={agent.id}
            className={`swarm-agent-node role-${agent.role} state-${agent.status}${
              selectedAgentId === agent.id ? ' is-selected' : ''
            }`}
            style={{ left: `${position.x / 10}%`, top: `${position.y / 6}%` }}
          >
            <span className="swarm-agent-node-icon">{ROLE_ICON[agent.role]}</span>
            <span className="swarm-agent-node-main">
              <strong>{agent.displayName}</strong>
              <em>
                {agent.model} · {agent.status}
              </em>
              <span>{agent.current}</span>
              {agent.progress !== undefined ? (
                <span className="swarm-agent-node-track">
                  <span style={{ width: `${Math.round(agent.progress * 100)}%` }} />
                </span>
              ) : null}
            </span>
            <i aria-label={agent.status} />
          </button>
        );
      })}

      <div className="swarm-canvas-key">
        <span>
          <i className="is-active" /> Active
        </span>
        <span>
          <i className="is-waiting" /> Waiting
        </span>
        <span>
          <i className="is-attention" /> Attention
        </span>
      </div>
    </section>
  );
};

/** `WorkView` — the tab strip and whichever list is open. */
const WorkView: React.FC<{ tab: WorkTab; tasksRevealed: number; stage: SwarmStage }> = ({
  tab,
  tasksRevealed,
  stage,
}) => (
  <section className="swarm-work-view">
    <nav>
      {(['overview', 'tasks', 'history', 'terminals', 'changes', 'tests', 'memory', 'evidence'] as const).map(
        (item) => (
          <button type="button" key={item} className={tab === item ? 'is-active' : ''}>
            {item[0].toUpperCase() + item.slice(1)}
          </button>
        ),
      )}
    </nav>
    <div className="swarm-work-content">
      {tab === 'overview' ? <Overview stage={stage} /> : null}
      {tab === 'tasks' ? <TaskList revealed={tasksRevealed} stage={stage} /> : null}
      {tab === 'tests' ? <TestList stage={stage} /> : null}
      {tab === 'evidence' ? <EvidenceList /> : null}
    </div>
  </section>
);

const Overview: React.FC<{ stage: SwarmStage }> = ({ stage }) => {
  const metrics = swarmMetrics(stage);
  return (
    <div className="swarm-work-overview">
      <WorkSummary
        icon={<ListChecks />}
        label="Tasks"
        value={`${metrics.completed}/${tasksAt(stage).length}`}
      />
      <WorkSummary icon={<SquareTerminal />} label="Live sessions" value={String(metrics.active)} />
      <WorkSummary icon={<TestTube2 />} label="Passing tests" value={String(metrics.passing)} />
      <WorkSummary icon={<ShieldCheck />} label="Evidence" value={String(SWARM_EVIDENCE.length)} />
    </div>
  );
};

/**
 * The task graph as the product lists it. "N dependencies" is the product's own secondary line and
 * the only place the film states that the graph has edges at all — it is derived from `dependsOn`,
 * so a task cannot claim a dependency the graph does not hold.
 */
const TaskList: React.FC<{ revealed: number; stage: SwarmStage }> = ({ revealed, stage }) => (
  <div className="swarm-task-list">
    {tasksAt(stage).slice(0, revealed).map((task) => {
      const agent = SWARM_AGENTS.find((entry) => entry.id === task.assignedTo);
      return (
        <article key={task.id}>
          <span className={`task-state state-${task.status}`}>{task.status}</span>
          <div>
            <strong>{task.title}</strong>
            <p>
              {task.role === 'builder' ? 'Builder' : task.role.charAt(0).toUpperCase() + task.role.slice(1)}
              {task.dependsOn.length
                ? ` · ${task.dependsOn.length} ${task.dependsOn.length === 1 ? 'dependency' : 'dependencies'}`
                : ''}
            </p>
          </div>
          <button type="button">{agent?.displayName ?? 'Unassigned'}</button>
          <span>
            {task.progress !== undefined && task.status !== 'completed'
              ? `${Math.round(task.progress * 100)}%`
              : task.status === 'completed'
                ? 'Complete'
                : 'In progress'}
          </span>
        </article>
      );
    })}
  </div>
);

const TestList: React.FC<{ stage: SwarmStage }> = ({ stage }) => (
  <div className="swarm-test-list">
    {testsAt(stage).map((test) => (
      <article key={test.id}>
        <span className={`test-state state-${test.status}`}>{test.status}</span>
        <div>
          <strong>{test.name}</strong>
          <p>{test.summary}</p>
          <code>{test.command}</code>
        </div>
      </article>
    ))}
  </div>
);

/**
 * Evidence, grouped by criterion — and the criterion is the task title, which is how
 * `swarm_service.rs` records it. The two record types shown are the two the runtime writes.
 */
const EvidenceList: React.FC = () => {
  const groups = new Map<string, typeof SWARM_EVIDENCE>();
  for (const record of SWARM_EVIDENCE) {
    groups.set(record.criterion, [...(groups.get(record.criterion) ?? []), record]);
  }

  return (
    <div className="swarm-evidence-list">
      {[...groups.entries()].map(([criterion, records]) => (
        <section key={criterion}>
          <h4>{criterion}</h4>
          {records.map((record) => (
            <article key={record.id}>
              <ShieldCheck size={15} className={record.verified ? 'tone-green' : 'tone-amber'} />
              <div>
                <strong>{record.title}</strong>
                <p>{record.summary}</p>
              </div>
              <span>{record.evidenceType}</span>
            </article>
          ))}
        </section>
      ))}
    </div>
  );
};

const HealthRail: React.FC<{
  agents: readonly SwarmAgentData[];
  stage: SwarmStage;
  milestone: string;
}> = ({ agents, stage, milestone }) => {
  const metrics = swarmMetrics(stage);
  return (
    <aside className="swarm-context-rail">
      <header>
        <div>
          <span>Swarm health</span>
          <h3>{milestone}</h3>
        </div>
      </header>
      <section>
        <span>Mission</span>
        <p>{SWARM.mission}</p>
      </section>
      <section>
        <span>Team</span>
        {agents.map((agent) => (
          <button className={`swarm-rail-agent role-${agent.role}`} type="button" key={agent.id}>
            <i />
            <strong>{agent.displayName}</strong>
            <em>{agent.status}</em>
          </button>
        ))}
      </section>
      <section>
        <span>Work health</span>
        <button className="swarm-rail-link" type="button">
          {metrics.active} active · {metrics.completed} completed <ChevronRight size={13} />
        </button>
        <button className="swarm-rail-link" type="button">
          {metrics.passing} tests passing <ChevronRight size={13} />
        </button>
        <button className="swarm-rail-link" type="button">
          {SWARM_EVIDENCE.length} evidence records <ChevronRight size={13} />
        </button>
      </section>
    </aside>
  );
};

const Metric: React.FC<{ value: number; label: string; attention?: boolean }> = ({
  value,
  label,
  attention = false,
}) => (
  <div className={attention && value > 0 ? 'is-attention' : ''}>
    <strong>{value}</strong>
    <span>{label}</span>
  </div>
);

const WorkSummary: React.FC<{ icon: React.ReactNode; label: string; value: string }> = ({
  icon,
  label,
  value,
}) => (
  <article>
    {icon}
    <span>{label}</span>
    <strong>{value}</strong>
  </article>
);

/** The whole window showing the Swarm route. Scenes place it with `Stage`. */
export const SwarmWindow: React.FC<SwarmViewProps & { scale?: number }> = ({ scale, ...view }) => (
  <ProductWindow scale={scale}>
    <SwarmView {...view} />
  </ProductWindow>
);

/** Re-exported so scenes can name a phase without importing the scenario module. */
export { PHASES };

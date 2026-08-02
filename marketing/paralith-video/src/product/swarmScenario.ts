/**
 * The Swarm the mission sequence is shot on.
 *
 * Same rule as `scenario.ts`: nothing here may show PARALITH doing something PARALITH does not do.
 * The roles are the real `SwarmRole` union, the phases are the real five from
 * `swarmPresentation.ts`, the lifecycle values and their labels are the product's, the agent
 * display names follow the product's own `"Builder 1"` convention, and the evidence types are the
 * two the runtime actually persists — `git_commit` and `terminal_trace`. What is invented is the
 * work: the same `orbital` payments service the rest of the film is shot on.
 *
 * The roster is six, which is also the number of panes on the workspace canvas in the sequence
 * that follows. That is not a coincidence being smuggled past the viewer — it is the same effort
 * seen twice, once as the team that was staffed and once as the terminals that team is running in.
 */

export type SwarmRole = 'coordinator' | 'scout' | 'builder' | 'debugger' | 'reviewer' | 'integrator';

/** From the `state-*` classes the product's stylesheet defines for `.swarm-agent-node`. */
export type AgentStatus = 'active' | 'waiting' | 'blocked' | 'failed' | 'reviewing' | 'recovering' | 'idle';

/** From `TaskList`'s `task-state state-${task.status}`. */
export type TaskStatus = 'ready' | 'queued' | 'claimed' | 'running' | 'blocked' | 'completed' | 'cancelled';

export type TestStatus = 'passed' | 'failed' | 'running' | 'skipped';

export interface SwarmAgentData {
  id: string;
  displayName: string;
  role: SwarmRole;
  status: AgentStatus;
  runtime: 'claude' | 'codex';
  model: string;
  /** The task title shown as the node's third line. */
  current: string;
  /** `agent.worktree`. The mission sequence's one structural claim. */
  worktree: string;
  progress?: number;
  changedFiles: number;
  tests: { passed: number; failed: number };
}

export interface SwarmTaskData {
  id: string;
  title: string;
  role: SwarmRole;
  status: TaskStatus;
  assignedTo?: string;
  dependsOn: readonly string[];
  progress?: number;
}

export interface SwarmTestData {
  id: string;
  name: string;
  status: TestStatus;
  summary: string;
  command: string;
}

export interface SwarmEvidenceData {
  id: string;
  criterion: string;
  title: string;
  summary: string;
  evidenceType: 'git_commit' | 'terminal_trace';
  verified: boolean;
}

export const SWARM = {
  name: 'Idempotent checkout',
  /**
   * The mission, as a described outcome rather than an instruction. This is the string the film
   * types in, and it is deliberately an acceptance criterion — "cannot double-charge" is testable,
   * "improve checkout" is not.
   */
  mission:
    'Make the checkout reservation idempotent so a retried request cannot double-charge, and prove it with tests.',
  branch: 'feat/idempotent-checkout',
} as const;

/**
 * The roster. Ordered as the product orders it: the Coordinator anchors the centre of the canvas
 * and everyone else is placed on a ring around it, clustered by role.
 */
export const SWARM_AGENTS: readonly SwarmAgentData[] = [
  {
    id: 'coordinator',
    displayName: 'Coordinator',
    role: 'coordinator',
    status: 'active',
    runtime: 'claude',
    model: 'Claude / Opus 4.6 · high',
    current: 'Maintaining the task graph',
    worktree: 'Project root',
    changedFiles: 0,
    tests: { passed: 0, failed: 0 },
  },
  {
    id: 'scout',
    displayName: 'Scout',
    role: 'scout',
    status: 'active',
    runtime: 'claude',
    model: 'Claude / Sonnet 4.6 · medium',
    current: 'Map the double-charge window',
    worktree: '.worktrees/scout',
    progress: 1,
    changedFiles: 0,
    tests: { passed: 0, failed: 0 },
  },
  {
    id: 'builder-1',
    displayName: 'Builder 1',
    role: 'builder',
    status: 'active',
    runtime: 'claude',
    model: 'Claude / Opus 4.6 · high',
    current: 'Split reservation and capture',
    worktree: '.worktrees/builder-1',
    progress: 0.72,
    changedFiles: 3,
    tests: { passed: 57, failed: 0 },
  },
  {
    id: 'builder-2',
    displayName: 'Builder 2',
    role: 'builder',
    status: 'waiting',
    runtime: 'claude',
    model: 'Claude / Opus 4.6 · high',
    current: 'Cap the retry policy at four attempts',
    worktree: '.worktrees/builder-2',
    progress: 0.55,
    changedFiles: 1,
    tests: { passed: 31, failed: 0 },
  },
  {
    id: 'builder-3',
    displayName: 'Builder 3',
    role: 'builder',
    status: 'active',
    runtime: 'codex',
    model: 'Codex / GPT-5.3 · high',
    current: 'Add the ledger_entries migration',
    worktree: '.worktrees/builder-3',
    progress: 0.9,
    changedFiles: 2,
    tests: { passed: 0, failed: 0 },
  },
  {
    id: 'reviewer',
    displayName: 'Reviewer',
    role: 'reviewer',
    status: 'reviewing',
    runtime: 'claude',
    model: 'Claude / Opus 4.6 · max',
    current: 'Verify the idempotency guarantee',
    worktree: '.worktrees/reviewer',
    progress: 0.4,
    changedFiles: 0,
    tests: { passed: 0, failed: 0 },
  },
];

/**
 * The adaptive task graph. `dependsOn` is what the Tasks list renders as "N dependencies", and it
 * is the only place in the film a dependency edge is drawn — the brief's rule that graph-like
 * connections may only represent real relationships is why the agent canvas draws its edges from
 * this table rather than from a decorative layout.
 */
export const SWARM_TASKS: readonly SwarmTaskData[] = [
  {
    id: 't1',
    title: 'Map the double-charge window',
    role: 'scout',
    status: 'completed',
    assignedTo: 'scout',
    dependsOn: [],
    progress: 1,
  },
  {
    id: 't2',
    title: 'Split reservation and capture',
    role: 'builder',
    status: 'running',
    assignedTo: 'builder-1',
    dependsOn: ['t1'],
    progress: 0.72,
  },
  {
    id: 't3',
    title: 'Add the ledger_entries migration',
    role: 'builder',
    status: 'running',
    assignedTo: 'builder-3',
    dependsOn: ['t1'],
    progress: 0.9,
  },
  {
    id: 't4',
    title: 'Cap the retry policy at four attempts',
    role: 'builder',
    status: 'claimed',
    assignedTo: 'builder-2',
    dependsOn: ['t1'],
    progress: 0.55,
  },
  {
    id: 't5',
    title: 'Verify the idempotency guarantee',
    role: 'reviewer',
    status: 'queued',
    assignedTo: 'reviewer',
    dependsOn: ['t2', 't3', 't4'],
  },
];

/** Connections the canvas draws: coordinator to each teammate, plus the review edge. */
export const SWARM_EDGES: readonly { from: string; to: string }[] = [
  { from: 'coordinator', to: 'scout' },
  { from: 'coordinator', to: 'builder-1' },
  { from: 'coordinator', to: 'builder-2' },
  { from: 'coordinator', to: 'builder-3' },
  { from: 'coordinator', to: 'reviewer' },
  { from: 'builder-1', to: 'reviewer' },
];

/** The Tests tab. Counts agree with the transcripts the workspace sequence shows. */
export const SWARM_TESTS: readonly SwarmTestData[] = [
  {
    id: 'x1',
    name: 'checkout · reservation is idempotent',
    status: 'passed',
    summary: '57 assertions across 4 files. A replayed request returns the first reservation.',
    command: 'npm test -- checkout',
  },
  {
    id: 'x2',
    name: 'payments · retry policy caps at four attempts',
    status: 'passed',
    summary: '31 assertions. The fifth attempt lands in the dead-letter queue.',
    command: 'npm test -- payments',
  },
  {
    id: 'x3',
    name: 'webhooks · dispatch is stable across 20 runs',
    status: 'passed',
    summary: 'Re-run 20 times after the fake timer landed. 0 intermittent.',
    command: 'npm test -- webhooks --run 20',
  },
  {
    id: 'x4',
    name: 'db · migration 0042 reverses cleanly',
    status: 'running',
    summary: 'Applying, then rolling back, against a scratch database.',
    command: 'npm run db:verify',
  },
];

/**
 * The Evidence tab, grouped by criterion — and the criterion is the task title, which is exactly
 * how `swarm_service.rs` records it. This is the surface the proof sequence is built on: it accepts
 * only real commands, tests, diffs, traces, reviews and approvals, and the film shows it holding
 * the two record types the runtime actually writes.
 */
export const SWARM_EVIDENCE: readonly SwarmEvidenceData[] = [
  {
    id: 'e1',
    criterion: 'Split reservation and capture',
    title: 'Builder 1 isolated change set',
    summary: '3 files, +191 −25, committed on .worktrees/builder-1.',
    evidenceType: 'git_commit',
    verified: true,
  },
  {
    id: 'e2',
    criterion: 'Split reservation and capture',
    title: 'Builder 1 runtime trace',
    summary: 'npm test -- checkout · 57 passed, 0 failed, exit 0.',
    evidenceType: 'terminal_trace',
    verified: true,
  },
  {
    id: 'e3',
    criterion: 'Add the ledger_entries migration',
    title: 'Builder 3 runtime trace',
    summary: 'psql -f 0042_ledger_entries.sql · CREATE TABLE, CREATE INDEX.',
    evidenceType: 'terminal_trace',
    verified: true,
  },
  {
    id: 'e4',
    criterion: 'Cap the retry policy at four attempts',
    title: 'Builder 2 isolated change set',
    summary: '1 file, +42 −8. Awaiting the push the human has not approved.',
    evidenceType: 'git_commit',
    verified: false,
  },
];

/**
 * The two points in the Swarm's life the film visits.
 *
 * `building` is the mission sequence: the graph is planned, three tasks are in flight, the review
 * task is queued behind them. `ready` is the proof sequence, thirty-one minutes later: every task
 * has landed and the fourth test has finished.
 *
 * They are separate task tables rather than one table with a flag because the alternative — a
 * single set of rows and a metrics strip that quietly reports something else — is how a frame ends
 * up claiming "Ready for review" over "2 active tasks · 2 queued", which is what the first cut of
 * the proof sequence did.
 */
export type SwarmStage = 'building' | 'ready';

const READY_TASKS: readonly SwarmTaskData[] = SWARM_TASKS.map((task) => ({
  ...task,
  status: 'completed',
  progress: 1,
}));

const READY_TESTS: readonly SwarmTestData[] = SWARM_TESTS.map((test) => ({
  ...test,
  status: 'passed',
  summary:
    test.status === 'running'
      ? 'Applied and rolled back against a scratch database. No residue.'
      : test.summary,
}));

export const tasksAt = (stage: SwarmStage) => (stage === 'ready' ? READY_TASKS : SWARM_TASKS);
export const testsAt = (stage: SwarmStage) => (stage === 'ready' ? READY_TESTS : SWARM_TESTS);

/** The metrics strip, derived rather than typed, so it cannot disagree with the tables above. */
export const swarmMetrics = (stage: SwarmStage = 'building') => {
  const tasks = tasksAt(stage);
  const tests = testsAt(stage);
  return {
    completed: tasks.filter((task) => task.status === 'completed').length,
    active: tasks.filter((task) => task.status === 'running').length,
    queued: tasks.filter((task) => ['ready', 'queued', 'claimed'].includes(task.status)).length,
    passing: tests.filter((test) => test.status === 'passed').length,
    conflicts: tasks.filter((task) => task.status === 'blocked').length,
  };
};

/**
 * The product's own `layoutAgents`, ported unchanged.
 *
 * Coordinators anchor the centre of a 1000x600 space; everyone else is placed on an even ring
 * around them, clustered by role priority, starting at the top and walking clockwise. Porting it
 * rather than art-directing the positions is what keeps the board the shape the product would
 * actually draw for this roster.
 */
export const layoutAgents = (agents: readonly SwarmAgentData[]): Map<string, { x: number; y: number }> => {
  const map = new Map<string, { x: number; y: number }>();
  const centre = { x: 500, y: 300 };
  const rolePriority: Record<SwarmRole, number> = {
    scout: 0,
    builder: 1,
    debugger: 2,
    reviewer: 3,
    integrator: 4,
    coordinator: 5,
  };
  const coordinators = agents.filter((agent) => agent.role === 'coordinator');
  const ring = agents
    .filter((agent) => agent.role !== 'coordinator')
    .slice()
    .sort((a, b) => rolePriority[a.role] - rolePriority[b.role]);

  coordinators.forEach((agent, index) => {
    const spread = coordinators.length > 1 ? (index - (coordinators.length - 1) / 2) * 168 : 0;
    map.set(agent.id, { x: centre.x + spread, y: centre.y });
  });

  const count = ring.length;
  const radiusX = count <= 4 ? 300 : count <= 7 ? 350 : 390;
  const radiusY = count <= 4 ? 175 : count <= 7 ? 205 : 225;
  ring.forEach((agent, index) => {
    const angle =
      -Math.PI / 2 + ((index + (count % 2 === 0 ? 0.5 : 0)) / Math.max(1, count)) * Math.PI * 2;
    map.set(agent.id, {
      x: centre.x + Math.cos(angle) * radiusX,
      y: centre.y + Math.sin(angle) * radiusY,
    });
  });

  return map;
};

/**
 * The Agent Resume centre's records.
 *
 * This is the continuity sequence's surface and it is fully shipped: `services/agent_resume.rs`,
 * `commands/agent_commands.rs`, its own migration, and `AgentResumeCenter.tsx`. The copy on it is
 * the product's — "Exact Claude and Codex sessions tied to their original worktrees" is the
 * component's own intro line, not a marketing rewrite of it.
 */
export interface ResumeRecordData {
  id: string;
  title: string;
  provider: 'Claude Code' | 'Codex CLI';
  project: string;
  /** The Swarm agent's branch. The row reads `branch · worktreePath`, as the component does. */
  branch: string;
  /** An absolute Windows path, because that is what the product stores and displays. */
  worktreePath: string;
  command: string;
  status: 'resumable' | 'running';
  /**
   * What the row's `<time>` carries: `lastActive(record.lastActivityAt)`, a relative timestamp.
   * An earlier draft put "Stopped for an update" here, which reads well and is not what that slot
   * shows — the reason a session is listed is already stated once, by the component's own intro.
   */
  lastActive: string;
}

export const RESUME_RECORDS: readonly ResumeRecordData[] = [
  {
    id: 'r1',
    title: 'Builder 1',
    provider: 'Claude Code',
    project: 'orbital',
    branch: 'swarm/builder-1',
    worktreePath: 'D:\\work\\orbital\\.worktrees\\builder-1',
    command: 'claude --resume 0f3c9a1e',
    status: 'resumable',
    lastActive: '2m ago',
  },
  {
    id: 'r2',
    title: 'Builder 3',
    provider: 'Codex CLI',
    project: 'orbital',
    branch: 'swarm/builder-3',
    worktreePath: 'D:\\work\\orbital\\.worktrees\\builder-3',
    command: 'codex resume 7b21d40f',
    status: 'resumable',
    lastActive: '2m ago',
  },
  {
    id: 'r3',
    title: 'Reviewer',
    provider: 'Claude Code',
    project: 'orbital',
    branch: 'swarm/reviewer',
    worktreePath: 'D:\\work\\orbital\\.worktrees\\reviewer',
    command: 'claude --resume c48e10b2',
    status: 'resumable',
    lastActive: '3m ago',
  },
];

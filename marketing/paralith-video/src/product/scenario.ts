import type { AgentActivityState } from './labels';

/**
 * The session the film is shot on.
 *
 * One rule governs everything in this file: nothing here may show PARALITH doing something
 * PARALITH does not do. The provider names are the product's real provider set, the pane states
 * are the real `AgentActivityState` union, the wait timers obey the real four-step pressure
 * ladder, and the git counts are consistent with the diff the review scene shows. What *is*
 * invented is the work itself — a payments service called Orbital — because filming a real
 * customer's repository is not something a brand film gets to do.
 *
 * The dramatic spine is pane `retries`. It asks for permission to push at 00:14 in story time
 * and is still waiting eleven minutes later, which is the entire argument for the Fleet Bar:
 * five agents were working, one had quietly stopped, and nothing on screen was going to tell
 * you which until the product did.
 */

export type ToneKey =
  | 'fg'
  | 'dim'
  | 'bright'
  | 'green'
  | 'yellow'
  | 'red'
  | 'blue'
  | 'magenta'
  | 'cyan';

export interface Span {
  text: string;
  tone?: ToneKey;
}

/** One rendered terminal row. `spans` are drawn end to end in the xterm palette. */
export type Row = readonly Span[];

export interface Pane {
  id: string;
  /** The pane's title, as it reads in the pane header and the Fleet Bar cell. */
  title: string;
  /** A provider key from the product's real set — see `providerLabel`. */
  provider: 'claude' | 'codex' | 'opencode' | 'powershell';
  workingDirectory: string;
  state: AgentActivityState;
  /**
   * How long this pane has been waiting, in milliseconds, at the moment the fleet is read.
   * Only meaningful for `needs_input` / `needs_permission` / `failed`.
   */
  waitedMs?: number;
  /** Why it is waiting. Shown as the cell's tooltip in the product; used here to keep copy honest. */
  reason?: string;
  transcript: readonly Row[];
}

const s = (text: string, tone?: ToneKey): Span => ({ text, tone });

/** A blank row. Terminals breathe; a wall of text does not read as one. */
const gap: Row = [s('')];

/**
 * Claude Code's transcript shape: a bulleted tool call, then an indented result line. Reproduced
 * at the level of structure and rhythm rather than glyph-for-glyph, which is the honest way to
 * show a third-party CLI inside a first-party product film.
 */
const call = (tool: string, detail: string): Row => [s('● ', 'green'), s(tool, 'bright'), s(` ${detail}`, 'fg')];
const result = (detail: string, tone: ToneKey = 'dim'): Row => [s('  ⎿  ', 'dim'), s(detail, tone)];

export const PROJECT = {
  name: 'orbital',
  rootPath: 'D:\\work\\orbital',
  /** The Workspace is named for the effort; the branch is the branch. They are not the same field. */
  branch: 'feat/idempotent-checkout',
} as const;

/** The pane the camera lives in for the opening: one agent, alone, working. */
const checkout: Pane = {
  id: 'checkout',
  title: 'Checkout API',
  provider: 'claude',
  // Coding agents are launched at the repository root, which is also what keeps the pane header
  // from squeezing its own title out — the product caps `.terminal-title strong` at 160px and
  // lets the working directory take the rest.
  workingDirectory: 'D:\\work\\orbital',
  state: 'working',
  /**
   * The longest transcript in the scenario, because this is the pane the film opens on and holds
   * closest. A terminal four lines into its first command has most of a screen of empty black
   * below it, which reads as an unfinished render rather than as a quiet morning — an agent the
   * viewer is meant to believe has been working needs the scrollback to prove it.
   */
  transcript: [
    call('Bash', 'git switch -c feat/idempotent-checkout'),
    result('Switched to a new branch'),
    gap,
    [s('> ', 'magenta'), s('read the checkout service and tell me where it can double-charge', 'fg')],
    gap,
    call('Grep', 'reserve\\(|capture\\(  services/checkout'),
    result('7 files, 23 matches'),
    call('Read', 'services/checkout/README.md (64 lines)'),
    result('Reservation and capture are documented as one step.', 'yellow'),
    gap,
    [s('  Two callers can reserve the same session concurrently: the guard', 'fg')],
    [s('  reads `session.reserved` before the write lands, so a retry inside', 'fg')],
    [s('  the window charges twice. It needs a ledger, not a flag.', 'fg')],
    gap,
    [s('> ', 'magenta'), s('split the checkout session into an idempotent two-phase commit', 'fg')],
    gap,
    call('Read', 'services/checkout/session.ts (412 lines)'),
    call('Read', 'services/checkout/reserve.ts (188 lines)'),
    result('Both paths share one mutable session record.'),
    gap,
    call('Edit', 'services/checkout/session.ts'),
    result('Updated with 64 additions and 19 removals', 'green'),
    call('Edit', 'services/checkout/reserve.ts'),
    result('Updated with 31 additions and 6 removals', 'green'),
    gap,
    call('Bash', 'npm test -- checkout'),
    result('Test Files  4 passed (4)', 'green'),
    result('     Tests  57 passed (57)', 'green'),
    gap,
    call('Edit', 'services/checkout/idempotency.ts'),
    result('Created 96 lines', 'green'),
    call('Bash', 'npm run typecheck'),
    result('tsc -b --pretty false'),
  ],
};

/** The pane that stops. Everything the film argues for is downstream of this transcript. */
const retries: Pane = {
  id: 'retries',
  title: 'Payment retries',
  provider: 'claude',
  workingDirectory: 'D:\\work\\orbital',
  state: 'needs_permission',
  waitedMs: 11 * 60_000 + 24_000,
  reason: 'Permission requested: git push origin payment-retries',
  transcript: [
    call('Edit', 'services/payments/retry-policy.ts'),
    result('Updated with 42 additions and 8 removals', 'green'),
    call('Bash', 'npm test -- payments'),
    result('     Tests  31 passed (31)', 'green'),
    gap,
    [s('  Exponential backoff is capped at 4 attempts and the dead-letter', 'fg')],
    [s('  queue is wired. Ready to push the branch.', 'fg')],
    gap,
    call('Bash', 'git push origin payment-retries'),
    gap,
    [s('  Allow this command?', 'yellow')],
    [s('  ❯ 1. Yes', 'bright')],
    [s('    2. Yes, and don’t ask again for git commands', 'dim')],
    [s('    3. No, tell Claude what to do differently', 'dim')],
  ],
};

const schema: Pane = {
  id: 'schema',
  title: 'Schema migration',
  provider: 'codex',
  workingDirectory: 'D:\\work\\orbital\\db',
  state: 'working',
  transcript: [
    [s('› ', 'cyan'), s('add the ledger_entries table with a reversible migration', 'fg')],
    gap,
    call('apply_patch', 'db/migrations/0042_ledger_entries.sql'),
    result('+58 lines', 'green'),
    call('shell', 'psql -f db/migrations/0042_ledger_entries.sql'),
    result('CREATE TABLE'),
    result('CREATE INDEX'),
    gap,
    call('shell', 'npm run db:verify'),
    result('42 migrations applied, 0 pending', 'green'),
    call('apply_patch', 'db/migrations/0042_ledger_entries.down.sql'),
    result('+11 lines', 'green'),
  ],
};

const flakes: Pane = {
  id: 'flakes',
  title: 'Test flakes',
  provider: 'claude',
  workingDirectory: 'D:\\work\\orbital',
  state: 'working',
  transcript: [
    call('Bash', 'npm test -- --reporter=json --run 20'),
    result('Collecting 20 runs…'),
    result('19 stable, 1 intermittent', 'yellow'),
    gap,
    call('Read', 'services/webhooks/dispatch.test.ts'),
    result('Timer is not faked; the assertion races the retry.', 'yellow'),
    call('Edit', 'services/webhooks/dispatch.test.ts'),
    result('Updated with 12 additions and 4 removals', 'green'),
    gap,
    call('Bash', 'npm test -- webhooks --run 20'),
    result('20 stable, 0 intermittent', 'green'),
  ],
};

const client: Pane = {
  id: 'client',
  title: 'Web client',
  provider: 'codex',
  workingDirectory: 'D:\\work\\orbital\\apps\\web',
  state: 'working',
  transcript: [
    call('apply_patch', 'apps/web/src/checkout/ConfirmStep.tsx'),
    result('+37 −12', 'green'),
    call('shell', 'npm run build'),
    result('vite v8.1.1 building for production…'),
    result('✓ 1,284 modules transformed', 'green'),
    result('dist/assets/index-9f2a1c.js   214.7 kB │ gzip: 68.1 kB'),
    gap,
    call('shell', 'npx playwright test checkout'),
    result('Running 14 tests using 4 workers'),
  ],
};

const devServer: Pane = {
  id: 'dev',
  title: 'dev server',
  provider: 'powershell',
  workingDirectory: 'D:\\work\\orbital',
  state: 'idle',
  transcript: [
    [s('PS D:\\work\\orbital> ', 'green'), s('npm run dev', 'fg')],
    gap,
    [s('  VITE v8.1.1', 'magenta'), s('  ready in 412 ms', 'dim')],
    gap,
    [s('  ➜  Local:   ', 'dim'), s('http://localhost:5173/', 'cyan')],
    [s('  ➜  API:     ', 'dim'), s('http://localhost:8787/', 'cyan')],
    gap,
    [s('  09:41:02 ', 'dim'), s('POST /v1/checkout/session ', 'fg'), s('201', 'green'), s(' 34ms', 'dim')],
    [s('  09:41:06 ', 'dim'), s('POST /v1/payments/retry  ', 'fg'), s('202', 'green'), s(' 12ms', 'dim')],
    [s('  09:41:11 ', 'dim'), s('GET  /v1/ledger/entries  ', 'fg'), s('200', 'green'), s('  8ms', 'dim')],
  ],
};

/**
 * The fleet, in canvas order. Six panes is the film's headline number and also the number the
 * strict-tiling canvas lays out cleanly at 1440x900 without any pane falling under its minimum.
 */
export const PANES: readonly Pane[] = [checkout, retries, schema, flakes, client, devServer];

export const paneById = (id: string): Pane => {
  const pane = PANES.find((candidate) => candidate.id === id);
  if (!pane) throw new Error(`No pane '${id}' in the scenario.`);
  return pane;
};

/**
 * The second agent to stop, used only in the closing beats. It arrives after the Fleet Bar has
 * already proved itself, so the film ends on the product absorbing a new interruption calmly
 * rather than on a fresh crisis.
 */
export const LATE_WAIT = {
  paneId: 'flakes',
  state: 'needs_input' as AgentActivityState,
  waitedMs: 38_000,
  reason: 'Question: keep the fake timer in the shared setup file?',
};

/**
 * The sidebar's Workspace list, spanning the one open Project.
 *
 * `status` values are the product's real `WorkspaceRuntimeStatus` union and the secondary line
 * follows the product's rule: a running Workspace states its runtime, a closed one lists the
 * providers it will start with.
 */
export const WORKSPACES = [
  { id: 'ws-checkout', name: 'checkout-rewrite', panes: 6, status: 'active', detail: '6 running' },
  { id: 'ws-webhooks', name: 'webhook-retries', panes: 4, status: 'partially_active', detail: '3 of 4 running' },
  { id: 'ws-perf', name: 'perf-audit', panes: 3, status: 'closed', detail: 'Claude Code · Codex CLI' },
  { id: 'ws-main', name: 'main', panes: 2, status: 'closed', detail: 'PowerShell' },
] as const;

/** The Repository view's working tree, consistent with the edits the transcripts show. */
export const CHANGES = [
  { path: 'services/checkout/session.ts', status: 'M', added: 64, removed: 19 },
  { path: 'services/checkout/reserve.ts', status: 'M', added: 31, removed: 6 },
  { path: 'services/checkout/idempotency.ts', status: 'A', added: 96, removed: 0 },
  { path: 'services/payments/retry-policy.ts', status: 'M', added: 42, removed: 8 },
  { path: 'db/migrations/0042_ledger_entries.sql', status: 'A', added: 58, removed: 0 },
  { path: 'services/webhooks/dispatch.test.ts', status: 'M', added: 12, removed: 4 },
] as const;

/** The hunk the review beat holds on. Real diff syntax, real file, counts that match `CHANGES`. */
export const REVIEW_HUNK: readonly Row[] = [
  [s('@@ -118,7 +118,19 @@ export async function reserve(', 'cyan'), s('session: Session) {', 'cyan')],
  [s('   const idempotencyKey = session.idempotencyKey', 'dim')],
  [s('-  if (session.reserved) return session', 'red')],
  [s('+  const existing = await ledger.find(idempotencyKey)', 'green')],
  [s('+  if (existing) return existing.session', 'green')],
  [s('+', 'green')],
  [s('+  return await ledger.transaction(async (tx) => {', 'green')],
  [s('+    const reserved = await tx.reserve(session)', 'green')],
  [s('+    await tx.record(idempotencyKey, reserved)', 'green')],
  [s('+    return reserved', 'green')],
  [s('+  })', 'green')],
  [s('   }', 'dim')],
];

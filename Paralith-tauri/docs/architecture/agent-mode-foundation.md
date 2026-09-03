# Agent Mode foundation

Agent Mode is an organizational control surface over Paralith's existing runtime. It is not a
second agent executor.

## Ownership boundaries

- `organizational_agents` owns durable teammate identity, role, responsibility, runtime routing
  preference, ordering and current organizational work state. Provider names are configuration,
  never teammate identity.
- `agent_conversations` and `agent_conversation_entries` own bounded conversation continuity.
  Historical retrieval must project these records through Brain/Context Fabric rather than append
  every transcript to every request.
- `agent_delegations` owns explicit owner/recipient/objective/constraints/result/authority and may
  reference an existing Project, Workspace and canonical `runs` record.
- `agent_workspace_authorities` records an explicit per-teammate Project/Workspace grant. A global
  connection or another teammate's grant does not satisfy this boundary.
- `agent_product_state` remembers the selected operating mode, teammate and conversation. It owns
  UI continuity only; it does not own Code workspace, pane, process or placement state.
- `skills` remains the one reusable-procedure store. `skill_activations.target_kind =
  'organizational_agent'` is the assignment seam; Agent Mode must not create another skills table.
- `runs` and `run_approvals` remain the canonical execution and approval records.
- `TerminalManager` remains the only interactive process owner. `RepositoryService` remains the
  audited Git/worktree boundary. `SwarmService` and the Orchestration Kernel remain the provider
  scheduling and capability-policy boundaries.
- `MemoryService`, `ContextCompiler`, and Brain remain the Context Fabric. Agent-specific context
  is a scoped projection with provenance, not another memory database.
- Activity Threads remain the notification model. Future delegation/run transitions should be
  projected into Activity and deep-link by organizational Agent, delegation, Run and Workspace id.

## Renderer lifecycle

The workspace screen keeps the Code sidebar, workspace canvas, terminal panes and tool surfaces
mounted while Agent Mode is visible. Agent Mode is an overlay inside the same application shell.
Changing modes therefore does not navigate, recreate the renderer, relaunch a terminal, or acquire
a second Workspace lease. A linked delegation may navigate only when the user explicitly opens a
different Workspace.

Agent runtimes are not restored merely because Agent Mode opens or Paralith restarts. Persisted
work remains honest (`idle`, `ready`, `blocked`, and so on) until an existing execution service
owns a real transition. Provider limits must block or pause the linked Run without deleting the
Agent, delegation, conversation, context references, or evidence.

## Execution

Delegation and execution are separate objects. A delegation is the organizational handoff and is
durable whether or not anything runs; **Agent Work** is the execution.

Agent Work is a row in `runs`, not a new table. `runs` has held the shape of “one unit of provider
work in a Project” since v38 — objective, workspace, worktree, resolved provider and model,
terminal session, status, result, parent linkage, timestamps — with `run_events` and
`run_approvals` beside it, and nothing had ever executed against it. Migration v44 adds only
`runs.agent_id` so the rail can ask what a teammate is doing without joining through delegations.
`agent_delegations.run_id` already pointed the other way.

    delegation (handoff)  ──run_id──►  run (agent_work)  ──►  run_events (evidence)
                                       │
                                       └──►  terminal_sessions (the exact execution)

### Lifecycle

`queued → preparing → working → verifying → completed`, with `waiting_user`, `needs_approval`,
`blocked`, `provider_limit`, `failed`, `cancelled` and `interrupted` as the other terminal or
paused states. One vocabulary is shared by persistence, the Agent rail, the work row, restart
recovery and the result reported to the parent.

### Authority

Role does not imply access. `agent_workspace_authorities` is the ceiling; a delegation's
constraints can only lower it (`narrow_by_constraints`). `commit` and `push` are false for every
Agent today because no capability grant exists for them, so “do not commit or push” is belt and
braces rather than the only barrier. The effective authority is persisted with the work and drives
`AgentInvocation::may_write`, which is what makes read-only structural: Claude loses its edit tools
and Codex runs in a read-only sandbox. Conversation turns remain `may_write: false` unconditionally.

### What crosses the handoff

Not the delegating Agent's chat history. The package is the recipient's identity, the objective,
the expected result, the constraints, the authority, and whatever `ContextCompiler` ranks as
relevant Project knowledge for that objective. The runtime is asked to end with a labelled result
(`SUMMARY`/`FILES`/`COMMANDS`/`VALIDATION`/`UNRESOLVED`); an unlabelled answer becomes the summary
and every other field stays empty, because an unreported validation is not a passing one.

### Evidence

`run_events` is the timeline. Alongside the runtime's own account, Paralith records what it
measured itself: the files the working tree shows as changed, whether HEAD moved, and the terminal
session holding the full transcript. HEAD moving without commit authority is recorded as a
`boundary_violation` event rather than dropped.

### Return path

The structured result — never the transcript — is written back into the originating conversation
as one entry attributed to the teammate who did the work, with the evidence pointer in its
metadata.

### Open in Code

Work records `executionWorkspaceId` and `executionPaneId` when its session starts. Opening it in
Code focuses that workspace and pane: the exact provider session, not the Project root. The
workspace keeps the `agent-mode-` prefix so `TerminalManager` gives it a wide, never-resized PTY;
attaching a viewer is safe because `resize_session` is a no-op for machine-protocol sessions.
Switching modes never touches process lifetime — the terminal runtime owns it, not either surface.

### Not in this slice

Nothing enters `needs_approval` yet. The status, `run_approvals` and the persisted work context
exist, but no consequential operation currently reaches a model that could request one: commit,
push and merge are denied structurally rather than offered for approval. Wiring an approval queue
is the next slice, not a claim this one makes.

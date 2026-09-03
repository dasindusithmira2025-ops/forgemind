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

## Current execution seam

This foundation persists and validates organizational work but does not fabricate an Agent reply
or start a provider process when a message or delegation is recorded. The next execution slice
must create a canonical Run, compile context through Brain/ContextCompiler, enforce the stored
Workspace authority through the Orchestration Kernel, and then associate the real Run and terminal
session with the delegation. “Open in Code” already uses the persisted Workspace identity and the
existing workspace route.

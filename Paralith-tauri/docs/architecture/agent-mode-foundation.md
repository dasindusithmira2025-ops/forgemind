# Agent Mode foundation

Agent Mode is an organizational control surface over Paralith's existing runtime. It is not a
second agent executor.

## Ownership boundaries

- `organizational_agents` owns durable teammate identity, role, responsibility, runtime routing
  preference, ordering and current organizational work state. Provider names are configuration,
  never teammate identity.
- `agent_conversations` and `agent_conversation_entries` own bounded, Project-bound conversation continuity.
  Historical retrieval must project these records through Brain/Context Fabric rather than append
  every transcript to every request.
- `agent_delegations` owns explicit owner/recipient/objective/constraints/result/authority and may
  reference an existing Project, Workspace and canonical `runs` record.
- `agent_workspace_authorities` records an explicit per-teammate Project/Workspace grant. A global
  connection or another teammate's grant does not satisfy this boundary.
- `agent_product_state` remembers the selected operating mode, teammate and conversation. It owns
  UI continuity only; it does not own Code workspace, pane, process or placement state.
- `agent_skills` owns Agent Mode procedures and `agent_skill_assignments` binds them to teammates.
- `runs` and `run_approvals` remain the canonical execution and approval records.
- `TerminalManager` remains the only interactive process owner. `RepositoryService` remains the
  audited Git/worktree boundary. `SwarmService` and the Orchestration Kernel remain the provider
  scheduling and capability-policy boundaries.
- `MemoryService`, `ContextCompiler`, and Brain remain the Context Fabric. Agent-specific context
  is a scoped projection with provenance, not another memory database.
- Activity Threads remain the notification model. Agent Work projects its canonical state over
  the provider-terminal observation so approvals, limits, interruptions and completion generate
  the correct in-app and native attention signal.

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
paused states. Interrupted and provider-limited work may continue in the same leased worktree;
authority is recomputed and the next runtime must be selected explicitly. One vocabulary is
shared by persistence, the Agent rail, Activity, restart recovery and the result reported to the parent.

### Authority

Role does not imply access. `agent_workspace_authorities` is the ceiling; a delegation's
constraints can only lower it (`narrow_by_constraints`). The effective authority drives both
`AgentInvocation::may_write` and `AgentInvocation::may_run_commands`. Claude loses denied tools;
Codex runs read-only and is refused for engineering work when command denial cannot be enforced.
Commit and push use separate allow/ask/deny capabilities and are performed only by
`RepositoryService`, never by provider cooperation. Conversation turns remain `may_write: false`.

### Isolation and repository approvals

Every Agent Work run creates an exclusive managed worktree lease before provider launch. The
provider's working directory, terminal record, evidence inspection and Open in Code target all use
that worktree; the user's checkout is never the execution directory. One teammate may have only
one live turn or work item, enforced transactionally.

An approval records the isolated worktree, branch, HEAD, changed paths and a repository snapshot
fingerprint. Approval execution rechecks that fingerprint under the repository mutation lock,
validates the Agent/run/task lease, commits only the reviewed paths, and publishes the pinned
branch. A changed tree makes the approval stale instead of sweeping new changes into `git add -A`.
An `allow` capability is also executed by Paralith against an immediately captured fingerprint;
the provider requests the action but never receives open-ended Git authority. If committing is
`ask`, an allowed push inherits that approval requirement because publishing may need a commit.

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

### Conversations

A conversation is bound to one Project. Legacy unbound conversations bind on their first
project-aware turn; a later cross-Project send is rejected, and history search is scoped to the
same Project. Messages may include a bounded set of explicit text/code attachments. Attachment
content is stored with the user entry and passed as delimited untrusted context—never interpreted
as a filesystem path or as authority.

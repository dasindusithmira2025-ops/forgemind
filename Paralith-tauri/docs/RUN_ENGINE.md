# Run Engine

The canonical execution primitive for Paralith (master spec §24).

A **Run** is one bounded, durable unit of autonomous execution. Every structured agent operation
is represented by a Run so that status, cancellation, history, context provenance and worktree
ownership are answered by one model instead of one per subsystem.

Before the Run Engine, Swarm was the only durable execution stack, and anything that was not a
Swarm had nowhere to live. Mission tasks, QA, security review, automations and long-running goals
would each have grown their own scheduler, their own status vocabulary, their own recovery. The
Run Engine exists so they do not.

```
                        RUN ENGINE
                             │
              ┌──────────────┴──────────────┐
              │                             │
      Single Agent Run                 Swarm Run
                                            │
                                    ┌───────┼───────┐
                                 Worker  Worker  Worker
                                 (child Runs)
                             ↓
                       Context Fabric
                             ↓
                         Worktree
                             ↓
                          Agent
                             ↓
                        Execution
                             ↓
                          Result
```

## Ownership

The Rust core owns Run lifecycle. The frontend **requests** create / cancel / retry / approve and
**observes** persisted state. It never writes `runs.status`.

This is what makes a Run durable: closing a pane, moving a Workspace between windows, reloading
the renderer, or quitting and restarting the application does not disturb, cancel, or lose a Run.
`RunsPanel` is a view; `RunService` is the authority.

## Lifecycle

States match the master spec exactly:

```
QUEUED → PREPARING → RUNNING → VERIFYING → REVIEW_READY → SUCCEEDED
             ↓          ↕
   WAITING_ENVIRONMENT  WAITING_APPROVAL
```

plus `FAILED`, `CANCELLED` and `INTERRUPTED`.

`RunStatus::may_transition_to` is the single authority on legal movement:

- cancellation and failure are reachable from **every** non-terminal state;
- interruption is reachable from every **active** state;
- `SUCCEEDED` / `FAILED` / `CANCELLED` are terminal — nothing transitions out of them. A retry
  creates a *new* Run whose `retry_of_run_id` points at the old one, so history is never rewritten;
- `INTERRUPTED → QUEUED` is the only path back into the queue, and only recovery takes it;
- a Run cannot skip preparation, and cannot succeed without having run.

`database::runs::transition_run` is the only writer of `runs.status`. It re-reads the row, checks
the state machine, writes the row and appends the journal entry **inside one `IMMEDIATE`
transaction**. The state machine is therefore an invariant, not a convention.

## Components

| Component | Responsibility |
| --- | --- |
| `models::run` | Domain types and the state machine |
| `database::runs` | Persistence, transitions, queries, approvals |
| `services::run_service::RunService` | Lifecycle owner, scheduler, recovery, events |
| `services::run_executor::RunExecutor` | Strategy contract |
| `services::run_executor::SingleAgentExecutor` | One agent, one objective, one session |
| `services::run_executor::SwarmExecutor` | Swarm as a strategy, workers as child Runs |
| `commands::run_commands` | Validated IPC boundary |
| `agents::invocation` | Provider-neutral CLI argument construction |

A strategy never writes status. It reports what it *observed* — started, running, needs approval,
finished, lost — and the engine decides the transition.

## Execution pipeline

```
create → QUEUED
   ↓ scheduler tick
claim → PREPARING          (exactly-once: a second tick is rejected by the state machine)
   ↓
resolve provider           → WAITING_ENVIRONMENT if not installed (parked, retried, not failed)
resolve worktree           → Repository control plane lease
compile context            → Context Fabric ContextPack, scope-validated
launch agent session       → TerminalManager owns the process
   ↓
RUNNING → poll each tick
   ├── approval observed   → durable RunApproval + WAITING_APPROVAL
   ├── provider terminal event → SUCCEEDED / FAILED
   └── process gone        → INTERRUPTED
```

### Isolation

`RunIsolation` decides where the agent runs:

- `shared_read_only` — the Project root, no writes. The resolved path is canonicalized and checked
  against the Project's canonical root before launch.
- `current_worktree` — the Project's working tree. Explicitly requested, never a default for writes.
- `isolated_worktree` — a dedicated Git worktree leased from the Repository control plane. **The
  default for any write-capable Run.**

The Run Engine never runs `git worktree` itself; the Repository control plane owns lease
accounting and conflict detection, and the lease is keyed on the Run id so a retried preparation
reuses the existing lease instead of leaving a second worktree behind.

### Context

The Run Engine never retrieves anything. It builds a `ContextRequest`, hands it to the Context
Fabric, records the resulting pack's id on the Run, and passes the pack to the agent. A pack that
fails `validate_scope` aborts the launch rather than reaching a provider.

### Agents

The Run Engine does not know Claude's or Codex's command line. It builds an `AgentInvocation`
(provider, model, effort, may-write, working directory, prompt, resume id) and calls
`agents::invocation::provider_arguments`. The Swarm engine's adapters call the same function, so
provider CLI knowledge exists once.

Read-only Runs get a deny-by-default permission mode and lose every write/delegation tool.

## Completion

A clean process exit is **not** success. Both providers emit an explicit terminal event, and only
that event may satisfy the completion gate. A session that exits 0 without one is recorded as
`completion_not_observed`, not as a success.

## Cancellation

Cancellation is real and layered: graceful interrupt first (so the provider can flush its own
final event), then process termination. It marks intent, stops execution, releases the session,
expires open approvals and persists final state.

**It never deletes the worktree.** Cancelled work stays inspectable and recoverable.

## Approvals

An approval is a durable row, not UI state. It is idempotent per `(run_id, kind)` — a provider that
re-emits its permission prompt on every poll cannot queue duplicates — and a decision is
single-shot, so a double-click cannot resolve the same request twice or resume a Run twice.

Approving resumes the Run. **Denying cancels it** rather than letting an agent proceed past a
boundary a person refused. A Run that ends expires its open approvals so nothing sits in the
Inbox asking for a decision that can no longer act.

## Recovery

Provider processes are children of the application process; none survive a restart. At startup,
before the scheduler thread can observe anything, `reconcile_after_restart` marks every Run that
still claimed a live process as `INTERRUPTED` with reason `application_restart`.

A Run is therefore never left displaying activity that nothing is producing. Interrupted Runs are
counted in the Inbox and are explicitly retryable.

## Idempotency and concurrency

- **Create** — an optional `idempotency_key` is enforced by a partial unique index on
  `(project_id, idempotency_key)`. A repeated UI command returns the existing Run rather than
  launching a second agent.
- **Start** — the `QUEUED → PREPARING` claim happens under a per-Run lock inside a transaction. A
  second tick, a second window, or a duplicated command is rejected by the state machine.
- **Complete** — a late completion callback against a terminal Run is rejected, not applied.
- **Approve** — `UPDATE ... WHERE status='open'` means only the call that actually decided wins.

The per-Run lock is a non-reentrant `parking_lot::Mutex`. Any path that already holds it must call
`cancel_locked`, not `cancel`.

Concurrency is bounded at `MAX_CONCURRENT_RUNS` executing Runs; the rest stay queued.

## Swarm relationship

Swarm is a **strategy**, not a separate engine.

`start_swarm` (IPC) now creates a `SwarmCoordinator` Run and *then* performs the launch
synchronously. The Run Engine's `SwarmExecutor` subsequently mirrors each Swarm agent attempt as a
**child Run** and projects the Swarm's lifecycle onto the canonical Run vocabulary.

The launch deliberately stays synchronous. `SwarmService::start_swarm` is where launch validation
lives — `swarm_already_started`, an unavailable runtime, a failed decomposition — and those typed
refusals must reach the user on the click, not surface as a failed Run a scheduler tick later.
If the launch is refused, `RunService::abandon_launch` fails the Run immediately so the scheduler
never retries work the Swarm engine already rejected.

`SwarmExecutor::start` therefore treats `swarm_already_started` as success: by the time the
scheduler reaches it the Swarm is normally already running, and attempting the launch anyway keeps
the strategy usable by future callers (automations, goals) that create a Swarm Run without
launching it themselves.

What this deliberately does **not** do is rewrite Swarm's scheduler, task graph or completion
gates. That is a large, well-tested subsystem, and trading working behavior for architectural
tidiness would be a bad deal. The migration is incremental and the seam is explicit:

| Owned by the Run Engine | Still owned by the Swarm engine |
| --- | --- |
| Launch entry point | Worker scheduling |
| Status vocabulary | Task graph and dependencies |
| Cancellation | Completion gates and evidence |
| History and parent/child tree | Role allocation and messaging |
| Inbox / attention | Phase detail |

Worker lifecycle can move behind this seam progressively without changing anything above it.

Because the mirror is a *projection* of state the Swarm engine already owns, a transition the
state machine rejects is skipped rather than forced — a stale poll is expected, not an error.

## Queries

Indexed for the surfaces that need them: by id, active, by project, by workspace, by Swarm, by
parent, needing attention, and a single aggregate `run_inbox_summary` so the Agent Inbox never
runs five list queries per render.

## Events

`run-changed` carries `project_id`, `run_id`, `root_run_id`, `parent_run_id`, `swarm_id`, status,
event kind, sequence and timestamp — enough to correlate a Swarm worker with its coordinator
without a follow-up query.

`run_events` is the durable journal. `sequence` is allocated from the owning Run row inside the
same transaction as the change it describes, so ordering is total and gap-free per Run.

## Schema

Migration **v38**, purely additive:

- `runs` — typed columns for everything the scheduler, recovery and surfaces query on;
  `metadata_json` holds only strategy-specific detail nothing else filters on
- `run_events` — the journal, `UNIQUE(run_id, sequence)`
- `run_approvals` — durable approvals, `UNIQUE(run_id, kind) WHERE status='open'`

## What the Run Engine is not, yet

- Verification is a **state**, not yet an implementation. `VERIFYING` and `REVIEW_READY` are
  reachable and tested, but no `VerificationExecutor` runs a verification suite.
- No Proof Ledger. Evidence for single-agent Runs is the journal plus the terminal transcript;
  Swarm evidence still lives in `swarm_evidence`.
- Policy is the isolation decision plus the provider permission mode. There is no capability
  gate for network, dependency install or Git push yet — `RunIsolation` is where that will attach.
- Host is implicitly local. `HostResolver` is not implemented.

# Mission Control

The orchestration layer directly above the Run Engine (master spec §22–§23).

A **Mission** is a desired engineering outcome. It is not a chat, a Run, a branch, a task list or
a prompt — it is the thing those exist to serve. A Mission owns *intent* and *acceptance*; a
**MissionTask** owns one executable piece of that intent; a **Run** owns *execution*.

```
USER INTENT
     ↓
   MISSION ──────────────┐
     ↓                   │
  PREFLIGHT              │  Project Graph · Impact · Memory · Git · Context Fabric
     ↓                   │
ACCEPTANCE CRITERIA ─────┘
     ↓
  TASK DAG
     ↓  dependency-aware scheduler
  RUN ENGINE
     ↓
AGENT / SWARM → CONTEXT FABRIC → WORKTREE → IMPLEMENTATION
     ↓
TASK IMPLEMENTED → DEPENDENTS UNLOCK
     ↓
MISSION IMPLEMENTATION COMPLETE
     ↓
(future) VERIFICATION → PROOF LEDGER → REVIEW → SHIP
```

## Ownership

Mission Control owns **lifecycle**. It owns **no execution**.

When a Task becomes ready, Mission Control asks the Run Engine for a Run and then observes durable
Run state. That is the entire integration, and it is deliberate: a second execution stack would
mean a second scheduler, a second status vocabulary and a second recovery path — exactly what the
Run Engine exists to prevent.

The Rust core owns Mission and Task state. The frontend *requests* domain actions and *observes*
what was persisted. There is no `set_mission_status` command, and there never will be.

Three properties everything else follows from:

| Property | Why it matters |
| --- | --- |
| **Reconciliation, not callbacks** | Task state is derived from persisted Run rows on every tick. A missed event, a crash between two writes, or a restart cannot desynchronise the two, because there is nothing to miss. |
| **Readiness is recomputed, never cached** | `ready_task_ids` is a pure function of Tasks and edges. Retry, plan revision and recovery converge on the same answer without a repair path. |
| **One backend scheduler** | Two windows observing the same Mission cannot launch the same Task twice, because the claim happens in the database, not in a component. |

## Mission lifecycle

```
DRAFT → PREFLIGHT → PLANNING → READY → RUNNING → REVIEW_READY → COMPLETED
          ↓ (failure returns to DRAFT with findings preserved)
                              RUNNING ↔ BLOCKED
                              RUNNING → VERIFYING  (reserved, never entered)
```

plus `FAILED` and `CANCELLED`, reachable from every non-terminal state.

`MissionStatus::may_transition_to` is the single authority. `database::missions::transition_mission`
is the only writer of `missions.status`: it re-reads the row, checks the state machine, writes the
row and appends the journal entry **inside one `IMMEDIATE` transaction**.

| State | Meaning |
| --- | --- |
| `DRAFT` | Captured intent. Nothing analysed, nothing executable. |
| `PREFLIGHT` | Gathering what Paralith already knows about the Project. |
| `PLANNING` | A plan is being generated or revised. |
| `READY` | A validated plan exists. Executable, not started. |
| `RUNNING` | At least one Task is executing or eligible to execute. |
| `BLOCKED` | The scheduler cannot proceed without a person. |
| `VERIFYING` | **Reserved.** Legal in the state machine, entered by nothing. |
| `REVIEW_READY` | Every implementation Task finished. *Implementation complete, verification pending.* |
| `COMPLETED` | A person accepted the outcome. Never reached by the machine alone. |

### Why `COMPLETED` is a human act

Until a Verification Orchestrator can produce Evidence against Acceptance Criteria, nothing in
Paralith is entitled to declare a Mission's outcome met. So:

- reaching `REVIEW_READY` sets `status_reason = implementation_complete_verification_pending`;
- `accept_mission` records **who** accepted it and sets
  `status_reason = accepted_without_verification`;
- the recorded event names how many criteria are still unverified;
- the UI says so in plain words rather than showing a green check.

## Tasks

```
PLANNED → WAITING → READY → RUNNING → IMPLEMENTED
                              ↓
                    BLOCKED ← ┴ → FAILED → (retry) WAITING
```

`IMPLEMENTED` is the strongest claim a Task can honestly make: *its execution finished
successfully*. It says nothing about whether the Mission's Acceptance Criteria hold, which is why
there is no `VERIFIED` here.

Only `IMPLEMENTED` satisfies a dependent's precondition. A failed or cancelled dependency leaves
its dependents `WAITING` rather than letting them run against work that does not exist.

### Retry

A retry re-enters the graph rather than force-starting: readiness is recomputed, so a retry whose
dependencies have since regressed waits. Each attempt is a **new Run**; the previous attempt's Run
is never rewritten.

```
Task "Backend callback"
 ├── Run #1  FAILED       (recorded, inspectable, worktree retained)
 └── Run #2  SUCCEEDED    (current attempt)
```

## Acceptance Criteria

First-class rows, not a Markdown blob — because the future Proof Ledger will attach Evidence to
one, and an identity that can be recycled cannot carry evidence.

- Matched by a stable plan key (`AC-01`). Editing a plan **updates** the same row.
- Removing a criterion **retires** it (`retired_at`) rather than deleting it.
- States are `UNVERIFIED | VERIFYING | VERIFIED | FAILED | WAIVED`. Today only `UNVERIFIED` and
  `WAIVED` are reachable; nothing in the codebase may set `VERIFIED`.
- Waiving requires a reason and records who waived it. It is the only criterion transition a
  person can perform.

Tasks map to criteria many-to-many (`mission_task_criteria`), and a Task's brief tells the agent
which criteria its work is measured against.

## Preflight

Before planning, Paralith asks *what do I already know about this Project?* — from subsystems that
already own that knowledge. Preflight retrieves nothing itself.

| Source | Contribution |
| --- | --- |
| Project Graph (`CodeIntelligence::search_symbols`) | Files and components the Mission's own words point at |
| Impact Intelligence (`CodeIntelligence::impact`) | Direct and transitive dependents of those files |
| Memory (`MemoryService::search`) | Decisions, conventions, prior incidents — stale ones labelled, not hidden |
| Repository control plane (`RepositoryService::inspect`) | Branch, HEAD, uncommitted changes |
| Context Fabric (`ContextCompiler::compile_cached`) | One planning Context Pack, scope-validated; Preflight stores its **id**, never its contents |

Every group of findings carries a `provenance` entry with `available: true|false`. A subsystem
with nothing to say is recorded as unavailable, so an empty section reads as *"asked and found
nothing"* rather than *"never asked"*. An unindexed Project, an empty Memory or a non-Git folder
is not an error — refusing to plan because the code index is cold would be a worse product.

A dirty working tree is surfaced as a **risk**, because Task worktrees branch from HEAD: that work
would be invisible to every agent the Mission launches.

## Planning

Two modes, both producing the same typed `MissionPlanDraft` and both going through the same
validation.

### `deterministic` (default)

Local decomposition from intent + Preflight. Costs nothing, always succeeds, and produces a plan a
person can read and edit before anything runs.

- Every stated **constraint** becomes an Acceptance Criterion. That is what turns "don't break
  login" into something a Proof Ledger can eventually evidence.
- Likely files are grouped by component into **independent strands**; two strands only exist when
  the Mission genuinely spans two areas, capped at three, and a single component is never split
  (files that change together must be written by one agent in one worktree).
- A coverage Task is planned only when the Project actually has tests.
- An integration Task is planned only when there is more than one strand to integrate.

It does not invent a five-phase plan for a one-line change.

### `agent`

A `MissionPlanning` Run: the agent reads the Preflight and writes `.paralith/mission-plan.json`
into its own worktree. Planning is agent work, so it is a Run — it inherits durability,
cancellation, recovery and history instead of becoming a second, unsupervised provider launcher.

The plan is untrusted input: it is parsed (tolerating the prose and fences providers wrap output
in), typed, and validated exactly like a human-authored one. It may only reference plan-local keys
(`T1`, `AC-01`), never database identifiers. The path read is derived from the Run's recorded
worktree, never from anything the agent said.

If it fails — unparseable, empty, cyclic, unknown reference, Run failed — the Mission returns to
`DRAFT` with the exact reason and its Preflight intact. It is never left stuck in `PLANNING`.

## The Task graph

A real DAG. `validate_dependency_graph` rejects, before anything is persisted:

- self-dependency
- duplicate edges
- edges to unknown Tasks
- edges crossing Mission boundaries
- **cycles** — reported as the Tasks that form them

Cycle detection is iterative, not recursive: a plan is untrusted input, so a deep chain must be an
error, never a blown stack. The schema enforces the self-dependency case a second time
(`CHECK(task_id <> depends_on_task_id)`) so bypassing application validation still cannot persist
one.

Validation runs **inside** the transaction that writes the plan, against the rows actually
written. A Mission can never persist a graph its scheduler would deadlock on.

## Scheduling

One authoritative backend scheduler thread, ticking every 1.1s and only over Missions in
`running` / `blocked` / `planning` (indexed).

```
observe Mission
   ↓
reconcile every running/blocked Task against its Run row
   ↓
recompute ready Tasks from the graph        (pure function)
   ↓
promote WAITING → READY                     (journalled, separate from launching)
   ↓
claim READY → RUNNING                       (conditional UPDATE: exactly-once)
   ↓
create Run                                  (Run Engine)
   ↓
settle Mission status
```

Bounded at `MAX_CONCURRENT_MISSION_TASKS = 3` per Mission, under the Run Engine's own global
ceiling, so one wide Mission cannot starve every other Mission and Swarm on the machine.

### Run → Task mapping

The whole translation, in one place, derived from persisted Run state:

| Run status | Task becomes |
| --- | --- |
| `Succeeded` | `IMPLEMENTED` (+ structured outputs recorded) |
| `Failed` | `FAILED`, `status_reason` = the Run's error code |
| `Cancelled` | `CANCELLED` |
| `Interrupted` | `BLOCKED` · `interrupted` · "Retry this Task to start a new attempt." |
| `WaitingApproval` | `BLOCKED` · `approval` · "Approve or deny the request on the Run." |
| `WaitingEnvironment` | `BLOCKED` · `provider` · "Install or select an available agent." |
| active (`Queued`…`ReviewReady`) | unchanged — **or** `BLOCKED → RUNNING`, which is how an approved permission resumes work |

The frontend never performs this translation.

### Mission settling

- every Task in a state that cannot produce more work → `REVIEW_READY`
- nothing running, nothing ready, and something blocked or failed → `BLOCKED`
- blocked but work can proceed again → `RUNNING`

A Mission waiting on a *manual* Task is still `RUNNING`, not blocked: a person is the work.

## Concurrency

| Race | What prevents it |
| --- | --- |
| Two ticks / two windows launching one Task | `UPDATE mission_tasks SET status='running' … WHERE id=? AND status='ready'` — exactly one caller sees an affected row; the losers get `Ok(None)`, not an error |
| A duplicated command creating two Runs | Run idempotency key `mission-task:{task_id}:{attempt}` |
| Interleaving between read and act | A per-Mission `parking_lot::Mutex` around every lifecycle mutation |
| A partially applied transition | Row read, legality check, write and journal entry share one `IMMEDIATE` transaction |
| Cancel racing a launch | The Mission transitions to `CANCELLED` **first**; the scheduler filters on Mission status |

## Run Engine integration

A Task executes by asking the Run Engine for a Run. Nothing else.

```rust
CreateRunRequest {
    run_type: RunType::MissionTask,        // or SwarmCoordinator for a Swarm Task
    execution_strategy: SingleAgent | Swarm,
    isolation: task.isolation ?? mission.default_isolation,   // isolated_worktree by default
    mission_id: Some(mission.id),
    mission_task_id: Some(task.id),
    objective: task_brief(mission, task),
    focus_files: task.focus_files,
    idempotency_key: "mission-task:{task_id}:{attempt}",
    trigger_source: Engine,
}
```

`runs.mission_id` / `runs.mission_task_id` are indexed columns, so the Mission timeline, attempt
history, per-Mission usage and the Agent Inbox are one query each rather than a metadata scan.

### Swarm

A Swarm Task delegates to the Swarm engine **through** a Run, never around it: Mission Control
creates the Swarm via `SwarmService::create_swarm` and then a `RunExecutionStrategy::Swarm` Run
that carries its id. The Run Engine's `SwarmExecutor` drives it. Mission Control implements no
Swarm topology, scheduling, role allocation or messaging of its own.

## Context

The Context Fabric supplies code and knowledge. Mission Control supplies **orchestration intent**,
and the two are kept separate on purpose.

A Task's brief carries:

- the Mission title and objective
- the Task's own objective
- constraints that must remain true
- explicit non-goals
- the Acceptance Criteria this Task contributes to
- **structured outputs of the Tasks it depends on**
- the files it is expected to touch

bounded at 6,000 characters. Dependency handoff is a small number of typed statements
(`Finding`, `InterfaceChange`, `Decision`, `Artifact`, `DependencyNote`, `Risk`, `Blocker`), each
traceable to the Run that produced it — never a predecessor's transcript. A finished Task leaves a
`Finding` (its result summary) and an `Artifact` (the branch and worktree its work landed on),
which is what a successor actually needs.

## Worktrees and Git

Mission Control **never runs Git**. Isolation is a policy it states; the Run Engine honours it via
the Repository control plane, which owns lease accounting and conflict detection.

- Write-capable Tasks default to `isolated_worktree` — independent parallel Tasks therefore write
  into separate worktrees on separate branches, which is what makes the parallelism safe.
- There is exactly one worktree source of truth: `repository_worktree_leases`. The dead
  `worktrees` table is gone (migration 39).
- Cancelling a Mission **never deletes a worktree**. Cancelled work stays inspectable.

**Integration is not automated.** Each Task's changes live on its own branch, recorded as an
`Artifact` output and queryable by `mission_id` / `mission_task_id` / `run_id`. Merging them is a
human decision through Source Control. Automatic merging of agent work is exactly the kind of
opaque automation this product avoids, and a Mission-level integration strategy is future work
(see *Remaining gaps*).

## Plan revision

Legal while a Mission is executing. A revision:

1. appends a new immutable `mission_plan_revisions` snapshot — never overwrites the previous one;
2. matches criteria and Tasks by **key**, so identity survives editing;
3. retires dropped criteria rather than deleting them;
4. cancels dropped Tasks **only if they never executed** — one that ran is preserved and reported;
5. rebuilds edges and criterion links, then re-validates the whole graph;
6. journals what changed, including preserved Tasks.

A revision never rewrites a Task's status, attempt count or current Run.

## Restart recovery

**Ordering is load-bearing.** `MissionService::reconcile_after_restart` runs *after*
`RunService::reconcile_after_restart` in `lib.rs`. Mission Tasks derive their state from Run rows,
so recovering Missions first would read a `running` Run that no process backs and conclude the
Task was fine.

| Mission was | Recovery |
| --- | --- |
| `PREFLIGHT` | → `DRAFT` with `preflight_interrupted`; findings preserved, retryable |
| `PLANNING`, no planning Run | → `DRAFT` with `planning_interrupted` |
| `PLANNING`, agent Run | left alone — the Run is durable; the scheduler resolves it |
| `RUNNING` / `BLOCKED` | journal a `recovered` event, then run one ordinary `advance` |

A Task that was claimed but whose Run was never created (a crash between the two writes) becomes
`BLOCKED · launch_failed` with a retry action — distinct from an agent that tried and failed.

A Mission is never left displaying activity nothing is producing.

## Errors

Launch failure and execution failure are different facts and are recorded differently:

- `launch_failed` — the Run could not be created, or was claimed and never attached. Retryable
  without implying the work was attempted.
- `provider` — the agent executable is unavailable. Parked, not failed.
- execution failure — the agent ran and reported failure; `status_reason` carries the Run's own
  error code.

Every blocker carries a typed kind, a message and a **required action**, because "something went
wrong" is not an action.

## Persistence (migration 39)

The abandoned v7 Mission cluster was **retired, not evolved**. It was designed for an architecture
Paralith no longer has: `mission_sessions` duplicated agent sessions, `worktrees` duplicated
`repository_worktree_leases`, `evidence_records` / `verification_*` anticipated a verification
engine a later mission will design properly. None had a single read or write outside migrations.

Retired: `worktrees`, `mission_sessions`, `task_events`, `evidence_records`,
`verification_results`, `recovery_states`, and the old `missions`, `mission_tasks`,
`acceptance_criteria`, `task_dependencies`, `task_acceptance_criteria`. A table containing rows is
preserved as `<name>_legacy_v7` rather than dropped.

| Table | Purpose |
| --- | --- |
| `missions` | The Mission. `project_id` is now `ON DELETE CASCADE` (was `RESTRICT`, which let a table nothing wrote block Project deletion) |
| `mission_acceptance_criteria` | Durable, stably keyed criteria; `retired_at` instead of deletion |
| `mission_tasks` | Executable units; `UNIQUE(mission_id, key)` |
| `mission_task_dependencies` | The DAG; `CHECK(task_id <> depends_on_task_id)` |
| `mission_task_criteria` | Many-to-many Task ↔ criterion |
| `mission_events` | The journal; `UNIQUE(mission_id, sequence)`, allocated from the Mission row |
| `mission_plan_revisions` | Immutable plan snapshots; `UNIQUE(mission_id, revision)` |
| `mission_preflight` | One row per Mission — the latest findings |
| `mission_task_outputs` | Structured handoff between Tasks |
| `runs` | gains `mission_id` / `mission_task_id`, both indexed, both `ON DELETE SET NULL` so a Run's own history survives |

The generically named `acceptance_criteria`, `task_dependencies` and `task_acceptance_criteria`
became Mission-scoped names so the schema stops reading as if Paralith had global criteria and a
global task graph.

Migration 39 is **re-entrant**: the rebuilt tables keep the names the retired ones had, so it
detects its own output (`missions.planning_mode`) and refuses to retire it.

## IPC

Domain actions and reads only. No status writes.

```
create_mission            update_mission_draft      prepare_mission
start_mission             cancel_mission            revise_mission_plan
accept_mission            retry_mission_task        start_mission_task
complete_manual_mission_task                        waive_acceptance_criterion
list_missions             get_mission_detail        get_mission_activity
get_mission_plan_revisions                          get_mission_runs
get_mission_task_outputs
```

Every command requires the main-window scope. Every input is bounded and path-checked at the
boundary: objectives and titles have ceilings because they become agent instructions and Context
Fabric queries; plan keys must be plain identifiers because they are identities a Proof Ledger
will resolve; focus files go through the same project-relative path guard the Run Engine uses.

`mission-changed` carries `project_id`, `mission_id`, `task_id`, `run_id`, status, kind, sequence
and timestamp — enough for a surface to decide what to refetch without a follow-up query.

## The surface

`/missions/:projectId`, reached from the sidebar.

**List** — status, real counts (`3 / 7 implemented · 2 running · 1 blocked`), criteria still
unverified, active Runs, risk. Filters: All / Active / Needs you / Accepted. No percentage is
shown, because none would be checkable.

**Composer** — one required field: *What do you want to build or change?* Constraints, non-goals,
planning mode and agent are behind an Options disclosure with working defaults. Creating a Mission
immediately runs Preflight and planning, because seeing the plan is the point.

**Detail** — Plan · Tasks · Runs · Activity.

- *Plan*: Preflight (with per-source provenance, unavailable sources labelled), constraints,
  non-goals, Acceptance Criteria with an explicit "nothing verifies these yet", and the numbered
  plan with its dependencies.
- *Tasks*: a structured list by default (glyph, status, agent, elapsed, attempt, dependencies,
  criteria, Run), with blockers showing their required action; a layered graph view on request.
  The list is the default because a graph should not be the only way to understand work.
- *Runs*: every Run the Mission created, superseded attempts included.
- *Activity*: the durable journal.

Controls that cannot act are not rendered — no permanently disabled Build button.

## Future seams

These are prepared, not implemented. Nothing pretends otherwise.

**Verification Orchestrator.** `MissionStatus::Verifying` exists and its transitions are tested;
nothing enters it. Acceptance Criteria have stable ids, typed kinds, `required_evidence_level`
intent (`kind`), verification hints, and many-to-many Task links. `Mission.verification_plan`
persists how a Mission *should* be validated. A verification engine attaches at `Running →
Verifying → ReviewReady` and at `AcceptanceCriterionStatus`.

**Proof Ledger.** Criterion ids are never recycled: editing updates in place, removal retires.
Evidence attaches to `mission_acceptance_criteria.id`.

**Review Center 2.0.** Every change is queryable by `mission_id`, `mission_task_id`, `run_id` and
worktree, so a future Review Center can group changes by intent.

## Validation

```
cargo fmt --check                     clean
cargo clippy --all-targets            no warnings
cargo test                            796 passed, 4 ignored (the provider canaries)
npm run typecheck / lint / test       clean · 857 passed
npm run build                         clean
```

Real-provider canaries, run deliberately:

```
cargo test --lib run_engine_canary      -- --ignored --nocapture --test-threads=1
cargo test --lib mission_control_canary -- --ignored --nocapture --test-threads=1
```

The Mission canary drives a real two-Task Mission — Preflight → criteria → DAG → Run Engine →
Claude/Codex → separate worktrees → dependency unlock → implementation complete — against
production code, in a throwaway Git repository.

## Remaining gaps

- **Verification and Proof are not implemented.** `VERIFYING` is never entered and no criterion
  can become `VERIFIED`.
- **Mission-level integration is manual.** Task branches are linked and queryable; merging them is
  a human decision in Source Control. No automatic merge, by design.
- **Pause is not implemented.** A pause that only stops UI updates would be a lie, and the Run
  Engine has no suspend primitive today. Cancel and retry are real; pause is future work.
- **The agent planner is not exercised by a canary.** Its parsing, validation and failure paths
  are unit-tested; the deterministic planner is what the end-to-end canary drives.
- **Usage is correlatable but not surfaced.** `runs.mission_id` makes per-Mission usage a query;
  no Mission usage panel exists yet.

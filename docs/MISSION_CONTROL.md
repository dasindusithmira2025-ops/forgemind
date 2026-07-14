# ForgeMind Mission Control architecture

## Repository audit and preserved execution flow

ForgeMind is a Tauri 2 desktop application with a React/TypeScript renderer, Rust command layer, SQLite persistence, and native PTYs through `portable-pty`. The pre-existing Workspace path remains `Project -> Workspace -> Pane Configuration -> Terminal Session -> Agent Session`. Workspace setup persists pane assignments; the Workspace route asks Rust to launch a trusted saved pane; `TerminalManager` owns the process, stream, tail, transcript log, exit watcher, and process-tree termination. Agent discovery persists provider-neutral profiles for Claude Code, Codex CLI, OpenCode, custom agents, and shells.

Mission Control extends those seams instead of replacing them:

`Mission Control UI -> missionStore -> typed src/native command -> mission/task domain + SQLite -> MissionControlService -> owned Git worktree -> AgentExecutionAdapter -> existing TerminalManager -> task events -> verification/evidence -> Review -> explicit merge/discard/rollback`

React never calls filesystem, Git, child-process, Electron, or Tauri process APIs directly. Durable domain state is separate from transient Mission Control selection/dialog state. Native PTY handles remain outside serializable frontend state.

## Persistent model

Schema migration 7 is additive and creates missions, acceptance criteria, tasks, dependency and criterion joins, worktrees, mission sessions, chronological task events, verification profiles/checks/results, evidence, audit events, recovery incidents, trusted project context, and unapproved context suggestions. Foreign keys prevent cross-mission task references and use restrictive or explicit cascading behavior. Existing Workspace records default to `system_kind='user'`; mission runtime Workspaces use `system_kind='mission'` and never appear in the ordinary launcher.

Mission drafts are written through the same validated command boundary after a short renderer debounce. Acceptance criteria are individual rows. Task dependencies are checked for missing references, self-dependencies, and cycles before commit. Ready calculation is deterministic: every dependency must pass; failed, blocked, or cancelled dependencies block downstream tasks.

## Worktree lifecycle

Dispatch verifies the Project repository, resolves the base ref to an immutable commit, generates `forgemind/<mission-id>/<task-id>-<portable-slug>`, checks branch/path collisions, bounds Windows path length, and inserts a `creating` resource record before `git worktree add`. Worktrees live under the ForgeMind app-data directory. Ownership metadata is stored beside—not inside—the checkout and binds the worktree, task, mission, and repository identities.

Cleanup canonicalizes the worktree and controlled root, validates the ownership marker, confirms Git still lists the path, and only then removes that exact worktree. Only a `forgemind/` task branch can be deleted. Evidence and audit records remain. Missing or mismatched ownership produces a recoverable cleanup failure, never a recursive unknown-directory deletion.

Non-Git Projects can run only after explicit non-isolated confirmation. The UI warns that parallel execution is unsafe in this mode.

## Agent execution and recovery

Mission-domain code references agent IDs and roles, not vendors. `AgentExecutionAdapter` owns provider launch shaping and completion interpretation. A launch prompt includes mission objective, relevant criteria, dependencies, repository instructions, assigned worktree, verification expectations, and safety limits. Dispatch acquires an atomic database execution lock, creates a hidden runtime Workspace/Pane, and launches the real existing terminal runtime.

The mission session records the terminal ID, worktree, working directory, safe command summary, process ID, timestamps, transcript path, and recovery metadata. On exit, `TerminalManager` durably updates the terminal row before removing the live handle. Polling and startup reconciliation consult the live manager first and the durable terminal snapshot second, preventing a normal successful exit from being mislabeled abandoned. Truly ambiguous sessions become `needs-recovery` and offer reattach when still live, retry, mark failed, or owned cleanup; recovery data is retained.

## Verification, evidence, and review

Project inspection suggests package scripts and Cargo checks but saves profiles unapproved. The renderer presents the exact commands and requires explicit confirmation before approval. Checks run in the task worktree in declared order, support per-check timeout/cancellation, preserve exit code/duration/status, stream lifecycle events, redact sensitive output, store a bounded safe excerpt, and retain a complete redacted artifact log.

Each verification result creates task evidence and criterion-specific evidence for every criterion assigned to that task. Required check failure or unproved required criterion blocks acceptance and merge. The Review Center reads current Git status, branch commits, unified diff, conflicts, verification results, evidence, dependency manifests, migration paths, and environment-variable names only.

## Merge, discard, and rollback transactions

Merge is never automatic. It requires a passed task, required verification, proved assigned criteria, a mergeable owned worktree, and no unresolved conflict. The primary checkout must be clean and the task branch must still exist. The explicit Merge action snapshots uncommitted accepted work on the task branch using a local per-command ForgeMind identity, creates a restore ref, and performs `--no-ff` merge. Conflicts trigger `git merge --abort`, persist `conflicted`, retain the worktree, and record diagnostics.

Successful merge retains the worktree until a later verified cleanup. Rollback only reverts the recorded ForgeMind merge commit and aborts a failed revert. Discard first stops the owned session, validates worktree ownership, removes only the recorded worktree and ForgeMind branch, and retains logs/evidence. Every creation, launch, command approval, acceptance, merge, discard, recovery, and rollback writes an audit event with redacted details.

## Known first-version boundaries

Mission planning suggestions are deterministic local decomposition, not an LLM planner. Existing CLI agents are supported through detected executable profiles; provider-specific session resume is available only when the original PTY is still live, otherwise recovery uses retry. Worktrees remain after merge by design until explicit cleanup. Verification output lifecycle is streamed as structured start/completion events while full raw command bytes live in the artifact log rather than the terminal event bus.

# Repository Command Center backend

The Repository Command Center is a project-scoped native service. Git remains authoritative for
local state; GitHub remains authoritative for collaboration state. SQLite stores leases,
idempotency, approval state, remote projections, recovery checkpoints, and an attributable
operation history. It does not copy Git history.

## Ownership and trust boundaries

- `RepositoryService` is the repository mutation boundary. The pre-existing pane stage, restore,
  and isolated-worktree commands now translate their user intent into the same queue, policy,
  approval, lease, and ledger path instead of invoking Git mutations directly.
- The service invokes installed `git` and `gh` executables with structured arguments and hidden
  Windows helper processes. Path-bearing Git operations enable literal pathspec handling.
- Every Tauri command validates the caller's active Project/window ownership before reaching the
  service. Agent actors must match an active task, branch, and worktree lease.
- Git transport continues to use the user's Git configuration, hooks, signing, SSH, Git
  Credential Manager, LFS, and submodule configuration.
- GitHub API authorization is delegated to `gh` and its secure credential store. PARALITH never
  reads or returns a token. Git transport credentials and GitHub API authorization are separate.
- A future Corelith GitHub App exchange service may replace the `gh` adapter. A private app key
  must never be compiled into the desktop application.

## Durable model

Schema 13 adds repository connections, policies, provider-account metadata without secrets,
provider-installation metadata, worktree/branch leases, operations, approvals, remote cache,
sync cursors, webhook-delivery deduplication, and recovery checkpoints. Active worktree and branch
leases have partial unique indexes, and operation idempotency is unique per Project.

Repository operations append redacted records to the existing immutable `audit_events` ledger.
The Mission Control and Memory runtime modules were removed from PARALITH 0.2.0; this integration
uses the surviving ledger schema and does not claim that those deleted product surfaces are active.

## Safety model

- Non-refresh operations pin the expected branch and HEAD. Pushes and merges cannot run from an
  unpinned frontend request.
- Conservative, Balanced, Autonomous, and Custom policies are enforced in Rust. Force-pushing or
  deleting a configured protected branch is blocked. Destructive/history-rewriting operations
  require approval in every profile.
- Approval records bind the serialized operation hash, HEAD, branch, complete status fingerprint,
  actor, expiry, and single-use consumption. Any material Git-state change invalidates approval.
- Mutations are serialized by worktree or branch. Cancellation kills the owned helper process;
  timeouts and captured output are bounded. Interrupted operations become `needs_recovery` on the
  next startup and no user changes are discarded automatically.
- Worktree cleanup refuses uncommitted changes and active terminal/agent sessions. Branch cleanup
  occurs only when Git proves the branch is merged.
- Agent commits enforce lease file scope, reject likely credential files/content and oversized
  additions, and record validation as `not_run` unless real validation evidence exists.

## Provider and synchronization behavior

GitHub draft PR, review, workflow, release, and merge actions run through typed operations. Merge
execution refreshes PR state and validates the expected head SHA immediately before invoking the
provider merge. Manual remote refresh synchronizes bounded PR, issue, workflow-run, release, and
repository metadata into SQLite; failed refreshes return the last projection marked stale.

The desktop does not host a public webhook endpoint. The schema includes delivery deduplication for
an authenticated Corelith relay, but signature verification and relay ingestion belong in that
server boundary and are not exposed as a desktop command.

The current desktop adapter uses the installed GitHub CLI as its secure API transport. Provider-
neutral operation and projection contracts are in place, but extracting the CLI adapter behind a
runtime-pluggable provider trait, adding GitLab or Bitbucket, and replacing manual refresh with an
event relay plus bounded background synchronization remain separate delivery work. Repository
changes made outside PARALITH are always reconciled by explicit refresh; a native debounced file
watcher is not part of schema 13.

## Tauri boundary

`src/native/types.ts`, `commands.ts`, and `events.ts` mirror the Rust contracts. Events cover
operation progress/completion, approval requests/decisions, repository-state changes, and sync
health. Diffs are paged and bounded; the frontend never parses raw Git status or terminal output.

PARALITH 0.2.0 has no general desktop notification service. Repository events are emitted through
the established Tauri event boundary; OS-level notification delivery is intentionally not claimed.

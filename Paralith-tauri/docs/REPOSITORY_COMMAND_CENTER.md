# Source Control backend

Source Control is a workspace/worktree-scoped developer surface backed by the existing
`RepositoryService`. Git remains authoritative for local state; forge providers add contextual
collaboration state only for the active work. SQLite stores leases, idempotency, approval state,
remote projections, recovery checkpoints, and an attributable operation history. It does not copy
Git history.

## Ownership and trust boundaries

- `RepositoryService` is the repository mutation boundary. Source Control, pane stage/restore,
  and isolated-worktree commands translate user intent into the same queue, policy, approval,
  lease, and ledger path instead of invoking Git mutations directly.
- The service invokes installed `git` and `gh` executables with structured arguments and hidden
  Windows helper processes. Path-bearing Git operations enable literal pathspec handling.
- Every Git operation resolves against an explicit repository/worktree path before reaching the
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

Schema 14 extends each provider sync cursor with a safe failure message, required permission, and
recovery action. Existing cursor state is preserved during the forward-only upgrade. The frontend
can therefore distinguish an authoritative empty result from stale cache, expired authentication,
missing permission, provider failure, or rate limiting for each remote data category.

Repository operations append redacted records to the existing immutable `audit_events` ledger.
The integration preserves the existing Mission Control and Memory ownership boundaries and does
not create a parallel task, evidence, or project model.

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

GitHub draft PR, review, check, and merge actions run through typed operations. Merge execution
refreshes PR state and validates the expected head SHA immediately before invoking the provider
merge. Source Control refresh synchronizes repository metadata and pull requests for the active
workspace. Detailed PR and check data is loaded contextually; generic repository administration,
releases, security dashboards, rulesets, organization state and global Actions browsing belong on
GitHub. Failures preserve the last projection and its explicit diagnostic state.

The desktop does not host a public webhook endpoint. The schema includes delivery deduplication for
an authenticated Corelith relay, but signature verification and relay ingestion belong in that
server boundary and are not exposed as a desktop command.

The current desktop adapter uses the installed GitHub CLI as its secure API transport. Provider-
neutral operation and projection contracts are in place, but extracting the CLI adapter behind a
runtime-pluggable provider trait, adding GitLab or Bitbucket, and adding an event relay remain
separate delivery work. Repository changes made outside PARALITH are reconciled by explicit or
bounded background refresh; a native debounced file watcher is not part of schema 14.

## Tauri boundary

`src/native/types.ts`, `commands.ts`, and `events.ts` mirror the Rust contracts. Events cover
operation progress/completion, approval requests/decisions, repository-state changes, and sync
health. Diffs are paged and bounded; the frontend never parses raw Git status or terminal output.

PARALITH 0.2.0 has no general desktop notification service. Repository events are emitted through
the established Tauri event boundary; OS-level notification delivery is intentionally not claimed.

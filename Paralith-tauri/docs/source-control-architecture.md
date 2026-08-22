# Source Control Architecture

Paralith treats the workspace/worktree as the unit of development. Source Control is scoped to the active workspace and derives its repository root and worktree root from that workspace context before any Git or forge operation runs.

## Ownership

- Workspace/worktree context owns the active development scope: project id, workspace id, repository root, worktree root, active panes, terminals, agents and task metadata.
- The local Git engine remains the source of truth for status, diffs, staging, commits, branches, remotes, ahead/behind state and worktrees.
- Forge providers add contextual collaboration data for the current branch/worktree: current pull request, pull request creation, review/check status, browser URLs and issue/task links where they support the active work.
- GitHub repository administration stays on GitHub. Paralith should link out for repository settings, organization management, releases, packages, security dashboards, insights, wiki and generic Actions browsing.
- The application updater and release pipeline are separate from developer forge integration. Source Control must not change updater manifests, stable release channels, installer contracts or update verification behavior.

## Data Flow

```text
WorkspaceToolPanel
  -> Source Control surface
  -> repositoryStore.loadProject(projectId, repositoryPath, worktreePath)
  -> native.inspectRepository
  -> RepositoryService
  -> git executable / filesystem
```

Remote review data is resolved only after local repository identity is known:

```text
Source Control surface
  -> repositoryStore.refreshRemote
  -> native.refreshRepositoryRemoteProjection(repositoryPath)
  -> RepositoryService
  -> forge provider capability detection
  -> gh / GitHub API where available
  -> cached remote projection
```

## Capability Inventory

Keep in Source Control:

- local status, diff, staging, unstaging, discard, commit, branch identity, worktree identity, remotes, ahead/behind state, pull, push and operation ledger
- current branch pull request discovery, pull request creation, review/check status and failed-check agent handoff
- contextual links to open the repository, pull request, issue or check in the browser

Move or keep contextual:

- GitHub issues belong to task/work intake and should appear on Source Control only as linked task metadata
- pull request details belong in the contextual review tab for the current branch/worktree
- check logs are loaded on demand for the selected pull request/check

Delete from the Paralith product surface:

- generic repository homepages, stars, forks, watchers, contributors, insights, wiki, packages, repository settings clones, organization management, release administration, global Actions dashboards and remote file browsers duplicating local Explorer

## Refresh Model

Local Git state refreshes when the active workspace changes, a Git operation completes, the user explicitly refreshes, or filesystem/agent mutations invalidate the active worktree. Remote forge state refreshes only for the active workspace and visible review surface, with cached projection data preserved when the provider fails.

Inactive worktrees must not generate aggressive GitHub traffic. Remote failures must not block local Git status, diff, staging, commit, branch, worktree or offline work.

## Security Boundaries

- Every Git operation must execute against an explicit repository/worktree path.
- Git and `gh` are invoked with structured process arguments, not interpolated shell strings.
- Repository paths and file paths are validated at the backend boundary.
- Mutating Git operations for the same worktree are serialized by RepositoryService worktree mutation locking.
- GitHub authentication state is detected through provider capability checks; Source Control must degrade when `gh` is missing, unauthenticated, rate limited, offline or unsupported.
- Tokens and credentials must not be logged or surfaced in UI errors.

## UI Boundary

Source Control is the single developer workflow surface for local Git and current-review context. It lives in the workspace tool panel, follows the existing surface/tab model, and keeps the persisted internal surface kind `diff` for workspace-layout compatibility while presenting the user-facing label `Source Control`.

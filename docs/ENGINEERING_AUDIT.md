# ForgeMind Refactor Audit

## Baseline findings

The original route set was compatible with the desired product, but the entity ownership beneath it was not. Project and Workspace context could disagree, the active-context selector did not actually enforce ownership, and recent/runtime concepts were easy to confuse. Workspace Setup used a sequential visual wizard, while the running Workspace combined orchestration, terminal restoration, layout, menus, provider selection, and terminal rendering in one large screen.

Live sessions and output were coupled to global React state. Each Pane installed broad event listeners, restoration used an unbounded renderer-side launch fan-out, and a renderer request selected executable, arguments, and working directory. Rust emitted each PTY read directly rather than using isolated bounded pipelines. The database allowed Terminal Sessions to outlive strict Pane/Workspace ownership, and it lacked Agent Session, repair-history, and quarantine models.

UX noise came from dashboard-like presentation, repeated path/branch/count metadata, permanent row actions, heavy cards and glow, a two-step Setup wizard, broad Settings sections with incomplete behavior, and terminal states that could disappear into a whole-screen error.

## Refactor decisions

- Kept the four primary routes and added an explicit configure route with compatibility handling.
- Made Project, Workspace, Pane Configuration, Terminal Session, and Agent Session separate in TypeScript, Rust, SQLite, selectors, and copy.
- Replaced renderer-owned live terminal state with a per-session external runtime store.
- Replaced renderer-selected launch specifications with trusted Workspace/Pane IDs.
- Added one native TerminalManager, per-session bounded output pipelines, persisted tails, optional rotating logs, and owned process-tree cleanup.
- Added a native restoration scheduler with active-Pane priority, bounded initial launch, visible deferred Panes, and a circuit breaker.
- Added forward-only schema migration, pre-migration backup, strict foreign keys, idempotent repair, quarantine, and health reporting.
- Rebuilt the Launcher as grouped Projects containing Workspaces; Setup as simultaneous configuration, assignment, and provider zones; Workspace as a terminal-dominant shell; and Settings as focused sections with consistent rows.
- Removed Terminal Session/output ownership from Zustand and removed direct `invoke` usage from screens/components.

## Validation model

Automated gates cover TypeScript, lint, frontend route/store/runtime behavior, Rust domain/database/runtime behavior, formatting, Clippy, web production build, and Tauri release packaging. Desktop validation uses the real Tauri WebView and native PTYs. Manual results and unexecuted scenarios are reported separately in the delivery report; automated evidence is not presented as manual proof.

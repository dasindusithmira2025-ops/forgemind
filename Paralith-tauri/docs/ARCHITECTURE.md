# PARALITH Architecture

PARALITH is a single-window, terminal-first Tauri application. Its durable hierarchy is:

`Project -> Workspace -> Pane Configuration -> Terminal Session -> Agent Session`

- A Project is one canonical local directory. Canonical roots are unique.
- A Workspace is a named, saved environment owned by exactly one Project. Normalized names are unique within that Project.
- A Pane Configuration is durable layout and launch metadata owned by one Workspace.
- A Terminal Session is a temporary native PTY owned by one Project, Workspace, and Pane.
- An Agent Session is provider metadata attached to one Terminal Session. It is created only for coding-agent providers.

## Application routes

- `/` — Project Launcher, with Projects as parents and Workspaces as children.
- `/setup/:projectId` — create a Workspace.
- `/workspace/:workspaceId/configure` — edit a Workspace in place.
- `/workspace/:workspaceId` — run the terminal Workspace.
- `/settings` — focused settings and diagnostics.

The legacy `?workspaceId=` setup link remains readable during migration. New links use the explicit configure route.

## Frontend boundaries

Screens orchestrate route data and feature components. `src/native` is the only Tauri command boundary; UI primitives do not invoke native commands. Low-frequency context and UI preferences live in Zustand. Terminal output and live-session state live in the external `TerminalRuntimeStore`, which exposes stable per-session and per-Workspace subscriptions through `useSyncExternalStore`.

Each `TerminalPane` creates exactly one xterm instance, installs its addons once, serializes writes, owns one `ResizeObserver`, and subscribes only to its Terminal Session. Moving to another Workspace unmounts the previous xterm canvases while native PTYs and bounded tails can continue according to settings.

The recursive layout tree is the sole pane-position model. Split sizes are persisted without replacing the tree during maximize mode.

## Native boundaries

Tauri commands accept durable entity IDs for owned runtime operations. The renderer cannot choose an arbitrary executable, working directory, or process ID when starting or stopping a terminal. Rust resolves the launch request from the persisted Pane Configuration, validates ownership, and delegates provider-specific launch shaping to an adapter.

`AppState` owns narrow service references: database context, provider detector/registry, terminal manager, restoration scheduler, and diagnostics path. Live PTYs are individually locked; no global mutex is held while reading output, waiting for exit, emitting an event, or scanning providers.

## Terminal runtime

There is one native `TerminalManager`. Each handle owns its PTY master, writer, child, cancellation state, metadata, sequence, bounded output tail, and optional rotating log. PTY reads enter a per-session bounded queue. A per-session worker batches up to 64 KiB on a short delivery window, advances a monotonic sequence, appends a 64 KiB native tail, optionally writes a 5 MiB rotating log, and emits a typed event.

Queue overflow is isolated to the noisy session and counted in `droppedOutputBytes`. The renderer uses one serialized xterm write chain per Pane and acknowledges ordered chunks. Reconnecting renderers request the current native tail and sequence before consuming new events.

On Windows, PARALITH verifies executable targets, rejects WindowsApps aliases, resolves shell fallbacks, and wraps `.ps1`, `.cmd`, and `.bat` shims through quote-safe PowerShell commands. Runtime termination addresses only manager-owned session IDs and stops the owned Windows process tree.

## Restoration and inactive Workspaces

Restoration validates the Project path, Workspace layout, persisted Pane ownership, and provider/shell launch target. The active Pane is prioritized. The configured initial budget is clamped to 1–8; remaining Panes stay visible as deferred and can be resumed individually. Three consecutive failures open a per-Workspace/per-Pane circuit breaker until the user explicitly retries.

Restore behavior can ask, restart assigned agents, or launch fresh native shells without changing saved assignments. Restoration status is stored on the Terminal Session and emitted as progress events.

Inactive Workspace processes follow `keep_running`, `ask`, or `stop`. Inactive xterm canvases are always hibernated; native bounded tails preserve history for re-entry.

## Persistence

SQLite is authoritative. Every connection enables foreign keys. Multi-entity writes use transactions. Forward-only migration 4 normalizes Workspace names, restores strict Session ownership foreign keys, expands Terminal Session metadata, and adds Agent Profiles, Agent Sessions, repair history, and quarantine tables. A pre-migration SQLite backup is created before schema 4. WAL is enabled only after migration and compatibility checks.

Startup repair is idempotent. It normalizes stale live Sessions, invalid active Pane references, and invalid layouts; unrecoverable metadata is quarantined and every action is recorded. Repair never reads, modifies, or deletes source Project contents.

## Errors, diagnostics, and security

Native errors contain a stable code, user message, recoverability, technical detail, affected entity, recommended action, and source layer. Diagnostics expose schema/foreign-key health, paths, live-terminal count, repair results, and migration-backup location without terminal input, environment values, tokens, or output.

The Tauri capability file is restricted to the main window, folder/executable selection, confirmations, log opening, and reveal operations. CSP is explicit and there is no unrestricted command IPC or arbitrary process-termination command.

# 04 — UI Surface Map

Every route, screen, panel, section, tab, dialog and overlay. Derived from `App.tsx`, the screen components, and each feature's nav/section definitions.

---

## 1. Application shell

`components/shell/AppShell.tsx` is the only shell primitive — deliberately minimal:

```
<header class="app-titlebar">    ← title bar slot
<div class="app-workarea">
   {sidebar}                     ← optional sidebar slot
   <section class="app-canvas">  ← main content slot
</div>
<footer class="app-statusbar">   ← optional status bar slot
```

Every full-screen route composes this. There is **no tab bar at application level**, **no dock**, and **no global toolbar** — navigation is entirely sidebar-driven.

---

## 2. Routes (11 + 2 non-routed shells)

Router: `HashRouter` (`App.tsx:147`). Hash routing is required because the app is loaded from `index.html` in a Tauri webview.

| # | Route | Screen | Purpose | Backend dependencies | Status |
|---|---|---|---|---|---|
| 1 | `/` | `ProjectLauncher` | Open/choose a Project; recent list; Settings entry | `list_recent_projects`, `list_projects_overview`, `open_project`, `remove_project_from_recent`, `relocate_project`, `validate_working_directory` | COMPLETE |
| 2 | `/setup/:projectId` | `WorkspaceSetup` | New-workspace wizard | `get_layout_preset`, `detect_agents`, `detect_shells`, `save_workspace`, `suggest_workspace_name` | COMPLETE |
| 3 | `/workspace/:workspaceId/configure` | `WorkspaceSetup` | Reconfigure an existing workspace (same component) | as above + `get_workspace` | COMPLETE |
| 4 | `/workspace/:workspaceId` | `WorkspaceScreen` (1,169 LOC) | **The product's home surface** — sidebar + terminal canvas + tool panel + status bar | ~60 commands | COMPLETE |
| 5 | `/repository/:projectId` | `RepositoryScreen` | Repository Command Center | 21 repository commands | COMPLETE |
| 6 | `/database/:projectId` | `DatabaseScreen` | Database Studio | 23 database commands | COMPLETE |
| 7 | `/memory/:projectId` | `MemoryScreen` | Memory / Context Fabric workspace | 24 memory + 14 intelligence commands | COMPLETE |
| 8 | `/swarms/:projectId` | `SwarmsScreen` | Swarm list for a Project | 34 swarm commands | COMPLETE |
| 9 | `/swarms/:projectId/:swarmId` | `SwarmsScreen` | Swarm detail | as above | COMPLETE |
| 10 | `/usage` | `UsageScreen` | Claude/Codex usage analytics | 7 usage commands | COMPLETE |
| 11 | `/settings` | `SettingsScreen` | 39 application settings | `get_settings`, `save_settings`, `get/set_theme_preference`, update commands | COMPLETE |
| — | `*` | `<Navigate to="/" replace/>` | catch-all | — | COMPLETE |

**Non-routed shells** (rendered instead of the router):

| Shell | Trigger | Purpose |
|---|---|---|
| `RecoveryScreen` | `startup.recoveryMode === true` | Safe-mode / DB restore / retry-update recovery UI. Router never mounts. |
| `DetachedWorkspaceWindow` | window label matches `ws-<id>` | Compact single-workspace shell — no launcher, no global sidebar, no router. |

**Reachability: all 11 routes are reachable.** No orphan routes were found. Entry points:
- `/settings` ← ProjectLauncher button, WorkspaceScreen sidebar, `Ctrl+,`
- `/repository/:id` ← WorkspaceScreen sidebar, DiffSurface "open full Repository", `Ctrl+Shift+G`
- `/database/:id`, `/memory/:id`, `/usage` ← WorkspaceScreen sidebar
- `/swarms/:id` ← WorkspaceScreen sidebar + `CollapsedSidebar.tsx:119`

---

## 3. Workspace screen anatomy (route 4)

```
┌──────────────────────────────────────────────────────────────────┐
│ app-titlebar                                                     │
├──────────┬───────────────────────────────────┬───────────────────┤
│ SIDEBAR  │  WorkspaceCanvas                  │ WorkspaceToolPanel│
│ (or      │  ┌─────────┬─────────┐            │ ┌───────────────┐ │
│ Collapsed│  │ Terminal│ Terminal│            │ │ SurfaceTabBar │ │
│ rail)    │  │ Pane    │ Pane    │            │ ├───────────────┤ │
│          │  ├─────────┴─────────┤            │ │ Files /       │ │
│          │  │ Terminal Pane     │            │ │ Browser /     │ │
│          │  └───────────────────┘            │ │ Diff /        │ │
│          │  + DockingOverlayLayer            │ │ Agents        │ │
│          │  + SplitResizeHandleLayer         │ └───────────────┘ │
├──────────┴───────────────────────────────────┴───────────────────┤
│ app-statusbar — AiUsageStatusBar                                 │
└──────────────────────────────────────────────────────────────────┘
```

The divider between canvas and panel is rAF-throttled and mutates only a CSS variable — the layout tree is never rebuilt, so **terminals never remount on resize**.

---

## 4. Sidebar system (`features/sidebar`)

The most structurally complex UI subsystem: 16 components + a model/selectors/store/preferences layer, all unit-tested.

| Component | Purpose |
|---|---|
| `ForgeSpaceSidebar` | Root composition (name is a legacy artefact of "ForgeSpace") |
| `CollapsedSidebar` | Icon rail when collapsed |
| `SidebarHeader` | Project identity + actions |
| `ProjectPopover` | Project switcher |
| `SidebarFilter` | Text filter across sections |
| `SidebarGroup` / `SidebarSectionHeader` | Collapsible section chrome |
| `WorkspaceListSection` | Workspaces of the active Project |
| `WorkspacesOtherMonitorsSection` | Workspaces placed on other windows/monitors |
| `WorkspaceRow` | One workspace row |
| `WorkspaceRuntimeIndicator` | Live session/agent state per row |
| `WorkspaceContextMenu` | Right-click actions |
| `SwarmsSidebarSection` | Active swarms |
| `SidebarStatusArea` | Bottom status/actions |
| `DiagnosticsDrawer` | Diagnostics panel |
| `SidebarResizeHandle` | Width drag |

**Sidebar preferences** (persisted server-side, broadcast via `sidebar-preferences-changed`): open/closed, width, `groupBy` (`project`/`flat`), `sortMode` (`manual`/`attention`), collapsed group ids.

**Attention routing** (`sidebarAttention.ts`, `sidebarAgentStatus.ts`) computes which Workspace needs the user — this is the **only** cross-cutting notification mechanism in the product.

---

## 5. Workspace tool panel — 4 singleton surfaces

Declared in `code-surface/surfaceRegistry.ts`. All are singletons because their runtimes are singletons (one browser webview per Workspace, one repository store, one editor instance). Terminal is deliberately **not** registered — terminals are first-class canvas panes with their own docking system.

| Surface | Components | Backend |
|---|---|---|
| **Files** | `FileExplorer`, `EditorTabs`, `MonacoEditorPane`, `QuickOpen`, `SurfaceEmptyState` | 11 filesystem commands |
| **Browser** | `BrowserSurface` (573 LOC) + inspect bridge | 9 browser commands |
| **Diff** | `DiffSurface` | `get_repository_diff`, `get_pane_git_review` |
| **Agents** | `AgentsSurface` | terminal session status + `agent-state` event |

---

## 6. Repository Command Center — 10 sections

Route `/repository/:projectId`. Sections from `repositoryTypes.ts:13-23`:

| Section | Component | Backing data |
|---|---|---|
| overview | `OverviewSection` | `inspect_repository` |
| changes | `ChangesSection` + `DiffViewer` | status + diff, stage/unstage/restore ops |
| history | `HistorySection` | `get_repository_history`, `get_repository_commit_detail` |
| intelligence | `IntelligenceSection` | `get_repository_intelligence` |
| branches | `BranchesSection` + `CreateBranchDialog` | `list_repository_branches`, branch ops |
| pull-requests | `PullRequestsSection` + `MergeGate` | remote projection, PR ops, `evaluate_merge_readiness` |
| actions | `ActionsSection` | workflow runs, rerun/cancel |
| issues | `RemoteListSections` | remote projection (read-only) |
| releases | `RemoteListSections` | remote projection + `CreateRelease` |
| security | `RemoteListSections` | Dependabot / code-scanning / secret-scanning / rulesets (read-only) |

**Cross-cutting chrome:** `RepositoryHeader`, `RepositorySidebar`, `RepositoryStatStrip`, `ContextRail`, `OperationLedger`, `StatusBadge`, `ConnectedPlaceholder`, `AgentActionDialog`.

**Saved views** (`repositoryNav.ts`): `needs-attention`, `mine`, `drafts`, `failed-ci`, `awaiting-review`, `agent-worktrees`.

---

## 7. Database Studio — 7 sections

Route `/database/:projectId`. Sections from `databaseTypes.ts:774`:

| Section | Component |
|---|---|
| overview | `OverviewSection` |
| diagram | `DiagramSection` → `SchemaCanvas` + `TableNode` (+ layout web-worker) |
| explorer | `ExplorerSection` (+ `explorerHierarchy.ts`) |
| migrations | `MigrationsSection` |
| changes | `ChangesSection` (design drafts, operations, approve/reject) |
| health | `HealthSection` |
| connections | `ConnectionsSection` |

**Chrome:** `DatabaseSidebar`, `InspectorPanel` (639 LOC), `StatusBadge`, `SectionError`, `LayerUnavailableNotice` (an explicit honest state when a data layer is unavailable — matches the product's "represent unavailability honestly" rule).

---

## 8. Memory workspace — 8 views

Route `/memory/:projectId`, composed by `MemoryWorkspace.tsx`:

| View | Component |
|---|---|
| overview | `MemoryOverview` |
| document | `MemoryList` + `MemoryEditor` |
| graph | `MemoryGraph` |
| timeline | `MemoryTimeline` |
| activity | `MemoryActivity` |
| review | `MemoryReview` (candidate queue + conflicts) |
| search | `MemorySearch` |
| context | `MemoryContext` — **the only consumer of `ContextCompiler`** |

**Inspector:** `MemoryInspector` (474 LOC) — claims, sources, relations, revisions, provenance.

---

## 9. Swarms surfaces

Route `/swarms/:projectId[/:swarmId]`:

| Surface | Component |
|---|---|
| List / overview | `SwarmOverview` |
| Create panel | `SwarmCreatePanel` (389 LOC) + `RolePoolEditor` |
| Detail workspace | `SwarmWorkspace` |
| Row actions | `SwarmRowMenu` |
| Sidebar section | `SwarmsSidebarSection` |

---

## 10. Usage surfaces

Route `/usage`:

`UsagePage` → `UsageSegmented`, `UsageMetricStrip`, `DailyUsageChart`, `UsageBreakdown`, `RawCostSummary`, `UsageInstrument`.
Plus the always-mounted `AiUsageStatusBar` in the workspace status bar, with a popover (`usagePopoverPlacement.ts`).

---

## 11. Global overlays (mounted outside the router)

| Overlay | Component | Trigger |
|---|---|---|
| Orchestrator | `OrchestratorLauncher` (394 LOC) | user opens the launcher |
| Agent Resume Center | `AgentResumeCenter` (292 LOC) | `openAgentResumeCenter()` custom DOM event |
| Update notification | `UpdateNotification` | `update-status` / `update-progress` events |
| "What's new" | inline `<aside>` in `App.tsx:168` | healthy post-update startup |
| Monitor recovery watcher | `MonitorRecoveryWatcher` | polling sweep (headless) |

---

## 12. Dialogs and modals

Only **one modal primitive** exists: `components/ui/Modal.tsx`. Used by:

| Dialog | Location |
|---|---|
| `TextPromptDialog` | generic text input (rename, new file, …) |
| `CreateBranchDialog` | Repository → branches |
| `AgentActionDialog` | Repository → agent-initiated action confirmation |
| Agent Resume Center | overlay |
| Workspace confirmations | `WorkspaceScreen`, `DetachedWorkspaceWindow`, `ProjectLauncher` |

Native dialogs (`@tauri-apps/plugin-dialog`) are used for folder pick and destructive confirmations (`confirm`, `open` in `WorkspaceScreen.tsx:2`).

---

## 13. UI primitives (6)

`components/ui/`: `Brand`, `Button`, `ErrorBoundary`, `ErrorNotice`, `Modal`, `TextPromptDialog`.

This is a **very small primitive set for a 50k-LOC frontend**. Most components style themselves directly against the token layer via `index.css` (3,886 LOC). There is no `Input`, `Select`, `Checkbox`, `Tooltip`, `Tabs`, `Menu`, `Badge`, or `Card` primitive — each feature re-implements those inline. See `12-TECHNICAL-DEBT.md` §UI debt.

---

## 14. Theme and token system

- **5 themes**: `paralith-dark` (default), `graphite`, `obsidian`, `ember`, `arctic-light`.
- **151 CSS custom properties** defined in `theme/tokens.ts`, applied by `applyTheme.ts`.
- **System follow** via `theme/system.ts`; cross-window sync via the `theme-changed` event.
- **Pre-mount paint**: an inline script in `index.html` applies the cached theme before React mounts, so no window ever flashes an unthemed frame.
- **UI scale** (`--ui-scale`) and **density** (`data-density` attribute) are global modifiers.

**Verified quality signals:** 0 hardcoded hex colours in `.tsx`; only 50 `style={{…}}` inline-style sites across 311 files (nearly all dynamic geometry, not colour).

---

## 15. Keyboard shortcuts (complete inventory)

There is **no global shortcut registry and no command palette**. All handlers are surface-local.

| Shortcut | Scope | Action |
|---|---|---|
| `Ctrl+,` | WorkspaceScreen | Open Settings |
| `Ctrl+Shift+G` | WorkspaceScreen | Open Repository Command Center |
| `Ctrl+P` | CodeSurface | Quick Open |
| `Ctrl+Shift+S` | CodeSurface | Save all open editors (`saveAll()`) |
| `Escape` | CodeSurface | Close Quick Open, else exit compare mode |
| `Ctrl+L` | BrowserSurface | Focus address bar |
| `Ctrl+R` | BrowserSurface | Reload |
| `Ctrl+ +` / `Ctrl+ -` / `Ctrl+0` | BrowserSurface | Zoom in/out/reset |
| `Ctrl+S` | MemoryEditor | Save memory |
| `Ctrl`/`Shift`+click | Database canvas | Multi-select table nodes |
| `Ctrl`+wheel | Database canvas | Zoom (plain wheel scrolls the page, per UI-SPEC §3.2) |
| Arrows / Enter / Escape / PageUp / PageDown / F10 | various lists and menus | navigation |

**Consequence:** the Files, Diff, Agents, Swarms, Database, Memory and Usage surfaces have **no keyboard entry point**. Everything is mouse-driven from the sidebar. This is the largest accessibility and power-user gap in the product.

---

## 16. Visual harness (developer surface)

`npm run visual` serves `visual/index.html` — a browser-hosted view of the **real** screens (not mocks) for design inspection and screenshotting.

Supported surfaces: `primitives`, `launcher`, `workspace`, `setup`, `settings`, `repository`, `database`, `memory`, `swarms`.
Query params: `?surface=`, `&theme=`, `&scale=`, `&density=`.

This is a genuinely useful piece of internal tooling and is **not shipped** to users (separate Vite config, `vite.visual.config.ts`).

---

## 17. Empty / loading / error states

| State | Mechanism | Coverage |
|---|---|---|
| Route loading | `<Suspense fallback>` with a 3-dot `.route-loading` indicator | all lazy routes |
| Surface empty | `SurfaceEmptyState` | Files/tool panel |
| Section error | `SectionError` (Database), `ErrorNotice` (general) | partial |
| Unavailable data layer | `LayerUnavailableNotice` | Database Studio only |
| Provider unavailable | typed statuses (`Unsupported`, `Unauthenticated`, `Error`) | Usage |
| Not connected | `ConnectedPlaceholder` | Repository |
| Crash containment | `ErrorBoundary` | **one instance only** — wraps the entire app in `main.tsx:10` |

**Gap:** there is no consistent per-surface loading skeleton, and there is exactly **one** `ErrorBoundary` in the whole frontend (`src/main.tsx`). A thrown render error anywhere in any feature subtree therefore takes down the **entire application UI** rather than degrading one panel. Verified: `grep ErrorBoundary src/**/*.tsx` returns only `main.tsx`.

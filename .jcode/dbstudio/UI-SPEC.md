# Database Studio — UI/UX Implementation Spec (WP3)

Owner: UI/UX Engineer (`claude-sonnet-5`). Status: written against `ARCHITECTURE.md` (WP1 partial,
`CONTRACTS.md` not yet landed). This spec is implementation-ready for the frontend feature shell,
selectors, and canvas engine; command/event names will be finalized to `CONTRACTS.md` once it lands
— this doc defines the shapes I need so the Architect/Builder can adopt or correct them at Gate 1.

Do not read this as permission to implement components yet. Per the mission and PLAN.md, component
implementation waits for GATE 1 approval of `CONTRACTS.md`.

---

## 1. Genome findings (what native-feel requires)

Verified by reading `src/features/repository/**`, `src/features/code-surface/**`,
`src/features/swarms/SwarmOverview.tsx`, `src/theme/tokens.ts`, `src/index.css`, `src/components/ui/**`,
`src/screens/RepositoryScreen.tsx`, `src/features/sidebar/**`.

1. **One feature folder per surface**, flat: `<Name>.tsx` root component + `<name>Store.ts` (Zustand,
   `create<State>()`) + `<name>Selectors.ts` (pure functions only) + `<name>Types.ts` (FE view types,
   defensively mapped from `native/types.ts`) + `<name>Nav.ts` (section/filter defs) +
   `components/*.tsx` for subviews. Every store/selectors file has a colocated `.test.ts`; every
   substantial component has a colocated `.test.tsx`. `repository/` is the template; `code-surface/`
   shows the same shape applied to a tree+editor surface.
2. **No CSS-in-JS, no per-component CSS modules for the common case.** `index.css` is the single
   global stylesheet carrying almost all component rules (2000+ lines, BEM-ish flat class names like
   `.rcc-rail`, `.repo-intel-columns`, `.code-explorer-row`). Only two features (`code-surface`,
   `code-surface/browser`) have their own colocated `.css` file, and only because they are
   lazily-loaded surfaces that must not block the terminal's first paint — `theme/theme.test.ts`
   explicitly enumerates every stylesheet ("genome" tests) and checks token usage, achromatic
   controls, and surface-ladder discipline across all of them.
   **Decision:** Database Studio is reached from inside an already-loaded project shell (like
   Repository), not on cold start, so there is no first-paint constraint forcing a split file. I will
   add rules to `index.css` alongside the `.rcc-*` block, consistent with `repository/`'s own
   approach, **not** a new lazy stylesheet — unless the canvas layer specifically needs one file kept
   separate for size/readability, in which case it follows the `code-surface` split-file pattern
   (`databaseCanvas.css`, added to the genome stylesheet list in `theme.test.ts` by whoever touches
   that test — I will flag this to the Reviewer, not edit that test myself, since `theme.test.ts` is
   outside my WP3 file ownership).
3. **Class names, not inline styles**, except for computed geometry (`style={{ left, top, width,
   transform }}` for positioned rows/nodes — see `DiffViewer`'s `repo-diff-window` translateY and
   `SwarmOverview`'s `AgentCanvas` node positions). Canvas node/edge positioning follows this exact
   precedent.
4. **Sections are a discriminated `SectionId` union** rendered by one router-less `if` chain in the
   root command-center component (`RepositoryCommandCenter.tsx`), not `react-router` sub-routes. Nav
   state (`{ section, filters }`) is local `useState`, persisted to `localStorage` keyed by
   `<prefix>:nav:<projectId>` and restored on mount. I will follow this exactly:
   `db:nav:<projectId>` / `db:canvasViewport:<projectId>:<designRevisionId>`.
5. **Resizable side rail** via `onPointerDown`/`pointermove`/`pointerup` on a `role="separator"` div
   with `tabIndex={0}` and arrow-key resize (`ContextRail` resize handle in
   `RepositoryCommandCenter.tsx`), width clamped and persisted to `localStorage`. I reuse this exact
   pattern for the Inspector rail.
6. **Empty/loading/error discipline**: every store exposes a `RepositoryLoadState`-shaped
   `{ status: 'idle'|'loading'|'ready'|'error', errorCode?, errorMessage? }`, and `undefined` vs
   `null` are used deliberately to distinguish "not fetched yet" from "confirmed nothing exists"
   (`IntelligenceSection`'s `intelligence === undefined` vs `=== null`). Database Studio needs this
   distinction constantly: "design not loaded yet" vs "no design exists for this project".
7. **Native icons**: `lucide-react`, 12–16px, sized explicitly per call site (`size={14}` etc.), never
   a generic icon-font. No decorative icon library additions.
8. **Buttons/badges**: `<Button variant="primary|secondary|ghost|danger">` from
   `components/ui/Button.tsx`, `<StatusBadge tone="neutral|accent|success|warning|danger|pending">`
   pattern copied per-feature today (`repository/components/StatusBadge.tsx`) rather than shared —
   I will add a colocated `database/components/StatusBadge.tsx` rather than import the repository
   one, matching the existing (deliberate, per the "no cross-feature reach-in" boundary) duplication.
9. **Virtualization precedent**: `DiffViewer.tsx`'s `VirtualRows` — manual windowed rendering keyed
   by `scrollTop`/`ResizeObserver`-measured height, fixed `ROW_HEIGHT`, `translateY` on a single
   transformed inner div, `OVERSCAN` rows either side. This is the model for both the Explorer table
   list and the canvas's virtualized node set.
10. **Positioned-node canvas precedent**: `SwarmOverview.tsx`'s `AgentCanvas` — absolutely positioned
    `<button>` nodes inside a `section.swarm-canvas`, one `<svg class="swarm-connections"
    viewBox="0 0 1000 600" preserveAspectRatio="none">` edge overlay drawn from a `Map<id, {x,y}>`
    position table computed by a pure `layoutAgents()` function outside the render body. No canvas
    library is used anywhere in this codebase today.
11. **Theme tokens are the only source of color/size** (`theme/theme.test.ts` enforces this
    structurally: every `var(--x)` used must be defined somewhere, and a component stylesheet may
    never repaint `.button-primary` with `--accent`, may never mix a surface toward `#000`). I will
    consume: surfaces `--surface`/`--surface-2`/`--surface-3`/`--surface-hover`/`--bg-selected`;
    text `--text`/`--text-strong`/`--muted`/`--faint`; borders `--border`/`--border-subtle`/
    `--border-strong`; the one accent `--accent`/`--accent-edge`/`--accent-soft` for the state-edge
    and selection marks only (never a filled control); `--git-*` and `--risk-*`/`--status-*` for
    diff and issue severity; `--role-*` is reserved for Swarm identity and **not** reused for
    database domain-grouping colors (domain grouping gets its own small palette or, more likely,
    stays achromatic with border/label grouping — see §3.7).
12. **`data-density` and `--ui-scale` are global** (`html[data-density]`, user-controlled). I do not
    invent a separate density system for Database Studio; the canvas's own zoom is a *different* axis
    (visual scale of the diagram) from chrome density and both apply simultaneously.

---

## 2. Design tokens, metrics, and densities (quoted, not approximated)

From `src/index.css` `:root` (standard density, `--ui-scale: 1`):

| Token | Value | Use in Database Studio |
| --- | --- | --- |
| `--text-2xs` | `11px` | Section labels (`.section-label` pattern), column type badges |
| `--text-xs` | `12px` | Row secondary text, inspector field labels, badge text |
| `--text-sm` | `13px` | List rows, table/column names in Explorer, sidebar tree rows |
| `--text-md` | `14px` | Body default, canvas near-LOD column text, section headers |
| `--text-lg` | `16px` | Inspector panel title, dialog headings |
| `--text-xl` | `18px` | (rare) empty-state heading |
| `--space-1..5` | `4/8/12/16/24px` | Row/section padding ladder |
| `--icon-xs/sm/md/lg` | `12/14/16/18px` | All lucide-react icons resolve to one of these four |
| `--row-h-dense` | `30px` | Explorer table/column rows (matches `FileExplorer`'s tree-row density) |
| `--row-h` | `34px` | Sidebar source/schema rows, inspector list rows |
| `--row-h-two-line` | `52px` | Health/issue rows (title + evidence line), Changes list rows |
| `--pane-header-height` | `36px` | Sub-nav bar, inspector section headers, canvas toolbar |
| `--control-h` | `36px` | Buttons, search input, filter selects |
| `--control-h-sm` | `32px` | Compact inline actions (zoom controls, LOD toggle) |
| `--icon-btn` | `32px` | Icon-only buttons (collapse rail, fit-to-view, pin) |
| `--radius` / `--radius-sm` | `8px` / `6px` | Cards, table nodes, chips |
| `--radius-lg` | `10px` | Popovers (relationship context menu) |
| `--shadow-sm/md/lg` | as defined | Table-node hover lift is **not** used (flat, IDE-like); reserved for popovers/menus only |

**Density target: dense professional dark IDE.** Explorer rows render at `--row-h-dense` (30px),
sidebar source/schema rows at `--row-h` (34px), inspector body text at `--text-sm` (13px), row/column
type badges at `--text-2xs` (11px) uppercase with `--tracking-label` (`.05em`), matching
`.section-label`. No row exceeds two lines. This mirrors `FileExplorer`'s and `RepositorySidebar`'s
existing density exactly — Database Studio must not read as "heavier" than Repository or Explorer.

**Canvas table-card metrics** (near LOD, full detail):
- Header row: `--row-h` (34px), table name at `--text-sm` (13px) weight 600, row-count/domain badge
  right-aligned at `--text-2xs`.
- Column rows: `--row-h-dense` (30px) each, name `--text-sm`, type `--text-xs` in `--faint`, PK/FK/
  unique markers as 12px icons (`--icon-xs`) not text badges (icon-only keeps rows from wrapping on
  long type names).
- Card border: `1px solid var(--border)`, `var(--radius)` (8px). Selected: `var(--border-strong)`
  plus the one accent **edge** (`--accent-edge`, 2px), not a filled accent background — this is the
  same "state edge" rule `index.css`'s header comment states is used everywhere else in the app.
- No card shadow at rest (flat IDE surface). No glow, no gradient border, no glass blur anywhere.

---

## 3. Canvas technical plan

### 3.1 Rendering approach: **DOM + CSS transform + single SVG edge overlay. No canvas-library dependency.**

**Decision: do not add `react-flow` or any graph-rendering package. Justification below.**

**Why not react-flow (explicit yes/no: NO):**
1. **AGENTS.md quality bar is explicit**: "Prefer the smallest coherent solution. Do not introduce a
   framework, dependency, abstraction... without demonstrated need." No existing surface in this
   codebase renders a node/edge graph via a library — `SwarmOverview.tsx`'s `AgentCanvas` already
   proves the hand-rolled DOM+SVG approach is this codebase's established pattern for exactly this
   shape of problem (positioned nodes + relationship lines), at smaller scale but the same technique.
2. **react-flow's default rendering model is "mount every node as DOM," which is the opposite of
   what B13 requires.** Its built-in virtualization (`onlyRenderVisibleElements`) culls by viewport
   but has no concept of *semantic* LOD (far/medium/near tiers collapsing a table into a domain dot) —
   we would still have to hand-write the LOD/aggregation layer on top of it, at which point react-flow
   contributes pan/zoom math and a drag/connection interaction model we do not need (Design mode edits
   go through typed operations, not free-form node dragging that mutates a live graph — see §5).
3. **Selection-by-semantic-id is a hard mission requirement** ("selections communicated through
   semantic IDs, never screen coordinates" — `database-studio-mission.md` CANVAS AWARENESS). react-flow's
   node/edge model is coordinate- and library-id-centric; forcing our semantic ids through its internal
   id/position state duplicates the mapping layer we would build anyway and creates a second place
   selection can drift from canonical.
4. **Bundle/test cost**: `package.json` currently has zero graph-rendering dependencies; the frontend
   test suite runs under `jsdom` (`vitest.config.ts`), and `ResizeObserver` is already the only DOM
   API polyfilled in `src/test/setup.ts`. A drag-and-zoom library adds nontrivial jsdom-compatibility
   surface (pointer capture, wheel-based zoom, internal `ResizeObserver` usage) that this codebase's
   test setup does not currently need to support anywhere else.
5. **What we would gain from react-flow** (pan/zoom inertia, minimap, edge routing curves) is not in
   the V1 priority list (Diagram/Explorer/Design/Changes/Health) and can be added later behind the
   same node-position/edge-list contract if it is ever justified — the hand-rolled engine below does
   not foreclose that option because positions/edges stay data, not library state.

**What we build instead — `SchemaCanvas` engine (`src/features/database/components/canvas/`):**

- **Viewport container**: one `div.db-canvas-viewport` with `overflow: hidden`, `role="application"`,
  holding one `div.db-canvas-world` transformed via
  `style={{ transform: 'translate(Xpx, Ypx) scale(Z)' }}`. Pan = pointer-drag on empty canvas updates
  `X/Y`; zoom = wheel (ctrl/trackpad-pinch) or `+`/`-`/fit-to-view button updates `Z` around the
  cursor/viewport-center anchor. This mirrors `RepositoryCommandCenter`'s own `startResize`
  pointer-drag pattern (pointerdown → window pointermove/pointerup listeners, cleanup on unmount).
- **Nodes are virtualized, not all mounted.** `computeVisibleNodeIds(positions, viewportWorldRect,
  lod, overscanPx)` (pure function, `canvasSelectors.ts`) intersects each node's world-space bounding
  box against the current viewport rect (converted from screen to world coordinates via `Z`/`X`/`Y`)
  plus a fixed overscan margin, exactly like `DiffViewer`'s `VirtualRows` start/end windowing but in
  2D. Only intersecting node ids are mapped to mounted `<TableNode>` components. This is the primary
  mechanism that keeps mounted DOM count bounded independent of total schema size — panning a 400-table
  diagram never mounts more than what's on screen (+ overscan).
- **Edges** render as `<line>`/`<path>` elements inside **one** `<svg class="db-canvas-edges">`
  overlay sized to the world bounds (same technique as `AgentCanvas`'s `swarm-connections` svg), not
  one SVG per edge. Only edges whose *either* endpoint is in the visible node set (or is a "relationship
  highlight" edge from an explicitly selected node — see §3.4) are drawn; this bounds SVG child count
  the same way node virtualization bounds DOM node count.
- **Semantic Level of Detail (LOD)**, keyed off `Z` (world scale), three tiers exactly matching the
  mission's "far / medium / near":
  - **LOD0 (far, `Z < 0.35`)**: render **domain/namespace aggregate nodes**, not table cards — one
    small rect per `DatabaseNamespace`/domain group showing name + table count + issue-count badge.
    Individual tables are not mounted at all at this tier, however many exist inside the group. This
    is the mechanism that keeps a 400-table schema's *rendered node count* independent of table count
    at the zoomed-out view — the view a user opens Diagram to first.
  - **LOD1 (medium, `0.35 ≤ Z < 0.85`)**: table cards render name + primary/foreign key columns only
    (columns flagged `isPrimaryKey || isForeignKey` in the contract type), collapsed row for "N more
    columns."
  - **LOD2 (near, `Z ≥ 0.85`)**: full column list, all constraint/index glyphs.
  - `computeLod(zoom: number): 'far' | 'medium' | 'near'` is a pure, independently unit-tested
    function. `TableNode` (or `DomainAggregateNode` at LOD0) is chosen by the parent based on this
    value — LOD is a rendering decision made once per frame from `Z`, not per-node state.
- **Layout runs off the render path**, in a Web Native Worker (`layoutWorker.ts`, loaded via Vite's
  `new Worker(new URL('./layoutWorker.ts', import.meta.url), { type: 'module' })` — a browser-native
  API, not a new dependency). The worker receives `{ nodes: {id, w, h, group}[], edges: {from,to}[],
  pinned: Record<id, {x,y}> }` and returns `{ positions: Record<id,{x,y}>, bounds }` plus a
  `computeMs` timing figure. `layoutClient.ts` wraps this with a promise API and a same-thread
  synchronous fallback (used only in non-Worker test environments) so the algorithm itself
  (`layoutCore.ts`, pure, framework-free) is unit-testable without a real Worker. **Layout never runs
  inside a React render or effect body synchronously** — `DiagramSection` triggers
  `databaseCanvasStore.recomputeLayout()` only on `(designRevisionId, layoutPrefsHash)` change via an
  effect that fires the async worker call and applies positions when it resolves; the component tree
  reads only the already-computed `positions` from the store, never calls layout math itself. This is
  the structural property the B13 test asserts (§9).
- **Pinned / persisted positions**: any node with an explicit user-set position (`pinned: true`) is
  excluded from automatic layout for that revision and always uses its stored `(x, y)`. Layout for a
  new revision only recomputes positions for *newly-appeared* objects (diffed against the previous
  revision's persisted layout) rather than re-running full-graph layout and discarding user
  arrangement — this satisfies "do not completely rearrange user-customized layouts whenever a schema
  changes."

### 3.2 Pan / zoom / fit
Standard: drag-to-pan on empty canvas background, wheel-to-zoom (ctrl+wheel or trackpad pinch matches
platform convention; plain wheel scrolls if the canvas is inside a scroll container — plain wheel pans
vertically to match most diagram tools, this is a decision for polish, not architecture), `+`/`-`
buttons and keyboard `Ctrl+=`/`Ctrl+-`, and a **Fit** button that computes the bounding box of either
(a) the whole visible graph or (b) the current selection, and animates `X/Y/Z` to frame it with a fixed
padding. Fit-to-selection is how "N-hop focus" (§3.4) becomes visually useful.

### 3.3 Multi-select
Shift/Ctrl-click toggles a node into the selection set; drag-rectangle (pointerdown+move on empty
canvas with a modifier, or a dedicated "select" cursor mode) computes intersection against node world
rects — pure function, same shape as `computeVisibleNodeIds`. Selection is a `Set<TableId>` in the
canvas store (ephemeral session state — see §7), never derived from DOM.

### 3.4 Relationship highlighting, N-hop focus, hide-unrelated
All three are **pure graph-traversal selectors over the already-loaded edge list**, not additional
backend calls for V1 (the loaded snapshot/revision already contains the full edge set; traversal is
in-memory graph BFS bounded by hop count):
- `highlightedEdges(selection, edges)`: any edge touching a selected node.
- `nHopNodes(selection, edges, hops)`: BFS from the selection set out to `hops` steps (a canvas
  toolbar stepper, default 1).
- `hideUnrelated: boolean` (canvas store flag): when true, `computeVisibleNodeIds` intersects its
  viewport-culled result with `nHopNodes(selection, edges, hops)` instead of all loaded nodes — this
  is also a second, independent mechanism (beyond LOD0 aggregation) for bounding rendered node count
  on a large schema when a user is doing focused work.

### 3.5 Namespace / domain / project / database grouping
Nodes carry a `groupId` (namespace or declared "domain" tag) resolved from the backend graph, not
inferred client-side. Grouping renders as:
- LOD0: one aggregate node per group (§3.1).
- LOD1/LOD2: a subtle group background band (`--surface-2` fill, `--border-subtle` outline, group
  label at `--text-2xs`/`--faint` top-left) behind member nodes — never a colored fill per group (no
  role-hue reuse, no rainbow grouping; consistent with "chroma is spent only on meaning").
- Multi-database/multi-project schemas (monorepo case) group at one level above namespace: a
  `DatabaseSource` swimlane. The mission's monorepo example (`packages/db` owns Primary PostgreSQL,
  `apps/api`/`apps/worker` use it) renders as **one** `DatabaseSource` swimlane with an "owner: X ·
  consumers: Y, Z" strip in its header — never three copies of the same tables.

### 3.6 Pinned positions / persistent layout
Drag-move on a node sets `pinned: true` and writes `{x,y}` locally immediately (optimistic), then
debounced (400ms, matching the file-watcher's own 150ms-class debounce discipline in
`file_watch_service.rs` but scoped to user input frequency) persists via a `database.set_layout`-shaped
command (name pending `CONTRACTS.md`) keyed by `(projectId, designRevisionId, tableId)`. Persisted
layout is backend-owned (`database_layouts` table per the mission's PERSISTENCE section) — the frontend
never treats an unsent pinned position as final; a failed persist reverts the pin flag and shows a
transient inline error, it does not roll back the drag itself (the node stays where the user put it
visually, matching optimistic-UI conventions used in `repositoryStore.runOperation`).

### 3.7 Semantic zoom LOD tiers — summary
| Tier | Zoom range | Renders | Rendered unit |
| --- | --- | --- | --- |
| Far (LOD0) | `Z < 0.35` | Namespace/domain names, table+issue counts | 1 aggregate node per group |
| Medium (LOD1) | `0.35–0.85` | Table name + PK/FK columns only | 1 card per visible table |
| Near (LOD2) | `Z ≥ 0.85` | Full columns, constraints, indexes | 1 full card per visible table |

### 3.8 Bounding rendered node count — the three independent mechanisms (why B13 can pass honestly)
1. **Viewport culling** (always on): only nodes whose world rect intersects the visible viewport
   (+overscan) are mounted, regardless of LOD.
2. **LOD0 aggregation** (far zoom, e.g. fit-to-view on 400 tables): mounted unit count equals group
   count (typically single/low double digits), not table count, even though every table is "on
   screen" in world space.
3. **Hide-unrelated + N-hop** (user-triggered, any zoom): mounted node count equals the N-hop
   neighborhood of the current selection, which is bounded independent of total schema size for a
   normalized schema (most tables have a small, bounded number of direct relationships).

---

## 4. Inspector sections

Right rail (`InspectorPanel.tsx`), resizable 248–560px (same clamp/default as `ContextRail`'s
248/560/328 in `RepositoryCommandCenter.tsx`), one object selected at a time (last-selected wins on
multi-select; multi-select shows a compact "N objects selected" summary card with only bulk-applicable
actions instead of the full tab set).

| Section | Shows | Empty state |
| --- | --- | --- |
| **Definition** | Object kind, qualified name (`namespace.table`), source (Declared file path + line, or Observed connection), adapter, confidence badge if inferred, annotation/notes field | "No definition recorded" only possible for a dangling reference (e.g. FK to a table that failed to resolve) — shown with a warning tone, not a blank panel |
| **Columns** | Dense list: name, type, nullable, default, PK/FK/unique glyphs, per-row provenance icon (Declared vs Observed vs Proposed) | "No columns declared" for an empty/placeholder table in a Proposed design |
| **Relations** | Outgoing/incoming FKs as directed rows (`→ orders.user_id` / `← sessions.user_id`), each row selectable to jump-select the related table on canvas | "No relationships. Add one from Design mode." with a CTA only when the active layer is Proposed |
| **Constraints** | Unique, check, PK constraints with their defining columns and (for check) the raw expression | "No constraints beyond the primary key" |
| **Indexes** | Name, columns, unique/partial flags, and (V1, best-effort) a "declared, not verified against Observed" badge when only Declared evidence exists | "No indexes declared" |
| **Usage** | `READ_BY`/`WRITTEN_BY`/`DEFINED_BY` code references with confidence + file:line, grouped by kind | "No usage evidence yet. Usage tracking is best-effort and file-scoped." — never implies exhaustive analysis (mission: "Do not pretend V1 is perfect whole-program static analysis") |
| **History** | Migrations that created/altered this object (from Declared migration evidence), chronological | "No migration history found for this object" |
| **Source** | Read-only excerpt of the Declared source (schema.prisma block / SQL DDL / Drizzle definition) with file path + open-in-editor action (reuses the existing FileExplorer/editor open flow, not a second editor) | "No static source — this object exists only in Observed/Proposed" |
| **Health** | Deterministic issues scoped to this object (severity, rule id, reason, evidence), each row links to the full Health section filtered to this object | "No issues detected for this object" (success tone, not neutral — this is a genuinely good state) |

Tabs are always visible (not hidden when empty) so structure stays predictable; each renders its own
scoped empty state rather than hiding the tab, matching `IntelligenceSection`'s per-section (not
per-tab, but same principle) empty-state discipline.

---

## 5. Design mode UX

**Every human edit is a typed `DatabaseDesignOperation`, never a direct mutation.** Concretely:

1. A design-mode edit action (rename table, add column, draw a new FK by dragging from one column's
   connection handle to another table, etc.) builds one `DesignOperation` value client-side and calls
   a single `database.apply_operation`-shaped store action (name pending `CONTRACTS.md`) with
   `{ designId, expectedHeadRevisionId, expectedRevisionNumber, operation }` — the optimistic-
   concurrency token pattern `ARCHITECTURE.md` §4 specifies. The UI never assembles or sends a raw
   object graph.
2. **Optimistic apply, authoritative confirm**: the operation renders immediately (object appears
   changed) tagged `pending: true` (dim/hatch treatment, not a full spinner overlay — this must not
   block continued editing), then reconciles against the backend's returned new revision. A
   `DATABASE_DESIGN_STALE_REVISION` error (per `ARCHITECTURE.md` §4.5) rolls the optimistic change
   back, shows an inline conflict notice ("this design changed elsewhere"), and offers **Reload
   design** — it never silently rebases or drops the user's edit without telling them.
3. **Draft switching**: a draft selector in the Changes section header (`Base Schema ▸ Claude
   Registration Design ▸ v3`), listing all drafts for the active design lineage. Switching drafts
   swaps the active `designId`/`headRevisionId` the canvas renders against; canvas viewport
   (pan/zoom) is preserved across the switch, selection is cleared (a selected table may not exist in
   the other draft).
4. **Comparison visualization**: selecting "Compare" against a second design/revision computes a
   semantic diff (backend-computed, `database.compare_designs`-shaped) and renders three overlay
   states directly on the canvas nodes/edges of the *base* being viewed: `added` (green outline,
   `--git-added`), `removed` (red outline + reduced opacity, `--git-deleted`), `modified` (amber
   outline, `--git-modified`) — reusing the existing Git decoration tokens rather than inventing a
   parallel color language, since the semantics (added/removed/modified) are identical. A compact
   diff summary list sits in the Changes section body (grouped by object, same list shape as
   `IntelligenceSection`'s `ImpactList`), each row jump-selecting the object on canvas.
5. **Changed-object overlays** persist as long as a comparison is active; toggling comparison off
   returns the canvas to normal Declared/Proposed rendering with no residual state.

---

## 6. Selection model

Every selection is a **semantic id array**, never coordinates or DOM refs. Proposed shape (subject to
`CONTRACTS.md` alignment — I own the frontend-side type, Architect/Builder own whether this exact
shape is what `database.get_selection`/`get_canvas_state` return):

```ts
// src/features/database/databaseTypes.ts
export interface DatabaseSelection {
  /** Fully-qualified semantic ids, e.g. "source:primary-pg/schema:public/table:users" */
  tableIds: string[]
  columnIds: string[]        // "<tableId>/column:<name>"
  relationshipIds: string[]  // "<fkId>" — the FK's own stable identity, not a synthesized pair
  /** The single most-recently-selected object, drives the Inspector's single-object tabs. */
  focusedId?: string
}

export interface DatabaseCanvasState {
  projectId: string
  activeDatabaseSourceId?: string
  activeSchemaId?: string
  activeDesignId?: string
  activeRevisionId?: string
  selection: DatabaseSelection
  /** World-space viewport, UI-only (see §7) but exposed read-only for agent awareness. */
  viewport: { x: number; y: number; zoom: number; lod: 'far' | 'medium' | 'near' }
  visibleTableIds: string[]   // what viewport culling currently renders — for "what is the user looking at"
  filters: { search?: string; hideUnrelated: boolean; nHop?: number; groupBy?: 'namespace' | 'domain' | 'source' }
}
```

The store exposes a single selector, `selectCanvasState(): DatabaseCanvasState`, that the (Builder-owned)
agent-protocol bridge reads to answer `database.get_canvas_state` / `database.get_selection`. I do not
implement the Tauri command side; I guarantee this selector exists, is pure, and is stable so the
Builder can wire it without a UI-side round-trip per agent call. Clicking canvas nodes, Explorer rows,
or Inspector "jump-select" links all funnel through one `selectObjects(ids, options)` store action —
there is exactly one way selection changes, never a component-local selection state.

---

## 7. State ownership statement

**Backend is authoritative** for: database graph objects/edges, Declared/Observed/Proposed snapshots,
design revisions and operations, semantic diffs, health issues, connection profile metadata, and
persisted layout positions (`database_layouts`). The Zustand store (`databaseStore.ts`,
`databaseCanvasStore.ts`) is a **projection and cache**: it holds the last-fetched/event-pushed copy of
these, with `RepositoryLoadState`-shaped load status per resource, and never invents or locally derives
a fact that should have come from the backend (e.g., it does not client-side-recompute a semantic diff
that the backend is supposed to compute — it renders the backend's diff result).

**Allowed to live only in UI state** (never round-tripped to backend as truth, safe to lose on reload):
- Canvas viewport `(x, y, zoom)` — persisted to `localStorage` per `(projectId, designRevisionId)` for
  session continuity (same pattern as `rcc:contextWidth`), **not** sent to the backend as a
  `database_layouts` row. Only *node positions the user explicitly pins* are backend-persisted layout;
  camera position is not schema layout.
- Collapsed/expanded state of sidebar tree nodes, Inspector rail collapsed/width, sub-nav tab.
- In-flight optimistic design-operation state before the backend confirms (§5.2) — the *authoritative*
  copy is the confirmed revision; the optimistic overlay is discardable UI state.
- Search/filter text, `hideUnrelated`/`nHop` toggle, LOD override (if we ever add a manual LOD pin —
  V1 does not, LOD is purely zoom-derived).
- Multi-select set and `focusedId` **during** an interaction — but per §6, the *reported* selection
  (what agents read) is still sourced from this same store, it is simply not backend-persisted between
  sessions; a fresh Database Studio open starts with empty selection, not a restored one (unlike
  viewport, which restores — selection restoring across a reload would be surprising, viewport not
  restoring would be annoying; this asymmetry is deliberate).
- A node's `pinned: true` flag is optimistic UI state until the persist round-trip confirms; the
  *position value* itself, once confirmed, is backend truth.

---

## 8. Empty / loading / error / permission-denied / unsupported-adapter states

Every surface below follows the `RepositoryLoadState` `idle → loading → ready → error` shape, plus a
`null` "confirmed nothing" state where applicable (mirroring `intelligence: T | null | undefined`).

| Surface | Loading | Empty | Error | Permission-denied | Unsupported adapter |
| --- | --- | --- | --- | --- | --- |
| **Overview** | Skeleton stat strip (reuse `.loading-line`/`.loading-block` shimmer classes already in `index.css`) | "No database sources discovered in this project yet." + link to Connections | `ErrorNotice` + Retry | N/A (static discovery only) | N/A |
| **Diagram** | Centered `Loader2` + "Loading schema graph…" | "This source has no tables yet." (design mode: "+ Add first table" CTA) | `ErrorNotice` + Retry, canvas stays mounted-empty (not full-screen replaced, so viewport/selection state isn't lost on a transient failure) | N/A (Diagram never needs live-DB permission — Declared/Proposed only) | N/A |
| **Explorer** | Row skeletons (reuse `.code-explorer-skeleton` shimmer pattern from `FileExplorer`) | "No tables match your filter." vs "No tables in this schema." (distinct copy — filter-empty is not schema-empty) | `ErrorNotice` inline, per-node (matches `FileExplorer`'s per-directory error) | N/A | N/A |
| **Migrations** | Row skeletons | "No migrations detected for this adapter." | `ErrorNotice` + Retry | N/A | "Migration history is not tracked for this adapter yet." (neutral tone, not an error — this is honest V1 scope, not a failure) |
| **Changes** | Spinner in draft selector | "No design drafts yet." + "Create draft" CTA | Inline per-operation error (§5.2 stale-revision flow is its own named state, not generic) | N/A | N/A |
| **Health** | Row skeletons | Success-tone "No issues detected." (not neutral — real good news) | `ErrorNotice` + Retry | N/A | N/A |
| **Connections** | Row skeletons | "No connection profiles configured." + "Add connection" CTA | `ErrorNotice` + Retry | **Explicit permission-denied state**: "This connection requires read-only credentials Paralith does not have. Nothing was connected automatically." — this is a *safety* message, not a generic error, and must never look like a transient failure the user should just retry | "Introspection for this database engine is not yet supported. Declared-schema analysis still works." |
| **Inspector (any tab)** | Skeleton lines matching the tab's row shape | Per-tab copy, §4 table | `ErrorNotice` scoped to the tab, other tabs stay usable | N/A | N/A |

General rules carried from the genome: never collapse "not fetched" and "confirmed empty" into one
state; never replace a whole mounted surface with a full-screen error if a partial/cached view can stay
useful (`ContextRail`'s and `DiffViewer`'s inline-error-within-mounted-surface pattern); connection/
permission states get their own copy because a security boundary must never read as an ordinary glitch.

---

## 9. Test plan (B6 general coverage + B13 specifically)

### 9.1 Unit — selectors and pure logic (`*.test.ts`, no DOM)
- `canvasSelectors.test.ts`: `computeLod(zoom)` boundary values (`0.349/0.35/0.849/0.85`);
  `computeVisibleNodeIds` returns exactly the intersecting set for hand-built rects, respects
  overscan, and — at LOD0 — returns group-aggregate ids instead of table ids even when table rects
  individually intersect the viewport; `nHopNodes` BFS correctness at hop 0/1/2 on a small fixture
  graph; `hideUnrelated` intersection behavior.
- `databaseSelectors.test.ts`: `selectCanvasState()` shape stability; Declared/Observed/Proposed
  layer merge never silently overwrites (constructs one object present in two layers with different
  field values, asserts both are retrievable, not collapsed).
- `layoutCore.test.ts`: deterministic output for a fixed input (same nodes/edges/seed → same
  positions, required for the pinned-position "only recompute new objects" rule); no NaN/overlap
  invariant on a small fixture.
- `databaseNav.test.ts`: mirrors `repositoryNav.test.ts` — filter → section/target mapping.

### 9.2 Component (`*.test.tsx`, RTL + jsdom)
- `DatabaseStudio.test.tsx` (or per-section): renders each of the 8 empty/loading/error states in §8
  from a mocked store, asserts the distinguishing copy/tone is present (not just "something rendered").
- `InspectorPanel.test.tsx`: switching selected object updates all 9 tabs' content; multi-select
  collapses to the summary card; each tab's own empty state renders when the field is empty.
- `SchemaCanvas.test.tsx`: selecting a node highlights its edges and (with `hideUnrelated` on) hides
  non-neighboring nodes; drag-pin sets `pinned` optimistically then reconciles on mock resolve/reject
  (stale-revision path shows the reload prompt).
- `DatabaseSidebar.test.tsx` / `ExplorerSection.test.tsx`: search/filter narrows the tree; keyboard
  roving matches `FileExplorer`'s arrow-key convention.

### 9.3 B13 — large-schema performance (`src/features/database/components/canvas/largeSchema.bench.test.ts`)
Path contains `largeSchema` per `.jcode/dbstudio/TEST-NAMING.md`, selected by `npm run test --
largeSchema`. Designed so it fails if someone renders all 400 full table cards:

1. **Fixture**: a deterministic generator builds 400 `DatabaseTableNodeView` objects across ~12
   namespace groups (~33 tables/group) with a realistic FK edge count (~1.5 edges/table, mostly
   intra-group + a few cross-group), plus a fixed 1440×900 viewport.
2. **Layout timing budget**: call the actual `layoutCore.computeLayout(nodes, edges, prefs)` function
   (not a stub) with `performance.now()` around it, assert `computeMs < 400` (400 tables is the
   mission's stated large-schema benchmark size; 400ms is a generous budget for a synchronous
   correctness check — the point of the assertion is a regression guard against an accidentally-
   quadratic-or-worse algorithm, not a tight perf SLA). Separately assert `layoutClient.computeLayout`
   is the only entry point `DiagramSection`'s effect calls (a `vi.mock` on `layoutClient` + rendering
   `DiagramSection` asserts it is called from the revision-change effect, and a structural check
   greps `SchemaCanvas.tsx`/`TableNode.tsx` source for the *absence* of a direct `layoutCore` import —
   this is what proves layout cannot run inside the render body, i.e. "off the render path").
3. **Bounded rendered node count at fit-to-view (LOD0, the worst case for a naive implementation)**:
   compute the fit-to-view viewport for the full 400-table layout (bounding box → zoom that shows
   everything, which is necessarily `< 0.35` for 400 tables at real card sizes — assert this
   precondition explicitly so the test is honest about which LOD tier it's exercising), call
   `computeVisibleNodeIds(positions, viewportRect, 'far', OVERSCAN)`, and assert:
   - the returned id count equals the **namespace group count** (~12), not the table count (400) —
     `expect(visible.length).toBeLessThan(30)` and, more pointedly,
     `expect(visible.length).toBeLessThan(nodes.length)` by a wide margin, so any change that starts
     returning per-table ids at LOD0 fails immediately.
   - every returned id resolves (via the same lookup `TableNode`'s parent uses) to a
     `kind: 'domain-aggregate'` render descriptor, not `kind: 'table-card'` — this directly catches
     "someone rendered all 400 full table cards" even if the *count* assertion were somehow satisfied
     by coincidence.
4. **Bounded rendered node count at a realistic near-zoom pan** (medium/near LOD, panned to one
   region): construct a viewport rect covering roughly 5% of the world bounds at `Z = 1`, call
   `computeVisibleNodeIds(..., 'near', OVERSCAN)`, assert the returned count is small
   (`< 40`, generous for a dense region) and strictly less than total table count — this is the
   "user has zoomed in to work on a corner of a 400-table schema" case, and it must not mount the
   other 390+ tables just because they exist in the loaded graph.
5. **Regression trip-wire**: one explicit negative test — call `computeVisibleNodeIds` with a
   deliberately-broken "cull nothing" implementation inline (a local function, not touching production
   code) and assert *that* would fail the count assertions in (3)/(4), documenting in a comment that
   this is what proves the real assertions are load-bearing and not vacuously true for any input.

This file, plus `canvasSelectors.test.ts`/`layoutCore.test.ts`, together are what `npm run test --
largeSchema` must select and pass for B13.

### 9.4 Regression
`npm run typecheck`, `npm run lint` (oxlint `--deny-warnings`), `npm run test` full suite stay green
including every existing suite — no existing test edited to accommodate Database Studio changes,
per PLAN.md constraint #10 and the mission's anti-cheat rule.

---

## 10. Open items for `CONTRACTS.md` (Gate 1)

1. Exact Tauri command names/payloads for: `list_sources`, `get_schema`, `get_table`, `search`,
   `get_relationships`, `get_active_design`, `get_design_revision`, `apply_operation`,
   `compare_designs`, `set_layout`, `get_canvas_state`/`get_selection` bridging. I have assumed
   `database.<verb>`-shaped names matching the mission's tool list; I need the real command/event
   names and payload TS types (or a codegen source) to replace my placeholder `databaseTypes.ts`.
2. Confirm `DatabaseDesignOperation` is a tagged union I can exhaustively switch on client-side (for
   the optimistic-apply preview in §5.1) rather than an opaque blob.
3. Confirm `database_layouts` persistence grain (per-table position, or per-node-in-revision) so
   §3.6's pin/persist debounce writes the right key.
4. Confirm whether `viewport`/`selection` in `DatabaseCanvasState` (§6) should itself be pushed to the
   backend (a "canvas session" row) for agent awareness even across a UI reload, or whether the
   Builder's bridge reads it live from the running frontend only while the window is open. My current
   design assumes the latter (live read only) since the mission's Flow 7 examples ("user selects
   tables... agent understands current selection") describe same-session awareness, not cross-session
   persistence of selection.
5. Confirm `theme.test.ts`'s genome-stylesheet list update (if I end up adding a split
   `databaseCanvas.css`) is something I'm cleared to touch, since that test file is outside
   `src/features/database/**`.

---

*No components implemented under this spec yet. Waiting for GATE 1 (`CONTRACTS.md` approval) per
mission constraints.*

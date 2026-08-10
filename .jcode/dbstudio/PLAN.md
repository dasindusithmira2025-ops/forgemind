# Paralith Database Studio — Coordinator Plan

Root coordinator: Opus 5 (this session). Branch: `feat/database-studio`.
Mission source: `.jcode/database-studio-mission.md`. Scoreboard: `node .jcode/dbstudio/scoreboard.mjs`.

## 0. Model resolution (mission section "verify the requested models")

| Mission role | Requested | Installed route used | Note |
| --- | --- | --- | --- |
| Coordinator | Claude Opus 5 | `claude-opus-5` | exact |
| Reviewer | Claude Opus 5 | `claude-opus-5` | exact |
| Architect | GPT-5.6 | `gpt-5.6-sol` | this install exposes GPT-5.6 only as named variants (`sol`/`terra`/`luna`); `sol` is the full-capability coding variant |
| Backend | GPT-5.5 | `gpt-5.5` | exact |
| UI/UX | Claude Sonnet 5 | `claude-sonnet-5` | exact |
| Builder | GPT-5.6 | `gpt-5.6-sol` | same resolution as Architect |

No silent substitution: there is no bare `gpt-5.6` route in this installation.

## 1. Repository implementation map (verified by inspection)

Application lives in `Paralith-tauri/` (crate `forgemind`, lib `forgemind_lib`).

Backend (`src-tauri/src/`):
- `database/` — SQLite persistence. `migrations.rs` holds `CURRENT_SCHEMA_VERSION = 27` and a
  numbered `migrate_vN` chain plus upgrade-preserves-data tests. `mod.rs` is `DatabaseService`.
  Domain query modules: `repository.rs`, `swarm.rs`, `placement.rs`, `orchestration.rs`, `usage.rs`.
- `models/` — serde domain types, one file per domain (`repository.rs`, `swarm.rs`, ...).
- `services/` — business logic. `repository_service.rs` + `repository_intelligence.rs` already
  implement a provenance-carrying node/edge graph (`GraphBuilder`, `Origin::exact/heuristic`) —
  the Database Graph must follow that established pattern, not invent a second one.
  `file_watch_service.rs` is the existing filesystem-event source for incremental processing.
- `commands/` — Tauri command surface, one file per domain, registered in `lib.rs`.
- `orchestration/` — the agent capability protocol. `registry.rs` holds `CapabilityDescriptor`
  (`id: domain.verb`, `arg_schema`, `risk`, `reversibility`, `mutates`, `requires_project_scope`,
  `audited`). `kernel.rs` is the gateway that validates and executes; `policy.rs` is the risk gate;
  `redaction.rs` already exists for secret scrubbing. **Database agent tools belong here.**
- `agents/` — external agent adapters (`adapter.rs`, `model_registry.rs`).

Frontend (`src/`): React 19 + Zustand + react-router + Monaco + xterm, oxlint, vitest.
- `features/<domain>/` — each surface is a folder with `<Name>.tsx`, `<name>Store.ts`,
  `<name>Selectors.ts`, `<name>Types.ts`, colocated `.test.tsx`. `features/repository/` is the
  closest precedent for a first-class project surface.
- `screens/` — routed screens. `theme/tokens.ts` is the design token source; UI must consume it.

## 2. Architectural dependency map

```
WP1 Architecture + contracts (Architect)
        │  GATE 1
        ▼
   ┌────────────────────────────┬────────────────────────────┐
   │ WP2 Backend domain/persist │ WP3 UI shell/canvas/state  │  (parallel, disjoint files)
   │ discovery/adapters/diff    │ against WP1 TS contracts   │
   └──────────┬─────────────────┴─────────────┬──────────────┘
        GATE 2/3                          GATE 4
              └──────────────┬─────────────┘
                             ▼
              WP4 Integration + agent protocol + pipeline (Builder)
                        GATE 5/6/7/8
                             ▼
              WP5 Tests / regressions / performance (all, coordinated)
                        GATE 9/10
```

## 3. Work packages and ownership boundaries

Ownership is by file path. An agent must not edit another agent's paths; cross-boundary needs go
through the coordinator.

### WP1 — Architect (`gpt-5.6-sol`)
Owns: `.jcode/dbstudio/CONTRACTS.md`, `.jcode/dbstudio/ARCHITECTURE.md`.
Produces: canonical object/edge model, identity scheme, Declared/Observed/Proposed separation,
revision DAG design, adapter trait signatures, Tauri command + event list, persistence table DDL
sketch, capability descriptor list, concurrency + incremental strategy, acceptance criteria per WP.
Constraint: implementation-ready contracts only. No large subsystem implementation.

### WP2 — Backend Engineer (`gpt-5.5`)
Owns:
- `src-tauri/src/models/database_studio.rs` (+ submodules if needed)
- `src-tauri/src/database/database_studio.rs` (persistence queries)
- `src-tauri/src/database/migrations.rs` (append `migrate_v28` only; do not alter earlier ones)
- `src-tauri/src/services/database_studio/**` (discovery, adapters, graph, diff, health)
- `src-tauri/tests/fixtures/database_studio/**`
Drives checks: B3, B7, B9, B12 (partly B1/B2).

### WP3 — UI/UX Engineer (`claude-sonnet-5`)
Owns:
- `src/features/database/**` (surface, canvas, explorer, inspector, stores, tests)
- one routing/nav entry point edit each in `src/screens/` and the sidebar (minimal, additive)
Drives checks: B4, B5, B6, B13. Must consume `theme/tokens.ts`. No unrelated redesign.

### WP4 — Builder / Integration (`gpt-5.6-sol`)
Owns:
- `src-tauri/src/commands/database_commands.rs` + registration in `lib.rs`
- `src-tauri/src/orchestration/registry.rs` additions + `kernel.rs` dispatch for `database.*`
- `src-tauri/src/services/database_studio/pipeline/**` (implementation pipeline)
- `src/features/database/api.ts` (frontend ↔ backend binding) by agreement with UI
Drives checks: B8, B10, B11.

### WP5 — Cross-cutting hardening
Assigned per failing check after the first full scoreboard run.

### Reviewer (`claude-opus-5`)
Owns `.jcode/dbstudio/gate-*.md` only. Writes `verdict: APPROVED|REJECTED` + `commit: <sha>` +
precise findings. Never edits implementation files; rejects route back to the owning specialist.

## 4. Hard constraints for every specialist

1. Do not push, open PRs, merge, release, or publish. Local commits on `feat/database-studio` only.
2. Do not disable, skip, or delete tests. B14 detects it.
3. Do not modify `migrate_v1..v27`; only append.
4. No secrets in DB rows, logs, graph nodes, snapshots, context packs, or agent messages.
5. No automatic connection to a discovered database. Discovery is static file analysis only.
6. Do not execute repository code to discover schema.
7. React/Zustand state is a projection; backend is authoritative.
8. Report back a typed artifact: files owned, contracts consumed/produced, tests added, exact
   commands run with results, blockers. No transcript dumps.
9. Before large implementation, state files/modules owned and contracts consumed/produced.
10. Keep existing Paralith behavior green (B2, B6).

## 5. Acceptance

Mission DONE requires scoreboard `gates 10/10` and `checks 14/14`, then the dev app launches and
Database Studio is reachable from a project.

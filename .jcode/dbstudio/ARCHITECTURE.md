# Paralith Database Studio Architecture

Status: WP1 implementation contract for `feat/database-studio`.
Authoritative detail: [`CONTRACTS.md`](./CONTRACTS.md).

## 1. Product boundary

Database Studio is a first-class Project surface backed by one semantic database graph. It is not a React-owned ERD and it does not introduce a second agent protocol. The end-to-end ownership chain is:

```text
Project files + explicit read-only connection
  -> discovery evidence
  -> logical DatabaseSource resolution
  -> Declared / Observed snapshots
  -> immutable Proposed design revisions
  -> semantic diff and issues
  -> existing orchestration capability gateway
  -> approved native repository change
  -> re-extraction and zero-delta verification
```

The backend is authoritative. React/Zustand stores only projections, selection, viewport, request state, and optimistic tokens.

## 2. Verified repository integration points

| Existing system | Verified symbol/path | Database Studio use |
| --- | --- | --- |
| SQLite lifecycle | `Paralith-tauri/src-tauri/src/database/migrations.rs`: `CURRENT_SCHEMA_VERSION`, `apply`, `migrate_v24`, `migrate_v25`, `upgrades_installed_schema_10_to_current_preserving_data` | Append only `migrate_v28`; retain the numbered ladder and preservation test pattern. |
| Persistence owner | `Paralith-tauri/src-tauri/src/database/mod.rs`: `DatabaseService` | Database Studio queries are methods/submodule behavior of the existing service, not a second connection manager. |
| Domain query precedent | `database/repository.rs`, `database/swarm.rs` | Put graph/revision persistence in `database/database_studio.rs`. |
| Provenance graph | `services/repository_intelligence.rs`: `GraphBuilder`, `Origin::exact`, `Origin::exact_with`, `Origin::heuristic`, provenance fields `snapshot`, `observed_at`, `extractor_version`, `confidence`, `evidence_ref` | Follow the same explicit exact-versus-heuristic discipline. Database objects use typed fields instead of critical `metadata` JSON. |
| Incremental events | `services/file_watch_service.rs`: one watcher per Project, `PROJECT_FILE_CHANGED_EVENT`, 150 ms debounce, coalesced `ProjectFileChangeBatch`, self-write suppression | Subscribe once per Project and filter DB-relevant paths before extraction. Never create a component-local watcher. |
| Agent allow-list | `orchestration/registry.rs`: `CapabilityDescriptor`; `kernel.rs`: `execute_capability`, `dispatch`; `policy.rs`; `model.rs`: `RiskLevel`, `Reversibility`; `redaction.rs`: `redact_text`, `redact_json` | Add `CapabilityDomain::Database`, `database.*` descriptors, typed validation and dispatch through the existing kernel. |
| Frontend surface | `src/features/repository/`: `repositoryStore.ts`, `repositorySelectors.ts`, `repositoryTypes.ts`, colocated tests | Mirror this feature topology under `src/features/database/`; preserve stale-response/load-token protection. |
| Visual source | `src/theme/tokens.ts`: semantic `background`, `foreground`, `border`, `status`, `git`, control tokens | Canvas and panels consume theme tokens. No separate color system. |

## 3. Runtime components and ownership

```text
FileWatchService ──ProjectFileChangeBatch──> DatabaseDiscoveryService
                                                   │ evidence + fingerprints
Explicit Connect command ──credential ref──> DatabaseIntrospectionService
                                                   │
                                      DatabaseAdapterRegistry
                       prisma | drizzle | raw_sql | sqlite | postgres | mysql
                                                   │
                                  DatabaseGraphService
                         resolve sources -> snapshots -> objects/edges
                                                   │
                 ┌─────────────────────────────────┼──────────────────────────┐
                 │                                 │                          │
          DatabaseDiffService             DatabaseDesignService       ContextPackBuilder
                 │                    immutable revisions + CAS       bounded semantic graph
                 └─────────────────────────────────┼──────────────────────────┘
                                                   │
                                      DatabaseService persistence
                                                   │
                                      Tauri commands + events
                                                   │
                                   Database feature projection
                                                   │
                                      OrchestrationKernel
                         DESIGN_ONLY | IMPLEMENT_DESIGN capability enforcement
```

Required backend modules are limited to the paths assigned in `PLAN.md`. The adapter registry is internal to `services/database_studio/**`; it does not own persistence, credentials, file watching, or orchestration.

## 4. Authoritative state and concurrency

1. Snapshots and design revisions are immutable.
2. A draft names one immutable `head_revision_id` and a monotonically increasing `revision_number`.
3. Every design mutation carries `expected_head_revision_id` and `expected_revision_number`.
4. Mutation is one SQLite transaction: compare token, insert operation, materialize new revision, advance design head.
5. A stale token fails deterministically with `DATABASE_DESIGN_STALE_REVISION`; it is never silently rebased.
6. Frontend event handlers refetch or apply event-provided authoritative revisions. They never invent a new backend revision.
7. Approved revisions are immutable implementation targets. Pipeline runs record the target revision and verify re-extracted Declared state against it.

## 5. Layer separation

- **Declared**: schema/migration/ORM facts statically extracted from repository artifacts. No repository code execution.
- **Observed**: schema facts obtained only after an explicit user connection action, read-only by default.
- **Proposed**: immutable design revision derived from a declared, observed, or earlier proposed base.

Layers share semantic object types and identity rules but never overwrite one another. Comparisons are stored as typed semantic diffs: declared-to-observed drift, declared-to-proposed delta, design-to-design, and Git-revision-to-Git-revision.

## 6. Safety architecture

- Discovery performs static file analysis only and never auto-connects.
- Connection profiles persist metadata and an opaque OS credential-store reference, never a URL containing a password, token, certificate body, or secret.
- Introspection starts read-only and adapters must report whether the server can enforce read-only transactions.
- All command results, events, persisted evidence summaries, context packs, audit records, and errors pass through the existing redaction boundary where free text or JSON may contain secrets.
- `IMPLEMENT_DESIGN` is the only mode permitted to invoke repository-mutating capabilities. It requires an approved target revision and uses existing orchestration policy/audit gates.

## 7. Incremental and large-schema architecture

The file watcher emits broad Project changes. Database Studio first applies a deterministic relevant-path predicate. Relevant files are fingerprinted by normalized relative path, byte length, mtime hint, and SHA-256 content hash. Extraction caches are keyed by `(project_id, adapter_id, extractor_version, relative_path, content_sha256)`. Only affected evidence, sources, and snapshots are recomputed. A change to `Button.tsx` produces no Database Studio command, extraction, DB write, or event.

Large schemas use semantic levels of detail:

- LOD0: namespace/domain aggregates and issue counts.
- LOD1: table/view names and typed relationship lines.
- LOD2: keys and indexed/changed columns.
- LOD3: complete columns, constraints, provenance, and usage references for selected/nearby objects.

Layout runs in a worker/off-render path, is keyed by snapshot/design revision plus layout preferences, and is persisted separately from semantic objects. Viewport culling and bounded context packs prevent a 400-table schema from becoming either a render payload or an agent prompt.

## 8. Delivery sequence

1. **WP1 Architect** defines these contracts.
2. **WP2 Backend** implements types, migration 28, discovery, adapters, snapshots, designs, diffs, security tests.
3. **WP3 UI** implements the feature projection against contract types and mocked API boundaries, using theme tokens.
4. **WP4 Builder** registers commands/events/capabilities, enforces execution mode, and implements approved-design pipeline integration.
5. **WP5** repairs only scoreboard-proven gaps.

Gate order remains WP1 Gate 1, WP2 Gates 2/3, WP3 Gate 4, WP4 Gates 5/6/7/8, then cross-cutting Gates 9/10.

## 9. Required new mechanisms and known gaps

The repository provides persistence, file watching, provenance style, orchestration policy, and frontend feature precedents, but inspection found no existing Database Studio implementation. The mission therefore requires these explicit additions rather than assuming they already exist:

- `CapabilityDomain` currently has no `Database` variant. WP4 must add it and append descriptors/dispatch to the existing protocol.
- No OS credential-store abstraction was found in the inspected Database Studio integration paths. Connection profiles cannot be considered implemented until a platform credential-store service exists or an already-installed repository facility is identified and reused. SQLite may store only its opaque reference.
- No PostgreSQL/MySQL Database Studio introspection clients or connection pool were found. WP2 must verify existing crate dependencies before choosing a driver. Adding a dependency requires the repository dependency review described in `AGENTS.md`.
- No database adapter registry, schema parser, semantic diff engine, or approved-design generator exists. These are new internals under `services/database_studio/**`, not extensions of repository graph metadata JSON.
- No established graph layout worker for this surface was verified. WP3 must implement or reuse an off-render-path worker and prove it through `largeSchema` tests. Synchronous layout in React is not an acceptable fallback.
- Git-revision schema comparison needs a safe file-at-revision reader. It must reuse repository/Git services without checkout or worktree mutation. If the existing service cannot provide bounded blob reads, WP4 must add a guarded read-only mechanism before enabling this comparison mode.
- The existing `FileWatchService` emits general Project batches but has no Database Studio classifier. WP2 must add the relevant-path/fingerprint layer while preserving the single watcher owner.

All Rust tests must resolve under `database_studio::<area>` with areas `discovery`, `design`, `diff`, `agent`, `pipeline`, and `security`, per `.jcode/dbstudio/TEST-NAMING.md`. The frontend 400-table test filename must contain `largeSchema`.

## 10. Non-goals

- No generic SQL client or query console in V1.
- No automatic migration execution against a live database.
- No secret storage in SQLite.
- No graph state duplicated as an authoritative React model.
- No unbounded whole-schema agent context.
- No invented agent RPC outside `CapabilityDescriptor` and `OrchestrationKernel`.
- No edits to migrations 1 through 27.

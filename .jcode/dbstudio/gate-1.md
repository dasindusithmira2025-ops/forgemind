verdict: REJECTED
commit: a308edd3dfd6439cd90b89e95de9a4768e68cf5f
gate: 1
reviewed: .jcode/dbstudio/ARCHITECTURE.md, .jcode/dbstudio/CONTRACTS.md, .jcode/dbstudio/INTEGRATION-AUDIT.md against Paralith-tauri/src-tauri/src/{database/migrations.rs, database/mod.rs, orchestration/{registry.rs,kernel.rs,policy.rs,model.rs}, services/{swarm_service.rs,repository_intelligence.rs}, agents/adapter.rs}, Paralith-tauri/src-tauri/Cargo.toml, Paralith-tauri/src-tauri/tests/fixtures/database_studio/**, .jcode/dbstudio/scoreboard.mjs

# GATE 1 — Architecture and domain contracts

Reviewer: independent senior reviewer (Opus 5). Branch `feat/database-studio`.

**Verdict: REJECTED — 3 blockers, 4 majors.** The architecture is genuinely good: it reuses the
right existing systems (`DatabaseService`, `OrchestrationKernel`, `policy.rs`, `redaction.rs`,
`FileWatchService`, `repository_intelligence.rs` provenance discipline), it correctly refuses to
invent a second agent protocol, and its layer separation is sound. It is rejected for specific,
mechanically-proven defects, not for style: the persistence DDL's central uniqueness constraints
do not constrain anything under real SQLite semantics, the identity algorithm turns every rename
into drop+add for every V1 adapter, and the concurrency claim is not actually established by the
proposed transaction. Each has a small, concrete fix. Fix findings 1-3 and the majors below and
this document is implementable.

Scope is also unrealistic as written. See **REQUIRED V1 SCOPE** for the keep/defer cut. This is
not optional advice: the mission forbids mock-only features, so the contract must state now what
is out of V1 rather than let a specialist ship a stub later.

---

## Findings

### 1. BLOCKER — the `database_objects` primary key does not prevent duplicate objects

`CONTRACTS.md:606` — `PRIMARY KEY(id, snapshot_id, design_revision_id)` on a non-`WITHOUT ROWID`
table. `snapshot_id` and `design_revision_id` are both nullable, and by the contract's own design
exactly one of them is always NULL (an object belongs either to a snapshot or to a design
revision). In SQLite, NULLs are distinct in a UNIQUE/PK index, so this key constrains nothing for
any row the system will ever actually write.

Measured, not assumed (full script and output in Evidence, PROBE1/PROBE2): inserting the same
`id` twice with the same `snapshot_id` and NULL `design_revision_id`, with different
`qualified_name`, **succeeded**. Four rows exist where the contract's model permits two.

Why it is wrong: `DatabaseObjectMeta.content_fingerprint` and the whole "one object has exactly
one meta per snapshot" invariant (`CONTRACTS.md:66`) rely on this key. A re-extraction that
partially fails, or a retried snapshot build, silently doubles the graph. `database.get_table`
then returns a nondeterministic row, and the target-vs-result zero-delta assertion in B11 becomes
meaningless because "the object" is ambiguous.

Required fix: make both discriminator columns `NOT NULL DEFAULT ''` with an explicit empty-string
sentinel for "not applicable", plus a `CHECK` that exactly one is non-empty. Verified working
(PROBE10): the duplicate insert is then rejected with `UNIQUE constraint failed`. Alternatively
use a single `NOT NULL reference_id` column plus a `reference_kind` column. Do not fix this with
application-level checking; the DB must hold the invariant.

### 2. BLOCKER — the same NULL defect voids the edge and layout uniqueness constraints

`CONTRACTS.md:616` — `UNIQUE(snapshot_id, design_revision_id, source_object_id, target_object_id,
edge_type)` and `CONTRACTS.md:662` — `UNIQUE(source_id, snapshot_id, design_revision_id,
layout_kind, semantic_lod)`. Both include a column that is NULL for every real row.

Measured (PROBE3, PROBE4): two identical `(snapshot_id='snap1', NULL revision, a, b, REFERENCES)`
edges both inserted; two layouts for the same `(source, revision, kind, lod)` both inserted.

Why it is wrong: duplicate edges directly corrupt the semantic diff (`DatabaseChangeKind` is
computed over edge sets), and duplicate layout rows mean `database_save_layout` has no
deterministic row to update, so `expected_layout_fingerprint` optimistic concurrency
(`CONTRACTS.md:730`) cannot be enforced. The mission requires that a user layout is not
rearranged on schema change; a duplicated layout row makes which layout wins arbitrary.

Required fix: same sentinel treatment as finding 1, applied to `database_edges` and
`database_layouts`. Also add the missing `UNIQUE` on `database_objects(...)` after the sentinel
change so the PK is the real key.

### 3. BLOCKER — the identity algorithm makes every rename a drop+add for every V1 declared adapter

`CONTRACTS.md:58-64`. The `object_logical_key` fallback ladder ends at
`(namespace logical key, object kind, canonical name)`, and `id` is a SHA-256 over that key.
Rename tolerance is stated as evidence-based: it holds only when there is "a native stable id or
explicit rename migration" (`CONTRACTS.md:64`).

The problem is that **none of the V1 declared adapters supply a native stable id**. Prisma models,
Drizzle table definitions, and raw SQL DDL identify objects by name. So for the entire declared
layer the name-derived branch is the branch that actually runs, and the name is part of the hash.

Measured (PROBE-C): renaming `users` to `accounts` produces
`db:table:atweuyguinxldhfvpim7igpucz` vs `db:table:kguncazfqzvurypgenow4oriio` — different
identity. Worse, this also breaks the *Proposed* layer (PROBE-D): `database.rename_table`
(`CONTRACTS.md:760`) is defined as `RenameTable { table_id, new_name }` (`CONTRACTS.md:355`),
which by the algorithm must change the object's id, yet `DatabaseDesignOperationKind` has no
mechanism to carry the resulting id change forward and `previous_ids` is populated only in the
native-stable-id branch. An agent renaming a table it just created in its own draft loses the
object's identity, so `database.get_table`, selection state, layout pins, and issue references
that point at `table_id` all dangle.

Why it is wrong beyond aesthetics: the mission's canvas-awareness contract says selections resolve
by semantic ID and stale selections are rejected rather than name-resolved (`CONTRACTS.md:817`).
With drop+add renames, the most common design operation invalidates selection, layout, issues, and
usage references at once, and Flow 3's semantic comparison reports "dropped users, added accounts"
instead of a rename. That is textually equivalent to the text-diff the mission explicitly forbids.

Required fix (two parts, both small):
- Split identity from naming. Allocate the Proposed layer a **synthetic, name-independent
  `SemanticId`** at object creation (UUID/ULID) and store the name only in `qualified_name`.
  Proposed-layer rename then provably keeps identity, which is the layer the mission's flows
  operate in.
- For the Declared layer, keep the name-derived id but make `RenameTable` and the extraction
  reconciler emit an explicit `previous_ids` link whenever a rename is proven by a migration or by
  the design operation log, and specify what a heuristic match below the `0.90` threshold does
  (currently unspecified: the text says it "must not silently reuse identity", but does not say
  whether it emits a rename issue, a proposed rename, or nothing).

### 4. MAJOR — the CAS transaction has a real lost-update window and a nondeterministic error

`ARCHITECTURE.md:73` and `CONTRACTS.md:537-561` specify: compare token, insert operation,
materialize revision, advance head, in one `BEGIN IMMEDIATE`. Under `BEGIN IMMEDIATE` on one
`Mutex<Connection>` (`database/mod.rs:29`, `mod.rs:84`) with a 5s busy timeout
(`database/mod.rs:68`), two in-process agent drafts serialize correctly. That part is sound and I
do not dispute it.

Two defects remain:

a) **The contract does not say the head advance is conditional.** It says "compare token ... and
conditionally advance the head", but the compare is described as a separate read. If any
implementation reads the design row, then later issues `UPDATE database_designs SET
head_revision_id=...`, the guard is a TOCTOU that is only saved by the surrounding transaction —
an implementation detail, not a contract. The contract must mandate the guard in the write itself:
`UPDATE database_designs SET head_revision_id=?, revision_number=? WHERE id=? AND
head_revision_id=? AND revision_number=?` and require `affected == 1`, exactly the pattern already
used elsewhere in this codebase (`database/repository.rs:207`, `:253`, `:315` all check `changed`
/ `affected`). This also makes the guard survive any future move to a connection pool.

b) **The stale error is not deterministic as specified.** `database_design_revisions` has
`UNIQUE(design_id, revision_number)` (`CONTRACTS.md:645`). Depending on statement order inside the
transaction, a losing writer can hit that constraint *before* the token compare fails. Measured
(PROBE11): the second writer at the same `revision_number` is rejected with `UNIQUE constraint
failed: revs.design_id, revs.revision_number` — a raw rusqlite error, not the contractually
promised `DATABASE_DESIGN_STALE_REVISION` with populated `details`. B8 requires the exact stale
error, so this is a check-failing ambiguity, not a nitpick.

Required fix: contract must state the mandatory statement order — (1) conditional `UPDATE` of
`database_designs` with both tokens in the `WHERE`, (2) if `affected == 0`, re-read actual head and
return `DATABASE_DESIGN_STALE_REVISION` with `actualHeadRevisionId`/`actualRevisionNumber`,
(3) only then insert the revision and operation rows. Also require that any residual
`UNIQUE(design_id, revision_number)` violation be mapped to the same typed error, so the code is
deterministic even if the ordering is ever violated.

### 5. MAJOR — the capability list contradicts the integration audit, and 12 mission-named capabilities silently vanish

`CONTRACTS.md:751-771` lists 21 descriptors. `INTEGRATION-AUDIT.md:35-67` lists a different 33.
Machine-diffed (Evidence, PROBE-drift): 23 ids exist in the audit but not the contract, and 11
exist in the contract but not the audit. Notably, `database.get_canvas_state` and
`database.get_selection` are **absent from CONTRACTS.md entirely** — the only mentions of "canvas"
in that file are performance and test-naming asides (verified: 4 matches, none defining a canvas
capability or command).

Why it is wrong: the mission makes canvas awareness a named requirement (Flow 5: "these" must
resolve from structured selection) and B10 greps test output for `selection`. `CONTRACTS.md:790`
does define `DatabaseCanvasContext`, but no command writes it and no capability reads it, so the
type is unreachable. WP3 (UI) and WP4 (Builder) would each assume the other owns publishing canvas
state, which is exactly the cross-boundary gap the plan's ownership table exists to prevent.

Required fix: CONTRACTS.md is authoritative and must be reconciled. Add the canvas-state publish
command (`database_publish_canvas_state` or equivalent, owned by WP4 with WP3 as the caller), add
`database.get_canvas_state` and `database.get_selection` descriptors, and add an explicit
"deliberately not in V1" table listing every mission-suggested id that is deferred with its
reason. Silence is not deferral.

### 6. MAJOR — no OS credential store exists, so connection profiles and the whole Observed layer are unbuildable in V1

`CONTRACTS.md:472-474` defines `DatabaseCredentialLease` and `DatabaseSecret`;
`CONTRACTS.md:690-696` persists `credential_reference`; `CONTRACTS.md:838-840` requires secrets to
live "only in OS credential storage". `ARCHITECTURE.md:122` already honestly flags that no such
facility was found.

I verified this independently: a repository-wide search for `keyring|credential_store|DPAPI|
CredWrite|secret_service` in `src-tauri/src` returns exactly one hit, a comment in
`repository_service.rs:947` stating GitHub auth is delegated to the `gh` CLI's keyring and no token
is exposed to Paralith. There is no credential abstraction. `Cargo.toml` contains no keyring,
`sqlx`, `tokio-postgres`, or `mysql` crate — the Postgres/MySQL clients the Observed layer needs do
not exist either, and adding them triggers the `AGENTS.md` dependency review.

Why it is a major rather than a blocker: the contract is not *wrong*, it is *unimplementable in
this mission's budget*, and shipping it half-done produces exactly the mock feature the mission
forbids. `database_test_connection` and `database_introspect` returning "not supported" while the
adapter table (`CONTRACTS.md:513-515`) advertises `introspect: yes` for sqlite/postgres/mysql is a
lie in the product surface.

Required fix: cut Observed-via-network from V1 (see scope section). Keep the trait definitions as
non-dispatched contract, set `postgres`/`mysql` adapter rows to "not registered in V1", and mark
`database_test_connection`/`database_introspect` as V1-absent commands rather than stubs. If any
Observed support is kept, keep only read-only SQLite file introspection, which needs no credential
store at all and no new crate (`rusqlite` is already a dependency).

### 7. MAJOR — the pipeline as specified cannot reach zero-delta, because generation and extraction are the same untested code

`CONTRACTS.md:502` (`generate_change`) and `CONTRACTS.md:497` (`extract_declared_schema`) are
implemented by the same adapter, and `CONTRACTS.md:783` requires "success requires zero semantic
delta" between target and re-extracted result. `INTEGRATION-AUDIT.md:154-171` specifies 14 pipeline
stages including native migration generation, validation, test execution, and safe local
verification.

The structural problem: if adapter X writes `schema.prisma` and adapter X reads it back, zero delta
proves only that X round-trips its own output. It does **not** prove the generated Prisma schema is
valid Prisma, and stage 9 ("generate native migration" via the repository's package manager) is the
only thing that would catch it — but `CONTRACTS.md:517` forbids executing repository code, package
scripts, and ORM CLIs during detection/extraction, while the pipeline needs exactly that. The two
rules are not reconciled anywhere, and the boundary between them is where the real security risk
lives (running `npx prisma migrate dev` from an agent-authored plan).

Required fix: the contract must explicitly state that the no-execution rule applies to
discovery/extraction only, and that the pipeline's command execution is a distinct, authorized,
allow-listed surface with its own gate — naming which commands are permitted, who authorizes them,
and that it runs inside the agent's leased worktree via `RepositoryService`. Until that boundary is
written down, WP4 has no safe implementation to build.

### 8. MINOR — no FK on `design_revision_id`, so orphan revision references are accepted

`CONTRACTS.md:601`, `:614`, `:622`, `:659`, `:674` all carry `design_revision_id TEXT` with no
`REFERENCES database_design_revisions(id)`. Measured (PROBE5): an object row referencing a
nonexistent revision id inserted without error. `PRAGMA foreign_keys` is on (`database/mod.rs:58`),
so the constraint would be enforced if declared. Add the FKs with `ON DELETE CASCADE`, or state
explicitly why they are omitted (there is a legitimate reason — the sentinel from finding 1 is not
a valid revision id — which is precisely why the fix for finding 1 and this finding must be
designed together).

### 9. MINOR — `CURRENT_SCHEMA_VERSION` bump alone is insufficient; `requires_migration` must also learn the new table

`CONTRACTS.md:565` instructs only: bump the constant, add `migrate_v28`, call it from `apply`, add a
preservation test. But this codebase's ladder deliberately pairs each version with a feature
predicate: `apply` uses `if current < 27 || !column_exists(...)` (`migrations.rs:904-908`) and
`requires_migration` lists a predicate per version (`migrations.rs:917-960`). The stated reason is
recorded at `migrations.rs:794-795`: an unsafe partial build once left `user_version` ahead of the
actual schema. A version-only v28 reintroduces exactly that failure mode.

Required fix: `apply` must use `if current < 28 || !table_exists(connection, "database_sources")?`
and `requires_migration` must gain the same predicate.

### 10. MINOR — verified non-issues, recorded so they are not re-litigated

- **The DDL applies cleanly.** Executing the CONTRACTS.md SQL block verbatim against a fresh SQLite
  with a pre-existing `schema_migrations` table succeeds, leaves `user_version = 28`, records
  version 28, and creates all 12 declared indexes. It is purely additive: it creates only new
  `database_*` tables and touches no v1-v27 object. Safe against an installed v27 DB.
- **`PRAGMA user_version=28` inside the transaction is correct**, contrary to a common assumption.
  Measured (PROBE9): the pragma rolls back with the DDL on `ROLLBACK`. The migration is atomic.
- **The proposed `database.*` ids satisfy both shipped registry tests.** I read the actual
  assertions at `orchestration/registry.rs:174-201`. `ids_are_unique_and_dotted` requires unique,
  dotted ids; all 21 proposed ids are unique against the 6 existing ones and all contain a dot
  (PROBE-E: no duplicates, no undotted). `read_capabilities_are_not_mutating_and_writes_are`
  (`registry.rs:192-201`) asserts **only** about `file.read` and `file.write` — it does not iterate
  the registry — so `database.*` cannot break it (PROBE-F). **No blocker here.** The one real
  requirement is `CapabilityDomain::Database`, which does not exist today
  (`orchestration/model.rs:368-381` lists 12 variants, no Database) and must be added by WP4 as
  `ARCHITECTURE.md:121` states.
- **Indexes are justified.** Each of the 12 maps to a stated access pattern: source-by-repository
  listing, evidence-by-source, snapshot-by-layer, object-by-snapshot/revision + kind for the LOD
  queries, edge-by-source/target for relationship traversal, provenance-by-object for
  `database.get_provenance`, design-by-source, issues-by-status for the Health surface, usage by
  object and by path for `database.get_usage`. None is speculative. `updated_at DESC` and
  `created_at DESC` are legal in SQLite indexes and match the existing
  `idx_orch_sessions_recent` precedent (`migrations.rs:2223-2226`).
- **Every JSON column audited** (mission forbids untyped JSON for critical architecture):

  | Column | Ruling |
  | --- | --- |
  | `database_objects.typed_payload_json` (`:604`) | **Legitimate but must be constrained.** This is the object body — the most critical data in the system. It is acceptable only because the surrounding columns (`object_kind`, `logical_key`, `qualified_name`, `parent_object_id`, `namespace_id`, `native_type`, `ordinal`, `nullable`, `content_fingerprint`) are typed and queryable, and `:703` requires it to deserialize through the `DatabaseObject` enum. **Required addition:** a `payload_version INTEGER NOT NULL` column. Without it, `:703`'s "typed versioned Rust values" claim is unenforceable and a future model change silently fails to deserialize old rows. |
  | `database_design_operations.operation_payload_json` (`:652`) | Legitimate. `operation_kind` is a typed column beside it; the payload is the `DatabaseDesignOperationKind` variant body and is never queried by field. Same `payload_version` requirement applies. |
  | `database_diffs.changes_json` (`:668`) | Legitimate. A diff is a derived, recomputable artifact; `comparison_mode`, `left_ref`, `right_ref`, `fingerprint` are typed and are what queries filter on. |
  | `database_layouts.viewport_json`, `positions_json` (`:661`) | Legitimate and correctly non-critical. Pure UI geometry, deliberately kept out of the semantic graph, keyed by typed `layout_kind`/`semantic_lod`. This is the right place for JSON. |

  No JSON column holds a relation, constraint, or ownership fact that the diff engine or agent
  protocol must query. Ruling: **the typed-ness requirement is satisfied**, conditional on adding
  `payload_version` to the two payload tables.
- **No column can hold a secret.** `safe_value_fingerprint` (`:583`) and `source_hint` (`:583`) are
  the two risk points and both are contractually fingerprints/labels
  (`CONTRACTS.md:523`: "Never persist raw `DATABASE_URL`"). `database_connection_profiles` stores
  `host_label`, `username_label`, and `credential_reference` — labels and an opaque handle, no
  password field. Correct by construction. The residual risk is enforcement, which is why B12 must
  assert on actual row contents, not on intent.

### 11. Agent bridge — Builder's claim independently confirmed

I verified this myself rather than accepting `INTEGRATION-AUDIT.md:81-90`.

- `src/features/orchestrator/api.ts:40` invokes `orchestrator_execute_capability`; that command is
  registered at `lib.rs:670`. **The in-app path reaches capabilities.**
- `ProviderRuntimeAdapter::arguments` for Claude (`services/swarm_service.rs:188-239`) builds
  `--print --model --effort --verbose --output-format stream-json <prompt> --permission-mode
  <mode> --allowedTools <bash/powershell test patterns> [--disallowedTools ...]`. For Codex
  (`swarm_service.rs:249-294`) it builds `--model -c model_reasoning_effort --ask-for-approval
  never --sandbox <ro|workspace-write> --cd <root> exec --json --skip-git-repo-check <prompt>`.
  **Neither launch passes a tool-server, MCP config, socket, or endpoint.**
- Repository-wide search for `mcp-config|mcpServers|mcp_servers|--mcp|modelcontextprotocol|
  tool_server` across `Paralith-tauri`: **zero matches.** The only `mcp` token in the codebase is
  `"mcp_tool_call"` in `normalize_codex_event` (`swarm_service.rs:1394`), which parses provider
  output and provides nothing.

**Confirmed: no external Claude/Codex → Paralith capability path exists.** Both CLIs are launched
with a text prompt and their own filesystem/shell sandbox.

**Ruling on scope:** building a new authenticated stdio MCP transport is **NOT in scope for this
mission and must be explicitly deferred.** The audit's own design (`INTEGRATION-AUDIT.md:92-102`)
requires a server process, an unforgeable short-lived launch grant with session/run/project/mode/
expiry/bearer secret, injection into two different provider CLIs whose flag shapes are unverified,
grant revocation on termination, and attribution into the existing audit trail. That is a security-
critical subsystem on its own, it sits in `swarm_service.rs` and `orchestration/` which are
outside every declared Database Studio ownership boundary (`CONTRACTS.md:911-918`), and getting it
subtly wrong grants an external process a privileged, project-scoped, repository-mutating endpoint.
Rushing it inside a mission whose main deliverable is elsewhere is the single most dangerous thing
this swarm could do.

**Required contract change:** CONTRACTS.md must state plainly that in V1, Database Studio
capabilities are reachable by the **in-app orchestrator only**, that external Claude Code / Codex
CLI processes cannot call them, and that the mission's "agent-operable" requirement is therefore
scoped to: (a) the complete, tested `database.*` descriptor set on the existing kernel with
DESIGN_ONLY/IMPLEMENT_DESIGN enforcement, (b) in-app orchestrator sessions driving those
capabilities end to end, (c) `INTEGRATION-AUDIT.md`'s bridge design retained as the accepted
forward design with no implementation. Do not describe V1 as "Claude Code and Codex operate
Database Studio" when they demonstrably cannot. An honest, tested in-app agent surface is a real
feature; a claimed external bridge that does not exist is the fake completion the mission forbids.

---

## Evidence

All commands run from the repository root on Windows, at commit `a308edd`.

**Repository state**

```
$ git rev-parse HEAD
a308edd3dfd6439cd90b89e95de9a4768e68cf5f

$ git log --oneline -8
a308edd Fix-dbstudio-fixture-formatting
e6aae3e docs(dbstudio): record pre-mission baseline (reviewer)
9d01743 fix(dbstudio): scope B14 scan to source files so the harness stops self-matching
685cbf2 dbstudio(WP3): UI genome audit + UI-SPEC.md
569cb5a docs(dbstudio):define-architecture-contracts
d12d366 Add-dbstudio-discovery-fixtures
5e20142 docs(dbstudio):audit-agent-integration-path
9544755 docs(dbstudio): add binding test-naming contract for scoreboard checks
```

Working tree at review time: `.jcode/dbstudio/{BASELINE,STATUS}.md` and `status.json` modified,
plus untracked marketing assets. No implementation files modified — consistent with the plan's
"no implementation before Gate 1".

**DDL applied verbatim to real SQLite** (the SQL block was extracted programmatically from
`CONTRACTS.md` section 7, not retyped, so this is the exact contract text):

```
APPLY: ok
user_version = 28
schema_migrations = [(28,)]
PROBE1 duplicate (id,snapshot,NULL rev): INSERT SUCCEEDED -> PK does not constrain
PROBE2 duplicate (id,NULL snapshot,rev): INSERT SUCCEEDED -> PK does not constrain
database_objects rows after duplicate attempts = 4
PROBE3 duplicate edge tuple with NULL revision: INSERT SUCCEEDED -> UNIQUE does not constrain
PROBE4 duplicate layout with NULL snapshot: INSERT SUCCEEDED -> two layouts for one revision
PROBE5 object referencing nonexistent revision id: accepted (no FK on design_revision_id)
PROBE6 after snapshot delete, remaining objects = 3
PROBE7 database_designs.head_revision_id has FK? -> [(0,0,'database_snapshots','base_snapshot_id','id','NO ACTION','NO ACTION','NONE'), (1,0,'database_sources','source_id','id','NO ACTION','CASCADE','NONE')]
PROBE8 indexes created = ['idx_database_sources_repository','idx_database_evidence_source','idx_database_snapshots_source_layer','idx_database_objects_snapshot_kind','idx_database_objects_revision_kind','idx_database_edges_source_object','idx_database_edges_target_object','idx_database_provenance_object','idx_database_designs_source','idx_database_issues_source_status','idx_database_usage_object','idx_database_usage_path']
```

`PRAGMA foreign_keys=ON` was set for this run, matching `database/mod.rs:58`.

**Transaction and fix verification**

```
PROBE9 user_version inside tx (before rollback) = 28
PROBE9 user_version after ROLLBACK = 0 -> the pragma IS transactional and rolls back with the DDL
PROBE9 table t survived rollback? -> False
PROBE10 sentinel duplicate: rejected -> UNIQUE constraint failed: objs_fixed.id, objs_fixed.snapshot_id, objs_fixed.design_revision_id -> NOT NULL sentinel fixes it
PROBE11 second writer at same revision_number: rejected -> UNIQUE constraint failed: revs.design_id, revs.revision_number -> raw constraint error, NOT the typed DATABASE_DESIGN_STALE_REVISION
PROBE12 revision before design: rejected -> FOREIGN KEY constraint failed
PROBE12 design-first ordering works because head_revision_id has no FK
```

**Identity algorithm, implemented literally from `CONTRACTS.md:58-64`**

```
public.events id = db:table:k3hkmm2sh6dxvvh64lucpzjove
audit.events  id = db:table:ynh5qktwvoma3te6xiu37d732f
PROBE-A distinct across schemas -> True
PROBE-B same-named columns distinct -> True
users    id = db:table:atweuyguinxldhfvpim7igpucz
accounts id = db:table:kguncazfqzvurypgenow4oriio
PROBE-C rename keeps identity -> False (rename = drop + add for every name-keyed adapter)
PROBE-D proposed-layer rename keeps identity -> False
```

`public.events` vs `audit.events` separation is **correct** — the namespace logical key is inside
the hash input, so the `duplicate_table_names` fixture
(`src-tauri/tests/fixtures/database_studio/duplicate_table_names/schema.sql:4,10`, which declares
`public.events` with a `uuid` PK and `audit.events` with a `bigint` PK) resolves to two distinct
objects, and their same-named `id` columns are also distinct. That requirement is satisfied.
Rename tolerance is not.

**Capability id invariants, checked against the real assertions at `registry.rs:174-201`**

```
PROBE-E ids_are_unique_and_dotted: duplicates = none | undotted = none | verdict = PASS
PROBE-F read_capabilities_are_not_mutating_and_writes_are asserts only about file.read/file.write -> database.* cannot break it: PASS
proposed descriptor count = 21 | total registry size would be 27
```

**Contract vs audit capability drift** (machine-diffed):

```
in AUDIT but not in CONTRACTS (23): add_constraint, add_enum, analyze_design, compare_designs,
  compare_target_to_database, compare_target_to_repository, create_design,
  create_implementation_plan, get_active_design, get_canvas_state, get_design_revision,
  get_impact, get_provenance, get_relationships, get_selection, get_table, inspect_project,
  modify_column, remove_column, remove_relationship, remove_table, search, validate_design
in CONTRACTS but not in AUDIT (11): alter_column, approve_design, archive_design, compare,
  drop_column, drop_table, get_context_pack, get_issues, get_object, introspect, reject_design
```

**Agent bridge search**

```
$ search Paralith-tauri for  mcp-config|mcpServers|mcp_servers|--mcp|modelcontextprotocol|tool_server
0 matches in 0 files

$ search Paralith-tauri for  orchestrator_execute_capability|allowedTools|permission-prompt-tool|--mcp-config|stdio
src-tauri/src/commands/orchestration_commands.rs:85  fn orchestrator_execute_capability
src-tauri/src/lib.rs:670                             commands::orchestrator_execute_capability
src-tauri/src/services/swarm_service.rs:229          "--allowedTools"
src-tauri/src/services/swarm_service.rs:234          "--disallowedTools"
src/features/orchestrator/api.ts:40                  invoke('orchestrator_execute_capability')
scripts/release/build-edition.mjs:25                 stdio: 'inherit'   (unrelated)
```

**Credential store search**

```
$ search Paralith-tauri/src-tauri/src for  keyring|credential_store|DPAPI|CredWrite|secret_service
services/repository_service.rs:947  (comment) "GitHub API access is delegated to the authenticated
                                     gh CLI keyring entry; no token is exposed to PARALITH."
```

One comment. No credential abstraction. `Cargo.toml:20-45` contains no keyring, no `sqlx`, no
`tokio-postgres`, no `mysql` crate.

**Files read for verification (not modified):** `orchestration/registry.rs` (full),
`orchestration/policy.rs` (full), `orchestration/kernel.rs:291-411`,
`orchestration/model.rs:300-395`, `database/migrations.rs:770-970, 2195-2250, 2320-2400,
2400-2520, 2620-2700`, `database/mod.rs:44-118`, `services/swarm_service.rs:185-300`,
`agents/adapter.rs:1-140`, `Cargo.toml`, `.jcode/dbstudio/scoreboard.mjs` (full),
`tests/fixtures/database_studio/duplicate_table_names/schema.sql`.

**Not run:** `cargo test`, `cargo check`, `npm run test`. Gate 1 reviews documents against
existing source; no mission code exists yet to compile, and the pre-mission baseline at `569cb5a`
(269 rust / 544 vitest, all green) is already recorded in `BASELINE.md` and is unchanged by the
two doc/fixture commits since. I did not re-measure it and do not claim to have.

---

## Verdict rationale

Approving this would put three mechanically-proven defects into the foundation that WP2, WP3, and
WP4 all build on, at the exact moment when they are nearly free to fix.

Findings 1 and 2 are not theoretical. I executed the contract's own SQL and inserted the rows it
forbids. Every layer above the persistence tables — the diff engine, the zero-delta pipeline
assertion, the layout concurrency token, the LOD queries — assumes uniqueness that the schema does
not provide. Discovering this after WP2 ships means a second migration and a data repair on
installed databases.

Finding 3 is worse in product terms. The mission's headline flows are agents creating and editing
designs, and rename is among the most common operations. Under the specified algorithm, a rename
destroys the object's identity, and with it the selection, layout pins, issue links, and usage
references keyed to that id. Flow 3's "semantic structural comparison, NOT text comparison" would
report drop+add, which is what a text diff reports. The fix — synthetic ids in the Proposed layer —
is a paragraph in the contract and simpler than what is written now.

Findings 4 and 5 would each surface as a failing scoreboard check (B8's exact stale error, B10's
`selection` substring) rather than as an architectural surprise, but both are cheaper to fix in the
contract than in two specialists' code.

Against that: the architecture is genuinely well-founded and I want to be clear that this rejection
is narrow. It reuses the correct existing systems instead of building parallel ones, its
Declared/Observed/Proposed separation is right, its security boundaries are thought through, its
JSON usage passes the mission's typed-ness bar (with one added version column), its DDL is truly
additive and safe against an installed v27, its indexes are all justified by stated access
patterns, its capability ids provably do not break the shipped registry tests, and the Builder's
uncomfortable finding about the missing agent bridge is correct and was not hidden. This is a
document worth fixing, not restarting.

**Re-review scope:** findings 1, 2, 3 (blockers) and 4, 5, 6, 7 (majors) plus the V1 scope table
below. Findings 8, 9, 10 may be folded into the same revision. I will re-review only the changed
sections.

---

## REQUIRED V1 SCOPE

The mission forbids mock-only features. `CONTRACTS.md` currently promises more than can be built to
production quality here, and the honest response is to cut it now. The coordinator must record this
cut in `CONTRACTS.md` as an explicit table, so a deferred item is a stated decision rather than a
specialist's later stub.

### KEEP — Tier 1, must be production quality and fully tested

| Area | Why it stays |
| --- | --- |
| Canonical semantic model + typed edges (`CONTRACTS.md` §2, §2.1) | The whole feature's spine. |
| Qualified identity **with finding 3's synthetic Proposed-layer ids** | Everything keys off it. |
| Migration 28 **with findings 1, 2, 8, 9 applied** | Foundation; expensive to change later. |
| Declared extraction: **Prisma, Drizzle, raw SQL** | The mission's named V1 schema systems; static file parsing only, no new crates. |
| Monorepo evidence resolution (§5) | The north-star example. Fixtures already exist. Highest product value per unit of work. |
| Immutable design revisions + CAS **with finding 4's mandated statement order** | Flows 1-4 depend on it; B8 checks it. |
| Semantic structural diff (§3) incl. formatting-only-empty | B9; distinguishes this from a text diff. |
| Deterministic health rules (missing PK, FK type mismatch, broken reference, duplicate index, destructive proposed change) | Mission explicitly forbids LLM detection here; these are pure functions over the graph. |
| `database.*` descriptors + `CapabilityDomain::Database` + DESIGN_ONLY/IMPLEMENT_DESIGN enforcement in `policy::evaluate` | B10. The genuinely novel, security-critical piece. |
| Canvas state publish + `get_canvas_state`/`get_selection` (finding 5) | Flow 5; currently missing from the contract entirely. |
| Bounded context packs (§11) | Prevents the 400-table prompt dump. |
| UI: Overview, Diagram, Explorer, Inspector, Design mode, Changes, Health, with LOD and off-render-path layout | B4, B5, B6, B13. |
| Tauri commands/events for all of the above | The frontend/backend seam. |
| Security tests: no credential persisted, no auto-connect (asserting on **row contents**) | B12. |

### KEEP, REDUCED — Tier 1.5

| Area | Reduction |
| --- | --- |
| SQLite Observed introspection | Keep. Read-only file open via the already-present `rusqlite`. No credential store, no new crate, no network. This gives a real, honest Declared↔Observed drift demo. |
| Implementation pipeline (§5 of the audit) | Keep stages 1-7 (resolve target → detect adapter → extract declared → semantic delta → risk classification → native change plan → authorization gate) and stages 13-14 (re-extract, zero-delta compare) for the **Prisma and raw SQL** adapters only. Defer Drizzle generation. Keep stages 8-9 (edit + generate migration) **only** with finding 7's command allow-list written down first. |
| Code usage / impact | Keep only import/definition evidence with an explicit `EvidenceCertainty`. Do not attempt full read/write query analysis. |

### DEFER — Tier 2, explicitly out of V1, stated in CONTRACTS.md, not stubbed

| Deferred | Reason | What to do instead |
| --- | --- | --- |
| **PostgreSQL / MySQL network introspection** | No driver crate, no connection pool, no credential store (finding 6). Requires `AGENTS.md` dependency review. | Remove `postgres`/`mysql` from the V1 registered adapter table. Keep the trait so adding them later needs no engine change. |
| **OS credential store + `database_test_connection` + network `database_introspect`** | Same. A stub here is a lie in the UI. | Ship the commands as absent, not as failing stubs. `DatabaseCredentialLease` stays as unimplemented contract. |
| **External Claude Code / Codex MCP bridge** | Independently confirmed not to exist (finding 11). Security-critical, sits outside all declared ownership boundaries, provider flag shapes unverified. | State clearly: V1 agent operability = in-app orchestrator only. Keep `INTEGRATION-AUDIT.md:92-102` as the accepted forward design. Do not claim external agents can operate Database Studio. |
| **Git-revision ↔ Git-revision schema comparison** | Needs a guarded non-checkout blob reader that `ARCHITECTURE.md:126` admits may not exist. | Drop `GitRevisions` from `DatabaseComparisonMode` in V1, or leave the variant and have it return a typed `not supported in this version` error. Not a silent empty diff. |
| **Live/dev database mutation, migration application, production apply** | Mission already forbids production apply; local apply needs the deferred connection layer. | Pipeline stage 12 (safe local verification) is deferred with it. Zero-delta verification is against **re-extracted Declared state**, which is achievable and still real evidence. |
| **`database.analyze_design`, `get_impact`, `compare_target_to_database`** | Depend on deferred layers or on non-deterministic analysis. | List as deferred in the descriptor table with the reason. |
| **Drizzle native change generation** | Editing TypeScript AST safely is materially harder than editing `schema.prisma` or emitting SQL. | Drizzle keeps detect + declared extraction + migrations + validate + diff. `generate_change: false` for V1. |

### Consequence for the scoreboard

This cut is compatible with all 14 checks. B7 keeps all seven discovery fixtures (all static file
analysis). B11's zero-delta assertion holds against re-extracted Declared state for Prisma and raw
SQL. B12 gets *stronger*, because "no credentials persisted" is trivially and permanently true when
there is no credential path at all. Only the pipeline's Drizzle case and the Observed-network path
leave the V1 surface, and neither is a scoreboard check.

The result is a Database Studio that genuinely does: discover databases across a monorepo, resolve
one logical database from scattered evidence, render and explore a real semantic graph, let humans
and in-app agents create versioned design drafts with real optimistic concurrency, compare them
semantically, detect deterministic health problems, and drive an approved Prisma or SQL design into
the repository with re-extracted zero-delta proof. That is a real product. It is a better outcome
than a wider surface where a third of the buttons return "not supported".

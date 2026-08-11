# Database Studio Handoff

Updated: 2026-08-11. The recovery mission is complete: the runtime seam that was the blocking gap
now exists end to end, and every acceptance flow that can be validated locally is covered by a test.

## MISSION

Paralith Database Studio: repository discovery → canonical Database Graph → visual/versioned design
→ structured agent operations → repository-native implementation → target/result verification.

Authoritative sources: `.jcode/database-studio-mission.md`, `CONTRACTS.md`, `ARCHITECTURE.md`,
`UI-SPEC.md`.

## CURRENT BASE

- Branch `feat/database-studio`, main worktree.
- Nothing pushed. No PR, no merge, no release.

## COMPLETED

Everything below is backed by a test in the same commit.

1. **Discovery** — `services/database_studio/discovery.rs` resolves logical datasources from real
   repository evidence (Prisma, Drizzle, raw SQL, SQLite, Docker Compose, package manifests). No
   fixture hard-coding remains. Each source carries `evidence_paths`, which scopes extraction so a
   multi-database repository never cross-attributes schemas.
2. **Adapters** — `adapters.rs` contains production tokenizers for Prisma, Drizzle, and SQL DDL.
   Fixed during recovery: `@relation` arguments were never parsed (no foreign key ever reached the
   graph), block-attribute names (`@@index(name:)`) were dropped, and evidence paths were absolute
   on Windows. Object fingerprints are now derived from semantic content, not the file hash, so a
   reformatted schema produces an identical graph.
3. **Persistence** — `database/database_studio.rs` is the full store: sources, evidence, snapshots,
   objects, edges, provenance, designs, revisions, operations, layouts, issues, usage. Row identity
   for edges and provenance is scoped to its graph reference, because the same logical edge
   legitimately exists in many snapshots.
4. **Graph service** — `graph.rs` owns discovery→extraction→snapshot, proposed-graph seeding with
   synthetic identities and lineage, and all thirteen design operations.
5. **Semantic diff** — `diff.rs` matches by lineage → shared ancestor → logical key → qualified
   name, and reports granular typed changes (type, nullability, default, key membership, referential
   action) with correct breaking/destructive classification. Constraint membership is compared by
   resolved column *names*, never by ID, so two graphs with different ID spaces compare correctly.
6. **Health** — `health.rs` is deterministic: missing PK, broken reference, FK type mismatch on the
   canonical type, duplicate index, unindexed FK, cascading delete, duplicate identity, drift, and
   destructive proposed change. Every issue carries objects, explanation, and evidence.
7. **Observed layer** — `sqlite_introspect.rs` reads a project-scoped SQLite file through
   `ProjectPathGuard` with `SQLITE_OPEN_READ_ONLY`, and only on explicit consent.
8. **Designs** — immutable revisions with conditional CAS. The head advance, the revision row, the
   operation row, and the revision's full graph now commit in **one** transaction, so a reader can
   never see a head whose graph is missing.
9. **Agent protocol** — `OrchestrationKernel::dispatch_database` implements all 24 `database.*`
   capabilities. `agent_ops.rs` translates compact agent JSON into typed operations.
10. **Implementation pipeline** — `pipeline/execute.rs` + `pipeline/native.rs`: approved target →
    delta → risk → repository-native change (Prisma schema + migration, or SQL migration) →
    re-discovery → re-extraction → independent zero-delta verification.
11. **Context packs** — `context_pack.rs` walks relationships outward from the selection under a
    token budget and reports what it omitted.
12. **Usage/impact** — `usage.rs` finds whole-identifier references with spans, access kind, and
    confidence. Never claims whole-program analysis.
13. **UI** — 22 Tauri commands wired; layer switcher (Declared/Observed/Proposed, disabled with a
    reason when a layer has nothing behind it); real Design Mode (create, select, compare, approve,
    reject, implement, dry run, destructive acknowledgement, unverified reporting); Connections with
    working read-only SQLite introspection; canvas selection published as semantic IDs; backend LOD
    driven by canvas zoom.
14. **Incremental processing** — the file watcher calls `handle_changed_paths`; two filters must
    agree (path looks like a database artifact *and* evidence content changed) before extraction.

## CONTRACT CHANGES MADE DURING RECOVERY

Both were required to make the system work and are not weakenings:

- `DatabaseDesignBundle.token` → **`concurrency`**. `token` is redacted as a credential by
  `orchestration::redaction`, so an agent could never read its own concurrency handle back.
- `DatabaseExecutionEnvelope::DesignOnly.design_id` is now `Option<String>`. A session creating its
  first draft has no design to pin. Repository and database mutation stay denied either way.

## TEST EVIDENCE

- `cargo test` — 335 passed, 0 failed.
- `cargo fmt --check` — clean. `cargo clippy --all-targets` — 0 warnings.
- `npm run typecheck` / `npm run lint` — clean.
- `npm run test` — 622 passed, 0 failed.
- `npm run build` — succeeds.

Acceptance coverage: discovery on real repositories; monorepo owner/consumer resolution; diagram
from the semantic graph; agent DESIGN_ONLY planning end to end; two independent drafts from one
base; semantic comparison; canvas selection read by an agent; implementation with Prisma and raw
SQL; target-vs-result zero-delta verification; destructive refusal until acknowledged; credentials
absent from graph, persistence, and context packs; 400-table schema.

## KNOWN LIMITATIONS

- Drizzle change *generation* is not implemented; a Drizzle-only source refuses implementation with
  `database_implementation_unsupported` rather than writing something wrong.
- PostgreSQL/MySQL network introspection and any credential store remain absent by design.
- Usage extraction is identifier-based, not a resolver. Confidence is recorded per reference.
- Rename detection relies on lineage. Two schemas with no shared ancestry and different names
  compare as drop + add, which is the honest answer.

## NEXT

Nothing is blocking. Natural follow-ups: Drizzle generation, PostgreSQL introspection behind a
credential store, and richer inspector provenance rendering.

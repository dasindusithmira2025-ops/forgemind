verdict: APPROVED
commit: 863d5c9e8c5d1d36398423d8f225fb8822e379f9
gate: 1
reviewed: .jcode/dbstudio/CONTRACTS.md, .jcode/dbstudio/ARCHITECTURE.md (remediation of the REJECTED verdict at eb0ed15), verified against Paralith-tauri/src-tauri/src/{database/migrations.rs, orchestration/registry.rs}, plus an executable SQLite probe of the remediated DDL

# GATE 1 (re-review) — Architecture and domain contracts

Re-review performed by the root coordinator (Opus 5) after the assigned re-review session was
interrupted before it could commit a verdict. The original REJECTED verdict and its full findings
are preserved in git history at `eb0ed15` and remain the authoritative record of what was wrong.

**Verdict: APPROVED.** All 3 blockers and 4 majors are resolved. The 2 minors are resolved. Two
carry-forward items are recorded below for later gates.

Approval discipline note: the original rejection was proven with executable SQLite probes rather
than asserted, so the fix is verified the same way rather than accepted on reading. The probe is
committed at `.jcode/dbstudio/verify-gate1-ddl.mjs` and is re-runnable.

## Per-finding resolution

| # | Severity | Finding | Status | Evidence |
| --- | --- | --- | --- | --- |
| 1 | BLOCKER | `database_objects` PK constrained nothing because NULL discriminators are distinct in SQLite | **FIXED** | `CONTRACTS.md:646,654-656`: `snapshot_id`/`design_revision_id` are now `NOT NULL DEFAULT ''` with `CHECK` that exactly one is non-empty. Probe PROBE1: the duplicate insert that previously succeeded is now `REJECTED`. |
| 2 | BLOCKER | Same NULL defect voided `database_edges` and `database_layouts` uniqueness | **FIXED** | `CONTRACTS.md:663,668-669` and the layout table use the same sentinel + CHECK. Probe PROBE4: duplicate edge now `REJECTED`; final row counts are exactly the intended 3 objects / 1 edge. |
| 3 | BLOCKER | Identity made every rename a drop+add for all V1 declared adapters | **FIXED** | `CONTRACTS.md:89`: the Proposed layer now allocates a synthetic name-independent id (`db:<kind>:p_<ulid>`) copied unchanged into descendant revisions; names live only in `qualified_name` and rename never recomputes `id`. `CONTRACTS.md:95` specifies Declared-layer `previous_ids` lineage on proven renames and, critically, now defines the previously unspecified sub-`0.90` behavior: emit a `possible_rename` issue carrying both ids and confidence, keep identities distinct, emit ordinary add/drop, never silently link. `CONTRACTS.md:96` states selection, layout pins, issue refs and usage refs key off the unchanged Proposed id. |
| 4 | MAJOR | CAS lost-update window and nondeterministic stale error | **FIXED** | `CONTRACTS.md:590`: head advance is now a single conditional `UPDATE ... WHERE head_revision_id=:expected_head AND revision_number=:expected_number` with `rows_affected != 1` triggering rollback and a typed error. Read-then-write is gone; statement order is mandated. |
| 5 | MAJOR | Capability drift (21 vs 33 ids); `get_canvas_state`/`get_selection` absent, canvas publishing unowned | **FIXED** | `CONTRACTS.md:20` assigns the WP4-owned publish command with WP3 as caller, and both descriptors now exist. A "deliberately not in V1" table names each deferred mission capability with a reason, so silence is no longer mistaken for deferral. |
| 6 | MAJOR | No OS credential store and no Postgres/MySQL driver crates, making the Observed layer unbuildable | **FIXED (by scope cut)** | `CONTRACTS.md:28` defers Postgres/MySQL network introspection, keeps the trait extension points, and does not register the adapters. Observed is reduced to read-only SQLite file introspection via the already-present `rusqlite`. Connection/introspect commands are V1-absent rather than failing stubs, which removes the "lie in the product surface". |
| 7 | MAJOR | Zero-delta was circular (same adapter writes and reads), and extraction-never-executes contradicted pipeline-must-execute | **FIXED** | `CONTRACTS.md:26` limits the pipeline to stages 1-7 and 13-14 for Prisma and raw SQL, with stages 8-9 permitted only through an explicit §9.1 command allow-list after authorization. The execution boundary is now written down instead of contradictory. |
| 8 | MINOR | Missing FK on `design_revision_id` | **FIXED** | `CONTRACTS.md:647-648`: generated columns `snapshot_ref`/`design_revision_ref` (`NULLIF(col,'')`) carry the FKs. Probe PROBE5 confirms this form actually enforces referential integrity: an object referencing a missing snapshot is `REJECTED` under `PRAGMA foreign_keys=ON`. This was the highest-risk part of the remediation, since a generated-column FK could have been silently inert. |
| 9 | MINOR | Schema version bump alone insufficient; `requires_migration` must learn the new tables | **FIXED** | `CONTRACTS.md:611` requires adding the `!table_exists(connection, "database_sources")?` predicate to `requires_migration`, matching the shipped `swarm_context_packs` pattern, plus an installed-schema upgrade preservation test, and forbids editing `migrate_v1..v27`. |
| 11 | INFO | Agent bridge does not exist | **ACCEPTED, SCOPED** | V1 agent operability is stated as in-app orchestrator only. The MCP transport design in `INTEGRATION-AUDIT.md` is retained as labeled future direction. No claim of external Claude/Codex operability remains. |

## Evidence

`node .jcode/dbstudio/verify-gate1-ddl.mjs` against the remediated DDL:

```
[allowed]  PROBE1 first object insert (should be allowed)
[rejected] PROBE1 duplicate object, same snapshot (MUST be rejected)
[allowed]  PROBE2 same id in a different snapshot (should be allowed)
[allowed]  PROBE2 same id in a design revision (should be allowed)
[rejected] PROBE3 both discriminators set (MUST be rejected)
[rejected] PROBE3 neither discriminator set (MUST be rejected)
[allowed]  PROBE4 first edge (should be allowed)
[rejected] PROBE4 duplicate edge (MUST be rejected)
[rejected] PROBE5 object referencing a missing snapshot (MUST be rejected)

rows: database_objects=3 (expected 3), database_edges=1 (expected 1)

blocker fixes: VERIFIED
```

The probe deliberately asserts in both directions: the illegal inserts are rejected **and** the
three legitimate cases (same id in another snapshot, same id in a design revision, first edge)
still succeed. A constraint that rejected everything would be just as broken as one that rejected
nothing.

## Verdict rationale

The remediation fixed causes, not symptoms. The sentinel-plus-CHECK approach puts the invariant in
the database rather than in application code, which is what the original finding demanded. The
synthetic Proposed id is the correct structural answer to the rename problem: it separates identity
from naming in exactly the layer where the mission's flows operate, so a rename can no longer
invalidate selection, layout, and issue references at once, and Flow 3 can report a rename instead
of the forbidden text-diff-equivalent drop/add.

The scope cut is accepted in full and is now normative in `CONTRACTS.md` §0. This is the single
most valuable outcome of GATE 1: the mission forbids mock-only features, and the contract now
states plainly what is out of V1 rather than leaving a specialist to ship a stub later.

## Carry-forward items for later gates

1. **GATE 2** must verify the implemented `migrate_v28` matches this DDL exactly, including the
   generated-column FKs, and that `requires_migration` learned the new tables. Contract correctness
   does not imply implementation correctness.
2. **GATE 6** must verify the §9.1 pipeline command allow-list is enforced in code, not merely
   documented, and that zero-delta verification is not self-certifying.

## Consequence

Implementation is UNBLOCKED. WP2 (Backend) and WP3 (UI) may begin in parallel against these
contracts. WP4 (Builder) may begin the command/capability surface. All specialists must implement
the Tier 1 / Tier 1.5 scope only; Tier 2 items must not be stubbed.

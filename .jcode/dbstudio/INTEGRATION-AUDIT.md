# Database Studio WP4 Integration Audit

Status: contract-independent audit completed before Gate 1. This document records the existing machinery WP4 must extend. It does not supersede `.jcode/dbstudio/CONTRACTS.md`, which was not present when this audit was written.

## Executive finding

Paralith already has the correct privileged capability gateway, policy gate, audit trail, redaction boundary, project binding, Tauri command pattern, event stream, agent process runtime, swarm context packs, and repository concurrency controls. Database Studio must extend those systems rather than create a parallel protocol.

The important gap is transport: the in-app React frontend can invoke `OrchestrationKernel`, but the Claude Code and Codex CLI processes launched by the swarm runtime cannot. They receive a text prompt and ordinary CLI filesystem/shell permissions. No MCP, stdio RPC, local authenticated socket, or other bridge currently routes an external provider tool call to `orchestrator_execute_capability`.

## 1. `database.*` capabilities in the existing registry and kernel

### Existing pattern to preserve

`CapabilityDescriptor` is the stable allow-list record. Its exact current shape includes the dotted stable `id`, `CapabilityDomain`, JSON `arg_schema`, `requires_project_scope`, `risk`, `reversibility`, `mutates`, timeout, audit flag, and availability metadata (`orchestration/registry.rs:19-47`). The registry explicitly says models may select an ID and propose arguments but may not construct shell commands or call internal functions directly (`orchestration/registry.rs:1-8`).

The existing write pattern is `file.write`:

- object schema with `required` and `properties` (`orchestration/registry.rs:137-152`);
- project scope required (`orchestration/registry.rs:153`);
- `RiskLevel::Medium`, `Reversibility::ViaGit`, `mutates: true` (`orchestration/registry.rs:154-157`);
- typed canonicalization in `validate_arguments`, including dropping extra keys (`orchestration/kernel.rs:617-640`);
- one dispatch arm that calls a real service after validation and policy (`orchestration/kernel.rs:462-515`).

Every Database Studio entry must therefore be a `CapabilityDescriptor` in `registry.rs`, use JSON object schemas in the same `json!({ "type": "object", "required": [...], "properties": {...} })` style, receive a dedicated typed validation arm in `kernel.rs`, and dispatch to the WP2 Database Studio service. Adding schema metadata without typed validation is insufficient because `arg_schema` currently documents/drives UI hints while the gateway performs the actual validation (`orchestration/registry.rs:29-31`).

`CapabilityDomain` currently has no Database variant (`orchestration/model.rs:364-381`). Gate 1 must authorize adding `CapabilityDomain::Database`; using `Files`, `Projects`, or another unrelated domain would misrepresent policy and UI grouping.

### Proposed descriptor classification

All entries below are project-scoped, audited, available only when the Database Studio service is constructed, and return redacted structured JSON. Reads use `Low / NotApplicable / mutates=false`. Proposed-design writes use `Medium / Paired / mutates=true`: they change authoritative Database Studio design state but are reversed by creating or selecting a compensating immutable revision, not by rewriting history. Repository-native implementation must be a separate capability with `High / ViaGit / mutates=true`. Production database application, if ever exposed, must be a separate `Critical / None / mutates=true` capability and is outside automatic implementation authorization.

| Capability | Required argument schema fields | Risk / reversibility / mutates |
| --- | --- | --- |
| `database.list_sources` | none | Low / NotApplicable / false |
| `database.inspect_project` | optional `forceRefresh:boolean` | Low / NotApplicable / false |
| `database.get_schema` | `sourceId`, `schemaId`; optional `snapshotId` | Low / NotApplicable / false |
| `database.get_table` | `sourceId`, `objectId`; optional `revisionId` | Low / NotApplicable / false |
| `database.search` | `query`; optional `sourceId`, `revisionId`, `kinds[]`, `limit` | Low / NotApplicable / false |
| `database.get_relationships` | `objectId`; optional `revisionId`, `direction` | Low / NotApplicable / false |
| `database.get_provenance` | `entityId`; optional `revisionId` | Low / NotApplicable / false |
| `database.get_active_design` | optional `sourceId` | Low / NotApplicable / false |
| `database.get_design_revision` | `designId`, `revisionId` | Low / NotApplicable / false |
| `database.get_canvas_state` | none | Low / NotApplicable / false |
| `database.get_selection` | none | Low / NotApplicable / false |
| `database.create_design` | `name`, `sourceId`; optional `baseSnapshotId` | Medium / Paired / true |
| `database.create_draft` | `designId`, `baseRevisionId`, `name`; optional `agentRunId` | Medium / Paired / true |
| `database.compare_designs` | `leftRevisionId`, `rightRevisionId` | Low / NotApplicable / false |
| `database.add_table` | `designId`, `expectedHeadRevisionId`, `expectedRevisionNumber`, `table` | Medium / Paired / true |
| `database.remove_table` | `designId`, stale-write tokens, `tableId` | Medium / Paired / true |
| `database.rename_table` | `designId`, stale-write tokens, `tableId`, `newName` | Medium / Paired / true |
| `database.add_column` | `designId`, stale-write tokens, `tableId`, `column` | Medium / Paired / true |
| `database.modify_column` | `designId`, stale-write tokens, `columnId`, `patch` | Medium / Paired / true |
| `database.remove_column` | `designId`, stale-write tokens, `columnId` | Medium / Paired / true |
| `database.add_relationship` | `designId`, stale-write tokens, `relationship` | Medium / Paired / true |
| `database.remove_relationship` | `designId`, stale-write tokens, `relationshipId` | Medium / Paired / true |
| `database.add_index` | `designId`, stale-write tokens, `tableId`, `index` | Medium / Paired / true |
| `database.add_constraint` | `designId`, stale-write tokens, `tableId`, `constraint` | Medium / Paired / true |
| `database.add_enum` | `designId`, stale-write tokens, `enum` | Medium / Paired / true |
| `database.validate_design` | `revisionId`; optional `ruleset` | Low / NotApplicable / false |
| `database.analyze_design` | `revisionId`; optional `analysisKinds[]` | Low / NotApplicable / false |
| `database.get_usage` | `entityId`; optional `revisionId` | Low / NotApplicable / false |
| `database.get_impact` | `revisionId`; optional `entityIds[]` | Low / NotApplicable / false |
| `database.compare_target_to_repository` | `targetRevisionId`; optional `repositorySnapshotId` | Low / NotApplicable / false |
| `database.compare_target_to_database` | `targetRevisionId`, `sourceId`; explicit connection reference only | Low / NotApplicable / false |
| `database.create_implementation_plan` | `targetRevisionId`, `expectedRepositoryHead`; optional `adapterId` | Low / NotApplicable / false |
| `database.implement_design` | `approvedTargetRevisionId`, `planId`, `expectedRepositoryHead`, `expectedBranch`, `authorizationId` | High / ViaGit / true |

The mission's suggested list stops at plan creation, but Flow 6 requires a controlled execution entry point. `database.implement_design` is the smallest honest capability for the pipeline. It must not be hidden inside `create_implementation_plan`, because planning is non-mutating while native edits and migration generation mutate the repository and require a different gate.

### Project scope enforcement

The project is not accepted from capability arguments. It is bound to the orchestration session. `list_capabilities` marks project-scoped descriptors unavailable if the session lacks a project (`orchestration/kernel.rs:268-288`), and `execute_capability` refuses before validation or dispatch when `requires_project_scope` is true and the session has no project (`orchestration/kernel.rs:319-341`). Dispatch then obtains the project exclusively through `session_project(session)` (`orchestration/kernel.rs:593-602`), as existing `workspace.list`, `file.read`, and `file.write` do (`orchestration/kernel.rs:475-478`, `497-514`).

Database arguments must carry only IDs belonging to that bound project. The Database Studio service must resolve every source, design, revision, canvas, and selection using both `session.project_id` and the supplied semantic ID. A globally valid revision ID from another project must return a scope/not-found error. This mirrors swarm context packs, whose SQL filters memories and provenance sources by the owning project (`database/swarm.rs:323-370`).

### Gateway order and audit behavior

The existing gateway order is the required order: session and descriptor lookup, availability/project scope, typed argument validation, policy evaluation, persisted running execution, dispatch, output redaction, persisted terminal state, then timeline event (`orchestration/kernel.rs:291-390`, `393-459`). Inputs are redacted before persistence and outputs before persistence/return (`orchestration/kernel.rs:393-426`). Refusals are also persisted with redacted arguments (`orchestration/kernel.rs:529-560`). `redact_json` recursively removes sensitive-key values and scrubs strings (`orchestration/redaction.rs:96-114`), so Database Studio results must never embed credentials under innocuous keys or return raw connection strings in the first place.

## 2. Real Claude Code / Codex to capability path

### What exists today

There are two separate paths:

1. **In-app frontend path, which does reach capabilities.** React calls Tauri `invoke('orchestrator_execute_capability', { request })` (`src/features/orchestrator/api.ts:37-40`). The main-window-only Tauri command calls `state.orchestrator.execute_capability(request)` (`commands/orchestration_commands.rs:74-92`). Commands are re-exported through `commands/mod.rs` (`commands/mod.rs:1-31`) and registered in the app's `generate_handler!` list (`lib.rs:492` onward).
2. **External provider process path, which does not reach capabilities.** `AgentAdapter` only builds an executable, arguments, working directory, and environment for a process (`agents/adapter.rs:5-22`, `93-137`). The swarm runtime constructs Claude CLI arguments with a text prompt, permission mode, and shell test allow-list (`services/swarm_service.rs:188-238`), or Codex CLI arguments with sandbox, working directory, and a text prompt (`services/swarm_service.rs:249-294`). It loads persisted instructions and memory context, builds provider arguments, and launches a terminal process (`services/swarm_service.rs:995-1057`). The prompt contains mission, task, project root, instructions, and bounded memories, but no capability endpoint or tool manifest (`services/swarm_service.rs:1639-1674`).

A repository search found no MCP server/configuration path. The only `mcp` reference is normalization of a Codex event named `mcp_tool_call`; it observes provider output and does not provide a tool bridge. Therefore Claude Code and Codex cannot call Paralith capabilities today. They can only use their own CLI tools against the assigned filesystem/shell sandbox.

### Smallest correct bridge

Add one transport adapter for the existing orchestration protocol, not a Database Studio-specific protocol:

1. A Paralith-owned local stdio MCP server process exposes each available `CapabilityDescriptor` as a tool. It converts MCP tool calls into the existing `ExecuteCapabilityRequest` and calls `OrchestrationKernel::execute_capability` unchanged.
2. The server receives an unforgeable, short-lived launch grant containing `session_id`, `agent_run_id`, project binding, execution mode, expiry, and a random bearer secret through inherited process state or a protected one-use file. It must not trust a caller-supplied project ID.
3. `ProductionAgentRuntime` creates/binds the orchestration session and injects the MCP server configuration into the Claude/Codex launch arguments. This belongs alongside provider launch construction in `services/swarm_service.rs`, while the transport implementation belongs under `orchestration/` because all domains will reuse it.
4. The transport only lists descriptors available to that session and forwards calls to the kernel. It performs no domain dispatch, risk decisions, repository writes, or DB writes itself.
5. On agent termination, the launch grant is revoked. Calls must be attributable to the agent run and appear in the existing capability execution audit.

MCP is preferable to teaching agents to invoke Tauri commands or a bespoke `database.*` JSON protocol. Both Claude Code and Codex already understand tool servers, and this keeps the allow-list, validation, policy, audit, and redaction chokepoints intact. Exact CLI flags/config shape must be verified against the installed provider versions during implementation.

## 3. DESIGN_ONLY and IMPLEMENT_DESIGN enforcement

### Why current operating modes are not enough

Existing `OperatingMode::Observe` denies every descriptor with `mutates=true`, even when `approved=true` (`orchestration/policy.rs:22-33`). That cannot represent DESIGN_ONLY because DESIGN_ONLY must mutate Proposed design revisions while forbidding repository and database mutation. `Assist` also does not encode the distinction: it allows any approved mutation (`orchestration/policy.rs:44-59`, `107-131`). Keyword checks in a prompt or capability name are insufficient because the actual effect occurs after selection; an agent could select `file.write`, a future repository capability, or a misleadingly named capability.

### Required enforcement model

Gate 1 should define a structured Database Studio execution envelope attached to the orchestration session or agent launch grant:

- `DESIGN_ONLY { design_id, base_revision_id? }`
- `IMPLEMENT_DESIGN { approved_target_revision_id, authorization_id, expected_repository_head, expected_branch }`

Each capability must also have a machine-readable effect class used by policy, for example `Read`, `DesignMutation`, `RepositoryMutation`, `DatabaseMutation`. This can be an additive descriptor field or a policy-owned mapping keyed by stable capability ID. A free-form string is not acceptable.

The exact enforcement point is `policy::evaluate`, called by `execute_capability` after typed validation and before the running audit row or dispatch (`orchestration/kernel.rs:343-390`). Database-specific policy must be evaluated there, or by a pure helper called there, with validated arguments and the session's structured execution envelope:

| Mode | Read | Proposed design mutation | Repository mutation | Local/dev DB mutation | Production DB mutation |
| --- | --- | --- | --- | --- | --- |
| DESIGN_ONLY | Allow | Allow, subject to revision CAS | Deny, approval cannot override | Deny | Deny |
| IMPLEMENT_DESIGN | Allow | Allow | Only `database.implement_design`, only for the pinned approved target and valid authorization | Separate explicit step/authorization when required by plan | Deny unless a second production-specific critical authorization exists |

`IMPLEMENT_DESIGN` must reject a caller-supplied target different from the target pinned in the session grant. The current `approved: bool` is only an action-specific gate hint (`orchestration/model.rs:515-527`); it is not sufficient proof of approval identity, target revision, scope, or expiry. The implementation authorization must be persisted and referenced by ID.

The repository phase must also pass through `RepositoryService`, which already requires attributable agent identity, inspected base commit and expected branch (`repository_service.rs:2456-2495`), validates active agent worktree leases (`repository_service.rs:2498-2535`), and rejects changed HEAD/branch (`repository_service.rs:2538-2565`).

### B10 proof tests

Test names intentionally contain scoreboard-required words:

- `database_studio::agent::design_only_allows_design_revision_but_denies_repository_and_database_mutation_even_when_approved`
- `database_studio::agent::implement_design_requires_pinned_approved_target_revision_and_authorization`
- `database_studio::agent::implement_design_rejects_target_revision_substitution`
- `database_studio::agent::selection_is_structured_and_project_scoped`
- `database_studio::agent::design_only_cannot_escape_through_file_write_or_repository_capability`

The first and last tests snapshot and compare the complete repository temp tree (paths plus content hashes) and the relevant SQLite table row sets before and after the denied call. They assert byte-identical repository files, identical persisted database rows, zero migration/DB mutation calls, and an audited denial. This proves the mission requirement rather than merely checking a mode flag. These names follow the binding filter/substrings in `.jcode/dbstudio/TEST-NAMING.md:13-27`.

## 4. Canvas awareness without screenshots or coordinates

The backend remains authoritative for design revisions; the UI owns ephemeral projection state such as selection, focus, viewport visibility, filters, and groups. The UI must publish a typed `DatabaseCanvasState` through the Database Studio command layer whenever semantic state changes. It contains project/source/schema/design/revision IDs, selected table/column/relationship IDs, focused entity ID, visible entity IDs, and active filters/groups. Coordinates, pixels, and screenshots are excluded.

`database.get_canvas_state` and `database.get_selection` then read the most recent state bound to the orchestration session's project and active Database Studio surface. Their results are placed in the agent context through actual capability calls, not copied into a free-form prompt. A selection response should include the revision against which IDs were resolved, allowing stale selection to be rejected after a revision change.

This satisfies the mission's semantic-ID requirement (`database-studio-mission.md:835-856`) and Flow 5's requirement that “these” resolves from structured selection (`database-studio-mission.md:750-764`). It also avoids the ambiguity and accessibility failures of image/coordinate automation.

## 5. Native implementation pipeline

### Ordered pipeline

`database.implement_design` invokes one persisted pipeline run with these stages:

1. **Resolve approved target revision.** Load the immutable revision pinned in the execution authorization. Evidence: revision ID, content hash, approval ID, approver, timestamp, and project.
2. **Inspect repository and detect native adapter.** Static inspection only. Evidence: repository HEAD/branch, detected Prisma/Drizzle/raw SQL source paths, adapter version, and provenance locations.
3. **Extract current Declared schema.** Evidence: immutable repository snapshot/graph ID plus source hashes and diagnostics.
4. **Compute semantic delta.** Structural object/edge operations, not text diff. Evidence: persisted delta with target/current revision hashes.
5. **Classify risk.** Classify destructive operations, nullability tightening, type narrowing, drops, renames, data backfill requirements, and unsupported transforms. Evidence: per-operation risk reasons.
6. **Create repository-native change plan.** Exact files, native operations, migration command, validation commands, rollback path, expected effects. Evidence: persisted plan hash.
7. **Authorization gate.** Stop before any file change unless the authorization covers the same target hash, plan hash, repository HEAD, branch, risk ceiling, and expiry. High/destructive deltas require explicit approval. Production DB application is never implied.
8. **Edit native schema.** Use adapter-native structured edits for Prisma schema, Drizzle TypeScript definitions, or owned SQL files. Repository mutation executes inside the agent's leased worktree and pinned repository state. Evidence: before/after file hashes and native semantic patch.
9. **Generate native migration.** Use repository-declared package manager/tooling and generate files without applying to production. Evidence: command, bounded redacted output, generated file hashes, and parsed migration operations.
10. **Validate.** Parse/type-check/lint native schema and migration; verify migration ordering and unsupported/destructive diagnostics. Evidence: structured validator results, not just exit status.
11. **Run relevant tests.** Evidence: exact commands, test identities/counts, exit codes, and bounded redacted output.
12. **Safe local verification.** Only when the plan explicitly identifies a disposable/local/dev target and authorization covers it. Never auto-connect to a discovered DB. Evidence includes target class, isolation proof, pre/post schema fingerprints, migration ledger, and rollback/cleanup result.
13. **Re-extract result.** Run the same adapter extractor against changed repository state. Evidence: resulting graph ID, source hashes, extractor version, diagnostics.
14. **Compare target versus result.** Semantic comparison must be zero delta. Evidence: persisted comparison report with both revision hashes. Exit code 0 with non-zero semantic delta is failure.

The sequence directly implements Flow 6 (`database-studio-mission.md:768-794`). Stages 1-6 are read/plan work. Stage 7 is the hard authorization boundary. Stages 8-12 are mutating or command-executing steps. Stages 13-14 are mandatory postconditions, not optional reporting.

### Evidence beyond exit code zero

Success requires all of:

- the exact approved target revision/hash was used;
- repository HEAD/branch still match the inspected state;
- adapter detection and extraction provenance are stored;
- generated and edited file hashes match the recorded plan outputs;
- native parser/validator accepts the schema and migration;
- relevant tests report their actual cases/counts;
- any local verification target is proven non-production and isolated;
- re-extraction uses the resulting files, not cached pre-change state;
- target-to-result semantic delta is empty;
- no unexpected repository paths changed;
- audit inputs/results are redacted.

`RepositoryService::execute` already demonstrates the correct prepare/check/policy/record/run ordering (`repository_service.rs:441-525`) and approval records are validated for status and expiry before execution (`repository_service.rs:528-557`). The pipeline should reuse that service rather than run untracked Git mutations.

## 6. Optimistic concurrency and two-agent conflicts

Design drafts are independent branches from immutable revisions. Claude and Codex starting from the same base each receive a distinct `design_id` or draft identity and may advance only their own head. Every mutation includes `expectedHeadRevisionId` and `expectedRevisionNumber`. In one SQLite transaction, the service compares both tokens, appends an operation/new immutable revision, and conditionally advances the head. A mismatch returns a typed stale-revision error and does not silently rebase, overwrite, or partially apply.

This model allows Flow 2's two independent drafts while making same-draft concurrent edits deterministic. Recovery is explicit: reload the current head, compute a semantic three-way comparison from common ancestor, and ask the agent/user to create a new revision with resolved operations. Semantic object IDs, not table-name text, identify conflicts.

When implementation reaches repository mutation, the second concurrency layer is `RepositoryService`: agent operations require an active matching worktree lease (`repository_service.rs:2498-2535`) and pinned HEAD/branch (`repository_service.rs:2538-2565`). The pipeline authorization also pins the target revision and plan hash, so neither design movement nor repository movement can be ignored after approval.

B8 fixtures cover:

- two drafts from one base advance independently;
- stale write to the same draft is rejected and creates no revision;
- immutable prior revision content remains unchanged;
- semantic comparison retains both agents' changes;
- stale repository HEAD rejects implementation before file mutation.

## 7. Backend-to-UI event propagation

Reuse Tauri `AppHandle::emit` plus authoritative reload/reconciliation. The orchestration kernel defines stable event constants and documents snapshot-plus-stream reconciliation (`orchestration/kernel.rs:36-39`), persists timeline events before emitting them (`orchestration/kernel.rs:569-578`), and the frontend subscribes with typed `listen` wrappers (`src/features/orchestrator/api.ts:49-57`). Repository commands similarly emit `repository-state-changed` after operations, demonstrating domain change notification through the same mechanism (`commands/repository_commands.rs:147-178`).

Database Studio should define one typed event such as `database-studio-changed` carrying only reconciliation keys: `projectId`, `sourceId?`, `designId?`, `revisionId?`, `changeKind`, and a monotonic sequence/version. Commands and capability dispatch persist graph/revision changes first, then emit. The UI listener invalidates/reloads the authoritative graph/revision through `src/features/database/api.ts`; it must not apply an event payload as a second authoritative graph. File-driven re-extraction should use the existing project file watcher rather than a new component watcher.

## 8. Test plan for B8, B10, and B11

### Fixture strategy

Use WP2's owned `src-tauri/tests/fixtures/database_studio/**` native fixtures, copied into per-test temporary directories so pipeline edits never alter canonical fixtures. Use in-memory SQLite for design/revision/capability audit state. Provide fake/static adapters for pure policy and revision tests, and real fixture adapters for pipeline tests. Command execution is injected behind the pipeline's narrow runner interface so failure/cancellation cases are deterministic; at least one native-tool integration fixture runs when the repository's test environment supplies that tool.

No fixture contains live credentials. Connection-bearing tests use opaque credential-reference IDs and a fake explicitly authorized local target.

### B8: `cargo test database_studio::design`

Required named tests include `draft`, `revision`, and `stale` in output:

- `database_studio::design::drafts_from_same_revision_are_independent`
- `database_studio::design::revision_is_immutable_after_new_head`
- `database_studio::design::stale_head_write_is_rejected_without_partial_revision`
- `database_studio::design::stale_revision_number_is_rejected_even_when_head_id_matches`
- `database_studio::design::draft_semantic_comparison_uses_object_identity`

Assertions inspect persisted row counts, unchanged hashes, head pointers, and typed error codes.

### B10: `cargo test database_studio::agent`

Required scoreboard substrings appear in test names:

- `database_studio::agent::design_only_allows_design_revision_but_denies_repository_and_database_mutation_even_when_approved`
- `database_studio::agent::implement_design_requires_pinned_approved_target_revision_and_authorization`
- `database_studio::agent::implement_design_rejects_target_revision_substitution`
- `database_studio::agent::selection_is_structured_and_project_scoped`
- `database_studio::agent::selection_revision_mismatch_is_rejected`
- `database_studio::agent::design_only_cannot_escape_through_file_write_or_repository_capability`

Assertions inspect dispatch counters, temp-tree hashes, DB mutation spies, audited refusal records, redaction, cross-project ID rejection, and the exact target revision reaching the pipeline.

### B11: `cargo test database_studio::pipeline`

- `database_studio::pipeline::approved_prisma_target_generates_native_change_and_reextracts_to_zero_delta`
- `database_studio::pipeline::approved_drizzle_target_generates_native_change_and_reextracts_to_zero_delta`
- `database_studio::pipeline::approved_sql_target_generates_migration_and_reextracts_to_zero_delta`
- `database_studio::pipeline::exit_zero_with_nonzero_semantic_delta_fails`
- `database_studio::pipeline::repository_head_change_aborts_before_native_edit`
- `database_studio::pipeline::destructive_delta_stops_at_authorization_gate`
- `database_studio::pipeline::production_database_is_never_applied_by_implementation_authorization`
- `database_studio::pipeline::unexpected_changed_path_fails_evidence_validation`
- `database_studio::pipeline::failed_validation_preserves_evidence_and_does_not_claim_success`

The happy-path assertion is approved target → planned native files/migration → validator/test evidence → re-extracted result → empty structural delta. Negative tests assert no downstream stage ran after the failing gate.

## Contract decisions required at Gate 1

WP4 implementation is blocked until `.jcode/dbstudio/CONTRACTS.md` is approved. It must settle:

1. the canonical semantic IDs and exact argument/result DTOs for every descriptor;
2. addition of `CapabilityDomain::Database`;
3. where the structured DESIGN_ONLY/IMPLEMENT_DESIGN envelope is persisted;
4. descriptor effect classification and the policy function signature needed to enforce it;
5. implementation authorization record shape and target/plan/repository pins;
6. canvas-state ownership, persistence/lifetime, and command/event names;
7. revision CAS error codes and transaction contract;
8. pipeline adapter/runner interfaces and evidence DTOs;
9. the external-agent MCP launch grant and provider configuration contract.

No implementation file should be edited before those decisions and Gate 1 approval.

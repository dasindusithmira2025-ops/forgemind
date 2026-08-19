# ADR 005: Domain ownership and compatibility names

Status: accepted for Generation 0
Date: 2026-08-18

## Context

The live schema mixes Project/Workspace/terminal entities with Swarm-prefixed task/run/evidence
entities, dead mission tables, orchestration sessions, and legacy repository audit columns. A future
feature can easily create a second owner by following a table name rather than the service that
actually writes it.

## Decision

The canonical ownership map is maintained in `CURRENT-TO-VNEXT-MAP.md`. The short form is:

| Concept | Exactly one VNext owner | Current compatibility representation |
|---|---|---|
| Project | Project aggregate | `Project`, `ProjectService`, `projects` |
| Workspace | Workspace/runtime environment | `Workspace`, workspace commands, `workspaces` |
| Window | Window registry and placement owner | `WindowRegistry`, placement models |
| TerminalSession | TerminalManager | `TerminalSession`, `terminal_sessions` |
| Agent | Agent profile/session or Swarm agent runtime identity | `AgentProfile`, `AgentSession`, `SwarmAgent` |
| Provider | Provider adapter registry/runtime | `AgentProvider`, model registry, `ProviderRuntimeAdapter` |
| Mission | Control-plane intent aggregate | no live canonical implementation; legacy orchestration/Swarm mission strings are compatibility data |
| Task | Control-plane executable intent | `SwarmTask`/`swarm_tasks` until mapped |
| AgentRun | Execution attempt | `SwarmAgentRun`/`swarm_agent_runs` |
| ContextPack | Context Fabric compiler | `ContextRequest`, `ContextPack`, `swarm_context_packs` snapshot |
| Evidence | Proof Engine | `SwarmEvidence`, test records, repository audit evidence |
| Verification | Proof Engine | completion gate and persisted test/review records |
| Worktree | RepositoryService | repository lease and Swarm worktree records |
| RepositoryOperation | RepositoryService | `RepositoryOperation`, queue, policy, approval, audit |
| MemoryItem | Knowledge Fabric / MemoryService | memory items/revisions/claims/sources |
| KnowledgeCandidate | Knowledge Fabric / KnowledgeIntelligence | candidates/conflicts/review |
| Handoff | Knowledge Fabric bridge | `AgentHandoff`, handoff tables/services |
| Notification/Attention | future attention aggregation owner | Swarm attention exists; no global notification owner yet |
| Database schema intelligence | DatabaseService plus Database Studio domain service | migrations/schema plus Database Studio runtime |

Legacy names remain readable while migration work is pending. They do not become new owners.

## Existing implementation involved

The current owner evidence is in `models/`, `services/`, Tauri command modules, and the live readers
and writers described in the table above. `05-DOMAIN-AND-DATA-MODEL.md` and the current source were
checked together; schema-only tables are not treated as live owners.

## Interfaces

Domain services expose the existing typed Rust models and Tauri command contracts. The additive
`MissionIdentity` and `TaskIdentity` types in `models::vnext` are the compatibility seam between
future canonical intent and current `swarm_*`/orchestration identifiers.

## Invariants

- A concept has one writer/owner even if multiple readers or compatibility tables exist.
- Runtime ownership and domain ownership are separate: Swarm may use TerminalManager, but does not
  own PTY lifetime; it may request RepositoryService worktrees, but does not shell out directly.
- DatabaseService provides persistence infrastructure and transactions; domain services own meaning.
- A table without a live writer is not a domain owner.

## Compatibility constraints

No table drop, rename, backfill, or FK repair occurs in Generation 0. Existing Tauri payload names and
`swarm_*` schema remain stable. `MissionIdentity` and `TaskIdentity` are additive compatibility
boundaries, not replacement domain models.

## Rejected alternatives

- Make the database table the owner: encourages raw SQL and bypasses policy/services.
- Use `Swarm` as the permanent name for every future intent concept: preserves the current runtime
  coupling and prevents non-Swarm missions/tasks.
- Let each feature own a local copy: recreates duplicate control planes and identity drift.

## Migration implications

Before any schema cleanup, inventory every reader/writer, define an explicit mapping, back up data,
and add migration tests from the supported previous schema. New code must use the declared owner.

## Explicitly deferred

Mission persistence, task-table consolidation, notification ownership, table cleanup, and public
renames.

# ADR 007: Persistence, IPC, and service boundaries

Status: accepted for Generation 0
Date: 2026-08-18

## Context

The application uses Tauri commands/events over a hand-maintained TypeScript mirror, a single
SQLite connection guarded by a mutex, transactional migrations, and many domain services. The
architecture is safe only if command handlers validate scope and delegate meaning to services,
while DatabaseService remains infrastructure rather than a second domain layer.

## Decision

The boundary layers are:

1. Renderer state and UI submit typed command requests and render typed responses/events.
2. Tauri command handlers validate window/workspace/project scope, authorization, and input shape.
3. Domain services own behavior and invariants.
4. DatabaseService owns connections, migration/backup/recovery, transaction execution, and schema
   health; it does not decide Mission, Task, Proof, or Knowledge meaning.
5. Events are explicit: runtime observations, control-plane transitions, proof decisions, and
   knowledge lifecycle events use distinct names/payloads.

Existing Rust models and `src/native/types.ts` remain compatible until a deliberate IPC generation
decision. New contracts must be additive and use the repository's camelCase structs/snake_case enum
tokens.

## Existing implementation involved

- Tauri command modules and `lib.rs` command registration;
- `services/*` domain owners;
- `database/mod.rs`, migrations, backups, WAL/foreign keys;
- `src/native/commands.ts`, `events.ts`, and `types.ts`;
- existing scope helpers, workspace lease validation, RepositoryService policy, and orchestration
  typed capability validation/redaction.

## Interfaces

```text
Renderer -> command(scope + request) -> domain service -> DatabaseService
Backend -> event(domain, stable identity, revision/sequence, payload) -> renderer
```

All future cross-layer types must declare identity, ownership scope, lifecycle/status vocabulary,
provenance where applicable, and compatibility defaults. `MissionIdentity`, `TaskIdentity`, and the
execution/context contracts in `models::vnext` are the first additive examples.

## Invariants

- A renderer cannot choose an executable, working directory, project root, or authority that Rust
  should resolve from persisted state.
- Project/workspace/window scope is validated at the command boundary and again at sensitive service
  boundaries where needed.
- Database writes are transactional and migrations remain forward-safe, backed up, and recoverable.
- Domain services do not reach around another canonical owner with raw process or raw domain SQL.
- Runtime/control/proof/knowledge events cannot be confused by name or payload shape.
- No persistence migration is introduced solely to make an aspirational VNext type look complete.

## Compatibility constraints

Generation 0 does not change commands, events, schema version, migration behavior, database
connection model, or TypeScript generation. Existing dirty branch work is outside this ADR and is
not reformatted or reconciled.

## Rejected alternatives

- Put domain logic in DatabaseService: makes SQL the duplicate control plane.
- Let frontend stores become authoritative for backend lifecycle: breaks restart and multi-window
  correctness.
- Add a new IPC type system now as part of architecture documentation: too broad for Generation 0;
  first establish ownership and compatibility cases.

## Migration implications

Future contract additions need Rust-side boundary tests and matching TypeScript updates. A later
generation may introduce generated IPC types after measuring the current hand-maintained surface.
Schema changes must include previous-schema migration tests and data-preservation checks.

## Explicitly deferred

IPC code generation, connection pooling, migration cleanup, command-helper consolidation, new
events, and public contract renames.

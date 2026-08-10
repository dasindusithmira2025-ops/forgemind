IMPORTANT JCODE SWARM EXECUTION INSTRUCTION

You are the ROOT COORDINATOR.

Immediately use jcode's native swarm system for this mission. Do not simulate a swarm inside one model and do not perform the entire mission yourself.

Use the following exact role/model topology:

ROOT COORDINATOR:
- Role: Coordinator
- Model: Claude Opus 5
- This current root session owns the shared swarm plan.

SPAWN THESE SPECIALISTS:

1. Reviewer
   Model: Claude Opus 5
   Role: independent architecture/code/security/quality reviewer

2. Architect
   Model: GPT-5.6
   Role: system architecture and technical contracts

3. Backend Engineer
   Model: GPT-5.5
   Role: database intelligence/backend/domain/persistence/adapters

4. UI/UX Engineer
   Model: Claude Sonnet 5
   Role: Database Studio UI/UX implementation

5. Builder / Integration Engineer
   Model: GPT-5.6
   Role: cross-system implementation, agent integration, migration pipeline, E2E integration

Use explicit model selection when spawning each jcode swarm worker.

First verify the requested models/routes are actually available in this jcode installation. If an exact display/model ID differs, resolve the installed equivalent rather than silently substituting another model.

Create the swarm plan before implementation.
Parallelize only independent tasks.
Require Reviewer gates throughout the mission.
Wait for all required specialist work and reviews before declaring completion.

MISSION: Build Paralith Database Studio End-to-End

You are a coordinated jcode engineering swarm working inside the existing Paralith ADE repository.

This is a production implementation mission, not a prototype.

Build Paralith Database Studio: a first-class, codebase-aware, agent-operable database architecture environment where humans, Claude Code, Codex, repositories, migrations, and databases interact through one typed semantic database model.

The visual ER/database designer is only one projection of the system.

THE REAL FEATURE IS:

Repository
→ Database Discovery
→ Canonical Database Graph
→ Database Designer
→ Design Versioning
→ Agent Tools
→ Native Migration/Implementation
→ Verification

Do not build a simple React Flow ERD viewer.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SWARM MODEL / ROLE ASSIGNMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

COORDINATOR — OPUS 5

Own the mission.

Responsibilities:

- inspect and understand overall repository state
- break the mission into bounded work packages
- assign work to the correct specialist
- establish interfaces/contracts before parallel implementation
- prevent agents from modifying overlapping areas unnecessarily
- maintain architectural consistency
- maintain mission progress
- resolve cross-agent blockers
- control integration order
- prevent scope drift
- continuously evaluate whether implementation serves the actual product goal
- request revisions when specialist work is incomplete
- keep token/context use efficient
- ensure every task has deterministic completion criteria

The Coordinator does NOT perform large implementation work unless required to unblock the swarm.

Do not allow agents to blindly coordinate through giant transcript dumps.

Use concise typed findings, implementation summaries, changed files, contracts, test evidence, and explicit dependencies.

────────────────────────────────────────

REVIEWER — OPUS 5

Act as an independent senior reviewer.

The Reviewer must NOT simply approve another agent's work.

Continuously inspect:

- architecture correctness
- integration correctness
- security
- persistence
- concurrency
- DB safety
- agent tool contracts
- UI behavior
- performance
- code quality
- test quality
- regressions

For important work packages:

IMPLEMENT
→ REVIEW
→ FIX
→ RE-REVIEW

The Reviewer may reject work and send precise remediation requirements back to the responsible agent.

Final completion requires Reviewer approval.

────────────────────────────────────────

ARCHITECT — GPT-5.6

Own system architecture and technical contracts.

Responsibilities:

- deep repository architecture audit
- Database Studio architecture
- canonical Database Graph model
- Declared / Observed / Proposed model
- Database Design revision/DAG architecture
- monorepo database ownership/use model
- adapter architecture
- agent tool protocol
- migration/implementation pipeline
- security boundaries
- persistence design
- event/update architecture
- performance strategy
- integration points with existing Paralith systems

The Architect should produce implementation-ready contracts, not theoretical essays.

Before implementation, identify:

- existing services that must be reused
- new modules that are truly required
- boundaries between frontend/backend/domain
- ownership of persistence
- APIs/commands/events
- concurrency strategy
- migration requirements
- acceptance criteria

Do not implement giant subsystems unless Coordinator explicitly assigns it.

────────────────────────────────────────

BACKEND ENGINEER — GPT-5.5

Own backend/database intelligence implementation.

Primary responsibilities:

- canonical database domain model
- database graph persistence
- snapshots
- database discovery
- monorepo evidence resolution
- adapter framework
- Prisma extraction
- Drizzle extraction
- raw SQL extraction
- SQLite introspection
- PostgreSQL introspection
- MySQL/MariaDB introspection
- semantic schema diff
- reconciliation
- design revisions
- design operations
- health checks
- provenance
- context-pack backend
- connection metadata
- safe credential boundaries
- backend commands/services

Follow Architect contracts.

Do not put UI concerns inside backend domain models.

────────────────────────────────────────

UI / UX ENGINEER — SONNET 5

Own Database Studio product experience.

Responsibilities:

- Database first-class project surface
- Explorer
- ER/schema canvas
- table nodes
- relationships
- right-side inspector
- schemas/databases navigation
- search
- filtering
- selection
- multi-selection
- domain grouping
- semantic zoom
- canvas persistence
- design mode
- design drafts
- comparison visualization
- changed-object overlays
- health/issues surfaces
- migrations view where required
- agent activity representation
- empty/loading/error states
- large-schema usability
- native integration with existing Paralith UI genome

IMPORTANT:

Do NOT redesign unrelated Paralith structure.

Do NOT create:
- neon UI
- giant cards
- excessive glassmorphism
- AI-slop animation
- excessive padding
- fake futuristic decoration

The UI should feel like a serious professional ADE/IDE.

Dense.
Fast.
Readable.
Dark-mode first.
Minimal clicks.

React/UI state must NOT become the database source of truth.

The semantic backend/domain model is authoritative.

────────────────────────────────────────

BUILDER / INTEGRATION ENGINEER — GPT-5.6

Own cross-system implementation and final integration.

Responsibilities:

- connect backend services to frontend
- connect Database Studio to project lifecycle
- connect agents to Database Studio tools
- canvas-state → agent-context integration
- design-only vs implementation execution modes
- approved design → repository implementation pipeline
- native Prisma/Drizzle/SQL implementation integration
- Git/repository integration
- Swarm integration
- migrations integration
- code usage/impact foundation
- event propagation
- conflict handling
- optimistic concurrency
- integration tests
- fixture construction
- end-to-end acceptance flows
- regression repairs

The Builder must consume Architect contracts and Backend/UI implementations rather than duplicate them.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MISSION NORTH STAR
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

When a developer opens an existing repository:

Paralith should automatically determine:

- which projects/packages exist
- whether it is a monorepo
- what database technologies exist
- which logical databases exist
- which project OWNS each schema
- which projects USE each database
- ORM/schema technology
- migrations
- tables
- columns
- PK/FK relations
- constraints
- indexes
- enums
- source definitions

Then:

Project → Database

should provide a high-quality database architecture workspace.

For example:

repo/
├─ apps/api
├─ apps/worker
├─ apps/analytics
└─ packages/db

If:

packages/db owns Primary PostgreSQL
api uses Primary PostgreSQL
worker uses Primary PostgreSQL
analytics owns Analytics PostgreSQL

Paralith must show:

Primary PostgreSQL
  owner: packages/db
  consumers:
    apps/api
    apps/worker

Analytics PostgreSQL
  owner:
    apps/analytics

Do NOT show Primary DB three times.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CORE DATA MODEL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Create an engine/framework-independent semantic database model.

Support concepts equivalent to:

RepositoryProject

DatabaseSource
DatabaseSourceEvidence
DatabaseEnvironment

DatabaseNamespace
DatabaseTable
DatabaseColumn

PrimaryKey
ForeignKey
UniqueConstraint
CheckConstraint
Index
Enum

View

DatabaseMigration

ORMModel

DatabaseUsageReference

DatabaseSnapshot

DatabaseDesign
DatabaseDesignRevision
DatabaseDesignOperation

DatabaseIssue

Typed relations should support concepts equivalent to:

CONTAINS
HAS_COLUMN
PRIMARY_KEY
REFERENCES
INDEXES
MAPS_TO
DECLARED_BY
CREATED_BY_MIGRATION
OWNED_BY
USED_BY
READ_BY
WRITTEN_BY
DEPENDS_ON

Every meaningful object must have:

- stable identity
- qualified database identity
- source/provenance
- adapter
- confidence when inferred
- snapshot/revision information
- timestamps

Do not model important architecture as arbitrary untyped JSON.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DECLARED / OBSERVED / PROPOSED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Maintain these as separate concepts.

DECLARED

What repository files/schema/migrations say exists.

OBSERVED

What an explicitly connected database actually contains.

PROPOSED

What a human or agent is currently designing.

Never silently collapse them.

Support semantic comparison:

Declared ↔ Observed
= drift detection

Declared ↔ Proposed
= implementation delta

Design A ↔ Design B
= architecture comparison

Git revision A ↔ revision B
= database change analysis

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DATABASE DISCOVERY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Implement low/zero-config discovery.

Detect evidence such as:

- Prisma schema/config
- Drizzle schema/config
- SQL migrations
- SQL schema files
- ORM/client dependencies
- Docker Compose database services
- environment variable references
- workspace/package manifests
- shared database packages
- database imports
- SQLite files
- migration directories

Prioritize excellent V1 support for:

DATABASES

- PostgreSQL
- MySQL / MariaDB
- SQLite

SCHEMA SYSTEMS

- Prisma
- Drizzle
- raw SQL migrations/schema

Architecture must support future adapters without rewriting the engine.

Define adapter capabilities such as:

detect
extractDeclaredSchema
extractMigrations
introspectObservedSchema
validate
diff
generateChange
capabilities

Not every adapter needs every capability.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MONOREPO INTELLIGENCE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Treat monorepos as a first-class requirement.

Build/consume a project graph.

Distinguish:

OWNS_DATABASE
USES_DATABASE
SHARES_DATABASE_LIBRARY

Resolve multiple evidence sources into logical database identities.

Example:

apps/api → DATABASE_URL
apps/worker → imports @repo/db
packages/db → schema.prisma
docker-compose → postgres

should be capable of resolving to one Primary DB.

Keep confidence/provenance for inferred merges.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DATABASE DESIGNER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Database Studio must allow humans to visually:

- add/remove/rename tables
- add/remove/modify columns
- create PKs
- create FKs
- create indexes
- create unique constraints
- create check constraints
- create enums
- create relationships
- annotate objects
- group by domain
- arrange/pin objects

IMPORTANT:

Editing the design does NOT directly mutate repository files or a live database.

Human edits modify a PROPOSED DESIGN.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
VERSIONED DATABASE DESIGNS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Database designs must support revisions/drafts.

Example:

Base Schema
│
├─ Claude Registration Design
│
└─ Codex Registration Design

Agents must be capable of creating independent drafts.

Do not let Claude and Codex mutate the same unversioned object graph concurrently.

Support:

create design
branch/create draft
apply operation
validate
compare
approve
reject/archive
derive a new design from another revision

Use immutable revisions where practical.

Implement stale-revision / optimistic concurrency protection.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AGENT-OPERABLE DATABASE STUDIO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

THIS IS A CRITICAL FEATURE.

Claude Code and Codex must operate Database Studio through structured Paralith tools.

Agents must NOT inspect UI screenshots to understand architecture.

Create tool capabilities equivalent to:

database.list_sources

database.inspect_project

database.get_schema

database.get_table

database.search

database.get_relationships

database.get_provenance

database.get_active_design

database.get_design_revision

database.get_canvas_state

database.get_selection

database.create_design

database.create_draft

database.compare_designs

database.add_table

database.remove_table

database.rename_table

database.add_column

database.modify_column

database.remove_column

database.add_relationship

database.remove_relationship

database.add_index

database.add_constraint

database.add_enum

database.validate_design

database.analyze_design

database.get_usage

database.get_impact

database.compare_target_to_repository

database.compare_target_to_database

database.create_implementation_plan

Use existing Paralith agent/tool conventions where possible.

Do not blindly use these names if the repo has a better established protocol.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CRITICAL AGENT FLOWS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

FLOW 1

User to Claude:

"Go to Database Studio and plan the registration system."

Expected:

Claude:

- inspects repository
- reads existing database architecture
- creates a design draft
- proposes tables/relationships/indexes/etc.
- updates the actual semantic Database Studio design
- changes become visible on canvas

BUT:

no repo schema changes
no migrations
no DB mutation

because this is DESIGN_ONLY.

────────────────────────────────────────

FLOW 2

User independently tells Codex:

"Go to Database Studio and plan the registration system."

Expected:

Codex creates a SECOND draft from the same base.

Claude's draft remains unchanged.

────────────────────────────────────────

FLOW 3

User:

"Compare Claude's and Codex's registration designs."

Expected:

semantic structural comparison.

NOT text comparison.
NOT screenshot comparison.

Show:

added objects
removed objects
changed objects
different relationships
different indexes
different constraints

────────────────────────────────────────

FLOW 4

User manually edits the Database Studio canvas.

Then:

"Inspect my database design."

Agent reads the current semantic design revision.

────────────────────────────────────────

FLOW 5

User selects:

users
sessions
payments

and says:

"Normalize these."

Agent receives structured selection state.

Do not ask the user which objects "these" refers to when canvas selection resolves it.

────────────────────────────────────────

FLOW 6

User:

"Build the database exactly like the approved/current Database Studio design."

Expected:

Target Design

→ inspect repository
→ detect adapter
→ inspect current Declared schema
→ compute semantic delta
→ risk analysis
→ implementation plan
→ edit native schema
→ generate native migrations
→ validate
→ run tests
→ safely test against local/dev DB where appropriate
→ re-extract/introspect resulting schema
→ compare Target vs Result

Success requires evidence.

Not merely process exit code 0.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AGENT EXECUTION MODES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Implement clear separation.

DESIGN_ONLY

Allows:

- inspect
- reason
- design
- compare
- validate
- annotate

Forbids:

- repository schema mutation
- migration application
- database mutation

IMPLEMENT_DESIGN

Allows:

- inspect approved target
- compute delta
- modify repository
- generate migration
- run validations/tests
- safely verify local/dev result

Production database mutation requires explicit separate authorization.

Use Paralith's actual permission/task model rather than brittle keyword checks alone.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CANVAS AWARENESS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Expose structured UI state to agents.

Relevant state includes:

- active project
- active database
- active schema
- active design
- current revision
- selected tables
- selected columns
- selected relationships
- focused object
- visible objects
- current filters/groups

The UI should communicate selections through semantic IDs.

Never rely on screen coordinates.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DATABASE STUDIO UI
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Create a first-class Database surface.

Target information architecture:

Database

Overview
Diagram
Explorer
Migrations
Changes
Health
Connections

Prioritize V1 quality for:

Diagram
Explorer
Design
Changes
Health

Suggested workspace:

LEFT

Data sources
Schemas
Tables
Search/filter

CENTER

ER/schema canvas

RIGHT

Context inspector

Inspector should support relevant sections:

Definition
Columns
Relations
Constraints
Indexes
Usage
History
Source
Health

Canvas requirements:

- pan
- zoom
- fit
- search/jump
- multi-select
- relationship highlighting
- N-hop focus
- hide unrelated
- namespace grouping
- domain grouping
- project/database grouping
- pinned positions
- persistent layout
- semantic zoom
- good large-schema performance

Do not completely rearrange user-customized layouts whenever a schema changes.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LARGE SCHEMA UX
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Support semantic level-of-detail.

Far zoom:

table/domain names

Medium:

important columns

Near:

complete column details

Avoid rendering hundreds of full table cards unnecessarily.

Expensive automatic layout should not freeze the UI.

Use an appropriate layout engine and worker/background computation where necessary.

Benchmark representative large schemas.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NATIVE IMPLEMENTATION PIPELINE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

When implementing an approved design:

PRISMA PROJECT

generate native Prisma-compatible changes.

DRIZZLE PROJECT

generate native Drizzle-compatible changes.

RAW SQL PROJECT

generate migration/schema according to repository conventions.

Never dump arbitrary SQL into an ORM-managed repository.

Pipeline:

Approved Target
→ semantic delta
→ risk classification
→ repository-native change plan
→ implementation
→ migration
→ validation
→ tests
→ safe local verification
→ resulting schema extraction
→ target/result comparison

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DATABASE HEALTH
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Implement deterministic health rules first.

Examples:

- missing PK
- FK type mismatch
- duplicate index
- broken relationship
- dangerous cascading behavior
- Declared/Observed drift
- migration mismatch
- ambiguous database ownership
- unsupported extraction
- invalid design
- destructive proposed change

Every issue must include:

severity
rule
object
reason
evidence/provenance

Do not use an LLM as the primary detector for deterministic integrity problems.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CODE USAGE / IMPACT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Add a bounded foundation connecting database objects to code.

Track high-confidence evidence for concepts such as:

READ_BY
WRITTEN_BY
DEFINED_BY
USED_BY

Allow an agent/user to ask:

"What uses users.avatar_url?"

and receive source references.

Do not pretend V1 is perfect whole-program static analysis.

Confidence/evidence matter.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DATABASE CONTEXT PACKS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Agent context must be efficient.

Do not dump a 400-table schema into Claude/Codex.

Given task + current selection + active database:

generate a compact relevant subgraph containing only:

- relevant tables
- relevant columns
- relationships
- constraints
- migrations
- usage
- provenance

Use graph traversal/search.

This is a key performance and token-efficiency requirement.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECURITY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CRITICAL.

Finding DATABASE_URL does NOT mean permission to connect.

Never silently connect to discovered databases.

Classify connections:

LOCAL
DEVELOPMENT
STAGING
PRODUCTION

Default connected introspection must be read-only.

Never expose secrets to:

- agent context
- logs
- database graph
- snapshots
- AgentRun evidence
- UI telemetry
- context packs

Do not persist plaintext database credentials in Paralith's normal DB.

Use OS-level credential storage if persistent secrets are necessary.

Do not execute arbitrary repository code merely to discover database structure.

Prefer static extraction.

Any required project execution must pass through existing safety/permission boundaries.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PERSISTENCE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Integrate with the actual existing Paralith persistence patterns.

Persist concepts equivalent to:

database_sources
database_source_evidence

database_snapshots

database_objects
database_edges
database_object_provenance

database_designs
database_design_revisions
database_design_operations

database_layouts

database_diffs

database_issues

database_usage_refs

database_connection_profiles

Do NOT store secrets.

Create proper migrations.

Preserve existing data/backward compatibility.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INCREMENTAL PROCESSING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Do not constantly rescan entire repositories.

Initial:

discover relevant artifacts
→ fingerprint
→ parse
→ persist graph

Then:

filesystem event
→ determine whether DB-relevant
→ identify affected project/adapter
→ reparse only affected artifacts
→ graph patch
→ relevant validation
→ partial UI update

Editing a Button.tsx must not trigger database discovery.

Changing schema.prisma should not trigger complete repository analysis.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SWARM EXECUTION RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Coordinator first creates:

1. repository implementation map
2. architectural dependency map
3. work package list
4. ownership boundaries
5. acceptance criteria

Then parallelize only independent work.

Recommended dependency flow:

ARCHITECTURE
      ↓
DOMAIN CONTRACTS
      ↓
┌───────────────┬─────────────────┐
│ Backend       │ UI foundation   │
└───────┬───────┴────────┬────────┘
        ↓                ↓
        INTEGRATION / BUILDER
                ↓
         AGENT PROTOCOL
                ↓
       IMPLEMENTATION PIPELINE
                ↓
             REVIEW
                ↓
          HARDEN / FIX
                ↓
        FINAL ACCEPTANCE

Do not create five implementations of the same subsystem.

Each agent must state:

- files/modules owned
- contracts consumed
- contracts produced
- tests required
- blockers/dependencies

before large implementation work.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GRAPH ENGINEERING WORKFLOW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

For each work package:

GENERATE
→ EVALUATE
→ REVISE
→ VERIFY

Evaluation must use deterministic criteria where possible.

Persist important findings/artifacts as typed outputs rather than huge conversational summaries.

Use isolated worktrees for parallel independent implementation.

Do not create unbounded agent loops.

Retries must be bounded.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TEST REQUIREMENTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

UNIT

- database object identity
- canonical graph
- design operations
- revision handling
- stale revision protection
- semantic diff
- evidence resolution
- health rules
- risk classification
- context packs
- adapter parsing

INTEGRATION

fixtures for:

1. Prisma project
2. Drizzle project
3. raw SQL project
4. SQLite
5. multiple schemas with duplicate table names
6. monorepo with shared DB owner/consumers
7. multiple logical databases

AGENT CONTRACT TESTS

- agent reads schema
- agent creates design
- second agent creates independent design
- designs compare semantically
- agent reads canvas selection
- DESIGN_ONLY cannot alter repo
- IMPLEMENT_DESIGN receives target revision
- target/result comparison works

UI TESTS

- Database Studio opens
- explorer renders
- diagram renders
- search/jump
- selection
- multi-selection
- inspector
- design editing
- draft switching
- design comparison
- large schema sanity/performance

REGRESSION

Run existing relevant Paralith tests for:

- project lifecycle
- Swarm
- terminal/workspace
- repository/Git
- Memory
- filesystem
- persistence
- frontend
- Tauri/backend

Do not disable tests to get green results.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MANDATORY ACCEPTANCE SCENARIOS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SCENARIO 1

Open supported normal repository.

Database architecture is discovered automatically.

SCENARIO 2

Open monorepo fixture.

Correctly resolve database owners and users.

Do not duplicate a shared logical DB.

SCENARIO 3

Open Database → Diagram.

Generate useful table/relationship visualization from real semantic schema.

SCENARIO 4

Claude:

"Plan a registration database."

Creates design draft only.

No schema files modified.

No migration run.

SCENARIO 5

Codex independently creates another registration draft.

Claude's draft unchanged.

SCENARIO 6

Compare Claude vs Codex designs.

Return semantic differences.

SCENARIO 7

User selects tables on canvas.

Agent understands current selection.

SCENARIO 8

User manually edits architecture.

Agent reads exact current semantic revision.

SCENARIO 9

"Build this approved design."

Correct native repository implementation is produced.

SCENARIO 10

Result is re-extracted/introspected and compared against Target.

SCENARIO 11

Destructive operation cannot happen silently.

SCENARIO 12

No DB credentials leak into persistence, logs, graph, context packs, or agent messages.

SCENARIO 13

Existing Paralith behavior remains operational.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REVIEW GATES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

OPUS 5 REVIEWER MUST REVIEW AT LEAST:

GATE 1
Architecture + domain contracts

GATE 2
Persistence + discovery + adapters

GATE 3
Design graph/revisions/concurrency

GATE 4
Database Studio UI/UX

GATE 5
Agent protocol + canvas awareness

GATE 6
Approved design implementation pipeline

GATE 7
Security + credential handling

GATE 8
Performance + large schemas

GATE 9
Tests/regressions

GATE 10
Final integrated application

A rejected gate returns to the responsible role with exact findings.

Do not bypass gates.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
QUALITY BAR
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DO NOT SHIP:

- mock-only features
- hard-coded diagrams
- fake discovery
- screenshot-driven agent control
- UI-owned schema truth
- plaintext credentials
- unsafe automatic DB connection
- automatic production mutation
- arbitrary code execution for discovery
- massive repository rescans
- string-only schema comparisons
- giant God classes/services
- untyped JSON for critical architecture
- hidden destructive changes
- overlapping agent implementation
- dead/debug code
- swallowed errors
- broken tests
- unnecessary unrelated refactors

Aim for:

- typed contracts
- deterministic behavior
- provenance
- safety
- incremental computation
- clear states
- compact agent context
- professional UI
- strong verification

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DEFINITION OF DONE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The feature is complete only when the following relationship is real:

              HUMAN
                │
        ┌───────┼────────┐
        ↓       ↓        ↓
     Claude    Codex    Canvas
        │       │        │
        └───────┼────────┘
                ↓
        DATABASE DESIGN GRAPH
                │
         ┌──────┴───────┐
         ↓              ↓
     Repository      Database
         │              │
         └──────┬───────┘
                ↓
            Verification

The Database Graph / Design Graph is the shared semantic source of truth.

Claude and Codex can both read and manipulate it.

Humans can manipulate it visually.

Approved designs can be implemented into the repository.

Implemented results can be verified against the target.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FINAL EXECUTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Once implementation is integrated:

1. run formatter
2. run lint
3. run targeted tests
4. run backend tests
5. run frontend tests
6. run integration tests
7. run agent-contract tests
8. run regression tests
9. run production frontend build
10. run appropriate Tauri validation/build
11. run acceptance fixtures
12. inspect security
13. inspect large-schema performance
14. Reviewer performs final diff review
15. fix all legitimate findings
16. repeat failed validation
17. remove temporary/debug/mock artifacts

Then launch the local Paralith development application with Database Studio enabled so the user can inspect and test the completed feature.

DO NOT:

- push
- open PR
- merge
- release
- publish
- deploy

unless the user explicitly commands it.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FINAL SWARM REPORT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Coordinator must return one concise evidence-backed final report:

MISSION STATUS

Architecture:
what was implemented

Discovery:
supported detection/adapters

Monorepo:
how ownership/use resolution works

Database Studio:
surfaces completed

Agent Integration:
tools and workflows completed

Design System:
revision/branch/comparison behavior

Implementation Pipeline:
target → repository → migration → verification

Security:
credential/connection safeguards

Testing:
exact tests/builds and results

Review:
Opus 5 Reviewer findings and resolution

Known Limitations:
real limitations only

Deferred Work:
Tier-2 items

Manual Verification:
exact steps for the user to reproduce the three north-star workflows

Do not declare SUCCESS unless the final integrated feature actually passes the mandatory acceptance scenarios.
# Paralith Database Studio Implementation Contracts

Contract version: 1.0. Serde rule: every public Rust struct below uses `#[serde(rename_all = "camelCase")]`; every public enum uses `#[serde(rename_all = "snake_case")]` unless an explicit wire value is shown. IDs and timestamps are UTF-8 strings; timestamps are RFC 3339 UTC. Critical architecture is represented by typed columns/fields, never opaque JSON.

## 1. Shared primitives, identity, provenance

```rust
pub type SemanticId = String;
pub type SnapshotId = String;
pub type DesignId = String;
pub type RevisionId = String;
pub type ProjectId = String;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticIdentity {
    pub id: SemanticId,                 // qualified deterministic id
    pub logical_key: String,            // rename-tolerant key when adapter supplies one
    pub qualified_name: String,          // display/address name in this snapshot
    pub previous_ids: Vec<SemanticId>,   // explicit rename lineage, never guessed above threshold
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseObjectMeta {
    pub identity: SemanticIdentity,
    pub source_id: String,
    pub layer: DatabaseLayer,
    pub snapshot_id: Option<SnapshotId>,
    pub design_revision_id: Option<RevisionId>,
    pub confidence: f32,                 // inclusive 0.0..=1.0
    pub provenance_ids: Vec<String>,
    pub discovered_at: String,
    pub observed_at: String,
    pub updated_at: String,
    pub content_fingerprint: String,     // sha256 canonical typed representation
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseLayer { Declared, Observed, Proposed }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseEngine { Postgres, Mysql, Mariadb, Sqlite, Unknown }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseAdapterId { Prisma, Drizzle, RawSql, Sqlite, Postgres, Mysql }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceCertainty { Exact, Heuristic }
```

### 1.1 Qualified identity algorithm

`id = "db:" + kind + ":" + base32_lower(sha256(repository_id + "\0" + source_logical_key + "\0" + object_logical_key))`.

- `repository_id` is the existing Project/repository stable id.
- `source_logical_key` is selected in order: explicit connection-profile id; normalized database URL **without userinfo, password, query secrets, or host credentials** plus database name; compose service + database name; schema-owner package path + adapter; otherwise evidence-cluster hash.
- `object_logical_key` is selected in order: adapter-native stable id; migration lineage id; ORM mapped name identity; `(namespace logical key, object kind, canonical name)`. Child keys append parent logical key and ordinal-independent native name.
- Case folding follows engine rules: PostgreSQL unquoted names lower-case, MySQL comparison uses adapter-reported case mode, SQLite case-insensitive ASCII. Quoted identifiers preserve exact spelling.
- Rename tolerance is evidence-based. A native stable id or explicit rename migration retains `id`, changes `qualified_name`, and appends the old qualified id to `previous_ids`. A heuristic structural match may emit a proposed rename with confidence but must not silently reuse identity below `0.90`.
- Edge identity is `dbedge:` plus SHA-256 of `(source_id, target_id, edge_type, snapshot_or_revision_id)`.
- Every object has exactly one `DatabaseObjectMeta`; every persisted object has at least one provenance row. Exact claims use confidence `1.0`. Heuristic claims require evidence text/reference and confidence `<1.0`, matching `repository_intelligence.rs` `Origin::exact`/`Origin::heuristic` discipline.

## 2. Canonical semantic object model

All named structs below derive `Debug, Clone, Serialize, Deserialize` and use camelCase. Object structs embed `meta: DatabaseObjectMeta` except evidence, snapshot, design, revision, operation and issue records, whose identity/lifecycle fields are explicit.

```rust
pub struct RepositoryProject {
    pub id: ProjectId,
    pub repository_id: String,
    pub name: String,
    pub root_relative_path: String,
    pub package_manager: Option<String>,
    pub workspace_kind: Option<String>,
}

pub struct DatabaseSource {
    pub id: String,
    pub repository_id: String,
    pub logical_key: String,
    pub display_name: String,
    pub engine: DatabaseEngine,
    pub adapter_ids: Vec<DatabaseAdapterId>,
    pub owner_project_id: Option<ProjectId>,
    pub consumer_project_ids: Vec<ProjectId>,
    pub environment_ids: Vec<String>,
    pub evidence_ids: Vec<String>,
    pub confidence: f32,
    pub discovered_at: String,
    pub updated_at: String,
}

pub struct DatabaseSourceEvidence {
    pub id: String,
    pub repository_id: String,
    pub project_id: Option<ProjectId>,
    pub adapter_id: DatabaseAdapterId,
    pub evidence_kind: DatabaseEvidenceKind,
    pub relative_path: String,
    pub symbol_or_key: Option<String>,
    pub safe_value_fingerprint: Option<String>,
    pub source_hint: Option<String>,
    pub owner_signal: f32,
    pub consumer_signal: f32,
    pub certainty: EvidenceCertainty,
    pub confidence: f32,
    pub content_sha256: String,
    pub extractor_version: String,
    pub discovered_at: String,
}

pub enum DatabaseEvidenceKind {
    OrmSchema, OrmImport, MigrationDirectory, SqlDdl, EnvironmentReference,
    ComposeService, ConnectionConfig, SqliteFile, CodeUsage, ExplicitProfile,
}

pub struct DatabaseEnvironment {
    pub meta: DatabaseObjectMeta,
    pub name: String,
    pub kind: DatabaseEnvironmentKind,
    pub connection_profile_id: Option<String>,
    pub is_default: bool,
}
pub enum DatabaseEnvironmentKind { Local, Development, Test, Staging, Production, Unknown }

pub struct DatabaseNamespace {
    pub meta: DatabaseObjectMeta,
    pub name: String,
    pub catalog_name: Option<String>,
    pub owner: Option<String>,
    pub comment: Option<String>,
}

pub struct DatabaseTable {
    pub meta: DatabaseObjectMeta,
    pub namespace_id: SemanticId,
    pub name: String,
    pub mapped_name: Option<String>,
    pub comment: Option<String>,
    pub column_ids: Vec<SemanticId>,
    pub primary_key_id: Option<SemanticId>,
    pub foreign_key_ids: Vec<SemanticId>,
    pub unique_constraint_ids: Vec<SemanticId>,
    pub check_constraint_ids: Vec<SemanticId>,
    pub index_ids: Vec<SemanticId>,
}

pub struct DatabaseColumn {
    pub meta: DatabaseObjectMeta,
    pub table_id: SemanticId,
    pub name: String,
    pub mapped_name: Option<String>,
    pub ordinal: u32,
    pub data_type: DatabaseDataType,
    pub native_type: String,
    pub nullable: bool,
    pub default: Option<DatabaseExpression>,
    pub generated: Option<DatabaseExpression>,
    pub identity_generation: Option<IdentityGeneration>,
    pub enum_id: Option<SemanticId>,
    pub comment: Option<String>,
}

pub struct DatabaseDataType {
    pub family: DatabaseTypeFamily,
    pub length: Option<u32>,
    pub precision: Option<u32>,
    pub scale: Option<u32>,
    pub array_dimensions: u8,
    pub unsigned: bool,
}
pub enum DatabaseTypeFamily { Boolean, Integer, Decimal, Float, Text, Binary, Date, Time, DateTime, Json, Uuid, Enum, Geometry, Custom }
pub struct DatabaseExpression { pub normalized: String, pub dialect: Option<String> }
pub enum IdentityGeneration { Always, ByDefault, AutoIncrement }

pub struct PrimaryKey {
    pub meta: DatabaseObjectMeta,
    pub table_id: SemanticId,
    pub name: Option<String>,
    pub column_ids: Vec<SemanticId>,
    pub clustered: Option<bool>,
}

pub struct ForeignKey {
    pub meta: DatabaseObjectMeta,
    pub table_id: SemanticId,
    pub name: Option<String>,
    pub column_ids: Vec<SemanticId>,
    pub referenced_table_id: SemanticId,
    pub referenced_column_ids: Vec<SemanticId>,
    pub on_delete: ReferentialAction,
    pub on_update: ReferentialAction,
    pub deferrable: Option<bool>,
}
pub enum ReferentialAction { NoAction, Restrict, Cascade, SetNull, SetDefault }

pub struct UniqueConstraint {
    pub meta: DatabaseObjectMeta,
    pub table_id: SemanticId,
    pub name: Option<String>,
    pub column_ids: Vec<SemanticId>,
    pub nulls_distinct: Option<bool>,
}

pub struct CheckConstraint {
    pub meta: DatabaseObjectMeta,
    pub table_id: SemanticId,
    pub name: Option<String>,
    pub expression: DatabaseExpression,
    pub enforced: Option<bool>,
}

pub struct Index {
    pub meta: DatabaseObjectMeta,
    pub table_id: SemanticId,
    pub name: String,
    pub unique: bool,
    pub method: Option<String>,
    pub keys: Vec<IndexKey>,
    pub included_column_ids: Vec<SemanticId>,
    pub predicate: Option<DatabaseExpression>,
}
pub struct IndexKey { pub column_id: Option<SemanticId>, pub expression: Option<DatabaseExpression>, pub direction: Option<SortDirection>, pub nulls: Option<NullsOrder> }
pub enum SortDirection { Asc, Desc }
pub enum NullsOrder { First, Last }

pub struct Enum {
    pub meta: DatabaseObjectMeta,
    pub namespace_id: SemanticId,
    pub name: String,
    pub values: Vec<DatabaseEnumValue>,
}
pub struct DatabaseEnumValue { pub name: String, pub ordinal: u32, pub mapped_name: Option<String> }

pub struct View {
    pub meta: DatabaseObjectMeta,
    pub namespace_id: SemanticId,
    pub name: String,
    pub materialized: bool,
    pub definition_fingerprint: String,
    pub column_ids: Vec<SemanticId>,
    pub dependency_ids: Vec<SemanticId>,
}

pub struct DatabaseMigration {
    pub meta: DatabaseObjectMeta,
    pub source_id: String,
    pub name: String,
    pub relative_path: String,
    pub sequence: Option<i64>,
    pub checksum: String,
    pub parent_migration_ids: Vec<SemanticId>,
    pub operation_kinds: Vec<DatabaseChangeKind>,
    pub applied_state: MigrationAppliedState,
}
pub enum MigrationAppliedState { DeclaredOnly, Applied, Missing, Diverged, Unknown }

pub struct OrmModel {
    pub meta: DatabaseObjectMeta,
    pub adapter_id: DatabaseAdapterId,
    pub project_id: ProjectId,
    pub relative_path: String,
    pub symbol: String,
    pub mapped_table_id: Option<SemanticId>,
    pub field_mappings: Vec<OrmFieldMapping>,
}
pub struct OrmFieldMapping { pub field_name: String, pub column_id: Option<SemanticId>, pub mapped_name: Option<String> }

pub struct DatabaseUsageReference {
    pub id: String,
    pub source_id: String,
    pub project_id: ProjectId,
    pub semantic_object_id: Option<SemanticId>,
    pub relative_path: String,
    pub symbol: Option<String>,
    pub span: Option<SourceSpan>,
    pub access: DatabaseAccessKind,
    pub certainty: EvidenceCertainty,
    pub confidence: f32,
    pub content_sha256: String,
    pub observed_at: String,
}
pub struct SourceSpan { pub start_line: u32, pub start_column: u32, pub end_line: u32, pub end_column: u32 }
pub enum DatabaseAccessKind { Import, Read, Write, ReadWrite, Definition, Migration }

pub struct DatabaseSnapshot {
    pub id: SnapshotId,
    pub source_id: String,
    pub layer: DatabaseLayer,
    pub adapter_id: DatabaseAdapterId,
    pub git_revision: Option<String>,
    pub parent_snapshot_id: Option<SnapshotId>,
    pub fingerprint: String,
    pub object_count: u32,
    pub edge_count: u32,
    pub extractor_version: String,
    pub created_at: String,
    pub completed_at: Option<String>,
    pub status: DatabaseSnapshotStatus,
}
pub enum DatabaseSnapshotStatus { Building, Ready, Failed, Superseded }

pub struct DatabaseDesign {
    pub id: DesignId,
    pub source_id: String,
    pub name: String,
    pub status: DatabaseDesignStatus,
    pub base_snapshot_id: Option<SnapshotId>,
    pub base_revision_id: Option<RevisionId>,
    pub head_revision_id: RevisionId,
    pub revision_number: i64,
    pub created_by: DatabaseActor,
    pub created_at: String,
    pub updated_at: String,
    pub approved_revision_id: Option<RevisionId>,
}
pub enum DatabaseDesignStatus { Draft, Approved, Rejected, Archived }
pub enum DatabaseActor { Human { user_id: String }, Agent { session_id: String, agent_id: Option<String> }, System }

pub struct DatabaseDesignRevision {
    pub id: RevisionId,
    pub design_id: DesignId,
    pub parent_revision_id: Option<RevisionId>,
    pub merge_parent_revision_id: Option<RevisionId>,
    pub revision_number: i64,
    pub state: DatabaseDesignRevisionState,
    pub graph_fingerprint: String,
    pub operation_ids: Vec<String>,
    pub created_by: DatabaseActor,
    pub created_at: String,
    pub decision_by: Option<DatabaseActor>,
    pub decision_at: Option<String>,
    pub decision_reason: Option<String>,
}
pub enum DatabaseDesignRevisionState { Draft, Approved, Rejected, Archived }

pub struct DatabaseDesignOperation {
    pub id: String,
    pub design_id: DesignId,
    pub base_revision_id: RevisionId,
    pub result_revision_id: RevisionId,
    pub sequence: i64,
    pub operation: DatabaseDesignOperationKind,
    pub actor: DatabaseActor,
    pub created_at: String,
}
pub enum DatabaseDesignOperationKind {
    AddNamespace { namespace: DatabaseNamespace },
    AddTable { table: DatabaseTable },
    RenameTable { table_id: SemanticId, new_name: String },
    DropTable { table_id: SemanticId },
    AddColumn { table_id: SemanticId, column: DatabaseColumn },
    AlterColumn { column_id: SemanticId, patch: DatabaseColumnPatch },
    DropColumn { column_id: SemanticId },
    AddPrimaryKey { key: PrimaryKey },
    AddForeignKey { key: ForeignKey },
    AddUniqueConstraint { constraint: UniqueConstraint },
    AddCheckConstraint { constraint: CheckConstraint },
    AddIndex { index: Index },
    DropObject { object_id: SemanticId },
}
pub struct DatabaseColumnPatch { pub name: Option<String>, pub data_type: Option<DatabaseDataType>, pub native_type: Option<String>, pub nullable: Option<bool>, pub default: Option<Option<DatabaseExpression>> }

pub struct DatabaseIssue {
    pub id: String,
    pub source_id: String,
    pub snapshot_id: Option<SnapshotId>,
    pub design_revision_id: Option<RevisionId>,
    pub semantic_object_ids: Vec<SemanticId>,
    pub code: DatabaseIssueCode,
    pub severity: DatabaseIssueSeverity,
    pub title: String,
    pub explanation: String,
    pub evidence_ids: Vec<String>,
    pub status: DatabaseIssueStatus,
    pub detected_at: String,
    pub resolved_at: Option<String>,
}
pub enum DatabaseIssueCode { Drift, MissingPrimaryKey, BrokenReference, DuplicateIdentity, UnsafeChange, UnresolvedEvidence, UnsupportedFeature, ConnectionUnavailable }
pub enum DatabaseIssueSeverity { Info, Warning, Error, Critical }
pub enum DatabaseIssueStatus { Open, Acknowledged, Resolved, Dismissed }
```

### 2.1 Typed edges

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DatabaseEdgeType {
    Contains, HasColumn, PrimaryKey, References, Indexes, MapsTo,
    DeclaredBy, CreatedByMigration, OwnedBy, UsedBy, ReadBy, WrittenBy, DependsOn,
}

pub struct DatabaseEdge {
    pub id: String,
    pub source_object_id: SemanticId,
    pub target_object_id: SemanticId,
    pub edge_type: DatabaseEdgeType,
    pub snapshot_id: Option<SnapshotId>,
    pub design_revision_id: Option<RevisionId>,
    pub confidence: f32,
    pub provenance_ids: Vec<String>,
    pub created_at: String,
}
```

Wire values are exactly `CONTAINS`, `HAS_COLUMN`, `PRIMARY_KEY`, `REFERENCES`, `INDEXES`, `MAPS_TO`, `DECLARED_BY`, `CREATED_BY_MIGRATION`, `OWNED_BY`, `USED_BY`, `READ_BY`, `WRITTEN_BY`, `DEPENDS_ON`.

## 3. Declared, Observed, Proposed and comparisons

Layers are separate rows/snapshots and cannot be updated across layer boundaries.

```rust
pub enum DatabaseComparisonMode {
    DeclaredObservedDrift { declared_snapshot_id: SnapshotId, observed_snapshot_id: SnapshotId },
    DeclaredProposedDelta { declared_snapshot_id: SnapshotId, proposed_revision_id: RevisionId },
    DesignRevisions { left_revision_id: RevisionId, right_revision_id: RevisionId },
    GitRevisions { source_id: String, left_git_revision: String, right_git_revision: String },
}
pub struct DatabaseDiff { pub id: String, pub source_id: String, pub mode: DatabaseComparisonMode, pub changes: Vec<DatabaseChange>, pub fingerprint: String, pub created_at: String }
pub struct DatabaseChange { pub kind: DatabaseChangeKind, pub object_id: Option<SemanticId>, pub before_fingerprint: Option<String>, pub after_fingerprint: Option<String>, pub breaking: bool, pub destructive: bool, pub summary: String }
pub enum DatabaseChangeKind { Add, Drop, Rename, Alter, Move, Reorder, DataMigrationRequired }
```

Diff is semantic. Formatting, comments not represented in a semantic field, migration file whitespace, and declaration ordering outside order-sensitive constructs produce no change.

## 4. Adapter contract

```rust
pub struct DetectionContext<'a> {
    pub repository_id: &'a str,
    pub project_id: &'a str,
    pub project_root: &'a Path,
    pub changed_paths: &'a [PathBuf],
    pub extractor_version: &'a str,
}
pub struct ExtractionContext<'a> {
    pub repository_id: &'a str,
    pub project_id: &'a str,
    pub project_root: &'a Path,
    pub source: &'a DatabaseSource,
    pub evidence: &'a [DatabaseSourceEvidence],
    pub git_revision: Option<&'a str>,
}
pub struct IntrospectionContext<'a> {
    pub project_id: &'a str,
    pub source: &'a DatabaseSource,
    pub profile: &'a DatabaseConnectionProfileSummary,
    pub credential: &'a dyn DatabaseCredentialLease,
    pub read_only: bool,
}
pub struct ValidationContext<'a> { pub source: &'a DatabaseSource, pub layer: DatabaseLayer }
pub struct DiffContext<'a> { pub source: &'a DatabaseSource, pub mode: &'a DatabaseComparisonMode }
pub struct GenerateChangeContext<'a> {
    pub project_id: &'a str,
    pub project_root: &'a Path,
    pub source: &'a DatabaseSource,
    pub declared_snapshot: &'a DatabaseSnapshot,
}
pub enum DatabaseObject {
    Environment(DatabaseEnvironment), Namespace(DatabaseNamespace), Table(DatabaseTable),
    Column(DatabaseColumn), PrimaryKey(PrimaryKey), ForeignKey(ForeignKey),
    UniqueConstraint(UniqueConstraint), CheckConstraint(CheckConstraint), Index(Index),
    Enum(Enum), View(View), Migration(DatabaseMigration), OrmModel(OrmModel),
}
pub struct DatabaseObjectProvenance { pub id: String, pub object_id: SemanticId, pub source_kind: String, pub certainty: EvidenceCertainty, pub confidence: f32, pub evidence_ref: Option<String>, pub extractor_version: String, pub observed_at: String }
pub struct DatabaseConnectionProfileSummary { pub id: String, pub source_id: Option<String>, pub project_id: String, pub display_name: String, pub engine: DatabaseEngine, pub credential_reference: String, pub read_only_default: bool }
pub struct DatabaseSecret(String); // private field; no Debug/Serialize/Clone; zeroized on drop by implementation
pub trait DatabaseCredentialLease: Send + Sync { fn reference(&self) -> &str; fn expose_for_connection(&self) -> DatabaseSecret; }
pub struct ExtractedDatabaseGraph { pub objects: Vec<DatabaseObject>, pub edges: Vec<DatabaseEdge>, pub provenance: Vec<DatabaseObjectProvenance> }
pub struct GeneratedDatabaseChange { pub adapter_id: DatabaseAdapterId, pub file_edits: Vec<DatabaseFileEdit>, pub verification: DatabaseComparisonMode }
pub struct DatabaseFileEdit { pub relative_path: String, pub expected_content_sha256: Option<String>, pub replacement: Vec<u8> }

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseAdapterCapabilities {
    pub detect: bool,
    pub extract_declared_schema: bool,
    pub extract_migrations: bool,
    pub introspect_observed_schema: bool,
    pub validate: bool,
    pub diff: bool,
    pub generate_change: bool,
    pub supports_read_only_transaction: bool,
}

#[async_trait]
pub trait DatabaseAdapter: Send + Sync {
    fn id(&self) -> DatabaseAdapterId;
    fn capabilities(&self) -> DatabaseAdapterCapabilities;
    fn detect(&self, ctx: &DetectionContext) -> AppResult<Vec<DatabaseSourceEvidence>>;
    fn extract_declared_schema(&self, ctx: &ExtractionContext) -> AppResult<ExtractedDatabaseGraph>;
    fn extract_migrations(&self, ctx: &ExtractionContext) -> AppResult<Vec<DatabaseMigration>>;
    async fn introspect_observed_schema(&self, ctx: &IntrospectionContext<'_>) -> AppResult<ExtractedDatabaseGraph>;
    fn validate(&self, ctx: &ValidationContext, graph: &ExtractedDatabaseGraph) -> AppResult<Vec<DatabaseIssue>>;
    fn diff(&self, ctx: &DiffContext, before: &ExtractedDatabaseGraph, after: &ExtractedDatabaseGraph) -> AppResult<DatabaseDiff>;
    fn generate_change(&self, ctx: &GenerateChangeContext, target: &DatabaseDesignRevision) -> AppResult<GeneratedDatabaseChange>;
}
```

A registry calls only methods whose flag is true; otherwise it returns `DATABASE_ADAPTER_CAPABILITY_UNAVAILABLE`. Partial adapters are legal. V1 adapter ids and minimum flags:

| adapter | detect | declared | migrations | observed | validate | diff | generate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `prisma` | yes | yes | yes | no | yes | yes | yes |
| `drizzle` | yes | yes | yes | no | yes | yes | yes |
| `raw_sql` | yes | yes | yes | no | yes | yes | yes |
| `sqlite` | yes | yes | no | yes | yes | yes | yes |
| `postgres` | yes | no | no | yes | yes | yes | yes |
| `mysql` | yes | no | no | yes | yes | yes | yes |

Detection/extraction reads files as data and must not execute repository code, package scripts, ORM CLIs, migrations, or generated clients.

## 5. Monorepo evidence resolution

1. Enumerate `RepositoryProject` values from repository/workspace metadata and package roots.
2. Each adapter emits evidence with sanitized hints, fingerprints, owner/consumer signals, certainty and confidence.
3. Normalize endpoints into secret-free keys: engine, normalized host/service alias, port, database/catalog, environment-variable symbol, compose service, ORM datasource name. Never persist raw `DATABASE_URL`.
4. Build an evidence graph. Join evidence when any strong key matches: same ORM schema import, same environment symbol resolved through static config, same compose service/database, same SQLite canonical repository-relative file, or explicit profile/source binding. Weak engine-only matches never join.
5. Compute connected components. Split a component when conflicting explicit database/catalog names exist unless a direct alias/import edge proves equivalence.
6. Score owner candidates: ORM/schema declaration `+1.0`; migration directory `+0.9`; DDL definition `+0.8`; compose service in same project `+0.4`; environment reference `+0.1`; import/use-only `0`. Highest score wins if margin is at least `0.20`; otherwise owner is unresolved and an issue is emitted.
7. Consumers are projects with ORM imports, environment references, SQL usage, or explicit profile bindings, excluding the owner unless it also consumes at runtime.
8. Source confidence is weighted evidence confidence minus conflicts, capped `[0,1]`. Persist all evidence-to-source links so the choice is explainable.
9. Display name uses explicit datasource/profile name, then owner package plus engine, then database name, then `Primary <Engine>` for the highest-confidence shared source.

Required fixture outcome: `apps/api` references `DATABASE_URL`; `apps/worker` imports `@repo/db`; `packages/db/schema.prisma` declares PostgreSQL; compose declares the matching Postgres service. The import binds worker to the Prisma owner, the environment/compose keys bind api to the same component. Result is **exactly one** `DatabaseSource` named `Primary PostgreSQL`, owner `packages/db`, consumers `apps/api` and `apps/worker`.

## 6. Immutable design revisions and optimistic concurrency

- `DatabaseDesign` is a movable branch pointer; `DatabaseDesignRevision` and `DatabaseDesignOperation` are immutable.
- `create_draft` accepts exactly one base: snapshot or revision. Independent drafts from the same base share no mutable state.
- Each operation materializes a complete graph revision and appends an operation row in one transaction.
- Request token:

```rust
pub struct DesignConcurrencyToken { pub expected_head_revision_id: RevisionId, pub expected_revision_number: i64 }
```

- Compare token against the design row inside `BEGIN IMMEDIATE`. On mismatch return:

```json
{
  "code": "DATABASE_DESIGN_STALE_REVISION",
  "message": "The database design changed after this operation was prepared.",
  "recoverable": true,
  "details": {
    "designId": "...",
    "expectedHeadRevisionId": "...",
    "actualHeadRevisionId": "...",
    "expectedRevisionNumber": 4,
    "actualRevisionNumber": 5
  }
}
```

No automatic retry or rebase. Approve/reject/archive require the same token. Approval marks a specific head revision approved. Rejection preserves history and records reason. Archive prevents further mutation but does not delete revisions. An approved revision cannot be changed; a new draft must branch from it.

## 7. Persistence: append-only migration 28

`migrations.rs` must change `CURRENT_SCHEMA_VERSION` from `27` to `28`, add one `migrate_v28`, call it from `apply`, and add an installed-schema upgrade preservation test. Do not edit `migrate_v1..migrate_v27`.

```sql
BEGIN IMMEDIATE;

CREATE TABLE database_sources (
  id TEXT PRIMARY KEY, repository_id TEXT NOT NULL, logical_key TEXT NOT NULL,
  display_name TEXT NOT NULL, engine TEXT NOT NULL, owner_project_id TEXT,
  confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
  discovered_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(repository_id, logical_key)
);
CREATE INDEX idx_database_sources_repository ON database_sources(repository_id, updated_at DESC);

CREATE TABLE database_source_evidence (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES database_sources(id) ON DELETE CASCADE,
  repository_id TEXT NOT NULL, project_id TEXT, adapter_id TEXT NOT NULL,
  evidence_kind TEXT NOT NULL, relative_path TEXT NOT NULL, symbol_or_key TEXT,
  safe_value_fingerprint TEXT, source_hint TEXT, owner_signal REAL NOT NULL,
  consumer_signal REAL NOT NULL, certainty TEXT NOT NULL, confidence REAL NOT NULL,
  content_sha256 TEXT NOT NULL, extractor_version TEXT NOT NULL, discovered_at TEXT NOT NULL
);
CREATE INDEX idx_database_evidence_source ON database_source_evidence(source_id, relative_path);

CREATE TABLE database_snapshots (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES database_sources(id) ON DELETE CASCADE,
  layer TEXT NOT NULL CHECK(layer IN ('declared','observed','proposed')),
  adapter_id TEXT NOT NULL, git_revision TEXT, parent_snapshot_id TEXT REFERENCES database_snapshots(id),
  fingerprint TEXT NOT NULL, object_count INTEGER NOT NULL, edge_count INTEGER NOT NULL,
  extractor_version TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT
);
CREATE INDEX idx_database_snapshots_source_layer ON database_snapshots(source_id, layer, created_at DESC);

CREATE TABLE database_objects (
  id TEXT NOT NULL, source_id TEXT NOT NULL REFERENCES database_sources(id) ON DELETE CASCADE,
  snapshot_id TEXT REFERENCES database_snapshots(id) ON DELETE CASCADE,
  design_revision_id TEXT, layer TEXT NOT NULL, object_kind TEXT NOT NULL,
  logical_key TEXT NOT NULL, qualified_name TEXT NOT NULL, parent_object_id TEXT,
  namespace_id TEXT, native_type TEXT, ordinal INTEGER, nullable INTEGER,
  typed_payload_json TEXT NOT NULL, content_fingerprint TEXT NOT NULL,
  confidence REAL NOT NULL, discovered_at TEXT NOT NULL, observed_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY(id, snapshot_id, design_revision_id)
);
CREATE INDEX idx_database_objects_snapshot_kind ON database_objects(snapshot_id, object_kind, qualified_name);
CREATE INDEX idx_database_objects_revision_kind ON database_objects(design_revision_id, object_kind, qualified_name);

CREATE TABLE database_edges (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES database_sources(id) ON DELETE CASCADE,
  snapshot_id TEXT REFERENCES database_snapshots(id) ON DELETE CASCADE,
  design_revision_id TEXT, source_object_id TEXT NOT NULL, target_object_id TEXT NOT NULL,
  edge_type TEXT NOT NULL, confidence REAL NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(snapshot_id, design_revision_id, source_object_id, target_object_id, edge_type)
);
CREATE INDEX idx_database_edges_source_object ON database_edges(snapshot_id, design_revision_id, source_object_id);
CREATE INDEX idx_database_edges_target_object ON database_edges(snapshot_id, design_revision_id, target_object_id);

CREATE TABLE database_object_provenance (
  id TEXT PRIMARY KEY, object_id TEXT NOT NULL, snapshot_id TEXT, design_revision_id TEXT,
  evidence_id TEXT REFERENCES database_source_evidence(id) ON DELETE SET NULL,
  source_kind TEXT NOT NULL, certainty TEXT NOT NULL, confidence REAL NOT NULL,
  evidence_ref TEXT, extractor_version TEXT NOT NULL, observed_at TEXT NOT NULL
);
CREATE INDEX idx_database_provenance_object ON database_object_provenance(object_id, snapshot_id, design_revision_id);

CREATE TABLE database_designs (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES database_sources(id) ON DELETE CASCADE,
  name TEXT NOT NULL, status TEXT NOT NULL, base_snapshot_id TEXT REFERENCES database_snapshots(id),
  base_revision_id TEXT, head_revision_id TEXT NOT NULL, revision_number INTEGER NOT NULL,
  created_by_kind TEXT NOT NULL, created_by_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  approved_revision_id TEXT
);
CREATE INDEX idx_database_designs_source ON database_designs(source_id, updated_at DESC);

CREATE TABLE database_design_revisions (
  id TEXT PRIMARY KEY, design_id TEXT NOT NULL REFERENCES database_designs(id) ON DELETE CASCADE,
  parent_revision_id TEXT REFERENCES database_design_revisions(id),
  merge_parent_revision_id TEXT REFERENCES database_design_revisions(id),
  revision_number INTEGER NOT NULL, state TEXT NOT NULL, graph_fingerprint TEXT NOT NULL,
  created_by_kind TEXT NOT NULL, created_by_id TEXT, created_at TEXT NOT NULL,
  decision_by_kind TEXT, decision_by_id TEXT, decision_at TEXT, decision_reason TEXT,
  UNIQUE(design_id, revision_number)
);

CREATE TABLE database_design_operations (
  id TEXT PRIMARY KEY, design_id TEXT NOT NULL REFERENCES database_designs(id) ON DELETE CASCADE,
  base_revision_id TEXT NOT NULL REFERENCES database_design_revisions(id),
  result_revision_id TEXT NOT NULL REFERENCES database_design_revisions(id),
  sequence INTEGER NOT NULL, operation_kind TEXT NOT NULL, operation_payload_json TEXT NOT NULL,
  actor_kind TEXT NOT NULL, actor_id TEXT, created_at TEXT NOT NULL,
  UNIQUE(design_id, result_revision_id, sequence)
);

CREATE TABLE database_layouts (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES database_sources(id) ON DELETE CASCADE,
  snapshot_id TEXT, design_revision_id TEXT, layout_kind TEXT NOT NULL,
  semantic_lod INTEGER NOT NULL, layout_fingerprint TEXT NOT NULL,
  viewport_json TEXT NOT NULL, positions_json TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(source_id, snapshot_id, design_revision_id, layout_kind, semantic_lod)
);

CREATE TABLE database_diffs (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES database_sources(id) ON DELETE CASCADE,
  comparison_mode TEXT NOT NULL, left_ref TEXT NOT NULL, right_ref TEXT NOT NULL,
  fingerprint TEXT NOT NULL, changes_json TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(source_id, comparison_mode, left_ref, right_ref, fingerprint)
);

CREATE TABLE database_issues (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES database_sources(id) ON DELETE CASCADE,
  snapshot_id TEXT, design_revision_id TEXT, issue_code TEXT NOT NULL, severity TEXT NOT NULL,
  title TEXT NOT NULL, explanation TEXT NOT NULL, status TEXT NOT NULL,
  detected_at TEXT NOT NULL, resolved_at TEXT
);
CREATE INDEX idx_database_issues_source_status ON database_issues(source_id, status, severity);

CREATE TABLE database_usage_refs (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES database_sources(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL, semantic_object_id TEXT, relative_path TEXT NOT NULL, symbol TEXT,
  start_line INTEGER, start_column INTEGER, end_line INTEGER, end_column INTEGER,
  access_kind TEXT NOT NULL, certainty TEXT NOT NULL, confidence REAL NOT NULL,
  content_sha256 TEXT NOT NULL, observed_at TEXT NOT NULL
);
CREATE INDEX idx_database_usage_object ON database_usage_refs(source_id, semantic_object_id);
CREATE INDEX idx_database_usage_path ON database_usage_refs(project_id, relative_path);

CREATE TABLE database_connection_profiles (
  id TEXT PRIMARY KEY, source_id TEXT REFERENCES database_sources(id) ON DELETE SET NULL,
  project_id TEXT NOT NULL, display_name TEXT NOT NULL, engine TEXT NOT NULL,
  host_label TEXT, port INTEGER, database_name TEXT, username_label TEXT,
  credential_reference TEXT NOT NULL, tls_mode TEXT, read_only_default INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(28, datetime('now'));
PRAGMA user_version=28;
COMMIT;
```

`typed_payload_json`, operation payload, diff changes, and layout JSON are serialized **typed versioned Rust values**, not arbitrary maps. They must deserialize through known enums/structs and reject unknown required variants. No table contains a password, raw URL, token, private key, certificate body, or environment value.

## 8. Tauri commands and events

Every request/response is camelCase and Project-scoped where applicable.

| Command | Request | Response |
| --- | --- | --- |
| `database_discover_sources` | `DiscoverDatabaseSourcesRequest { project_id, force }` | `DiscoverDatabaseSourcesResponse { sources, issues, scan_id }` |
| `database_list_sources` | `ListDatabaseSourcesRequest { project_id }` | `Vec<DatabaseSource>` |
| `database_get_source` | `GetDatabaseSourceRequest { project_id, source_id }` | `DatabaseSourceDetail { source, evidence, environments }` |
| `database_get_schema` | `GetDatabaseSchemaRequest { project_id, source_id, layer, snapshot_id, design_revision_id, lod, viewport }` | `DatabaseGraphPage { snapshot, objects, edges, issues, continuation }` |
| `database_get_object` | `GetDatabaseObjectRequest { project_id, source_id, object_id, snapshot_id, design_revision_id }` | `DatabaseObjectDetail` |
| `database_compare` | `CompareDatabaseRequest { project_id, mode }` | `DatabaseDiff` |
| `database_list_migrations` | `ListDatabaseMigrationsRequest { project_id, source_id, snapshot_id }` | `Vec<DatabaseMigration>` |
| `database_list_usage` | `ListDatabaseUsageRequest { project_id, source_id, object_id, limit, continuation }` | `DatabaseUsagePage` |
| `database_list_issues` | `ListDatabaseIssuesRequest { project_id, source_id, status, severity }` | `Vec<DatabaseIssue>` |
| `database_create_connection_profile` | `CreateDatabaseConnectionProfileRequest { project_id, source_id, metadata, credential_reference }` | `DatabaseConnectionProfileSummary` |
| `database_test_connection` | `TestDatabaseConnectionRequest { project_id, profile_id }` | `DatabaseConnectionTestResult` |
| `database_introspect` | `IntrospectDatabaseRequest { project_id, source_id, profile_id, explicit_user_consent: true }` | `DatabaseSnapshot` |
| `database_create_draft` | `CreateDatabaseDraftRequest { project_id, source_id, name, base }` | `DatabaseDesignBundle` |
| `database_list_designs` | `ListDatabaseDesignsRequest { project_id, source_id }` | `Vec<DatabaseDesign>` |
| `database_get_design` | `GetDatabaseDesignRequest { project_id, design_id, revision_id }` | `DatabaseDesignBundle` |
| `database_apply_design_operation` | `ApplyDatabaseDesignOperationRequest { project_id, design_id, token, operation }` | `DatabaseDesignMutationResult { design, revision, token }` |
| `database_approve_design` | `DecideDatabaseDesignRequest { project_id, design_id, token, reason }` | `DatabaseDesignMutationResult` |
| `database_reject_design` | same | `DatabaseDesignMutationResult` |
| `database_archive_design` | same | `DatabaseDesignMutationResult` |
| `database_save_layout` | `SaveDatabaseLayoutRequest { project_id, source_id, snapshot_id, design_revision_id, layout, expected_layout_fingerprint }` | `DatabaseLayout` |
| `database_build_context_pack` | `BuildDatabaseContextPackRequest { project_id, source_id, focus, budget }` | `DatabaseContextPack` |
| `database_implement_design` | `ImplementDatabaseDesignRequest { project_id, design_id, approved_revision_id, execution_mode }` | `DatabaseImplementationRun` |

Events:

- `database-sources-changed`: `{ projectId, scanId, changedSourceIds, removedSourceIds }`
- `database-snapshot-updated`: `{ projectId, sourceId, layer, snapshotId, changedObjectIds, removedObjectIds }`
- `database-design-updated`: `{ projectId, designId, headRevisionId, revisionNumber, changedObjectIds, actor }`
- `database-layout-updated`: `{ projectId, sourceId, snapshotId?, designRevisionId?, layoutFingerprint }`
- `database-issues-updated`: `{ projectId, sourceId, openCountsBySeverity }`
- `database-implementation-progress`: `{ projectId, runId, targetRevisionId, phase, completed, total, message }`

Events are emitted only to windows authorized for the Project, following `FileWatchService` subscription scoping. Incremental events carry IDs and bounded deltas, not a whole 400-table graph.

## 9. Agent capabilities and execution modes

Add `Database` to existing `CapabilityDomain`. Entries are appended to `orchestration/registry.rs::all_descriptors`; dispatch remains in `OrchestrationKernel::execute_capability`/`dispatch`. All entries set `requires_project_scope=true`, `audited=true`, `available=true` when backing service exists, and use JSON Schema in `arg_schema`.

| id | arguments summary | risk | mutates | reversibility |
| --- | --- | --- | ---: | --- |
| `database.list_sources` | none | Low | false | NotApplicable |
| `database.get_schema` | sourceId, layer/ref, lod | Low | false | NotApplicable |
| `database.get_object` | sourceId, objectId, ref | Low | false | NotApplicable |
| `database.compare` | typed comparison mode | Low | false | NotApplicable |
| `database.get_issues` | sourceId, filters | Low | false | NotApplicable |
| `database.get_usage` | sourceId, objectId, limit | Low | false | NotApplicable |
| `database.get_context_pack` | sourceId, focus, budget | Low | false | NotApplicable |
| `database.create_draft` | sourceId, base, name | Medium | true | Paired |
| `database.add_table` | designId, token, typed table | Medium | true | Paired |
| `database.rename_table` | designId, token, tableId, name | Medium | true | Paired |
| `database.drop_table` | designId, token, tableId | High | true | Paired |
| `database.add_column` | designId, token, tableId, typed column | Medium | true | Paired |
| `database.alter_column` | designId, token, columnId, patch | High | true | Paired |
| `database.drop_column` | designId, token, columnId | High | true | Paired |
| `database.add_relationship` | designId, token, typed FK | Medium | true | Paired |
| `database.add_index` | designId, token, typed index | Medium | true | Paired |
| `database.approve_design` | designId, token, reason | High | true | None |
| `database.reject_design` | designId, token, reason | Medium | true | None |
| `database.archive_design` | designId, token | Medium | true | Paired |
| `database.implement_design` | designId, approvedRevisionId | High | true | ViaGit |
| `database.introspect` | sourceId, profileId, explicitUserConsent | Medium | true | NotApplicable |

`mutates=true` includes app-state design writes, even when repository files are untouched. `database.introspect` is mutating because it persists an Observed snapshot.

```rust
pub enum DatabaseExecutionMode { DesignOnly, ImplementDesign }
```

Enforcement occurs in `OrchestrationKernel::execute_capability` before approval policy and before dispatch:

- `DESIGN_ONLY` allows read capabilities and proposed-design mutations only. It rejects `database.implement_design` and any filesystem/Git/repository mutation with `DATABASE_EXECUTION_MODE_DENIED`.
- `IMPLEMENT_DESIGN` requires `approved_revision_id`, verifies that it equals `DatabaseDesign.approved_revision_id`, freezes it as the target in the audit record, then allows `database.implement_design` through normal risk approval.
- The pipeline generates adapter-native repository changes, never generic SQL when a native declared adapter owns the source; re-extracts Declared state; computes declared-to-target delta; success requires zero semantic delta. It does not auto-apply changes to a live database.

## 10. Canvas awareness

Agents receive semantic IDs only. No DOM ids, React Flow ids, pixel node internals, or raw component state.

```rust
pub struct DatabaseCanvasContext {
    pub project_id: ProjectId,
    pub source_id: String,
    pub layer: DatabaseLayer,
    pub snapshot_id: Option<SnapshotId>,
    pub design_revision_id: Option<RevisionId>,
    pub selection: DatabaseCanvasSelection,
    pub viewport: DatabaseCanvasViewport,
    pub comparison: Option<DatabaseComparisonMode>,
    pub semantic_lod: u8,
    pub captured_at: String,
}
pub struct DatabaseCanvasSelection {
    pub primary_object_id: Option<SemanticId>,
    pub object_ids: Vec<SemanticId>,
    pub edge_ids: Vec<String>,
    pub namespace_ids: Vec<SemanticId>,
}
pub struct DatabaseCanvasViewport {
    pub visible_object_ids: Vec<SemanticId>,
    pub visible_namespace_ids: Vec<SemanticId>,
    pub center_object_id: Option<SemanticId>,
    pub zoom_tier: DatabaseZoomTier,
}
pub enum DatabaseZoomTier { Overview, Relationships, Keys, Detail }
```

IDs are validated against the referenced snapshot/revision. Stale selections are dropped with a warning, not resolved by name.

## 11. Bounded context packs

```rust
pub struct DatabaseContextBudget { pub max_objects: u32, pub max_edges: u32, pub max_usage_refs: u32, pub max_issues: u32, pub max_estimated_tokens: u32 }
pub struct DatabaseContextPack { pub source: DatabaseSource, pub reference: DatabaseGraphReference, pub focus_object_ids: Vec<SemanticId>, pub objects: Vec<DatabaseContextObject>, pub edges: Vec<DatabaseEdge>, pub usage_refs: Vec<DatabaseUsageReference>, pub issues: Vec<DatabaseIssue>, pub omitted: DatabaseContextOmissions, pub fingerprint: String }
```

Algorithm:

1. Validate semantic selection and viewport IDs.
2. Seed in order: explicit primary selection, other selected objects, changed objects in active comparison, open error/critical issue objects, viewport center/visible objects.
3. Add ancestors needed for qualification, direct columns/keys for selected tables, then one-hop `REFERENCES`, `MAPS_TO`, `DEPENDS_ON`, `USED_BY`, `READ_BY`, `WRITTEN_BY` neighbors.
4. Rank remaining candidates by `(seed priority, graph distance, issue severity, changed, viewport visibility, confidence)` with stable semantic-id tie-break.
5. Enforce defaults `max_objects=80`, `max_edges=160`, `max_usage_refs=40`, `max_issues=30`, `max_estimated_tokens=12000`; hard ceilings are twice defaults. Summarize namespaces and omitted neighbor counts rather than expanding them.
6. Never include credentials, connection strings, raw environment values, complete SQL bodies, or arbitrary source file contents. Include safe provenance path/symbol/span and fingerprints.
7. For a 400-table schema with no selection, send LOD0 namespace/source summary, top issues, and at most 30 high-signal tables. Never dump all objects.

## 12. Security boundaries

- Discovery never connects. Only `database_introspect` with `explicit_user_consent=true` may resolve a credential reference.
- Connection profile metadata is safe display metadata. Secrets live only in OS credential storage and are addressed by opaque `credential_reference`; deletion/update coordinates with that store but never returns the secret.
- Default introspection is read-only. PostgreSQL uses a read-only transaction/session, MySQL requests read-only transaction/session where supported, SQLite opens read-only URI mode. If enforcement is unavailable, report it and require a separate explicit confirmation. V1 runs no DDL/DML against observed databases.
- Paths are Project-scoped and canonicalized through existing filesystem guards. Static extractors do not execute repository code.
- Apply `orchestration::redaction::redact_json` and `redact_text` before audit persistence, event/error emission, context packing, and logs. Environment values and URLs are fingerprinted after in-memory parsing and then discarded.
- Capability policy remains authoritative. Database Studio must not bypass `policy.rs`, audit recording, operating mode, or Project scope.

## 13. Incremental processing

DB-relevant patterns:

- Prisma: `**/schema.prisma`, `**/prisma/migrations/**/migration.sql`, Prisma config files.
- Drizzle: `**/drizzle.config.{ts,js,mts,mjs,cts,cjs}`, configured schema globs, `**/drizzle/**.{sql,json}`, package manifests/lockfiles only when they change adapter detection.
- Raw SQL/migrations: `**/migrations/**/*.{sql,up,down}`, `**/db/**/*.{sql}`, `**/database/**/*.{sql}`, `**/schema.sql`, adapter-configured DDL paths.
- SQLite: repository files ending `.db`, `.sqlite`, `.sqlite3` only when not ignored/generated and under configured size/safety limits.
- Resolution/config: `.env.example`, `.env.sample`, compose YAML, workspace/package manifests, TypeScript/JavaScript config files that statically define DB bindings. Real `.env` values are not persisted.
- Usage: source files only when a tracked import/symbol index says they reference a known ORM/database package. Do not rescan every source file blindly.

Fingerprint: `sha256(extractor_version + "\0" + adapter_id + "\0" + normalized_relative_path + "\0" + content_bytes)`, with byte length and mtime as fast invalidation hints only. Rename is delete+create from `FileWatchService`; identity reconciliation handles explicit/native rename lineage. Deleted evidence invalidates only its source component. `Button.tsx` that has no tracked DB import matches no predicate and triggers zero extraction, persistence writes, or Database Studio events.

## 14. Performance and semantic LOD

- Persist normalized objects/edges and query by source, reference, kind, viewport/object ids. Do not hydrate the full graph for list/overview.
- LOD0 returns source/namespace aggregates; LOD1 table/view headers and inter-table edges; LOD2 keys plus changed/indexed columns; LOD3 full selected/near-neighbor detail.
- Frontend virtualizes explorer rows and viewport-culls canvas nodes/edges. Stable selectors subscribe to narrow slices.
- Layout is computed in Web Worker/backend worker, never synchronously in React render. Cache key is `(source_id, snapshot_or_revision_fingerprint, layout_kind, lod, preferences_fingerprint)`.
- Incremental graph changes patch layout locally when possible; full layout is cancelable and stale results are rejected by fingerprint.
- B13 fixture: 400 tables must render a bounded viewport projection, context menus/selection remain responsive, and layout execution is observably outside render. Tests assert node/edge materialization bounds, not wall-clock sleeps.

## 15. Test module and naming contract

The module layout is part of the executable contract. Rust tests must be reachable by these exact filter prefixes:

```text
crate::services::database_studio::discovery::tests::*  -> database_studio::discovery
crate::services::database_studio::design::tests::*     -> database_studio::design
crate::services::database_studio::diff::tests::*       -> database_studio::diff
crate::services::database_studio::agent::tests::*      -> database_studio::agent
crate::services::database_studio::pipeline::tests::*   -> database_studio::pipeline
crate::services::database_studio::security::tests::*   -> database_studio::security
```

Required output substrings are enforced by test names: discovery includes `prisma`, `drizzle`, `raw_sql`, `sqlite`, `monorepo_shared_db`, `multi_logical_db`, `duplicate_table_names`; design includes `revision`, `draft`, `stale`; agent includes `design_only`, `implement_design`, `selection`. Diff includes a formatting-only-empty test. Pipeline includes target-versus-result zero-delta. Security includes no-credential-persisted and no-auto-connect. Migration tests remain under `database::migrations`. Frontend B13 uses a filename containing `largeSchema`, for example `src/features/database/canvas/largeSchema.bench.test.ts`.

## 16. Acceptance criteria and scoreboard mapping

| WP | Contract acceptance | Scoreboard |
| --- | --- | --- |
| WP1 Architect | Both owned files exist; all named types/edges/adapters/tables/commands/events/capabilities are specified; repository paths/symbols are cited; ownership table matches plan. | Enables B1-B14; Gate 1 review. |
| WP2 Backend | Rust model compiles; migration 28 upgrades installed v27 preserving unrelated data; discovery fixtures cover Prisma, Drizzle, raw SQL, SQLite, shared monorepo, multiple DBs, duplicate names; structural diff ignores formatting; security tests prove no secret persistence/no auto-connect. | B1, B2, B3, B7, B9, B12, B14. |
| WP3 UI | Typed feature store/selectors/tests; routed Project surface; explorer/canvas/inspector/design/comparison/issues; theme tokens; 400-table bounded rendering and off-path layout. | B4, B5, B6, B13, B14. |
| WP4 Builder | Commands registered; events wired; descriptors use existing registry/kernel; DESIGN_ONLY denial and IMPLEMENT_DESIGN target tests; approved native implementation re-extracts to zero delta. | B1, B2, B8, B10, B11, B12, B14. |
| WP5 Hardening | Full existing suites remain green, no tests disabled/assertions removed, dev app reaches Database Studio. | B1-B14 and Gates 9/10. |

Explicit check contracts:

- **B1** all Rust types, commands, adapters, registry additions compile across targets.
- **B2** existing backend suite plus Database Studio tests pass.
- **B3** `CURRENT_SCHEMA_VERSION = 28`, `migrate_v28`, preservation test.
- **B4** frontend contracts and feature typecheck.
- **B5** oxlint clean, no suppressions added for the feature.
- **B6** feature/store/component tests and existing Vitest suite pass.
- **B7** seven named discovery fixtures print/assert their names.
- **B8** immutable revisions, independent drafts, and exact stale error tested.
- **B9** semantic formatting-only diff is empty.
- **B10** tests name `design_only`, `implement_design`, and `selection` and enforce them.
- **B11** approved target generates native change, re-extracts, and has zero delta.
- **B12** no credentials persisted and no automatic connection.
- **B13** 400-table bounded render plus off-render-path layout.
- **B14** no disabled tests, deleted assertions, or verification bypasses.

## 17. File ownership, exact collision boundary

| Work package | Owner | Files |
| --- | --- | --- |
| WP1 | Architect | `.jcode/dbstudio/CONTRACTS.md`, `.jcode/dbstudio/ARCHITECTURE.md` |
| WP2 | Backend Engineer | `Paralith-tauri/src-tauri/src/models/database_studio.rs` and submodules; `src-tauri/src/database/database_studio.rs`; append-only `src-tauri/src/database/migrations.rs`; `src-tauri/src/services/database_studio/**`; `src-tauri/tests/fixtures/database_studio/**` |
| WP3 | UI/UX Engineer | `Paralith-tauri/src/features/database/**`; one minimal additive routing/nav edit in `src/screens/` and sidebar |
| WP4 | Builder / Integration | `src-tauri/src/commands/database_commands.rs`; command registration in `src-tauri/src/lib.rs`; additions to `src-tauri/src/orchestration/registry.rs`; database dispatch in `src-tauri/src/orchestration/kernel.rs`; `src-tauri/src/services/database_studio/pipeline/**`; `src/features/database/api.ts` by agreement with UI |
| WP5 | Assigned by coordinator | Only files assigned for a scoreboard-proven failure |
| Reviewer | Reviewer | `.jcode/dbstudio/gate-*.md` only |

Cross-boundary requirements go through the coordinator. WP2 must not register commands/capabilities. WP3 must not make React authoritative. WP4 consumes WP2/WP3 contracts and must not duplicate adapters, graph persistence, or UI state.

## 18. Verified precedents and named implementation gaps

- `database/migrations.rs` currently declares `CURRENT_SCHEMA_VERSION: i64 = 27`, uses a numbered `apply` ladder, and contains `upgrades_installed_schema_10_to_current_preserving_data`.
- `database/mod.rs` owns `DatabaseService` and existing transactional persistence behavior.
- `services/repository_intelligence.rs` `GraphBuilder::provenance` persists source, repository, snapshot, observed time, extractor version, confidence and evidence reference; `Origin::heuristic` requires confidence and evidence.
- `services/file_watch_service.rs` owns one recursive watcher per Project, debounces/coalesces, filters self-writes, and emits `project-file-changed` batches.
- `orchestration/registry.rs` defines camelCase `CapabilityDescriptor` with `id`, `arg_schema`, `requires_project_scope`, `risk`, `reversibility`, `mutates`, `timeout_ms`, `audited`, availability fields; `kernel.rs` owns execution/dispatch; `model.rs` defines `RiskLevel` and `Reversibility`; `redaction.rs` owns text/JSON scrubbing.
- `src/features/repository/repositoryStore.ts`, `repositorySelectors.ts`, `repositoryTypes.ts`, and tests establish the frontend feature precedent. `src/theme/tokens.ts` is the semantic token source.
- No Database Studio implementation, OS credential-store abstraction, PostgreSQL/MySQL Database Studio client, adapter registry, semantic diff engine, or verified canvas layout worker was found in the inspected paths. These are named additions, not assumed capabilities. Git-revision comparison additionally requires a guarded, non-checkout file-at-revision reader from repository services.

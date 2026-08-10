# Paralith Database Studio Implementation Contracts

Contract version: 1.0. Serde rule: every public Rust struct below uses `#[serde(rename_all = "camelCase")]`; every public enum uses `#[serde(rename_all = "snake_case")]` unless an explicit wire value is shown. IDs and timestamps are UTF-8 strings; timestamps are RFC 3339 UTC. Critical architecture is represented by typed columns/fields, never opaque JSON.

## 0. V1 scope authority

This table is normative. Tier 2 work is **out of V1 and is not registered, dispatched, shown as a control, or shipped as a failing stub**.

| Tier | Area | V1 decision |
| --- | --- | --- |
| KEEP (Tier 1) | Canonical semantic model and typed edges | Full §2/§2.1 model. |
| KEEP (Tier 1) | Qualified identity | Full identity contract below, including synthetic name-independent Proposed IDs. |
| KEEP (Tier 1) | Migration 28 | Sentinel-backed uniqueness, revision FKs, feature predicates, and preservation tests are mandatory. |
| KEEP (Tier 1) | Declared extraction | Prisma, Drizzle, and raw SQL, by static file parsing only. |
| KEEP (Tier 1) | Monorepo evidence resolution | Full §5 algorithm and fixtures. |
| KEEP (Tier 1) | Immutable design revisions and CAS | Full §6 contract with the mandated conditional-update statement order. |
| KEEP (Tier 1) | Semantic structural diff | Full §3 behavior, including formatting-only-empty. |
| KEEP (Tier 1) | Deterministic health | Pure graph rules for missing PK, FK type mismatch, broken reference, duplicate index, and destructive proposed change. No LLM detection. |
| KEEP (Tier 1) | Agent capability policy | Registered `database.*` descriptors, `CapabilityDomain::Database`, and `DESIGN_ONLY`/`IMPLEMENT_DESIGN` enforcement in `policy::evaluate`. |
| KEEP (Tier 1) | Canvas awareness | WP4-owned publish command plus `database.get_canvas_state` and `database.get_selection`; WP3 is the caller. |
| KEEP (Tier 1) | Bounded context packs | Full §11 limits and selection-aware packing. |
| KEEP (Tier 1) | UI | Overview, Diagram, Explorer, Inspector, Design mode, Changes, and Health, with LOD and off-render-path layout. |
| KEEP (Tier 1) | Tauri seam | Commands/events for every Tier 1 and Tier 1.5 behavior only. |
| KEEP (Tier 1) | Security verification | No credential persistence and no auto-connect, asserted against persisted row contents. |
| KEEP-REDUCED (Tier 1.5) | Observed layer | Read-only SQLite file introspection only, using existing `rusqlite`; no credential store, new crate, or network. |
| KEEP-REDUCED (Tier 1.5) | Implementation pipeline | Stages 1-7 and 13-14 for Prisma and raw SQL. Stages 8-9 only through the explicit §9.1 allow-list after authorization. Drizzle generation is excluded. |
| KEEP-REDUCED (Tier 1.5) | Code usage and impact | Import/definition evidence only, always with explicit `EvidenceCertainty`; no read/write query analysis. |
| DEFER (Tier 2) | PostgreSQL/MySQL network introspection | No driver, pool, or credential store. Keep trait extension points; do not register adapters. |
| DEFER (Tier 2) | OS credential store, `database_test_connection`, network `database_introspect` | Commands are absent, not failing stubs. `DatabaseCredentialLease` remains a future, non-dispatched contract. |
| DEFER (Tier 2) | External Claude Code/Codex MCP bridge | No bridge exists. V1 agent operability is the in-app orchestrator only. `INTEGRATION-AUDIT.md` §3 is the accepted future direction, with no V1 implementation. |
| DEFER (Tier 2) | Git-revision-to-Git-revision comparison | Requires a guarded non-checkout blob reader. The V1 wire/API does not expose this mode. |
| DEFER (Tier 2) | Live/dev database mutation, migration application, production apply | Requires the deferred connection layer. Pipeline verification targets re-extracted Declared state only. |
| DEFER (Tier 2) | `database.analyze_design`, `database.get_impact`, `database.compare_target_to_database` | Depend on deferred layers or non-deterministic analysis; descriptors are not registered. |
| DEFER (Tier 2) | Drizzle native change generation | Safe TypeScript AST rewriting is outside V1. Drizzle still detects, extracts, reads migrations, validates, and diffs. |

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
    pub id: SemanticId,                 // layer-specific stable identity
    pub logical_key: String,            // never inferred from Proposed qualified_name
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

Declared and Observed identities use `id = "db:" + kind + ":" + base32_lower(sha256(repository_id + "\0" + source_logical_key + "\0" + object_logical_key))`. Proposed identity is intentionally different: on object creation allocate `id = "db:" + kind + ":p_" + ulid_lower()` (UUIDv7 is also acceptable if chosen once for the implementation). That synthetic ID is copied unchanged into every descendant revision. A Proposed object's name exists only in `qualified_name`; rename operations never recompute `id` or `logical_key`.

- `repository_id` is the existing Project/repository stable id.
- `source_logical_key` is selected in order: explicit connection-profile id; normalized database URL **without userinfo, password, query secrets, or host credentials** plus database name; compose service + database name; schema-owner package path + adapter; otherwise evidence-cluster hash.
- `object_logical_key` is selected in order: adapter-native stable id; migration lineage id; ORM mapped name identity; `(namespace logical key, object kind, canonical name)`. Child keys append parent logical key and ordinal-independent native name.
- Case folding follows engine rules: PostgreSQL unquoted names lower-case, MySQL comparison uses adapter-reported case mode, SQLite case-insensitive ASCII. Quoted identifiers preserve exact spelling.
- Declared adapters in V1 are name-derived. When a migration or the approved design operation log proves a rename, the reconciler emits the new name-derived `id` and appends the old `id` to `previous_ids`; semantic diff then emits `Renamed` rather than unrelated drop/add. `RenameTable` itself preserves the Proposed synthetic `id` and records the pre-implementation Declared id as lineage for later reconciliation. A structural heuristic at confidence `>=0.90` may emit a rename issue/proposal but still requires confirmation before linking identity. Below `0.90`, it emits a `possible_rename` issue containing both object IDs and confidence, leaves identities distinct, and emits the ordinary add/drop diff; it never silently links or auto-proposes a design operation.
- Selection, layout pins, issue references, usage references, and Proposed edges are keyed by the unchanged Proposed `id`, so a proposed rename cannot invalidate them.
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
}
pub struct DatabaseDiff { pub id: String, pub source_id: String, pub mode: DatabaseComparisonMode, pub changes: Vec<DatabaseChange>, pub fingerprint: String, pub created_at: String }
pub struct DatabaseChange { pub kind: DatabaseChangeKind, pub object_id: Option<SemanticId>, pub before_fingerprint: Option<String>, pub after_fingerprint: Option<String>, pub breaking: bool, pub destructive: bool, pub summary: String }
pub enum DatabaseChangeKind { Add, Drop, Rename, Alter, Move, Reorder, DataMigrationRequired }
```

Git-revision comparison is not a V1 wire variant. Adding it later requires the Tier 2 guarded non-checkout blob reader and a contract-version change.

Diff is semantic. Formatting, comments not represented in a semantic field, migration file whitespace, and declaration ordering outside order-sensitive constructs produce no change.

### 3.1 Deterministic V1 health rules

Health evaluation is a pure, ordered function of one canonical graph or one typed diff. It never calls an LLM. It emits stable issue ids from `(source_id, reference_id, issue_code, sorted_object_ids)` and these exact codes:

| Code | Deterministic predicate |
| --- | --- |
| `MISSING_PRIMARY_KEY` | A persisted table has no `PRIMARY_KEY` edge/object. Views and explicitly adapter-marked keyless read models are excluded. |
| `FK_TYPE_MISMATCH` | Referencing and referenced columns have unequal canonical scalar type, array shape, or signedness after adapter normalization. |
| `BROKEN_REFERENCE` | An edge endpoint is absent from the same snapshot/revision, or an FK column/target-key cardinality differs. |
| `DUPLICATE_INDEX` | Two indexes on one table have identical ordered column/expression ids, uniqueness, predicate fingerprint, and method. |
| `DESTRUCTIVE_PROPOSED_CHANGE` | A Declared-to-Proposed diff contains `Drop`, a nullable-to-required alteration without a default/backfill, or a narrowing canonical type conversion. |

Evaluation order is the table order above, then semantic id. Re-evaluation upserts matching open issues and resolves no-longer-matching issues; it does not duplicate them.

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
// Tier 2 extension contracts only: no V1 constructor, command, table, or dispatch path.
pub struct DatabaseConnectionProfileSummary { pub id: String, pub source_id: Option<String>, pub project_id: String, pub display_name: String, pub engine: DatabaseEngine, pub credential_reference: String, pub read_only_default: bool }
pub struct DatabaseSecret(String); // private field; no Debug/Serialize/Clone; zeroized on drop by future implementation
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
| `drizzle` | yes | yes | yes | no | yes | yes | no |
| `raw_sql` | yes | yes | yes | no | yes | yes | yes |
| `sqlite` | yes | yes | no | yes | yes | yes | no |

PostgreSQL and MySQL are absent from the V1 registered adapter table. Their enum variants and trait extension points remain so a later adapter needs no graph-engine redesign. `sqlite` Observed support means an explicit user-selected repository-local file opened with SQLite read-only URI flags. It does not use a connection profile or credential lease. Network introspection methods and credential types remain trait extension points but have no V1 command or dispatch path. Detection/extraction reads files as data and **never** executes repository code, package scripts, ORM CLIs, migrations, or generated clients. Authorized implementation execution is a separate boundary defined in §9.1.

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
- Each operation materializes a complete graph revision and appends an operation row in one `BEGIN IMMEDIATE` transaction, using the mandatory order below.
- Request token:

```rust
pub struct DesignConcurrencyToken { pub expected_head_revision_id: RevisionId, pub expected_revision_number: i64 }
```

- Statement order is normative: (1) allocate the result revision id/number in memory; (2) execute exactly one conditional head advance, `UPDATE database_designs SET head_revision_id=:result, revision_number=:next, updated_at=:now WHERE id=:design_id AND head_revision_id=:expected_head AND revision_number=:expected_number`; (3) if `rows_affected != 1`, read the actual head/number, roll back, and return the typed error below; (4) only after a successful update insert the immutable `database_design_revisions` row and then the `database_design_operations` row; (5) commit. The temporary head reference is valid inside the transaction because `head_revision_id` deliberately has no FK and rollback restores it on any later failure. A residual `UNIQUE(design_id, revision_number)` violation is caught and mapped to the same typed stale error after reading actual tokens, never exposed as a raw rusqlite error.

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

`migrations.rs` must change `CURRENT_SCHEMA_VERSION` from `27` to `28`, add one `migrate_v28`, call it from `apply` using `if current < 28 || !table_exists(connection, "database_sources")?`, add the same `!table_exists(connection, "database_sources")?` feature predicate to `requires_migration`, and add an installed-schema upgrade preservation test. Do not edit `migrate_v1..migrate_v27`.

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
  snapshot_id TEXT NOT NULL DEFAULT '', design_revision_id TEXT NOT NULL DEFAULT '',
  snapshot_ref TEXT GENERATED ALWAYS AS (NULLIF(snapshot_id, '')) STORED REFERENCES database_snapshots(id) ON DELETE CASCADE,
  design_revision_ref TEXT GENERATED ALWAYS AS (NULLIF(design_revision_id, '')) STORED REFERENCES database_design_revisions(id) ON DELETE CASCADE,
  layer TEXT NOT NULL, object_kind TEXT NOT NULL,
  logical_key TEXT NOT NULL, qualified_name TEXT NOT NULL, parent_object_id TEXT,
  namespace_id TEXT, native_type TEXT, ordinal INTEGER, nullable INTEGER,
  payload_version INTEGER NOT NULL, typed_payload_json TEXT NOT NULL, content_fingerprint TEXT NOT NULL,
  confidence REAL NOT NULL, discovered_at TEXT NOT NULL, observed_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK ((snapshot_id <> '' AND design_revision_id = '') OR (snapshot_id = '' AND design_revision_id <> '')),
  PRIMARY KEY(id, snapshot_id, design_revision_id),
  UNIQUE(id, snapshot_id, design_revision_id)
);
CREATE INDEX idx_database_objects_snapshot_kind ON database_objects(snapshot_id, object_kind, qualified_name);
CREATE INDEX idx_database_objects_revision_kind ON database_objects(design_revision_id, object_kind, qualified_name);

CREATE TABLE database_edges (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES database_sources(id) ON DELETE CASCADE,
  snapshot_id TEXT NOT NULL DEFAULT '', design_revision_id TEXT NOT NULL DEFAULT '',
  snapshot_ref TEXT GENERATED ALWAYS AS (NULLIF(snapshot_id, '')) STORED REFERENCES database_snapshots(id) ON DELETE CASCADE,
  design_revision_ref TEXT GENERATED ALWAYS AS (NULLIF(design_revision_id, '')) STORED REFERENCES database_design_revisions(id) ON DELETE CASCADE,
  source_object_id TEXT NOT NULL, target_object_id TEXT NOT NULL,
  edge_type TEXT NOT NULL, confidence REAL NOT NULL, created_at TEXT NOT NULL,
  CHECK ((snapshot_id <> '' AND design_revision_id = '') OR (snapshot_id = '' AND design_revision_id <> '')),
  UNIQUE(snapshot_id, design_revision_id, source_object_id, target_object_id, edge_type)
);
CREATE INDEX idx_database_edges_source_object ON database_edges(snapshot_id, design_revision_id, source_object_id);
CREATE INDEX idx_database_edges_target_object ON database_edges(snapshot_id, design_revision_id, target_object_id);

CREATE TABLE database_object_provenance (
  id TEXT PRIMARY KEY, object_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL DEFAULT '', design_revision_id TEXT NOT NULL DEFAULT '',
  snapshot_ref TEXT GENERATED ALWAYS AS (NULLIF(snapshot_id, '')) STORED REFERENCES database_snapshots(id) ON DELETE CASCADE,
  design_revision_ref TEXT GENERATED ALWAYS AS (NULLIF(design_revision_id, '')) STORED REFERENCES database_design_revisions(id) ON DELETE CASCADE,
  evidence_id TEXT REFERENCES database_source_evidence(id) ON DELETE SET NULL,
  source_kind TEXT NOT NULL, certainty TEXT NOT NULL, confidence REAL NOT NULL,
  evidence_ref TEXT, extractor_version TEXT NOT NULL, observed_at TEXT NOT NULL,
  CHECK ((snapshot_id <> '' AND design_revision_id = '') OR (snapshot_id = '' AND design_revision_id <> ''))
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
  sequence INTEGER NOT NULL, operation_kind TEXT NOT NULL, payload_version INTEGER NOT NULL,
  operation_payload_json TEXT NOT NULL,
  actor_kind TEXT NOT NULL, actor_id TEXT, created_at TEXT NOT NULL,
  UNIQUE(design_id, result_revision_id, sequence)
);

CREATE TABLE database_layouts (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES database_sources(id) ON DELETE CASCADE,
  snapshot_id TEXT NOT NULL DEFAULT '', design_revision_id TEXT NOT NULL DEFAULT '',
  snapshot_ref TEXT GENERATED ALWAYS AS (NULLIF(snapshot_id, '')) STORED REFERENCES database_snapshots(id) ON DELETE CASCADE,
  design_revision_ref TEXT GENERATED ALWAYS AS (NULLIF(design_revision_id, '')) STORED REFERENCES database_design_revisions(id) ON DELETE CASCADE,
  layout_kind TEXT NOT NULL,
  semantic_lod INTEGER NOT NULL, layout_fingerprint TEXT NOT NULL,
  viewport_json TEXT NOT NULL, positions_json TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK ((snapshot_id <> '' AND design_revision_id = '') OR (snapshot_id = '' AND design_revision_id <> '')),
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
  snapshot_id TEXT NOT NULL DEFAULT '', design_revision_id TEXT NOT NULL DEFAULT '',
  snapshot_ref TEXT GENERATED ALWAYS AS (NULLIF(snapshot_id, '')) STORED REFERENCES database_snapshots(id) ON DELETE CASCADE,
  design_revision_ref TEXT GENERATED ALWAYS AS (NULLIF(design_revision_id, '')) STORED REFERENCES database_design_revisions(id) ON DELETE CASCADE,
  issue_code TEXT NOT NULL, severity TEXT NOT NULL,
  title TEXT NOT NULL, explanation TEXT NOT NULL, status TEXT NOT NULL,
  detected_at TEXT NOT NULL, resolved_at TEXT,
  CHECK ((snapshot_id <> '' AND design_revision_id = '') OR (snapshot_id = '' AND design_revision_id <> ''))
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

INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(28, datetime('now'));
PRAGMA user_version=28;
COMMIT;
```

`typed_payload_json`, operation payload, diff changes, and layout JSON are serialized typed values, not arbitrary maps. Object and operation payloads carry mandatory `payload_version`; readers dispatch by that version and reject unknown required variants. No table contains a password, raw URL, token, credential reference, private key, certificate body, or environment value. The generated `snapshot_ref`/`design_revision_ref` columns convert the required empty-string discriminator sentinel to SQL NULL only for FK enforcement, so both uniqueness and referential integrity are database-held invariants.

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
| `database_introspect_sqlite_file` | `IntrospectSqliteFileRequest { project_id, source_id, project_relative_path, explicit_user_consent: true }` | `DatabaseSnapshot` |
| `database_create_draft` | `CreateDatabaseDraftRequest { project_id, source_id, name, base }` | `DatabaseDesignBundle` |
| `database_list_designs` | `ListDatabaseDesignsRequest { project_id, source_id }` | `Vec<DatabaseDesign>` |
| `database_get_design` | `GetDatabaseDesignRequest { project_id, design_id, revision_id }` | `DatabaseDesignBundle` |
| `database_apply_design_operation` | `ApplyDatabaseDesignOperationRequest { project_id, design_id, token, operation }` | `DatabaseDesignMutationResult { design, revision, token }` |
| `database_approve_design` | `DecideDatabaseDesignRequest { project_id, design_id, token, reason }` | `DatabaseDesignMutationResult` |
| `database_reject_design` | same | `DatabaseDesignMutationResult` |
| `database_archive_design` | same | `DatabaseDesignMutationResult` |
| `database_save_layout` | `SaveDatabaseLayoutRequest { project_id, source_id, snapshot_id, design_revision_id, layout, expected_layout_fingerprint }` | `DatabaseLayout` |
| `database_build_context_pack` | `BuildDatabaseContextPackRequest { project_id, source_id, focus, budget }` | `DatabaseContextPack` |
| `database_publish_canvas_state` | `PublishDatabaseCanvasStateRequest { project_id, context }` | `DatabaseCanvasStateReceipt { fingerprint, captured_at }` |
| `database_implement_design` | `ImplementDatabaseDesignRequest { project_id, design_id, approved_revision_id, execution_mode }` | `DatabaseImplementationRun` |

Events:

- `database-sources-changed`: `{ projectId, scanId, changedSourceIds, removedSourceIds }`
- `database-snapshot-updated`: `{ projectId, sourceId, layer, snapshotId, changedObjectIds, removedObjectIds }`
- `database-design-updated`: `{ projectId, designId, headRevisionId, revisionNumber, changedObjectIds, actor }`
- `database-layout-updated`: `{ projectId, sourceId, snapshotId?, designRevisionId?, layoutFingerprint }`
- `database-issues-updated`: `{ projectId, sourceId, openCountsBySeverity }`
- `database-implementation-progress`: `{ projectId, runId, targetRevisionId, phase, completed, total, message }`

Events are emitted only to windows authorized for the Project, following `FileWatchService` subscription scoping. Incremental events carry IDs and bounded deltas, not a whole 400-table graph. WP4 owns and registers `database_publish_canvas_state` and its bounded backend session cache; WP3 calls it after debounced semantic selection/viewport changes. The state is ephemeral, Project/window/session scoped, and never authoritative graph persistence.

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
| `database.get_canvas_state` | none; uses bound project/session | Low | false | NotApplicable |
| `database.get_selection` | none; returns semantic selection from bound canvas state | Low | false | NotApplicable |
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
| `database.introspect_sqlite_file` | sourceId, projectRelativePath, explicitUserConsent | Medium | true | NotApplicable |

`mutates=true` includes app-state design writes, even when repository files are untouched. SQLite file introspection is mutating because it persists an Observed snapshot.

### 9.0 Deliberately not registered in V1

This table reconciles every additional mission/audit-suggested capability id. These IDs are absent from `all_descriptors`; equivalent behavior, where noted, uses the authoritative V1 id rather than duplicate aliases.

| Suggested id not registered | Reason / V1 path |
| --- | --- |
| `database.inspect_project` | Discovery is explicit through `database.list_sources` plus the Tauri discovery command; no duplicate agent scan trigger. |
| `database.get_table` | Alias omitted; `database.get_object` returns typed table detail. |
| `database.search` | Deferred to avoid an unbounded query surface; V1 context packs and schema paging provide bounded access. |
| `database.get_relationships` | Alias omitted; relationships are typed edges in `database.get_schema`/`database.get_object`. |
| `database.get_provenance` | Alias omitted; provenance is included in object detail/context packs. |
| `database.get_active_design` | Alias omitted; V1 uses design list/get commands and `database.create_draft`. |
| `database.get_design_revision` | Alias omitted; V1 design retrieval is command-backed and context-pack accessible. |
| `database.create_design` | V1 `database.create_draft` creates the design and first immutable revision atomically. |
| `database.compare_designs` | Alias omitted; `database.compare` accepts typed Declared/Proposed/design refs. |
| `database.remove_table` | Alias omitted; authoritative id is `database.drop_table`. |
| `database.modify_column` | Alias omitted; authoritative id is `database.alter_column`. |
| `database.remove_column` | Alias omitted; authoritative id is `database.drop_column`. |
| `database.remove_relationship` | Deferred operation breadth; V1 relationship removal may be represented only by a complete approved native plan, not an exposed draft capability. |
| `database.add_constraint` | V1 exposes typed PK/FK via table/column/relationship operations; general constraint mutation is deferred. |
| `database.add_enum` | Deferred operation breadth; enum objects remain readable/diffable. |
| `database.validate_design` | Deterministic validation runs automatically after each design mutation and before approval; no duplicate manual capability. |
| `database.analyze_design` | Tier 2: non-deterministic analysis is outside V1. |
| `database.get_impact` | Tier 2: full impact/read-write analysis is outside reduced usage scope. |
| `database.compare_target_to_repository` | Alias omitted; implementation pipeline performs this mandatory comparison internally. |
| `database.compare_target_to_database` | Tier 2: depends on deferred network Observed support. |
| `database.create_implementation_plan` | Internal mandatory pipeline stage, not a separately invocable capability. |
| `database_test_connection` | Tier 2 and command absent: no credential store or network driver. |
| `database_introspect` | Tier 2 network command absent; only `database.introspect_sqlite_file` is registered. |

### 9.1 Authorized implementation command boundary and independent validation

Discovery and extraction never execute repository code. Only `database.implement_design`, in `IMPLEMENT_DESIGN`, after policy authorization of the exact approved revision and native change plan, may execute commands. Execution occurs through `RepositoryService` inside the agent's leased worktree, with canonical Project-relative paths, a scrubbed environment, no shell interpolation, no lifecycle hooks, no arbitrary package scripts, and an argv allow-list.

The V1 argv allow-list is exhaustive:

1. For a repository whose detected package manager is npm: `npm exec -- prisma validate --schema <project-relative-schema>` and `npm exec -- prisma migrate diff --from-schema-datamodel <current-schema> --to-schema-datamodel <target-schema> --script`.
2. pnpm equivalents: `pnpm exec prisma validate --schema ...` and `pnpm exec prisma migrate diff ... --script`.
3. Yarn equivalents: `yarn prisma validate --schema ...` and `yarn prisma migrate diff ... --script`.
4. Bun equivalents: `bunx prisma validate --schema ...` and `bunx prisma migrate diff ... --script`.
5. Raw SQL generation executes no repository command; it writes the authorized migration file directly.

No `migrate dev`, `migrate deploy`, `db push`, arbitrary `run`, test script, generated client, or database connection command is allowed. The package-manager executable and local Prisma package must already be present in the repository lock/install state; the pipeline does not download packages.

Zero delta is necessary but not self-certifying. Prisma success additionally requires the Prisma CLI `validate` command above, a generated migration whose SQL passes a parser-independent statement-boundary/destructive-operation classifier, and a canonical assertion that every target namespace/object/edge fingerprint is represented after static re-extraction. Raw SQL success requires the independent SQL classifier plus the same target fingerprint assertion. Adapter `validate`, native validation, independent classification/assertion, and re-extracted semantic zero delta must all pass; otherwise the run fails and leaves reviewable worktree changes without claiming success.

```rust
pub enum DatabaseExecutionMode { DesignOnly, ImplementDesign }
```

Enforcement occurs in `OrchestrationKernel::execute_capability` before approval policy and before dispatch:

- `DESIGN_ONLY` allows read capabilities and proposed-design mutations only. It rejects `database.implement_design` and any filesystem/Git/repository mutation with `DATABASE_EXECUTION_MODE_DENIED`.
- `IMPLEMENT_DESIGN` requires `approved_revision_id`, verifies that it equals `DatabaseDesign.approved_revision_id`, freezes it as the target in the audit record, then allows `database.implement_design` through normal risk approval.
- The V1 pipeline generates Prisma-native or raw-SQL repository changes only, follows §9.1, re-extracts Declared state, and computes declared-to-target delta. Success requires every independent validation plus zero semantic delta. It never applies changes to a live database.

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

IDs are validated against the referenced snapshot/revision. Stale selections are dropped with a warning, not resolved by name. Proposed renames retain their synthetic IDs, so selection, pins, and issue references remain valid across the rename.

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

- Discovery never connects. Only `database_introspect_sqlite_file` with explicit consent may open a user-selected repository-local SQLite file, using read-only URI mode.
- V1 has no connection-profile command, credential resolution, credential persistence, network driver, or network introspection path. The credential structs in §4 are future trait contracts only.
- V1 runs no DDL/DML against observed databases and never opens an Observed SQLite file writable.
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

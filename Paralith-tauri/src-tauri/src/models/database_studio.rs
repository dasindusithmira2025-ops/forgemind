#![allow(dead_code)]

use serde::{Deserialize, Serialize};

pub type SemanticId = String;
pub type SnapshotId = String;
pub type DesignId = String;
pub type RevisionId = String;
pub type ProjectId = String;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SemanticIdentity {
    pub id: SemanticId,
    pub logical_key: String,
    pub qualified_name: String,
    pub previous_ids: Vec<SemanticId>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseObjectMeta {
    pub identity: SemanticIdentity,
    pub source_id: String,
    pub layer: DatabaseLayer,
    pub snapshot_id: Option<SnapshotId>,
    pub design_revision_id: Option<RevisionId>,
    pub confidence: f32,
    pub provenance_ids: Vec<String>,
    pub discovered_at: String,
    pub observed_at: String,
    pub updated_at: String,
    pub content_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseLayer {
    Declared,
    Observed,
    Proposed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseEngine {
    Postgres,
    Mysql,
    Mariadb,
    Sqlite,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseAdapterId {
    Prisma,
    Drizzle,
    RawSql,
    Sqlite,
    Postgres,
    Mysql,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceCertainty {
    Exact,
    Heuristic,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryProject {
    pub id: ProjectId,
    pub repository_id: String,
    pub name: String,
    pub root_relative_path: String,
    pub package_manager: Option<String>,
    pub workspace_kind: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseEvidenceKind {
    OrmSchema,
    OrmImport,
    MigrationDirectory,
    SqlDdl,
    EnvironmentReference,
    ComposeService,
    ConnectionConfig,
    SqliteFile,
    CodeUsage,
    ExplicitProfile,
}

macro_rules! simple_enum {
    ($name:ident { $($variant:ident),+ $(,)? }) => {
        #[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
        #[serde(rename_all = "snake_case")]
        pub enum $name { $($variant),+ }
    };
}

simple_enum!(DatabaseEnvironmentKind {
    Local,
    Development,
    Test,
    Staging,
    Production,
    Unknown
});
simple_enum!(DatabaseTypeFamily {
    Boolean,
    Integer,
    Decimal,
    Float,
    Text,
    Binary,
    Date,
    Time,
    DateTime,
    Json,
    Uuid,
    Enum,
    Geometry,
    Custom
});
simple_enum!(IdentityGeneration {
    Always,
    ByDefault,
    AutoIncrement
});
simple_enum!(ReferentialAction {
    NoAction,
    Restrict,
    Cascade,
    SetNull,
    SetDefault
});
simple_enum!(SortDirection { Asc, Desc });
simple_enum!(NullsOrder { First, Last });
simple_enum!(MigrationAppliedState {
    DeclaredOnly,
    Applied,
    Missing,
    Diverged,
    Unknown
});
simple_enum!(DatabaseAccessKind {
    Import,
    Read,
    Write,
    ReadWrite,
    Definition,
    Migration
});
simple_enum!(DatabaseSnapshotStatus {
    Building,
    Ready,
    Failed,
    Superseded
});
simple_enum!(DatabaseDesignStatus {
    Draft,
    Approved,
    Rejected,
    Archived
});
simple_enum!(DatabaseDesignRevisionState {
    Draft,
    Approved,
    Rejected,
    Archived
});
simple_enum!(DatabaseIssueCode {
    Drift,
    MissingPrimaryKey,
    BrokenReference,
    DuplicateIdentity,
    UnsafeChange,
    UnresolvedEvidence,
    UnsupportedFeature,
    ConnectionUnavailable,
    FkTypeMismatch,
    DuplicateIndex,
    DestructiveProposedChange
});
simple_enum!(DatabaseIssueSeverity {
    Info,
    Warning,
    Error,
    Critical
});
simple_enum!(DatabaseIssueStatus {
    Open,
    Acknowledged,
    Resolved,
    Dismissed
});
simple_enum!(DatabaseChangeKind {
    Add,
    Drop,
    Rename,
    Alter,
    Move,
    Reorder,
    DataMigrationRequired
});

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseEnvironment {
    pub meta: DatabaseObjectMeta,
    pub name: String,
    pub kind: DatabaseEnvironmentKind,
    pub connection_profile_id: Option<String>,
    pub is_default: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseNamespace {
    pub meta: DatabaseObjectMeta,
    pub name: String,
    pub catalog_name: Option<String>,
    pub owner: Option<String>,
    pub comment: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
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
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
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
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseDataType {
    pub family: DatabaseTypeFamily,
    pub length: Option<u32>,
    pub precision: Option<u32>,
    pub scale: Option<u32>,
    pub array_dimensions: u8,
    pub unsigned: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseExpression {
    pub normalized: String,
    pub dialect: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrimaryKey {
    pub meta: DatabaseObjectMeta,
    pub table_id: SemanticId,
    pub name: Option<String>,
    pub column_ids: Vec<SemanticId>,
    pub clustered: Option<bool>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
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
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UniqueConstraint {
    pub meta: DatabaseObjectMeta,
    pub table_id: SemanticId,
    pub name: Option<String>,
    pub column_ids: Vec<SemanticId>,
    pub nulls_distinct: Option<bool>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CheckConstraint {
    pub meta: DatabaseObjectMeta,
    pub table_id: SemanticId,
    pub name: Option<String>,
    pub expression: DatabaseExpression,
    pub enforced: Option<bool>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
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
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct IndexKey {
    pub column_id: Option<SemanticId>,
    pub expression: Option<DatabaseExpression>,
    pub direction: Option<SortDirection>,
    pub nulls: Option<NullsOrder>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Enum {
    pub meta: DatabaseObjectMeta,
    pub namespace_id: SemanticId,
    pub name: String,
    pub values: Vec<DatabaseEnumValue>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseEnumValue {
    pub name: String,
    pub ordinal: u32,
    pub mapped_name: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub meta: DatabaseObjectMeta,
    pub namespace_id: SemanticId,
    pub name: String,
    pub materialized: bool,
    pub definition_fingerprint: String,
    pub column_ids: Vec<SemanticId>,
    pub dependency_ids: Vec<SemanticId>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
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
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OrmModel {
    pub meta: DatabaseObjectMeta,
    pub adapter_id: DatabaseAdapterId,
    pub project_id: ProjectId,
    pub relative_path: String,
    pub symbol: String,
    pub mapped_table_id: Option<SemanticId>,
    pub field_mappings: Vec<OrmFieldMapping>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct OrmFieldMapping {
    pub field_name: String,
    pub column_id: Option<SemanticId>,
    pub mapped_name: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
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
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct SourceSpan {
    pub start_line: u32,
    pub start_column: u32,
    pub end_line: u32,
    pub end_column: u32,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
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
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum DatabaseActor {
    Human {
        user_id: String,
    },
    Agent {
        session_id: String,
        agent_id: Option<String>,
    },
    System,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
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
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
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
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseColumnPatch {
    pub name: Option<String>,
    pub data_type: Option<DatabaseDataType>,
    pub native_type: Option<String>,
    pub nullable: Option<bool>,
    pub default: Option<Option<DatabaseExpression>>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum DatabaseDesignOperationKind {
    AddNamespace {
        namespace: DatabaseNamespace,
    },
    AddTable {
        table: DatabaseTable,
    },
    RenameTable {
        table_id: SemanticId,
        new_name: String,
    },
    DropTable {
        table_id: SemanticId,
    },
    AddColumn {
        table_id: SemanticId,
        column: DatabaseColumn,
    },
    AlterColumn {
        column_id: SemanticId,
        patch: DatabaseColumnPatch,
    },
    DropColumn {
        column_id: SemanticId,
    },
    AddPrimaryKey {
        key: PrimaryKey,
    },
    AddForeignKey {
        key: ForeignKey,
    },
    AddUniqueConstraint {
        constraint: UniqueConstraint,
    },
    AddCheckConstraint {
        constraint: CheckConstraint,
    },
    AddIndex {
        index: Index,
    },
    DropObject {
        object_id: SemanticId,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
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
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
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
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DatabaseEdgeType {
    Contains,
    HasColumn,
    PrimaryKey,
    References,
    Indexes,
    MapsTo,
    DeclaredBy,
    CreatedByMigration,
    OwnedBy,
    UsedBy,
    ReadBy,
    WrittenBy,
    DependsOn,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
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
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case", tag = "mode")]
pub enum DatabaseComparisonMode {
    DeclaredObservedDrift {
        declared_snapshot_id: SnapshotId,
        observed_snapshot_id: SnapshotId,
    },
    DeclaredProposedDelta {
        declared_snapshot_id: SnapshotId,
        proposed_revision_id: RevisionId,
    },
    DesignRevisions {
        left_revision_id: RevisionId,
        right_revision_id: RevisionId,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseChange {
    pub kind: DatabaseChangeKind,
    pub object_id: Option<SemanticId>,
    pub before_fingerprint: Option<String>,
    pub after_fingerprint: Option<String>,
    pub breaking: bool,
    pub destructive: bool,
    pub summary: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseDiff {
    pub id: String,
    pub source_id: String,
    pub mode: DatabaseComparisonMode,
    pub changes: Vec<DatabaseChange>,
    pub fingerprint: String,
    pub created_at: String,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseLayoutPosition {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseViewport {
    pub x: f64,
    pub y: f64,
    pub zoom: f64,
}

/// A user-arranged canvas layout. Positions are keyed by semantic object ID, never by display name
/// or array index, so a schema change reorders nothing the developer placed by hand.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseLayout {
    pub id: String,
    pub source_id: String,
    pub snapshot_id: Option<SnapshotId>,
    pub design_revision_id: Option<RevisionId>,
    pub layout_kind: String,
    pub semantic_lod: u8,
    pub layout_fingerprint: String,
    pub viewport: DatabaseViewport,
    pub positions: std::collections::BTreeMap<SemanticId, DatabaseLayoutPosition>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseObjectProvenance {
    pub id: String,
    pub object_id: SemanticId,
    pub source_kind: String,
    pub certainty: EvidenceCertainty,
    pub confidence: f32,
    pub evidence_ref: Option<String>,
    pub extractor_version: String,
    pub observed_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case", tag = "kind", content = "value")]
pub enum DatabaseObject {
    Environment(DatabaseEnvironment),
    Namespace(DatabaseNamespace),
    Table(DatabaseTable),
    Column(DatabaseColumn),
    PrimaryKey(PrimaryKey),
    ForeignKey(ForeignKey),
    UniqueConstraint(UniqueConstraint),
    CheckConstraint(CheckConstraint),
    Index(Index),
    Enum(Enum),
    View(View),
    Migration(DatabaseMigration),
    OrmModel(OrmModel),
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedDatabaseGraph {
    pub objects: Vec<DatabaseObject>,
    pub edges: Vec<DatabaseEdge>,
    pub provenance: Vec<DatabaseObjectProvenance>,
}

impl DatabaseObject {
    pub fn meta(&self) -> &DatabaseObjectMeta {
        match self {
            Self::Environment(v) => &v.meta,
            Self::Namespace(v) => &v.meta,
            Self::Table(v) => &v.meta,
            Self::Column(v) => &v.meta,
            Self::PrimaryKey(v) => &v.meta,
            Self::ForeignKey(v) => &v.meta,
            Self::UniqueConstraint(v) => &v.meta,
            Self::CheckConstraint(v) => &v.meta,
            Self::Index(v) => &v.meta,
            Self::Enum(v) => &v.meta,
            Self::View(v) => &v.meta,
            Self::Migration(v) => &v.meta,
            Self::OrmModel(v) => &v.meta,
        }
    }
    pub fn kind_name(&self) -> &'static str {
        match self {
            Self::Environment(_) => "environment",
            Self::Namespace(_) => "namespace",
            Self::Table(_) => "table",
            Self::Column(_) => "column",
            Self::PrimaryKey(_) => "primary_key",
            Self::ForeignKey(_) => "foreign_key",
            Self::UniqueConstraint(_) => "unique_constraint",
            Self::CheckConstraint(_) => "check_constraint",
            Self::Index(_) => "index",
            Self::Enum(_) => "enum",
            Self::View(_) => "view",
            Self::Migration(_) => "migration",
            Self::OrmModel(_) => "orm_model",
        }
    }
}

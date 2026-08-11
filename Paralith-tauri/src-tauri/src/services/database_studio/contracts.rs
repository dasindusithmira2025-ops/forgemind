//! Wire contracts for the Database Studio Tauri boundary.
//!
//! These types mirror `src/features/database/databaseTypes.ts` field for field. They live in one
//! place so a change to the frontend contract is a compile error here rather than a runtime shape
//! mismatch discovered by a user.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use crate::models::{
    DatabaseComparisonMode, DatabaseDesign, DatabaseDesignOperationKind, DatabaseDesignRevision,
    DatabaseEdge, DatabaseEnvironment, DatabaseIssue, DatabaseIssueSeverity, DatabaseIssueStatus,
    DatabaseLayer, DatabaseLayoutPosition, DatabaseMigration, DatabaseObject, DatabaseSnapshot,
    DatabaseSource, DatabaseSourceEvidence, DatabaseTable, DatabaseUsageReference,
    DatabaseViewport, SemanticId, SnapshotId,
};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceScopedRequest {
    pub project_id: String,
    pub source_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseSourceDetail {
    pub source: DatabaseSource,
    pub evidence: Vec<DatabaseSourceEvidence>,
    pub environments: Vec<DatabaseEnvironment>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetDatabaseSchemaRequest {
    pub project_id: String,
    pub source_id: String,
    pub layer: DatabaseLayer,
    #[serde(default)]
    pub snapshot_id: Option<String>,
    #[serde(default)]
    pub design_revision_id: Option<String>,
    #[serde(default)]
    pub lod: u8,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseGraphPage {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<DatabaseSnapshot>,
    pub objects: Vec<DatabaseObject>,
    pub edges: Vec<DatabaseEdge>,
    pub issues: Vec<DatabaseIssue>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub continuation: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetDatabaseObjectRequest {
    pub project_id: String,
    pub source_id: String,
    pub object_id: SemanticId,
    #[serde(default)]
    pub snapshot_id: Option<String>,
    #[serde(default)]
    pub design_revision_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseObjectDetail {
    pub table: DatabaseTable,
    pub columns: Vec<crate::models::DatabaseColumn>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub primary_key: Option<crate::models::PrimaryKey>,
    pub foreign_keys: Vec<crate::models::ForeignKey>,
    pub unique_constraints: Vec<crate::models::UniqueConstraint>,
    pub check_constraints: Vec<crate::models::CheckConstraint>,
    pub indexes: Vec<crate::models::Index>,
    pub incoming_foreign_keys: Vec<crate::models::ForeignKey>,
    pub usage: Vec<DatabaseUsageReference>,
    pub migrations: Vec<DatabaseMigration>,
    pub issues: Vec<DatabaseIssue>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_excerpt: Option<DatabaseSourceExcerpt>,
    pub provenance: Vec<crate::models::DatabaseObjectProvenance>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseSourceExcerpt {
    pub relative_path: String,
    pub text: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareDatabaseRequest {
    pub project_id: String,
    pub mode: DatabaseComparisonMode,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListDatabaseMigrationsRequest {
    pub project_id: String,
    pub source_id: String,
    #[serde(default)]
    pub snapshot_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListDatabaseUsageRequest {
    pub project_id: String,
    pub source_id: String,
    #[serde(default)]
    pub object_id: Option<SemanticId>,
    #[serde(default)]
    pub limit: Option<usize>,
    #[serde(default)]
    pub continuation: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseUsagePage {
    pub refs: Vec<DatabaseUsageReference>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub continuation: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListDatabaseIssuesRequest {
    pub project_id: String,
    pub source_id: String,
    #[serde(default)]
    pub status: Option<DatabaseIssueStatus>,
    #[serde(default)]
    pub severity: Option<DatabaseIssueSeverity>,
}

/// Read-only SQLite introspection. `explicitUserConsent` is required and must be `true`: discovering
/// a database file is never the same thing as being allowed to open it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntrospectSqliteFileRequest {
    pub project_id: String,
    pub source_id: String,
    pub project_relative_path: String,
    pub explicit_user_consent: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all_fields = "camelCase")]
pub enum CreateDatabaseDraftBase {
    #[serde(rename = "snapshot")]
    Snapshot { snapshot_id: SnapshotId },
    #[serde(rename = "revision")]
    Revision { revision_id: String },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDatabaseDraftRequest {
    pub project_id: String,
    pub source_id: String,
    pub name: String,
    pub base: CreateDatabaseDraftBase,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseDesignBundle {
    pub design: DatabaseDesign,
    pub revision: DatabaseDesignRevision,
    pub objects: Vec<DatabaseObject>,
    pub edges: Vec<DatabaseEdge>,
    pub issues: Vec<DatabaseIssue>,
    /// Optimistic-concurrency handle for the design head. Deliberately not called a "token": that
    /// name is redacted as a credential everywhere agent results are recorded, and this value must
    /// survive that redaction to be usable.
    pub concurrency: DesignConcurrencyToken,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesignConcurrencyToken {
    pub expected_head_revision_id: String,
    pub expected_revision_number: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetDatabaseDesignRequest {
    pub project_id: String,
    pub design_id: String,
    #[serde(default)]
    pub revision_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyDatabaseDesignOperationRequest {
    pub project_id: String,
    pub design_id: String,
    pub concurrency: DesignConcurrencyToken,
    pub operation: DatabaseDesignOperationKind,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseDesignMutationResult {
    pub design: DatabaseDesign,
    pub revision: DatabaseDesignRevision,
    pub concurrency: DesignConcurrencyToken,
    pub changed_object_ids: Vec<SemanticId>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecideDatabaseDesignRequest {
    pub project_id: String,
    pub design_id: String,
    pub concurrency: DesignConcurrencyToken,
    #[serde(default)]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveDatabaseLayoutRequest {
    pub project_id: String,
    pub source_id: String,
    #[serde(default)]
    pub snapshot_id: Option<String>,
    #[serde(default)]
    pub design_revision_id: Option<String>,
    pub layout: DatabaseLayoutInput,
    #[serde(default)]
    pub expected_layout_fingerprint: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseLayoutInput {
    pub layout_kind: String,
    pub semantic_lod: u8,
    pub viewport: DatabaseViewport,
    pub positions: BTreeMap<SemanticId, DatabaseLayoutPosition>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetDatabaseLayoutRequest {
    pub project_id: String,
    pub source_id: String,
    #[serde(default)]
    pub snapshot_id: Option<String>,
    #[serde(default)]
    pub design_revision_id: Option<String>,
    pub layout_kind: String,
    pub semantic_lod: u8,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseContextBudget {
    pub max_objects: usize,
    pub max_edges: usize,
    pub max_usage_refs: usize,
    pub max_issues: usize,
    pub max_estimated_tokens: usize,
}

impl Default for DatabaseContextBudget {
    fn default() -> Self {
        Self {
            max_objects: 120,
            max_edges: 240,
            max_usage_refs: 40,
            max_issues: 20,
            max_estimated_tokens: 6_000,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildDatabaseContextPackRequest {
    pub project_id: String,
    pub source_id: String,
    #[serde(default)]
    pub focus: Vec<SemanticId>,
    #[serde(default)]
    pub layer: Option<DatabaseLayer>,
    #[serde(default)]
    pub design_revision_id: Option<String>,
    #[serde(default)]
    pub budget: Option<DatabaseContextBudget>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseGraphReference {
    pub layer: DatabaseLayer,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub design_revision_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseContextOmissionSummary {
    pub namespace_id: SemanticId,
    pub omitted_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseContextOmissions {
    pub namespace_summaries: Vec<DatabaseContextOmissionSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseContextPack {
    pub source: DatabaseSource,
    pub reference: DatabaseGraphReference,
    pub focus_object_ids: Vec<SemanticId>,
    pub objects: Vec<DatabaseObject>,
    pub edges: Vec<DatabaseEdge>,
    pub usage_refs: Vec<DatabaseUsageReference>,
    pub issues: Vec<DatabaseIssue>,
    pub omitted: DatabaseContextOmissions,
    pub estimated_tokens: usize,
    pub fingerprint: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseExecutionMode {
    DesignOnly,
    ImplementDesign,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImplementDatabaseDesignRequest {
    pub project_id: String,
    pub design_id: String,
    pub approved_revision_id: String,
    pub execution_mode: DatabaseExecutionMode,
    /// Destructive changes require a second, explicit acknowledgement. Absent or false, the pipeline
    /// stops before writing anything and reports the destructive changes it refused to apply.
    #[serde(default)]
    pub acknowledge_destructive: bool,
    /// When true the pipeline plans and verifies but writes nothing, so a user or agent can inspect
    /// the exact repository change before it happens.
    #[serde(default)]
    pub dry_run: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseChangeRisk {
    Safe,
    Review,
    Destructive,
    Unsupported,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseImplementationStep {
    pub phase: String,
    pub detail: String,
    pub ok: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseImplementationRun {
    pub run_id: String,
    pub design_id: String,
    pub target_revision_id: String,
    pub phase: String,
    pub completed: usize,
    pub total: usize,
    pub risk: DatabaseChangeRisk,
    pub dry_run: bool,
    /// Repository-relative paths the pipeline wrote. Empty on a dry run or a refusal.
    pub changed_files: Vec<String>,
    pub migration_path: Option<String>,
    pub steps: Vec<DatabaseImplementationStep>,
    /// Independent target-vs-result comparison. `verified` is only true when re-extracting the
    /// repository after the change produces a zero-delta diff against the approved target.
    pub verified: bool,
    pub residual_changes: Vec<crate::models::DatabaseChange>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseAdapterSupport {
    pub adapter_id: crate::models::DatabaseAdapterId,
    pub capabilities: crate::models::DatabaseAdapterCapabilities,
}

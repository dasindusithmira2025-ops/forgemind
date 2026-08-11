#![allow(dead_code)]

use super::DatabaseService;
use crate::errors::{AppError, AppResult};
use crate::models::{
    DatabaseActor, DatabaseDesign, DatabaseDesignOperation, DatabaseDesignOperationKind,
    DatabaseDesignRevision, DatabaseDesignRevisionState, DatabaseDesignStatus, DatabaseEdge,
    DatabaseIssue, DatabaseIssueSeverity, DatabaseIssueStatus, DatabaseLayer, DatabaseObject,
    DatabaseObjectProvenance, DatabaseSnapshot, DatabaseSource, DatabaseSourceEvidence,
    DatabaseUsageReference, ExtractedDatabaseGraph,
};
use crate::services::database_studio::design::{self, ActualDesignHead};
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashMap;

/// Which layer of the canonical graph a persisted row belongs to. The schema stores this as a
/// mutually exclusive `(snapshot_id, design_revision_id)` pair with `''` sentinels, so this enum is
/// the only place that encoding is produced or interpreted.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum GraphRef {
    Snapshot(String),
    Revision(String),
}

impl GraphRef {
    pub fn columns(&self) -> (&str, &str) {
        match self {
            Self::Snapshot(id) => (id.as_str(), ""),
            Self::Revision(id) => ("", id.as_str()),
        }
    }

    pub fn snapshot_id(&self) -> Option<&str> {
        match self {
            Self::Snapshot(id) => Some(id.as_str()),
            Self::Revision(_) => None,
        }
    }

    pub fn revision_id(&self) -> Option<&str> {
        match self {
            Self::Snapshot(_) => None,
            Self::Revision(id) => Some(id.as_str()),
        }
    }

    pub fn from_columns(snapshot_id: String, design_revision_id: String) -> AppResult<Self> {
        match (snapshot_id.is_empty(), design_revision_id.is_empty()) {
            (false, true) => Ok(Self::Snapshot(snapshot_id)),
            (true, false) => Ok(Self::Revision(design_revision_id)),
            _ => Err(AppError::new(
                "database_graph_reference_invalid",
                "A Database Studio graph row must belong to exactly one snapshot or design revision.",
                false,
            )
            .layer("database_studio")),
        }
    }
}

pub fn insert_source(connection: &Connection, source: &DatabaseSource) -> AppResult<()> {
    connection
        .execute(
            "INSERT INTO database_sources(id,repository_id,logical_key,display_name,engine,owner_project_id,confidence,discovered_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![
                source.id,
                source.repository_id,
                source.logical_key,
                source.display_name,
                serde_json::to_string(&source.engine).map_err(AppError::database)?.trim_matches('"'),
                source.owner_project_id,
                source.confidence,
                source.discovered_at,
                source.updated_at,
            ],
        )
        .map_err(AppError::database)?;
    Ok(())
}

pub fn insert_evidence(
    connection: &Connection,
    source_id: &str,
    evidence: &DatabaseSourceEvidence,
) -> AppResult<()> {
    connection
        .execute(
            "INSERT INTO database_source_evidence(id,source_id,repository_id,project_id,adapter_id,evidence_kind,relative_path,symbol_or_key,safe_value_fingerprint,source_hint,owner_signal,consumer_signal,certainty,confidence,content_sha256,extractor_version,discovered_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)",
            params![
                evidence.id,
                source_id,
                evidence.repository_id,
                evidence.project_id,
                serde_json::to_string(&evidence.adapter_id).map_err(AppError::database)?.trim_matches('"'),
                serde_json::to_string(&evidence.evidence_kind).map_err(AppError::database)?.trim_matches('"'),
                evidence.relative_path,
                evidence.symbol_or_key,
                evidence.safe_value_fingerprint,
                evidence.source_hint,
                evidence.owner_signal,
                evidence.consumer_signal,
                serde_json::to_string(&evidence.certainty).map_err(AppError::database)?.trim_matches('"'),
                evidence.confidence,
                evidence.content_sha256,
                evidence.extractor_version,
                evidence.discovered_at,
            ],
        )
        .map_err(AppError::database)?;
    Ok(())
}

pub fn create_design_with_initial_revision(
    connection: &Connection,
    design: &DatabaseDesign,
    revision: &DatabaseDesignRevision,
) -> AppResult<()> {
    connection
        .execute("BEGIN IMMEDIATE", [])
        .map_err(AppError::database)?;
    let result = (|| {
        insert_design_row(connection, design)?;
        insert_revision_row(connection, revision)?;
        Ok(())
    })();
    finish_transaction(connection, result)
}

/// Advance a design head and materialize the resulting revision in one transaction.
///
/// The compare-and-swap, the revision row, the operation row, and the revision's full proposed
/// graph all commit together. A reader can therefore never observe a head revision whose graph has
/// not been written yet, and a losing writer leaves nothing behind.
#[allow(clippy::too_many_arguments)]
pub fn compare_and_materialize_revision(
    connection: &Connection,
    design_id: &str,
    expected_head_revision_id: &str,
    expected_revision_number: i64,
    updated_at: String,
    revision: &DatabaseDesignRevision,
    operation: &DatabaseDesignOperation,
    source_id: &str,
    graph: &ExtractedDatabaseGraph,
) -> AppResult<()> {
    connection
        .execute("BEGIN IMMEDIATE", [])
        .map_err(AppError::database)?;

    let next_revision_number = expected_revision_number + 1;
    let updated = connection
        .execute(
            "UPDATE database_designs SET head_revision_id=?1, revision_number=?2, updated_at=?3 WHERE id=?4 AND head_revision_id=?5 AND revision_number=?6",
            params![
                revision.id,
                next_revision_number,
                updated_at,
                design_id,
                expected_head_revision_id,
                expected_revision_number,
            ],
        )
        .map_err(AppError::database)?;

    if updated != 1 {
        let actual = read_actual_head(connection, design_id)?;
        connection
            .execute("ROLLBACK", [])
            .map_err(AppError::database)?;
        return Err(design::stale_design_error(
            design_id,
            expected_head_revision_id,
            expected_revision_number,
            actual,
        ));
    }

    let result = (|| {
        insert_revision_row(connection, revision)?;
        insert_operation_row(connection, operation)?;
        write_graph(
            connection,
            source_id,
            &GraphRef::Revision(revision.id.clone()),
            graph,
        )?;
        Ok(())
    })();
    finish_transaction(connection, result)
}

pub struct RevisionDecision<'a> {
    pub design_id: &'a str,
    pub revision_id: &'a str,
    pub design_status: DatabaseDesignStatus,
    pub revision_state: DatabaseDesignRevisionState,
    pub actor: &'a DatabaseActor,
    pub reason: Option<&'a str>,
    pub now: &'a str,
}

pub fn set_design_revision_decision(
    connection: &Connection,
    decision: RevisionDecision<'_>,
) -> AppResult<()> {
    connection
        .execute("BEGIN IMMEDIATE", [])
        .map_err(AppError::database)?;
    let result = (|| {
        let (actor_kind, actor_id) = actor_columns(decision.actor);
        let approved_revision_id = if decision.design_status == DatabaseDesignStatus::Approved {
            Some(decision.revision_id)
        } else {
            None
        };
        connection
            .execute(
                "UPDATE database_design_revisions SET state=?1, decision_by_kind=?2, decision_by_id=?3, decision_at=?4, decision_reason=?5 WHERE design_id=?6 AND id=?7",
                params![
                    enum_value(&decision.revision_state)?,
                    actor_kind,
                    actor_id,
                    decision.now,
                    decision.reason,
                    decision.design_id,
                    decision.revision_id,
                ],
            )
            .map_err(AppError::database)?;
        connection
            .execute(
                "UPDATE database_designs SET status=?1, approved_revision_id=?2, updated_at=?3 WHERE id=?4",
                params![
                    enum_value(&decision.design_status)?,
                    approved_revision_id,
                    decision.now,
                    decision.design_id
                ],
            )
            .map_err(AppError::database)?;
        Ok(())
    })();
    finish_transaction(connection, result)
}

pub fn get_design(connection: &Connection, design_id: &str) -> AppResult<DatabaseDesign> {
    connection
        .query_row(
            "SELECT id,source_id,name,status,base_snapshot_id,base_revision_id,head_revision_id,revision_number,created_by_kind,created_by_id,created_at,updated_at,approved_revision_id FROM database_designs WHERE id=?1",
            params![design_id],
            design_from_row,
        )
        .map_err(AppError::database)
}

fn insert_design_row(connection: &Connection, design: &DatabaseDesign) -> AppResult<()> {
    let (created_by_kind, created_by_id) = actor_columns(&design.created_by);
    connection
        .execute(
            "INSERT INTO database_designs(id,source_id,name,status,base_snapshot_id,base_revision_id,head_revision_id,revision_number,created_by_kind,created_by_id,created_at,updated_at,approved_revision_id) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
            params![
                design.id,
                design.source_id,
                design.name,
                enum_value(&design.status)?,
                design.base_snapshot_id,
                design.base_revision_id,
                design.head_revision_id,
                design.revision_number,
                created_by_kind,
                created_by_id,
                design.created_at,
                design.updated_at,
                design.approved_revision_id,
            ],
        )
        .map_err(AppError::database)?;
    Ok(())
}

fn insert_revision_row(
    connection: &Connection,
    revision: &DatabaseDesignRevision,
) -> AppResult<()> {
    let (created_by_kind, created_by_id) = actor_columns(&revision.created_by);
    let decision_actor = revision.decision_by.as_ref().map(actor_columns);
    connection
        .execute(
            "INSERT INTO database_design_revisions(id,design_id,parent_revision_id,merge_parent_revision_id,revision_number,state,graph_fingerprint,created_by_kind,created_by_id,created_at,decision_by_kind,decision_by_id,decision_at,decision_reason) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
            params![
                revision.id,
                revision.design_id,
                revision.parent_revision_id,
                revision.merge_parent_revision_id,
                revision.revision_number,
                enum_value(&revision.state)?,
                revision.graph_fingerprint,
                created_by_kind,
                created_by_id,
                revision.created_at,
                decision_actor.as_ref().map(|(kind, _)| kind.as_str()),
                decision_actor.as_ref().and_then(|(_, id)| id.as_deref()),
                revision.decision_at,
                revision.decision_reason,
            ],
        )
        .map_err(AppError::database)?;
    Ok(())
}

fn insert_operation_row(
    connection: &Connection,
    operation: &DatabaseDesignOperation,
) -> AppResult<()> {
    let (actor_kind, actor_id) = actor_columns(&operation.actor);
    let operation_kind = operation_kind_name(&operation.operation);
    let payload = serde_json::to_string(&operation.operation).map_err(AppError::database)?;
    connection
        .execute(
            "INSERT INTO database_design_operations(id,design_id,base_revision_id,result_revision_id,sequence,operation_kind,payload_version,operation_payload_json,actor_kind,actor_id,created_at) VALUES(?1,?2,?3,?4,?5,?6,1,?7,?8,?9,?10)",
            params![
                operation.id,
                operation.design_id,
                operation.base_revision_id,
                operation.result_revision_id,
                operation.sequence,
                operation_kind,
                payload,
                actor_kind,
                actor_id,
                operation.created_at,
            ],
        )
        .map_err(AppError::database)?;
    Ok(())
}

fn read_actual_head(connection: &Connection, design_id: &str) -> AppResult<ActualDesignHead> {
    connection
        .query_row(
            "SELECT head_revision_id, revision_number FROM database_designs WHERE id=?1",
            params![design_id],
            |row| {
                Ok(ActualDesignHead {
                    revision_id: row.get(0)?,
                    revision_number: row.get(1)?,
                })
            },
        )
        .optional()
        .map_err(AppError::database)?
        .ok_or_else(|| {
            AppError::new(
                "database_design_not_found",
                "The requested database design was not found.",
                true,
            )
            .entity(design_id)
            .layer("database_studio")
        })
}

fn finish_transaction<T>(connection: &Connection, result: AppResult<T>) -> AppResult<T> {
    match result {
        Ok(value) => {
            connection
                .execute("COMMIT", [])
                .map_err(AppError::database)?;
            Ok(value)
        }
        Err(error) => {
            let _ = connection.execute("ROLLBACK", []);
            Err(error)
        }
    }
}

fn design_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<DatabaseDesign> {
    let status: String = row.get(3)?;
    let actor_kind: String = row.get(8)?;
    let actor_id: Option<String> = row.get(9)?;
    Ok(DatabaseDesign {
        id: row.get(0)?,
        source_id: row.get(1)?,
        name: row.get(2)?,
        status: design_status(&status),
        base_snapshot_id: row.get(4)?,
        base_revision_id: row.get(5)?,
        head_revision_id: row.get(6)?,
        revision_number: row.get(7)?,
        created_by: actor_from_columns(&actor_kind, actor_id),
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
        approved_revision_id: row.get(12)?,
    })
}

fn actor_columns(actor: &DatabaseActor) -> (String, Option<String>) {
    match actor {
        DatabaseActor::Human { user_id } => ("human".into(), Some(user_id.clone())),
        DatabaseActor::Agent {
            session_id,
            agent_id,
        } => (
            "agent".into(),
            Some(match agent_id {
                Some(agent_id) => format!("{session_id}:{agent_id}"),
                None => session_id.clone(),
            }),
        ),
        DatabaseActor::System => ("system".into(), None),
    }
}

fn actor_from_columns(kind: &str, id: Option<String>) -> DatabaseActor {
    match kind {
        "human" => DatabaseActor::Human {
            user_id: id.unwrap_or_default(),
        },
        "agent" => DatabaseActor::Agent {
            session_id: id.unwrap_or_default(),
            agent_id: None,
        },
        _ => DatabaseActor::System,
    }
}

fn enum_value<T: serde::Serialize>(value: &T) -> AppResult<String> {
    Ok(serde_json::to_string(value)
        .map_err(AppError::database)?
        .trim_matches('"')
        .to_string())
}

fn design_status(value: &str) -> DatabaseDesignStatus {
    match value {
        "approved" => DatabaseDesignStatus::Approved,
        "rejected" => DatabaseDesignStatus::Rejected,
        "archived" => DatabaseDesignStatus::Archived,
        _ => DatabaseDesignStatus::Draft,
    }
}

// -------------------------------------------------------------------------------------------
// DatabaseService store API
//
// Everything Database Studio renders, compares, or hands to an agent is read back through these
// methods. The canonical graph lives in SQLite, not in a service-local cache, so a restart, a
// second window, or an agent session all observe the same rows.
// -------------------------------------------------------------------------------------------

impl DatabaseService {
    /// Replace the discovered source set for a repository in one transaction. Sources that vanished
    /// from the repository cascade-delete their evidence, snapshots, graph, designs, and layouts,
    /// which is the behaviour a re-scan after a schema deletion must have.
    pub fn database_studio_replace_sources(
        &self,
        repository_id: &str,
        sources: &[(DatabaseSource, Vec<DatabaseSourceEvidence>)],
    ) -> AppResult<Vec<DatabaseSource>> {
        let mut connection = self.connection.lock();
        let transaction = connection.transaction().map_err(AppError::database)?;
        let keep: Vec<&str> = sources
            .iter()
            .map(|(source, _)| source.id.as_str())
            .collect();
        {
            let mut existing = transaction
                .prepare("SELECT id FROM database_sources WHERE repository_id=?1")
                .map_err(AppError::database)?;
            let stale: Vec<String> = existing
                .query_map(params![repository_id], |row| row.get::<_, String>(0))
                .map_err(AppError::database)?
                .collect::<rusqlite::Result<Vec<String>>>()
                .map_err(AppError::database)?
                .into_iter()
                .filter(|id| !keep.contains(&id.as_str()))
                .collect();
            for id in stale {
                transaction
                    .execute("DELETE FROM database_sources WHERE id=?1", params![id])
                    .map_err(AppError::database)?;
            }
        }

        let mut stored = Vec::with_capacity(sources.len());
        for (source, evidence) in sources {
            let engine = enum_value(&source.engine)?;
            transaction
                .execute(
                    "INSERT INTO database_sources(id,repository_id,logical_key,display_name,engine,owner_project_id,confidence,discovered_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)
                     ON CONFLICT(id) DO UPDATE SET logical_key=excluded.logical_key, display_name=excluded.display_name, engine=excluded.engine, owner_project_id=excluded.owner_project_id, confidence=excluded.confidence, updated_at=excluded.updated_at",
                    params![
                        source.id,
                        source.repository_id,
                        source.logical_key,
                        source.display_name,
                        engine,
                        source.owner_project_id,
                        source.confidence,
                        source.discovered_at,
                        source.updated_at,
                    ],
                )
                .map_err(AppError::database)?;
            transaction
                .execute(
                    "DELETE FROM database_source_evidence WHERE source_id=?1",
                    params![source.id],
                )
                .map_err(AppError::database)?;
            for item in evidence {
                insert_evidence(&transaction, &source.id, item)?;
            }
            let mut resolved = source.clone();
            resolved.evidence_ids = evidence.iter().map(|item| item.id.clone()).collect();
            stored.push(resolved);
        }
        transaction.commit().map_err(AppError::database)?;
        Ok(stored)
    }

    pub fn database_studio_list_sources(
        &self,
        repository_id: &str,
    ) -> AppResult<Vec<DatabaseSource>> {
        let connection = self.connection.lock();
        let mut statement = connection
            .prepare(
                "SELECT id,repository_id,logical_key,display_name,engine,owner_project_id,confidence,discovered_at,updated_at FROM database_sources WHERE repository_id=?1 ORDER BY display_name",
            )
            .map_err(AppError::database)?;
        let rows = statement
            .query_map(params![repository_id], source_from_row)
            .map_err(AppError::database)?
            .collect::<rusqlite::Result<Vec<DatabaseSource>>>()
            .map_err(AppError::database)?;
        drop(statement);
        rows.into_iter()
            .map(|source| hydrate_source(&connection, source))
            .collect()
    }

    pub fn database_studio_get_source(&self, source_id: &str) -> AppResult<DatabaseSource> {
        let connection = self.connection.lock();
        let source = connection
            .query_row(
                "SELECT id,repository_id,logical_key,display_name,engine,owner_project_id,confidence,discovered_at,updated_at FROM database_sources WHERE id=?1",
                params![source_id],
                source_from_row,
            )
            .optional()
            .map_err(AppError::database)?
            .ok_or_else(|| source_not_found(source_id))?;
        hydrate_source(&connection, source)
    }

    pub fn database_studio_list_evidence(
        &self,
        source_id: &str,
    ) -> AppResult<Vec<DatabaseSourceEvidence>> {
        let connection = self.connection.lock();
        let mut statement = connection
            .prepare(
                "SELECT id,repository_id,project_id,adapter_id,evidence_kind,relative_path,symbol_or_key,safe_value_fingerprint,source_hint,owner_signal,consumer_signal,certainty,confidence,content_sha256,extractor_version,discovered_at FROM database_source_evidence WHERE source_id=?1 ORDER BY relative_path",
            )
            .map_err(AppError::database)?;
        let rows = statement
            .query_map(params![source_id], evidence_from_row)
            .map_err(AppError::database)?
            .collect::<rusqlite::Result<Vec<DatabaseSourceEvidence>>>()
            .map_err(AppError::database)?;
        Ok(rows)
    }

    /// Persist an extracted graph as an immutable snapshot. Previous snapshots for the same
    /// `(source, layer)` are marked superseded rather than deleted, so drift comparisons against an
    /// older extraction stay possible.
    pub fn database_studio_put_snapshot(
        &self,
        snapshot: &DatabaseSnapshot,
        graph: &ExtractedDatabaseGraph,
    ) -> AppResult<()> {
        let mut connection = self.connection.lock();
        let transaction = connection.transaction().map_err(AppError::database)?;
        transaction
            .execute(
                "UPDATE database_snapshots SET status='superseded' WHERE source_id=?1 AND layer=?2 AND id<>?3 AND status='ready'",
                params![snapshot.source_id, enum_value(&snapshot.layer)?, snapshot.id],
            )
            .map_err(AppError::database)?;
        transaction
            .execute(
                "INSERT OR REPLACE INTO database_snapshots(id,source_id,layer,adapter_id,git_revision,parent_snapshot_id,fingerprint,object_count,edge_count,extractor_version,status,created_at,completed_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
                params![
                    snapshot.id,
                    snapshot.source_id,
                    enum_value(&snapshot.layer)?,
                    enum_value(&snapshot.adapter_id)?,
                    snapshot.git_revision,
                    snapshot.parent_snapshot_id,
                    snapshot.fingerprint,
                    snapshot.object_count,
                    snapshot.edge_count,
                    snapshot.extractor_version,
                    enum_value(&snapshot.status)?,
                    snapshot.created_at,
                    snapshot.completed_at,
                ],
            )
            .map_err(AppError::database)?;
        write_graph(
            &transaction,
            &snapshot.source_id,
            &GraphRef::Snapshot(snapshot.id.clone()),
            graph,
        )?;
        transaction.commit().map_err(AppError::database)
    }

    /// Materialize a design revision's full proposed graph. Revisions are immutable, so this is only
    /// ever an insert for a revision ID that did not previously exist.
    pub fn database_studio_put_revision_graph(
        &self,
        source_id: &str,
        revision_id: &str,
        graph: &ExtractedDatabaseGraph,
    ) -> AppResult<()> {
        let mut connection = self.connection.lock();
        let transaction = connection.transaction().map_err(AppError::database)?;
        write_graph(
            &transaction,
            source_id,
            &GraphRef::Revision(revision_id.to_owned()),
            graph,
        )?;
        transaction.commit().map_err(AppError::database)
    }

    pub fn database_studio_latest_snapshot(
        &self,
        source_id: &str,
        layer: &DatabaseLayer,
    ) -> AppResult<Option<DatabaseSnapshot>> {
        let connection = self.connection.lock();
        connection
            .query_row(
                "SELECT id,source_id,layer,adapter_id,git_revision,parent_snapshot_id,fingerprint,object_count,edge_count,extractor_version,status,created_at,completed_at FROM database_snapshots WHERE source_id=?1 AND layer=?2 AND status='ready' ORDER BY created_at DESC, id DESC LIMIT 1",
                params![source_id, enum_value(layer)?],
                snapshot_from_row,
            )
            .optional()
            .map_err(AppError::database)
    }

    pub fn database_studio_get_snapshot(&self, snapshot_id: &str) -> AppResult<DatabaseSnapshot> {
        let connection = self.connection.lock();
        connection
            .query_row(
                "SELECT id,source_id,layer,adapter_id,git_revision,parent_snapshot_id,fingerprint,object_count,edge_count,extractor_version,status,created_at,completed_at FROM database_snapshots WHERE id=?1",
                params![snapshot_id],
                snapshot_from_row,
            )
            .optional()
            .map_err(AppError::database)?
            .ok_or_else(|| {
                AppError::new(
                    "database_snapshot_not_found",
                    "The requested database snapshot was not found.",
                    true,
                )
                .entity(snapshot_id)
                .layer("database_studio")
            })
    }

    pub fn database_studio_load_graph(
        &self,
        reference: &GraphRef,
    ) -> AppResult<ExtractedDatabaseGraph> {
        let connection = self.connection.lock();
        read_graph(&connection, reference)
    }

    pub fn database_studio_replace_issues(
        &self,
        source_id: &str,
        reference: &GraphRef,
        issues: &[DatabaseIssue],
    ) -> AppResult<()> {
        let (snapshot_id, revision_id) = reference.columns();
        let mut connection = self.connection.lock();
        let transaction = connection.transaction().map_err(AppError::database)?;
        transaction
            .execute(
                "DELETE FROM database_issues WHERE source_id=?1 AND snapshot_id=?2 AND design_revision_id=?3",
                params![source_id, snapshot_id, revision_id],
            )
            .map_err(AppError::database)?;
        for issue in issues {
            transaction
                .execute(
                    "INSERT INTO database_issues(id,source_id,snapshot_id,design_revision_id,issue_code,severity,title,explanation,status,detected_at,resolved_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
                    params![
                        issue.id,
                        source_id,
                        snapshot_id,
                        revision_id,
                        enum_value(&issue.code)?,
                        enum_value(&issue.severity)?,
                        issue.title,
                        // Semantic object IDs travel with the explanation payload so an issue can
                        // deep-link into the canvas without a second join table.
                        serde_json::to_string(&IssueDetail {
                            explanation: issue.explanation.clone(),
                            semantic_object_ids: issue.semantic_object_ids.clone(),
                            evidence_ids: issue.evidence_ids.clone(),
                        })
                        .map_err(AppError::database)?,
                        enum_value(&issue.status)?,
                        issue.detected_at,
                        issue.resolved_at,
                    ],
                )
                .map_err(AppError::database)?;
        }
        transaction.commit().map_err(AppError::database)
    }

    pub fn database_studio_list_issues(
        &self,
        source_id: &str,
        status: Option<&DatabaseIssueStatus>,
        severity: Option<&DatabaseIssueSeverity>,
    ) -> AppResult<Vec<DatabaseIssue>> {
        let connection = self.connection.lock();
        let mut statement = connection
            .prepare(
                "SELECT id,source_id,snapshot_id,design_revision_id,issue_code,severity,title,explanation,status,detected_at,resolved_at FROM database_issues WHERE source_id=?1 ORDER BY severity DESC, detected_at DESC",
            )
            .map_err(AppError::database)?;
        let issues = statement
            .query_map(params![source_id], issue_from_row)
            .map_err(AppError::database)?
            .collect::<rusqlite::Result<Vec<DatabaseIssue>>>()
            .map_err(AppError::database)?;
        Ok(issues
            .into_iter()
            .filter(|issue| status.is_none() || status == Some(&issue.status))
            .filter(|issue| severity.is_none() || severity == Some(&issue.severity))
            .collect())
    }

    pub fn database_studio_list_designs(&self, source_id: &str) -> AppResult<Vec<DatabaseDesign>> {
        let connection = self.connection.lock();
        let mut statement = connection
            .prepare(
                "SELECT id,source_id,name,status,base_snapshot_id,base_revision_id,head_revision_id,revision_number,created_by_kind,created_by_id,created_at,updated_at,approved_revision_id FROM database_designs WHERE source_id=?1 ORDER BY created_at",
            )
            .map_err(AppError::database)?;
        let rows = statement
            .query_map(params![source_id], design_from_row)
            .map_err(AppError::database)?
            .collect::<rusqlite::Result<Vec<DatabaseDesign>>>()
            .map_err(AppError::database)?;
        Ok(rows)
    }

    pub fn database_studio_get_design(&self, design_id: &str) -> AppResult<DatabaseDesign> {
        let connection = self.connection.lock();
        get_design(&connection, design_id)
    }

    pub fn database_studio_get_revision(
        &self,
        revision_id: &str,
    ) -> AppResult<DatabaseDesignRevision> {
        let connection = self.connection.lock();
        read_revision(&connection, revision_id)
    }

    pub fn database_studio_list_revisions(
        &self,
        design_id: &str,
    ) -> AppResult<Vec<DatabaseDesignRevision>> {
        let connection = self.connection.lock();
        let mut statement = connection
            .prepare(&format!(
                "SELECT {REVISION_COLUMNS} FROM database_design_revisions WHERE design_id=?1 ORDER BY revision_number"
            ))
            .map_err(AppError::database)?;
        let rows = statement
            .query_map(params![design_id], revision_from_row)
            .map_err(AppError::database)?
            .collect::<rusqlite::Result<Vec<DatabaseDesignRevision>>>()
            .map_err(AppError::database)?;
        Ok(rows)
    }

    pub fn database_studio_list_operations(
        &self,
        design_id: &str,
    ) -> AppResult<Vec<DatabaseDesignOperation>> {
        let connection = self.connection.lock();
        let mut statement = connection
            .prepare(
                "SELECT id,design_id,base_revision_id,result_revision_id,sequence,operation_payload_json,actor_kind,actor_id,created_at FROM database_design_operations WHERE design_id=?1 ORDER BY created_at, sequence",
            )
            .map_err(AppError::database)?;
        let rows = statement
            .query_map(params![design_id], operation_from_row)
            .map_err(AppError::database)?
            .collect::<rusqlite::Result<Vec<DatabaseDesignOperation>>>()
            .map_err(AppError::database)?;
        Ok(rows)
    }

    /// Run a closure with the shared connection so the Database Studio design service can compose
    /// its own multi-statement CAS transactions without re-implementing connection ownership.
    pub fn database_studio_with_connection<T>(
        &self,
        action: impl FnOnce(&Connection) -> AppResult<T>,
    ) -> AppResult<T> {
        let connection = self.connection.lock();
        action(&connection)
    }

    pub fn database_studio_save_layout(
        &self,
        layout: &crate::models::DatabaseLayout,
        expected_fingerprint: Option<&str>,
    ) -> AppResult<()> {
        let reference = layout_reference(layout)?;
        let (snapshot_id, revision_id) = reference.columns();
        let connection = self.connection.lock();
        if let Some(expected) = expected_fingerprint {
            let actual: Option<String> = connection
                .query_row(
                    "SELECT layout_fingerprint FROM database_layouts WHERE source_id=?1 AND snapshot_id=?2 AND design_revision_id=?3 AND layout_kind=?4 AND semantic_lod=?5",
                    params![layout.source_id, snapshot_id, revision_id, layout.layout_kind, layout.semantic_lod],
                    |row| row.get(0),
                )
                .optional()
                .map_err(AppError::database)?;
            if let Some(actual) = actual {
                if actual != expected {
                    return Err(AppError::new(
                        "database_layout_stale",
                        "This canvas layout changed in another window before the save completed.",
                        true,
                    )
                    .entity(&layout.source_id)
                    .action("Reload the diagram and reapply the arrangement.")
                    .layer("database_studio"));
                }
            }
        }
        connection
            .execute(
                "INSERT INTO database_layouts(id,source_id,snapshot_id,design_revision_id,layout_kind,semantic_lod,layout_fingerprint,viewport_json,positions_json,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
                 ON CONFLICT(source_id,snapshot_id,design_revision_id,layout_kind,semantic_lod) DO UPDATE SET layout_fingerprint=excluded.layout_fingerprint, viewport_json=excluded.viewport_json, positions_json=excluded.positions_json, updated_at=excluded.updated_at",
                params![
                    layout.id,
                    layout.source_id,
                    snapshot_id,
                    revision_id,
                    layout.layout_kind,
                    layout.semantic_lod,
                    layout.layout_fingerprint,
                    serde_json::to_string(&layout.viewport).map_err(AppError::database)?,
                    serde_json::to_string(&layout.positions).map_err(AppError::database)?,
                    layout.updated_at,
                ],
            )
            .map_err(AppError::database)?;
        Ok(())
    }

    pub fn database_studio_get_layout(
        &self,
        source_id: &str,
        reference: &GraphRef,
        layout_kind: &str,
        semantic_lod: u8,
    ) -> AppResult<Option<crate::models::DatabaseLayout>> {
        let (snapshot_id, revision_id) = reference.columns();
        let connection = self.connection.lock();
        connection
            .query_row(
                "SELECT id,source_id,snapshot_id,design_revision_id,layout_kind,semantic_lod,layout_fingerprint,viewport_json,positions_json,updated_at FROM database_layouts WHERE source_id=?1 AND snapshot_id=?2 AND design_revision_id=?3 AND layout_kind=?4 AND semantic_lod=?5",
                params![source_id, snapshot_id, revision_id, layout_kind, semantic_lod],
                layout_from_row,
            )
            .optional()
            .map_err(AppError::database)
    }

    pub fn database_studio_replace_usage(
        &self,
        source_id: &str,
        refs: &[DatabaseUsageReference],
    ) -> AppResult<()> {
        let mut connection = self.connection.lock();
        let transaction = connection.transaction().map_err(AppError::database)?;
        transaction
            .execute(
                "DELETE FROM database_usage_refs WHERE source_id=?1",
                params![source_id],
            )
            .map_err(AppError::database)?;
        for reference in refs {
            let span = reference.span.as_ref();
            transaction
                .execute(
                    "INSERT INTO database_usage_refs(id,source_id,project_id,semantic_object_id,relative_path,symbol,start_line,start_column,end_line,end_column,access_kind,certainty,confidence,content_sha256,observed_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
                    params![
                        reference.id,
                        source_id,
                        reference.project_id,
                        reference.semantic_object_id,
                        reference.relative_path,
                        reference.symbol,
                        span.map(|value| value.start_line),
                        span.map(|value| value.start_column),
                        span.map(|value| value.end_line),
                        span.map(|value| value.end_column),
                        enum_value(&reference.access)?,
                        enum_value(&reference.certainty)?,
                        reference.confidence,
                        reference.content_sha256,
                        reference.observed_at,
                    ],
                )
                .map_err(AppError::database)?;
        }
        transaction.commit().map_err(AppError::database)
    }

    pub fn database_studio_list_usage(
        &self,
        source_id: &str,
        object_id: Option<&str>,
        limit: usize,
        offset: usize,
    ) -> AppResult<Vec<DatabaseUsageReference>> {
        let connection = self.connection.lock();
        let mut statement = connection
            .prepare(
                "SELECT id,source_id,project_id,semantic_object_id,relative_path,symbol,start_line,start_column,end_line,end_column,access_kind,certainty,confidence,content_sha256,observed_at FROM database_usage_refs WHERE source_id=?1 AND (?2 IS NULL OR semantic_object_id=?2) ORDER BY relative_path, start_line LIMIT ?3 OFFSET ?4",
            )
            .map_err(AppError::database)?;
        let rows = statement
            .query_map(
                params![source_id, object_id, limit as i64, offset as i64],
                usage_from_row,
            )
            .map_err(AppError::database)?
            .collect::<rusqlite::Result<Vec<DatabaseUsageReference>>>()
            .map_err(AppError::database)?;
        Ok(rows)
    }
}

#[derive(serde::Serialize, serde::Deserialize, Default)]
struct IssueDetail {
    explanation: String,
    #[serde(default)]
    semantic_object_ids: Vec<String>,
    #[serde(default)]
    evidence_ids: Vec<String>,
}

const REVISION_COLUMNS: &str = "id,design_id,parent_revision_id,merge_parent_revision_id,revision_number,state,graph_fingerprint,created_by_kind,created_by_id,created_at,decision_by_kind,decision_by_id,decision_at,decision_reason";

fn source_not_found(source_id: &str) -> AppError {
    AppError::new(
        "database_source_not_found",
        "The requested database source was not found.",
        true,
    )
    .entity(source_id)
    .layer("database_studio")
}

fn layout_reference(layout: &crate::models::DatabaseLayout) -> AppResult<GraphRef> {
    GraphRef::from_columns(
        layout.snapshot_id.clone().unwrap_or_default(),
        layout.design_revision_id.clone().unwrap_or_default(),
    )
}

/// Fill in the association columns the `database_sources` row cannot hold on its own: adapters and
/// consumers are derived from evidence, which keeps a single writable source of truth.
fn hydrate_source(
    connection: &Connection,
    mut source: DatabaseSource,
) -> AppResult<DatabaseSource> {
    let mut statement = connection
        .prepare("SELECT id,adapter_id,project_id,consumer_signal FROM database_source_evidence WHERE source_id=?1 ORDER BY relative_path")
        .map_err(AppError::database)?;
    let rows = statement
        .query_map(params![source.id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, f64>(3)?,
            ))
        })
        .map_err(AppError::database)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(AppError::database)?;
    for (evidence_id, adapter, project_id, consumer_signal) in rows {
        source.evidence_ids.push(evidence_id);
        if let Ok(adapter_id) = parse_enum(&adapter) {
            if !source.adapter_ids.contains(&adapter_id) {
                source.adapter_ids.push(adapter_id);
            }
        }
        if consumer_signal > 0.0 {
            if let Some(project_id) = project_id {
                if Some(&project_id) != source.owner_project_id.as_ref()
                    && !source.consumer_project_ids.contains(&project_id)
                {
                    source.consumer_project_ids.push(project_id);
                }
            }
        }
    }
    Ok(source)
}

fn write_graph(
    connection: &Connection,
    source_id: &str,
    reference: &GraphRef,
    graph: &ExtractedDatabaseGraph,
) -> AppResult<()> {
    let (snapshot_id, revision_id) = reference.columns();
    connection
        .execute(
            "DELETE FROM database_object_provenance WHERE snapshot_id=?1 AND design_revision_id=?2",
            params![snapshot_id, revision_id],
        )
        .map_err(AppError::database)?;
    connection
        .execute(
            "DELETE FROM database_edges WHERE snapshot_id=?1 AND design_revision_id=?2",
            params![snapshot_id, revision_id],
        )
        .map_err(AppError::database)?;
    connection
        .execute(
            "DELETE FROM database_objects WHERE snapshot_id=?1 AND design_revision_id=?2",
            params![snapshot_id, revision_id],
        )
        .map_err(AppError::database)?;

    for object in &graph.objects {
        let meta = object.meta();
        let (namespace_id, parent_id, native_type, ordinal, nullable) = object_columns(object);
        connection
            .execute(
                "INSERT INTO database_objects(id,source_id,snapshot_id,design_revision_id,layer,object_kind,logical_key,qualified_name,parent_object_id,namespace_id,native_type,ordinal,nullable,payload_version,typed_payload_json,content_fingerprint,confidence,discovered_at,observed_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,1,?14,?15,?16,?17,?18,?19)",
                params![
                    meta.identity.id,
                    source_id,
                    snapshot_id,
                    revision_id,
                    enum_value(&meta.layer)?,
                    object.kind_name(),
                    meta.identity.logical_key,
                    meta.identity.qualified_name,
                    parent_id,
                    namespace_id,
                    native_type,
                    ordinal,
                    nullable,
                    serde_json::to_string(object).map_err(AppError::database)?,
                    meta.content_fingerprint,
                    meta.confidence,
                    meta.discovered_at,
                    meta.observed_at,
                    meta.updated_at,
                ],
            )
            .map_err(AppError::database)?;
    }

    // `database_edges.id` and `database_object_provenance.id` are global primary keys, while the
    // same logical edge legitimately exists in several snapshots of one source. Row identity is
    // therefore scoped to the graph reference; the logical identity stays in the endpoints.
    let scope = match reference {
        GraphRef::Snapshot(id) | GraphRef::Revision(id) => id.as_str(),
    };
    for edge in &graph.edges {
        connection
            .execute(
                "INSERT OR IGNORE INTO database_edges(id,source_id,snapshot_id,design_revision_id,source_object_id,target_object_id,edge_type,confidence,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                params![
                    scoped_id(scope, &edge.id),
                    source_id,
                    snapshot_id,
                    revision_id,
                    edge.source_object_id,
                    edge.target_object_id,
                    enum_value(&edge.edge_type)?,
                    edge.confidence,
                    edge.created_at,
                ],
            )
            .map_err(AppError::database)?;
    }

    for provenance in &graph.provenance {
        connection
            .execute(
                "INSERT INTO database_object_provenance(id,object_id,snapshot_id,design_revision_id,evidence_id,source_kind,certainty,confidence,evidence_ref,extractor_version,observed_at) VALUES(?1,?2,?3,?4,NULL,?5,?6,?7,?8,?9,?10)",
                params![
                    scoped_id(scope, &provenance.id),
                    provenance.object_id,
                    snapshot_id,
                    revision_id,
                    provenance.source_kind,
                    enum_value(&provenance.certainty)?,
                    provenance.confidence,
                    provenance.evidence_ref,
                    provenance.extractor_version,
                    provenance.observed_at,
                ],
            )
            .map_err(AppError::database)?;
    }
    Ok(())
}

/// Row identity for graph rows whose logical identity repeats across snapshots.
fn scoped_id(scope: &str, id: &str) -> String {
    format!("{scope}:{id}")
}

fn read_graph(connection: &Connection, reference: &GraphRef) -> AppResult<ExtractedDatabaseGraph> {
    let (snapshot_id, revision_id) = reference.columns();
    let mut objects_statement = connection
        .prepare(
            "SELECT typed_payload_json FROM database_objects WHERE snapshot_id=?1 AND design_revision_id=?2 ORDER BY object_kind, qualified_name, ordinal",
        )
        .map_err(AppError::database)?;
    let payloads = objects_statement
        .query_map(params![snapshot_id, revision_id], |row| {
            row.get::<_, String>(0)
        })
        .map_err(AppError::database)?
        .collect::<rusqlite::Result<Vec<String>>>()
        .map_err(AppError::database)?;
    let mut objects = Vec::with_capacity(payloads.len());
    for payload in payloads {
        objects.push(serde_json::from_str::<DatabaseObject>(&payload).map_err(AppError::database)?);
    }

    let mut edges_statement = connection
        .prepare(
            "SELECT id,source_object_id,target_object_id,edge_type,confidence,created_at FROM database_edges WHERE snapshot_id=?1 AND design_revision_id=?2 ORDER BY id",
        )
        .map_err(AppError::database)?;
    let edges = edges_statement
        .query_map(params![snapshot_id, revision_id], |row| {
            let edge_type: String = row.get(3)?;
            Ok(DatabaseEdge {
                id: row.get(0)?,
                source_object_id: row.get(1)?,
                target_object_id: row.get(2)?,
                edge_type: parse_enum(&edge_type)
                    .unwrap_or(crate::models::DatabaseEdgeType::DependsOn),
                snapshot_id: (!snapshot_id.is_empty()).then(|| snapshot_id.to_owned()),
                design_revision_id: (!revision_id.is_empty()).then(|| revision_id.to_owned()),
                confidence: row.get::<_, f64>(4)? as f32,
                provenance_ids: Vec::new(),
                created_at: row.get(5)?,
            })
        })
        .map_err(AppError::database)?
        .collect::<rusqlite::Result<Vec<DatabaseEdge>>>()
        .map_err(AppError::database)?;

    let mut provenance_statement = connection
        .prepare(
            "SELECT id,object_id,source_kind,certainty,confidence,evidence_ref,extractor_version,observed_at FROM database_object_provenance WHERE snapshot_id=?1 AND design_revision_id=?2 ORDER BY id",
        )
        .map_err(AppError::database)?;
    let provenance = provenance_statement
        .query_map(params![snapshot_id, revision_id], |row| {
            let certainty: String = row.get(3)?;
            Ok(DatabaseObjectProvenance {
                id: row.get(0)?,
                object_id: row.get(1)?,
                source_kind: row.get(2)?,
                certainty: parse_enum(&certainty)
                    .unwrap_or(crate::models::EvidenceCertainty::Heuristic),
                confidence: row.get::<_, f64>(4)? as f32,
                evidence_ref: row.get(5)?,
                extractor_version: row.get(6)?,
                observed_at: row.get(7)?,
            })
        })
        .map_err(AppError::database)?
        .collect::<rusqlite::Result<Vec<DatabaseObjectProvenance>>>()
        .map_err(AppError::database)?;

    Ok(ExtractedDatabaseGraph {
        objects,
        edges,
        provenance,
    })
}

/// Indexed projections of a typed object. These columns exist so the explorer can filter and sort
/// without deserializing every payload; the payload stays authoritative.
/// `(namespace_id, parent_object_id, native_type, ordinal, nullable)` — the indexed projection of a
/// typed object. Named so the insert site reads as columns rather than as an anonymous tuple.
type IndexedObjectColumns = (
    Option<String>,
    Option<String>,
    Option<String>,
    Option<i64>,
    Option<i64>,
);

fn object_columns(object: &DatabaseObject) -> IndexedObjectColumns {
    match object {
        DatabaseObject::Table(table) => (
            Some(table.namespace_id.clone()),
            Some(table.namespace_id.clone()),
            None,
            None,
            None,
        ),
        DatabaseObject::Column(column) => (
            None,
            Some(column.table_id.clone()),
            Some(column.native_type.clone()),
            Some(i64::from(column.ordinal)),
            Some(i64::from(column.nullable)),
        ),
        DatabaseObject::PrimaryKey(key) => (None, Some(key.table_id.clone()), None, None, None),
        DatabaseObject::ForeignKey(key) => (None, Some(key.table_id.clone()), None, None, None),
        DatabaseObject::UniqueConstraint(constraint) => {
            (None, Some(constraint.table_id.clone()), None, None, None)
        }
        DatabaseObject::CheckConstraint(constraint) => {
            (None, Some(constraint.table_id.clone()), None, None, None)
        }
        DatabaseObject::Index(index) => (None, Some(index.table_id.clone()), None, None, None),
        DatabaseObject::Enum(value) => (
            Some(value.namespace_id.clone()),
            Some(value.namespace_id.clone()),
            None,
            None,
            None,
        ),
        DatabaseObject::View(view) => (
            Some(view.namespace_id.clone()),
            Some(view.namespace_id.clone()),
            None,
            None,
            None,
        ),
        _ => (None, None, None, None, None),
    }
}

fn source_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<DatabaseSource> {
    let engine: String = row.get(4)?;
    Ok(DatabaseSource {
        id: row.get(0)?,
        repository_id: row.get(1)?,
        logical_key: row.get(2)?,
        display_name: row.get(3)?,
        engine: parse_enum(&engine).unwrap_or(crate::models::DatabaseEngine::Unknown),
        adapter_ids: Vec::new(),
        owner_project_id: row.get(5)?,
        consumer_project_ids: Vec::new(),
        environment_ids: Vec::new(),
        evidence_ids: Vec::new(),
        confidence: row.get::<_, f64>(6)? as f32,
        discovered_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

fn evidence_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<DatabaseSourceEvidence> {
    let adapter_id: String = row.get(3)?;
    let evidence_kind: String = row.get(4)?;
    let certainty: String = row.get(11)?;
    Ok(DatabaseSourceEvidence {
        id: row.get(0)?,
        repository_id: row.get(1)?,
        project_id: row.get(2)?,
        adapter_id: parse_enum(&adapter_id).unwrap_or(crate::models::DatabaseAdapterId::RawSql),
        evidence_kind: parse_enum(&evidence_kind)
            .unwrap_or(crate::models::DatabaseEvidenceKind::SqlDdl),
        relative_path: row.get(5)?,
        symbol_or_key: row.get(6)?,
        safe_value_fingerprint: row.get(7)?,
        source_hint: row.get(8)?,
        owner_signal: row.get::<_, f64>(9)? as f32,
        consumer_signal: row.get::<_, f64>(10)? as f32,
        certainty: parse_enum(&certainty).unwrap_or(crate::models::EvidenceCertainty::Heuristic),
        confidence: row.get::<_, f64>(12)? as f32,
        content_sha256: row.get(13)?,
        extractor_version: row.get(14)?,
        discovered_at: row.get(15)?,
    })
}

fn snapshot_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<DatabaseSnapshot> {
    let layer: String = row.get(2)?;
    let adapter_id: String = row.get(3)?;
    let status: String = row.get(10)?;
    Ok(DatabaseSnapshot {
        id: row.get(0)?,
        source_id: row.get(1)?,
        layer: parse_enum(&layer).unwrap_or(DatabaseLayer::Declared),
        adapter_id: parse_enum(&adapter_id).unwrap_or(crate::models::DatabaseAdapterId::RawSql),
        git_revision: row.get(4)?,
        parent_snapshot_id: row.get(5)?,
        fingerprint: row.get(6)?,
        object_count: row.get::<_, i64>(7)? as u32,
        edge_count: row.get::<_, i64>(8)? as u32,
        extractor_version: row.get(9)?,
        status: parse_enum(&status).unwrap_or(crate::models::DatabaseSnapshotStatus::Ready),
        created_at: row.get(11)?,
        completed_at: row.get(12)?,
    })
}

fn issue_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<DatabaseIssue> {
    let snapshot_id: String = row.get(2)?;
    let revision_id: String = row.get(3)?;
    let code: String = row.get(4)?;
    let severity: String = row.get(5)?;
    let explanation: String = row.get(7)?;
    let status: String = row.get(8)?;
    let detail = serde_json::from_str::<IssueDetail>(&explanation).unwrap_or(IssueDetail {
        explanation,
        semantic_object_ids: Vec::new(),
        evidence_ids: Vec::new(),
    });
    Ok(DatabaseIssue {
        id: row.get(0)?,
        source_id: row.get(1)?,
        snapshot_id: (!snapshot_id.is_empty()).then_some(snapshot_id),
        design_revision_id: (!revision_id.is_empty()).then_some(revision_id),
        semantic_object_ids: detail.semantic_object_ids,
        code: parse_enum(&code).unwrap_or(crate::models::DatabaseIssueCode::UnresolvedEvidence),
        severity: parse_enum(&severity).unwrap_or(DatabaseIssueSeverity::Warning),
        title: row.get(6)?,
        explanation: detail.explanation,
        evidence_ids: detail.evidence_ids,
        status: parse_enum(&status).unwrap_or(DatabaseIssueStatus::Open),
        detected_at: row.get(9)?,
        resolved_at: row.get(10)?,
    })
}

fn layout_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<crate::models::DatabaseLayout> {
    let snapshot_id: String = row.get(2)?;
    let revision_id: String = row.get(3)?;
    let viewport: String = row.get(7)?;
    let positions: String = row.get(8)?;
    Ok(crate::models::DatabaseLayout {
        id: row.get(0)?,
        source_id: row.get(1)?,
        snapshot_id: (!snapshot_id.is_empty()).then_some(snapshot_id),
        design_revision_id: (!revision_id.is_empty()).then_some(revision_id),
        layout_kind: row.get(4)?,
        semantic_lod: row.get::<_, i64>(5)? as u8,
        layout_fingerprint: row.get(6)?,
        viewport: serde_json::from_str(&viewport).unwrap_or(crate::models::DatabaseViewport {
            x: 0.0,
            y: 0.0,
            zoom: 1.0,
        }),
        positions: serde_json::from_str(&positions).unwrap_or_default(),
        updated_at: row.get(9)?,
    })
}

fn usage_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<DatabaseUsageReference> {
    let access: String = row.get(10)?;
    let certainty: String = row.get(11)?;
    let start_line: Option<i64> = row.get(6)?;
    let span = start_line.map(|start_line| crate::models::SourceSpan {
        start_line: start_line as u32,
        start_column: row.get::<_, Option<i64>>(7).ok().flatten().unwrap_or(0) as u32,
        end_line: row
            .get::<_, Option<i64>>(8)
            .ok()
            .flatten()
            .unwrap_or(start_line) as u32,
        end_column: row.get::<_, Option<i64>>(9).ok().flatten().unwrap_or(0) as u32,
    });
    Ok(DatabaseUsageReference {
        id: row.get(0)?,
        source_id: row.get(1)?,
        project_id: row.get(2)?,
        semantic_object_id: row.get(3)?,
        relative_path: row.get(4)?,
        symbol: row.get(5)?,
        span,
        access: parse_enum(&access).unwrap_or(crate::models::DatabaseAccessKind::Read),
        certainty: parse_enum(&certainty).unwrap_or(crate::models::EvidenceCertainty::Heuristic),
        confidence: row.get::<_, f64>(12)? as f32,
        content_sha256: row.get(13)?,
        observed_at: row.get(14)?,
    })
}

fn read_revision(connection: &Connection, revision_id: &str) -> AppResult<DatabaseDesignRevision> {
    let mut revision = connection
        .query_row(
            &format!("SELECT {REVISION_COLUMNS} FROM database_design_revisions WHERE id=?1"),
            params![revision_id],
            revision_from_row,
        )
        .optional()
        .map_err(AppError::database)?
        .ok_or_else(|| {
            AppError::new(
                "database_design_revision_not_found",
                "The requested database design revision was not found.",
                true,
            )
            .entity(revision_id)
            .layer("database_studio")
        })?;
    let mut statement = connection
        .prepare("SELECT id FROM database_design_operations WHERE result_revision_id=?1 ORDER BY sequence")
        .map_err(AppError::database)?;
    revision.operation_ids = statement
        .query_map(params![revision_id], |row| row.get::<_, String>(0))
        .map_err(AppError::database)?
        .collect::<rusqlite::Result<Vec<String>>>()
        .map_err(AppError::database)?;
    Ok(revision)
}

fn revision_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<DatabaseDesignRevision> {
    let state: String = row.get(5)?;
    let created_by_kind: String = row.get(7)?;
    let created_by_id: Option<String> = row.get(8)?;
    let decision_by_kind: Option<String> = row.get(10)?;
    let decision_by_id: Option<String> = row.get(11)?;
    Ok(DatabaseDesignRevision {
        id: row.get(0)?,
        design_id: row.get(1)?,
        parent_revision_id: row.get(2)?,
        merge_parent_revision_id: row.get(3)?,
        revision_number: row.get(4)?,
        state: parse_enum(&state).unwrap_or(DatabaseDesignRevisionState::Draft),
        graph_fingerprint: row.get(6)?,
        operation_ids: Vec::new(),
        created_by: actor_from_columns(&created_by_kind, created_by_id),
        created_at: row.get(9)?,
        decision_by: decision_by_kind.map(|kind| actor_from_columns(&kind, decision_by_id)),
        decision_at: row.get(12)?,
        decision_reason: row.get(13)?,
    })
}

fn operation_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<DatabaseDesignOperation> {
    let payload: String = row.get(5)?;
    let actor_kind: String = row.get(6)?;
    let actor_id: Option<String> = row.get(7)?;
    let operation =
        serde_json::from_str::<DatabaseDesignOperationKind>(&payload).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                5,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?;
    Ok(DatabaseDesignOperation {
        id: row.get(0)?,
        design_id: row.get(1)?,
        base_revision_id: row.get(2)?,
        result_revision_id: row.get(3)?,
        sequence: row.get(4)?,
        operation,
        actor: actor_from_columns(&actor_kind, actor_id),
        created_at: row.get(8)?,
    })
}

/// Round-trip a snake_case enum column back into its typed form using the same serde
/// representation the writer used, so no second hand-maintained mapping table can drift.
fn parse_enum<T: serde::de::DeserializeOwned>(value: &str) -> Result<T, serde_json::Error> {
    serde_json::from_value(serde_json::Value::String(value.to_owned()))
}

/// Index a graph's objects by semantic ID for callers that need random access.
pub fn index_objects(graph: &ExtractedDatabaseGraph) -> HashMap<&str, &DatabaseObject> {
    graph
        .objects
        .iter()
        .map(|object| (object.meta().identity.id.as_str(), object))
        .collect()
}

fn operation_kind_name(operation: &DatabaseDesignOperationKind) -> &'static str {
    match operation {
        DatabaseDesignOperationKind::AddNamespace { .. } => "add_namespace",
        DatabaseDesignOperationKind::AddTable { .. } => "add_table",
        DatabaseDesignOperationKind::RenameTable { .. } => "rename_table",
        DatabaseDesignOperationKind::DropTable { .. } => "drop_table",
        DatabaseDesignOperationKind::AddColumn { .. } => "add_column",
        DatabaseDesignOperationKind::AlterColumn { .. } => "alter_column",
        DatabaseDesignOperationKind::DropColumn { .. } => "drop_column",
        DatabaseDesignOperationKind::AddPrimaryKey { .. } => "add_primary_key",
        DatabaseDesignOperationKind::AddForeignKey { .. } => "add_foreign_key",
        DatabaseDesignOperationKind::AddUniqueConstraint { .. } => "add_unique_constraint",
        DatabaseDesignOperationKind::AddCheckConstraint { .. } => "add_check_constraint",
        DatabaseDesignOperationKind::AddIndex { .. } => "add_index",
        DatabaseDesignOperationKind::DropObject { .. } => "drop_object",
    }
}

#![allow(dead_code)]

use crate::errors::{AppError, AppResult};
use crate::models::{
    DatabaseActor, DatabaseDesign, DatabaseDesignOperation, DatabaseDesignOperationKind,
    DatabaseDesignRevision, DatabaseDesignRevisionState, DatabaseDesignStatus, DatabaseSource,
    DatabaseSourceEvidence,
};
use crate::services::database_studio::design::{self, ActualDesignHead};
use rusqlite::{params, Connection, OptionalExtension};

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

pub fn compare_and_materialize_revision(
    connection: &Connection,
    design_id: &str,
    expected_head_revision_id: &str,
    expected_revision_number: i64,
    updated_at: String,
    revision: &DatabaseDesignRevision,
    operation: &DatabaseDesignOperation,
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

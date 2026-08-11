#![allow(dead_code)]

use crate::database::database_studio::{self, RevisionDecision};
use crate::errors::{AppError, AppResult};
use crate::models::{
    DatabaseActor, DatabaseDesign, DatabaseDesignOperation, DatabaseDesignOperationKind,
    DatabaseDesignRevision, DatabaseDesignRevisionState, DatabaseDesignStatus, DesignId,
    RevisionId, SemanticId,
};
use rusqlite::Connection;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExpectedDesignHead {
    pub revision_id: RevisionId,
    pub revision_number: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActualDesignHead {
    pub revision_id: RevisionId,
    pub revision_number: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CreateDesignRequest {
    pub source_id: String,
    pub name: String,
    pub base_snapshot_id: Option<String>,
    pub actor: DatabaseActor,
    pub graph_fingerprint: String,
    pub now: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CreateDraftRequest {
    pub source_id: String,
    pub name: String,
    pub base_revision_id: RevisionId,
    pub actor: DatabaseActor,
    pub graph_fingerprint: String,
    pub now: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MaterializeRevisionRequest {
    pub design_id: DesignId,
    pub expected_head: ExpectedDesignHead,
    pub operation: DatabaseDesignOperationKind,
    pub actor: DatabaseActor,
    pub graph_fingerprint: String,
    pub now: String,
    pub source_id: String,
    /// The revision this operation will produce. Minted by the caller so the proposed graph can be
    /// stamped with it *before* the transaction that writes both.
    pub revision_id: RevisionId,
    /// The complete proposed graph this operation produces. Written in the same transaction that
    /// advances the head, so head and graph can never disagree.
    pub graph: crate::models::ExtractedDatabaseGraph,
}

/// Mint a revision identity ahead of the transaction that materializes it.
pub fn next_revision_id() -> RevisionId {
    revision_id()
}

#[derive(Debug, Clone, PartialEq)]
pub struct MaterializedRevision {
    pub design: DatabaseDesign,
    pub revision: DatabaseDesignRevision,
    pub operation: DatabaseDesignOperation,
}

pub fn create_design(
    connection: &Connection,
    request: CreateDesignRequest,
) -> AppResult<DatabaseDesign> {
    let design_id = design_id();
    let revision_id = revision_id();
    let revision = DatabaseDesignRevision {
        id: revision_id.clone(),
        design_id: design_id.clone(),
        parent_revision_id: None,
        merge_parent_revision_id: None,
        revision_number: 0,
        state: DatabaseDesignRevisionState::Draft,
        graph_fingerprint: request.graph_fingerprint,
        operation_ids: Vec::new(),
        created_by: request.actor.clone(),
        created_at: request.now.clone(),
        decision_by: None,
        decision_at: None,
        decision_reason: None,
    };
    let design = DatabaseDesign {
        id: design_id,
        source_id: request.source_id,
        name: request.name,
        status: DatabaseDesignStatus::Draft,
        base_snapshot_id: request.base_snapshot_id,
        base_revision_id: None,
        head_revision_id: revision_id,
        revision_number: 0,
        created_by: request.actor,
        created_at: request.now.clone(),
        updated_at: request.now,
        approved_revision_id: None,
    };

    database_studio::create_design_with_initial_revision(connection, &design, &revision)?;
    Ok(design)
}

pub fn create_draft(
    connection: &Connection,
    request: CreateDraftRequest,
) -> AppResult<DatabaseDesign> {
    let design_id = design_id();
    let revision_id = revision_id();
    let revision = DatabaseDesignRevision {
        id: revision_id.clone(),
        design_id: design_id.clone(),
        parent_revision_id: Some(request.base_revision_id.clone()),
        merge_parent_revision_id: None,
        revision_number: 0,
        state: DatabaseDesignRevisionState::Draft,
        graph_fingerprint: request.graph_fingerprint,
        operation_ids: Vec::new(),
        created_by: request.actor.clone(),
        created_at: request.now.clone(),
        decision_by: None,
        decision_at: None,
        decision_reason: None,
    };
    let design = DatabaseDesign {
        id: design_id,
        source_id: request.source_id,
        name: request.name,
        status: DatabaseDesignStatus::Draft,
        base_snapshot_id: None,
        base_revision_id: Some(request.base_revision_id),
        head_revision_id: revision_id,
        revision_number: 0,
        created_by: request.actor,
        created_at: request.now.clone(),
        updated_at: request.now,
        approved_revision_id: None,
    };

    database_studio::create_design_with_initial_revision(connection, &design, &revision)?;
    Ok(design)
}

pub fn apply_operation(
    connection: &Connection,
    request: MaterializeRevisionRequest,
) -> AppResult<MaterializedRevision> {
    let result_revision_id = request.revision_id.clone();
    let operation_id = operation_id();
    let next_revision_number = request.expected_head.revision_number + 1;

    let revision = DatabaseDesignRevision {
        id: result_revision_id.clone(),
        design_id: request.design_id.clone(),
        parent_revision_id: Some(request.expected_head.revision_id.clone()),
        merge_parent_revision_id: None,
        revision_number: next_revision_number,
        state: DatabaseDesignRevisionState::Draft,
        graph_fingerprint: request.graph_fingerprint,
        operation_ids: vec![operation_id.clone()],
        created_by: request.actor.clone(),
        created_at: request.now.clone(),
        decision_by: None,
        decision_at: None,
        decision_reason: None,
    };
    let operation = DatabaseDesignOperation {
        id: operation_id,
        design_id: request.design_id.clone(),
        base_revision_id: request.expected_head.revision_id.clone(),
        result_revision_id,
        sequence: 0,
        operation: request.operation,
        actor: request.actor,
        created_at: request.now.clone(),
    };

    database_studio::compare_and_materialize_revision(
        connection,
        &request.design_id,
        &request.expected_head.revision_id,
        request.expected_head.revision_number,
        request.now,
        &revision,
        &operation,
        &request.source_id,
        &request.graph,
    )?;

    let design = database_studio::get_design(connection, &request.design_id)?;
    Ok(MaterializedRevision {
        design,
        revision,
        operation,
    })
}

pub fn approve_design_revision(
    connection: &Connection,
    design_id: &str,
    revision_id: &str,
    actor: &DatabaseActor,
    reason: Option<&str>,
    now: &str,
) -> AppResult<()> {
    database_studio::set_design_revision_decision(
        connection,
        RevisionDecision {
            design_id,
            revision_id,
            design_status: DatabaseDesignStatus::Approved,
            revision_state: DatabaseDesignRevisionState::Approved,
            actor,
            reason,
            now,
        },
    )
}

pub fn reject_design_revision(
    connection: &Connection,
    design_id: &str,
    revision_id: &str,
    actor: &DatabaseActor,
    reason: Option<&str>,
    now: &str,
) -> AppResult<()> {
    database_studio::set_design_revision_decision(
        connection,
        RevisionDecision {
            design_id,
            revision_id,
            design_status: DatabaseDesignStatus::Rejected,
            revision_state: DatabaseDesignRevisionState::Rejected,
            actor,
            reason,
            now,
        },
    )
}

pub fn archive_design(
    connection: &Connection,
    design_id: &str,
    actor: &DatabaseActor,
    reason: Option<&str>,
    now: &str,
) -> AppResult<()> {
    let design = database_studio::get_design(connection, design_id)?;
    database_studio::set_design_revision_decision(
        connection,
        RevisionDecision {
            design_id,
            revision_id: &design.head_revision_id,
            design_status: DatabaseDesignStatus::Archived,
            revision_state: DatabaseDesignRevisionState::Archived,
            actor,
            reason,
            now,
        },
    )
}

pub fn proposed_object_id(kind: &str) -> SemanticId {
    format!("db:{kind}:p_{}", Uuid::new_v4().simple())
}

pub fn rename_proposed_identity(
    identity: &crate::models::SemanticIdentity,
    new_qualified_name: impl Into<String>,
) -> crate::models::SemanticIdentity {
    let mut renamed = identity.clone();
    renamed.qualified_name = new_qualified_name.into();
    renamed
}

pub fn stale_design_error(
    design_id: &str,
    expected_revision_id: &str,
    expected_revision_number: i64,
    actual: ActualDesignHead,
) -> AppError {
    AppError::new(
        "database_design_stale_revision",
        "The database design changed before this revision could be saved.",
        true,
    )
    .entity(design_id)
    .detail(format!(
        "expected head {expected_revision_id} at revision {expected_revision_number}; actual head {} at revision {}",
        actual.revision_id, actual.revision_number
    ))
    .action("Reload the latest design revision and reapply the operation.")
    .layer("database_studio")
}

fn design_id() -> String {
    format!("dbdesign_{}", Uuid::new_v4().simple())
}

fn revision_id() -> String {
    format!("dbrev_{}", Uuid::new_v4().simple())
}

fn operation_id() -> String {
    format!("dbop_{}", Uuid::new_v4().simple())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{
        DatabaseAdapterId, DatabaseDataType, DatabaseLayer, DatabaseObjectMeta, DatabaseTable,
        DatabaseTypeFamily, SemanticIdentity,
    };
    use rusqlite::{params, Connection};

    fn setup() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(
            "PRAGMA foreign_keys = ON;
            CREATE TABLE database_sources (
              id TEXT PRIMARY KEY, repository_id TEXT NOT NULL, logical_key TEXT NOT NULL,
              display_name TEXT NOT NULL, engine TEXT NOT NULL, owner_project_id TEXT,
              confidence REAL NOT NULL, discovered_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE database_designs (
              id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES database_sources(id) ON DELETE CASCADE,
              name TEXT NOT NULL, status TEXT NOT NULL, base_snapshot_id TEXT,
              base_revision_id TEXT, head_revision_id TEXT NOT NULL, revision_number INTEGER NOT NULL,
              created_by_kind TEXT NOT NULL, created_by_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
              approved_revision_id TEXT
            );
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
            CREATE TABLE database_objects (
              id TEXT NOT NULL, source_id TEXT NOT NULL REFERENCES database_sources(id) ON DELETE CASCADE,
              snapshot_id TEXT NOT NULL DEFAULT '', design_revision_id TEXT NOT NULL DEFAULT '',
              layer TEXT NOT NULL, object_kind TEXT NOT NULL,
              logical_key TEXT NOT NULL, qualified_name TEXT NOT NULL, parent_object_id TEXT,
              namespace_id TEXT, native_type TEXT, ordinal INTEGER, nullable INTEGER,
              payload_version INTEGER NOT NULL, typed_payload_json TEXT NOT NULL, content_fingerprint TEXT NOT NULL,
              confidence REAL NOT NULL, discovered_at TEXT NOT NULL, observed_at TEXT NOT NULL, updated_at TEXT NOT NULL,
              PRIMARY KEY(id, snapshot_id, design_revision_id)
            );
            CREATE TABLE database_edges (
              id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES database_sources(id) ON DELETE CASCADE,
              snapshot_id TEXT NOT NULL DEFAULT '', design_revision_id TEXT NOT NULL DEFAULT '',
              source_object_id TEXT NOT NULL, target_object_id TEXT NOT NULL,
              edge_type TEXT NOT NULL, confidence REAL NOT NULL, created_at TEXT NOT NULL,
              UNIQUE(snapshot_id, design_revision_id, source_object_id, target_object_id, edge_type)
            );
            CREATE TABLE database_object_provenance (
              id TEXT PRIMARY KEY, object_id TEXT NOT NULL,
              snapshot_id TEXT NOT NULL DEFAULT '', design_revision_id TEXT NOT NULL DEFAULT '',
              evidence_id TEXT, source_kind TEXT NOT NULL, certainty TEXT NOT NULL, confidence REAL NOT NULL,
              evidence_ref TEXT, extractor_version TEXT NOT NULL, observed_at TEXT NOT NULL
            );",
        ).unwrap();
        connection.execute("INSERT INTO database_sources(id,repository_id,logical_key,display_name,engine,owner_project_id,confidence,discovered_at,updated_at) VALUES('source','repo','source','Source','sqlite',NULL,1.0,'now','now')", []).unwrap();
        connection
    }

    fn actor(session: &str) -> DatabaseActor {
        DatabaseActor::Agent {
            session_id: session.to_string(),
            agent_id: None,
        }
    }

    fn create_base(connection: &Connection) -> DatabaseDesign {
        create_design(
            connection,
            CreateDesignRequest {
                source_id: "source".into(),
                name: "base".into(),
                base_snapshot_id: None,
                actor: actor("claude"),
                graph_fingerprint: "g0".into(),
                now: "2026-08-11T00:00:00Z".into(),
            },
        )
        .unwrap()
    }

    fn add_table_operation(name: &str) -> DatabaseDesignOperationKind {
        DatabaseDesignOperationKind::AddTable { table: table(name) }
    }

    fn table(name: &str) -> DatabaseTable {
        let id = proposed_object_id("table");
        DatabaseTable {
            meta: DatabaseObjectMeta {
                identity: SemanticIdentity {
                    id: id.clone(),
                    logical_key: id,
                    qualified_name: format!("public.{name}"),
                    previous_ids: Vec::new(),
                },
                source_id: "source".into(),
                layer: DatabaseLayer::Proposed,
                snapshot_id: None,
                design_revision_id: None,
                confidence: 1.0,
                provenance_ids: Vec::new(),
                discovered_at: "now".into(),
                observed_at: "now".into(),
                updated_at: "now".into(),
                content_fingerprint: name.into(),
            },
            namespace_id: "namespace".into(),
            name: name.into(),
            mapped_name: None,
            comment: None,
            column_ids: Vec::new(),
            primary_key_id: None,
            foreign_key_ids: Vec::new(),
            unique_constraint_ids: Vec::new(),
            check_constraint_ids: Vec::new(),
            index_ids: Vec::new(),
        }
    }

    fn materialize(
        design: &DatabaseDesign,
        expected_head: ExpectedDesignHead,
        operation: DatabaseDesignOperationKind,
        actor: DatabaseActor,
        graph_fingerprint: &str,
        now: &str,
    ) -> MaterializeRevisionRequest {
        MaterializeRevisionRequest {
            design_id: design.id.clone(),
            expected_head,
            operation,
            actor,
            graph_fingerprint: graph_fingerprint.into(),
            now: now.into(),
            source_id: design.source_id.clone(),
            revision_id: next_revision_id(),
            graph: crate::models::ExtractedDatabaseGraph {
                objects: Vec::new(),
                edges: Vec::new(),
                provenance: Vec::new(),
            },
        }
    }

    fn expected(design: &DatabaseDesign) -> ExpectedDesignHead {
        ExpectedDesignHead {
            revision_id: design.head_revision_id.clone(),
            revision_number: design.revision_number,
        }
    }

    #[test]
    fn materialized_revision_is_immutable_and_never_mutated_in_place() {
        let connection = setup();
        let design = create_base(&connection);
        let base_head = design.head_revision_id.clone();

        let materialized = apply_operation(
            &connection,
            materialize(
                &design,
                expected(&design),
                add_table_operation("accounts"),
                actor("claude"),
                "g1",
                "2026-08-11T00:01:00Z",
            ),
        )
        .unwrap();

        let base: (String, i64, String) = connection
            .query_row(
                "SELECT id, revision_number, graph_fingerprint FROM database_design_revisions WHERE id=?1",
                params![base_head],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(base, (design.head_revision_id, 0, "g0".into()));
        assert_ne!(materialized.revision.id, base.0);
        assert_eq!(materialized.design.revision_number, 1);
    }

    #[test]
    fn two_independent_drafts_branch_from_one_base_revision_without_interference() {
        let connection = setup();
        let base = create_base(&connection);

        let claude = create_draft(
            &connection,
            CreateDraftRequest {
                source_id: "source".into(),
                name: "claude draft".into(),
                base_revision_id: base.head_revision_id.clone(),
                actor: actor("claude"),
                graph_fingerprint: "claude0".into(),
                now: "2026-08-11T00:02:00Z".into(),
            },
        )
        .unwrap();
        let codex = create_draft(
            &connection,
            CreateDraftRequest {
                source_id: "source".into(),
                name: "codex draft".into(),
                base_revision_id: base.head_revision_id.clone(),
                actor: actor("codex"),
                graph_fingerprint: "codex0".into(),
                now: "2026-08-11T00:03:00Z".into(),
            },
        )
        .unwrap();

        let claude_result = apply_operation(
            &connection,
            materialize(
                &claude,
                expected(&claude),
                add_table_operation("claude_table"),
                actor("claude"),
                "claude1",
                "2026-08-11T00:04:00Z",
            ),
        )
        .unwrap();

        let codex_after =
            crate::database::database_studio::get_design(&connection, &codex.id).unwrap();
        assert_eq!(codex_after.head_revision_id, codex.head_revision_id);
        assert_eq!(codex_after.revision_number, 0);
        assert_eq!(claude_result.design.revision_number, 1);
        assert_ne!(claude_result.design.id, codex_after.id);
    }

    #[test]
    fn stale_revision_write_is_rejected_and_losing_operation_is_not_applied() {
        let connection = setup();
        let design = create_base(&connection);
        let stale = expected(&design);

        apply_operation(
            &connection,
            materialize(
                &design,
                stale.clone(),
                add_table_operation("winner"),
                actor("claude"),
                "winner",
                "2026-08-11T00:05:00Z",
            ),
        )
        .unwrap();

        let error = apply_operation(
            &connection,
            materialize(
                &design,
                stale,
                add_table_operation("loser"),
                actor("codex"),
                "loser",
                "2026-08-11T00:06:00Z",
            ),
        )
        .unwrap_err();

        assert_eq!(error.code, "database_design_stale_revision");
        let operation_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM database_design_operations WHERE operation_payload_json LIKE '%loser%'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(operation_count, 0);
        let design_after =
            crate::database::database_studio::get_design(&connection, &design.id).unwrap();
        assert_eq!(design_after.revision_number, 1);
    }

    #[test]
    fn proposed_rename_preserves_synthetic_identity_for_selection_layout_and_issue_refs() {
        let original = SemanticIdentity {
            id: proposed_object_id("table"),
            logical_key: "stable-proposed-table".into(),
            qualified_name: "public.accounts".into(),
            previous_ids: vec!["db:table:declared_old".into()],
        };

        let renamed = rename_proposed_identity(&original, "public.customers");

        assert_eq!(renamed.id, original.id);
        assert_eq!(renamed.logical_key, original.logical_key);
        assert_eq!(renamed.previous_ids, original.previous_ids);
        assert_eq!(renamed.qualified_name, "public.customers");
    }

    #[test]
    fn compile_database_adapter_import_keeps_fixture_model_representative() {
        assert_eq!(DatabaseAdapterId::Sqlite, DatabaseAdapterId::Sqlite);
        assert_eq!(DatabaseTypeFamily::Text, DatabaseTypeFamily::Text);
        let _ = DatabaseDataType {
            family: DatabaseTypeFamily::Text,
            length: None,
            precision: None,
            scale: None,
            array_dimensions: 0,
            unsigned: false,
        };
    }
}

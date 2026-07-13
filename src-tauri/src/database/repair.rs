use super::DatabaseService;
use crate::errors::{AppError, AppResult};
use crate::models::{LayoutNode, RepairEntry, RepairSummary};
use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use std::collections::HashSet;
use uuid::Uuid;

impl DatabaseService {
    /// Idempotent metadata repair. It never touches Project folders or terminal logs.
    pub fn repair_metadata(&self) -> AppResult<RepairSummary> {
        let mut connection = self.connection.lock();
        let transaction = connection.transaction()?;
        let mut summary = RepairSummary::default();

        let stale = transaction.execute(
            "UPDATE terminal_sessions SET status='disconnected',process_id=NULL,restoration_state='stale',ended_at=coalesce(ended_at,?1) WHERE status IN ('running','terminating')",
            [Utc::now().to_rfc3339()],
        )?;
        if stale > 0 {
            record(
                &transaction,
                "normalize_stale_sessions",
                "terminal_session",
                None,
                &format!("Marked {stale} stale sessions disconnected."),
            )?;
            summary.repaired += stale as u64;
            summary.entries.push(RepairEntry {
                code: "normalize_stale_sessions".into(),
                entity_type: "terminal_session".into(),
                entity_id: None,
                detail: format!("Marked {stale} stale sessions disconnected."),
            });
        }

        let workspaces = {
            let mut statement = transaction.prepare(
                "SELECT id,layout_json,active_pane_id FROM workspaces ORDER BY created_at",
            )?;
            let rows = statement
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            rows
        };

        for (workspace_id, layout_json, active_pane_id) in workspaces {
            summary.inspected += 1;
            let pane_ids = {
                let mut statement = transaction.prepare(
                    "SELECT id FROM workspace_panes WHERE workspace_id=?1 ORDER BY position_order",
                )?;
                let rows = statement
                    .query_map([&workspace_id], |row| row.get::<_, String>(0))?
                    .collect::<Result<Vec<_>, _>>()?;
                rows
            };
            let assigned: HashSet<_> = pane_ids.iter().cloned().collect();
            let parsed = serde_json::from_str::<LayoutNode>(&layout_json)
                .ok()
                .and_then(|layout| layout.validate().ok().map(|ids| (layout, ids)));
            let valid = parsed.as_ref().is_some_and(|(_, ids)| {
                ids.len() == assigned.len() && ids.iter().all(|id| assigned.contains(id))
            });
            if valid {
                if active_pane_id
                    .as_ref()
                    .is_some_and(|id| !assigned.contains(id))
                {
                    transaction.execute(
                        "UPDATE workspaces SET active_pane_id=?2 WHERE id=?1",
                        params![workspace_id, pane_ids.first()],
                    )?;
                    record(
                        &transaction,
                        "repair_active_pane",
                        "workspace",
                        Some(&workspace_id),
                        "Reset an invalid active Pane preference.",
                    )?;
                    summary.repaired += 1;
                }
                continue;
            }

            if pane_ids.is_empty() {
                quarantine(
                    &transaction,
                    "workspace",
                    &workspace_id,
                    "workspace_without_panes",
                    &layout_json,
                )?;
                transaction.execute(
                    "UPDATE workspaces SET removed_from_recent=1 WHERE id=?1",
                    [&workspace_id],
                )?;
                summary.quarantined += 1;
                summary.entries.push(RepairEntry {
                    code: "workspace_without_panes".into(),
                    entity_type: "workspace".into(),
                    entity_id: Some(workspace_id),
                    detail: "Workspace metadata was quarantined because it has no Panes.".into(),
                });
                continue;
            }

            let repaired_layout = layout_from_panes(&pane_ids);
            let serialized = serde_json::to_string(&repaired_layout).map_err(|error| {
                AppError::new(
                    "repair_error",
                    "A repaired layout could not be serialized.",
                    false,
                )
                .detail(error.to_string())
                .layer("repair")
            })?;
            transaction.execute(
                "UPDATE workspaces SET layout_json=?2,active_pane_id=?3,updated_at=?4 WHERE id=?1",
                params![
                    workspace_id,
                    serialized,
                    active_pane_id
                        .filter(|id| assigned.contains(id))
                        .or_else(|| pane_ids.first().cloned()),
                    Utc::now().to_rfc3339()
                ],
            )?;
            record(
                &transaction,
                "repair_layout_references",
                "workspace",
                Some(&workspace_id),
                "Rebuilt the layout from durable Pane Configuration records.",
            )?;
            summary.repaired += 1;
            summary.entries.push(RepairEntry {
                code: "repair_layout_references".into(),
                entity_type: "workspace".into(),
                entity_id: Some(workspace_id),
                detail: "Rebuilt invalid layout references without deleting Pane configurations."
                    .into(),
            });
        }

        transaction.commit()?;
        Ok(summary)
    }
}

fn layout_from_panes(ids: &[String]) -> LayoutNode {
    if ids.len() == 1 {
        return LayoutNode::Pane {
            pane_id: ids[0].clone(),
        };
    }
    LayoutNode::Split {
        direction: crate::models::SplitDirection::Vertical,
        sizes: vec![100.0 / ids.len() as f64; ids.len()],
        children: ids
            .iter()
            .map(|id| LayoutNode::Pane {
                pane_id: id.clone(),
            })
            .collect(),
    }
}

fn record(
    transaction: &rusqlite::Transaction<'_>,
    code: &str,
    entity_type: &str,
    entity_id: Option<&str>,
    detail: &str,
) -> AppResult<()> {
    let exists: Option<String> = transaction
        .query_row(
            "SELECT id FROM migration_repair_history WHERE repair_code=?1 AND affected_entity_type=?2 AND affected_entity_id IS ?3",
            params![code, entity_type, entity_id],
            |row| row.get(0),
        )
        .optional()?;
    if exists.is_none() {
        transaction.execute(
            "INSERT INTO migration_repair_history(id,repair_code,affected_entity_type,affected_entity_id,detail_json,applied_at) VALUES(?1,?2,?3,?4,?5,?6)",
            params![Uuid::new_v4().to_string(), code, entity_type, entity_id, detail, Utc::now().to_rfc3339()],
        )?;
    }
    Ok(())
}

fn quarantine(
    transaction: &rusqlite::Transaction<'_>,
    entity_type: &str,
    entity_id: &str,
    reason: &str,
    payload: &str,
) -> AppResult<()> {
    let exists: Option<String> = transaction
        .query_row(
            "SELECT id FROM metadata_quarantine WHERE entity_type=?1 AND entity_id=?2 AND reason_code=?3",
            params![entity_type, entity_id, reason],
            |row| row.get(0),
        )
        .optional()?;
    if exists.is_none() {
        transaction.execute(
            "INSERT INTO metadata_quarantine(id,entity_type,entity_id,reason_code,payload_json,quarantined_at) VALUES(?1,?2,?3,?4,?5,?6)",
            params![Uuid::new_v4().to_string(), entity_type, entity_id, reason, payload, Utc::now().to_rfc3339()],
        )?;
    }
    Ok(())
}

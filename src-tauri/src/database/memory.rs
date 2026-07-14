use super::DatabaseService;
use crate::errors::{AppError, AppResult};
use crate::memory::{
    bounded_text, chunks, reject_secrets, summary, CaptureOutcome, MemoryHealth, MemoryItemView,
    MemoryRebuildResult, MemorySearchResponse, MemorySearchResult, MemorySourceView,
};
use chrono::Utc;
use rusqlite::{params, OptionalExtension, Row, Transaction};
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use uuid::Uuid;

struct CaptureInput<'a> {
    project_id: &'a str,
    workspace_id: Option<&'a str>,
    memory_type: &'a str,
    dedup_key: String,
    title: &'a str,
    body: &'a str,
    source_type: &'a str,
    uri: String,
    file_path: Option<&'a str>,
}

struct ChunkInsert<'a> {
    project_id: &'a str,
    item_id: &'a str,
    revision_id: &'a str,
    title: &'a str,
    body: &'a str,
    file_path: Option<&'a str>,
    created_at: &'a str,
}

struct ReindexChunk {
    chunk_id: String,
    item_id: String,
    title: String,
    body: String,
    symbol_name: Option<String>,
    file_path: Option<String>,
}

fn content_hash(parts: &[&str]) -> String {
    let mut hasher = DefaultHasher::new();
    for part in parts {
        part.hash(&mut hasher);
    }
    format!("{:016x}", hasher.finish())
}

fn map_source(row: &Row<'_>) -> rusqlite::Result<MemorySourceView> {
    Ok(MemorySourceView {
        id: row.get(0)?,
        source_type: row.get(1)?,
        project_id: row.get(2)?,
        uri: row.get(3)?,
        file_path: row.get(4)?,
        line_start: row.get(5)?,
        line_end: row.get(6)?,
        branch_name: row.get(7)?,
        git_commit: row.get(8)?,
        worktree_id: row.get(9)?,
        workspace_id: row.get(10)?,
        pane_id: row.get(11)?,
        terminal_session_id: row.get(12)?,
        agent_session_id: row.get(13)?,
        event_id: row.get(14)?,
        captured_at: row.get(15)?,
        excerpt: row.get(16)?,
        mime_type: row.get(17)?,
        sensitivity: row.get(18)?,
    })
}

const SOURCE_COLUMNS: &str = "s.id,s.source_type,s.project_id,s.uri,s.file_path,s.line_start,s.line_end,s.branch_name,s.git_commit,s.worktree_id,s.workspace_id,s.pane_id,s.terminal_session_id,s.agent_session_id,s.event_id,s.captured_at,s.excerpt,s.mime_type,s.sensitivity";

impl DatabaseService {
    pub fn memory_add_note(
        &self,
        project_id: &str,
        workspace_id: Option<&str>,
        title: &str,
        body: &str,
        memory_type: Option<&str>,
    ) -> AppResult<CaptureOutcome> {
        if title.trim().is_empty() || body.trim().is_empty() {
            return Err(AppError::new(
                "memory_note_empty",
                "Memory notes require a title and body.",
                true,
            )
            .layer("memory-domain"));
        }
        let kind = memory_type.unwrap_or("note");
        let hash = content_hash(&[title.trim(), body.trim()]);
        self.persist_capture(CaptureInput {
            project_id,
            workspace_id,
            memory_type: kind,
            dedup_key: format!("note:{hash}"),
            title: title.trim(),
            body: body.trim(),
            source_type: "manual_note",
            uri: format!("memory://note/{hash}"),
            file_path: None,
        })
    }

    pub fn memory_capture_file(
        &self,
        project_id: &str,
        workspace_id: Option<&str>,
        file_path: &str,
    ) -> AppResult<CaptureOutcome> {
        let project = self.get_project(project_id)?;
        let root = fs::canonicalize(&project.root_path).map_err(|error| {
            AppError::new(
                "project_folder_missing",
                "The Project folder is unavailable.",
                true,
            )
            .detail(error.to_string())
            .entity(project_id)
            .layer("memory-capture")
        })?;
        let path = fs::canonicalize(file_path).map_err(|error| {
            AppError::new(
                "memory_source_missing",
                "The selected file is unavailable.",
                true,
            )
            .detail(error.to_string())
            .entity(file_path)
            .layer("memory-capture")
        })?;
        if !path.starts_with(&root) || !path.is_file() {
            return Err(AppError::new(
                "memory_source_outside_project",
                "Memory can capture only files owned by this Project.",
                true,
            )
            .entity(file_path)
            .layer("memory-capture"));
        }
        let bytes = fs::read(&path)?;
        let body = bounded_text(&bytes).ok_or_else(|| {
            AppError::new(
                "memory_source_unsupported",
                "The file is binary or exceeds the 2 MB Memory capture limit.",
                true,
            )
            .entity(file_path)
            .layer("memory-capture")
        })?;
        let relative = path
            .strip_prefix(&root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        let title = format!("Project file: {relative}");
        self.persist_capture(CaptureInput {
            project_id,
            workspace_id,
            memory_type: "code_knowledge",
            dedup_key: format!("file:{}", relative.to_ascii_lowercase()),
            title: &title,
            body: &body,
            source_type: "file",
            uri: format!("project://{project_id}/{relative}"),
            file_path: Some(path.to_string_lossy().as_ref()),
        })
    }

    fn persist_capture(&self, input: CaptureInput<'_>) -> AppResult<CaptureOutcome> {
        reject_secrets(input.body)?;
        self.get_project(input.project_id)?;
        if let Some(workspace_id) = input.workspace_id {
            let workspace = self.get_workspace(workspace_id)?;
            if workspace.project_id != input.project_id {
                return Err(AppError::new(
                    "memory_workspace_project_mismatch",
                    "The Memory Workspace belongs to a different Project.",
                    true,
                )
                .entity(workspace_id)
                .layer("memory-domain"));
            }
        }

        let now = Utc::now().to_rfc3339();
        let event_hash =
            content_hash(&[input.project_id, &input.dedup_key, input.title, input.body]);
        let source_hash = content_hash(&[input.project_id, &input.uri, input.body]);
        let revision_hash = content_hash(&[input.title, input.body]);
        let mut connection = self.connection.lock();
        let transaction = connection.transaction()?;

        let event_id = transaction
            .query_row(
                "SELECT id FROM memory_events WHERE project_id=?1 AND content_hash=?2",
                params![input.project_id, event_hash],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let sequence: i64 = transaction.query_row(
            "SELECT COALESCE(MAX(sequence),0)+1 FROM memory_events WHERE project_id=?1",
            [input.project_id],
            |row| row.get(0),
        )?;
        transaction.execute(
            "INSERT OR IGNORE INTO memory_events(id,sequence,event_type,project_id,workspace_id,actor_type,payload_json,content_hash,occurred_at,captured_at,sensitivity) VALUES(?1,?2,'memory_capture',?3,?4,'user',?5,?6,?7,?7,'normal')",
            params![event_id, sequence, input.project_id, input.workspace_id, serde_json::json!({"title":input.title,"type":input.memory_type}).to_string(), event_hash, now],
        )?;

        let existing_item: Option<(String, Option<String>)> = transaction
            .query_row(
                "SELECT id,current_revision_id FROM memory_items WHERE project_id=?1 AND dedup_key=?2",
                params![input.project_id, input.dedup_key],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        if let Some((item_id, Some(revision_id))) = existing_item.as_ref() {
            let current_hash: String = transaction.query_row(
                "SELECT content_hash FROM memory_revisions WHERE id=?1",
                [revision_id],
                |row| row.get(0),
            )?;
            if current_hash == revision_hash {
                transaction.commit()?;
                return Ok(CaptureOutcome {
                    event_id,
                    item_id: item_id.clone(),
                    revision_id: revision_id.clone(),
                    deduplicated: true,
                    sensitivity: "normal".into(),
                });
            }
        }

        let item_id = existing_item
            .as_ref()
            .map(|(id, _)| id.clone())
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let revision_id = Uuid::new_v4().to_string();
        let revision_number: i64 = transaction.query_row(
            "SELECT COALESCE(MAX(revision_number),0)+1 FROM memory_revisions WHERE item_id=?1",
            [&item_id],
            |row| row.get(0),
        )?;
        transaction.execute(
            "INSERT INTO memory_items(id,project_id,memory_type,dedup_key,title,state,visibility,workspace_id,pinned,current_revision_id,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,'active','project_shared',?6,0,?7,?8,?8) ON CONFLICT(project_id,dedup_key) DO UPDATE SET memory_type=excluded.memory_type,title=excluded.title,workspace_id=excluded.workspace_id,current_revision_id=excluded.current_revision_id,updated_at=excluded.updated_at",
            params![item_id,input.project_id,input.memory_type,input.dedup_key,input.title,input.workspace_id,revision_id,now],
        )?;
        transaction.execute(
            "INSERT INTO memory_revisions(id,item_id,revision_number,title,body,summary,confidence,observed_at,content_hash,extraction_method,created_at) VALUES(?1,?2,?3,?4,?5,?6,1.0,?7,?8,'deterministic',?7)",
            params![revision_id,item_id,revision_number,input.title,input.body,summary(input.body),now,revision_hash],
        )?;

        let source_id = transaction
            .query_row(
                "SELECT id FROM memory_sources WHERE project_id=?1 AND content_hash=?2",
                params![input.project_id, source_hash],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        transaction.execute(
            "INSERT OR IGNORE INTO memory_sources(id,source_type,project_id,uri,file_path,workspace_id,event_id,content_hash,captured_at,excerpt,mime_type,sensitivity) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,'text/plain','normal')",
            params![source_id,input.source_type,input.project_id,input.uri,input.file_path,input.workspace_id,event_id,source_hash,now,summary(input.body)],
        )?;
        transaction.execute(
            "INSERT OR IGNORE INTO memory_revision_sources(revision_id,source_id) VALUES(?1,?2)",
            params![revision_id, source_id],
        )?;
        insert_chunks(
            &transaction,
            ChunkInsert {
                project_id: input.project_id,
                item_id: &item_id,
                revision_id: &revision_id,
                title: input.title,
                body: input.body,
                file_path: input.file_path,
                created_at: &now,
            },
        )?;
        transaction.commit()?;
        Ok(CaptureOutcome {
            event_id,
            item_id,
            revision_id,
            deduplicated: false,
            sensitivity: "normal".into(),
        })
    }

    pub fn memory_get_item(&self, project_id: &str, item_id: &str) -> AppResult<MemoryItemView> {
        let connection = self.connection.lock();
        let mut item = connection
            .query_row(
                "SELECT i.id,i.project_id,i.memory_type,i.title,i.state,i.visibility,i.workspace_id,i.branch_name,i.pinned,r.id,r.revision_number,r.body,r.summary,r.confidence,r.observed_at,i.created_at,i.updated_at FROM memory_items i JOIN memory_revisions r ON r.id=i.current_revision_id WHERE i.id=?1 AND i.project_id=?2",
                params![item_id, project_id],
                |row| Ok(MemoryItemView {
                    id: row.get(0)?, project_id: row.get(1)?, memory_type: row.get(2)?, title: row.get(3)?, state: row.get(4)?, visibility: row.get(5)?, workspace_id: row.get(6)?, branch_name: row.get(7)?, pinned: row.get(8)?, revision_id: row.get(9)?, revision_number: row.get(10)?, body: row.get(11)?, summary: row.get(12)?, confidence: row.get(13)?, observed_at: row.get(14)?, created_at: row.get(15)?, updated_at: row.get(16)?, sources: Vec::new()
                }),
            )
            .optional()?
            .ok_or_else(|| AppError::new("memory_item_not_found", "The Memory item does not belong to this Project.", true).entity(item_id).layer("memory-persistence"))?;
        item.sources = load_sources(&connection, project_id, item_id)?;
        Ok(item)
    }

    pub fn memory_get_sources(
        &self,
        project_id: &str,
        item_id: &str,
    ) -> AppResult<Vec<MemorySourceView>> {
        self.memory_get_item(project_id, item_id)?;
        load_sources(&self.connection.lock(), project_id, item_id)
    }

    pub fn memory_search(
        &self,
        project_id: &str,
        query: &str,
        limit: Option<usize>,
    ) -> AppResult<MemorySearchResponse> {
        self.get_project(project_id)?;
        let limit = limit.unwrap_or(30).clamp(1, 100) as i64;
        let pattern = format!("%{}%", query.trim().replace('%', "\\%").replace('_', "\\_"));
        let connection = self.connection.lock();
        let mut statement = connection.prepare(
            "SELECT i.id,i.project_id,i.memory_type,i.title,r.summary,substr(r.body,1,500),i.workspace_id,i.branch_name,i.pinned,i.updated_at FROM memory_items i JOIN memory_revisions r ON r.id=i.current_revision_id WHERE i.project_id=?1 AND i.state='active' AND (?2='%%' OR i.title LIKE ?2 ESCAPE '\\' OR r.summary LIKE ?2 ESCAPE '\\' OR r.body LIKE ?2 ESCAPE '\\') ORDER BY i.pinned DESC,i.updated_at DESC LIMIT ?3",
        )?;
        let rows = statement
            .query_map(params![project_id, pattern, limit], |row| {
                Ok(MemorySearchResult {
                    item_id: row.get(0)?,
                    project_id: row.get(1)?,
                    memory_type: row.get(2)?,
                    title: row.get(3)?,
                    summary: row.get(4)?,
                    excerpt: row.get(5)?,
                    workspace_id: row.get(6)?,
                    branch_name: row.get(7)?,
                    pinned: row.get(8)?,
                    updated_at: row.get(9)?,
                    source: None,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let mut results = Vec::with_capacity(rows.len());
        for mut row in rows {
            row.source = load_sources(&connection, project_id, &row.item_id)?
                .into_iter()
                .next();
            results.push(row);
        }
        Ok(MemorySearchResponse {
            project_id: project_id.into(),
            query: query.into(),
            total: results.len(),
            results,
        })
    }

    pub fn memory_resolve_source_path(
        &self,
        project_id: &str,
        source_id: &str,
    ) -> AppResult<String> {
        let project = self.get_project(project_id)?;
        let path: String = self
            .connection
            .lock()
            .query_row(
                "SELECT file_path FROM memory_sources WHERE id=?1 AND project_id=?2 AND file_path IS NOT NULL",
                params![source_id, project_id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| AppError::new("memory_source_not_found", "The Memory source has no Project file.", true).entity(source_id))?;
        let root = fs::canonicalize(project.root_path)?;
        let resolved = fs::canonicalize(&path)?;
        if !resolved.starts_with(root) {
            return Err(AppError::new(
                "memory_source_outside_project",
                "The Memory source is outside the owning Project.",
                false,
            )
            .entity(source_id)
            .layer("memory-persistence"));
        }
        Ok(resolved.to_string_lossy().into_owned())
    }

    pub fn memory_health(&self, project_id: &str) -> AppResult<MemoryHealth> {
        self.get_project(project_id)?;
        let connection = self.connection.lock();
        let count = |table: &str| -> AppResult<usize> {
            connection
                .query_row(
                    &format!("SELECT count(*) FROM {table} WHERE project_id=?1"),
                    [project_id],
                    |row| row.get::<_, i64>(0),
                )
                .map(|value| value.max(0) as usize)
                .map_err(Into::into)
        };
        let item_count = count("memory_items")?;
        let source_count = count("memory_sources")?;
        let chunk_count = count("memory_chunks")?;
        let revision_count = connection.query_row(
            "SELECT count(*) FROM memory_revisions r JOIN memory_items i ON i.id=r.item_id WHERE i.project_id=?1",
            [project_id], |row| row.get::<_, i64>(0),
        )?.max(0) as usize;
        let indexed_chunk_count = connection
            .query_row(
                "SELECT count(*) FROM memory_chunks_fts WHERE project_id=?1",
                [project_id],
                |row| row.get::<_, i64>(0),
            )?
            .max(0) as usize;
        let healthy = indexed_chunk_count == chunk_count;
        Ok(MemoryHealth {
            project_id: project_id.into(),
            item_count,
            revision_count,
            source_count,
            chunk_count,
            indexed_chunk_count,
            healthy,
            messages: vec![if healthy {
                "Project Memory index is healthy.".into()
            } else {
                "Project Memory index requires rebuilding.".into()
            }],
        })
    }

    pub fn memory_rebuild_index(&self, project_id: &str) -> AppResult<MemoryRebuildResult> {
        self.get_project(project_id)?;
        let mut connection = self.connection.lock();
        let transaction = connection.transaction()?;
        transaction.execute(
            "DELETE FROM memory_chunks_fts WHERE project_id=?1",
            [project_id],
        )?;
        let rows: Vec<ReindexChunk> = {
            let mut statement = transaction.prepare("SELECT c.id,c.item_id,i.title,c.content,c.symbol_name,c.file_path FROM memory_chunks c JOIN memory_items i ON i.id=c.item_id WHERE c.project_id=?1 ORDER BY c.created_at,c.ordinal")?;
            let values = statement
                .query_map([project_id], |row| {
                    Ok(ReindexChunk {
                        chunk_id: row.get(0)?,
                        item_id: row.get(1)?,
                        title: row.get(2)?,
                        body: row.get(3)?,
                        symbol_name: row.get(4)?,
                        file_path: row.get(5)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            values
        };
        for chunk in &rows {
            transaction.execute(
                "INSERT INTO memory_chunks_fts(chunk_id,item_id,project_id,title,body,symbol_name,file_path) VALUES(?1,?2,?3,?4,?5,?6,?7)",
                params![chunk.chunk_id,chunk.item_id,project_id,chunk.title,chunk.body,chunk.symbol_name,chunk.file_path],
            )?;
        }
        transaction.commit()?;
        Ok(MemoryRebuildResult {
            project_id: project_id.into(),
            indexed_chunks: rows.len(),
        })
    }
}

fn insert_chunks(transaction: &Transaction<'_>, input: ChunkInsert<'_>) -> AppResult<()> {
    for (ordinal, chunk) in chunks(input.body).into_iter().enumerate() {
        let id = Uuid::new_v4().to_string();
        let hash = content_hash(&[&chunk]);
        transaction.execute(
            "INSERT INTO memory_chunks(id,revision_id,item_id,project_id,ordinal,kind,content,file_path,content_hash,created_at) VALUES(?1,?2,?3,?4,?5,'text',?6,?7,?8,?9)",
            params![id,input.revision_id,input.item_id,input.project_id,ordinal as i64,chunk,input.file_path,hash,input.created_at],
        )?;
        transaction.execute(
            "INSERT INTO memory_chunks_fts(chunk_id,item_id,project_id,title,body,file_path) VALUES(?1,?2,?3,?4,?5,?6)",
            params![id,input.item_id,input.project_id,input.title,chunk,input.file_path],
        )?;
    }
    Ok(())
}

fn load_sources(
    connection: &rusqlite::Connection,
    project_id: &str,
    item_id: &str,
) -> AppResult<Vec<MemorySourceView>> {
    let mut statement = connection.prepare(&format!(
        "SELECT {SOURCE_COLUMNS} FROM memory_sources s JOIN memory_revision_sources rs ON rs.source_id=s.id JOIN memory_revisions r ON r.id=rs.revision_id JOIN memory_items i ON i.id=r.item_id WHERE i.id=?1 AND i.project_id=?2 ORDER BY s.captured_at DESC"
    ))?;
    let sources = statement
        .query_map(params![item_id, project_id], map_source)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    Ok(sources)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Project;

    fn seed_project(database: &DatabaseService, id: &str, root: &std::path::Path) {
        let now = Utc::now().to_rfc3339();
        database
            .upsert_project(&Project {
                id: id.into(),
                name: id.into(),
                root_path: root.to_string_lossy().into_owned(),
                canonical_root_path: root.to_string_lossy().into_owned(),
                git_branch: None,
                detected_framework: None,
                package_manager: None,
                major_languages: vec![],
                is_git_repository: false,
                has_package_json: false,
                has_lockfile: false,
                created_at: now.clone(),
                updated_at: now.clone(),
                last_opened_at: now,
            })
            .unwrap();
    }

    #[test]
    fn notes_are_project_isolated_and_deduplicated() {
        let database = DatabaseService::in_memory().unwrap();
        let root = std::env::temp_dir();
        seed_project(&database, "p1", &root.join("memory-p1"));
        seed_project(&database, "p2", &root.join("memory-p2"));
        let first = database
            .memory_add_note("p1", None, "Decision", "Use one backend", None)
            .unwrap();
        let again = database
            .memory_add_note("p1", None, "Decision", "Use one backend", None)
            .unwrap();
        assert_eq!(first.item_id, again.item_id);
        assert!(again.deduplicated);
        assert_eq!(
            database.memory_search("p1", "backend", None).unwrap().total,
            1
        );
        assert_eq!(
            database.memory_search("p2", "backend", None).unwrap().total,
            0
        );
        assert_eq!(
            database
                .memory_get_item("p2", &first.item_id)
                .unwrap_err()
                .code,
            "memory_item_not_found"
        );
    }

    #[test]
    fn file_capture_stays_inside_project_and_rebuilds_fts() {
        let database = DatabaseService::in_memory().unwrap();
        let root = std::env::temp_dir().join(format!("forgemind-memory-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let file = root.join("ARCHITECTURE.md");
        fs::write(&file, "One Rust backend serves every window.").unwrap();
        seed_project(&database, "p1", &root);
        let capture = database
            .memory_capture_file("p1", None, &file.to_string_lossy())
            .unwrap();
        assert_eq!(
            database
                .memory_get_item("p1", &capture.item_id)
                .unwrap()
                .sources
                .len(),
            1
        );
        assert!(database.memory_rebuild_index("p1").unwrap().indexed_chunks > 0);
        assert!(database.memory_health("p1").unwrap().healthy);
        fs::remove_dir_all(root).ok();
    }
}

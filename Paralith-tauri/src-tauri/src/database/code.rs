//! Persistence for the code graph.
//!
//! Every row here is *derived*. Nothing canonical points at it, so the whole index can be dropped
//! and rebuilt from the working tree without losing knowledge — which is why replacement is a
//! delete-and-insert per file rather than a diff: a file's symbol set is small, the write is one
//! transaction, and a diffing path would need its own correctness argument for no measurable gain.
//!
//! Reference resolution happens on read, not on write. Resolving at write time would mean a file
//! indexed before its dependency has permanently unresolved references, and a later reindex of the
//! *dependency* would have to rewrite rows in the *dependent*. Resolving on read costs one indexed
//! lookup and is always current.

use super::DatabaseService;
use crate::errors::{AppError, AppResult};
use crate::models::code::*;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::{HashMap, HashSet, VecDeque};
use uuid::Uuid;

/// Largest number of rows any single code query returns. Past this the caller is asking for a
/// listing, not an answer, and a listing belongs in a paginated Base.
const MAX_ROWS: usize = 500;

/// Largest transitive dependent set an impact walk will expand to.
const MAX_IMPACT_NODES: usize = 300;

fn escape_like(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for character in value.chars() {
        if matches!(character, '%' | '_' | '\\') {
            out.push('\\');
        }
        out.push(character);
    }
    out
}

fn row_to_symbol(row: &rusqlite::Row<'_>) -> rusqlite::Result<CodeSymbol> {
    Ok(CodeSymbol {
        id: row.get(0)?,
        path: row.get(1)?,
        kind: SymbolKind::parse(&row.get::<_, String>(2)?),
        name: row.get(3)?,
        container: row.get(4)?,
        signature: row.get(5)?,
        doc: row.get(6)?,
        start_line: row.get::<_, i64>(7)?.max(1) as usize,
        end_line: row.get::<_, i64>(8)?.max(1) as usize,
        exported: row.get::<_, i64>(9)? != 0,
    })
}

const SYMBOL_SELECT: &str =
    "SELECT id,path,kind,name,container,signature,doc,start_line,end_line,exported FROM code_symbols";

fn row_to_reference(row: &rusqlite::Row<'_>) -> rusqlite::Result<CodeReference> {
    Ok(CodeReference {
        id: row.get(0)?,
        path: row.get(1)?,
        symbol_name: row.get(2)?,
        target_symbol_id: row.get(3)?,
        from_symbol_id: row.get(4)?,
        kind: ReferenceKind::parse(&row.get::<_, String>(5)?),
        line: row.get::<_, i64>(6)?.max(1) as usize,
    })
}

const REFERENCE_SELECT: &str =
    "SELECT id,path,symbol_name,target_symbol_id,from_symbol_id,kind,line FROM code_references";

impl DatabaseService {
    /// Current content hash per indexed path, which is what makes reindexing incremental.
    pub fn code_file_hashes(&self, project_id: &str) -> AppResult<HashMap<String, String>> {
        let connection = self.connection.lock();
        let mut statement = connection
            .prepare("SELECT path,content_hash FROM code_files WHERE project_id=?1")
            .map_err(AppError::database)?;
        let rows = statement
            .query_map([project_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(AppError::database)?;
        let mut out = HashMap::new();
        for row in rows {
            let (path, hash) = row.map_err(AppError::database)?;
            out.insert(path, hash);
        }
        Ok(out)
    }

    /// Replace one file's index entry and everything derived from it, in one transaction.
    ///
    /// `symbol_ids` are content-addressed, so this is idempotent: reindexing an unchanged file
    /// writes the same ids back and every stored reference keeps resolving.
    pub fn replace_code_file(
        &self,
        project_id: &str,
        path: &str,
        content_hash: &str,
        size_bytes: u64,
        parsed: &ParsedFile,
        resolver: &dyn Fn(&str) -> Option<String>,
    ) -> AppResult<(usize, usize, usize)> {
        let mut connection = self.connection.lock();
        let transaction = connection.transaction().map_err(AppError::database)?;
        let now = Utc::now().to_rfc3339();

        // Cascades clear symbols, imports, and references for the old revision of this file.
        transaction
            .execute(
                "DELETE FROM code_files WHERE project_id=?1 AND path=?2",
                params![project_id, path],
            )
            .map_err(AppError::database)?;

        let file_id = Uuid::new_v4().to_string();
        transaction
            .execute(
                "INSERT INTO code_files(id,project_id,path,language,module,content_hash,size_bytes,line_count,parser,indexed_at) \
                 VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'deterministic',?9)",
                params![
                    file_id,
                    project_id,
                    path,
                    parsed.language,
                    parsed.module,
                    content_hash,
                    size_bytes as i64,
                    parsed.line_count as i64,
                    now
                ],
            )
            .map_err(AppError::database)?;

        // Symbol ids are needed to resolve the enclosing symbol of a reference, so build the map
        // as the symbols are written rather than re-querying afterwards.
        let mut by_name: HashMap<String, String> = HashMap::new();
        for symbol in &parsed.symbols {
            let id = SymbolIdentity::compute(
                project_id,
                path,
                symbol.kind,
                symbol.container.as_deref(),
                &symbol.name,
            );
            transaction
                .execute(
                    "INSERT OR REPLACE INTO code_symbols(id,project_id,file_id,path,kind,name,container,signature,doc,start_line,end_line,exported) \
                     VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
                    params![
                        id,
                        project_id,
                        file_id,
                        path,
                        symbol.kind.as_str(),
                        symbol.name,
                        symbol.container,
                        symbol.signature,
                        symbol.doc,
                        symbol.start_line as i64,
                        symbol.end_line as i64,
                        i64::from(symbol.exported)
                    ],
                )
                .map_err(AppError::database)?;
            by_name.entry(symbol.name.clone()).or_insert(id);
        }

        for import in &parsed.imports {
            let resolved = resolver(&import.specifier);
            transaction
                .execute(
                    "INSERT INTO code_imports(id,project_id,file_id,path,specifier,resolved_path,external,symbols,line) \
                     VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                    params![
                        Uuid::new_v4().to_string(),
                        project_id,
                        file_id,
                        path,
                        import.specifier,
                        resolved,
                        i64::from(resolved_is_external(&import.specifier)),
                        import.symbols.join(","),
                        import.line as i64
                    ],
                )
                .map_err(AppError::database)?;
        }

        for reference in &parsed.references {
            let from_symbol_id = reference
                .from_symbol
                .as_ref()
                .and_then(|name| by_name.get(name))
                .cloned();
            transaction
                .execute(
                    "INSERT INTO code_references(id,project_id,file_id,path,symbol_name,target_symbol_id,from_symbol_id,kind,line) \
                     VALUES(?1,?2,?3,?4,?5,NULL,?6,?7,?8)",
                    params![
                        Uuid::new_v4().to_string(),
                        project_id,
                        file_id,
                        path,
                        reference.symbol_name,
                        from_symbol_id,
                        reference.kind.as_str(),
                        reference.line as i64
                    ],
                )
                .map_err(AppError::database)?;
        }

        transaction.commit().map_err(AppError::database)?;
        Ok((
            parsed.symbols.len(),
            parsed.references.len(),
            parsed.imports.len(),
        ))
    }

    pub fn remove_code_file(&self, project_id: &str, path: &str) -> AppResult<bool> {
        let connection = self.connection.lock();
        let removed = connection
            .execute(
                "DELETE FROM code_files WHERE project_id=?1 AND path=?2",
                params![project_id, path],
            )
            .map_err(AppError::database)?;
        Ok(removed > 0)
    }

    /// Drop index rows for paths that no longer exist in the working tree.
    pub fn prune_code_files(&self, project_id: &str, keep: &HashSet<String>) -> AppResult<usize> {
        let connection = self.connection.lock();
        let mut statement = connection
            .prepare("SELECT path FROM code_files WHERE project_id=?1")
            .map_err(AppError::database)?;
        let stored: Vec<String> = statement
            .query_map([project_id], |row| row.get::<_, String>(0))
            .map_err(AppError::database)?
            .collect::<Result<_, _>>()
            .map_err(AppError::database)?;
        drop(statement);
        let mut removed = 0usize;
        for path in stored {
            if !keep.contains(&path) {
                connection
                    .execute(
                        "DELETE FROM code_files WHERE project_id=?1 AND path=?2",
                        params![project_id, path],
                    )
                    .map_err(AppError::database)?;
                removed += 1;
            }
        }
        Ok(removed)
    }

    pub fn save_code_index_state(&self, state: &CodeIndexState) -> AppResult<()> {
        let connection = self.connection.lock();
        connection
            .execute(
                "INSERT INTO code_index_state(project_id,files_indexed,symbols_indexed,references_indexed,revision,truncated,indexed_at) \
                 VALUES(?1,?2,?3,?4,?5,?6,?7) \
                 ON CONFLICT(project_id) DO UPDATE SET files_indexed=excluded.files_indexed, \
                   symbols_indexed=excluded.symbols_indexed, references_indexed=excluded.references_indexed, \
                   revision=code_index_state.revision+1, truncated=excluded.truncated, indexed_at=excluded.indexed_at",
                params![
                    state.project_id,
                    state.files_indexed as i64,
                    state.symbols_indexed as i64,
                    state.references_indexed as i64,
                    state.revision,
                    i64::from(state.truncated),
                    state.indexed_at
                ],
            )
            .map_err(AppError::database)?;
        Ok(())
    }

    pub fn code_index_state(&self, project_id: &str) -> AppResult<CodeIndexState> {
        let connection = self.connection.lock();
        let state = connection
            .query_row(
                "SELECT files_indexed,symbols_indexed,references_indexed,revision,truncated,indexed_at \
                 FROM code_index_state WHERE project_id=?1",
                [project_id],
                |row| {
                    Ok(CodeIndexState {
                        project_id: project_id.to_owned(),
                        files_indexed: row.get::<_, i64>(0)?.max(0) as usize,
                        symbols_indexed: row.get::<_, i64>(1)?.max(0) as usize,
                        references_indexed: row.get::<_, i64>(2)?.max(0) as usize,
                        revision: row.get(3)?,
                        truncated: row.get::<_, i64>(4)? != 0,
                        indexed_at: row.get(5)?,
                    })
                },
            )
            .optional()
            .map_err(AppError::database)?;
        Ok(state.unwrap_or(CodeIndexState {
            project_id: project_id.to_owned(),
            ..Default::default()
        }))
    }

    /// Symbols matching a name, or — when `name` is empty — the file's symbols.
    pub fn code_symbols(
        &self,
        project_id: &str,
        name: Option<&str>,
        path: Option<&str>,
        kind: Option<&str>,
        limit: usize,
    ) -> AppResult<Vec<CodeSymbol>> {
        let connection = self.connection.lock();
        let limit = limit.clamp(1, MAX_ROWS) as i64;
        let mut sql = format!("{SYMBOL_SELECT} WHERE project_id=?1");
        let mut binds: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(project_id.to_owned())];
        if let Some(name) = name.filter(|value| !value.is_empty()) {
            binds.push(Box::new(format!("%{}%", escape_like(name))));
            sql.push_str(&format!(" AND name LIKE ?{} ESCAPE '\\'", binds.len()));
        }
        if let Some(path) = path.filter(|value| !value.is_empty()) {
            binds.push(Box::new(path.to_owned()));
            sql.push_str(&format!(" AND path=?{}", binds.len()));
        }
        if let Some(kind) = kind.filter(|value| !value.is_empty()) {
            binds.push(Box::new(kind.to_owned()));
            sql.push_str(&format!(" AND kind=?{}", binds.len()));
        }
        binds.push(Box::new(limit));
        sql.push_str(&format!(
            " ORDER BY exported DESC, length(name), name LIMIT ?{}",
            binds.len()
        ));
        let mut statement = connection.prepare(&sql).map_err(AppError::database)?;
        let rows = statement
            .query_map(
                rusqlite::params_from_iter(binds.iter().map(|bind| bind.as_ref())),
                row_to_symbol,
            )
            .map_err(AppError::database)?;
        rows.collect::<Result<_, _>>().map_err(AppError::database)
    }

    pub fn code_symbol(&self, project_id: &str, symbol_id: &str) -> AppResult<CodeSymbol> {
        let connection = self.connection.lock();
        connection
            .query_row(
                &format!("{SYMBOL_SELECT} WHERE project_id=?1 AND id=?2"),
                params![project_id, symbol_id],
                row_to_symbol,
            )
            .optional()
            .map_err(AppError::database)?
            .ok_or_else(|| {
                AppError::new(
                    "code_symbol_not_found",
                    "That symbol is not indexed.",
                    false,
                )
                .entity(symbol_id)
                .layer("code")
            })
    }

    /// References naming a symbol, resolved by name against the symbol's own name.
    ///
    /// Name-based resolution is honest about what a deterministic index can know: two functions
    /// called `run` in different modules both match, and the caller sees both rather than one that
    /// was silently guessed.
    pub fn code_references_to(
        &self,
        project_id: &str,
        symbol_name: &str,
        limit: usize,
    ) -> AppResult<Vec<CodeReference>> {
        let connection = self.connection.lock();
        let mut statement = connection
            .prepare(&format!(
                "{REFERENCE_SELECT} WHERE project_id=?1 AND symbol_name=?2 ORDER BY path, line LIMIT ?3"
            ))
            .map_err(AppError::database)?;
        let rows = statement
            .query_map(
                params![project_id, symbol_name, limit.clamp(1, MAX_ROWS) as i64],
                row_to_reference,
            )
            .map_err(AppError::database)?;
        rows.collect::<Result<_, _>>().map_err(AppError::database)
    }

    /// Symbols this symbol calls: references made *inside* its body, resolved to declarations.
    pub fn code_callees(
        &self,
        project_id: &str,
        symbol_id: &str,
        limit: usize,
    ) -> AppResult<Vec<CodeSymbol>> {
        let connection = self.connection.lock();
        let mut statement = connection
            .prepare(&format!(
                "{SYMBOL_SELECT} WHERE project_id=?1 AND name IN ( \
                   SELECT DISTINCT symbol_name FROM code_references \
                   WHERE project_id=?1 AND from_symbol_id=?2 AND kind='call') \
                 ORDER BY name LIMIT ?3"
            ))
            .map_err(AppError::database)?;
        let rows = statement
            .query_map(
                params![project_id, symbol_id, limit.clamp(1, MAX_ROWS) as i64],
                row_to_symbol,
            )
            .map_err(AppError::database)?;
        rows.collect::<Result<_, _>>().map_err(AppError::database)
    }

    /// Call sites naming this symbol, which is the caller set.
    pub fn code_callers(
        &self,
        project_id: &str,
        symbol_name: &str,
        limit: usize,
    ) -> AppResult<Vec<CodeReference>> {
        let connection = self.connection.lock();
        let mut statement = connection
            .prepare(&format!(
                "{REFERENCE_SELECT} WHERE project_id=?1 AND symbol_name=?2 AND kind IN ('call','renders') \
                 ORDER BY path, line LIMIT ?3"
            ))
            .map_err(AppError::database)?;
        let rows = statement
            .query_map(
                params![project_id, symbol_name, limit.clamp(1, MAX_ROWS) as i64],
                row_to_reference,
            )
            .map_err(AppError::database)?;
        rows.collect::<Result<_, _>>().map_err(AppError::database)
    }

    pub fn code_file_dependencies(
        &self,
        project_id: &str,
        path: &str,
    ) -> AppResult<FileDependencies> {
        let connection = self.connection.lock();
        let mut statement = connection
            .prepare(
                "SELECT id,path,specifier,resolved_path,external,symbols,line FROM code_imports \
                 WHERE project_id=?1 AND path=?2 ORDER BY line LIMIT 500",
            )
            .map_err(AppError::database)?;
        let imports: Vec<CodeImport> = statement
            .query_map(params![project_id, path], |row| {
                Ok(CodeImport {
                    id: row.get(0)?,
                    path: row.get(1)?,
                    specifier: row.get(2)?,
                    resolved_path: row.get(3)?,
                    external: row.get::<_, i64>(4)? != 0,
                    symbols: row
                        .get::<_, String>(5)?
                        .split(',')
                        .filter(|part| !part.is_empty())
                        .map(str::to_owned)
                        .collect(),
                    line: row.get::<_, i64>(6)?.max(1) as usize,
                })
            })
            .map_err(AppError::database)?
            .collect::<Result<_, _>>()
            .map_err(AppError::database)?;
        drop(statement);

        let dependents = direct_dependents(&connection, project_id, path)?;
        let external = imports
            .iter()
            .filter(|import| import.external)
            .map(|import| import.specifier.clone())
            .collect();
        Ok(FileDependencies {
            path: path.to_owned(),
            imports,
            dependents,
            external,
        })
    }

    /// What a change to `path` reaches, walking the import graph backwards.
    pub fn code_impact(&self, project_id: &str, path: &str, depth: usize) -> AppResult<CodeImpact> {
        let connection = self.connection.lock();
        let depth = depth.clamp(1, 5);
        let direct = direct_dependents(&connection, project_id, path)?;
        let mut seen: HashSet<String> = HashSet::from([path.to_owned()]);
        let mut transitive: Vec<String> = Vec::new();
        let mut queue: VecDeque<(String, usize)> =
            direct.iter().map(|item| (item.clone(), 1usize)).collect();
        for item in &direct {
            seen.insert(item.clone());
        }
        let mut truncated = false;
        while let Some((current, level)) = queue.pop_front() {
            if seen.len() >= MAX_IMPACT_NODES {
                truncated = true;
                break;
            }
            if level >= depth {
                continue;
            }
            for next in direct_dependents(&connection, project_id, &current)? {
                if seen.insert(next.clone()) {
                    transitive.push(next.clone());
                    queue.push_back((next, level + 1));
                }
            }
        }

        let mut statement = connection
            .prepare(&format!(
                "{SYMBOL_SELECT} WHERE project_id=?1 AND path=?2 ORDER BY start_line LIMIT 200"
            ))
            .map_err(AppError::database)?;
        let affected_symbols: Vec<CodeSymbol> = statement
            .query_map(params![project_id, path], row_to_symbol)
            .map_err(AppError::database)?
            .collect::<Result<_, _>>()
            .map_err(AppError::database)?;

        Ok(CodeImpact {
            root: path.to_owned(),
            direct_dependents: direct,
            transitive_dependents: transitive,
            affected_symbols,
            truncated,
        })
    }

    /// Memory ids whose provenance cites a symbol's file and overlaps its line range.
    ///
    /// A source with no line range cites the whole file and therefore overlaps every symbol in it;
    /// that is the conservative reading, and the alternative — requiring an explicit range — would
    /// silently drop the most common kind of file evidence.
    pub fn memories_for_symbol(
        &self,
        project_id: &str,
        path: &str,
        start_line: usize,
        end_line: usize,
    ) -> AppResult<Vec<String>> {
        let connection = self.connection.lock();
        let mut statement = connection
            .prepare(
                "SELECT DISTINCT i.id FROM memory_items i \
                 JOIN memory_revision_sources rs ON rs.revision_id=i.current_revision_id \
                 JOIN memory_sources s ON s.id=rs.source_id \
                 WHERE i.project_id=?1 AND i.state<>'archived' AND s.file_path=?2 \
                   AND (s.line_start IS NULL OR s.line_end IS NULL \
                        OR (s.line_start<=?4 AND s.line_end>=?3)) \
                 LIMIT 50",
            )
            .map_err(AppError::database)?;
        let rows = statement
            .query_map(
                params![project_id, path, start_line as i64, end_line as i64],
                |row| row.get::<_, String>(0),
            )
            .map_err(AppError::database)?;
        rows.collect::<Result<_, _>>().map_err(AppError::database)
    }

    /// Indexed file paths, for Bases and the MCP `code` domain.
    pub fn code_files(
        &self,
        project_id: &str,
        language: Option<&str>,
        limit: usize,
    ) -> AppResult<Vec<CodeFileRecord>> {
        let connection = self.connection.lock();
        let mut statement = connection
            .prepare(
                "SELECT id,path,language,module,content_hash,size_bytes,line_count,parser,indexed_at \
                 FROM code_files WHERE project_id=?1 AND (?2 IS NULL OR language=?2) \
                 ORDER BY path LIMIT ?3",
            )
            .map_err(AppError::database)?;
        let rows = statement
            .query_map(
                params![project_id, language, limit.clamp(1, MAX_ROWS) as i64],
                |row| {
                    Ok(CodeFileRecord {
                        id: row.get(0)?,
                        path: row.get(1)?,
                        language: row.get(2)?,
                        module: row.get(3)?,
                        content_hash: row.get(4)?,
                        size_bytes: row.get::<_, i64>(5)?.max(0) as u64,
                        line_count: row.get::<_, i64>(6)?.max(0) as usize,
                        parser: row.get(7)?,
                        indexed_at: row.get(8)?,
                    })
                },
            )
            .map_err(AppError::database)?;
        rows.collect::<Result<_, _>>().map_err(AppError::database)
    }
}

/// A specifier that is neither relative nor absolute-in-project is an external package.
fn resolved_is_external(specifier: &str) -> bool {
    !(specifier.starts_with("./")
        || specifier.starts_with("../")
        || specifier.starts_with("crate::")
        || specifier.starts_with("self::")
        || specifier.starts_with("super::"))
}

/// Files that import `path`, matched on the resolved path with or without its extension.
fn direct_dependents(
    connection: &Connection,
    project_id: &str,
    path: &str,
) -> AppResult<Vec<String>> {
    let stem = path.rsplit_once('.').map(|(head, _)| head).unwrap_or(path);
    let mut statement = connection
        .prepare(
            "SELECT DISTINCT path FROM code_imports \
             WHERE project_id=?1 AND resolved_path IN (?2,?3) AND path<>?2 \
             ORDER BY path LIMIT 200",
        )
        .map_err(AppError::database)?;
    let rows = statement
        .query_map(params![project_id, path, stem], |row| {
            row.get::<_, String>(0)
        })
        .map_err(AppError::database)?;
    rows.collect::<Result<_, _>>().map_err(AppError::database)
}

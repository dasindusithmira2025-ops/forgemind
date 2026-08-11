//! Canonical Database Graph assembly.
//!
//! This module is the seam between three things that must never be confused: static repository
//! *discovery* (which logical databases exist and who owns them), adapter *extraction* (what a
//! schema file declares), and design *materialization* (what a human or agent is proposing).
//!
//! Everything here is pure with respect to the outside world — it reads repository files through the
//! adapters' project-scoped guard and returns typed values. Nothing in this module opens a database
//! connection, executes repository code, or writes to the repository.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use chrono::Utc;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::errors::{AppError, AppResult};
use crate::models::{
    DatabaseAdapterCapabilities, DatabaseAdapterId, DatabaseColumn, DatabaseDesignOperationKind,
    DatabaseEdge, DatabaseEdgeType, DatabaseEvidenceKind, DatabaseIssue, DatabaseIssueStatus,
    DatabaseLayer, DatabaseObject, DatabaseObjectMeta, DatabaseObjectProvenance, DatabaseSnapshot,
    DatabaseSnapshotStatus, DatabaseSource, DatabaseSourceEvidence, DatabaseTable,
    EvidenceCertainty, ExtractedDatabaseGraph, SemanticId, SemanticIdentity,
};

use super::adapters::{
    registered_v1_adapters, DatabaseAdapter, DetectionContext, ExtractionContext, ValidationContext,
};
use super::discovery::{self, DiscoveredLogicalDatabase};

/// Bumped whenever extraction semantics change in a way that invalidates stored snapshots.
pub const EXTRACTOR_VERSION: &str = "dbstudio-static/1";

const MAX_SCANNED_FILES: usize = 20_000;
const SKIPPED_DIRECTORIES: [&str; 6] = [".git", "node_modules", "target", "dist", ".next", "build"];

/// One logical datasource plus the evidence that proves it exists.
#[derive(Debug, Clone)]
pub struct DiscoveredSource {
    pub source: DatabaseSource,
    pub evidence: Vec<DatabaseSourceEvidence>,
}

/// Static discovery for one Paralith project. Never executes repository code and never connects to
/// a database: every returned fact traces to a file the repository already contains.
pub fn discover_project(
    repository_id: &str,
    project_root: &Path,
) -> AppResult<Vec<DiscoveredSource>> {
    let report = discovery::discover_repository(project_root)?;
    if report.opened_connection {
        return Err(AppError::new(
            "database_discovery_contract_violation",
            "Static Database Studio discovery attempted to open a database connection.",
            false,
        )
        .layer("database_studio"));
    }

    let now = Utc::now().to_rfc3339();
    let all_files = scan_repository(project_root)?;
    let adapters = registered_v1_adapters();
    let mut discovered_sources = Vec::with_capacity(report.sources.len());

    for logical in &report.sources {
        let source = discovery::to_database_source(repository_id, logical, &now);
        let owner_scope = owner_scope(&logical.owner_project);
        let mut candidates: Vec<PathBuf> = logical
            .evidence_paths
            .iter()
            .map(|relative| project_root.join(relative))
            .collect();
        candidates.extend(companion_paths(
            &all_files,
            project_root,
            logical,
            &owner_scope,
        ));
        candidates.sort();
        candidates.dedup();

        let mut evidence = Vec::new();
        for adapter in &adapters {
            if !logical.adapter_ids.contains(&adapter.id()) {
                continue;
            }
            evidence.extend(adapter.detect(&DetectionContext {
                repository_id,
                project_id: &logical.owner_project,
                project_root,
                changed_paths: &candidates,
                extractor_version: EXTRACTOR_VERSION,
            })?);
        }
        evidence.sort_by(|left, right| {
            left.relative_path
                .cmp(&right.relative_path)
                .then(left.id.cmp(&right.id))
        });
        evidence.dedup_by(|left, right| left.id == right.id);
        evidence.extend(consumer_evidence(repository_id, logical, &now));

        discovered_sources.push(DiscoveredSource { source, evidence });
    }

    Ok(discovered_sources)
}

/// Extract the declared graph a repository's schema files describe, plus the deterministic issues
/// the adapters found while doing it.
pub fn extract_declared_graph(
    repository_id: &str,
    project_root: &Path,
    source: &DatabaseSource,
    evidence: &[DatabaseSourceEvidence],
    git_revision: Option<&str>,
) -> AppResult<(ExtractedDatabaseGraph, Vec<DatabaseIssue>)> {
    let mut graph = ExtractedDatabaseGraph {
        objects: Vec::new(),
        edges: Vec::new(),
        provenance: Vec::new(),
    };
    let mut issues = Vec::new();
    let mut seen_objects = HashSet::new();
    let mut seen_edges = HashSet::new();

    for adapter in registered_v1_adapters() {
        if !source.adapter_ids.contains(&adapter.id()) {
            continue;
        }
        let extracted = adapter.extract_declared_schema(&ExtractionContext {
            repository_id,
            project_id: source.owner_project_id.as_deref().unwrap_or("."),
            project_root,
            source,
            evidence,
            git_revision,
        })?;
        issues.extend(adapter.validate(&ValidationContext { source }, &extracted)?);
        for object in extracted.objects {
            if seen_objects.insert(object.meta().identity.id.clone()) {
                graph.objects.push(object);
            }
        }
        for edge in extracted.edges {
            if seen_edges.insert(edge.id.clone()) {
                graph.edges.push(edge);
            }
        }
        graph.provenance.extend(extracted.provenance);
    }

    graph
        .objects
        .sort_by(|left, right| left.meta().identity.id.cmp(&right.meta().identity.id));
    graph.edges.sort_by(|left, right| left.id.cmp(&right.id));
    graph
        .provenance
        .sort_by(|left, right| left.id.cmp(&right.id));
    graph.provenance.dedup_by(|left, right| left.id == right.id);

    // Edges whose endpoints did not survive extraction would render as dangling relationships on the
    // canvas, so they are dropped here and reported by the health rules instead.
    let object_ids: HashSet<&str> = graph
        .objects
        .iter()
        .map(|object| object.meta().identity.id.as_str())
        .collect();
    let retained: Vec<DatabaseEdge> = graph
        .edges
        .iter()
        .filter(|edge| {
            object_ids.contains(edge.source_object_id.as_str())
                && object_ids.contains(edge.target_object_id.as_str())
        })
        .cloned()
        .collect();
    graph.edges = retained;

    Ok((graph, issues))
}

/// Content-addressed identity for a graph. Two extractions that differ only in file formatting,
/// declaration order, or timestamps produce the same fingerprint.
pub fn graph_fingerprint(graph: &ExtractedDatabaseGraph) -> String {
    let mut parts: Vec<String> = graph
        .objects
        .iter()
        .map(|object| {
            format!(
                "{}|{}|{}|{}",
                object.kind_name(),
                object.meta().identity.logical_key,
                object.meta().identity.qualified_name,
                object.meta().content_fingerprint
            )
        })
        .collect();
    parts.extend(graph.edges.iter().map(|edge| {
        format!(
            "edge|{}|{}|{:?}",
            edge.source_object_id, edge.target_object_id, edge.edge_type
        )
    }));
    parts.sort();
    let mut hasher = Sha256::new();
    hasher.update(parts.join("\n").as_bytes());
    format!("sha256:{:x}", hasher.finalize())
}

pub fn build_snapshot(
    source_id: &str,
    layer: DatabaseLayer,
    adapter_id: DatabaseAdapterId,
    graph: &ExtractedDatabaseGraph,
    git_revision: Option<String>,
    parent_snapshot_id: Option<String>,
) -> DatabaseSnapshot {
    let now = Utc::now().to_rfc3339();
    let fingerprint = graph_fingerprint(graph);
    DatabaseSnapshot {
        id: format!("dbsnap_{}", Uuid::new_v4().simple()),
        source_id: source_id.to_owned(),
        layer,
        adapter_id,
        git_revision,
        parent_snapshot_id,
        fingerprint,
        object_count: graph.objects.len() as u32,
        edge_count: graph.edges.len() as u32,
        extractor_version: EXTRACTOR_VERSION.to_owned(),
        created_at: now.clone(),
        completed_at: Some(now),
        status: DatabaseSnapshotStatus::Ready,
    }
}

/// Rebase a declared/observed graph into the Proposed layer for a new design.
///
/// Proposed objects get synthetic identities so a later rename never changes what the canvas, a
/// layout, or an issue is pointing at. The declared identity is preserved in `previous_ids`, which
/// is what lets the semantic diff line a proposal back up with the schema it came from.
pub fn seed_proposed_graph(
    base: &ExtractedDatabaseGraph,
    source_id: &str,
) -> ExtractedDatabaseGraph {
    let mut id_map: HashMap<String, String> = HashMap::new();
    for object in &base.objects {
        id_map.insert(
            object.meta().identity.id.clone(),
            proposed_id(object.kind_name()),
        );
    }

    let mut objects = Vec::with_capacity(base.objects.len());
    for object in &base.objects {
        let mut proposed = object.clone();
        remap_object(&mut proposed, &id_map, source_id);
        objects.push(proposed);
    }

    let edges = base
        .edges
        .iter()
        .filter_map(|edge| {
            let source = id_map.get(&edge.source_object_id)?;
            let target = id_map.get(&edge.target_object_id)?;
            Some(DatabaseEdge {
                id: edge_id(source, target, &edge.edge_type),
                source_object_id: source.clone(),
                target_object_id: target.clone(),
                edge_type: edge.edge_type.clone(),
                snapshot_id: None,
                design_revision_id: None,
                confidence: edge.confidence,
                provenance_ids: Vec::new(),
                created_at: edge.created_at.clone(),
            })
        })
        .collect();

    ExtractedDatabaseGraph {
        objects,
        edges,
        provenance: Vec::new(),
    }
}

/// Stamp every row in a proposed graph with the revision it belongs to. Called immediately before
/// persistence so the `(snapshot_id, design_revision_id)` invariant always holds.
pub fn stamp_revision(graph: &mut ExtractedDatabaseGraph, revision_id: &str) {
    for object in &mut graph.objects {
        let meta = object_meta_mut(object);
        meta.layer = DatabaseLayer::Proposed;
        meta.snapshot_id = None;
        meta.design_revision_id = Some(revision_id.to_owned());
    }
    for edge in &mut graph.edges {
        edge.snapshot_id = None;
        edge.design_revision_id = Some(revision_id.to_owned());
    }
    for provenance in &mut graph.provenance {
        provenance.evidence_ref = Some(revision_id.to_owned());
    }
}

/// Apply one structured design operation to a proposed graph.
///
/// Every operation is total: it either produces a coherent graph or returns a typed error. Nothing
/// here writes to the repository or a database — this is the DESIGN_ONLY surface.
pub fn apply_design_operation(
    graph: &mut ExtractedDatabaseGraph,
    operation: &DatabaseDesignOperationKind,
    source_id: &str,
) -> AppResult<Vec<SemanticId>> {
    let now = Utc::now().to_rfc3339();
    match operation {
        DatabaseDesignOperationKind::AddNamespace { namespace } => {
            let mut namespace = namespace.clone();
            reset_meta(&mut namespace.meta, source_id, &now);
            let id = namespace.meta.identity.id.clone();
            require_absent(graph, &id)?;
            graph.objects.push(DatabaseObject::Namespace(namespace));
            Ok(vec![id])
        }
        DatabaseDesignOperationKind::AddTable { table } => {
            let mut table = table.clone();
            reset_meta(&mut table.meta, source_id, &now);
            let id = table.meta.identity.id.clone();
            require_absent(graph, &id)?;
            if graph.objects.iter().any(|object| {
                matches!(object, DatabaseObject::Table(_))
                    && object.meta().identity.qualified_name == table.meta.identity.qualified_name
            }) {
                return Err(design_conflict(format!(
                    "A table named '{}' already exists in this design.",
                    table.meta.identity.qualified_name
                )));
            }
            let namespace_id = table.namespace_id.clone();
            graph.objects.push(DatabaseObject::Table(table));
            if !namespace_id.is_empty() {
                push_edge(graph, &namespace_id, &id, DatabaseEdgeType::Contains, &now);
            }
            Ok(vec![id])
        }
        DatabaseDesignOperationKind::RenameTable { table_id, new_name } => {
            let namespace = {
                let table = require_table(graph, table_id)?;
                table
                    .meta
                    .identity
                    .qualified_name
                    .rsplit_once('.')
                    .map(|(namespace, _)| namespace.to_owned())
                    .unwrap_or_else(|| "public".to_owned())
            };
            let qualified = format!("{namespace}.{new_name}");
            if graph.objects.iter().any(|object| {
                object.meta().identity.id != *table_id
                    && matches!(object, DatabaseObject::Table(_))
                    && object.meta().identity.qualified_name == qualified
            }) {
                return Err(design_conflict(format!(
                    "A table named '{qualified}' already exists in this design."
                )));
            }
            let table = require_table_mut(graph, table_id)?;
            table.name.clone_from(new_name);
            // The synthetic identity is deliberately preserved: a rename must not orphan selection,
            // layout positions, issues, or an agent's earlier reference to this table.
            table.meta.identity.qualified_name = qualified;
            table.meta.updated_at.clone_from(&now);
            table.meta.content_fingerprint = fingerprint_of(&table.meta.identity.qualified_name);
            Ok(vec![table_id.clone()])
        }
        DatabaseDesignOperationKind::DropTable { table_id } => {
            require_table(graph, table_id)?;
            let removed = remove_subtree(graph, table_id);
            Ok(removed)
        }
        DatabaseDesignOperationKind::AddColumn { table_id, column } => {
            require_table(graph, table_id)?;
            let mut column = column.clone();
            reset_meta(&mut column.meta, source_id, &now);
            column.table_id.clone_from(table_id);
            let id = column.meta.identity.id.clone();
            require_absent(graph, &id)?;
            if columns_of(graph, table_id)
                .iter()
                .any(|existing| existing.name == column.name)
            {
                return Err(design_conflict(format!(
                    "Column '{}' already exists on this table.",
                    column.name
                )));
            }
            column.ordinal = columns_of(graph, table_id).len() as u32;
            graph.objects.push(DatabaseObject::Column(column));
            push_edge(graph, table_id, &id, DatabaseEdgeType::HasColumn, &now);
            let table = require_table_mut(graph, table_id)?;
            table.column_ids.push(id.clone());
            Ok(vec![table_id.clone(), id])
        }
        DatabaseDesignOperationKind::AlterColumn { column_id, patch } => {
            let column = require_column_mut(graph, column_id)?;
            if let Some(name) = &patch.name {
                column.name.clone_from(name);
                if let Some((prefix, _)) = column.meta.identity.qualified_name.rsplit_once('.') {
                    column.meta.identity.qualified_name = format!("{prefix}.{name}");
                }
            }
            if let Some(data_type) = &patch.data_type {
                column.data_type = data_type.clone();
            }
            if let Some(native_type) = &patch.native_type {
                column.native_type.clone_from(native_type);
            }
            if let Some(nullable) = patch.nullable {
                column.nullable = nullable;
            }
            if let Some(default) = &patch.default {
                column.default = default.clone();
            }
            column.meta.updated_at.clone_from(&now);
            column.meta.content_fingerprint = fingerprint_of(&format!(
                "{}|{}|{}|{:?}",
                column.name, column.native_type, column.nullable, column.default
            ));
            let table_id = column.table_id.clone();
            Ok(vec![table_id, column_id.clone()])
        }
        DatabaseDesignOperationKind::DropColumn { column_id } => {
            let table_id = require_column(graph, column_id)?.table_id.clone();
            let removed = remove_subtree(graph, column_id);
            if let Ok(table) = require_table_mut(graph, &table_id) {
                table.column_ids.retain(|id| id != column_id);
            }
            Ok(removed)
        }
        DatabaseDesignOperationKind::AddPrimaryKey { key } => {
            let mut key = key.clone();
            reset_meta(&mut key.meta, source_id, &now);
            require_table(graph, &key.table_id)?;
            let id = key.meta.identity.id.clone();
            require_absent(graph, &id)?;
            let table_id = key.table_id.clone();
            let column_ids = key.column_ids.clone();
            // A table has at most one primary key; replacing it is a legitimate design action.
            let existing = require_table(graph, &table_id)?.primary_key_id.clone();
            if let Some(existing) = existing {
                remove_subtree(graph, &existing);
            }
            graph.objects.push(DatabaseObject::PrimaryKey(key));
            for column_id in &column_ids {
                push_edge(graph, &id, column_id, DatabaseEdgeType::PrimaryKey, &now);
            }
            require_table_mut(graph, &table_id)?.primary_key_id = Some(id.clone());
            Ok(vec![table_id, id])
        }
        DatabaseDesignOperationKind::AddForeignKey { key } => {
            let mut key = key.clone();
            reset_meta(&mut key.meta, source_id, &now);
            require_table(graph, &key.table_id)?;
            require_table(graph, &key.referenced_table_id)?;
            let id = key.meta.identity.id.clone();
            require_absent(graph, &id)?;
            let table_id = key.table_id.clone();
            let referenced_table_id = key.referenced_table_id.clone();
            graph.objects.push(DatabaseObject::ForeignKey(key));
            push_edge(
                graph,
                &table_id,
                &referenced_table_id,
                DatabaseEdgeType::References,
                &now,
            );
            require_table_mut(graph, &table_id)?
                .foreign_key_ids
                .push(id.clone());
            Ok(vec![table_id, referenced_table_id, id])
        }
        DatabaseDesignOperationKind::AddUniqueConstraint { constraint } => {
            let mut constraint = constraint.clone();
            reset_meta(&mut constraint.meta, source_id, &now);
            require_table(graph, &constraint.table_id)?;
            let id = constraint.meta.identity.id.clone();
            require_absent(graph, &id)?;
            let table_id = constraint.table_id.clone();
            graph
                .objects
                .push(DatabaseObject::UniqueConstraint(constraint));
            require_table_mut(graph, &table_id)?
                .unique_constraint_ids
                .push(id.clone());
            Ok(vec![table_id, id])
        }
        DatabaseDesignOperationKind::AddCheckConstraint { constraint } => {
            let mut constraint = constraint.clone();
            reset_meta(&mut constraint.meta, source_id, &now);
            require_table(graph, &constraint.table_id)?;
            let id = constraint.meta.identity.id.clone();
            require_absent(graph, &id)?;
            let table_id = constraint.table_id.clone();
            graph
                .objects
                .push(DatabaseObject::CheckConstraint(constraint));
            require_table_mut(graph, &table_id)?
                .check_constraint_ids
                .push(id.clone());
            Ok(vec![table_id, id])
        }
        DatabaseDesignOperationKind::AddIndex { index } => {
            let mut index = index.clone();
            reset_meta(&mut index.meta, source_id, &now);
            require_table(graph, &index.table_id)?;
            let id = index.meta.identity.id.clone();
            require_absent(graph, &id)?;
            let table_id = index.table_id.clone();
            let key_columns: Vec<SemanticId> = index
                .keys
                .iter()
                .filter_map(|key| key.column_id.clone())
                .collect();
            graph.objects.push(DatabaseObject::Index(index));
            for column_id in &key_columns {
                push_edge(graph, &id, column_id, DatabaseEdgeType::Indexes, &now);
            }
            require_table_mut(graph, &table_id)?
                .index_ids
                .push(id.clone());
            Ok(vec![table_id, id])
        }
        DatabaseDesignOperationKind::DropObject { object_id } => {
            require_absent(graph, object_id)
                .err()
                .ok_or_else(|| object_not_found(object_id))?;
            let removed = remove_subtree(graph, object_id);
            detach_from_parents(graph, object_id);
            Ok(removed)
        }
    }
}

// ----- helpers ---------------------------------------------------------------------------------

fn owner_scope(owner_project: &str) -> String {
    if owner_project == "." || owner_project.is_empty() {
        String::new()
    } else {
        format!("{}/", owner_project.trim_end_matches('/'))
    }
}

/// Migration files and companion SQL that belong to the same logical datasource as its schema file.
/// Scoped to the owning package so a monorepo never attributes one package's migrations to another.
fn companion_paths(
    files: &[PathBuf],
    project_root: &Path,
    logical: &DiscoveredLogicalDatabase,
    owner_scope: &str,
) -> Vec<PathBuf> {
    let wants_prisma = logical.adapter_ids.contains(&DatabaseAdapterId::Prisma);
    let wants_drizzle = logical.adapter_ids.contains(&DatabaseAdapterId::Drizzle);
    if !wants_prisma && !wants_drizzle {
        return Vec::new();
    }
    files
        .iter()
        .filter(|path| {
            let relative = relative_path(project_root, path);
            if !relative.starts_with(owner_scope) || !relative.ends_with(".sql") {
                return false;
            }
            (wants_prisma && relative.contains("prisma/migrations/"))
                || (wants_drizzle && relative.contains("drizzle/"))
        })
        .cloned()
        .collect()
}

/// Dependency-declaration evidence for packages that consume a datasource they do not own. Recorded
/// as heuristic: a dependency edge is strong evidence of use, but it is not a schema declaration.
fn consumer_evidence(
    repository_id: &str,
    logical: &DiscoveredLogicalDatabase,
    now: &str,
) -> Vec<DatabaseSourceEvidence> {
    logical
        .consumer_projects
        .iter()
        .map(|consumer| {
            let relative_path = if consumer == "." {
                "package.json".to_owned()
            } else {
                format!("{consumer}/package.json")
            };
            DatabaseSourceEvidence {
                id: stable_id(&[repository_id, &logical.logical_name, consumer, "consumer"]),
                repository_id: repository_id.to_owned(),
                project_id: Some(consumer.clone()),
                adapter_id: logical
                    .adapter_ids
                    .first()
                    .cloned()
                    .unwrap_or(DatabaseAdapterId::RawSql),
                evidence_kind: DatabaseEvidenceKind::OrmImport,
                relative_path,
                symbol_or_key: None,
                safe_value_fingerprint: None,
                source_hint: Some(format!(
                    "declares a dependency on the package that owns '{}'",
                    logical.logical_name
                )),
                owner_signal: 0.0,
                consumer_signal: 1.0,
                certainty: EvidenceCertainty::Heuristic,
                confidence: 0.8,
                content_sha256: stable_id(&[consumer, &logical.logical_name]),
                extractor_version: EXTRACTOR_VERSION.to_owned(),
                discovered_at: now.to_owned(),
            }
        })
        .collect()
}

fn scan_repository(project_root: &Path) -> AppResult<Vec<PathBuf>> {
    let mut files = Vec::new();
    let mut stack = vec![project_root.to_path_buf()];
    while let Some(directory) = stack.pop() {
        let entries = match std::fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default();
            if path.is_dir() {
                if !SKIPPED_DIRECTORIES.contains(&name) {
                    stack.push(path);
                }
            } else if path.is_file() {
                files.push(path);
                if files.len() >= MAX_SCANNED_FILES {
                    return Ok(files);
                }
            }
        }
    }
    files.sort();
    Ok(files)
}

fn relative_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn proposed_id(kind: &str) -> String {
    format!("db:{kind}:p_{}", Uuid::new_v4().simple())
}

fn edge_id(source: &str, target: &str, edge_type: &DatabaseEdgeType) -> String {
    stable_id(&[source, target, &format!("{edge_type:?}")])
}

fn stable_id(parts: &[&str]) -> String {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update(part.as_bytes());
        hasher.update([0]);
    }
    format!("{:x}", hasher.finalize())
}

fn fingerprint_of(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    format!("sha256:{:x}", hasher.finalize())
}

fn object_meta_mut(object: &mut DatabaseObject) -> &mut DatabaseObjectMeta {
    match object {
        DatabaseObject::Environment(value) => &mut value.meta,
        DatabaseObject::Namespace(value) => &mut value.meta,
        DatabaseObject::Table(value) => &mut value.meta,
        DatabaseObject::Column(value) => &mut value.meta,
        DatabaseObject::PrimaryKey(value) => &mut value.meta,
        DatabaseObject::ForeignKey(value) => &mut value.meta,
        DatabaseObject::UniqueConstraint(value) => &mut value.meta,
        DatabaseObject::CheckConstraint(value) => &mut value.meta,
        DatabaseObject::Index(value) => &mut value.meta,
        DatabaseObject::Enum(value) => &mut value.meta,
        DatabaseObject::View(value) => &mut value.meta,
        DatabaseObject::Migration(value) => &mut value.meta,
        DatabaseObject::OrmModel(value) => &mut value.meta,
    }
}

fn remap_id(id: &str, map: &HashMap<String, String>) -> String {
    map.get(id).cloned().unwrap_or_else(|| id.to_owned())
}

fn remap_ids(ids: &mut [SemanticId], map: &HashMap<String, String>) {
    for id in ids.iter_mut() {
        *id = remap_id(id, map);
    }
}

fn remap_object(object: &mut DatabaseObject, map: &HashMap<String, String>, source_id: &str) {
    let previous = object.meta().identity.id.clone();
    {
        let meta = object_meta_mut(object);
        meta.identity.id = remap_id(&previous, map);
        meta.identity.previous_ids.push(previous);
        meta.layer = DatabaseLayer::Proposed;
        meta.snapshot_id = None;
        meta.design_revision_id = None;
        meta.source_id = source_id.to_owned();
        meta.provenance_ids.clear();
    }
    match object {
        DatabaseObject::Table(table) => {
            table.namespace_id = remap_id(&table.namespace_id, map);
            remap_ids(&mut table.column_ids, map);
            table.primary_key_id = table.primary_key_id.as_ref().map(|id| remap_id(id, map));
            remap_ids(&mut table.foreign_key_ids, map);
            remap_ids(&mut table.unique_constraint_ids, map);
            remap_ids(&mut table.check_constraint_ids, map);
            remap_ids(&mut table.index_ids, map);
        }
        DatabaseObject::Column(column) => {
            column.table_id = remap_id(&column.table_id, map);
            column.enum_id = column.enum_id.as_ref().map(|id| remap_id(id, map));
        }
        DatabaseObject::PrimaryKey(key) => {
            key.table_id = remap_id(&key.table_id, map);
            remap_ids(&mut key.column_ids, map);
        }
        DatabaseObject::ForeignKey(key) => {
            key.table_id = remap_id(&key.table_id, map);
            key.referenced_table_id = remap_id(&key.referenced_table_id, map);
            remap_ids(&mut key.column_ids, map);
            remap_ids(&mut key.referenced_column_ids, map);
        }
        DatabaseObject::UniqueConstraint(constraint) => {
            constraint.table_id = remap_id(&constraint.table_id, map);
            remap_ids(&mut constraint.column_ids, map);
        }
        DatabaseObject::CheckConstraint(constraint) => {
            constraint.table_id = remap_id(&constraint.table_id, map);
        }
        DatabaseObject::Index(index) => {
            index.table_id = remap_id(&index.table_id, map);
            for key in &mut index.keys {
                key.column_id = key.column_id.as_ref().map(|id| remap_id(id, map));
            }
            remap_ids(&mut index.included_column_ids, map);
        }
        DatabaseObject::Enum(value) => {
            value.namespace_id = remap_id(&value.namespace_id, map);
        }
        DatabaseObject::View(view) => {
            view.namespace_id = remap_id(&view.namespace_id, map);
            remap_ids(&mut view.column_ids, map);
            remap_ids(&mut view.dependency_ids, map);
        }
        DatabaseObject::OrmModel(model) => {
            model.mapped_table_id = model.mapped_table_id.as_ref().map(|id| remap_id(id, map));
            for mapping in &mut model.field_mappings {
                mapping.column_id = mapping.column_id.as_ref().map(|id| remap_id(id, map));
            }
        }
        DatabaseObject::Environment(_)
        | DatabaseObject::Namespace(_)
        | DatabaseObject::Migration(_) => {}
    }
}

fn reset_meta(meta: &mut DatabaseObjectMeta, source_id: &str, now: &str) {
    if meta.identity.id.trim().is_empty() {
        meta.identity.id = proposed_id("object");
    }
    if meta.identity.logical_key.trim().is_empty() {
        meta.identity.logical_key = meta.identity.id.clone();
    }
    meta.source_id = source_id.to_owned();
    meta.layer = DatabaseLayer::Proposed;
    meta.snapshot_id = None;
    meta.design_revision_id = None;
    meta.provenance_ids.clear();
    meta.confidence = 1.0;
    if meta.discovered_at.trim().is_empty() {
        meta.discovered_at = now.to_owned();
    }
    meta.observed_at = now.to_owned();
    meta.updated_at = now.to_owned();
    if meta.content_fingerprint.trim().is_empty() {
        meta.content_fingerprint = fingerprint_of(&meta.identity.qualified_name);
    }
}

fn push_edge(
    graph: &mut ExtractedDatabaseGraph,
    source: &str,
    target: &str,
    edge_type: DatabaseEdgeType,
    now: &str,
) {
    let id = edge_id(source, target, &edge_type);
    if graph.edges.iter().any(|edge| edge.id == id) {
        return;
    }
    graph.edges.push(DatabaseEdge {
        id,
        source_object_id: source.to_owned(),
        target_object_id: target.to_owned(),
        edge_type,
        snapshot_id: None,
        design_revision_id: None,
        confidence: 1.0,
        provenance_ids: Vec::new(),
        created_at: now.to_owned(),
    });
}

/// Remove an object and everything that cannot exist without it. Returns every removed ID so the
/// caller can report an accurate change set instead of guessing.
fn remove_subtree(graph: &mut ExtractedDatabaseGraph, object_id: &str) -> Vec<SemanticId> {
    let mut doomed: HashSet<String> = HashSet::new();
    doomed.insert(object_id.to_owned());
    let mut changed = true;
    while changed {
        changed = false;
        for object in &graph.objects {
            let id = object.meta().identity.id.clone();
            if doomed.contains(&id) {
                continue;
            }
            let parent = match object {
                DatabaseObject::Column(column) => Some(column.table_id.clone()),
                DatabaseObject::PrimaryKey(key) => Some(key.table_id.clone()),
                DatabaseObject::ForeignKey(key) => Some(key.table_id.clone()),
                DatabaseObject::UniqueConstraint(constraint) => Some(constraint.table_id.clone()),
                DatabaseObject::CheckConstraint(constraint) => Some(constraint.table_id.clone()),
                DatabaseObject::Index(index) => Some(index.table_id.clone()),
                DatabaseObject::Table(table) => Some(table.namespace_id.clone()),
                _ => None,
            };
            let references_doomed = match object {
                DatabaseObject::ForeignKey(key) => {
                    doomed.contains(&key.referenced_table_id)
                        || key.column_ids.iter().any(|id| doomed.contains(id))
                        || key
                            .referenced_column_ids
                            .iter()
                            .any(|id| doomed.contains(id))
                }
                DatabaseObject::PrimaryKey(key) => {
                    key.column_ids.iter().any(|id| doomed.contains(id))
                }
                DatabaseObject::UniqueConstraint(constraint) => {
                    constraint.column_ids.iter().any(|id| doomed.contains(id))
                }
                DatabaseObject::Index(index) => index
                    .keys
                    .iter()
                    .filter_map(|key| key.column_id.as_ref())
                    .any(|id| doomed.contains(id)),
                _ => false,
            };
            if parent.is_some_and(|parent| doomed.contains(&parent)) || references_doomed {
                doomed.insert(id);
                changed = true;
            }
        }
    }

    graph
        .objects
        .retain(|object| !doomed.contains(&object.meta().identity.id));
    graph.edges.retain(|edge| {
        !doomed.contains(&edge.source_object_id) && !doomed.contains(&edge.target_object_id)
    });
    for object in &mut graph.objects {
        if let DatabaseObject::Table(table) = object {
            table.column_ids.retain(|id| !doomed.contains(id));
            table.foreign_key_ids.retain(|id| !doomed.contains(id));
            table
                .unique_constraint_ids
                .retain(|id| !doomed.contains(id));
            table.check_constraint_ids.retain(|id| !doomed.contains(id));
            table.index_ids.retain(|id| !doomed.contains(id));
            if table
                .primary_key_id
                .as_ref()
                .is_some_and(|id| doomed.contains(id))
            {
                table.primary_key_id = None;
            }
        }
    }
    let mut removed: Vec<String> = doomed.into_iter().collect();
    removed.sort();
    removed
}

fn detach_from_parents(graph: &mut ExtractedDatabaseGraph, object_id: &str) {
    for object in &mut graph.objects {
        if let DatabaseObject::Table(table) = object {
            table.column_ids.retain(|id| id != object_id);
            table.foreign_key_ids.retain(|id| id != object_id);
            table.unique_constraint_ids.retain(|id| id != object_id);
            table.check_constraint_ids.retain(|id| id != object_id);
            table.index_ids.retain(|id| id != object_id);
        }
    }
}

fn require_absent(graph: &ExtractedDatabaseGraph, object_id: &str) -> AppResult<()> {
    if graph
        .objects
        .iter()
        .any(|object| object.meta().identity.id == object_id)
    {
        return Err(design_conflict(format!(
            "Object '{object_id}' already exists in this design."
        )));
    }
    Ok(())
}

fn require_table<'a>(
    graph: &'a ExtractedDatabaseGraph,
    table_id: &str,
) -> AppResult<&'a DatabaseTable> {
    graph
        .objects
        .iter()
        .find_map(|object| match object {
            DatabaseObject::Table(table) if table.meta.identity.id == table_id => Some(table),
            _ => None,
        })
        .ok_or_else(|| object_not_found(table_id))
}

fn require_table_mut<'a>(
    graph: &'a mut ExtractedDatabaseGraph,
    table_id: &str,
) -> AppResult<&'a mut DatabaseTable> {
    graph
        .objects
        .iter_mut()
        .find_map(|object| match object {
            DatabaseObject::Table(table) if table.meta.identity.id == table_id => Some(table),
            _ => None,
        })
        .ok_or_else(|| object_not_found(table_id))
}

fn require_column<'a>(
    graph: &'a ExtractedDatabaseGraph,
    column_id: &str,
) -> AppResult<&'a DatabaseColumn> {
    graph
        .objects
        .iter()
        .find_map(|object| match object {
            DatabaseObject::Column(column) if column.meta.identity.id == column_id => Some(column),
            _ => None,
        })
        .ok_or_else(|| object_not_found(column_id))
}

fn require_column_mut<'a>(
    graph: &'a mut ExtractedDatabaseGraph,
    column_id: &str,
) -> AppResult<&'a mut DatabaseColumn> {
    graph
        .objects
        .iter_mut()
        .find_map(|object| match object {
            DatabaseObject::Column(column) if column.meta.identity.id == column_id => Some(column),
            _ => None,
        })
        .ok_or_else(|| object_not_found(column_id))
}

fn columns_of<'a>(graph: &'a ExtractedDatabaseGraph, table_id: &str) -> Vec<&'a DatabaseColumn> {
    graph
        .objects
        .iter()
        .filter_map(|object| match object {
            DatabaseObject::Column(column) if column.table_id == table_id => Some(column),
            _ => None,
        })
        .collect()
}

fn object_not_found(object_id: &str) -> AppError {
    AppError::new(
        "database_object_not_found",
        "The design does not contain the referenced database object.",
        true,
    )
    .entity(object_id)
    .layer("database_studio")
}

fn design_conflict(message: String) -> AppError {
    AppError::new("database_design_conflict", message, true).layer("database_studio")
}

/// Deterministic health issues derived from adapters plus the shared rule set, stamped for the
/// graph reference they were computed against.
pub fn issues_for_graph(
    source_id: &str,
    snapshot_id: Option<&str>,
    design_revision_id: Option<&str>,
    graph: &ExtractedDatabaseGraph,
) -> Vec<DatabaseIssue> {
    let now = Utc::now().to_rfc3339();
    super::health::evaluate_graph_health(graph)
        .into_iter()
        .map(|issue| DatabaseIssue {
            id: format!(
                "dbissue:{}",
                stable_id(&[
                    source_id,
                    snapshot_id.unwrap_or_default(),
                    design_revision_id.unwrap_or_default(),
                    &format!("{:?}", issue.code),
                    &issue.object_ids.join(",")
                ])
            ),
            source_id: source_id.to_owned(),
            snapshot_id: snapshot_id.map(str::to_owned),
            design_revision_id: design_revision_id.map(str::to_owned),
            semantic_object_ids: issue.object_ids,
            code: issue.code,
            severity: issue.severity,
            title: issue.title,
            explanation: issue.explanation,
            evidence_ids: Vec::new(),
            status: DatabaseIssueStatus::Open,
            detected_at: now.clone(),
            resolved_at: None,
        })
        .collect()
}

/// V1 adapter capability matrix, surfaced to the UI so the Connections surface can state exactly
/// what is and is not supported rather than implying capabilities that do not exist.
pub fn adapter_capabilities() -> Vec<(DatabaseAdapterId, DatabaseAdapterCapabilities)> {
    registered_v1_adapters()
        .into_iter()
        .map(|adapter| (adapter.id(), adapter.capabilities()))
        .collect()
}

/// Provenance rows for a proposed graph so a design keeps an auditable origin even though it was not
/// extracted from a file.
pub fn design_provenance(
    graph: &ExtractedDatabaseGraph,
    revision_id: &str,
    actor_kind: &str,
) -> Vec<DatabaseObjectProvenance> {
    let now = Utc::now().to_rfc3339();
    graph
        .objects
        .iter()
        .map(|object| DatabaseObjectProvenance {
            id: format!(
                "dbprov:{}",
                stable_id(&[revision_id, &object.meta().identity.id])
            ),
            object_id: object.meta().identity.id.clone(),
            source_kind: format!("design:{actor_kind}"),
            certainty: EvidenceCertainty::Exact,
            confidence: 1.0,
            evidence_ref: Some(revision_id.to_owned()),
            extractor_version: EXTRACTOR_VERSION.to_owned(),
            observed_at: now.clone(),
        })
        .collect()
}

/// Identity helper used by design operations built on the agent protocol, where the caller supplies
/// only a name and the backend must mint the stable synthetic identity.
pub fn new_proposed_identity(kind: &str, qualified_name: &str) -> SemanticIdentity {
    let id = proposed_id(kind);
    SemanticIdentity {
        id: id.clone(),
        logical_key: id,
        qualified_name: qualified_name.to_owned(),
        previous_ids: Vec::new(),
    }
}

#[cfg(test)]
mod visual_verification_dump {
    //! TEMPORARY, for one-off UI visual verification — not part of the mission deliverable.
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn zz_dump_prisma_fixture_graph_page_json() {
        let root =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/database_studio/prisma");
        let discovered = discover_project("dump-repo", &root).unwrap();
        let source_entry = &discovered[0];
        let (graph, issues) = extract_declared_graph(
            "dump-repo",
            &root,
            &source_entry.source,
            &source_entry.evidence,
            None,
        )
        .unwrap();
        let page = serde_json::json!({
            "objects": graph.objects,
            "edges": graph.edges,
            "issues": issues,
        });
        println!("===GRAPH_PAGE_JSON_START===");
        println!("{}", serde_json::to_string(&page).unwrap());
        println!("===GRAPH_PAGE_JSON_END===");
    }
}

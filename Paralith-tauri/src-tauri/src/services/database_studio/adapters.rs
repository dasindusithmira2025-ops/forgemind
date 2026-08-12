#![allow(dead_code)]

use chrono::Utc;
use sha2::{Digest, Sha256};
use std::collections::{BTreeSet, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use crate::errors::{AppError, AppResult};
use crate::models::{
    DatabaseAdapterCapabilities, DatabaseAdapterId, DatabaseChangeKind, DatabaseColumn,
    DatabaseDataType, DatabaseEdge, DatabaseEdgeType, DatabaseEnumValue, DatabaseEvidenceKind,
    DatabaseExpression, DatabaseIssue, DatabaseIssueCode, DatabaseIssueSeverity,
    DatabaseIssueStatus, DatabaseLayer, DatabaseMigration, DatabaseNamespace, DatabaseObject,
    DatabaseObjectMeta, DatabaseObjectProvenance, DatabaseSource, DatabaseSourceEvidence,
    DatabaseTable, DatabaseTypeFamily, Enum, EvidenceCertainty, ExtractedDatabaseGraph, ForeignKey,
    Index, IndexKey, MigrationAppliedState, OrmFieldMapping, OrmModel, PrimaryKey,
    ReferentialAction, SemanticIdentity, UniqueConstraint,
};

const MAX_EVIDENCE_FILE_BYTES: u64 = 8 * 1024 * 1024;
const SKIPPED_DIRECTORIES: [&str; 4] = [".git", "node_modules", "target", "dist"];

pub struct DetectionContext<'a> {
    pub repository_id: &'a str,
    pub project_id: &'a str,
    /// The logical datasource this detection pass is attributing evidence to. One file can be
    /// evidence for more than one datasource (a shared schema, a package consumed by two apps), and
    /// `database_source_evidence.id` is a global primary key, so evidence identity must carry the
    /// owning source or the second source's insert fails with a UNIQUE violation.
    pub source_id: &'a str,
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

pub struct ValidationContext<'a> {
    pub source: &'a DatabaseSource,
}

pub trait DatabaseAdapter: Send + Sync {
    fn id(&self) -> DatabaseAdapterId;
    fn capabilities(&self) -> DatabaseAdapterCapabilities;
    fn detect(&self, ctx: &DetectionContext<'_>) -> AppResult<Vec<DatabaseSourceEvidence>>;
    fn extract_declared_schema(
        &self,
        ctx: &ExtractionContext<'_>,
    ) -> AppResult<ExtractedDatabaseGraph>;
    fn validate(
        &self,
        ctx: &ValidationContext<'_>,
        graph: &ExtractedDatabaseGraph,
    ) -> AppResult<Vec<DatabaseIssue>>;
}

#[derive(Clone)]
pub struct StaticAdapter {
    id: DatabaseAdapterId,
    capabilities: DatabaseAdapterCapabilities,
}

impl StaticAdapter {
    pub fn new(id: DatabaseAdapterId, capabilities: DatabaseAdapterCapabilities) -> Self {
        Self { id, capabilities }
    }
}

impl DatabaseAdapter for StaticAdapter {
    fn id(&self) -> DatabaseAdapterId {
        self.id.clone()
    }

    fn capabilities(&self) -> DatabaseAdapterCapabilities {
        self.capabilities
    }

    fn detect(&self, ctx: &DetectionContext<'_>) -> AppResult<Vec<DatabaseSourceEvidence>> {
        detect_static_evidence(self.id(), ctx)
    }

    fn extract_declared_schema(
        &self,
        ctx: &ExtractionContext<'_>,
    ) -> AppResult<ExtractedDatabaseGraph> {
        extract_static_graph(self.id(), ctx)
    }

    fn validate(
        &self,
        ctx: &ValidationContext<'_>,
        graph: &ExtractedDatabaseGraph,
    ) -> AppResult<Vec<DatabaseIssue>> {
        Ok(validate_static_graph(ctx, graph))
    }
}

#[derive(Debug, Clone, Default)]
struct ParsedSchema {
    tables: Vec<ParsedTable>,
    enums: Vec<ParsedEnum>,
}

#[derive(Debug, Clone, Default)]
struct ParsedTable {
    namespace: String,
    name: String,
    orm_symbol: Option<String>,
    mapped_name: Option<String>,
    columns: Vec<ParsedColumn>,
    primary_key: Option<ParsedKey>,
    foreign_keys: Vec<ParsedForeignKey>,
    unique_constraints: Vec<ParsedKey>,
    indexes: Vec<ParsedIndex>,
}

#[derive(Debug, Clone)]
struct ParsedColumn {
    name: String,
    mapped_name: Option<String>,
    native_type: String,
    nullable: bool,
    default: Option<String>,
    enum_name: Option<String>,
}

#[derive(Debug, Clone, Default)]
struct ParsedKey {
    name: Option<String>,
    columns: Vec<String>,
}

#[derive(Debug, Clone, Default)]
struct ParsedForeignKey {
    name: Option<String>,
    columns: Vec<String>,
    referenced_table: String,
    referenced_columns: Vec<String>,
    on_delete: ReferentialAction,
    on_update: ReferentialAction,
}

#[derive(Debug, Clone, Default)]
struct ParsedIndex {
    name: String,
    columns: Vec<String>,
    unique: bool,
}

#[derive(Debug, Clone, Default)]
struct ParsedEnum {
    namespace: String,
    name: String,
    values: Vec<String>,
}

fn detect_static_evidence(
    adapter_id: DatabaseAdapterId,
    ctx: &DetectionContext<'_>,
) -> AppResult<Vec<DatabaseSourceEvidence>> {
    let mut evidence = Vec::new();
    let discovered_at = Utc::now().to_rfc3339();

    for path in candidate_files(ctx.project_root, ctx.changed_paths)? {
        let relative = relative_path(ctx.project_root, &path);
        let Some(kind) = evidence_kind_for(&adapter_id, &relative) else {
            continue;
        };
        let metadata = fs::metadata(&path).map_err(AppError::database)?;
        if metadata.len() > MAX_EVIDENCE_FILE_BYTES {
            continue;
        }
        let bytes = fs::read(&path).map_err(AppError::database)?;
        let content = if is_sqlite_path(&relative) {
            None
        } else {
            Some(String::from_utf8_lossy(&bytes).into_owned())
        };
        if !matches_adapter(&adapter_id, &relative, content.as_deref()) {
            continue;
        }
        let content_ref = content.as_deref().unwrap_or_default();
        evidence.push(DatabaseSourceEvidence {
            id: stable_id(
                "evidence",
                &[
                    ctx.repository_id,
                    ctx.source_id,
                    &relative,
                    adapter_name(&adapter_id),
                ],
            ),
            repository_id: ctx.repository_id.to_owned(),
            project_id: Some(ctx.project_id.to_owned()),
            adapter_id: adapter_id.clone(),
            evidence_kind: kind,
            relative_path: relative.clone(),
            symbol_or_key: source_symbol(&adapter_id, content_ref),
            safe_value_fingerprint: datasource_env(content_ref)
                .map(|value| sha256_hex(value.as_bytes())),
            source_hint: None,
            owner_signal: if is_primary_schema_path(&relative) {
                1.0
            } else {
                0.7
            },
            consumer_signal: 0.0,
            certainty: EvidenceCertainty::Exact,
            confidence: 1.0,
            content_sha256: sha256_hex(&bytes),
            extractor_version: ctx.extractor_version.to_owned(),
            discovered_at: discovered_at.clone(),
        });
    }
    evidence.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    evidence.dedup_by(|left, right| left.id == right.id);
    Ok(evidence)
}

fn extract_static_graph(
    adapter_id: DatabaseAdapterId,
    ctx: &ExtractionContext<'_>,
) -> AppResult<ExtractedDatabaseGraph> {
    let mut graph = ExtractedDatabaseGraph {
        objects: Vec::new(),
        edges: Vec::new(),
        provenance: Vec::new(),
    };
    let mut seen_objects = HashSet::new();
    let mut seen_edges = HashSet::new();

    for evidence in ctx
        .evidence
        .iter()
        .filter(|item| item.adapter_id == adapter_id)
    {
        if evidence.evidence_kind == DatabaseEvidenceKind::MigrationDirectory {
            add_migration(ctx, evidence, &mut graph, &mut seen_objects);
            continue;
        }
        if is_sqlite_path(&evidence.relative_path) {
            continue;
        }
        let path = guarded_evidence_path(ctx.project_root, &evidence.relative_path)?;
        let metadata = fs::metadata(&path).map_err(AppError::database)?;
        if metadata.len() > MAX_EVIDENCE_FILE_BYTES {
            continue;
        }
        let content = fs::read_to_string(path).map_err(AppError::database)?;
        let parsed = match adapter_id {
            DatabaseAdapterId::Prisma => parse_prisma_schema(&content),
            DatabaseAdapterId::Drizzle => parse_drizzle_schema(&content),
            DatabaseAdapterId::RawSql | DatabaseAdapterId::Sqlite => parse_sql_schema(&content),
            _ => ParsedSchema::default(),
        };
        add_parsed_schema(
            ctx,
            evidence,
            &adapter_id,
            parsed,
            &mut graph,
            &mut seen_objects,
            &mut seen_edges,
        );
    }

    // Fingerprints must describe the object, not the file it came from. Deriving them here — after
    // every object is fully built — is what makes a reformatted schema produce an identical graph.
    for object in &mut graph.objects {
        let fingerprint = semantic_fingerprint(object);
        object_meta_mut(object).content_fingerprint = fingerprint;
    }

    graph
        .objects
        .sort_by(|left, right| left.meta().identity.id.cmp(&right.meta().identity.id));
    graph.edges.sort_by(|left, right| left.id.cmp(&right.id));
    graph
        .provenance
        .sort_by(|left, right| left.id.cmp(&right.id));
    Ok(graph)
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

/// Hash of everything about an object that a database would care about, and nothing else. Names,
/// types, nullability, defaults, and key membership are in; file paths, timestamps, evidence
/// hashes, and declaration order are out.
fn semantic_fingerprint(object: &DatabaseObject) -> String {
    let qualified = &object.meta().identity.qualified_name;
    let body = match object {
        DatabaseObject::Table(table) => {
            format!("{}|{:?}|{:?}", table.name, table.mapped_name, table.comment)
        }
        DatabaseObject::Column(column) => format!(
            "{}|{}|{:?}|{}|{:?}|{:?}|{:?}",
            column.name,
            column.native_type,
            column.data_type,
            column.nullable,
            column.default,
            column.identity_generation,
            column.enum_id
        ),
        DatabaseObject::PrimaryKey(key) => format!("{:?}|{:?}", key.name, key.column_ids),
        DatabaseObject::ForeignKey(key) => format!(
            "{:?}|{:?}|{}|{:?}|{:?}|{:?}",
            key.name,
            key.column_ids,
            key.referenced_table_id,
            key.referenced_column_ids,
            key.on_delete,
            key.on_update
        ),
        DatabaseObject::UniqueConstraint(constraint) => {
            format!("{:?}|{:?}", constraint.name, constraint.column_ids)
        }
        DatabaseObject::CheckConstraint(constraint) => {
            format!("{:?}|{:?}", constraint.name, constraint.expression)
        }
        DatabaseObject::Index(index) => format!(
            "{}|{}|{:?}|{:?}|{:?}",
            index.name, index.unique, index.method, index.keys, index.predicate
        ),
        DatabaseObject::Enum(value) => format!("{}|{:?}", value.name, value.values),
        DatabaseObject::View(view) => format!("{}|{}", view.name, view.definition_fingerprint),
        DatabaseObject::Migration(migration) => {
            format!("{}|{}", migration.relative_path, migration.checksum)
        }
        DatabaseObject::OrmModel(model) => {
            format!("{}|{:?}", model.symbol, model.mapped_table_id)
        }
        DatabaseObject::Namespace(namespace) => namespace.name.clone(),
        DatabaseObject::Environment(environment) => environment.name.clone(),
    };
    stable_id("fp", &[object.kind_name(), qualified, &body])
}

fn validate_static_graph(
    ctx: &ValidationContext<'_>,
    graph: &ExtractedDatabaseGraph,
) -> Vec<DatabaseIssue> {
    let now = Utc::now().to_rfc3339();
    let object_ids: HashSet<&str> = graph
        .objects
        .iter()
        .map(|object| object.meta().identity.id.as_str())
        .collect();
    let mut counts = HashMap::<&str, usize>::new();
    for object in &graph.objects {
        *counts
            .entry(object.meta().identity.id.as_str())
            .or_default() += 1;
    }

    let mut issues = Vec::new();
    for object in &graph.objects {
        if let DatabaseObject::Table(table) = object {
            if table.primary_key_id.is_none() {
                issues.push(issue(
                    ctx,
                    DatabaseIssueCode::MissingPrimaryKey,
                    DatabaseIssueSeverity::Warning,
                    "missing_primary_key",
                    vec![table.meta.identity.id.clone()],
                    format!("Table {} has no primary key", table.name),
                    "Static schema extraction did not find a primary key for this table.",
                    table.meta.provenance_ids.clone(),
                    &now,
                ));
            }
        }
    }
    for (id, count) in counts {
        if count > 1 {
            issues.push(issue(
                ctx,
                DatabaseIssueCode::DuplicateIdentity,
                DatabaseIssueSeverity::Error,
                "duplicate_identity",
                vec![id.to_owned()],
                "Duplicate semantic identity".to_owned(),
                "Two extracted objects resolved to the same semantic identity.",
                Vec::new(),
                &now,
            ));
        }
    }
    for edge in &graph.edges {
        if !object_ids.contains(edge.source_object_id.as_str())
            || !object_ids.contains(edge.target_object_id.as_str())
        {
            issues.push(issue(
                ctx,
                DatabaseIssueCode::BrokenReference,
                DatabaseIssueSeverity::Error,
                "broken_reference",
                vec![edge.source_object_id.clone(), edge.target_object_id.clone()],
                "Broken schema reference".to_owned(),
                "An extracted relationship refers to an object that is absent from the graph.",
                edge.provenance_ids.clone(),
                &now,
            ));
        }
    }
    issues.sort_by(|left, right| left.id.cmp(&right.id));
    issues.dedup_by(|left, right| left.id == right.id);
    issues
}

#[allow(clippy::too_many_arguments)]
fn issue(
    ctx: &ValidationContext<'_>,
    code: DatabaseIssueCode,
    severity: DatabaseIssueSeverity,
    stable_code: &str,
    mut object_ids: Vec<String>,
    title: String,
    explanation: &str,
    evidence_ids: Vec<String>,
    detected_at: &str,
) -> DatabaseIssue {
    object_ids.sort();
    object_ids.dedup();
    DatabaseIssue {
        id: stable_id(
            "issue",
            &[&ctx.source.id, stable_code, &object_ids.join("\0")],
        ),
        source_id: ctx.source.id.clone(),
        snapshot_id: None,
        design_revision_id: None,
        semantic_object_ids: object_ids,
        code,
        severity,
        title,
        explanation: explanation.to_owned(),
        evidence_ids,
        status: DatabaseIssueStatus::Open,
        detected_at: detected_at.to_owned(),
        resolved_at: None,
    }
}

fn candidate_files(root: &Path, changed_paths: &[PathBuf]) -> AppResult<Vec<PathBuf>> {
    let canonical_root = root.canonicalize().map_err(AppError::database)?;
    if !changed_paths.is_empty() {
        let mut files = Vec::new();
        for changed in changed_paths {
            let joined = if changed.is_absolute() {
                changed.clone()
            } else {
                canonical_root.join(changed)
            };
            if !joined.exists() || !joined.is_file() {
                continue;
            }
            let canonical = joined.canonicalize().map_err(AppError::database)?;
            if canonical.starts_with(&canonical_root) {
                files.push(canonical);
            }
        }
        files.sort();
        files.dedup();
        return Ok(files);
    }

    let mut files = Vec::new();
    let mut stack = vec![canonical_root];
    while let Some(directory) = stack.pop() {
        for entry in fs::read_dir(&directory).map_err(AppError::database)? {
            let entry = entry.map_err(AppError::database)?;
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
            }
        }
    }
    files.sort();
    Ok(files)
}

fn guarded_evidence_path(root: &Path, relative: &str) -> AppResult<PathBuf> {
    let canonical_root = root.canonicalize().map_err(AppError::database)?;
    let candidate = canonical_root.join(relative);
    let canonical = candidate.canonicalize().map_err(AppError::database)?;
    if !canonical.starts_with(&canonical_root) || !canonical.is_file() {
        return Err(AppError::new(
            "database_evidence_scope_denied",
            "Database evidence path is outside the Project root.",
            false,
        )
        .layer("database_studio"));
    }
    Ok(canonical)
}

fn evidence_kind_for(
    adapter_id: &DatabaseAdapterId,
    relative: &str,
) -> Option<DatabaseEvidenceKind> {
    let lower = relative.to_ascii_lowercase();
    match adapter_id {
        DatabaseAdapterId::Prisma if lower.ends_with(".prisma") => {
            Some(DatabaseEvidenceKind::OrmSchema)
        }
        DatabaseAdapterId::Prisma
            if lower.ends_with(".sql") && lower.contains("prisma/migrations/") =>
        {
            Some(DatabaseEvidenceKind::MigrationDirectory)
        }
        DatabaseAdapterId::Drizzle if lower.ends_with(".ts") || lower.ends_with(".tsx") => {
            Some(DatabaseEvidenceKind::OrmSchema)
        }
        DatabaseAdapterId::Drizzle
            if lower.ends_with(".sql")
                && (lower.contains("drizzle/") || lower.contains("drizzle\\")) =>
        {
            Some(DatabaseEvidenceKind::SqlDdl)
        }
        DatabaseAdapterId::RawSql
            if lower.ends_with(".sql")
                && !lower.contains("prisma/migrations/")
                && !lower.contains("drizzle/") =>
        {
            Some(DatabaseEvidenceKind::SqlDdl)
        }
        DatabaseAdapterId::Sqlite if is_sqlite_path(relative) => {
            Some(DatabaseEvidenceKind::SqliteFile)
        }
        DatabaseAdapterId::Sqlite if lower.ends_with(".sql") => Some(DatabaseEvidenceKind::SqlDdl),
        _ => None,
    }
}

fn matches_adapter(adapter_id: &DatabaseAdapterId, relative: &str, content: Option<&str>) -> bool {
    let lower = relative.to_ascii_lowercase();
    let content = content.unwrap_or_default();
    match adapter_id {
        DatabaseAdapterId::Prisma => {
            lower.ends_with(".prisma") || lower.contains("prisma/migrations/")
        }
        DatabaseAdapterId::Drizzle => {
            content.contains("drizzle-orm")
                && ["pgTable", "mysqlTable", "sqliteTable", "pgEnum"]
                    .iter()
                    .any(|factory| content.contains(factory))
                || lower.contains("drizzle/") && lower.ends_with(".sql")
        }
        DatabaseAdapterId::RawSql => contains_sql_ddl(content),
        DatabaseAdapterId::Sqlite => {
            is_sqlite_path(relative)
                || lower.ends_with(".sql")
                    && (content.to_ascii_lowercase().contains("sqlite")
                        || content.to_ascii_lowercase().contains("autoincrement"))
        }
        _ => false,
    }
}

fn contains_sql_ddl(content: &str) -> bool {
    let normalized = strip_sql_comments(content).to_ascii_lowercase();
    [
        "create table",
        "create schema",
        "create type",
        "create index",
        "create unique index",
    ]
    .iter()
    .any(|needle| normalized.contains(needle))
}

fn source_symbol(adapter_id: &DatabaseAdapterId, content: &str) -> Option<String> {
    match adapter_id {
        DatabaseAdapterId::Prisma => {
            datasource_env(content).or_else(|| block_name(content, "datasource"))
        }
        DatabaseAdapterId::Drizzle => Some("drizzle-orm".to_owned()),
        _ => None,
    }
}

fn parse_prisma_schema(content: &str) -> ParsedSchema {
    let blocks = named_blocks(content, &["model", "enum"]);
    let model_names: HashSet<String> = blocks
        .iter()
        .filter(|block| block.keyword == "model")
        .map(|block| block.name.clone())
        .collect();
    let enum_names: HashSet<String> = blocks
        .iter()
        .filter(|block| block.keyword == "enum")
        .map(|block| block.name.clone())
        .collect();
    let mut schema = ParsedSchema::default();

    for block in blocks {
        if block.keyword == "enum" {
            let mut values = Vec::new();
            let mut mapped_name = None;
            for statement in prisma_statements(&block.body) {
                let statement = statement.trim();
                if let Some(value) = attribute_string(statement, "@@map") {
                    mapped_name = Some(value);
                } else if !statement.is_empty() && !statement.starts_with("//") {
                    if let Some(value) = statement.split_whitespace().next() {
                        values.push(value.to_owned());
                    }
                }
            }
            let qualified = mapped_name.unwrap_or(block.name);
            let (namespace, name) = split_qualified_name(&qualified);
            schema.enums.push(ParsedEnum {
                namespace,
                name,
                values,
            });
            continue;
        }

        let statements = prisma_statements(&block.body);
        let mapped = statements
            .iter()
            .find_map(|line| attribute_string(line, "@@map"));
        let physical = mapped.clone().unwrap_or_else(|| block.name.clone());
        let (namespace, name) = split_qualified_name(&physical);
        let mut table = ParsedTable {
            namespace,
            name,
            orm_symbol: Some(block.name.clone()),
            mapped_name: mapped,
            ..ParsedTable::default()
        };

        for statement in &statements {
            let statement = statement.trim();
            if let Some(columns) = attribute_array(statement, "@@id") {
                table.primary_key = Some(ParsedKey {
                    name: block_attribute_name(statement, "@@id"),
                    columns,
                });
                continue;
            }
            if let Some(columns) = attribute_array(statement, "@@unique") {
                table.unique_constraints.push(ParsedKey {
                    name: block_attribute_name(statement, "@@unique"),
                    columns,
                });
                continue;
            }
            if let Some(columns) = attribute_array(statement, "@@index") {
                let name = block_attribute_name(statement, "@@index")
                    .unwrap_or_else(|| format!("idx_{}_{}", table.name, columns.join("_")));
                table.indexes.push(ParsedIndex {
                    name,
                    columns,
                    unique: false,
                });
                continue;
            }
            if statement.is_empty() || statement.starts_with("//") || statement.starts_with("@@") {
                continue;
            }
            let Some((field_name, field_type, attributes)) = prisma_field(statement) else {
                continue;
            };
            let base_type = field_type.trim_end_matches(['?', '[', ']']);
            if model_names.contains(base_type) {
                // A relation field's arguments live inside `@relation(...)`. The named-argument
                // helpers split on top-level separators, so they must be handed the attribute's
                // inner text rather than the whole attribute string.
                let relation = attribute_argument(attributes, "@relation").unwrap_or_default();
                if let (Some(fields), Some(references)) = (
                    named_argument_array(&relation, "fields"),
                    named_argument_array(&relation, "references"),
                ) {
                    table.foreign_keys.push(ParsedForeignKey {
                        name: named_argument_string(&relation, "map")
                            .or_else(|| named_argument_string(&relation, "name")),
                        columns: fields,
                        referenced_table: base_type.to_owned(),
                        referenced_columns: references,
                        on_delete: referential_action(named_argument_token(&relation, "onDelete")),
                        on_update: referential_action(named_argument_token(&relation, "onUpdate")),
                    });
                }
                continue;
            }
            let mapped_name = attribute_string(attributes, "@map");
            let physical_name = mapped_name.clone().unwrap_or_else(|| field_name.to_owned());
            let nullable = field_type.ends_with('?');
            let default = attribute_argument(attributes, "@default");
            let enum_name = enum_names.contains(base_type).then(|| base_type.to_owned());
            table.columns.push(ParsedColumn {
                name: physical_name.clone(),
                mapped_name,
                native_type: base_type.to_owned(),
                nullable,
                default,
                enum_name,
            });
            if attributes.contains("@id") {
                table.primary_key = Some(ParsedKey {
                    name: attribute_argument(attributes, "@id")
                        .and_then(|inner| named_argument_string(&inner, "map")),
                    columns: vec![physical_name.clone()],
                });
            }
            if attributes.contains("@unique") {
                table.unique_constraints.push(ParsedKey {
                    name: attribute_argument(attributes, "@unique")
                        .and_then(|inner| named_argument_string(&inner, "map")),
                    columns: vec![physical_name],
                });
            }
        }
        schema.tables.push(table);
    }

    let physical_by_symbol: HashMap<String, String> = schema
        .tables
        .iter()
        .filter_map(|table| {
            table
                .orm_symbol
                .clone()
                .map(|symbol| (symbol, qualified_table_name(table)))
        })
        .collect();
    for table in &mut schema.tables {
        for foreign_key in &mut table.foreign_keys {
            if let Some(physical) = physical_by_symbol.get(&foreign_key.referenced_table) {
                foreign_key.referenced_table = physical.clone();
            }
        }
    }
    schema
}

fn parse_drizzle_schema(content: &str) -> ParsedSchema {
    let mut schema = ParsedSchema::default();
    for call in find_factory_calls(content, &["pgEnum", "mysqlEnum"]) {
        let arguments = split_top_level(&call.arguments, ',');
        if let Some(name) = arguments.first().and_then(|value| quoted_value(value)) {
            let values = arguments
                .get(1)
                .map(|value| bracket_values(value))
                .unwrap_or_default();
            schema.enums.push(ParsedEnum {
                namespace: "default".to_owned(),
                name,
                values,
            });
        }
    }

    let mut symbol_to_physical = HashMap::new();
    let mut tables = Vec::new();
    for call in find_factory_calls(content, &["pgTable", "mysqlTable", "sqliteTable"]) {
        let arguments = split_top_level(&call.arguments, ',');
        let Some(physical_name) = arguments.first().and_then(|value| quoted_value(value)) else {
            continue;
        };
        let (namespace, name) = split_qualified_name(&physical_name);
        let symbol = declaration_symbol(content, call.start);
        if let Some(symbol) = &symbol {
            symbol_to_physical.insert(symbol.clone(), format_qualified(&namespace, &name));
        }
        let mut table = ParsedTable {
            namespace,
            name,
            orm_symbol: symbol,
            ..ParsedTable::default()
        };
        if let Some(column_object) = arguments
            .get(1)
            .and_then(|value| outer_group(value, '{', '}'))
        {
            for entry in split_top_level(column_object, ',') {
                let Some((field, expression)) = split_top_level_once(&entry, ':') else {
                    continue;
                };
                let field = unquote_identifier(field.trim());
                let builder = expression
                    .trim()
                    .split(['(', '.'])
                    .next()
                    .unwrap_or("unknown")
                    .trim();
                let physical_column =
                    first_call_string(expression).unwrap_or_else(|| field.to_owned());
                table.columns.push(ParsedColumn {
                    name: physical_column.clone(),
                    mapped_name: (physical_column != field).then_some(physical_column.clone()),
                    native_type: builder.to_owned(),
                    nullable: !expression.contains(".notNull()")
                        && !expression.contains(".primaryKey()"),
                    default: drizzle_default(expression),
                    enum_name: None,
                });
                if expression.contains(".primaryKey()") {
                    table.primary_key = Some(ParsedKey {
                        name: None,
                        columns: vec![physical_column.clone()],
                    });
                }
                if expression.contains(".unique()") {
                    table.unique_constraints.push(ParsedKey {
                        name: None,
                        columns: vec![physical_column.clone()],
                    });
                }
                if let Some((target_table, target_column)) = drizzle_reference(expression) {
                    table.foreign_keys.push(ParsedForeignKey {
                        columns: vec![physical_column],
                        referenced_table: target_table,
                        referenced_columns: vec![target_column],
                        ..ParsedForeignKey::default()
                    });
                }
            }
        }
        if let Some(extra) = arguments.get(2) {
            for index_call in find_factory_calls(extra, &["index", "uniqueIndex"]) {
                let index_args = split_top_level(&index_call.arguments, ',');
                let name = index_args
                    .first()
                    .and_then(|value| quoted_value(value))
                    .unwrap_or_else(|| format!("idx_{}", table.name));
                let after = &extra[index_call.end..];
                let columns = after
                    .find(".on(")
                    .and_then(|position| balanced_slice(after, position + 3, '(', ')'))
                    .map(|value| {
                        split_top_level(value, ',')
                            .into_iter()
                            .filter_map(|item| {
                                item.rsplit('.')
                                    .next()
                                    .map(|part| unquote_identifier(part).to_owned())
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                table.indexes.push(ParsedIndex {
                    name,
                    columns,
                    unique: index_call.factory == "uniqueIndex",
                });
            }
        }
        tables.push(table);
    }
    for table in &mut tables {
        for foreign_key in &mut table.foreign_keys {
            if let Some(physical) = symbol_to_physical.get(&foreign_key.referenced_table) {
                foreign_key.referenced_table = physical.clone();
            }
        }
    }
    schema.tables = tables;
    schema
}

fn parse_sql_schema(content: &str) -> ParsedSchema {
    let mut schema = ParsedSchema::default();
    let statements = sql_statements(content);
    for statement in &statements {
        let normalized = statement.trim();
        let lower = normalized.to_ascii_lowercase();
        if lower.starts_with("create type") && lower.contains(" as enum") {
            if let Some((name, values)) = parse_sql_enum(normalized) {
                let (namespace, name) = split_qualified_name(&name);
                schema.enums.push(ParsedEnum {
                    namespace,
                    name,
                    values,
                });
            }
        } else if lower.starts_with("create table") {
            if let Some(table) = parse_sql_table(normalized) {
                schema.tables.push(table);
            }
        }
    }
    for statement in &statements {
        parse_sql_follow_up(statement, &mut schema.tables);
    }
    schema
}

fn parse_sql_table(statement: &str) -> Option<ParsedTable> {
    let lower = statement.to_ascii_lowercase();
    let prefix_end = lower.find("create table")? + "create table".len();
    let rest = statement[prefix_end..].trim_start();
    let rest = strip_prefix_case_insensitive(rest, "if not exists")
        .unwrap_or(rest)
        .trim_start();
    let open = find_unquoted(rest, '(')?;
    let qualified = unquote_identifier(rest[..open].trim()).to_owned();
    let body = balanced_slice(rest, open, '(', ')')?;
    let (namespace, name) = split_qualified_name(&qualified);
    let mut table = ParsedTable {
        namespace,
        name,
        ..ParsedTable::default()
    };
    for clause in split_top_level(body, ',') {
        parse_sql_table_clause(&clause, &mut table);
    }
    Some(table)
}

fn parse_sql_table_clause(clause: &str, table: &mut ParsedTable) {
    let clause = clause.trim();
    if clause.is_empty() {
        return;
    }
    let lower = clause.to_ascii_lowercase();
    let (constraint_name, remainder) = if lower.starts_with("constraint ") {
        let mut tokens = clause.splitn(3, char::is_whitespace);
        let _ = tokens.next();
        let name = tokens.next().map(unquote_identifier).map(str::to_owned);
        (name, tokens.next().unwrap_or_default())
    } else {
        (None, clause)
    };
    let remainder_lower = remainder.to_ascii_lowercase();
    if remainder_lower.starts_with("primary key") {
        table.primary_key = Some(ParsedKey {
            name: constraint_name,
            columns: parenthesized_identifiers(remainder),
        });
        return;
    }
    if remainder_lower.starts_with("unique") {
        table.unique_constraints.push(ParsedKey {
            name: constraint_name,
            columns: parenthesized_identifiers(remainder),
        });
        return;
    }
    if remainder_lower.starts_with("foreign key") {
        if let Some(foreign_key) = parse_sql_foreign_key(remainder, constraint_name) {
            table.foreign_keys.push(foreign_key);
        }
        return;
    }
    if remainder_lower.starts_with("check") {
        return;
    }

    let mut tokens = sql_tokens(remainder);
    if tokens.len() < 2 {
        return;
    }
    let name = unquote_identifier(&tokens.remove(0)).to_owned();
    let native_type = tokens.remove(0);
    let tail = tokens.join(" ");
    table.columns.push(ParsedColumn {
        name: name.clone(),
        mapped_name: None,
        native_type,
        nullable: !tail.to_ascii_lowercase().contains("not null")
            && !tail.to_ascii_lowercase().contains("primary key"),
        default: sql_default(&tail),
        enum_name: None,
    });
    if tail.to_ascii_lowercase().contains("primary key") {
        table.primary_key = Some(ParsedKey {
            name: constraint_name.clone(),
            columns: vec![name.clone()],
        });
    }
    if tail.to_ascii_lowercase().contains(" unique")
        || tail.to_ascii_lowercase().starts_with("unique")
    {
        table.unique_constraints.push(ParsedKey {
            name: constraint_name.clone(),
            columns: vec![name.clone()],
        });
    }
    if let Some(reference_position) = tail.to_ascii_lowercase().find("references") {
        let reference = &tail[reference_position + "references".len()..];
        let referenced_table = reference
            .split('(')
            .next()
            .map(str::trim)
            .map(unquote_identifier)
            .unwrap_or_default()
            .to_owned();
        let referenced_columns = parenthesized_identifiers(reference);
        table.foreign_keys.push(ParsedForeignKey {
            name: constraint_name,
            columns: vec![name],
            referenced_table,
            referenced_columns,
            on_delete: parse_sql_action(&tail, "on delete"),
            on_update: parse_sql_action(&tail, "on update"),
        });
    }
}

fn parse_sql_foreign_key(value: &str, name: Option<String>) -> Option<ParsedForeignKey> {
    let columns = parenthesized_identifiers(value);
    let lower = value.to_ascii_lowercase();
    let reference_position = lower.find("references")?;
    let reference = value[reference_position + "references".len()..].trim_start();
    let referenced_table = reference
        .split('(')
        .next()
        .map(str::trim)
        .map(unquote_identifier)?
        .to_owned();
    Some(ParsedForeignKey {
        name,
        columns,
        referenced_table,
        referenced_columns: parenthesized_identifiers(reference),
        on_delete: parse_sql_action(value, "on delete"),
        on_update: parse_sql_action(value, "on update"),
    })
}

fn parse_sql_follow_up(statement: &str, tables: &mut [ParsedTable]) {
    let lower = statement.trim().to_ascii_lowercase();
    if lower.starts_with("create index") || lower.starts_with("create unique index") {
        if let Some((table_name, index)) = parse_sql_index(statement) {
            if let Some(table) = tables
                .iter_mut()
                .find(|table| qualified_table_name(table) == table_name || table.name == table_name)
            {
                table.indexes.push(index);
            }
        }
    } else if lower.starts_with("alter table") {
        parse_sql_alter(statement, tables);
    }
}

fn parse_sql_index(statement: &str) -> Option<(String, ParsedIndex)> {
    let tokens = sql_tokens(statement);
    let unique = tokens
        .get(1)
        .is_some_and(|value| value.eq_ignore_ascii_case("unique"));
    let index_position = tokens
        .iter()
        .position(|value| value.eq_ignore_ascii_case("index"))?;
    let name = tokens
        .get(index_position + 1)
        .map(|value| unquote_identifier(value).to_owned())?;
    let on_position = tokens
        .iter()
        .position(|value| value.eq_ignore_ascii_case("on"))?;
    let table_name = tokens
        .get(on_position + 1)
        .map(|value| unquote_identifier(value).to_owned())?;
    Some((
        table_name,
        ParsedIndex {
            name,
            columns: parenthesized_identifiers(statement),
            unique,
        },
    ))
}

fn parse_sql_alter(statement: &str, tables: &mut [ParsedTable]) {
    let tokens = sql_tokens(statement);
    if tokens.len() < 4 {
        return;
    }
    let table_name = unquote_identifier(&tokens[2]);
    let Some(table) = tables
        .iter_mut()
        .find(|table| qualified_table_name(table) == table_name || table.name == table_name)
    else {
        return;
    };
    let lower = statement.to_ascii_lowercase();
    if let Some(position) = lower.find("add column") {
        parse_sql_table_clause(&statement[position + "add column".len()..], table);
    } else if let Some(position) = lower.find("add constraint") {
        parse_sql_table_clause(&statement[position + "add ".len()..], table);
    }
}

fn parse_sql_enum(statement: &str) -> Option<(String, Vec<String>)> {
    let lower = statement.to_ascii_lowercase();
    let type_position = lower.find("create type")? + "create type".len();
    let enum_position = lower.find(" as enum")?;
    let name = unquote_identifier(statement[type_position..enum_position].trim()).to_owned();
    let values = balanced_slice(statement, find_unquoted(statement, '(')?, '(', ')')?
        .split(',')
        .filter_map(quoted_value)
        .collect();
    Some((name, values))
}

#[allow(clippy::too_many_arguments)]
fn add_parsed_schema(
    ctx: &ExtractionContext<'_>,
    evidence: &DatabaseSourceEvidence,
    adapter_id: &DatabaseAdapterId,
    parsed: ParsedSchema,
    graph: &mut ExtractedDatabaseGraph,
    seen_objects: &mut HashSet<String>,
    seen_edges: &mut HashSet<String>,
) {
    let mut namespaces: BTreeSet<String> = parsed
        .tables
        .iter()
        .map(|table| table.namespace.clone())
        .chain(parsed.enums.iter().map(|item| item.namespace.clone()))
        .collect();
    if namespaces.is_empty() {
        namespaces.insert("default".to_owned());
    }
    for namespace in namespaces {
        let namespace_id = semantic_id(ctx, "namespace", &namespace);
        push_object(
            graph,
            seen_objects,
            DatabaseObject::Namespace(DatabaseNamespace {
                meta: meta(&namespace_id, ctx, evidence, &namespace),
                name: namespace,
                catalog_name: None,
                owner: None,
                comment: None,
            }),
            evidence,
        );
    }

    let enum_ids: HashMap<String, String> = parsed
        .enums
        .iter()
        .map(|item| {
            let qualified = format_qualified(&item.namespace, &item.name);
            (item.name.clone(), semantic_id(ctx, "enum", &qualified))
        })
        .collect();
    for item in &parsed.enums {
        let qualified = format_qualified(&item.namespace, &item.name);
        let id = semantic_id(ctx, "enum", &qualified);
        let namespace_id = semantic_id(ctx, "namespace", &item.namespace);
        push_object(
            graph,
            seen_objects,
            DatabaseObject::Enum(Enum {
                meta: meta(&id, ctx, evidence, &qualified),
                namespace_id: namespace_id.clone(),
                name: item.name.clone(),
                values: item
                    .values
                    .iter()
                    .enumerate()
                    .map(|(ordinal, value)| DatabaseEnumValue {
                        name: value.clone(),
                        ordinal: ordinal as u32,
                        mapped_name: None,
                    })
                    .collect(),
            }),
            evidence,
        );
        push_edge(
            graph,
            seen_edges,
            &namespace_id,
            &id,
            DatabaseEdgeType::Contains,
            evidence,
        );
    }

    for table in &parsed.tables {
        add_table(
            ctx,
            evidence,
            adapter_id,
            graph,
            seen_objects,
            seen_edges,
            table,
            &enum_ids,
        );
    }
}

#[allow(clippy::too_many_arguments)]
fn add_table(
    ctx: &ExtractionContext<'_>,
    evidence: &DatabaseSourceEvidence,
    adapter_id: &DatabaseAdapterId,
    graph: &mut ExtractedDatabaseGraph,
    seen_objects: &mut HashSet<String>,
    seen_edges: &mut HashSet<String>,
    table: &ParsedTable,
    enum_ids: &HashMap<String, String>,
) {
    let qualified = qualified_table_name(table);
    let table_id = semantic_id(ctx, "table", &qualified);
    let namespace_id = semantic_id(ctx, "namespace", &table.namespace);
    let column_ids: HashMap<String, String> = table
        .columns
        .iter()
        .map(|column| {
            (
                column.name.clone(),
                semantic_id(ctx, "column", &format!("{}.{}", qualified, column.name)),
            )
        })
        .collect();
    let primary_key_id = table.primary_key.as_ref().map(|key| {
        semantic_id(
            ctx,
            "primary_key",
            &format!("{}:{}", qualified, key_name(key.name.as_ref(), "pk")),
        )
    });
    let foreign_key_ids: Vec<String> = table
        .foreign_keys
        .iter()
        .enumerate()
        .map(|(index, key)| {
            semantic_id(
                ctx,
                "foreign_key",
                &format!(
                    "{}:{}",
                    qualified,
                    key_name(key.name.as_ref(), &format!("fk_{index}"))
                ),
            )
        })
        .collect();
    let unique_ids: Vec<String> = table
        .unique_constraints
        .iter()
        .enumerate()
        .map(|(index, key)| {
            semantic_id(
                ctx,
                "unique_constraint",
                &format!(
                    "{}:{}",
                    qualified,
                    key_name(key.name.as_ref(), &format!("uq_{index}"))
                ),
            )
        })
        .collect();
    let index_ids: Vec<String> = table
        .indexes
        .iter()
        .map(|index| semantic_id(ctx, "index", &format!("{}:{}", qualified, index.name)))
        .collect();

    push_object(
        graph,
        seen_objects,
        DatabaseObject::Table(DatabaseTable {
            meta: meta(&table_id, ctx, evidence, &qualified),
            namespace_id: namespace_id.clone(),
            name: table.name.clone(),
            mapped_name: table.mapped_name.clone(),
            comment: None,
            column_ids: table
                .columns
                .iter()
                .filter_map(|column| column_ids.get(&column.name).cloned())
                .collect(),
            primary_key_id: primary_key_id.clone(),
            foreign_key_ids: foreign_key_ids.clone(),
            unique_constraint_ids: unique_ids.clone(),
            check_constraint_ids: Vec::new(),
            index_ids: index_ids.clone(),
        }),
        evidence,
    );
    push_edge(
        graph,
        seen_edges,
        &namespace_id,
        &table_id,
        DatabaseEdgeType::Contains,
        evidence,
    );

    for (ordinal, column) in table.columns.iter().enumerate() {
        let Some(column_id) = column_ids.get(&column.name).cloned() else {
            continue;
        };
        push_object(
            graph,
            seen_objects,
            DatabaseObject::Column(DatabaseColumn {
                meta: meta(
                    &column_id,
                    ctx,
                    evidence,
                    &format!("{}.{}", qualified, column.name),
                ),
                table_id: table_id.clone(),
                name: column.name.clone(),
                mapped_name: column.mapped_name.clone(),
                ordinal: ordinal as u32 + 1,
                data_type: data_type(&column.native_type, column.enum_name.is_some()),
                native_type: column.native_type.clone(),
                nullable: column.nullable,
                default: column.default.as_ref().map(|value| DatabaseExpression {
                    normalized: normalize_expression(value),
                    dialect: Some(adapter_name(adapter_id).to_owned()),
                }),
                generated: None,
                identity_generation: None,
                enum_id: column
                    .enum_name
                    .as_ref()
                    .and_then(|name| enum_ids.get(name).cloned()),
                comment: None,
            }),
            evidence,
        );
        push_edge(
            graph,
            seen_edges,
            &table_id,
            &column_id,
            DatabaseEdgeType::HasColumn,
            evidence,
        );
    }

    if let (Some(key), Some(key_id)) = (&table.primary_key, primary_key_id) {
        push_object(
            graph,
            seen_objects,
            DatabaseObject::PrimaryKey(PrimaryKey {
                meta: meta(
                    &key_id,
                    ctx,
                    evidence,
                    &format!("{}:{}", qualified, key_name(key.name.as_ref(), "pk")),
                ),
                table_id: table_id.clone(),
                name: key.name.clone(),
                column_ids: key
                    .columns
                    .iter()
                    .filter_map(|column| column_ids.get(column).cloned())
                    .collect(),
                clustered: None,
            }),
            evidence,
        );
        push_edge(
            graph,
            seen_edges,
            &table_id,
            &key_id,
            DatabaseEdgeType::PrimaryKey,
            evidence,
        );
    }

    for (position, key) in table.foreign_keys.iter().enumerate() {
        let key_id = foreign_key_ids[position].clone();
        let target_id = semantic_id(
            ctx,
            "table",
            &normalize_qualified_target(&key.referenced_table, &table.namespace),
        );
        let target_columns = key
            .referenced_columns
            .iter()
            .map(|column| {
                semantic_id(
                    ctx,
                    "column",
                    &format!(
                        "{}.{}",
                        normalize_qualified_target(&key.referenced_table, &table.namespace),
                        column
                    ),
                )
            })
            .collect();
        push_object(
            graph,
            seen_objects,
            DatabaseObject::ForeignKey(ForeignKey {
                meta: meta(
                    &key_id,
                    ctx,
                    evidence,
                    &format!(
                        "{}:{}",
                        qualified,
                        key_name(key.name.as_ref(), &format!("fk_{position}"))
                    ),
                ),
                table_id: table_id.clone(),
                name: key.name.clone(),
                column_ids: key
                    .columns
                    .iter()
                    .filter_map(|column| column_ids.get(column).cloned())
                    .collect(),
                referenced_table_id: target_id.clone(),
                referenced_column_ids: target_columns,
                on_delete: key.on_delete.clone(),
                on_update: key.on_update.clone(),
                deferrable: None,
            }),
            evidence,
        );
        push_edge(
            graph,
            seen_edges,
            &table_id,
            &target_id,
            DatabaseEdgeType::References,
            evidence,
        );
    }

    for (position, key) in table.unique_constraints.iter().enumerate() {
        let key_id = unique_ids[position].clone();
        push_object(
            graph,
            seen_objects,
            DatabaseObject::UniqueConstraint(UniqueConstraint {
                meta: meta(
                    &key_id,
                    ctx,
                    evidence,
                    &format!(
                        "{}:{}",
                        qualified,
                        key_name(key.name.as_ref(), &format!("uq_{position}"))
                    ),
                ),
                table_id: table_id.clone(),
                name: key.name.clone(),
                column_ids: key
                    .columns
                    .iter()
                    .filter_map(|column| column_ids.get(column).cloned())
                    .collect(),
                nulls_distinct: None,
            }),
            evidence,
        );
        push_edge(
            graph,
            seen_edges,
            &table_id,
            &key_id,
            DatabaseEdgeType::Contains,
            evidence,
        );
    }

    for index in &table.indexes {
        let index_id = semantic_id(ctx, "index", &format!("{}:{}", qualified, index.name));
        push_object(
            graph,
            seen_objects,
            DatabaseObject::Index(Index {
                meta: meta(
                    &index_id,
                    ctx,
                    evidence,
                    &format!("{}:{}", qualified, index.name),
                ),
                table_id: table_id.clone(),
                name: index.name.clone(),
                unique: index.unique,
                method: None,
                keys: index
                    .columns
                    .iter()
                    .map(|column| IndexKey {
                        column_id: column_ids.get(column).cloned(),
                        // An index key that does not resolve to a column is an expression index.
                        expression: (!column_ids.contains_key(column)).then(|| {
                            DatabaseExpression {
                                normalized: normalize_expression(column),
                                dialect: Some(adapter_name(adapter_id).to_owned()),
                            }
                        }),
                        direction: None,
                        nulls: None,
                    })
                    .collect(),
                included_column_ids: Vec::new(),
                predicate: None,
            }),
            evidence,
        );
        push_edge(
            graph,
            seen_edges,
            &table_id,
            &index_id,
            DatabaseEdgeType::Indexes,
            evidence,
        );
    }

    if let Some(symbol) = &table.orm_symbol {
        let orm_id = semantic_id(
            ctx,
            "orm_model",
            &format!("{}:{}", evidence.relative_path, symbol),
        );
        push_object(
            graph,
            seen_objects,
            DatabaseObject::OrmModel(OrmModel {
                meta: meta(&orm_id, ctx, evidence, symbol),
                adapter_id: adapter_id.clone(),
                project_id: ctx.project_id.to_owned(),
                relative_path: evidence.relative_path.clone(),
                symbol: symbol.clone(),
                mapped_table_id: Some(table_id.clone()),
                field_mappings: table
                    .columns
                    .iter()
                    .map(|column| OrmFieldMapping {
                        field_name: column
                            .mapped_name
                            .clone()
                            .unwrap_or_else(|| column.name.clone()),
                        column_id: column_ids.get(&column.name).cloned(),
                        mapped_name: column.mapped_name.clone(),
                    })
                    .collect(),
            }),
            evidence,
        );
        push_edge(
            graph,
            seen_edges,
            &orm_id,
            &table_id,
            DatabaseEdgeType::MapsTo,
            evidence,
        );
    }
}

fn add_migration(
    ctx: &ExtractionContext<'_>,
    evidence: &DatabaseSourceEvidence,
    graph: &mut ExtractedDatabaseGraph,
    seen_objects: &mut HashSet<String>,
) {
    let name = Path::new(&evidence.relative_path)
        .parent()
        .and_then(Path::file_name)
        .and_then(|value| value.to_str())
        .unwrap_or(&evidence.relative_path)
        .to_owned();
    let id = semantic_id(ctx, "migration", &evidence.relative_path);
    push_object(
        graph,
        seen_objects,
        DatabaseObject::Migration(DatabaseMigration {
            meta: meta(&id, ctx, evidence, &name),
            source_id: ctx.source.id.clone(),
            name,
            relative_path: evidence.relative_path.clone(),
            sequence: migration_sequence(&evidence.relative_path),
            checksum: evidence.content_sha256.clone(),
            parent_migration_ids: Vec::new(),
            operation_kinds: migration_operation_kinds(ctx.project_root, evidence),
            applied_state: MigrationAppliedState::DeclaredOnly,
        }),
        evidence,
    );
}

fn push_object(
    graph: &mut ExtractedDatabaseGraph,
    seen: &mut HashSet<String>,
    object: DatabaseObject,
    evidence: &DatabaseSourceEvidence,
) {
    let id = object.meta().identity.id.clone();
    if !seen.insert(id.clone()) {
        return;
    }
    let provenance_id = stable_id("prov", &[&evidence.id, &id]);
    graph.provenance.push(DatabaseObjectProvenance {
        id: provenance_id,
        object_id: id,
        source_kind: adapter_name(&evidence.adapter_id).to_owned(),
        certainty: evidence.certainty.clone(),
        confidence: evidence.confidence,
        evidence_ref: Some(evidence.relative_path.clone()),
        extractor_version: evidence.extractor_version.clone(),
        observed_at: evidence.discovered_at.clone(),
    });
    graph.objects.push(object);
}

fn push_edge(
    graph: &mut ExtractedDatabaseGraph,
    seen: &mut HashSet<String>,
    source: &str,
    target: &str,
    edge_type: DatabaseEdgeType,
    evidence: &DatabaseSourceEvidence,
) {
    let id = stable_id("edge", &[source, target, edge_name(&edge_type)]);
    if !seen.insert(id.clone()) {
        return;
    }
    graph.edges.push(DatabaseEdge {
        id,
        source_object_id: source.to_owned(),
        target_object_id: target.to_owned(),
        edge_type,
        snapshot_id: None,
        design_revision_id: None,
        confidence: evidence.confidence,
        provenance_ids: vec![stable_id("prov", &[&evidence.id, source])],
        created_at: evidence.discovered_at.clone(),
    });
}

fn meta(
    id: &str,
    ctx: &ExtractionContext<'_>,
    evidence: &DatabaseSourceEvidence,
    qualified_name: &str,
) -> DatabaseObjectMeta {
    DatabaseObjectMeta {
        identity: SemanticIdentity {
            id: id.to_owned(),
            logical_key: qualified_name.to_owned(),
            qualified_name: qualified_name.to_owned(),
            previous_ids: Vec::new(),
        },
        source_id: ctx.source.id.clone(),
        layer: DatabaseLayer::Declared,
        snapshot_id: None,
        design_revision_id: None,
        confidence: evidence.confidence,
        provenance_ids: vec![stable_id("prov", &[&evidence.id, id])],
        discovered_at: evidence.discovered_at.clone(),
        observed_at: evidence.discovered_at.clone(),
        updated_at: evidence.discovered_at.clone(),
        content_fingerprint: stable_id("fp", &[id, qualified_name, &evidence.content_sha256]),
    }
}

fn data_type(native: &str, is_enum: bool) -> DatabaseDataType {
    let normalized = native.trim().to_ascii_lowercase();
    let family = if is_enum {
        DatabaseTypeFamily::Enum
    } else if normalized.contains("bool") {
        DatabaseTypeFamily::Boolean
    } else if normalized.contains("bigint")
        || normalized == "int"
        || normalized.contains("integer")
        || normalized.contains("serial")
    {
        DatabaseTypeFamily::Integer
    } else if normalized.contains("decimal") || normalized.contains("numeric") {
        DatabaseTypeFamily::Decimal
    } else if normalized.contains("float") || normalized.contains("double") || normalized == "real"
    {
        DatabaseTypeFamily::Float
    } else if normalized.contains("timestamp") || normalized.contains("datetime") {
        DatabaseTypeFamily::DateTime
    } else if normalized == "date" {
        DatabaseTypeFamily::Date
    } else if normalized == "time" {
        DatabaseTypeFamily::Time
    } else if normalized.contains("json") {
        DatabaseTypeFamily::Json
    } else if normalized.contains("uuid") {
        DatabaseTypeFamily::Uuid
    } else if normalized.contains("blob") || normalized.contains("binary") || normalized == "bytes"
    {
        DatabaseTypeFamily::Binary
    } else {
        DatabaseTypeFamily::Text
    };
    let (length, precision, scale) = numeric_parameters(native);
    DatabaseDataType {
        family,
        length,
        precision,
        scale,
        array_dimensions: native.matches("[]").count().min(u8::MAX as usize) as u8,
        unsigned: normalized.contains("unsigned"),
    }
}

fn named_blocks(content: &str, keywords: &[&str]) -> Vec<NamedBlock> {
    let bytes = content.as_bytes();
    let mut blocks = Vec::new();
    let mut index = 0;
    while index < bytes.len() {
        skip_space_and_comments(content, &mut index);
        let Some(keyword) = keywords
            .iter()
            .find(|keyword| word_at(content, index, keyword))
        else {
            index += next_char_len(content, index);
            continue;
        };
        index += keyword.len();
        skip_space_and_comments(content, &mut index);
        let Some((name, after_name)) = identifier_at(content, index) else {
            continue;
        };
        index = after_name;
        skip_space_and_comments(content, &mut index);
        let Some(open) = content[index..].find('{').map(|offset| index + offset) else {
            break;
        };
        let Some(body) = balanced_slice(content, open, '{', '}') else {
            break;
        };
        let end = open + body.len() + 2;
        blocks.push(NamedBlock {
            keyword: (*keyword).to_owned(),
            name,
            body: body.to_owned(),
        });
        index = end;
    }
    blocks
}

#[derive(Debug)]
struct NamedBlock {
    keyword: String,
    name: String,
    body: String,
}

#[derive(Debug)]
struct FactoryCall {
    factory: String,
    arguments: String,
    start: usize,
    end: usize,
}

fn find_factory_calls(content: &str, factories: &[&str]) -> Vec<FactoryCall> {
    let mut calls = Vec::new();
    let mut index = 0;
    while index < content.len() {
        let Some(factory) = factories
            .iter()
            .find(|factory| word_at(content, index, factory))
        else {
            index += next_char_len(content, index);
            continue;
        };
        let mut open = index + factory.len();
        while open < content.len() && content.as_bytes()[open].is_ascii_whitespace() {
            open += 1;
        }
        if open >= content.len() || content.as_bytes()[open] != b'(' {
            index += factory.len();
            continue;
        }
        let Some(arguments) = balanced_slice(content, open, '(', ')') else {
            break;
        };
        let end = open + arguments.len() + 2;
        calls.push(FactoryCall {
            factory: (*factory).to_owned(),
            arguments: arguments.to_owned(),
            start: index,
            end,
        });
        index = end;
    }
    calls
}

fn balanced_slice(content: &str, open_index: usize, open: char, close: char) -> Option<&str> {
    if content[open_index..].chars().next()? != open {
        return None;
    }
    let mut depth = 0usize;
    let mut quote = None;
    let mut escaped = false;
    let mut line_comment = false;
    let mut block_comment = false;
    let mut start = None;
    let mut iterator = content[open_index..].char_indices().peekable();
    while let Some((offset, character)) = iterator.next() {
        let absolute = open_index + offset;
        if line_comment {
            if character == '\n' {
                line_comment = false;
            }
            continue;
        }
        if block_comment {
            if character == '*' && iterator.peek().is_some_and(|(_, next)| *next == '/') {
                iterator.next();
                block_comment = false;
            }
            continue;
        }
        if let Some(active_quote) = quote {
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == active_quote {
                quote = None;
            }
            continue;
        }
        if character == '/' && iterator.peek().is_some_and(|(_, next)| *next == '/') {
            iterator.next();
            line_comment = true;
            continue;
        }
        if character == '/' && iterator.peek().is_some_and(|(_, next)| *next == '*') {
            iterator.next();
            block_comment = true;
            continue;
        }
        if matches!(character, '\'' | '"' | '`') {
            quote = Some(character);
            continue;
        }
        if character == open {
            depth += 1;
            if depth == 1 {
                start = Some(absolute + character.len_utf8());
            }
        } else if character == close {
            depth = depth.checked_sub(1)?;
            if depth == 0 {
                return Some(&content[start?..absolute]);
            }
        }
    }
    None
}

fn split_top_level(content: &str, separator: char) -> Vec<String> {
    let mut parts = Vec::new();
    let mut start = 0;
    let mut round = 0i32;
    let mut square = 0i32;
    let mut curly = 0i32;
    let mut quote = None;
    let mut escaped = false;
    for (index, character) in content.char_indices() {
        if let Some(active_quote) = quote {
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == active_quote {
                quote = None;
            }
            continue;
        }
        if matches!(character, '\'' | '"' | '`') {
            quote = Some(character);
            continue;
        }
        match character {
            '(' => round += 1,
            ')' => round -= 1,
            '[' => square += 1,
            ']' => square -= 1,
            '{' => curly += 1,
            '}' => curly -= 1,
            value if value == separator && round == 0 && square == 0 && curly == 0 => {
                parts.push(content[start..index].to_owned());
                start = index + value.len_utf8();
            }
            _ => {}
        }
    }
    parts.push(content[start..].to_owned());
    parts
}

fn split_top_level_once(content: &str, separator: char) -> Option<(&str, &str)> {
    let mut round = 0i32;
    let mut square = 0i32;
    let mut curly = 0i32;
    let mut quote = None;
    let mut escaped = false;
    for (index, character) in content.char_indices() {
        if let Some(active_quote) = quote {
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == active_quote {
                quote = None;
            }
            continue;
        }
        if matches!(character, '\'' | '"' | '`') {
            quote = Some(character);
            continue;
        }
        match character {
            '(' => round += 1,
            ')' => round -= 1,
            '[' => square += 1,
            ']' => square -= 1,
            '{' => curly += 1,
            '}' => curly -= 1,
            value if value == separator && round == 0 && square == 0 && curly == 0 => {
                return Some((&content[..index], &content[index + value.len_utf8()..]));
            }
            _ => {}
        }
    }
    None
}

fn sql_statements(content: &str) -> Vec<String> {
    let mut statements = Vec::new();
    let mut start = 0;
    let mut quote = None;
    let mut escaped = false;
    let mut line_comment = false;
    let mut block_comment = false;
    let mut dollar_tag: Option<String> = None;
    let bytes = content.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        let character = content[index..].chars().next().unwrap();
        let char_len = character.len_utf8();
        if line_comment {
            if character == '\n' {
                line_comment = false;
            }
            index += char_len;
            continue;
        }
        if block_comment {
            if content[index..].starts_with("*/") {
                block_comment = false;
                index += 2;
            } else {
                index += char_len;
            }
            continue;
        }
        if let Some(tag) = &dollar_tag {
            if content[index..].starts_with(tag) {
                index += tag.len();
                dollar_tag = None;
            } else {
                index += char_len;
            }
            continue;
        }
        if let Some(active_quote) = quote {
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == active_quote {
                quote = None;
            }
            index += char_len;
            continue;
        }
        if content[index..].starts_with("--") {
            line_comment = true;
            index += 2;
            continue;
        }
        if content[index..].starts_with("/*") {
            block_comment = true;
            index += 2;
            continue;
        }
        if character == '$' {
            if let Some(end) = content[index + 1..].find('$') {
                let candidate = &content[index..=index + end + 1];
                if candidate[1..candidate.len() - 1]
                    .chars()
                    .all(|value| value.is_ascii_alphanumeric() || value == '_')
                {
                    dollar_tag = Some(candidate.to_owned());
                    index += candidate.len();
                    continue;
                }
            }
        }
        if matches!(character, '\'' | '"' | '`') {
            quote = Some(character);
        } else if character == ';' {
            let statement = content[start..index].trim();
            if !statement.is_empty() {
                statements.push(statement.to_owned());
            }
            start = index + 1;
        }
        index += char_len;
    }
    let tail = content[start..].trim();
    if !tail.is_empty() {
        statements.push(tail.to_owned());
    }
    statements
}

fn prisma_statements(body: &str) -> Vec<String> {
    let mut statements = Vec::new();
    let mut current = String::new();
    let mut round = 0i32;
    let mut square = 0i32;
    let mut quote = None;
    let mut escaped = false;
    for character in body.chars() {
        if let Some(active_quote) = quote {
            current.push(character);
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == active_quote {
                quote = None;
            }
            continue;
        }
        if matches!(character, '\'' | '"') {
            quote = Some(character);
            current.push(character);
            continue;
        }
        match character {
            '(' => round += 1,
            ')' => round -= 1,
            '[' => square += 1,
            ']' => square -= 1,
            '\n' if round == 0 && square == 0 => {
                if !current.trim().is_empty() {
                    statements.push(current.trim().to_owned());
                }
                current.clear();
                continue;
            }
            _ => {}
        }
        current.push(character);
    }
    if !current.trim().is_empty() {
        statements.push(current.trim().to_owned());
    }
    statements
}

/// The declared name of a Prisma block attribute, e.g. `@@index([email], name: "user_email_idx")`.
/// Prisma accepts either `name:` or `map:`; both identify the constraint in the database.
fn block_attribute_name(statement: &str, attribute: &str) -> Option<String> {
    let inner = attribute_argument(statement, attribute)?;
    named_argument_string(&inner, "name").or_else(|| named_argument_string(&inner, "map"))
}

fn prisma_field(statement: &str) -> Option<(&str, &str, &str)> {
    let mut split = statement
        .splitn(3, char::is_whitespace)
        .filter(|value| !value.is_empty());
    let name = split.next()?;
    let field_type = split.next()?;
    let attributes = split.next().unwrap_or_default();
    Some((name, field_type, attributes))
}

fn attribute_string(content: &str, attribute: &str) -> Option<String> {
    attribute_argument(content, attribute).and_then(|value| quoted_value(&value))
}

fn attribute_argument(content: &str, attribute: &str) -> Option<String> {
    let position = content.find(attribute)? + attribute.len();
    let open = content[position..].find('(')? + position;
    balanced_slice(content, open, '(', ')')
        .map(str::trim)
        .map(str::to_owned)
}

fn attribute_array(content: &str, attribute: &str) -> Option<Vec<String>> {
    let argument = attribute_argument(content, attribute)?;
    named_argument_array(&argument, "fields").or_else(|| {
        let open = argument.find('[')?;
        balanced_slice(&argument, open, '[', ']').map(identifier_list)
    })
}

fn named_argument_array(content: &str, name: &str) -> Option<Vec<String>> {
    let value = named_argument(content, name)?;
    let open = value.find('[')?;
    balanced_slice(value, open, '[', ']').map(identifier_list)
}

fn named_argument_string(content: &str, name: &str) -> Option<String> {
    named_argument(content, name).and_then(quoted_value)
}

fn named_argument_token<'a>(content: &'a str, name: &str) -> Option<&'a str> {
    named_argument(content, name).map(|value| value.trim_matches([',', ' ']))
}

fn named_argument<'a>(content: &'a str, name: &str) -> Option<&'a str> {
    for argument in split_top_level(content, ',') {
        let Some((key, value)) = split_top_level_once(&argument, ':') else {
            continue;
        };
        if key.trim() == name {
            let start = content.find(value.trim())?;
            return Some(&content[start..start + value.trim().len()]);
        }
    }
    None
}

fn identifier_list(value: &str) -> Vec<String> {
    split_top_level(value, ',')
        .into_iter()
        .map(|item| {
            item.split_whitespace()
                .next()
                .unwrap_or_default()
                .to_owned()
        })
        .filter(|item| !item.is_empty())
        .collect()
}

fn find_unquoted(content: &str, needle: char) -> Option<usize> {
    let mut quote = None;
    let mut escaped = false;
    for (index, character) in content.char_indices() {
        if let Some(active_quote) = quote {
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == active_quote {
                quote = None;
            }
        } else if matches!(character, '\'' | '"' | '`') {
            quote = Some(character);
        } else if character == needle {
            return Some(index);
        }
    }
    None
}

fn parenthesized_identifiers(value: &str) -> Vec<String> {
    find_unquoted(value, '(')
        .and_then(|open| balanced_slice(value, open, '(', ')'))
        .map(identifier_list)
        .unwrap_or_default()
}

fn outer_group(value: &str, open: char, close: char) -> Option<&str> {
    let index = value.find(open)?;
    balanced_slice(value, index, open, close)
}

fn quoted_value(value: &str) -> Option<String> {
    let trimmed = value.trim();
    let quote = trimmed.chars().next()?;
    if !matches!(quote, '\'' | '"' | '`') {
        return None;
    }
    let mut escaped = false;
    for (offset, character) in trimmed[quote.len_utf8()..].char_indices() {
        if escaped {
            escaped = false;
        } else if character == '\\' {
            escaped = true;
        } else if character == quote {
            return Some(trimmed[quote.len_utf8()..quote.len_utf8() + offset].to_owned());
        }
    }
    None
}

fn bracket_values(value: &str) -> Vec<String> {
    value
        .find('[')
        .and_then(|open| balanced_slice(value, open, '[', ']'))
        .map(|inner| {
            split_top_level(inner, ',')
                .into_iter()
                .filter_map(|item| quoted_value(&item))
                .collect()
        })
        .unwrap_or_default()
}

fn declaration_symbol(content: &str, factory_start: usize) -> Option<String> {
    let prefix = &content[..factory_start];
    let statement_start = prefix
        .rfind([';', '\n'])
        .map(|position| position + 1)
        .unwrap_or(0);
    let declaration = prefix[statement_start..].trim();
    let equal = declaration.rfind('=')?;
    declaration[..equal]
        .split_whitespace()
        .last()
        .map(unquote_identifier)
        .map(str::to_owned)
}

fn first_call_string(expression: &str) -> Option<String> {
    let open = expression.find('(')?;
    balanced_slice(expression, open, '(', ')').and_then(quoted_value)
}

fn drizzle_reference(expression: &str) -> Option<(String, String)> {
    let position = expression.find(".references")?;
    let open = expression[position..].find('(')? + position;
    let callback = balanced_slice(expression, open, '(', ')')?;
    let arrow = callback.find("=>")?;
    let target = callback[arrow + 2..].trim();
    let mut parts = target.split('.');
    Some((
        unquote_identifier(parts.next()?.trim()).to_owned(),
        unquote_identifier(
            parts
                .next()?
                .trim_matches(|value: char| !value.is_ascii_alphanumeric() && value != '_'),
        )
        .to_owned(),
    ))
}

fn drizzle_default(expression: &str) -> Option<String> {
    [".default(", ".defaultNow(", ".defaultRandom("]
        .iter()
        .find_map(|needle| {
            let position = expression.find(needle)?;
            let open = position + needle.len() - 1;
            balanced_slice(expression, open, '(', ')').map(|value| {
                if value.trim().is_empty() {
                    needle.trim_matches(['.', '(']).to_owned()
                } else {
                    value.trim().to_owned()
                }
            })
        })
}

fn sql_tokens(content: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut quote = None;
    let mut escaped = false;
    for character in content.chars() {
        if let Some(active_quote) = quote {
            current.push(character);
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == active_quote {
                quote = None;
            }
            continue;
        }
        if matches!(character, '\'' | '"' | '`') {
            quote = Some(character);
            current.push(character);
        } else if character.is_whitespace() || matches!(character, '(' | ')' | ',') {
            if !current.is_empty() {
                tokens.push(std::mem::take(&mut current));
            }
        } else {
            current.push(character);
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

fn sql_default(tail: &str) -> Option<String> {
    let lower = tail.to_ascii_lowercase();
    let position = lower.find("default")? + "default".len();
    let value = tail[position..].trim_start();
    let end = [
        " not null",
        " null",
        " unique",
        " primary key",
        " references",
        " check",
    ]
    .iter()
    .filter_map(|needle| value.to_ascii_lowercase().find(needle))
    .min()
    .unwrap_or(value.len());
    Some(value[..end].trim().to_owned()).filter(|value| !value.is_empty())
}

fn parse_sql_action(content: &str, marker: &str) -> ReferentialAction {
    let lower = content.to_ascii_lowercase();
    let Some(position) = lower.find(marker) else {
        return ReferentialAction::NoAction;
    };
    referential_action(
        lower[position + marker.len()..]
            .split_whitespace()
            .take(2)
            .collect::<Vec<_>>()
            .join(" ")
            .split(',')
            .next(),
    )
}

fn referential_action(value: Option<&str>) -> ReferentialAction {
    match value
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "cascade" => ReferentialAction::Cascade,
        "restrict" => ReferentialAction::Restrict,
        "set null" | "setnull" => ReferentialAction::SetNull,
        "set default" | "setdefault" => ReferentialAction::SetDefault,
        _ => ReferentialAction::NoAction,
    }
}

fn migration_operation_kinds(
    root: &Path,
    evidence: &DatabaseSourceEvidence,
) -> Vec<DatabaseChangeKind> {
    let Ok(path) = guarded_evidence_path(root, &evidence.relative_path) else {
        return Vec::new();
    };
    let Ok(content) = fs::read_to_string(path) else {
        return Vec::new();
    };
    let lower = strip_sql_comments(&content).to_ascii_lowercase();
    let mut kinds = Vec::new();
    if lower.contains("create ") || lower.contains("add ") {
        kinds.push(DatabaseChangeKind::Add);
    }
    if lower.contains("drop ") {
        kinds.push(DatabaseChangeKind::Drop);
    }
    if lower.contains("rename ") {
        kinds.push(DatabaseChangeKind::Rename);
    }
    if lower.contains("alter ") {
        kinds.push(DatabaseChangeKind::Alter);
    }
    kinds.sort_by_key(|kind| format!("{kind:?}"));
    kinds.dedup();
    kinds
}

fn migration_sequence(relative: &str) -> Option<i64> {
    Path::new(relative)
        .parent()
        .and_then(Path::file_name)
        .and_then(|value| value.to_str())
        .and_then(|value| {
            value
                .split(|character: char| !character.is_ascii_digit())
                .next()
        })
        .filter(|value| !value.is_empty())
        .and_then(|value| value.parse().ok())
}

fn datasource_env(content: &str) -> Option<String> {
    content
        .find("env(")
        .and_then(|position| quoted_value(&content[position + 4..]))
}

fn block_name(content: &str, keyword: &str) -> Option<String> {
    let position = content.find(keyword)? + keyword.len();
    content[position..]
        .split_whitespace()
        .next()
        .map(str::to_owned)
}

fn strip_sql_comments(content: &str) -> String {
    let mut output = String::new();
    let mut line_comment = false;
    let mut block_comment = false;
    let mut iterator = content.chars().peekable();
    while let Some(character) = iterator.next() {
        if line_comment {
            if character == '\n' {
                line_comment = false;
                output.push(character);
            }
        } else if block_comment {
            if character == '*' && iterator.peek() == Some(&'/') {
                iterator.next();
                block_comment = false;
            }
        } else if character == '-' && iterator.peek() == Some(&'-') {
            iterator.next();
            line_comment = true;
        } else if character == '/' && iterator.peek() == Some(&'*') {
            iterator.next();
            block_comment = true;
        } else {
            output.push(character);
        }
    }
    output
}

fn word_at(content: &str, index: usize, word: &str) -> bool {
    if !content[index..].starts_with(word) {
        return false;
    }
    let before = content[..index].chars().next_back();
    let after = content[index + word.len()..].chars().next();
    !before.is_some_and(is_identifier_character) && !after.is_some_and(is_identifier_character)
}

fn identifier_at(content: &str, index: usize) -> Option<(String, usize)> {
    let mut end = index;
    for character in content[index..].chars() {
        if !is_identifier_character(character) {
            break;
        }
        end += character.len_utf8();
    }
    (end > index).then(|| (content[index..end].to_owned(), end))
}

fn skip_space_and_comments(content: &str, index: &mut usize) {
    loop {
        while *index < content.len() {
            let character = content[*index..].chars().next().unwrap();
            if !character.is_whitespace() {
                break;
            }
            *index += character.len_utf8();
        }
        if content[*index..].starts_with("//") {
            *index += content[*index..]
                .find('\n')
                .unwrap_or(content.len() - *index);
        } else if content[*index..].starts_with("/*") {
            *index += content[*index + 2..]
                .find("*/")
                .map(|value| value + 4)
                .unwrap_or(content.len() - *index);
        } else {
            break;
        }
    }
}

fn next_char_len(content: &str, index: usize) -> usize {
    content[index..]
        .chars()
        .next()
        .map(char::len_utf8)
        .unwrap_or(1)
}

fn is_identifier_character(value: char) -> bool {
    value.is_ascii_alphanumeric() || matches!(value, '_' | '$')
}

fn is_primary_schema_path(relative: &str) -> bool {
    let lower = relative.to_ascii_lowercase();
    lower.ends_with("schema.prisma")
        || lower.ends_with("schema.ts")
        || lower.ends_with("schema.sql")
}

fn is_sqlite_path(relative: &str) -> bool {
    let lower = relative.to_ascii_lowercase();
    lower.ends_with(".db") || lower.ends_with(".sqlite") || lower.ends_with(".sqlite3")
}

/// Project-relative form of an absolute path.
///
/// `candidate_files` canonicalizes as it walks, which on Windows yields a verbatim-prefixed path
/// that does not share a prefix with the caller's root string. Stripping against both forms keeps
/// every evidence path repository-relative, which everything downstream — provenance, the path
/// guard, and generated migration locations — depends on.
fn relative_path(root: &Path, path: &Path) -> String {
    if let Ok(canonical_root) = root.canonicalize() {
        if let Ok(stripped) = path.strip_prefix(&canonical_root) {
            return stripped.to_string_lossy().replace('\\', "/");
        }
    }
    legacy_relative_path(root, path)
}

fn legacy_relative_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn split_qualified_name(value: &str) -> (String, String) {
    let cleaned = value.trim().trim_matches(['`', '"', '[', ']']);
    cleaned
        .rsplit_once('.')
        .map(|(namespace, name)| {
            (
                unquote_identifier(namespace).to_owned(),
                unquote_identifier(name).to_owned(),
            )
        })
        .unwrap_or_else(|| ("default".to_owned(), unquote_identifier(cleaned).to_owned()))
}

fn qualified_table_name(table: &ParsedTable) -> String {
    format_qualified(&table.namespace, &table.name)
}

fn format_qualified(namespace: &str, name: &str) -> String {
    if namespace == "default" || namespace.is_empty() {
        name.to_owned()
    } else {
        format!("{namespace}.{name}")
    }
}

fn normalize_qualified_target(target: &str, current_namespace: &str) -> String {
    if target.contains('.') || current_namespace == "default" {
        target.to_owned()
    } else {
        format!("{current_namespace}.{target}")
    }
}

fn unquote_identifier(value: &str) -> &str {
    value.trim().trim_matches(['`', '"', '[', ']'])
}

fn strip_prefix_case_insensitive<'a>(value: &'a str, prefix: &str) -> Option<&'a str> {
    value
        .get(..prefix.len())
        .filter(|head| head.eq_ignore_ascii_case(prefix))
        .map(|_| &value[prefix.len()..])
}

fn normalize_expression(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn numeric_parameters(native: &str) -> (Option<u32>, Option<u32>, Option<u32>) {
    let Some(open) = native.find('(') else {
        return (None, None, None);
    };
    let Some(parameters) = balanced_slice(native, open, '(', ')') else {
        return (None, None, None);
    };
    let values: Vec<u32> = parameters
        .split(',')
        .filter_map(|value| value.trim().parse().ok())
        .collect();
    match values.as_slice() {
        [length] => (Some(*length), None, None),
        [precision, scale] => (None, Some(*precision), Some(*scale)),
        _ => (None, None, None),
    }
}

/// Constraint identity name: the declared name when the schema gave one, otherwise a stable
/// position-derived fallback. Shared by primary keys, foreign keys, and unique constraints, none of
/// which are required to be named in every supported dialect.
fn key_name(name: Option<&String>, fallback: &str) -> String {
    name.cloned().unwrap_or_else(|| fallback.to_owned())
}

fn edge_name(edge_type: &DatabaseEdgeType) -> &'static str {
    match edge_type {
        DatabaseEdgeType::Contains => "CONTAINS",
        DatabaseEdgeType::HasColumn => "HAS_COLUMN",
        DatabaseEdgeType::PrimaryKey => "PRIMARY_KEY",
        DatabaseEdgeType::References => "REFERENCES",
        DatabaseEdgeType::Indexes => "INDEXES",
        DatabaseEdgeType::MapsTo => "MAPS_TO",
        DatabaseEdgeType::DeclaredBy => "DECLARED_BY",
        DatabaseEdgeType::CreatedByMigration => "CREATED_BY_MIGRATION",
        DatabaseEdgeType::OwnedBy => "OWNED_BY",
        DatabaseEdgeType::UsedBy => "USED_BY",
        DatabaseEdgeType::ReadBy => "READ_BY",
        DatabaseEdgeType::WrittenBy => "WRITTEN_BY",
        DatabaseEdgeType::DependsOn => "DEPENDS_ON",
    }
}

fn adapter_name(adapter_id: &DatabaseAdapterId) -> &'static str {
    match adapter_id {
        DatabaseAdapterId::Prisma => "prisma",
        DatabaseAdapterId::Drizzle => "drizzle",
        DatabaseAdapterId::RawSql => "raw_sql",
        DatabaseAdapterId::Sqlite => "sqlite",
        DatabaseAdapterId::Postgres => "postgres",
        DatabaseAdapterId::Mysql => "mysql",
    }
}

fn referential_default() -> ReferentialAction {
    ReferentialAction::NoAction
}

impl Default for ReferentialAction {
    fn default() -> Self {
        referential_default()
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn stable_id(prefix: &str, parts: &[&str]) -> String {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update(part.as_bytes());
        hasher.update(b"\0");
    }
    format!("{prefix}:{:x}", hasher.finalize())
}

fn semantic_id(ctx: &ExtractionContext<'_>, kind: &str, key: &str) -> String {
    stable_id(
        &format!("db:{kind}"),
        &[ctx.repository_id, &ctx.source.logical_key, key],
    )
}

pub fn registered_v1_adapters() -> Vec<StaticAdapter> {
    let capabilities =
        |detect, declared, migrations, observed, generate| DatabaseAdapterCapabilities {
            detect,
            extract_declared_schema: declared,
            extract_migrations: migrations,
            introspect_observed_schema: observed,
            validate: true,
            diff: true,
            generate_change: generate,
            supports_read_only_transaction: observed,
        };
    vec![
        StaticAdapter::new(
            DatabaseAdapterId::Prisma,
            capabilities(true, true, true, false, true),
        ),
        StaticAdapter::new(
            DatabaseAdapterId::Drizzle,
            capabilities(true, true, true, false, false),
        ),
        StaticAdapter::new(
            DatabaseAdapterId::RawSql,
            capabilities(true, true, true, false, true),
        ),
        StaticAdapter::new(
            DatabaseAdapterId::Sqlite,
            capabilities(true, true, false, true, false),
        ),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Minimal scratch directory for adapter fixtures. The crate has no `tempfile` dev-dependency,
    /// and adding one for four tests is not worth the supply-chain surface.
    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new() -> std::io::Result<Self> {
            let path = std::env::temp_dir().join(format!(
                "paralith-dbstudio-adapters-{}",
                uuid::Uuid::new_v4()
            ));
            fs::create_dir_all(&path)?;
            Ok(Self { path })
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn registered_v1_adapters_exclude_postgres_and_mysql() {
        let ids: Vec<_> = registered_v1_adapters()
            .into_iter()
            .map(|adapter| adapter.id())
            .collect();
        assert!(ids.contains(&DatabaseAdapterId::Prisma));
        assert!(ids.contains(&DatabaseAdapterId::Drizzle));
        assert!(ids.contains(&DatabaseAdapterId::RawSql));
        assert!(ids.contains(&DatabaseAdapterId::Sqlite));
        assert!(!ids.contains(&DatabaseAdapterId::Postgres));
        assert!(!ids.contains(&DatabaseAdapterId::Mysql));
    }

    #[test]
    fn prisma_adapter_extracts_relations_constraints_enums_and_complete_provenance() {
        let root = TempDir::new().unwrap();
        fs::write(
            root.path().join("schema.prisma"),
            r#"
                datasource db { provider = "postgresql" url = env("DATABASE_URL") }
                enum Role { ADMIN USER }
                model User {
                  id Int @id
                  email String @unique
                  role Role
                  posts Post[]
                  @@index([email], name: "user_email_idx")
                  @@map("auth.users")
                }
                model Post {
                  id Int @id
                  authorId Int
                  author User @relation(fields: [authorId], references: [id], onDelete: Cascade)
                }
            "#,
        )
        .unwrap();
        let adapter = adapter(DatabaseAdapterId::Prisma);
        let evidence = detect(&adapter, root.path(), &[]);
        let graph = extract(&adapter, root.path(), &evidence);
        assert!(graph
            .objects
            .iter()
            .any(|object| matches!(object, DatabaseObject::Enum(item) if item.name == "Role")));
        assert!(graph
            .objects
            .iter()
            .any(|object| matches!(object, DatabaseObject::ForeignKey(_))));
        assert!(graph
            .objects
            .iter()
            .any(|object| matches!(object, DatabaseObject::UniqueConstraint(_))));
        assert!(graph.objects.iter().any(
            |object| matches!(object, DatabaseObject::Index(item) if item.name == "user_email_idx")
        ));
        assert!(graph.objects.iter().any(
            |object| matches!(object, DatabaseObject::OrmModel(item) if item.symbol == "User")
        ));
        assert_eq!(graph.provenance.len(), graph.objects.len());
    }

    #[test]
    fn drizzle_adapter_uses_balanced_calls_and_ignores_unrelated_typescript() {
        let root = TempDir::new().unwrap();
        fs::write(
            root.path().join("unrelated.ts"),
            "const pgTable = 'not drizzle';",
        )
        .unwrap();
        fs::write(
            root.path().join("schema.ts"),
            r#"
                import { pgTable, serial, integer, text, index } from "drizzle-orm/pg-core";
                export const users = pgTable("auth.users", {
                  id: serial("id").primaryKey(),
                  managerId: integer("manager_id").references(() => users.id),
                  email: text("email").notNull().unique(),
                }, (table) => ({ emailIdx: index("users_email_idx").on(table.email) }));
            "#,
        )
        .unwrap();
        let adapter = adapter(DatabaseAdapterId::Drizzle);
        let evidence = detect(&adapter, root.path(), &[]);
        assert_eq!(evidence.len(), 1);
        let graph = extract(&adapter, root.path(), &evidence);
        assert!(graph
            .objects
            .iter()
            .any(|object| matches!(object, DatabaseObject::Table(table) if table.name == "users")));
        assert!(graph.objects.iter().any(
            |object| matches!(object, DatabaseObject::Index(item) if item.name == "users_email_idx")
        ));
    }

    #[test]
    fn raw_sql_adapter_handles_quoted_semicolons_nested_commas_and_alter_statements() {
        let root = TempDir::new().unwrap();
        fs::write(
            root.path().join("schema.sql"),
            r#"
                CREATE TYPE auth.role AS ENUM ('admin', 'user');
                CREATE TABLE auth.users (
                  id INTEGER PRIMARY KEY,
                  email VARCHAR(255) NOT NULL,
                  note TEXT DEFAULT 'semi;colon',
                  role auth.role,
                  CONSTRAINT users_email_unique UNIQUE (email)
                );
                CREATE TABLE auth.posts (
                  id INTEGER PRIMARY KEY,
                  author_id INTEGER,
                  CONSTRAINT posts_author_fk FOREIGN KEY (author_id) REFERENCES auth.users(id) ON DELETE CASCADE
                );
                CREATE INDEX posts_author_idx ON auth.posts(author_id);
                ALTER TABLE auth.posts ADD COLUMN metadata JSON;
            "#,
        )
        .unwrap();
        let adapter = adapter(DatabaseAdapterId::RawSql);
        let evidence = detect(&adapter, root.path(), &[]);
        let graph = extract(&adapter, root.path(), &evidence);
        assert!(graph.objects.iter().any(
            |object| matches!(object, DatabaseObject::Column(column) if column.name == "metadata")
        ));
        assert!(graph
            .objects
            .iter()
            .any(|object| matches!(object, DatabaseObject::ForeignKey(_))));
        assert!(graph.objects.iter().any(|object| matches!(object, DatabaseObject::Index(item) if item.name == "posts_author_idx")));
    }

    #[test]
    fn sqlite_binary_evidence_is_hashed_without_opening_or_utf8_decoding() {
        let root = TempDir::new().unwrap();
        fs::write(
            root.path().join("local.sqlite"),
            b"SQLite format 3\0\xff\xfe",
        )
        .unwrap();
        let adapter = adapter(DatabaseAdapterId::Sqlite);
        let evidence = detect(&adapter, root.path(), &[]);
        assert_eq!(evidence.len(), 1);
        assert_eq!(evidence[0].evidence_kind, DatabaseEvidenceKind::SqliteFile);
        assert_eq!(evidence[0].content_sha256.len(), 64);
    }

    #[test]
    fn changed_paths_cannot_escape_project_root() {
        let root = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        fs::write(
            outside.path().join("schema.sql"),
            "CREATE TABLE leaked(id INT);",
        )
        .unwrap();
        let adapter = adapter(DatabaseAdapterId::RawSql);
        let evidence = detect(&adapter, root.path(), &[outside.path().join("schema.sql")]);
        assert!(evidence.is_empty());
    }

    fn adapter(id: DatabaseAdapterId) -> StaticAdapter {
        registered_v1_adapters()
            .into_iter()
            .find(|adapter| adapter.id() == id)
            .unwrap()
    }

    fn detect(
        adapter: &StaticAdapter,
        root: &Path,
        changed_paths: &[PathBuf],
    ) -> Vec<DatabaseSourceEvidence> {
        adapter
            .detect(&DetectionContext {
                repository_id: "repo",
                project_id: "project",
                source_id: "dbsource:test",
                project_root: root,
                changed_paths,
                extractor_version: "test-extractor",
            })
            .unwrap()
    }

    fn extract(
        adapter: &StaticAdapter,
        root: &Path,
        evidence: &[DatabaseSourceEvidence],
    ) -> ExtractedDatabaseGraph {
        let source = source(adapter.id());
        adapter
            .extract_declared_schema(&ExtractionContext {
                repository_id: "repo",
                project_id: "project",
                project_root: root,
                source: &source,
                evidence,
                git_revision: None,
            })
            .unwrap()
    }

    fn source(adapter_id: DatabaseAdapterId) -> DatabaseSource {
        DatabaseSource {
            id: "source".to_owned(),
            repository_id: "repo".to_owned(),
            logical_key: "default".to_owned(),
            display_name: "Default".to_owned(),
            engine: crate::models::DatabaseEngine::Postgres,
            adapter_ids: vec![adapter_id],
            owner_project_id: Some("project".to_owned()),
            consumer_project_ids: Vec::new(),
            environment_ids: Vec::new(),
            evidence_ids: Vec::new(),
            confidence: 1.0,
            discovered_at: Utc::now().to_rfc3339(),
            updated_at: Utc::now().to_rfc3339(),
        }
    }
}

//! Agent-facing translation of Database Studio design operations.
//!
//! An agent should be able to say "add a `users` table with an email column" without constructing a
//! fully-populated typed graph object, complete with synthetic identities and fingerprints. This
//! module turns the compact JSON an agent sends into the exact typed
//! [`DatabaseDesignOperationKind`] the design service applies, so there is still only one operation
//! model and one validation path.

use serde::Deserialize;
use serde_json::Value;

use crate::errors::{AppError, AppResult};
use crate::models::{
    DatabaseColumn, DatabaseColumnPatch, DatabaseDataType, DatabaseDesignOperationKind,
    DatabaseExpression, DatabaseLayer, DatabaseObject, DatabaseObjectMeta, DatabaseTable,
    DatabaseTypeFamily, ExtractedDatabaseGraph, ForeignKey, Index, IndexKey, PrimaryKey,
    ReferentialAction, SemanticIdentity,
};

use super::graph;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TableInput {
    name: String,
    #[serde(default)]
    namespace: Option<String>,
    #[serde(default)]
    columns: Vec<ColumnInput>,
    /// Column names that form the primary key. Defaults to a single `id` column when the table
    /// declares one, because a table with no primary key is a health finding.
    #[serde(default)]
    primary_key: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ColumnInput {
    name: String,
    #[serde(alias = "dataType")]
    r#type: String,
    #[serde(default = "default_true")]
    nullable: bool,
    #[serde(default)]
    default: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RelationshipInput {
    from_table_id: String,
    from_column_ids: Vec<String>,
    to_table_id: String,
    to_column_ids: Vec<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    on_delete: Option<String>,
    #[serde(default)]
    on_update: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IndexInput {
    table_id: String,
    name: String,
    column_ids: Vec<String>,
    #[serde(default)]
    unique: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ColumnPatchInput {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    r#type: Option<String>,
    #[serde(default)]
    nullable: Option<bool>,
    #[serde(default)]
    default: Option<Option<String>>,
}

fn default_true() -> bool {
    true
}

/// Translate one capability id plus its arguments into a typed design operation.
pub fn to_operation(
    capability_id: &str,
    args: &Value,
    source_id: &str,
    graph_state: &ExtractedDatabaseGraph,
) -> AppResult<DatabaseDesignOperationKind> {
    match capability_id {
        "database.add_table" => {
            let input: TableInput = payload(args, "table")?;
            let namespace = input
                .namespace
                .clone()
                .unwrap_or_else(|| default_namespace(graph_state));
            let qualified = format!("{namespace}.{}", input.name);
            let namespace_id = namespace_id_for(graph_state, &namespace);
            let identity = graph::new_proposed_identity("table", &qualified);
            let table = DatabaseTable {
                meta: meta(identity, source_id, &qualified),
                namespace_id,
                name: input.name.clone(),
                mapped_name: None,
                comment: None,
                column_ids: Vec::new(),
                primary_key_id: None,
                foreign_key_ids: Vec::new(),
                unique_constraint_ids: Vec::new(),
                check_constraint_ids: Vec::new(),
                index_ids: Vec::new(),
            };
            Ok(DatabaseDesignOperationKind::AddTable { table })
        }
        "database.rename_table" => Ok(DatabaseDesignOperationKind::RenameTable {
            table_id: required_str(args, "tableId")?,
            new_name: required_str(args, "newName")?,
        }),
        "database.drop_table" => Ok(DatabaseDesignOperationKind::DropTable {
            table_id: required_str(args, "tableId")?,
        }),
        "database.add_column" => {
            let table_id = required_str(args, "tableId")?;
            let input: ColumnInput = payload(args, "column")?;
            let table = find_table(graph_state, &table_id)?;
            let qualified = format!("{}.{}", table.meta.identity.qualified_name, input.name);
            Ok(DatabaseDesignOperationKind::AddColumn {
                column: build_column(&input, source_id, &table_id, &qualified),
                table_id,
            })
        }
        "database.alter_column" => {
            let column_id = required_str(args, "columnId")?;
            let input: ColumnPatchInput = payload(args, "patch")?;
            Ok(DatabaseDesignOperationKind::AlterColumn {
                column_id,
                patch: DatabaseColumnPatch {
                    data_type: input.r#type.as_deref().map(canonical_type),
                    native_type: input.r#type,
                    name: input.name,
                    nullable: input.nullable,
                    default: input.default.map(|value| {
                        value.map(|value| DatabaseExpression {
                            normalized: value,
                            dialect: None,
                        })
                    }),
                },
            })
        }
        "database.drop_column" => Ok(DatabaseDesignOperationKind::DropColumn {
            column_id: required_str(args, "columnId")?,
        }),
        "database.add_relationship" => {
            let input: RelationshipInput = payload(args, "relationship")?;
            let table = find_table(graph_state, &input.from_table_id)?;
            let qualified = format!(
                "{}:{}",
                table.meta.identity.qualified_name,
                input
                    .name
                    .clone()
                    .unwrap_or_else(|| format!("fk_{}", input.from_column_ids.len()))
            );
            let identity = graph::new_proposed_identity("foreign_key", &qualified);
            Ok(DatabaseDesignOperationKind::AddForeignKey {
                key: ForeignKey {
                    meta: meta(identity, source_id, &qualified),
                    table_id: input.from_table_id,
                    name: input.name,
                    column_ids: input.from_column_ids,
                    referenced_table_id: input.to_table_id,
                    referenced_column_ids: input.to_column_ids,
                    on_delete: referential_action(input.on_delete.as_deref()),
                    on_update: referential_action(input.on_update.as_deref()),
                    deferrable: None,
                },
            })
        }
        "database.add_index" => {
            let input: IndexInput = payload(args, "index")?;
            let table = find_table(graph_state, &input.table_id)?;
            let qualified = format!("{}:{}", table.meta.identity.qualified_name, input.name);
            let identity = graph::new_proposed_identity("index", &qualified);
            Ok(DatabaseDesignOperationKind::AddIndex {
                index: Index {
                    meta: meta(identity, source_id, &qualified),
                    table_id: input.table_id,
                    name: input.name,
                    unique: input.unique,
                    method: None,
                    keys: input
                        .column_ids
                        .into_iter()
                        .map(|column_id| IndexKey {
                            column_id: Some(column_id),
                            expression: None,
                            direction: None,
                            nulls: None,
                        })
                        .collect(),
                    included_column_ids: Vec::new(),
                    predicate: None,
                },
            })
        }
        other => Err(AppError::new(
            "capability_unavailable",
            format!("'{other}' is not a design operation."),
            true,
        )
        .layer("database_studio")),
    }
}

/// Follow-up operations a compact request implies. `add_table` with columns expands into the table
/// plus one `add_column` per declared column plus a primary key, so an agent gets a complete table
/// from one call without the backend inventing anything it was not told.
pub fn follow_up_operations(
    capability_id: &str,
    args: &Value,
    source_id: &str,
    table_id: &str,
    graph_state: &ExtractedDatabaseGraph,
) -> AppResult<Vec<DatabaseDesignOperationKind>> {
    if capability_id != "database.add_table" {
        return Ok(Vec::new());
    }
    let input: TableInput = payload(args, "table")?;
    let table = find_table(graph_state, table_id)?;
    let mut operations = Vec::new();
    let mut primary_key_columns = Vec::new();
    for column in &input.columns {
        let qualified = format!("{}.{}", table.meta.identity.qualified_name, column.name);
        let built = build_column(column, source_id, table_id, &qualified);
        if input.primary_key.contains(&column.name)
            || (input.primary_key.is_empty() && column.name == "id")
        {
            primary_key_columns.push(built.meta.identity.id.clone());
        }
        operations.push(DatabaseDesignOperationKind::AddColumn {
            table_id: table_id.to_owned(),
            column: built,
        });
    }
    if !primary_key_columns.is_empty() {
        let qualified = format!("{}:pk", table.meta.identity.qualified_name);
        let identity = graph::new_proposed_identity("primary_key", &qualified);
        operations.push(DatabaseDesignOperationKind::AddPrimaryKey {
            key: PrimaryKey {
                meta: meta(identity, source_id, &qualified),
                table_id: table_id.to_owned(),
                name: None,
                column_ids: primary_key_columns,
                clustered: None,
            },
        });
    }
    Ok(operations)
}

fn build_column(
    input: &ColumnInput,
    source_id: &str,
    table_id: &str,
    qualified: &str,
) -> DatabaseColumn {
    let identity = graph::new_proposed_identity("column", qualified);
    DatabaseColumn {
        meta: meta(identity, source_id, qualified),
        table_id: table_id.to_owned(),
        name: input.name.clone(),
        mapped_name: None,
        ordinal: 0,
        data_type: canonical_type(&input.r#type),
        native_type: input.r#type.clone(),
        nullable: input.nullable,
        default: input.default.clone().map(|value| DatabaseExpression {
            normalized: value,
            dialect: None,
        }),
        generated: None,
        identity_generation: None,
        enum_id: None,
        comment: None,
    }
}

fn meta(identity: SemanticIdentity, source_id: &str, fingerprint: &str) -> DatabaseObjectMeta {
    let now = chrono::Utc::now().to_rfc3339();
    DatabaseObjectMeta {
        identity,
        source_id: source_id.to_owned(),
        layer: DatabaseLayer::Proposed,
        snapshot_id: None,
        design_revision_id: None,
        confidence: 1.0,
        provenance_ids: Vec::new(),
        discovered_at: now.clone(),
        observed_at: now.clone(),
        updated_at: now,
        content_fingerprint: format!(
            "sha256:{:x}",
            <sha2::Sha256 as sha2::Digest>::digest(fingerprint.as_bytes())
        ),
    }
}

/// Map a declared type name onto the canonical family so cross-engine comparison and the FK type
/// rule work on proposals the same way they work on extracted schemas.
pub fn canonical_type(value: &str) -> DatabaseDataType {
    let lower = value.to_ascii_lowercase();
    let family = if lower.starts_with("bool") {
        DatabaseTypeFamily::Boolean
    } else if lower.contains("uuid") {
        DatabaseTypeFamily::Uuid
    } else if lower.contains("json") {
        DatabaseTypeFamily::Json
    } else if lower.starts_with("int")
        || lower.contains("serial")
        || lower.starts_with("bigint")
        || lower.starts_with("smallint")
    {
        DatabaseTypeFamily::Integer
    } else if lower.contains("decimal") || lower.contains("numeric") {
        DatabaseTypeFamily::Decimal
    } else if lower.contains("float") || lower.contains("double") || lower.contains("real") {
        DatabaseTypeFamily::Float
    } else if lower.contains("timestamp") || lower.contains("datetime") {
        DatabaseTypeFamily::DateTime
    } else if lower.starts_with("date") {
        DatabaseTypeFamily::Date
    } else if lower.starts_with("time") {
        DatabaseTypeFamily::Time
    } else if lower.contains("char") || lower.contains("text") || lower.contains("string") {
        DatabaseTypeFamily::Text
    } else if lower.contains("bytea") || lower.contains("blob") || lower.contains("binary") {
        DatabaseTypeFamily::Binary
    } else {
        DatabaseTypeFamily::Custom
    };
    let length = lower
        .split_once('(')
        .and_then(|(_, tail)| tail.split_once(')'))
        .and_then(|(value, _)| value.split(',').next()?.trim().parse::<u32>().ok());
    DatabaseDataType {
        family,
        length,
        precision: None,
        scale: None,
        array_dimensions: 0,
        unsigned: false,
    }
}

fn referential_action(value: Option<&str>) -> ReferentialAction {
    match value.unwrap_or_default().to_ascii_lowercase().as_str() {
        "cascade" => ReferentialAction::Cascade,
        "set_null" | "setnull" => ReferentialAction::SetNull,
        "set_default" | "setdefault" => ReferentialAction::SetDefault,
        "restrict" => ReferentialAction::Restrict,
        _ => ReferentialAction::NoAction,
    }
}

fn default_namespace(graph_state: &ExtractedDatabaseGraph) -> String {
    graph_state
        .objects
        .iter()
        .find_map(|object| match object {
            DatabaseObject::Namespace(namespace) => Some(namespace.name.clone()),
            _ => None,
        })
        .unwrap_or_else(|| "public".to_owned())
}

fn namespace_id_for(graph_state: &ExtractedDatabaseGraph, namespace: &str) -> String {
    graph_state
        .objects
        .iter()
        .find_map(|object| match object {
            DatabaseObject::Namespace(candidate) if candidate.name == namespace => {
                Some(candidate.meta.identity.id.clone())
            }
            _ => None,
        })
        .or_else(|| {
            graph_state.objects.iter().find_map(|object| match object {
                DatabaseObject::Table(table)
                    if table
                        .meta
                        .identity
                        .qualified_name
                        .starts_with(&format!("{namespace}.")) =>
                {
                    Some(table.namespace_id.clone())
                }
                _ => None,
            })
        })
        .unwrap_or_default()
}

fn find_table<'a>(
    graph_state: &'a ExtractedDatabaseGraph,
    table_id: &str,
) -> AppResult<&'a DatabaseTable> {
    graph_state
        .objects
        .iter()
        .find_map(|object| match object {
            DatabaseObject::Table(table) if table.meta.identity.id == table_id => Some(table),
            _ => None,
        })
        .ok_or_else(|| {
            AppError::new(
                "database_object_not_found",
                "The design does not contain that table.",
                true,
            )
            .entity(table_id)
            .layer("database_studio")
        })
}

fn payload<T: serde::de::DeserializeOwned>(args: &Value, key: &str) -> AppResult<T> {
    let value = args.get(key).ok_or_else(|| {
        AppError::new(
            "validation_error",
            format!("Argument '{key}' is required."),
            true,
        )
        .layer("database_studio")
    })?;
    serde_json::from_value(value.clone()).map_err(|error| {
        AppError::new(
            "validation_error",
            format!("Argument '{key}' has an unexpected shape."),
            true,
        )
        .detail(error.to_string())
        .layer("database_studio")
    })
}

fn required_str(args: &Value, key: &str) -> AppResult<String> {
    args.get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_owned)
        .ok_or_else(|| {
            AppError::new(
                "validation_error",
                format!("Argument '{key}' is required and must be a non-empty string."),
                true,
            )
            .layer("database_studio")
        })
}

//! Read-only SQLite file introspection — the only Observed-layer extraction V1 supports.
//!
//! Three invariants hold here and are covered by tests:
//!
//! 1. The file must resolve inside the Project root through [`ProjectPathGuard`].
//! 2. The connection is opened read-only. No statement this module issues can mutate the file, and
//!    the open flags make a write physically impossible rather than merely unintended.
//! 3. Introspection only ever happens because a caller explicitly asked for this file. Discovering
//!    a `.sqlite` file, or a `DATABASE_URL`, never triggers a connection on its own.

use std::path::Path;

use chrono::Utc;
use rusqlite::{Connection, OpenFlags};
use sha2::{Digest, Sha256};

use crate::errors::{AppError, AppResult};
use crate::models::{
    DatabaseColumn, DatabaseDataType, DatabaseEdge, DatabaseEdgeType, DatabaseExpression,
    DatabaseLayer, DatabaseNamespace, DatabaseObject, DatabaseObjectMeta, DatabaseTable,
    DatabaseTypeFamily, ExtractedDatabaseGraph, ForeignKey, Index, IndexKey, PrimaryKey,
    ReferentialAction, SemanticIdentity,
};
use crate::services::filesystem_service::ProjectPathGuard;

const OBSERVED_NAMESPACE: &str = "main";

/// Introspect a SQLite database file that the caller explicitly named.
pub fn introspect_file(
    project_root: &Path,
    source_id: &str,
    project_relative_path: &str,
    explicit_user_consent: bool,
) -> AppResult<ExtractedDatabaseGraph> {
    if !explicit_user_consent {
        return Err(AppError::new(
            "database_connection_consent_required",
            "Paralith does not open a discovered database without an explicit request.",
            true,
        )
        .action("Open the Connections surface and confirm the database you want to introspect.")
        .layer("database_studio"));
    }

    let guard = ProjectPathGuard::new(project_root)?;
    let (relative, canonical) = guard.resolve_existing(project_relative_path)?;
    if !canonical.is_file() {
        return Err(AppError::new(
            "database_file_not_found",
            "That path is not a database file inside this Project.",
            true,
        )
        .entity(&relative)
        .layer("database_studio"));
    }

    // SQLITE_OPEN_READ_ONLY without SQLITE_OPEN_CREATE: the handle cannot write, and a missing file
    // errors instead of being silently created.
    let connection = Connection::open_with_flags(
        &canonical,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| {
        AppError::new(
            "database_introspection_failed",
            "Paralith could not read that SQLite database.",
            true,
        )
        .detail(error.to_string())
        .entity(&relative)
        .layer("database_studio")
    })?;

    let graph = read_graph(&connection, source_id, &relative)?;
    Ok(graph)
}

fn read_graph(
    connection: &Connection,
    source_id: &str,
    relative: &str,
) -> AppResult<ExtractedDatabaseGraph> {
    let now = Utc::now().to_rfc3339();
    let mut objects = Vec::new();
    let mut edges = Vec::new();

    let namespace_id = object_id(source_id, "namespace", OBSERVED_NAMESPACE);
    objects.push(DatabaseObject::Namespace(DatabaseNamespace {
        meta: meta(
            &namespace_id,
            source_id,
            OBSERVED_NAMESPACE,
            OBSERVED_NAMESPACE,
            &now,
        ),
        name: OBSERVED_NAMESPACE.to_owned(),
        catalog_name: None,
        owner: None,
        comment: Some(format!("observed from {relative}")),
    }));

    let table_names: Vec<String> = {
        let mut statement = connection
            .prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
            )
            .map_err(introspection_error)?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(introspection_error)?
            .collect::<rusqlite::Result<Vec<String>>>()
            .map_err(introspection_error)?;
        rows
    };

    for table_name in &table_names {
        let qualified = format!("{OBSERVED_NAMESPACE}.{table_name}");
        let table_id = object_id(source_id, "table", &qualified);
        let mut column_ids = Vec::new();
        let mut primary_key_columns = Vec::new();

        let columns = {
            let mut statement = connection
                .prepare("SELECT cid, name, type, \"notnull\", dflt_value, pk FROM pragma_table_info(?1)")
                .map_err(introspection_error)?;
            let rows = statement
                .query_map([table_name], |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                        row.get::<_, i64>(3)?,
                        row.get::<_, Option<String>>(4)?,
                        row.get::<_, i64>(5)?,
                    ))
                })
                .map_err(introspection_error)?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(introspection_error)?;
            rows
        };

        for (ordinal, name, native_type, not_null, default, pk_position) in columns {
            let column_qualified = format!("{qualified}.{name}");
            let column_id = object_id(source_id, "column", &column_qualified);
            column_ids.push(column_id.clone());
            if pk_position > 0 {
                primary_key_columns.push((pk_position, column_id.clone()));
            }
            objects.push(DatabaseObject::Column(DatabaseColumn {
                meta: meta(
                    &column_id,
                    source_id,
                    &column_qualified,
                    &format!("{native_type}|{not_null}|{default:?}"),
                    &now,
                ),
                table_id: table_id.clone(),
                name: name.clone(),
                mapped_name: None,
                ordinal: ordinal as u32,
                data_type: sqlite_type(&native_type),
                native_type: native_type.clone(),
                nullable: not_null == 0,
                default: default.map(|value| DatabaseExpression {
                    normalized: value.trim().to_owned(),
                    dialect: Some("sqlite".to_owned()),
                }),
                generated: None,
                identity_generation: None,
                enum_id: None,
                comment: None,
            }));
            edges.push(edge(
                &table_id,
                &column_id,
                DatabaseEdgeType::HasColumn,
                &now,
            ));
        }

        let primary_key_id = if primary_key_columns.is_empty() {
            None
        } else {
            primary_key_columns.sort_by_key(|(position, _)| *position);
            let id = object_id(source_id, "primary_key", &qualified);
            let ids: Vec<String> = primary_key_columns
                .iter()
                .map(|(_, column_id)| column_id.clone())
                .collect();
            for column_id in &ids {
                edges.push(edge(&id, column_id, DatabaseEdgeType::PrimaryKey, &now));
            }
            objects.push(DatabaseObject::PrimaryKey(PrimaryKey {
                meta: meta(
                    &id,
                    source_id,
                    &format!("{qualified}.pk"),
                    &ids.join(","),
                    &now,
                ),
                table_id: table_id.clone(),
                name: None,
                column_ids: ids,
                clustered: None,
            }));
            Some(id)
        };

        let mut foreign_key_ids = Vec::new();
        let foreign_keys = {
            let mut statement = connection
                .prepare("SELECT id, seq, \"table\", \"from\", \"to\", on_update, on_delete FROM pragma_foreign_key_list(?1)")
                .map_err(introspection_error)?;
            let rows = statement
                .query_map([table_name], |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                        row.get::<_, Option<String>>(4)?,
                        row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                        row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                    ))
                })
                .map_err(introspection_error)?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(introspection_error)?;
            rows
        };

        let mut grouped: std::collections::BTreeMap<i64, Vec<_>> =
            std::collections::BTreeMap::new();
        for row in foreign_keys {
            grouped.entry(row.0).or_default().push(row);
        }
        for (key_index, mut rows) in grouped {
            rows.sort_by_key(|row| row.1);
            let Some(first) = rows.first().cloned() else {
                continue;
            };
            let referenced_table = first.2.clone();
            let referenced_qualified = format!("{OBSERVED_NAMESPACE}.{referenced_table}");
            let key_id = object_id(
                source_id,
                "foreign_key",
                &format!("{qualified}:{key_index}"),
            );
            let local_columns: Vec<String> = rows
                .iter()
                .map(|row| object_id(source_id, "column", &format!("{qualified}.{}", row.3)))
                .collect();
            let referenced_columns: Vec<String> = rows
                .iter()
                .map(|row| {
                    let column = row.4.clone().unwrap_or_else(|| "rowid".to_owned());
                    object_id(
                        source_id,
                        "column",
                        &format!("{referenced_qualified}.{column}"),
                    )
                })
                .collect();
            let referenced_table_id = object_id(source_id, "table", &referenced_qualified);
            foreign_key_ids.push(key_id.clone());
            objects.push(DatabaseObject::ForeignKey(ForeignKey {
                meta: meta(
                    &key_id,
                    source_id,
                    &format!("{qualified}.fk_{key_index}"),
                    &format!("{referenced_qualified}|{}|{}", first.5, first.6),
                    &now,
                ),
                table_id: table_id.clone(),
                name: None,
                column_ids: local_columns,
                referenced_table_id: referenced_table_id.clone(),
                referenced_column_ids: referenced_columns,
                on_delete: referential_action(&first.6),
                on_update: referential_action(&first.5),
                deferrable: None,
            }));
            edges.push(edge(
                &table_id,
                &referenced_table_id,
                DatabaseEdgeType::References,
                &now,
            ));
        }

        let mut index_ids = Vec::new();
        let indexes = {
            let mut statement = connection
                .prepare("SELECT name, \"unique\", origin FROM pragma_index_list(?1)")
                .map_err(introspection_error)?;
            let rows = statement
                .query_map([table_name], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    ))
                })
                .map_err(introspection_error)?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(introspection_error)?;
            rows
        };
        for (index_name, unique, origin) in indexes {
            // `pk` and `u` origins are the constraint objects already represented above.
            if origin == "pk" {
                continue;
            }
            let index_id = object_id(source_id, "index", &format!("{qualified}.{index_name}"));
            let key_columns = {
                let mut statement = connection
                    .prepare("SELECT name FROM pragma_index_info(?1) ORDER BY seqno")
                    .map_err(introspection_error)?;
                let rows = statement
                    .query_map([&index_name], |row| row.get::<_, Option<String>>(0))
                    .map_err(introspection_error)?
                    .collect::<rusqlite::Result<Vec<Option<String>>>>()
                    .map_err(introspection_error)?;
                rows
            };
            let keys: Vec<IndexKey> = key_columns
                .into_iter()
                .map(|column| IndexKey {
                    column_id: column.map(|column| {
                        object_id(source_id, "column", &format!("{qualified}.{column}"))
                    }),
                    expression: None,
                    direction: None,
                    nulls: None,
                })
                .collect();
            for key in &keys {
                if let Some(column_id) = &key.column_id {
                    edges.push(edge(&index_id, column_id, DatabaseEdgeType::Indexes, &now));
                }
            }
            index_ids.push(index_id.clone());
            objects.push(DatabaseObject::Index(Index {
                meta: meta(
                    &index_id,
                    source_id,
                    &format!("{qualified}.{index_name}"),
                    &format!("{unique}|{keys:?}"),
                    &now,
                ),
                table_id: table_id.clone(),
                name: index_name,
                unique: unique == 1,
                method: None,
                keys,
                included_column_ids: Vec::new(),
                predicate: None,
            }));
        }

        objects.push(DatabaseObject::Table(DatabaseTable {
            meta: meta(
                &table_id,
                source_id,
                &qualified,
                &format!("{column_ids:?}|{primary_key_id:?}"),
                &now,
            ),
            namespace_id: namespace_id.clone(),
            name: table_name.clone(),
            mapped_name: None,
            comment: None,
            column_ids,
            primary_key_id,
            foreign_key_ids,
            unique_constraint_ids: Vec::new(),
            check_constraint_ids: Vec::new(),
            index_ids,
        }));
        edges.push(edge(
            &namespace_id,
            &table_id,
            DatabaseEdgeType::Contains,
            &now,
        ));
    }

    // Relationships whose target table is absent (a foreign key to a dropped table) are real
    // findings, not renderable edges: the health rules report them from the objects instead.
    let object_ids: std::collections::HashSet<String> = objects
        .iter()
        .map(|object| object.meta().identity.id.clone())
        .collect();
    edges.retain(|edge| {
        object_ids.contains(&edge.source_object_id) && object_ids.contains(&edge.target_object_id)
    });

    objects.sort_by(|left, right| left.meta().identity.id.cmp(&right.meta().identity.id));
    edges.sort_by(|left, right| left.id.cmp(&right.id));
    edges.dedup_by(|left, right| left.id == right.id);

    Ok(ExtractedDatabaseGraph {
        objects,
        edges,
        provenance: Vec::new(),
    })
}

fn introspection_error(error: rusqlite::Error) -> AppError {
    AppError::new(
        "database_introspection_failed",
        "Paralith could not read the structure of that SQLite database.",
        true,
    )
    .detail(error.to_string())
    .layer("database_studio")
}

/// SQLite type affinity rules, applied to the declared type text.
fn sqlite_type(native: &str) -> DatabaseDataType {
    let upper = native.to_ascii_uppercase();
    let family = if upper.contains("INT") {
        DatabaseTypeFamily::Integer
    } else if upper.contains("CHAR") || upper.contains("CLOB") || upper.contains("TEXT") {
        DatabaseTypeFamily::Text
    } else if upper.contains("BLOB") || upper.is_empty() {
        DatabaseTypeFamily::Binary
    } else if upper.contains("REAL") || upper.contains("FLOA") || upper.contains("DOUB") {
        DatabaseTypeFamily::Float
    } else if upper.contains("BOOL") {
        DatabaseTypeFamily::Boolean
    } else if upper.contains("DATETIME") || upper.contains("TIMESTAMP") {
        DatabaseTypeFamily::DateTime
    } else if upper.contains("DATE") {
        DatabaseTypeFamily::Date
    } else if upper.contains("DECIMAL") || upper.contains("NUMERIC") {
        DatabaseTypeFamily::Decimal
    } else {
        DatabaseTypeFamily::Custom
    };
    let length = upper
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

fn referential_action(value: &str) -> ReferentialAction {
    match value.to_ascii_uppercase().replace(' ', "_").as_str() {
        "CASCADE" => ReferentialAction::Cascade,
        "SET_NULL" => ReferentialAction::SetNull,
        "SET_DEFAULT" => ReferentialAction::SetDefault,
        "RESTRICT" => ReferentialAction::Restrict,
        _ => ReferentialAction::NoAction,
    }
}

fn object_id(source_id: &str, kind: &str, key: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(source_id.as_bytes());
    hasher.update([0]);
    hasher.update(kind.as_bytes());
    hasher.update([0]);
    hasher.update(key.as_bytes());
    format!("db:{kind}:{:x}", hasher.finalize())
}

fn meta(
    id: &str,
    source_id: &str,
    qualified_name: &str,
    fingerprint_input: &str,
    now: &str,
) -> DatabaseObjectMeta {
    let mut hasher = Sha256::new();
    hasher.update(fingerprint_input.as_bytes());
    DatabaseObjectMeta {
        identity: SemanticIdentity {
            id: id.to_owned(),
            logical_key: qualified_name.to_owned(),
            qualified_name: qualified_name.to_owned(),
            previous_ids: Vec::new(),
        },
        source_id: source_id.to_owned(),
        layer: DatabaseLayer::Observed,
        snapshot_id: None,
        design_revision_id: None,
        confidence: 1.0,
        provenance_ids: Vec::new(),
        discovered_at: now.to_owned(),
        observed_at: now.to_owned(),
        updated_at: now.to_owned(),
        content_fingerprint: format!("sha256:{:x}", hasher.finalize()),
    }
}

fn edge(source: &str, target: &str, edge_type: DatabaseEdgeType, now: &str) -> DatabaseEdge {
    let mut hasher = Sha256::new();
    hasher.update(source.as_bytes());
    hasher.update(target.as_bytes());
    hasher.update(format!("{edge_type:?}").as_bytes());
    DatabaseEdge {
        id: format!("{:x}", hasher.finalize()),
        source_object_id: source.to_owned(),
        target_object_id: target.to_owned(),
        edge_type,
        snapshot_id: None,
        design_revision_id: None,
        confidence: 1.0,
        provenance_ids: Vec::new(),
        created_at: now.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_root(name: &str) -> std::path::PathBuf {
        let path =
            std::env::temp_dir().join(format!("paralith-dbstudio-{name}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn seed(path: &Path) {
        let connection = Connection::open(path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL);
                 CREATE UNIQUE INDEX idx_users_email ON users(email);
                 CREATE TABLE notes (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, body TEXT);",
            )
            .unwrap();
    }

    #[test]
    fn introspection_reads_tables_columns_keys_and_indexes() {
        let root = temp_root("introspect");
        seed(&root.join("dev.sqlite"));

        let graph = introspect_file(&root, "src", "dev.sqlite", true).unwrap();
        let tables: Vec<&str> = graph
            .objects
            .iter()
            .filter_map(|object| match object {
                DatabaseObject::Table(table) => Some(table.name.as_str()),
                _ => None,
            })
            .collect();
        assert!(tables.contains(&"users"));
        assert!(tables.contains(&"notes"));
        assert!(graph.objects.iter().any(|object| matches!(
            object,
            DatabaseObject::ForeignKey(key) if key.on_delete == ReferentialAction::Cascade
        )));
        assert!(graph.objects.iter().any(|object| matches!(
            object,
            DatabaseObject::Index(index) if index.name == "idx_users_email" && index.unique
        )));
        assert!(graph
            .objects
            .iter()
            .all(|object| object.meta().layer == DatabaseLayer::Observed));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn introspection_requires_explicit_consent() {
        let root = temp_root("consent");
        seed(&root.join("dev.sqlite"));
        let error = introspect_file(&root, "src", "dev.sqlite", false).unwrap_err();
        assert_eq!(error.code, "database_connection_consent_required");
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn introspection_cannot_escape_the_project_root() {
        let root = temp_root("escape");
        seed(&root.join("dev.sqlite"));
        let error = introspect_file(&root, "src", "../dev.sqlite", true).unwrap_err();
        assert_ne!(error.code, "database_introspection_failed");
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn introspection_connection_is_read_only() {
        let root = temp_root("readonly");
        let file = root.join("dev.sqlite");
        seed(&file);

        let connection = Connection::open_with_flags(
            &file,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .unwrap();
        let write = connection.execute("INSERT INTO users(id,email) VALUES(1,'a@b.c')", []);
        assert!(
            write.is_err(),
            "an introspection handle must not be able to write"
        );
        fs::remove_dir_all(&root).ok();
    }
}

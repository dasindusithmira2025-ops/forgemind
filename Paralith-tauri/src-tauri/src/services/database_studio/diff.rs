//! Semantic schema comparison.
//!
//! This is deliberately not a text diff. Two schemas are compared as graphs of typed objects: a
//! table is matched to a table by lineage, then by qualified name, and the reported change describes
//! *what* differs (type, nullability, default, key membership, referential action) rather than which
//! characters moved. Reformatting a schema file therefore produces an empty diff.

use crate::models::{
    DatabaseChange, DatabaseChangeKind, DatabaseColumn, DatabaseComparisonMode, DatabaseDiff,
    DatabaseObject, ExtractedDatabaseGraph, ForeignKey, Index, PrimaryKey, UniqueConstraint,
};
use chrono::Utc;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};

pub fn structural_diff(
    source_id: &str,
    mode: DatabaseComparisonMode,
    before: &ExtractedDatabaseGraph,
    after: &ExtractedDatabaseGraph,
) -> DatabaseDiff {
    let pairs = match_objects(before, after);
    // Constraint membership is compared by the *names* of the referenced objects, never by their
    // IDs. A proposed graph carries synthetic identities, so an ID-level comparison would report a
    // difference between two schemas that are in fact identical.
    let before_names = qualified_names(before);
    let after_names = qualified_names(after);
    let mut changes = Vec::new();

    for (before_object, after_object) in &pairs.matched {
        changes.extend(compare_pair(
            before_object,
            after_object,
            &before_names,
            &after_names,
        ));
    }
    for object in &pairs.removed {
        changes.push(DatabaseChange {
            kind: DatabaseChangeKind::Drop,
            object_id: Some(object.meta().identity.id.clone()),
            before_fingerprint: Some(object.meta().content_fingerprint.clone()),
            after_fingerprint: None,
            breaking: true,
            // Dropping a table or column destroys data. Dropping an index or a constraint does not.
            destructive: matches!(
                object,
                DatabaseObject::Table(_) | DatabaseObject::Column(_) | DatabaseObject::View(_)
            ),
            summary: format!(
                "Remove {} {}",
                object.kind_name().replace('_', " "),
                object.meta().identity.qualified_name
            ),
        });
    }
    // A NOT NULL column is only breaking on a table that already has rows. On a table this same
    // change set is creating, it is part of the table's definition.
    let new_tables: HashSet<&str> = pairs
        .added
        .iter()
        .filter(|object| matches!(object, DatabaseObject::Table(_)))
        .map(|object| object.meta().identity.id.as_str())
        .collect();
    for object in &pairs.added {
        changes.push(DatabaseChange {
            kind: DatabaseChangeKind::Add,
            object_id: Some(object.meta().identity.id.clone()),
            before_fingerprint: None,
            after_fingerprint: Some(object.meta().content_fingerprint.clone()),
            breaking: is_breaking_addition(object, &new_tables),
            destructive: false,
            summary: format!(
                "Add {} {}",
                object.kind_name().replace('_', " "),
                object.meta().identity.qualified_name
            ),
        });
    }

    changes.sort_by(|left, right| {
        left.summary
            .cmp(&right.summary)
            .then(left.object_id.cmp(&right.object_id))
    });
    let fingerprint = digest(
        &changes
            .iter()
            .map(|change| {
                format!(
                    "{:?}|{}|{}",
                    change.kind,
                    change.object_id.clone().unwrap_or_default(),
                    change.summary
                )
            })
            .collect::<Vec<_>>()
            .join("\n"),
    );
    DatabaseDiff {
        id: format!("dbdiff:{fingerprint}"),
        source_id: source_id.to_owned(),
        mode,
        changes,
        fingerprint,
        created_at: Utc::now().to_rfc3339(),
    }
}

/// True when a comparison found no semantic difference at all — the property the implementation
/// pipeline uses to prove a target design was actually realized.
pub fn is_zero_delta(diff: &DatabaseDiff) -> bool {
    diff.changes.is_empty()
}

struct MatchResult<'a> {
    matched: Vec<(&'a DatabaseObject, &'a DatabaseObject)>,
    added: Vec<&'a DatabaseObject>,
    removed: Vec<&'a DatabaseObject>,
}

/// Line objects up across two graphs.
///
/// Lineage wins over names: a proposed object carries the declared ID it was seeded from in
/// `previous_ids`, so a design that renamed a table still matches the original and reports a rename
/// rather than an unrelated drop plus add. Only when lineage is absent does matching fall back to
/// `(kind, qualified name)`.
fn match_objects<'a>(
    before: &'a ExtractedDatabaseGraph,
    after: &'a ExtractedDatabaseGraph,
) -> MatchResult<'a> {
    let mut before_by_id: HashMap<&str, &DatabaseObject> = HashMap::new();
    let mut before_by_logical_key: HashMap<(String, String), &DatabaseObject> = HashMap::new();
    let mut before_by_name: HashMap<(String, String), &DatabaseObject> = HashMap::new();
    let mut before_by_ancestor: HashMap<(String, String), &DatabaseObject> = HashMap::new();
    for object in &before.objects {
        before_by_id.insert(object.meta().identity.id.as_str(), object);
        before_by_logical_key.insert(
            (
                object.kind_name().to_owned(),
                object.meta().identity.logical_key.clone(),
            ),
            object,
        );
        before_by_name.insert(
            (
                object.kind_name().to_owned(),
                object.meta().identity.qualified_name.clone(),
            ),
            object,
        );
        for ancestor in &object.meta().identity.previous_ids {
            before_by_ancestor.insert((object.kind_name().to_owned(), ancestor.clone()), object);
        }
    }

    let mut matched = Vec::new();
    let mut added = Vec::new();
    let mut consumed: HashSet<&str> = HashSet::new();

    for object in &after.objects {
        let identity = &object.meta().identity;
        let candidate = before_by_id
            .get(identity.id.as_str())
            .copied()
            // Direct descent: this object was seeded from that one.
            .or_else(|| {
                identity
                    .previous_ids
                    .iter()
                    .find_map(|previous| before_by_id.get(previous.as_str()).copied())
            })
            // Sibling descent: two designs branched from the same base schema, so they share an
            // ancestor even though neither derives from the other.
            .or_else(|| {
                identity.previous_ids.iter().find_map(|previous| {
                    before_by_ancestor
                        .get(&(object.kind_name().to_owned(), previous.clone()))
                        .copied()
                })
            })
            // Stable semantic key, which survives a rename.
            .or_else(|| {
                before_by_logical_key
                    .get(&(object.kind_name().to_owned(), identity.logical_key.clone()))
                    .copied()
            })
            .or_else(|| {
                before_by_name
                    .get(&(
                        object.kind_name().to_owned(),
                        identity.qualified_name.clone(),
                    ))
                    .copied()
            });
        match candidate {
            Some(previous) if consumed.insert(previous.meta().identity.id.as_str()) => {
                matched.push((previous, object));
            }
            _ => added.push(object),
        }
    }

    let removed = before
        .objects
        .iter()
        .filter(|object| !consumed.contains(object.meta().identity.id.as_str()))
        .collect();

    MatchResult {
        matched,
        added,
        removed,
    }
}

/// Map every object ID in a graph to the qualified name it denotes.
fn qualified_names(graph: &ExtractedDatabaseGraph) -> HashMap<&str, &str> {
    graph
        .objects
        .iter()
        .map(|object| {
            (
                object.meta().identity.id.as_str(),
                object.meta().identity.qualified_name.as_str(),
            )
        })
        .collect()
}

fn resolve(names: &HashMap<&str, &str>, ids: &[String]) -> Vec<String> {
    ids.iter()
        .map(|id| {
            names
                .get(id.as_str())
                .map(|name| (*name).to_owned())
                .unwrap_or_else(|| id.clone())
        })
        .collect()
}

fn compare_pair(
    before: &DatabaseObject,
    after: &DatabaseObject,
    before_names: &HashMap<&str, &str>,
    after_names: &HashMap<&str, &str>,
) -> Vec<DatabaseChange> {
    let mut changes = Vec::new();
    let before_name = &before.meta().identity.qualified_name;
    let after_name = &after.meta().identity.qualified_name;
    if before_name != after_name {
        changes.push(DatabaseChange {
            kind: DatabaseChangeKind::Rename,
            object_id: Some(after.meta().identity.id.clone()),
            before_fingerprint: Some(before.meta().content_fingerprint.clone()),
            after_fingerprint: Some(after.meta().content_fingerprint.clone()),
            breaking: true,
            destructive: false,
            summary: format!(
                "Rename {} {before_name} to {after_name}",
                after.kind_name().replace('_', " ")
            ),
        });
    }

    let attribute_changes: Vec<(String, bool, bool, bool)> = match (before, after) {
        // A table's own fingerprint moves whenever any of its members change, and those members are
        // compared individually. Reporting the container as "changed" as well would double-count
        // every column edit, so only the table's own attributes are compared here.
        (DatabaseObject::Table(left), DatabaseObject::Table(right)) => {
            if left.mapped_name == right.mapped_name && left.comment == right.comment {
                Vec::new()
            } else {
                vec![("physical mapping changed".to_owned(), true, false, false)]
            }
        }
        (DatabaseObject::Namespace(left), DatabaseObject::Namespace(right)) => {
            if left.name == right.name {
                Vec::new()
            } else {
                vec![("namespace renamed".to_owned(), true, false, false)]
            }
        }
        (DatabaseObject::Column(left), DatabaseObject::Column(right)) => {
            column_changes(left, right)
        }
        (DatabaseObject::PrimaryKey(left), DatabaseObject::PrimaryKey(right)) => {
            primary_key_changes(left, right, before_names, after_names)
        }
        (DatabaseObject::ForeignKey(left), DatabaseObject::ForeignKey(right)) => {
            foreign_key_changes(left, right, before_names, after_names)
        }
        (DatabaseObject::UniqueConstraint(left), DatabaseObject::UniqueConstraint(right)) => {
            unique_changes(left, right, before_names, after_names)
        }
        (DatabaseObject::Index(left), DatabaseObject::Index(right)) => {
            index_changes(left, right, before_names, after_names)
        }
        (DatabaseObject::Enum(left), DatabaseObject::Enum(right)) => {
            if left.values == right.values {
                Vec::new()
            } else {
                let removed = left
                    .values
                    .iter()
                    .any(|value| !right.values.contains(value));
                vec![(
                    format!(
                        "enum values {} -> {}",
                        describe_enum(&left.values),
                        describe_enum(&right.values)
                    ),
                    removed,
                    removed,
                    false,
                )]
            }
        }
        (DatabaseObject::CheckConstraint(left), DatabaseObject::CheckConstraint(right)) => {
            if left.expression == right.expression {
                Vec::new()
            } else {
                vec![(
                    format!(
                        "check expression {} -> {}",
                        left.expression.normalized, right.expression.normalized
                    ),
                    true,
                    false,
                    false,
                )]
            }
        }
        _ => {
            if before.meta().content_fingerprint == after.meta().content_fingerprint {
                Vec::new()
            } else {
                vec![("definition changed".to_owned(), false, false, false)]
            }
        }
    };

    for (detail, breaking, destructive, requires_data_migration) in attribute_changes {
        changes.push(DatabaseChange {
            kind: if requires_data_migration {
                DatabaseChangeKind::DataMigrationRequired
            } else {
                DatabaseChangeKind::Alter
            },
            object_id: Some(after.meta().identity.id.clone()),
            before_fingerprint: Some(before.meta().content_fingerprint.clone()),
            after_fingerprint: Some(after.meta().content_fingerprint.clone()),
            breaking,
            destructive,
            summary: format!("Alter {after_name}: {detail}"),
        });
    }
    changes
}

/// Column-level comparison. Each tuple is `(detail, breaking, destructive, needs data migration)`.
fn column_changes(
    before: &DatabaseColumn,
    after: &DatabaseColumn,
) -> Vec<(String, bool, bool, bool)> {
    let mut changes = Vec::new();
    if before.data_type != after.data_type || before.native_type != after.native_type {
        let widening = before.data_type.family == after.data_type.family
            && after.data_type.length >= before.data_type.length;
        changes.push((
            format!("type {} -> {}", before.native_type, after.native_type),
            !widening,
            false,
            !widening,
        ));
    }
    if before.nullable != after.nullable {
        // NULL -> NOT NULL can fail on existing rows; the reverse is always safe.
        let tightening = before.nullable && !after.nullable;
        changes.push((
            if tightening {
                "nullable -> not null".to_owned()
            } else {
                "not null -> nullable".to_owned()
            },
            tightening,
            false,
            tightening,
        ));
    }
    if before.default != after.default {
        changes.push((
            format!(
                "default {} -> {}",
                describe_default(&before.default),
                describe_default(&after.default)
            ),
            false,
            false,
            false,
        ));
    }
    if before.identity_generation != after.identity_generation {
        changes.push(("identity generation changed".to_owned(), true, false, false));
    }
    if before.enum_id != after.enum_id {
        changes.push(("enum binding changed".to_owned(), true, false, true));
    }
    changes
}

fn primary_key_changes(
    before: &PrimaryKey,
    after: &PrimaryKey,
    before_names: &HashMap<&str, &str>,
    after_names: &HashMap<&str, &str>,
) -> Vec<(String, bool, bool, bool)> {
    let left = resolve(before_names, &before.column_ids);
    let right = resolve(after_names, &after.column_ids);
    if left == right {
        Vec::new()
    } else {
        vec![(
            format!(
                "primary key columns [{}] -> [{}]",
                left.join(", "),
                right.join(", ")
            ),
            true,
            false,
            true,
        )]
    }
}

fn foreign_key_changes(
    before: &ForeignKey,
    after: &ForeignKey,
    before_names: &HashMap<&str, &str>,
    after_names: &HashMap<&str, &str>,
) -> Vec<(String, bool, bool, bool)> {
    let mut changes = Vec::new();
    let left_target = resolve(
        before_names,
        std::slice::from_ref(&before.referenced_table_id),
    );
    let right_target = resolve(
        after_names,
        std::slice::from_ref(&after.referenced_table_id),
    );
    if left_target != right_target
        || resolve(before_names, &before.column_ids) != resolve(after_names, &after.column_ids)
        || resolve(before_names, &before.referenced_column_ids)
            != resolve(after_names, &after.referenced_column_ids)
    {
        changes.push(("foreign key target changed".to_owned(), true, false, true));
    }
    if before.on_delete != after.on_delete {
        let escalated = after.on_delete == crate::models::ReferentialAction::Cascade;
        changes.push((
            format!("on delete {:?} -> {:?}", before.on_delete, after.on_delete),
            escalated,
            escalated,
            false,
        ));
    }
    if before.on_update != after.on_update {
        changes.push((
            format!("on update {:?} -> {:?}", before.on_update, after.on_update),
            false,
            false,
            false,
        ));
    }
    changes
}

fn unique_changes(
    before: &UniqueConstraint,
    after: &UniqueConstraint,
    before_names: &HashMap<&str, &str>,
    after_names: &HashMap<&str, &str>,
) -> Vec<(String, bool, bool, bool)> {
    if resolve(before_names, &before.column_ids) == resolve(after_names, &after.column_ids)
        && before.nulls_distinct == after.nulls_distinct
    {
        Vec::new()
    } else {
        vec![(
            "unique constraint columns changed".to_owned(),
            true,
            false,
            true,
        )]
    }
}

fn index_changes(
    before: &Index,
    after: &Index,
    before_names: &HashMap<&str, &str>,
    after_names: &HashMap<&str, &str>,
) -> Vec<(String, bool, bool, bool)> {
    let mut changes = Vec::new();
    let key_names = |index: &Index, names: &HashMap<&str, &str>| {
        index
            .keys
            .iter()
            .map(|key| {
                (
                    key.column_id
                        .as_ref()
                        .and_then(|id| names.get(id.as_str()).map(|name| (*name).to_owned())),
                    key.expression.clone(),
                    key.direction.clone(),
                )
            })
            .collect::<Vec<_>>()
    };
    if key_names(before, before_names) != key_names(after, after_names) {
        changes.push(("index keys changed".to_owned(), false, false, false));
    }
    if before.unique != after.unique {
        changes.push((
            format!("unique {} -> {}", before.unique, after.unique),
            after.unique,
            false,
            after.unique,
        ));
    }
    if before.predicate != after.predicate {
        changes.push(("index predicate changed".to_owned(), false, false, false));
    }
    changes
}

/// Adding a NOT NULL column with no default breaks existing inserts and fails on populated tables —
/// unless the table itself is new, in which case there are no existing rows to break.
fn is_breaking_addition(object: &DatabaseObject, new_tables: &HashSet<&str>) -> bool {
    match object {
        DatabaseObject::Column(column) => {
            !column.nullable
                && column.default.is_none()
                && !new_tables.contains(column.table_id.as_str())
        }
        DatabaseObject::UniqueConstraint(constraint) => {
            !new_tables.contains(constraint.table_id.as_str())
        }
        DatabaseObject::CheckConstraint(constraint) => {
            !new_tables.contains(constraint.table_id.as_str())
        }
        _ => false,
    }
}

fn describe_default(value: &Option<crate::models::DatabaseExpression>) -> String {
    value
        .as_ref()
        .map(|expression| expression.normalized.clone())
        .unwrap_or_else(|| "none".to_owned())
}

fn describe_enum(values: &[crate::models::DatabaseEnumValue]) -> String {
    values
        .iter()
        .map(|value| value.name.as_str())
        .collect::<Vec<_>>()
        .join(", ")
}

fn digest(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    format!("{:x}", hasher.finalize())
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::models::*;

    fn meta(id: &str, qualified: &str, fingerprint: &str) -> DatabaseObjectMeta {
        DatabaseObjectMeta {
            identity: SemanticIdentity {
                id: id.into(),
                logical_key: id.into(),
                qualified_name: qualified.into(),
                previous_ids: Vec::new(),
            },
            source_id: "src".into(),
            layer: DatabaseLayer::Declared,
            snapshot_id: Some("snap".into()),
            design_revision_id: None,
            confidence: 1.0,
            provenance_ids: vec!["p".into()],
            discovered_at: "t".into(),
            observed_at: "t".into(),
            updated_at: "t".into(),
            content_fingerprint: fingerprint.into(),
        }
    }

    fn table_object(id: &str, qualified: &str, fingerprint: &str) -> DatabaseObject {
        DatabaseObject::Table(DatabaseTable {
            meta: meta(id, qualified, fingerprint),
            namespace_id: "ns".into(),
            name: qualified.rsplit('.').next().unwrap_or(qualified).into(),
            mapped_name: None,
            comment: None,
            column_ids: Vec::new(),
            primary_key_id: None,
            foreign_key_ids: Vec::new(),
            unique_constraint_ids: Vec::new(),
            check_constraint_ids: Vec::new(),
            index_ids: Vec::new(),
        })
    }

    fn column_object(
        id: &str,
        qualified: &str,
        native: &str,
        nullable: bool,
        family: DatabaseTypeFamily,
    ) -> DatabaseObject {
        DatabaseObject::Column(DatabaseColumn {
            meta: meta(id, qualified, &format!("{native}:{nullable}")),
            table_id: "table:users".into(),
            name: qualified.rsplit('.').next().unwrap_or(qualified).into(),
            mapped_name: None,
            ordinal: 0,
            data_type: DatabaseDataType {
                family,
                length: None,
                precision: None,
                scale: None,
                array_dimensions: 0,
                unsigned: false,
            },
            native_type: native.into(),
            nullable,
            default: None,
            generated: None,
            identity_generation: None,
            enum_id: None,
            comment: None,
        })
    }

    fn graph(objects: Vec<DatabaseObject>) -> ExtractedDatabaseGraph {
        ExtractedDatabaseGraph {
            objects,
            edges: Vec::new(),
            provenance: Vec::new(),
        }
    }

    fn mode() -> DatabaseComparisonMode {
        DatabaseComparisonMode::DeclaredProposedDelta {
            declared_snapshot_id: "snap".into(),
            proposed_revision_id: "rev".into(),
        }
    }

    #[test]
    fn formatting_only_yields_empty_diff() {
        let left = graph(vec![table_object("table:users", "public.users", "fp")]);
        let right = graph(vec![table_object("table:users", "public.users", "fp")]);
        assert!(is_zero_delta(&structural_diff(
            "src",
            mode(),
            &left,
            &right
        )));
    }

    #[test]
    fn renamed_table_is_reported_as_a_rename_not_a_drop_and_add() {
        let left = graph(vec![table_object("table:users", "public.users", "fp")]);
        let mut renamed = table_object("table:p1", "public.customers", "fp2");
        if let DatabaseObject::Table(table) = &mut renamed {
            table.meta.identity.previous_ids = vec!["table:users".into()];
        }
        let right = graph(vec![renamed]);

        let diff = structural_diff("src", mode(), &left, &right);
        assert_eq!(diff.changes.len(), 1);
        assert_eq!(diff.changes[0].kind, DatabaseChangeKind::Rename);
        assert!(!diff.changes[0].destructive);
    }

    #[test]
    fn column_type_and_nullability_changes_are_granular_and_classified() {
        let left = graph(vec![column_object(
            "col:users.name",
            "public.users.name",
            "text",
            true,
            DatabaseTypeFamily::Text,
        )]);
        let right = graph(vec![column_object(
            "col:users.name",
            "public.users.name",
            "integer",
            false,
            DatabaseTypeFamily::Integer,
        )]);

        let diff = structural_diff("src", mode(), &left, &right);
        assert_eq!(diff.changes.len(), 2);
        assert!(diff
            .changes
            .iter()
            .any(|change| change.summary.contains("type text -> integer") && change.breaking));
        assert!(diff
            .changes
            .iter()
            .any(|change| change.summary.contains("nullable -> not null")
                && change.kind == DatabaseChangeKind::DataMigrationRequired));
    }

    #[test]
    fn dropping_a_table_is_destructive_but_dropping_an_index_is_not() {
        let index = DatabaseObject::Index(Index {
            meta: meta("idx:users_email", "public.users.idx_email", "fp"),
            table_id: "table:users".into(),
            name: "idx_email".into(),
            unique: false,
            method: None,
            keys: Vec::new(),
            included_column_ids: Vec::new(),
            predicate: None,
        });
        let left = graph(vec![
            table_object("table:users", "public.users", "fp"),
            index,
        ]);
        let right = graph(Vec::new());

        let diff = structural_diff("src", mode(), &left, &right);
        let table_change = diff
            .changes
            .iter()
            .find(|change| change.object_id.as_deref() == Some("table:users"))
            .unwrap();
        let index_change = diff
            .changes
            .iter()
            .find(|change| change.object_id.as_deref() == Some("idx:users_email"))
            .unwrap();
        assert!(table_change.destructive);
        assert!(!index_change.destructive);
    }

    #[test]
    fn adding_a_not_null_column_without_a_default_is_breaking() {
        let left = graph(Vec::new());
        let right = graph(vec![column_object(
            "col:users.tenant",
            "public.users.tenant",
            "text",
            false,
            DatabaseTypeFamily::Text,
        )]);
        let diff = structural_diff("src", mode(), &left, &right);
        assert_eq!(diff.changes[0].kind, DatabaseChangeKind::Add);
        assert!(diff.changes[0].breaking);
        assert!(!diff.changes[0].destructive);
    }

    #[test]
    fn a_not_null_column_on_a_brand_new_table_is_not_breaking() {
        let left = graph(Vec::new());
        let right = graph(vec![
            table_object("table:users", "public.users", "fp"),
            column_object(
                "col:users.tenant",
                "public.users.tenant",
                "text",
                false,
                DatabaseTypeFamily::Text,
            ),
        ]);
        let diff = structural_diff("src", mode(), &left, &right);
        assert!(diff.changes.iter().all(|change| !change.breaking));
        assert!(diff.changes.iter().all(|change| !change.destructive));
    }
}

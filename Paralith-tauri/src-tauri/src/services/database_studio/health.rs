//! Deterministic database health rules.
//!
//! Every rule here is decidable from the canonical graph alone. No language model participates in
//! integrity analysis: a missing primary key, a dangling reference, or a foreign key whose type does
//! not match its target are facts, and Paralith reports them as facts with the objects and evidence
//! that produced them.

use crate::models::{
    DatabaseChangeKind, DatabaseColumn, DatabaseDiff, DatabaseIssueCode, DatabaseIssueSeverity,
    DatabaseObject, ExtractedDatabaseGraph, ReferentialAction,
};
use std::collections::{BTreeMap, BTreeSet, HashMap};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HealthIssue {
    pub code: DatabaseIssueCode,
    pub severity: DatabaseIssueSeverity,
    pub rule: &'static str,
    /// Semantic IDs the issue is about, so the UI can select them and an agent can act on them.
    pub object_ids: Vec<String>,
    pub title: String,
    pub explanation: String,
    /// Human-readable supporting facts (names, types, paths) — never raw credentials or file bodies.
    pub evidence: Vec<String>,
}

pub fn evaluate_graph_health(graph: &ExtractedDatabaseGraph) -> Vec<HealthIssue> {
    let mut issues = Vec::new();
    let ids: BTreeSet<&str> = graph
        .objects
        .iter()
        .map(|object| object.meta().identity.id.as_str())
        .collect();
    let columns: HashMap<&str, &DatabaseColumn> = graph
        .objects
        .iter()
        .filter_map(|object| match object {
            DatabaseObject::Column(column) => Some((column.meta.identity.id.as_str(), column)),
            _ => None,
        })
        .collect();
    let table_names: HashMap<&str, &str> = graph
        .objects
        .iter()
        .filter_map(|object| match object {
            DatabaseObject::Table(table) => Some((
                table.meta.identity.id.as_str(),
                table.meta.identity.qualified_name.as_str(),
            )),
            _ => None,
        })
        .collect();

    let mut duplicate_identities: BTreeMap<&str, usize> = BTreeMap::new();
    for object in &graph.objects {
        *duplicate_identities
            .entry(object.meta().identity.id.as_str())
            .or_default() += 1;
    }
    for (id, count) in duplicate_identities {
        if count > 1 {
            issues.push(HealthIssue {
                code: DatabaseIssueCode::DuplicateIdentity,
                severity: DatabaseIssueSeverity::Error,
                rule: "DUPLICATE_IDENTITY",
                object_ids: vec![id.to_owned()],
                title: "Duplicate semantic identity".into(),
                explanation: format!(
                    "{count} objects share the semantic identity '{id}'. Identity must be unique within a graph."
                ),
                evidence: vec![format!("occurrences: {count}")],
            });
        }
    }

    for object in &graph.objects {
        match object {
            DatabaseObject::Table(table) => {
                if table.primary_key_id.is_none() {
                    issues.push(HealthIssue {
                        code: DatabaseIssueCode::MissingPrimaryKey,
                        severity: DatabaseIssueSeverity::Warning,
                        rule: "MISSING_PRIMARY_KEY",
                        object_ids: vec![table.meta.identity.id.clone()],
                        title: format!("{} has no primary key", table.meta.identity.qualified_name),
                        explanation:
                            "The table declares no primary key, so rows cannot be addressed or safely updated by identity."
                                .into(),
                        evidence: vec![format!("table: {}", table.meta.identity.qualified_name)],
                    });
                }
            }
            DatabaseObject::ForeignKey(key) => {
                if !ids.contains(key.referenced_table_id.as_str()) {
                    issues.push(HealthIssue {
                        code: DatabaseIssueCode::BrokenReference,
                        severity: DatabaseIssueSeverity::Error,
                        rule: "BROKEN_REFERENCE",
                        object_ids: vec![key.meta.identity.id.clone()],
                        title: "Foreign key targets a table that does not exist".into(),
                        explanation: format!(
                            "'{}' references '{}', which is not present in this schema.",
                            key.meta.identity.qualified_name, key.referenced_table_id
                        ),
                        evidence: vec![format!("referenced: {}", key.referenced_table_id)],
                    });
                }
                for referenced in &key.referenced_column_ids {
                    if !ids.contains(referenced.as_str()) {
                        issues.push(HealthIssue {
                            code: DatabaseIssueCode::BrokenReference,
                            severity: DatabaseIssueSeverity::Error,
                            rule: "BROKEN_REFERENCE",
                            object_ids: vec![key.meta.identity.id.clone()],
                            title: "Foreign key targets a column that does not exist".into(),
                            explanation: format!(
                                "'{}' references column '{referenced}', which is not present in this schema.",
                                key.meta.identity.qualified_name
                            ),
                            evidence: vec![format!("referenced column: {referenced}")],
                        });
                    }
                }

                // Type compatibility is compared on the canonical type, not the dialect spelling, so
                // `serial` referencing `integer` is correctly treated as a match.
                for (local, referenced) in key.column_ids.iter().zip(&key.referenced_column_ids) {
                    let (Some(local_column), Some(referenced_column)) = (
                        columns.get(local.as_str()),
                        columns.get(referenced.as_str()),
                    ) else {
                        continue;
                    };
                    if local_column.data_type.family != referenced_column.data_type.family
                        || local_column.data_type.array_dimensions
                            != referenced_column.data_type.array_dimensions
                    {
                        issues.push(HealthIssue {
                            code: DatabaseIssueCode::FkTypeMismatch,
                            severity: DatabaseIssueSeverity::Error,
                            rule: "FK_TYPE_MISMATCH",
                            object_ids: vec![
                                key.meta.identity.id.clone(),
                                local.clone(),
                                referenced.clone(),
                            ],
                            title: "Foreign key column type does not match its target".into(),
                            explanation: format!(
                                "'{}' is {} but references '{}' which is {}.",
                                local_column.meta.identity.qualified_name,
                                local_column.native_type,
                                referenced_column.meta.identity.qualified_name,
                                referenced_column.native_type
                            ),
                            evidence: vec![
                                format!("{:?}", local_column.data_type.family),
                                format!("{:?}", referenced_column.data_type.family),
                            ],
                        });
                    }
                }

                if key.on_delete == ReferentialAction::Cascade {
                    let target = table_names
                        .get(key.referenced_table_id.as_str())
                        .copied()
                        .unwrap_or(key.referenced_table_id.as_str());
                    issues.push(HealthIssue {
                        code: DatabaseIssueCode::UnsafeChange,
                        severity: DatabaseIssueSeverity::Info,
                        rule: "CASCADING_DELETE",
                        object_ids: vec![key.meta.identity.id.clone()],
                        title: "Delete cascades from a referenced table".into(),
                        explanation: format!(
                            "Deleting a row in '{target}' also deletes the rows that reference it through '{}'.",
                            key.meta.identity.qualified_name
                        ),
                        evidence: vec!["ON DELETE CASCADE".into()],
                    });
                }
            }
            _ => {}
        }
    }

    for edge in &graph.edges {
        if !ids.contains(edge.source_object_id.as_str())
            || !ids.contains(edge.target_object_id.as_str())
        {
            issues.push(HealthIssue {
                code: DatabaseIssueCode::BrokenReference,
                severity: DatabaseIssueSeverity::Error,
                rule: "BROKEN_REFERENCE",
                object_ids: vec![edge.source_object_id.clone(), edge.target_object_id.clone()],
                title: "Relationship endpoint is missing".into(),
                explanation: format!(
                    "The {:?} relationship points at an object that is absent from this schema.",
                    edge.edge_type
                ),
                evidence: vec![edge.id.clone()],
            });
        }
    }

    issues.extend(duplicate_index_issues(graph));
    issues.extend(unindexed_foreign_key_issues(graph));

    issues.sort_by(|left, right| {
        left.rule
            .cmp(right.rule)
            .then(left.object_ids.cmp(&right.object_ids))
    });
    issues.dedup();
    issues
}

fn duplicate_index_issues(graph: &ExtractedDatabaseGraph) -> Vec<HealthIssue> {
    let mut seen: BTreeMap<String, String> = BTreeMap::new();
    let mut issues = Vec::new();
    for object in &graph.objects {
        if let DatabaseObject::Index(index) = object {
            let key = format!(
                "{}|{}|{:?}",
                index.table_id,
                index.unique,
                index
                    .keys
                    .iter()
                    .map(|key| (key.column_id.clone(), key.direction.clone()))
                    .collect::<Vec<_>>()
            );
            if let Some(existing) = seen.insert(key, index.meta.identity.id.clone()) {
                issues.push(HealthIssue {
                    code: DatabaseIssueCode::DuplicateIndex,
                    severity: DatabaseIssueSeverity::Warning,
                    rule: "DUPLICATE_INDEX",
                    object_ids: vec![index.meta.identity.id.clone(), existing.clone()],
                    title: format!("'{}' duplicates an existing index", index.name),
                    explanation:
                        "Two indexes on this table cover the same ordered columns with the same uniqueness, so one of them only costs write throughput."
                            .into(),
                    evidence: vec![existing],
                });
            }
        }
    }
    issues
}

/// A foreign key whose local columns are not the leading columns of any index forces a scan on the
/// referencing side of every join and on cascading deletes. Reported at info severity because the
/// right fix depends on the workload.
fn unindexed_foreign_key_issues(graph: &ExtractedDatabaseGraph) -> Vec<HealthIssue> {
    let mut covering: HashMap<&str, Vec<Vec<String>>> = HashMap::new();
    for object in &graph.objects {
        match object {
            DatabaseObject::Index(index) => {
                covering.entry(index.table_id.as_str()).or_default().push(
                    index
                        .keys
                        .iter()
                        .filter_map(|key| key.column_id.clone())
                        .collect(),
                )
            }
            DatabaseObject::PrimaryKey(key) => covering
                .entry(key.table_id.as_str())
                .or_default()
                .push(key.column_ids.clone()),
            DatabaseObject::UniqueConstraint(constraint) => covering
                .entry(constraint.table_id.as_str())
                .or_default()
                .push(constraint.column_ids.clone()),
            _ => {}
        }
    }

    graph
        .objects
        .iter()
        .filter_map(|object| match object {
            DatabaseObject::ForeignKey(key) if !key.column_ids.is_empty() => Some(key),
            _ => None,
        })
        .filter(|key| {
            !covering
                .get(key.table_id.as_str())
                .is_some_and(|candidates| {
                    candidates
                        .iter()
                        .any(|candidate| candidate.starts_with(key.column_ids.as_slice()))
                })
        })
        .map(|key| HealthIssue {
            code: DatabaseIssueCode::UnsupportedFeature,
            severity: DatabaseIssueSeverity::Info,
            rule: "UNINDEXED_FOREIGN_KEY",
            object_ids: vec![key.meta.identity.id.clone(), key.table_id.clone()],
            title: "Foreign key has no supporting index".into(),
            explanation: format!(
                "No index starts with the columns of '{}', so joins and cascading deletes scan the referencing table.",
                key.meta.identity.qualified_name
            ),
            evidence: vec![format!("columns: {}", key.column_ids.join(", "))],
        })
        .collect()
}

/// Issues implied by a comparison rather than by a single graph: drift between what the repository
/// declares and what a database actually contains, and destructive proposed changes.
pub fn evaluate_diff_health(diff: &DatabaseDiff) -> Vec<HealthIssue> {
    let drift = matches!(
        diff.mode,
        crate::models::DatabaseComparisonMode::DeclaredObservedDrift { .. }
    );
    diff.changes
        .iter()
        .filter(|change| change.destructive || change.kind == DatabaseChangeKind::Drop || drift)
        .map(|change| {
            if drift {
                HealthIssue {
                    code: DatabaseIssueCode::Drift,
                    severity: DatabaseIssueSeverity::Warning,
                    rule: "DECLARED_OBSERVED_DRIFT",
                    object_ids: change.object_id.clone().into_iter().collect(),
                    title: "Database does not match the repository schema".into(),
                    explanation: change.summary.clone(),
                    evidence: vec![format!("{:?}", change.kind)],
                }
            } else {
                HealthIssue {
                    code: DatabaseIssueCode::DestructiveProposedChange,
                    severity: DatabaseIssueSeverity::Critical,
                    rule: "DESTRUCTIVE_PROPOSED_CHANGE",
                    object_ids: change.object_id.clone().into_iter().collect(),
                    title: "Proposed change destroys existing data".into(),
                    explanation: change.summary.clone(),
                    evidence: vec![format!("{:?}", change.kind)],
                }
            }
        })
        .collect()
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::models::*;

    fn meta(id: &str) -> DatabaseObjectMeta {
        DatabaseObjectMeta {
            identity: SemanticIdentity {
                id: id.into(),
                logical_key: id.into(),
                qualified_name: id.into(),
                previous_ids: Vec::new(),
            },
            source_id: "src".into(),
            layer: DatabaseLayer::Declared,
            snapshot_id: Some("snap".into()),
            design_revision_id: None,
            confidence: 1.0,
            provenance_ids: vec!["e".into()],
            discovered_at: "t".into(),
            observed_at: "t".into(),
            updated_at: "t".into(),
            content_fingerprint: id.into(),
        }
    }

    fn column(id: &str, table: &str, family: DatabaseTypeFamily, native: &str) -> DatabaseObject {
        DatabaseObject::Column(DatabaseColumn {
            meta: meta(id),
            table_id: table.into(),
            name: id.into(),
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
            nullable: false,
            default: None,
            generated: None,
            identity_generation: None,
            enum_id: None,
            comment: None,
        })
    }

    fn table(id: &str, primary_key_id: Option<&str>, index_ids: Vec<String>) -> DatabaseObject {
        DatabaseObject::Table(DatabaseTable {
            meta: meta(id),
            namespace_id: "ns".into(),
            name: id.into(),
            mapped_name: None,
            comment: None,
            column_ids: Vec::new(),
            primary_key_id: primary_key_id.map(str::to_owned),
            foreign_key_ids: Vec::new(),
            unique_constraint_ids: Vec::new(),
            check_constraint_ids: Vec::new(),
            index_ids,
        })
    }

    #[test]
    fn deterministic_health_reports_missing_pk_broken_reference_and_duplicate_index() {
        let key = IndexKey {
            column_id: Some("col:name".into()),
            expression: None,
            direction: None,
            nulls: None,
        };
        let index = |id: &str, name: &str| {
            DatabaseObject::Index(Index {
                meta: meta(id),
                table_id: "table:users".into(),
                name: name.into(),
                unique: false,
                method: None,
                keys: vec![key.clone()],
                included_column_ids: Vec::new(),
                predicate: None,
            })
        };
        let graph = ExtractedDatabaseGraph {
            objects: vec![
                table("table:users", None, vec!["idx1".into(), "idx2".into()]),
                index("idx1", "a"),
                index("idx2", "b"),
            ],
            edges: vec![DatabaseEdge {
                id: "edge:broken".into(),
                source_object_id: "table:users".into(),
                target_object_id: "missing".into(),
                edge_type: DatabaseEdgeType::References,
                snapshot_id: Some("snap".into()),
                design_revision_id: None,
                confidence: 1.0,
                provenance_ids: Vec::new(),
                created_at: "t".into(),
            }],
            provenance: Vec::new(),
        };
        let issues = evaluate_graph_health(&graph);
        assert!(issues
            .iter()
            .any(|issue| issue.rule == "MISSING_PRIMARY_KEY"));
        assert!(issues.iter().any(|issue| issue.rule == "BROKEN_REFERENCE"));
        assert!(issues.iter().any(|issue| issue.rule == "DUPLICATE_INDEX"));
        assert!(issues
            .iter()
            .all(|issue| !issue.object_ids.is_empty() && !issue.explanation.is_empty()));
    }

    #[test]
    fn foreign_key_type_mismatch_is_detected_on_canonical_type_not_spelling() {
        let foreign_key = DatabaseObject::ForeignKey(ForeignKey {
            meta: meta("fk:orders_user"),
            table_id: "table:orders".into(),
            name: Some("orders_user_fk".into()),
            column_ids: vec!["col:orders.user_id".into()],
            referenced_table_id: "table:users".into(),
            referenced_column_ids: vec!["col:users.id".into()],
            on_delete: ReferentialAction::NoAction,
            on_update: ReferentialAction::NoAction,
            deferrable: None,
        });
        let graph = ExtractedDatabaseGraph {
            objects: vec![
                table("table:users", Some("pk:users"), Vec::new()),
                table("table:orders", Some("pk:orders"), Vec::new()),
                column(
                    "col:orders.user_id",
                    "table:orders",
                    DatabaseTypeFamily::Text,
                    "text",
                ),
                column(
                    "col:users.id",
                    "table:users",
                    DatabaseTypeFamily::Integer,
                    "serial",
                ),
                foreign_key,
            ],
            edges: Vec::new(),
            provenance: Vec::new(),
        };
        let issues = evaluate_graph_health(&graph);
        let mismatch = issues
            .iter()
            .find(|issue| issue.rule == "FK_TYPE_MISMATCH")
            .expect("type mismatch must be reported");
        assert_eq!(mismatch.code, DatabaseIssueCode::FkTypeMismatch);
        assert!(mismatch
            .object_ids
            .contains(&"col:orders.user_id".to_owned()));
    }

    #[test]
    fn matching_canonical_types_do_not_report_a_mismatch() {
        let foreign_key = DatabaseObject::ForeignKey(ForeignKey {
            meta: meta("fk:orders_user"),
            table_id: "table:orders".into(),
            name: None,
            column_ids: vec!["col:orders.user_id".into()],
            referenced_table_id: "table:users".into(),
            referenced_column_ids: vec!["col:users.id".into()],
            on_delete: ReferentialAction::NoAction,
            on_update: ReferentialAction::NoAction,
            deferrable: None,
        });
        let graph = ExtractedDatabaseGraph {
            objects: vec![
                table("table:users", Some("pk:users"), Vec::new()),
                table("table:orders", Some("pk:orders"), Vec::new()),
                column(
                    "col:orders.user_id",
                    "table:orders",
                    DatabaseTypeFamily::Integer,
                    "integer",
                ),
                column(
                    "col:users.id",
                    "table:users",
                    DatabaseTypeFamily::Integer,
                    "serial",
                ),
                foreign_key,
            ],
            edges: Vec::new(),
            provenance: Vec::new(),
        };
        assert!(evaluate_graph_health(&graph)
            .iter()
            .all(|issue| issue.rule != "FK_TYPE_MISMATCH"));
    }

    #[test]
    fn destructive_proposed_change_is_critical_and_drift_is_separate() {
        let change = DatabaseChange {
            kind: DatabaseChangeKind::Drop,
            object_id: Some("table:users".into()),
            before_fingerprint: Some("a".into()),
            after_fingerprint: None,
            breaking: true,
            destructive: true,
            summary: "drop users".into(),
        };
        let proposed = DatabaseDiff {
            id: "d".into(),
            source_id: "src".into(),
            mode: DatabaseComparisonMode::DeclaredProposedDelta {
                declared_snapshot_id: "snap".into(),
                proposed_revision_id: "rev".into(),
            },
            changes: vec![change.clone()],
            fingerprint: "f".into(),
            created_at: "t".into(),
        };
        assert_eq!(
            evaluate_diff_health(&proposed)[0].code,
            DatabaseIssueCode::DestructiveProposedChange
        );

        let drift = DatabaseDiff {
            mode: DatabaseComparisonMode::DeclaredObservedDrift {
                declared_snapshot_id: "a".into(),
                observed_snapshot_id: "b".into(),
            },
            changes: vec![change],
            ..proposed
        };
        assert_eq!(
            evaluate_diff_health(&drift)[0].code,
            DatabaseIssueCode::Drift
        );
    }
}

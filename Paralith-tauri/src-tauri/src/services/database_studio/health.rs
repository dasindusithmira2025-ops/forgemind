#![allow(dead_code)]

use crate::models::{
    DatabaseChangeKind, DatabaseDiff, DatabaseEdgeType, DatabaseIssueSeverity, DatabaseObject,
    ExtractedDatabaseGraph,
};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HealthIssue {
    pub severity: DatabaseIssueSeverity,
    pub rule: &'static str,
    pub object: String,
    pub reason: String,
    pub evidence: Vec<String>,
}

pub fn evaluate_graph_health(graph: &ExtractedDatabaseGraph) -> Vec<HealthIssue> {
    let mut issues = Vec::new();
    let ids: BTreeSet<_> = graph
        .objects
        .iter()
        .map(|object| object.meta().identity.id.clone())
        .collect();
    for object in &graph.objects {
        if let DatabaseObject::Table(table) = object {
            if table.primary_key_id.is_none() {
                issues.push(issue(
                    DatabaseIssueSeverity::Warning,
                    "MISSING_PRIMARY_KEY",
                    &table.meta.identity.id,
                    "Persisted table has no primary-key object.",
                    vec![table.name.clone()],
                ));
            }
        }
    }
    for edge in &graph.edges {
        if !ids.contains(&edge.source_object_id) || !ids.contains(&edge.target_object_id) {
            issues.push(issue(
                DatabaseIssueSeverity::Error,
                "BROKEN_REFERENCE",
                &edge.id,
                "Edge endpoint is absent from the same graph.",
                vec![edge.source_object_id.clone(), edge.target_object_id.clone()],
            ));
        }
        if edge.edge_type == DatabaseEdgeType::References
            && edge.source_object_id == edge.target_object_id
        {
            issues.push(issue(
                DatabaseIssueSeverity::Error,
                "FK_TYPE_MISMATCH",
                &edge.id,
                "Referencing and referenced columns have incompatible canonical types.",
                vec![edge.id.clone()],
            ));
        }
    }
    let mut indexes: BTreeMap<String, String> = BTreeMap::new();
    for object in &graph.objects {
        if let DatabaseObject::Index(index) = object {
            let key = format!(
                "{}:{:?}:{:?}:{:?}",
                index.table_id, index.unique, index.method, index.keys
            );
            if let Some(existing) = indexes.insert(key, index.meta.identity.id.clone()) {
                issues.push(issue(
                    DatabaseIssueSeverity::Warning,
                    "DUPLICATE_INDEX",
                    &index.meta.identity.id,
                    "Two indexes on one table have the same ordered keys and uniqueness.",
                    vec![existing],
                ));
            }
        }
    }
    issues.sort_by(|left, right| {
        left.rule
            .cmp(right.rule)
            .then(left.object.cmp(&right.object))
    });
    issues
}

pub fn evaluate_diff_health(diff: &DatabaseDiff) -> Vec<HealthIssue> {
    diff.changes
        .iter()
        .filter(|change| change.destructive || change.kind == DatabaseChangeKind::Drop)
        .map(|change| {
            issue(
                DatabaseIssueSeverity::Critical,
                "DESTRUCTIVE_PROPOSED_CHANGE",
                change.object_id.as_deref().unwrap_or("diff"),
                "Declared-to-Proposed diff contains a destructive proposed change.",
                vec![change.summary.clone()],
            )
        })
        .collect()
}

fn issue(
    severity: DatabaseIssueSeverity,
    rule: &'static str,
    object: &str,
    reason: &str,
    evidence: Vec<String>,
) -> HealthIssue {
    HealthIssue {
        severity,
        rule,
        object: object.to_owned(),
        reason: reason.to_owned(),
        evidence,
    }
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

    #[test]
    fn deterministic_health_reports_missing_pk_broken_reference_duplicate_index_and_destructive_change(
    ) {
        let table = DatabaseObject::Table(DatabaseTable {
            meta: meta("table:users"),
            namespace_id: "ns".into(),
            name: "users".into(),
            mapped_name: None,
            comment: None,
            column_ids: Vec::new(),
            primary_key_id: None,
            foreign_key_ids: Vec::new(),
            unique_constraint_ids: Vec::new(),
            check_constraint_ids: Vec::new(),
            index_ids: vec!["idx1".into(), "idx2".into()],
        });
        let key = IndexKey {
            column_id: Some("col:name".into()),
            expression: None,
            direction: None,
            nulls: None,
        };
        let idx1 = DatabaseObject::Index(Index {
            meta: meta("idx1"),
            table_id: "table:users".into(),
            name: "a".into(),
            unique: false,
            method: None,
            keys: vec![key.clone()],
            included_column_ids: Vec::new(),
            predicate: None,
        });
        let idx2 = DatabaseObject::Index(Index {
            meta: meta("idx2"),
            table_id: "table:users".into(),
            name: "b".into(),
            unique: false,
            method: None,
            keys: vec![key],
            included_column_ids: Vec::new(),
            predicate: None,
        });
        let graph = ExtractedDatabaseGraph {
            objects: vec![table, idx1, idx2],
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
        let diff = DatabaseDiff {
            id: "d".into(),
            source_id: "src".into(),
            mode: DatabaseComparisonMode::DeclaredProposedDelta {
                declared_snapshot_id: "snap".into(),
                proposed_revision_id: "rev".into(),
            },
            changes: vec![DatabaseChange {
                kind: DatabaseChangeKind::Drop,
                object_id: Some("table:users".into()),
                before_fingerprint: Some("a".into()),
                after_fingerprint: None,
                breaking: true,
                destructive: true,
                summary: "drop users".into(),
            }],
            fingerprint: "f".into(),
            created_at: "t".into(),
        };
        assert_eq!(
            evaluate_diff_health(&diff)[0].rule,
            "DESTRUCTIVE_PROPOSED_CHANGE"
        );
    }
}

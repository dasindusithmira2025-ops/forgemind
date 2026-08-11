#![allow(dead_code)]

use crate::models::{
    DatabaseChange, DatabaseChangeKind, DatabaseComparisonMode, DatabaseDiff,
    ExtractedDatabaseGraph,
};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

pub fn structural_diff(
    source_id: &str,
    mode: DatabaseComparisonMode,
    before: &ExtractedDatabaseGraph,
    after: &ExtractedDatabaseGraph,
) -> DatabaseDiff {
    let before_map = fingerprints(before);
    let after_map = fingerprints(after);
    let mut changes = Vec::new();
    for (id, before_fp) in &before_map {
        match after_map.get(id) {
            None => changes.push(change(
                DatabaseChangeKind::Drop,
                id,
                Some(before_fp.clone()),
                None,
                true,
                true,
            )),
            Some(after_fp) if after_fp != before_fp => changes.push(change(
                DatabaseChangeKind::Alter,
                id,
                Some(before_fp.clone()),
                Some(after_fp.clone()),
                false,
                false,
            )),
            _ => {}
        }
    }
    for (id, after_fp) in &after_map {
        if !before_map.contains_key(id) {
            changes.push(change(
                DatabaseChangeKind::Add,
                id,
                None,
                Some(after_fp.clone()),
                false,
                false,
            ));
        }
    }
    let fingerprint = digest(
        &changes
            .iter()
            .map(|change| change.summary.as_str())
            .collect::<Vec<_>>()
            .join("|"),
    );
    DatabaseDiff {
        id: format!("dbdiff:{fingerprint}"),
        source_id: source_id.to_owned(),
        mode,
        changes,
        fingerprint,
        created_at: "1970-01-01T00:00:00Z".into(),
    }
}

fn fingerprints(graph: &ExtractedDatabaseGraph) -> BTreeMap<String, String> {
    let mut map = BTreeMap::new();
    for object in &graph.objects {
        map.insert(
            object.meta().identity.id.clone(),
            object.meta().content_fingerprint.clone(),
        );
    }
    map
}

fn change(
    kind: DatabaseChangeKind,
    id: &str,
    before: Option<String>,
    after: Option<String>,
    breaking: bool,
    destructive: bool,
) -> DatabaseChange {
    DatabaseChange {
        kind,
        object_id: Some(id.to_owned()),
        before_fingerprint: before,
        after_fingerprint: after,
        breaking,
        destructive,
        summary: format!("{id} changed"),
    }
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

    fn graph_with_table(id: &str, fp: &str) -> ExtractedDatabaseGraph {
        let meta = DatabaseObjectMeta {
            identity: SemanticIdentity {
                id: id.into(),
                logical_key: id.into(),
                qualified_name: "public.users".into(),
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
            content_fingerprint: fp.into(),
        };
        ExtractedDatabaseGraph {
            objects: vec![DatabaseObject::Table(DatabaseTable {
                meta,
                namespace_id: "ns".into(),
                name: "users".into(),
                mapped_name: None,
                comment: None,
                column_ids: Vec::new(),
                primary_key_id: None,
                foreign_key_ids: Vec::new(),
                unique_constraint_ids: Vec::new(),
                check_constraint_ids: Vec::new(),
                index_ids: Vec::new(),
            })],
            edges: Vec::new(),
            provenance: Vec::new(),
        }
    }

    #[test]
    fn formatting_only_yields_empty_diff() {
        let left = graph_with_table("table:users", "semantic-fingerprint");
        let right = graph_with_table("table:users", "semantic-fingerprint");
        let diff = structural_diff(
            "src",
            DatabaseComparisonMode::DeclaredProposedDelta {
                declared_snapshot_id: "snap".into(),
                proposed_revision_id: "rev".into(),
            },
            &left,
            &right,
        );
        assert!(diff.changes.is_empty());
    }
}

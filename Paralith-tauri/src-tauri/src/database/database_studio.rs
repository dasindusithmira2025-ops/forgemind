#![allow(dead_code)]

use crate::errors::{AppError, AppResult};
use crate::models::{DatabaseSource, DatabaseSourceEvidence};
use rusqlite::{params, Connection};

pub fn insert_source(connection: &Connection, source: &DatabaseSource) -> AppResult<()> {
    connection
        .execute(
            "INSERT INTO database_sources(id,repository_id,logical_key,display_name,engine,owner_project_id,confidence,discovered_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![
                source.id,
                source.repository_id,
                source.logical_key,
                source.display_name,
                serde_json::to_string(&source.engine).map_err(AppError::database)?.trim_matches('"'),
                source.owner_project_id,
                source.confidence,
                source.discovered_at,
                source.updated_at,
            ],
        )
        .map_err(AppError::database)?;
    Ok(())
}

pub fn insert_evidence(
    connection: &Connection,
    source_id: &str,
    evidence: &DatabaseSourceEvidence,
) -> AppResult<()> {
    connection
        .execute(
            "INSERT INTO database_source_evidence(id,source_id,repository_id,project_id,adapter_id,evidence_kind,relative_path,symbol_or_key,safe_value_fingerprint,source_hint,owner_signal,consumer_signal,certainty,confidence,content_sha256,extractor_version,discovered_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)",
            params![
                evidence.id,
                source_id,
                evidence.repository_id,
                evidence.project_id,
                serde_json::to_string(&evidence.adapter_id).map_err(AppError::database)?.trim_matches('"'),
                serde_json::to_string(&evidence.evidence_kind).map_err(AppError::database)?.trim_matches('"'),
                evidence.relative_path,
                evidence.symbol_or_key,
                evidence.safe_value_fingerprint,
                evidence.source_hint,
                evidence.owner_signal,
                evidence.consumer_signal,
                serde_json::to_string(&evidence.certainty).map_err(AppError::database)?.trim_matches('"'),
                evidence.confidence,
                evidence.content_sha256,
                evidence.extractor_version,
                evidence.discovered_at,
            ],
        )
        .map_err(AppError::database)?;
    Ok(())
}

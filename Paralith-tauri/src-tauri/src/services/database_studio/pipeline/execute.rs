//! End-to-end execution of an approved design against the repository.
//!
//! The pipeline is: approved target → current declared → semantic delta → risk classification →
//! native change → repository write → re-extraction → independent target-vs-result comparison.
//!
//! Two rules are absolute here. `DESIGN_ONLY` never reaches this module's write path. A destructive
//! change never reaches it either, unless the caller acknowledged that exact destructive change set.

use std::path::{Path, PathBuf};

use chrono::Utc;
use uuid::Uuid;

use crate::errors::{AppError, AppResult};
use crate::models::{
    DatabaseAdapterId, DatabaseChange, DatabaseComparisonMode, DatabaseDesign, DatabaseEngine,
    DatabaseSource, DatabaseSourceEvidence, ExtractedDatabaseGraph,
};
use crate::services::filesystem_service::ProjectPathGuard;

use super::super::contracts::{
    DatabaseChangeRisk, DatabaseExecutionMode, DatabaseImplementationRun,
    DatabaseImplementationStep, ImplementDatabaseDesignRequest,
};
use super::super::{diff, graph};
use super::native;

pub struct ImplementationInput<'a> {
    pub request: &'a ImplementDatabaseDesignRequest,
    pub project_root: &'a Path,
    pub repository_id: &'a str,
    pub design: &'a DatabaseDesign,
    pub source: &'a DatabaseSource,
    pub evidence: &'a [DatabaseSourceEvidence],
    pub declared: &'a ExtractedDatabaseGraph,
    pub target: &'a ExtractedDatabaseGraph,
}

/// A prepared change that has passed authorization and risk checks but has not been written.
pub struct PreparedChange {
    pub risk: DatabaseChangeRisk,
    pub changes: Vec<DatabaseChange>,
    pub adapter: DatabaseAdapterId,
    pub schema_path: Option<String>,
    pub schema_contents: Option<String>,
    pub migration_path: String,
    pub migration_sql: String,
}

pub fn run(input: ImplementationInput<'_>) -> AppResult<DatabaseImplementationRun> {
    let run_id = format!("dbrun_{}", Uuid::new_v4().simple());
    let mut steps = Vec::new();

    if input.request.execution_mode != DatabaseExecutionMode::ImplementDesign {
        return Err(design_only_refusal());
    }
    step(
        &mut steps,
        "authorize",
        "execution mode is implement_design",
        true,
    );

    if input.design.status != crate::models::DatabaseDesignStatus::Approved {
        return Err(AppError::new(
            "database_design_not_approved",
            "Only an approved design can be implemented.",
            true,
        )
        .entity(&input.design.id)
        .action("Approve the design revision first.")
        .layer("database_studio_pipeline"));
    }
    if input.design.approved_revision_id.as_deref()
        != Some(input.request.approved_revision_id.as_str())
    {
        return Err(AppError::new(
            "database_design_revision_not_approved",
            "The requested revision is not the approved revision for this design.",
            true,
        )
        .entity(&input.request.approved_revision_id)
        .layer("database_studio_pipeline"));
    }
    step(
        &mut steps,
        "authorize",
        "target is the pinned approved revision",
        true,
    );

    let delta = diff::structural_diff(
        &input.source.id,
        DatabaseComparisonMode::DeclaredProposedDelta {
            declared_snapshot_id: String::new(),
            proposed_revision_id: input.request.approved_revision_id.clone(),
        },
        input.declared,
        input.target,
    );
    step(
        &mut steps,
        "delta",
        &format!("{} semantic change(s)", delta.changes.len()),
        true,
    );

    let prepared = prepare(&input, delta.changes.clone())?;
    step(
        &mut steps,
        "plan",
        &format!(
            "{:?} risk, {} adapter",
            prepared.risk,
            adapter_label(&prepared.adapter)
        ),
        prepared.risk != DatabaseChangeRisk::Unsupported,
    );

    if prepared.risk == DatabaseChangeRisk::Unsupported {
        return Err(AppError::new(
            "database_implementation_unsupported",
            "Paralith can generate repository-native changes for Prisma and raw SQL projects only.",
            true,
        )
        .detail(format!(
            "adapters detected: {}",
            input
                .source
                .adapter_ids
                .iter()
                .map(adapter_label)
                .collect::<Vec<_>>()
                .join(", ")
        ))
        .layer("database_studio_pipeline"));
    }

    if prepared.risk == DatabaseChangeRisk::Destructive && !input.request.acknowledge_destructive {
        let destructive: Vec<String> = prepared
            .changes
            .iter()
            .filter(|change| change.destructive)
            .map(|change| change.summary.clone())
            .collect();
        return Err(AppError::new(
            "database_destructive_change_not_acknowledged",
            "This design destroys existing data, so Paralith stopped before changing anything.",
            true,
        )
        .detail(destructive.join("; "))
        .action("Review the destructive changes and confirm them explicitly to continue.")
        .layer("database_studio_pipeline"));
    }

    if input.request.dry_run {
        step(
            &mut steps,
            "dry_run",
            "no repository file was written",
            true,
        );
        return Ok(DatabaseImplementationRun {
            run_id,
            design_id: input.design.id.clone(),
            target_revision_id: input.request.approved_revision_id.clone(),
            phase: "planned".into(),
            completed: steps.len(),
            total: steps.len(),
            risk: prepared.risk,
            dry_run: true,
            changed_files: Vec::new(),
            migration_path: Some(prepared.migration_path),
            steps,
            verified: false,
            residual_changes: Vec::new(),
        });
    }

    let guard = ProjectPathGuard::new(input.project_root)?;
    let mut changed_files = Vec::new();
    if let (Some(path), Some(contents)) = (&prepared.schema_path, &prepared.schema_contents) {
        let (_, absolute) = guard.resolve_existing(path)?;
        std::fs::write(&absolute, contents).map_err(write_error)?;
        changed_files.push(path.clone());
        step(&mut steps, "schema", path, true);
    }
    write_migration(&guard, &prepared.migration_path, &prepared.migration_sql)?;
    changed_files.push(prepared.migration_path.clone());
    step(&mut steps, "migration", &prepared.migration_path, true);

    // Independent verification: re-discover the repository and re-run the adapters against the
    // files that now exist on disk. Re-discovery matters — the generated migration is a new piece of
    // evidence, and reusing the pre-change evidence list would verify the wrong thing.
    let rediscovered = graph::discover_project(input.repository_id, input.project_root)?;
    let evidence = rediscovered
        .iter()
        .find(|candidate| candidate.source.logical_key == input.source.logical_key)
        .map(|candidate| candidate.evidence.clone())
        .unwrap_or_else(|| input.evidence.to_vec());
    let (re_extracted, _) = graph::extract_declared_graph(
        input.repository_id,
        input.project_root,
        input.source,
        &evidence,
        None,
    )?;
    let verification = diff::structural_diff(
        &input.source.id,
        DatabaseComparisonMode::DeclaredProposedDelta {
            declared_snapshot_id: String::new(),
            proposed_revision_id: input.request.approved_revision_id.clone(),
        },
        &re_extracted,
        input.target,
    );
    let verified = diff::is_zero_delta(&verification);
    step(
        &mut steps,
        "verify",
        if verified {
            "re-extracted schema matches the approved target exactly"
        } else {
            "re-extracted schema still differs from the approved target"
        },
        verified,
    );

    Ok(DatabaseImplementationRun {
        run_id,
        design_id: input.design.id.clone(),
        target_revision_id: input.request.approved_revision_id.clone(),
        phase: if verified { "verified" } else { "unverified" }.into(),
        completed: steps.iter().filter(|step| step.ok).count(),
        total: steps.len(),
        risk: prepared.risk,
        dry_run: false,
        changed_files,
        migration_path: Some(prepared.migration_path),
        steps,
        verified,
        residual_changes: verification.changes,
    })
}

/// Build the repository-native change without touching the filesystem.
pub fn prepare(
    input: &ImplementationInput<'_>,
    changes: Vec<DatabaseChange>,
) -> AppResult<PreparedChange> {
    let adapter = if input
        .source
        .adapter_ids
        .contains(&DatabaseAdapterId::Prisma)
    {
        DatabaseAdapterId::Prisma
    } else if input
        .source
        .adapter_ids
        .contains(&DatabaseAdapterId::RawSql)
        || input
            .source
            .adapter_ids
            .contains(&DatabaseAdapterId::Sqlite)
    {
        DatabaseAdapterId::RawSql
    } else {
        return Ok(PreparedChange {
            risk: DatabaseChangeRisk::Unsupported,
            changes,
            adapter: input
                .source
                .adapter_ids
                .first()
                .cloned()
                .unwrap_or(DatabaseAdapterId::RawSql),
            schema_path: None,
            schema_contents: None,
            migration_path: String::new(),
            migration_sql: String::new(),
        });
    };

    let risk = classify(&changes);
    let stamp = Utc::now().format("%Y%m%d%H%M%S").to_string();
    let slug = slugify(&input.design.name);
    let migration_sql = native::generate_sql_migration(
        &input.source.engine,
        &changes,
        input.declared,
        input.target,
    );

    let (schema_path, schema_contents, migration_path) = match adapter {
        DatabaseAdapterId::Prisma => {
            let schema_path = input
                .evidence
                .iter()
                .find(|evidence| evidence.relative_path.ends_with(".prisma"))
                .map(|evidence| evidence.relative_path.clone())
                .ok_or_else(|| {
                    AppError::new(
                        "database_schema_file_missing",
                        "Paralith could not find the Prisma schema file to update.",
                        true,
                    )
                    .layer("database_studio_pipeline")
                })?;
            let current = std::fs::read_to_string(input.project_root.join(&schema_path))
                .map_err(write_error)?;
            let regenerated = native::generate_prisma_schema(&current, input.target);
            let directory = Path::new(&schema_path)
                .parent()
                .map(|parent| parent.to_string_lossy().replace('\\', "/"))
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| "prisma".to_owned());
            (
                Some(schema_path),
                Some(regenerated),
                format!("{directory}/migrations/{stamp}_{slug}/migration.sql"),
            )
        }
        _ => {
            // Raw-SQL repositories keep their existing migration convention: a new file beside the
            // migrations that are already there, or beside the schema when none exist yet.
            let directory = input
                .evidence
                .iter()
                .find(|evidence| evidence.relative_path.contains("/migrations/"))
                .and_then(|evidence| {
                    Path::new(&evidence.relative_path)
                        .parent()
                        .map(|parent| parent.to_string_lossy().replace('\\', "/"))
                })
                .or_else(|| {
                    input
                        .evidence
                        .iter()
                        .find(|evidence| evidence.relative_path.ends_with(".sql"))
                        .and_then(|evidence| {
                            Path::new(&evidence.relative_path)
                                .parent()
                                .map(|parent| parent.to_string_lossy().replace('\\', "/"))
                        })
                })
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| "migrations".to_owned());
            (None, None, format!("{directory}/{stamp}_{slug}.sql"))
        }
    };

    Ok(PreparedChange {
        risk,
        changes,
        adapter,
        schema_path,
        schema_contents,
        migration_path,
        migration_sql,
    })
}

/// Risk is derived from the semantic delta, never from a keyword scan of generated SQL.
pub fn classify(changes: &[DatabaseChange]) -> DatabaseChangeRisk {
    if changes.iter().any(|change| change.destructive) {
        DatabaseChangeRisk::Destructive
    } else if changes.iter().any(|change| change.breaking) {
        DatabaseChangeRisk::Review
    } else {
        DatabaseChangeRisk::Safe
    }
}

fn write_migration(guard: &ProjectPathGuard, relative: &str, sql: &str) -> AppResult<()> {
    // The migration directory usually does not exist yet, so the parent chain is created inside the
    // guarded root before the guard resolves the final leaf.
    let (_, root) = guard.resolve_existing("")?;
    let mut absolute: PathBuf = root.clone();
    for part in relative.split('/') {
        if part.is_empty() || part == "." || part == ".." {
            return Err(AppError::new(
                "database_migration_path_denied",
                "The generated migration path is not a valid Project-relative path.",
                false,
            )
            .layer("database_studio_pipeline"));
        }
        absolute.push(part);
    }
    if !absolute.starts_with(&root) {
        return Err(AppError::new(
            "database_migration_path_denied",
            "The generated migration path resolves outside the Project root.",
            false,
        )
        .layer("database_studio_pipeline"));
    }
    if let Some(parent) = absolute.parent() {
        std::fs::create_dir_all(parent).map_err(write_error)?;
    }
    std::fs::write(&absolute, sql).map_err(write_error)?;
    Ok(())
}

fn design_only_refusal() -> AppError {
    AppError::new(
        "database_design_only_mode",
        "This task is planning-only, so it cannot change the repository or a database.",
        true,
    )
    .action("Run this again as an implementation task to apply the approved design.")
    .layer("database_studio_pipeline")
}

fn write_error(error: std::io::Error) -> AppError {
    AppError::new(
        "database_implementation_write_failed",
        "Paralith could not write the generated schema or migration.",
        true,
    )
    .detail(error.to_string())
    .layer("database_studio_pipeline")
}

fn step(steps: &mut Vec<DatabaseImplementationStep>, phase: &str, detail: &str, ok: bool) {
    steps.push(DatabaseImplementationStep {
        phase: phase.to_owned(),
        detail: detail.to_owned(),
        ok,
    });
}

fn adapter_label(adapter: &DatabaseAdapterId) -> String {
    match adapter {
        DatabaseAdapterId::Prisma => "prisma",
        DatabaseAdapterId::Drizzle => "drizzle",
        DatabaseAdapterId::RawSql => "raw_sql",
        DatabaseAdapterId::Sqlite => "sqlite",
        DatabaseAdapterId::Postgres => "postgres",
        DatabaseAdapterId::Mysql => "mysql",
    }
    .to_owned()
}

fn slugify(value: &str) -> String {
    let slug: String = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = slug.trim_matches('_').to_owned();
    if trimmed.is_empty() {
        "paralith_design".to_owned()
    } else {
        trimmed
    }
}

/// Engines whose generated DDL Paralith knows how to spell.
pub fn supported_engine(engine: &DatabaseEngine) -> bool {
    !matches!(engine, DatabaseEngine::Unknown)
}

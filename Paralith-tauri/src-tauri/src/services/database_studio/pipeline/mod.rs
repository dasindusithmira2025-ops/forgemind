//! Authorized Database Studio implementation pipeline.
//!
//! Static discovery/extraction remains command-free. Only an already-authorized implementation
//! plan may cross this module's exhaustive argv boundary. Raw SQL never launches a process.

pub mod execute;
pub mod native;

use crate::errors::{AppError, AppResult};
use crate::models::DatabaseAdapterId;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PackageManager {
    Npm,
    Pnpm,
    Yarn,
    Bun,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NativeChangePlan {
    Prisma {
        package_manager: PackageManager,
        current_schema: PathBuf,
        target_schema: PathBuf,
        output_migration: PathBuf,
    },
    RawSql {
        output_migration: PathBuf,
        sql: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthorizedImplementation {
    pub authorization_id: String,
    pub approved_target_revision_id: String,
    pub expected_repository_head: String,
    pub expected_branch: String,
    pub plan: NativeChangePlan,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AllowedCommand {
    pub executable: &'static str,
    pub args: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SemanticManifest {
    pub namespace_fingerprints: BTreeSet<String>,
    pub object_fingerprints: BTreeSet<String>,
    pub edge_fingerprints: BTreeSet<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IndependentValidation {
    pub statement_count: usize,
    pub destructive_statements: Vec<String>,
    pub represented_target_fingerprints: bool,
}

pub fn authorized_commands(
    authorization: &AuthorizedImplementation,
) -> AppResult<Vec<AllowedCommand>> {
    if authorization.authorization_id.trim().is_empty()
        || authorization.approved_target_revision_id.trim().is_empty()
        || authorization.expected_repository_head.trim().is_empty()
        || authorization.expected_branch.trim().is_empty()
    {
        return Err(pipeline_error(
            "DATABASE_IMPLEMENTATION_AUTHORIZATION_REQUIRED",
            "Implementation requires a complete pinned authorization envelope.",
        ));
    }
    match &authorization.plan {
        NativeChangePlan::RawSql { .. } => Ok(Vec::new()),
        NativeChangePlan::Prisma {
            package_manager,
            current_schema,
            target_schema,
            ..
        } => {
            let current = project_relative_argument(current_schema)?;
            let target = project_relative_argument(target_schema)?;
            let (executable, prefix): (&'static str, Vec<&str>) = match package_manager {
                PackageManager::Npm => ("npm", vec!["exec", "--", "prisma"]),
                PackageManager::Pnpm => ("pnpm", vec!["exec", "prisma"]),
                PackageManager::Yarn => ("yarn", vec!["prisma"]),
                PackageManager::Bun => ("bunx", vec!["prisma"]),
            };
            let mut validate = prefix
                .iter()
                .map(|value| (*value).to_owned())
                .collect::<Vec<_>>();
            validate.extend(["validate".into(), "--schema".into(), current.clone()]);
            let mut diff = prefix.into_iter().map(str::to_owned).collect::<Vec<_>>();
            diff.extend([
                "migrate".into(),
                "diff".into(),
                "--from-schema-datamodel".into(),
                current,
                "--to-schema-datamodel".into(),
                target,
                "--script".into(),
            ]);
            Ok(vec![
                AllowedCommand {
                    executable,
                    args: validate,
                },
                AllowedCommand {
                    executable,
                    args: diff,
                },
            ])
        }
    }
}

pub fn command_is_allow_listed(command: &AllowedCommand) -> bool {
    let Some(prisma_index) = command.args.iter().position(|arg| arg == "prisma") else {
        return false;
    };
    let prefix_ok = match command.executable {
        "npm" => {
            command.args.get(..=prisma_index)
                == Some(&["exec".into(), "--".into(), "prisma".into()][..])
        }
        "pnpm" => command.args.get(..=prisma_index) == Some(&["exec".into(), "prisma".into()][..]),
        "yarn" | "bunx" => prisma_index == 0,
        _ => false,
    };
    if !prefix_ok {
        return false;
    }
    let tail = &command.args[prisma_index + 1..];
    matches!(tail, [validate, schema, path] if validate == "validate" && schema == "--schema" && safe_relative(path))
        || matches!(tail, [migrate, diff, from, current, to, target, script]
            if migrate == "migrate" && diff == "diff"
                && from == "--from-schema-datamodel" && safe_relative(current)
                && to == "--to-schema-datamodel" && safe_relative(target) && script == "--script")
}

pub fn independently_validate_sql(
    sql: &str,
    target: &SemanticManifest,
    result: &SemanticManifest,
) -> AppResult<IndependentValidation> {
    let statements = split_sql_statements(sql)?;
    let destructive_statements = statements
        .iter()
        .filter(|statement| {
            let normalized = statement.trim_start().to_ascii_uppercase();
            normalized.starts_with("DROP ")
                || normalized.contains(" DROP COLUMN ")
                || normalized.starts_with("TRUNCATE ")
        })
        .cloned()
        .collect();
    let represented = target
        .namespace_fingerprints
        .is_subset(&result.namespace_fingerprints)
        && target
            .object_fingerprints
            .is_subset(&result.object_fingerprints)
        && target
            .edge_fingerprints
            .is_subset(&result.edge_fingerprints);
    Ok(IndependentValidation {
        statement_count: statements.len(),
        destructive_statements,
        represented_target_fingerprints: represented,
    })
}

pub fn target_vs_result_zero_delta(
    target: &SemanticManifest,
    result: &SemanticManifest,
) -> AppResult<()> {
    if target == result {
        Ok(())
    } else {
        Err(pipeline_error(
            "DATABASE_IMPLEMENTATION_NON_ZERO_DELTA",
            "Static re-extraction does not match the approved target revision.",
        ))
    }
}

pub fn verify_pipeline_result(
    adapter: DatabaseAdapterId,
    sql: &str,
    target: &SemanticManifest,
    re_extracted: &SemanticManifest,
) -> AppResult<IndependentValidation> {
    if !matches!(
        adapter,
        DatabaseAdapterId::Prisma | DatabaseAdapterId::RawSql
    ) {
        return Err(pipeline_error(
            "DATABASE_IMPLEMENTATION_ADAPTER_UNSUPPORTED",
            "V1 implementation supports Prisma and raw SQL only.",
        ));
    }
    let independent = independently_validate_sql(sql, target, re_extracted)?;
    if !independent.represented_target_fingerprints {
        return Err(pipeline_error(
            "DATABASE_IMPLEMENTATION_TARGET_NOT_REPRESENTED",
            "Independent fingerprint validation did not find every approved target entity.",
        ));
    }
    target_vs_result_zero_delta(target, re_extracted)?;
    Ok(independent)
}

fn project_relative_argument(path: &Path) -> AppResult<String> {
    let value = path.to_string_lossy().replace('\\', "/");
    if !safe_relative(&value) {
        return Err(pipeline_error(
            "DATABASE_IMPLEMENTATION_PATH_DENIED",
            "Implementation paths must be canonical Project-relative paths.",
        ));
    }
    Ok(value)
}

fn safe_relative(path: &str) -> bool {
    !path.is_empty()
        && !path.starts_with('/')
        && !path.contains(':')
        && !path.split('/').any(|part| part == ".." || part.is_empty())
}

fn split_sql_statements(sql: &str) -> AppResult<Vec<String>> {
    let mut statements = Vec::new();
    let mut current = String::new();
    let mut quote = None;
    for character in sql.chars() {
        match (quote, character) {
            (Some(active), next) if next == active => {
                quote = None;
                current.push(next);
            }
            (None, '\'' | '"') => {
                quote = Some(character);
                current.push(character);
            }
            (None, ';') => {
                if !current.trim().is_empty() {
                    statements.push(current.trim().to_owned());
                }
                current.clear();
            }
            _ => current.push(character),
        }
    }
    if quote.is_some() {
        return Err(pipeline_error(
            "DATABASE_IMPLEMENTATION_SQL_INVALID",
            "Generated SQL contains an unterminated quoted value.",
        ));
    }
    if !current.trim().is_empty() {
        statements.push(current.trim().to_owned());
    }
    if statements.is_empty() {
        return Err(pipeline_error(
            "DATABASE_IMPLEMENTATION_SQL_EMPTY",
            "Generated migration SQL is empty.",
        ));
    }
    Ok(statements)
}

fn pipeline_error(code: &str, message: &str) -> AppError {
    AppError::new(code, message, true).layer("database_studio_pipeline")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(values: &[&str]) -> SemanticManifest {
        SemanticManifest {
            namespace_fingerprints: BTreeSet::from(["ns-main".into()]),
            object_fingerprints: values.iter().map(|value| (*value).to_owned()).collect(),
            edge_fingerprints: BTreeSet::from(["edge-user-post".into()]),
        }
    }

    #[test]
    fn target_vs_result_comparison_proves_zero_delta_on_fixture() {
        let target = manifest(&["table-user", "table-post"]);
        let independently_re_extracted = manifest(&["table-user", "table-post"]);
        let result = verify_pipeline_result(
            DatabaseAdapterId::RawSql,
            "CREATE TABLE post(id INTEGER);",
            &target,
            &independently_re_extracted,
        )
        .unwrap();
        assert!(result.represented_target_fingerprints);
        assert_eq!(result.statement_count, 1);
    }

    #[test]
    fn prisma_command_allow_list_rejects_arbitrary_scripts_and_migrate_deploy() {
        for args in [
            vec!["run".into(), "postinstall".into()],
            vec!["prisma".into(), "migrate".into(), "deploy".into()],
        ] {
            assert!(!command_is_allow_listed(&AllowedCommand {
                executable: "npm",
                args
            }));
        }
    }

    #[test]
    fn raw_sql_plan_executes_no_repository_command() {
        let authorization = AuthorizedImplementation {
            authorization_id: "auth-1".into(),
            approved_target_revision_id: "revision-1".into(),
            expected_repository_head: "abc".into(),
            expected_branch: "feat/database-studio".into(),
            plan: NativeChangePlan::RawSql {
                output_migration: "migrations/001.sql".into(),
                sql: "CREATE TABLE t(id INT);".into(),
            },
        };
        assert!(authorized_commands(&authorization).unwrap().is_empty());
    }
}

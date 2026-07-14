use crate::errors::{AppError, AppResult};
use crate::models::{
    AcceptanceCriterion, MissionTask, VerificationCheckDefinition, VerificationResult,
};
use std::collections::{HashMap, HashSet};

const TERMINAL_TASK_STATUSES: &[&str] = &["passed", "failed", "cancelled"];

pub fn validate_dependencies(tasks: &[MissionTask]) -> AppResult<()> {
    let ids: HashSet<&str> = tasks.iter().map(|task| task.id.as_str()).collect();
    for task in tasks {
        if task.dependency_ids.iter().any(|id| id == &task.id) {
            return Err(domain_error(
                "dependency_cycle",
                "A task cannot depend on itself.",
                &task.id,
            ));
        }
        if let Some(missing) = task
            .dependency_ids
            .iter()
            .find(|id| !ids.contains(id.as_str()))
        {
            return Err(domain_error(
                "missing_dependency",
                "A task references a dependency that does not exist in this mission.",
                missing,
            ));
        }
    }

    let by_id: HashMap<&str, &MissionTask> =
        tasks.iter().map(|task| (task.id.as_str(), task)).collect();
    let mut visiting = HashSet::new();
    let mut visited = HashSet::new();
    fn visit<'a>(
        id: &'a str,
        by_id: &HashMap<&'a str, &'a MissionTask>,
        visiting: &mut HashSet<&'a str>,
        visited: &mut HashSet<&'a str>,
    ) -> AppResult<()> {
        if visited.contains(id) {
            return Ok(());
        }
        if !visiting.insert(id) {
            return Err(domain_error(
                "dependency_cycle",
                "Task dependencies contain a cycle.",
                id,
            ));
        }
        if let Some(task) = by_id.get(id) {
            for dependency in &task.dependency_ids {
                visit(dependency, by_id, visiting, visited)?;
            }
        }
        visiting.remove(id);
        visited.insert(id);
        Ok(())
    }
    for task in tasks {
        visit(&task.id, &by_id, &mut visiting, &mut visited)?;
    }
    Ok(())
}

pub fn evaluated_status(task: &MissionTask, by_id: &HashMap<&str, &MissionTask>) -> &'static str {
    if TERMINAL_TASK_STATUSES.contains(&task.status.as_str())
        || matches!(
            task.status.as_str(),
            "running" | "starting" | "verifying" | "review" | "waiting-for-input"
        )
    {
        return "unchanged";
    }
    if task.dependency_ids.iter().any(|id| {
        by_id.get(id.as_str()).is_some_and(|dependency| {
            matches!(
                dependency.status.as_str(),
                "failed" | "cancelled" | "blocked"
            )
        })
    }) {
        return "blocked";
    }
    if task.dependency_ids.iter().all(|id| {
        by_id
            .get(id.as_str())
            .is_some_and(|dependency| dependency.status == "passed")
    }) {
        "ready"
    } else {
        "pending"
    }
}

pub fn ready_task_ids(tasks: &[MissionTask]) -> AppResult<Vec<String>> {
    validate_dependencies(tasks)?;
    let by_id: HashMap<&str, &MissionTask> =
        tasks.iter().map(|task| (task.id.as_str(), task)).collect();
    Ok(tasks
        .iter()
        .filter(|task| {
            matches!(evaluated_status(task, &by_id), "ready")
                && matches!(task.status.as_str(), "pending" | "ready" | "blocked")
        })
        .map(|task| task.id.clone())
        .collect())
}

pub fn mission_transition_allowed(from: &str, to: &str) -> bool {
    if from == to {
        return true;
    }
    matches!(
        (from, to),
        ("draft", "planning")
            | ("draft", "cancelled")
            | ("planning", "ready")
            | ("planning", "draft")
            | ("planning", "cancelled")
            | ("ready", "running")
            | ("ready", "planning")
            | ("ready", "cancelled")
            | ("running", "blocked")
            | ("running", "verifying")
            | ("running", "review")
            | ("running", "failed")
            | ("running", "cancelled")
            | ("blocked", "running")
            | ("blocked", "failed")
            | ("blocked", "cancelled")
            | ("verifying", "review")
            | ("verifying", "blocked")
            | ("verifying", "failed")
            | ("verifying", "cancelled")
            | ("review", "running")
            | ("review", "completed")
            | ("review", "failed")
            | ("review", "cancelled")
            | ("failed", "planning")
            | ("failed", "running")
    )
}

pub fn verification_passed(
    checks: &[VerificationCheckDefinition],
    results: &[VerificationResult],
) -> bool {
    checks.iter().filter(|check| check.required).all(|check| {
        results
            .iter()
            .rev()
            .find(|result| result.check_id == check.id)
            .is_some_and(|result| result.status == "passed")
    })
}

pub fn criterion_status(
    criterion: &AcceptanceCriterion,
    evidence_statuses: &HashMap<&str, &str>,
) -> &'static str {
    if criterion.evidence_ids.is_empty() {
        return "unverified";
    }
    if criterion.evidence_ids.iter().any(|id| {
        evidence_statuses
            .get(id.as_str())
            .is_some_and(|status| *status == "failed")
    }) {
        return "failed";
    }
    if criterion.evidence_ids.iter().all(|id| {
        evidence_statuses
            .get(id.as_str())
            .is_some_and(|status| *status == "passed")
    }) {
        "passed"
    } else {
        "pending"
    }
}

pub fn sanitize_slug(value: &str, max_len: usize) -> String {
    let mut result = String::with_capacity(value.len().min(max_len));
    let mut dash = false;
    for character in value.chars().flat_map(char::to_lowercase) {
        if character.is_ascii_alphanumeric() {
            result.push(character);
            dash = false;
        } else if !dash && !result.is_empty() {
            result.push('-');
            dash = true;
        }
        if result.len() >= max_len {
            break;
        }
    }
    result.trim_matches('-').trim_end_matches('.').to_owned()
}

pub fn redact_secrets(input: &str) -> String {
    let sensitive = [
        "token",
        "password",
        "passwd",
        "secret",
        "api_key",
        "apikey",
        "authorization",
        "private_key",
    ];
    input
        .lines()
        .map(|line| {
            let lower = line.to_ascii_lowercase();
            let assignment_key = line.split_once('=').map(|(key, _)| {
                key.trim_start_matches(['+', '-', ' '])
                    .trim()
                    .to_ascii_uppercase()
            });
            let sensitive_assignment = assignment_key.as_deref().is_some_and(|key| {
                [
                    "TOKEN",
                    "PASSWORD",
                    "PASSWD",
                    "SECRET",
                    "PRIVATE",
                    "CREDENTIAL",
                    "API_KEY",
                    "ACCESS_KEY",
                    "DATABASE_URL",
                    "REDIS_URL",
                    "SMTP_URL",
                    "SESSION_KEY",
                ]
                .iter()
                .any(|marker| key.contains(marker))
            });
            let credential_url = lower.contains("://")
                && lower.split_once("://").is_some_and(|(_, rest)| {
                    rest.split('/')
                        .next()
                        .is_some_and(|authority| authority.contains('@') && authority.contains(':'))
                });
            if sensitive_assignment
                || credential_url
                || sensitive.iter().any(|key| lower.contains(key))
            {
                if let Some((key, _)) = line.split_once('=') {
                    return format!("{}=[REDACTED]", key.trim());
                }
                if let Some((key, _)) = line.split_once(':') {
                    return format!("{}: [REDACTED]", key.trim());
                }
                "[REDACTED SENSITIVE OUTPUT]".to_owned()
            } else {
                line.to_owned()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn merge_blockers(
    task: &MissionTask,
    required_verification_passed: bool,
    has_conflicts: bool,
    worktree_status: Option<&str>,
) -> Vec<String> {
    let mut blockers = Vec::new();
    if task.status != "passed" {
        blockers.push("Task has not been explicitly accepted.".into());
    }
    if !required_verification_passed {
        blockers.push("One or more required verification checks have not passed.".into());
    }
    if has_conflicts {
        blockers.push("The task worktree contains unresolved conflicts.".into());
    }
    if !matches!(worktree_status, Some("ready") | Some("dirty")) {
        blockers.push("The task does not have a mergeable ForgeMind-owned worktree.".into());
    }
    blockers
}

fn domain_error(code: &'static str, message: &'static str, entity: &str) -> AppError {
    AppError::new(code, message, true)
        .entity(entity)
        .layer("mission-domain")
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn task(id: &str, status: &str, dependencies: &[&str]) -> MissionTask {
        MissionTask {
            id: id.into(),
            mission_id: "m".into(),
            title: id.into(),
            description: String::new(),
            agent_id: None,
            role: None,
            status: status.into(),
            dependency_ids: dependencies.iter().map(|v| (*v).into()).collect(),
            acceptance_criterion_ids: Vec::new(),
            working_directory: None,
            worktree_id: None,
            session_id: None,
            verification_profile_id: None,
            priority: 0,
            attempt: 0,
            execution_lock: None,
            started_at: None,
            completed_at: None,
            created_at: Utc::now().to_rfc3339(),
            updated_at: Utc::now().to_rfc3339(),
        }
    }

    #[test]
    fn dependency_cycles_are_rejected() {
        let error =
            validate_dependencies(&[task("a", "pending", &["b"]), task("b", "pending", &["a"])])
                .unwrap_err();
        assert_eq!(error.code, "dependency_cycle");
    }

    #[test]
    fn ready_calculation_is_deterministic_and_failures_block_dependents() {
        let tasks = vec![
            task("root", "passed", &[]),
            task("ready", "pending", &["root"]),
            task("failed", "failed", &[]),
            task("blocked", "pending", &["failed"]),
        ];
        assert_eq!(ready_task_ids(&tasks).unwrap(), vec!["ready".to_owned()]);
        let by_id = tasks.iter().map(|task| (task.id.as_str(), task)).collect();
        assert_eq!(evaluated_status(&tasks[3], &by_id), "blocked");
    }

    #[test]
    fn branch_slugs_are_portable_and_bounded() {
        assert_eq!(
            sanitize_slug(" Auth: API / Windows? ", 18),
            "auth-api-windows"
        );
        assert!(sanitize_slug("CON<>very very long task", 12).len() <= 12);
    }

    #[test]
    fn secret_redaction_removes_values() {
        let output = redact_secrets("ok\nAPI_KEY=super-secret\nAuthorization: Bearer abc\n+DATABASE_URL=postgres://user:pass@host/db");
        assert!(!output.contains("super-secret"));
        assert!(!output.contains("Bearer abc"));
        assert!(!output.contains("user:pass"));
        assert!(output.contains("[REDACTED]"));
    }

    #[test]
    fn required_check_failure_blocks_merge() {
        let task = task("a", "passed", &[]);
        assert!(!merge_blockers(&task, false, false, Some("ready")).is_empty());
        assert!(merge_blockers(&task, true, false, Some("ready")).is_empty());
    }

    #[test]
    fn mission_transitions_reject_skipping_review_and_allow_retry() {
        assert!(mission_transition_allowed("review", "completed"));
        assert!(mission_transition_allowed("failed", "planning"));
        assert!(!mission_transition_allowed("draft", "completed"));
        assert!(!mission_transition_allowed("completed", "running"));
    }

    #[test]
    fn criterion_status_aggregates_every_linked_evidence_record() {
        let criterion = AcceptanceCriterion {
            id: "criterion".into(),
            mission_id: "mission".into(),
            description: "Proof".into(),
            required: true,
            status: "pending".into(),
            evidence_ids: vec!["one".into(), "two".into()],
        };
        let mut statuses = HashMap::from([("one", "passed"), ("two", "passed")]);
        assert_eq!(criterion_status(&criterion, &statuses), "passed");
        statuses.insert("two", "failed");
        assert_eq!(criterion_status(&criterion, &statuses), "failed");
    }
}

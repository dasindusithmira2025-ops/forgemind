//! Tauri command surface for Mission Control.
//!
//! Every command here is a **domain action** or a read. There is deliberately no
//! `set_mission_status`: the frontend may ask for a Mission to be prepared, started, revised,
//! retried, cancelled or accepted, and it may observe what was persisted, but it can never write
//! a Mission's or a Task's lifecycle state. That is what keeps the state machines invariants
//! rather than something a component could corrupt.
//!
//! Validation happens here because the renderer is untrusted input. Mission text reaches an agent
//! prompt and file hints reach a worktree's scope, so both are bounded and path-checked at this
//! boundary before anything downstream has to assume they are safe.
//!
//! Missions are supervised from the main PARALITH window, like Swarms, Runs and the Repository
//! Command Center, so every command requires the main-window scope.

use crate::commands::run_commands::reject_unsafe_project_path;
use crate::errors::{AppError, AppResult};
use crate::models::mission::*;
use crate::models::run::Run;
use crate::AppState;
use tauri::{State, Window};

/// Ceilings on caller-supplied Mission text. These are not style rules: an objective becomes an
/// agent instruction and a Context Fabric query, so an unbounded one is a cost and a correctness
/// problem, not just a long string.
const MAX_OBJECTIVE_CHARS: usize = 4_000;
const MAX_TITLE_CHARS: usize = 200;
const MAX_LIST_ITEMS: usize = 30;
const MAX_LIST_ITEM_CHARS: usize = 500;
const MAX_PLAN_TASKS: usize = 60;
const MAX_PLAN_CRITERIA: usize = 40;
const MAX_KEY_CHARS: usize = 24;

async fn run_blocking<T: Send + 'static>(
    operation: impl FnOnce() -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| {
            AppError::new(
                "mission_task_failed",
                "The Mission operation stopped unexpectedly.",
                true,
            )
            .detail(error.to_string())
        })?
}

fn invalid(code: &'static str, message: impl Into<String>) -> AppError {
    AppError::new(code, message, true).layer("ipc")
}

fn validate_text(value: &str, max: usize, code: &'static str, label: &str) -> AppResult<()> {
    if value.trim().is_empty() {
        return Err(invalid(code, format!("{label} cannot be empty.")));
    }
    if value.chars().count() > max {
        return Err(invalid(code, format!("{label} is too long.")));
    }
    Ok(())
}

fn validate_list(values: &[String], code: &'static str, label: &str) -> AppResult<()> {
    if values.len() > MAX_LIST_ITEMS {
        return Err(invalid(code, format!("Too many {label}.")));
    }
    for value in values {
        validate_text(value, MAX_LIST_ITEM_CHARS, code, label)?;
    }
    Ok(())
}

/// A plan key is an identity the Proof Ledger will one day resolve. Keep it to characters that
/// can be displayed, referenced and compared without escaping.
fn validate_key(key: &str) -> AppResult<()> {
    let trimmed = key.trim();
    if trimmed.is_empty() || trimmed.chars().count() > MAX_KEY_CHARS {
        return Err(invalid(
            "mission_key_invalid",
            "Plan keys must be short, non-empty identifiers such as T1 or AC-01.",
        ));
    }
    if !trimmed
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '-' || character == '_')
    {
        return Err(invalid(
            "mission_key_invalid",
            "Plan keys may only contain letters, digits, hyphens and underscores.",
        ));
    }
    Ok(())
}

fn validate_create(request: &CreateMissionRequest) -> AppResult<()> {
    if request.project_id.trim().is_empty() {
        return Err(invalid(
            "mission_project_required",
            "A Mission must belong to a Project.",
        ));
    }
    validate_text(
        &request.objective,
        MAX_OBJECTIVE_CHARS,
        "mission_objective_invalid",
        "The objective",
    )?;
    if let Some(title) = request.title.as_deref() {
        validate_text(title, MAX_TITLE_CHARS, "mission_title_invalid", "The title")?;
    }
    validate_list(
        &request.constraints,
        "mission_constraint_invalid",
        "constraints",
    )?;
    validate_list(&request.non_goals, "mission_non_goal_invalid", "non-goals")?;
    validate_list(&request.risks, "mission_risk_invalid", "risks")?;
    Ok(())
}

/// Validate a plan a person (or a planning agent, via the same path) proposes.
///
/// Structural validity — cycles, unknown references — is checked by the domain and the
/// persistence layer inside the transaction that writes it. This is the *input* check: bounded
/// sizes, well-formed keys, and file hints that cannot escape the Project.
fn validate_plan(plan: &MissionPlanDraft) -> AppResult<()> {
    if plan.tasks.is_empty() {
        return Err(invalid(
            "mission_plan_empty",
            "A Mission plan needs at least one Task.",
        ));
    }
    if plan.tasks.len() > MAX_PLAN_TASKS {
        return Err(invalid(
            "mission_plan_too_large",
            "That plan has more Tasks than a Mission can coordinate.",
        ));
    }
    if plan.criteria.len() > MAX_PLAN_CRITERIA {
        return Err(invalid(
            "mission_plan_too_large",
            "That plan has more Acceptance Criteria than a Mission can carry.",
        ));
    }
    for criterion in &plan.criteria {
        validate_key(&criterion.key)?;
        validate_text(
            &criterion.title,
            MAX_LIST_ITEM_CHARS,
            "mission_criterion_invalid",
            "An Acceptance Criterion title",
        )?;
    }
    for task in &plan.tasks {
        validate_key(&task.key)?;
        validate_text(
            &task.title,
            MAX_LIST_ITEM_CHARS,
            "mission_task_invalid",
            "A Task title",
        )?;
        if task.objective.chars().count() > MAX_OBJECTIVE_CHARS {
            return Err(invalid(
                "mission_task_invalid",
                "A Task objective is too long to compile into context.",
            ));
        }
        for key in task.depends_on.iter().chain(task.criteria.iter()) {
            validate_key(key)?;
        }
        for path in &task.focus_files {
            reject_unsafe_project_path(path, "mission_focus_path_invalid")?;
        }
    }
    Ok(())
}

// -- Lifecycle ---------------------------------------------------------------------------------

#[tauri::command]
pub async fn create_mission(
    window: Window,
    state: State<'_, AppState>,
    request: CreateMissionRequest,
) -> AppResult<Mission> {
    crate::require_main_window(&window)?;
    validate_create(&request)?;
    let missions = state.missions.clone();
    run_blocking(move || missions.create(&request, "user")).await
}

#[tauri::command]
pub async fn update_mission_draft(
    window: Window,
    state: State<'_, AppState>,
    request: UpdateMissionDraftRequest,
) -> AppResult<Mission> {
    crate::require_main_window(&window)?;
    if let Some(objective) = request.objective.as_deref() {
        validate_text(
            objective,
            MAX_OBJECTIVE_CHARS,
            "mission_objective_invalid",
            "The objective",
        )?;
    }
    if let Some(title) = request.title.as_deref() {
        validate_text(title, MAX_TITLE_CHARS, "mission_title_invalid", "The title")?;
    }
    for (values, code, label) in [
        (
            &request.constraints,
            "mission_constraint_invalid",
            "constraints",
        ),
        (&request.non_goals, "mission_non_goal_invalid", "non-goals"),
        (&request.risks, "mission_risk_invalid", "risks"),
    ] {
        if let Some(values) = values {
            validate_list(values, code, label)?;
        }
    }
    let missions = state.missions.clone();
    run_blocking(move || missions.update_draft(&request)).await
}

/// Preflight and plan a draft Mission. Long-running: it reads the Project graph, Memory and Git,
/// and may create a planning Run.
#[tauri::command]
pub async fn prepare_mission(
    window: Window,
    state: State<'_, AppState>,
    mission_id: String,
) -> AppResult<Mission> {
    crate::require_main_window(&window)?;
    let missions = state.missions.clone();
    run_blocking(move || missions.prepare(&mission_id, "user")).await
}

#[tauri::command]
pub async fn start_mission(
    window: Window,
    state: State<'_, AppState>,
    mission_id: String,
) -> AppResult<Mission> {
    crate::require_main_window(&window)?;
    let missions = state.missions.clone();
    run_blocking(move || missions.start(&mission_id)).await
}

#[tauri::command]
pub async fn cancel_mission(
    window: Window,
    state: State<'_, AppState>,
    mission_id: String,
) -> AppResult<Mission> {
    crate::require_main_window(&window)?;
    let missions = state.missions.clone();
    run_blocking(move || missions.cancel(&mission_id, "user")).await
}

#[tauri::command]
pub async fn revise_mission_plan(
    window: Window,
    state: State<'_, AppState>,
    mission_id: String,
    plan: MissionPlanDraft,
    reason: String,
) -> AppResult<Mission> {
    crate::require_main_window(&window)?;
    validate_plan(&plan)?;
    validate_text(
        &reason,
        MAX_LIST_ITEM_CHARS,
        "mission_revision_reason_required",
        "A revision reason",
    )?;
    let missions = state.missions.clone();
    run_blocking(move || missions.revise_plan(&mission_id, &plan, &reason, "user")).await
}

/// Accept the Mission's outcome. Explicitly a human decision: nothing in Paralith verifies
/// Acceptance Criteria yet, and the recorded acceptance says so.
#[tauri::command]
pub async fn accept_mission(
    window: Window,
    state: State<'_, AppState>,
    mission_id: String,
) -> AppResult<Mission> {
    crate::require_main_window(&window)?;
    let missions = state.missions.clone();
    run_blocking(move || missions.accept(&mission_id, "user")).await
}

// -- Tasks -------------------------------------------------------------------------------------

#[tauri::command]
pub async fn retry_mission_task(
    window: Window,
    state: State<'_, AppState>,
    task_id: String,
) -> AppResult<MissionTask> {
    crate::require_main_window(&window)?;
    let missions = state.missions.clone();
    run_blocking(move || missions.retry_task(&task_id)).await
}

#[tauri::command]
pub async fn start_mission_task(
    window: Window,
    state: State<'_, AppState>,
    task_id: String,
) -> AppResult<MissionTask> {
    crate::require_main_window(&window)?;
    let missions = state.missions.clone();
    run_blocking(move || missions.start_task(&task_id)).await
}

#[tauri::command]
pub async fn complete_manual_mission_task(
    window: Window,
    state: State<'_, AppState>,
    task_id: String,
) -> AppResult<MissionTask> {
    crate::require_main_window(&window)?;
    let missions = state.missions.clone();
    run_blocking(move || missions.complete_manual_task(&task_id, "user")).await
}

#[tauri::command]
pub async fn waive_acceptance_criterion(
    window: Window,
    state: State<'_, AppState>,
    criterion_id: String,
    reason: String,
) -> AppResult<AcceptanceCriterion> {
    crate::require_main_window(&window)?;
    validate_text(
        &reason,
        MAX_LIST_ITEM_CHARS,
        "mission_waiver_reason_required",
        "A waiver reason",
    )?;
    let missions = state.missions.clone();
    run_blocking(move || missions.waive_criterion(&criterion_id, &reason, "user")).await
}

// -- Reads -------------------------------------------------------------------------------------

#[tauri::command]
pub async fn list_missions(
    window: Window,
    state: State<'_, AppState>,
    query: MissionQuery,
) -> AppResult<Vec<MissionSummary>> {
    crate::require_main_window(&window)?;
    let missions = state.missions.clone();
    run_blocking(move || missions.list(&query)).await
}

#[tauri::command]
pub async fn get_mission_detail(
    window: Window,
    state: State<'_, AppState>,
    mission_id: String,
) -> AppResult<MissionDetail> {
    crate::require_main_window(&window)?;
    let missions = state.missions.clone();
    run_blocking(move || missions.detail(&mission_id)).await
}

#[tauri::command]
pub async fn get_mission_activity(
    window: Window,
    state: State<'_, AppState>,
    mission_id: String,
    limit: Option<i64>,
) -> AppResult<Vec<MissionEventRecord>> {
    crate::require_main_window(&window)?;
    let missions = state.missions.clone();
    run_blocking(move || missions.events(&mission_id, limit.unwrap_or(200))).await
}

#[tauri::command]
pub async fn get_mission_plan_revisions(
    window: Window,
    state: State<'_, AppState>,
    mission_id: String,
) -> AppResult<Vec<MissionPlanRevision>> {
    crate::require_main_window(&window)?;
    let missions = state.missions.clone();
    run_blocking(move || missions.plan_revisions(&mission_id)).await
}

/// Every Run this Mission created, superseded attempts included. This is how the Mission surface
/// shows attempt history without reimplementing the Run Engine's queries.
#[tauri::command]
pub async fn get_mission_runs(
    window: Window,
    state: State<'_, AppState>,
    mission_id: String,
) -> AppResult<Vec<Run>> {
    crate::require_main_window(&window)?;
    let missions = state.missions.clone();
    run_blocking(move || missions.runs(&mission_id)).await
}

#[tauri::command]
pub async fn get_mission_task_outputs(
    window: Window,
    state: State<'_, AppState>,
    mission_id: String,
) -> AppResult<Vec<MissionTaskOutput>> {
    crate::require_main_window(&window)?;
    let missions = state.missions.clone();
    run_blocking(move || missions.task_outputs(&mission_id)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> CreateMissionRequest {
        CreateMissionRequest {
            project_id: "project".into(),
            objective: "Add team invitations.".into(),
            ..CreateMissionRequest::default()
        }
    }

    fn plan_task(key: &str) -> MissionPlanTask {
        MissionPlanTask {
            key: key.into(),
            title: "Task".into(),
            objective: "Do it".into(),
            description: None,
            depends_on: Vec::new(),
            criteria: Vec::new(),
            focus_files: Vec::new(),
            execution_mode: None,
            provider_id: None,
            model_id: None,
            isolation: None,
            risk_level: None,
        }
    }

    #[test]
    fn a_well_formed_mission_request_is_accepted() {
        assert!(validate_create(&request()).is_ok());
    }

    #[test]
    fn a_mission_without_a_project_or_objective_is_rejected() {
        let mut without_project = request();
        without_project.project_id = "  ".into();
        assert_eq!(
            validate_create(&without_project).unwrap_err().code,
            "mission_project_required"
        );

        let mut without_objective = request();
        without_objective.objective = "\n".into();
        assert_eq!(
            validate_create(&without_objective).unwrap_err().code,
            "mission_objective_invalid"
        );
    }

    #[test]
    fn an_objective_too_large_to_compile_is_rejected_rather_than_truncated() {
        let mut invalid = request();
        invalid.objective = "x".repeat(MAX_OBJECTIVE_CHARS + 1);
        assert_eq!(
            validate_create(&invalid).unwrap_err().code,
            "mission_objective_invalid"
        );
    }

    #[test]
    fn unbounded_constraint_lists_are_rejected() {
        let mut invalid = request();
        invalid.constraints = (0..MAX_LIST_ITEMS + 1).map(|i| format!("c{i}")).collect();
        assert_eq!(
            validate_create(&invalid).unwrap_err().code,
            "mission_constraint_invalid"
        );
    }

    #[test]
    fn a_plan_focus_path_that_could_escape_the_project_is_rejected_at_the_boundary() {
        for escape in [
            "../secrets.env",
            "/etc/passwd",
            "\\\\server\\share\\file",
            "C:/Windows/System32/config",
            "src/\0evil",
            "src/../../outside.rs",
        ] {
            let mut task = plan_task("T1");
            task.focus_files = vec![escape.into()];
            let plan = MissionPlanDraft {
                tasks: vec![task],
                ..MissionPlanDraft::default()
            };
            assert_eq!(
                validate_plan(&plan).unwrap_err().code,
                "mission_focus_path_invalid",
                "{escape} must be rejected"
            );
        }
    }

    #[test]
    fn a_plan_key_that_is_not_a_plain_identifier_is_rejected() {
        for key in [
            "",
            "   ",
            "T 1",
            "T/1",
            "T;drop",
            &"T".repeat(MAX_KEY_CHARS + 1),
        ] {
            let plan = MissionPlanDraft {
                tasks: vec![plan_task(key)],
                ..MissionPlanDraft::default()
            };
            assert_eq!(
                validate_plan(&plan).unwrap_err().code,
                "mission_key_invalid",
                "{key:?} must be rejected"
            );
        }
        assert!(validate_plan(&MissionPlanDraft {
            tasks: vec![plan_task("T1")],
            ..MissionPlanDraft::default()
        })
        .is_ok());
    }

    #[test]
    fn a_plan_with_no_tasks_or_too_many_is_rejected() {
        assert_eq!(
            validate_plan(&MissionPlanDraft::default())
                .unwrap_err()
                .code,
            "mission_plan_empty"
        );
        let oversized = MissionPlanDraft {
            tasks: (0..MAX_PLAN_TASKS + 1)
                .map(|index| plan_task(&format!("T{index}")))
                .collect(),
            ..MissionPlanDraft::default()
        };
        assert_eq!(
            validate_plan(&oversized).unwrap_err().code,
            "mission_plan_too_large"
        );
    }

    #[test]
    fn dependency_and_criterion_references_are_validated_as_keys_not_free_text() {
        let mut task = plan_task("T1");
        task.depends_on = vec!["../etc".into()];
        assert_eq!(
            validate_plan(&MissionPlanDraft {
                tasks: vec![task],
                ..MissionPlanDraft::default()
            })
            .unwrap_err()
            .code,
            "mission_key_invalid"
        );
    }
}

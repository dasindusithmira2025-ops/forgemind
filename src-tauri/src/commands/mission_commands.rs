use crate::errors::{AppError, AppResult};
use crate::models::*;
use crate::AppState;
use tauri::{State, Window};

fn ownership_error(entity_id: &str) -> AppError {
    AppError::new(
        "mission_project_mismatch",
        "This Mission resource belongs to a different Project.",
        true,
    )
    .entity(entity_id)
    .action("Open Mission Control from the owning Project.")
    .layer("mission-domain")
}

fn ensure_project(state: &AppState, project_id: &str) -> AppResult<()> {
    state.database.get_project(project_id).map(|_| ())
}

fn ensure_mission_project(
    state: &AppState,
    project_id: &str,
    mission_id: &str,
) -> AppResult<Mission> {
    ensure_project(state, project_id)?;
    let mission = state.database.get_mission(mission_id)?;
    if mission.project_id != project_id {
        return Err(ownership_error(mission_id));
    }
    Ok(mission)
}

fn ensure_task_project(
    state: &AppState,
    project_id: &str,
    task_id: &str,
) -> AppResult<MissionTask> {
    let task = state.database.get_mission_task(task_id)?;
    ensure_mission_project(state, project_id, &task.mission_id)?;
    Ok(task)
}

fn ensure_recovery_project(
    state: &AppState,
    project_id: &str,
    recovery_id: &str,
) -> AppResult<RecoveryState> {
    let recovery = state.database.get_recovery_state(recovery_id)?;
    ensure_mission_project(state, project_id, &recovery.mission_id)?;
    Ok(recovery)
}

#[tauri::command]
pub fn save_mission(
    request: SaveMissionRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<MissionBundle> {
    crate::require_main_window(&window)?;
    ensure_project(&state, &request.project_id)?;
    if let Some(mission_id) = request.id.as_deref() {
        ensure_mission_project(&state, &request.project_id, mission_id)?;
    }
    let previous = request
        .id
        .as_deref()
        .and_then(|id| state.database.get_mission(id).ok());
    let bundle = state.database.save_mission(&request)?;
    if previous
        .as_ref()
        .is_some_and(|mission| mission.permission_profile != bundle.mission.permission_profile)
    {
        state.database.add_audit_event(
            Some(&bundle.mission.id),
            None,
            "permission-change",
            "passed",
            "The user changed the Mission permission profile.",
            serde_json::json!({"from": previous.map(|mission| mission.permission_profile), "to": bundle.mission.permission_profile}),
        )?;
    }
    Ok(bundle)
}

#[tauri::command]
pub fn list_missions(
    project_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<Mission>> {
    crate::require_main_window(&window)?;
    ensure_project(&state, &project_id)?;
    state.database.list_missions(Some(&project_id))
}

#[tauri::command]
pub fn get_mission_bundle(
    project_id: String,
    mission_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<MissionBundle> {
    crate::require_main_window(&window)?;
    ensure_mission_project(&state, &project_id, &mission_id)?;
    state.database.get_mission_bundle(&mission_id)
}

#[tauri::command]
pub fn get_project_mission_draft(
    project_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Option<MissionBundle>> {
    crate::require_main_window(&window)?;
    ensure_project(&state, &project_id)?;
    state.database.get_project_mission_draft(&project_id)
}

#[tauri::command]
pub fn delete_draft_mission(
    project_id: String,
    mission_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    crate::require_main_window(&window)?;
    ensure_mission_project(&state, &project_id, &mission_id)?;
    state
        .database
        .delete_draft_mission(&project_id, &mission_id)
}

#[tauri::command]
pub fn save_mission_task(
    project_id: String,
    request: SaveTaskRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<MissionTask> {
    crate::require_main_window(&window)?;
    ensure_mission_project(&state, &project_id, &request.mission_id)?;
    if let Some(task_id) = request.id.as_deref() {
        ensure_task_project(&state, &project_id, task_id)?;
    }
    state.database.save_mission_task(&request)
}

#[tauri::command]
pub fn suggest_mission_plan(
    project_id: String,
    mission_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<MissionPlanSuggestion>> {
    crate::require_main_window(&window)?;
    ensure_mission_project(&state, &project_id, &mission_id)?;
    state.missions.suggest_plan(&mission_id)
}

#[tauri::command]
pub fn dispatch_mission_task(
    project_id: String,
    request: DispatchTaskRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<DispatchResult> {
    crate::require_main_window(&window)?;
    ensure_task_project(&state, &project_id, &request.task_id)?;
    state.missions.dispatch_task(&request)
}

macro_rules! task_command {
    ($name:ident, $method:ident, $result:ty) => {
        #[tauri::command]
        pub fn $name(
            project_id: String,
            task_id: String,
            window: Window,
            state: State<'_, AppState>,
        ) -> AppResult<$result> {
            crate::require_main_window(&window)?;
            ensure_task_project(&state, &project_id, &task_id)?;
            state.missions.$method(&task_id)
        }
    };
}

task_command!(
    refresh_mission_task,
    refresh_task_from_terminal,
    MissionTask
);
task_command!(collect_task_evidence, collect_evidence, Vec<EvidenceRecord>);
task_command!(get_task_review, review, ReviewSnapshot);
task_command!(accept_mission_task, accept_task, MissionTask);
task_command!(retry_mission_task, retry_task, MissionTask);
task_command!(stop_mission_task, stop_task, MissionTask);
task_command!(merge_mission_task, merge_task, WorktreeRecord);
task_command!(discard_mission_task, discard_task, WorktreeRecord);
task_command!(
    cleanup_merged_task_worktree,
    cleanup_merged_worktree,
    WorktreeRecord
);
task_command!(rollback_mission_merge, rollback_merge, WorktreeRecord);

#[tauri::command]
pub fn run_task_verification(
    project_id: String,
    task_id: String,
    check_id: Option<String>,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<VerificationResult>> {
    crate::require_main_window(&window)?;
    ensure_task_project(&state, &project_id, &task_id)?;
    state
        .missions
        .run_verification(&task_id, check_id.as_deref())
}

#[tauri::command]
pub fn cancel_task_verification(
    project_id: String,
    task_id: String,
    check_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<bool> {
    crate::require_main_window(&window)?;
    ensure_task_project(&state, &project_id, &task_id)?;
    Ok(state.missions.cancel_verification(&task_id, &check_id))
}

#[tauri::command]
pub fn add_manual_task_evidence(
    project_id: String,
    task_id: String,
    criterion_id: String,
    summary: String,
    passed: bool,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<EvidenceRecord> {
    crate::require_main_window(&window)?;
    ensure_task_project(&state, &project_id, &task_id)?;
    state
        .missions
        .add_manual_evidence(&task_id, &criterion_id, &summary, passed)
}

#[tauri::command]
pub fn request_task_changes(
    project_id: String,
    task_id: String,
    instruction: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<MissionTask> {
    crate::require_main_window(&window)?;
    ensure_task_project(&state, &project_id, &task_id)?;
    state.missions.request_changes(&task_id, &instruction)
}

#[tauri::command]
pub fn reconcile_mission_recovery(
    project_id: Option<String>,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<RecoveryState>> {
    crate::require_main_window(&window)?;
    if let Some(project_id) = project_id.as_deref() {
        ensure_project(&state, project_id)?;
    }
    let states = state.missions.reconcile()?;
    if let Some(project_id) = project_id {
        let mut owned = Vec::new();
        for recovery in states {
            if state.database.get_mission(&recovery.mission_id)?.project_id == project_id {
                owned.push(recovery);
            }
        }
        Ok(owned)
    } else {
        Ok(states)
    }
}

#[tauri::command]
pub fn recover_mission_session(
    project_id: String,
    recovery_id: String,
    action: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<RecoveryState> {
    crate::require_main_window(&window)?;
    ensure_recovery_project(&state, &project_id, &recovery_id)?;
    state.missions.recover_session(&recovery_id, &action)
}

#[tauri::command]
pub fn discover_project_context(
    project_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<ProjectContextDiscovery> {
    crate::require_main_window(&window)?;
    ensure_project(&state, &project_id)?;
    state.missions.discover_project_context(&project_id)
}

#[tauri::command]
pub fn save_project_context(
    context: ProjectContext,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    crate::require_main_window(&window)?;
    ensure_project(&state, &context.project_id)?;
    state.database.save_project_context(&context)
}

#[tauri::command]
pub fn get_project_context(
    project_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Option<ProjectContext>> {
    crate::require_main_window(&window)?;
    ensure_project(&state, &project_id)?;
    state.database.get_project_context(&project_id)
}

#[tauri::command]
pub fn save_verification_profile(
    request: SaveVerificationProfileRequest,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<VerificationProfile> {
    crate::require_main_window(&window)?;
    ensure_project(&state, &request.project_id)?;
    let profile = state.database.save_verification_profile(&request)?;
    if request.approved {
        state.database.add_audit_event(
            None,
            None,
            "command-approval",
            "passed",
            "The user approved a reusable verification command profile.",
            serde_json::json!({"profileId": profile.id, "projectId": profile.project_id}),
        )?;
    }
    Ok(profile)
}

#[tauri::command]
pub fn list_verification_profiles(
    project_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<VerificationProfile>> {
    crate::require_main_window(&window)?;
    ensure_project(&state, &project_id)?;
    state.database.list_verification_profiles(&project_id)
}

use crate::errors::{AppError, AppResult};
use crate::models::{
    DirectoryListing, FileContents, FileWriteResult, FsEntryInfo, FsPath, ProjectFileIndex,
};
use crate::AppState;
use tauri::{State, Window};

/// A non-main window may only reach the Project its Workspace belongs to, and only while it
/// still owns that Workspace's interactive lease. The main window may reach any open Project.
/// This mirrors `repository_commands::require_project_scope` so the Code surface honours the
/// same window-security boundary as Source Control.
fn require_project_scope(window: &Window, state: &AppState, project_id: &str) -> AppResult<()> {
    if window.label() == crate::services::MAIN_WINDOW_LABEL {
        state.database.get_project(project_id)?;
        return Ok(());
    }
    let workspace_id = window.label().strip_prefix("ws-").ok_or_else(|| {
        AppError::new(
            "project_scope_denied",
            "This window has no Project scope.",
            false,
        )
        .layer("window_security")
    })?;
    let workspace = state.database.get_workspace(workspace_id)?;
    if workspace.project_id != project_id {
        return Err(AppError::new(
            "project_scope_denied",
            "This window cannot access another Project's files.",
            false,
        )
        .entity(project_id)
        .layer("window_security"));
    }
    state
        .windows
        .validate_workspace_caller(workspace_id, window.label(), true)
}

fn worker_failed(error: impl std::fmt::Display) -> AppError {
    AppError::new(
        "filesystem_worker_failed",
        "The file worker stopped unexpectedly.",
        true,
    )
    .detail(error.to_string())
}

#[tauri::command]
pub async fn list_project_directory(
    project_id: String,
    relative_path: Option<String>,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<DirectoryListing> {
    require_project_scope(&window, &state, &project_id)?;
    let service = state.filesystem.clone();
    let relative = relative_path.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || service.list_directory(&project_id, &relative))
        .await
        .map_err(worker_failed)?
}

#[tauri::command]
pub async fn read_project_file(
    project_id: String,
    relative_path: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<FileContents> {
    require_project_scope(&window, &state, &project_id)?;
    let service = state.filesystem.clone();
    tauri::async_runtime::spawn_blocking(move || service.read_file(&project_id, &relative_path))
        .await
        .map_err(worker_failed)?
}

/// Raw bytes of a previewable image or PDF, returned as a binary IPC response rather than JSON so
/// a multi-megabyte file is not inflated into a string on the way to the preview. The MIME type is
/// the one already reported by `read_project_file`; this command only ever serves paths whose
/// extension is previewable.
#[tauri::command]
pub async fn read_project_media(
    project_id: String,
    relative_path: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<tauri::ipc::Response> {
    require_project_scope(&window, &state, &project_id)?;
    let service = state.filesystem.clone();
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        service.read_media(&project_id, &relative_path)
    })
    .await
    .map_err(worker_failed)??;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn write_project_file(
    project_id: String,
    relative_path: String,
    content: String,
    expected_sha256: Option<String>,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<FileWriteResult> {
    require_project_scope(&window, &state, &project_id)?;
    let service = state.filesystem.clone();
    tauri::async_runtime::spawn_blocking(move || {
        service.write_file(
            &project_id,
            &relative_path,
            &content,
            expected_sha256.as_deref(),
        )
    })
    .await
    .map_err(worker_failed)?
}

#[tauri::command]
pub async fn create_project_file(
    project_id: String,
    relative_path: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<FsEntryInfo> {
    require_project_scope(&window, &state, &project_id)?;
    let service = state.filesystem.clone();
    tauri::async_runtime::spawn_blocking(move || service.create_file(&project_id, &relative_path))
        .await
        .map_err(worker_failed)?
}

#[tauri::command]
pub async fn create_project_directory(
    project_id: String,
    relative_path: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<FsEntryInfo> {
    require_project_scope(&window, &state, &project_id)?;
    let service = state.filesystem.clone();
    tauri::async_runtime::spawn_blocking(move || {
        service.create_directory(&project_id, &relative_path)
    })
    .await
    .map_err(worker_failed)?
}

#[tauri::command]
pub async fn rename_project_entry(
    project_id: String,
    from: String,
    to: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<FsEntryInfo> {
    require_project_scope(&window, &state, &project_id)?;
    let service = state.filesystem.clone();
    tauri::async_runtime::spawn_blocking(move || service.rename_entry(&project_id, &from, &to))
        .await
        .map_err(worker_failed)?
}

#[tauri::command]
pub async fn copy_project_entry(
    project_id: String,
    from: String,
    to: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<FsEntryInfo> {
    require_project_scope(&window, &state, &project_id)?;
    let service = state.filesystem.clone();
    tauri::async_runtime::spawn_blocking(move || service.copy_entry(&project_id, &from, &to))
        .await
        .map_err(worker_failed)?
}

#[tauri::command]
pub async fn delete_project_entry(
    project_id: String,
    relative_path: String,
    recursive: bool,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<FsPath> {
    require_project_scope(&window, &state, &project_id)?;
    let service = state.filesystem.clone();
    tauri::async_runtime::spawn_blocking(move || {
        service.delete_entry(&project_id, &relative_path, recursive)
    })
    .await
    .map_err(worker_failed)?
}

#[tauri::command]
pub async fn search_project_files(
    project_id: String,
    limit: Option<usize>,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<ProjectFileIndex> {
    require_project_scope(&window, &state, &project_id)?;
    let service = state.filesystem.clone();
    tauri::async_runtime::spawn_blocking(move || service.search_project_files(&project_id, limit))
        .await
        .map_err(worker_failed)?
}

/// Register the calling window as a subscriber to this Project's file-change events. Idempotent:
/// re-invoking from the same window is safe and does not create a second watcher.
#[tauri::command]
pub fn watch_project_files(
    project_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    require_project_scope(&window, &state, &project_id)?;
    state.file_watch.watch(&project_id, window.label())
}

#[tauri::command]
pub fn unwatch_project_files(
    project_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<()> {
    require_project_scope(&window, &state, &project_id)?;
    state.file_watch.unwatch(&project_id, window.label());
    Ok(())
}

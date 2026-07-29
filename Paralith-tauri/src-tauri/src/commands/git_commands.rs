use crate::errors::{AppError, AppResult};
use crate::models::{
    ApprovalDecisionRequest, GitChangedFile, IsolatedWorktreeResult, PaneGitReview,
    RepositoryActor, RepositoryActorKind, RepositoryApprovalRequest, RepositoryOperation,
    RepositoryOperationContext, RepositoryOperationRequest, RepositoryOperationStatus, Workspace,
};
use crate::AppState;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{State, Window};
use uuid::Uuid;

const MAX_DIFF_BYTES: usize = 220_000;

async fn run_git_blocking<T: Send + 'static>(
    operation: impl FnOnce() -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| {
            AppError::new(
                "git_task_failed",
                "The Git operation stopped unexpectedly.",
                true,
            )
            .detail(error.to_string())
        })?
}

#[tauri::command]
pub async fn get_pane_git_review(
    workspace_id: String,
    pane_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<PaneGitReview> {
    state
        .windows
        .validate_workspace_caller(&workspace_id, window.label(), true)?;
    let state = state.inner().clone();
    run_git_blocking(move || get_pane_git_review_inner(&state, &workspace_id, &pane_id)).await
}

fn get_pane_git_review_inner(
    state: &AppState,
    workspace_id: &str,
    pane_id: &str,
) -> AppResult<PaneGitReview> {
    let workspace = state.database.get_workspace(workspace_id)?;
    let pane = pane(&workspace, pane_id)?;
    let working_directory = PathBuf::from(&pane.working_directory);
    build_pane_git_review(&working_directory)
}

fn build_pane_git_review(working_directory: &Path) -> AppResult<PaneGitReview> {
    let repository = git_root(working_directory)?;
    let scope = git_scope(working_directory)?;
    let branch = git_stdout(&repository, &["branch", "--show-current"])
        .unwrap_or_else(|_| "detached".into());
    let status = git_stdout(&repository, &["status", "--porcelain=v1", "--", &scope])?;
    let files = parse_status(&status);
    let diff = git_stdout(
        &repository,
        &["diff", "--no-ext-diff", "--no-color", "--", &scope],
    )?;
    let staged = git_stdout(
        &repository,
        &[
            "diff",
            "--cached",
            "--no-ext-diff",
            "--no-color",
            "--",
            &scope,
        ],
    )?;
    let mut combined = String::new();
    if !staged.trim().is_empty() {
        combined.push_str("## Staged\n");
        combined.push_str(&staged);
        combined.push('\n');
    }
    if !diff.trim().is_empty() {
        combined.push_str("## Working tree\n");
        combined.push_str(&diff);
    }
    let diff_truncated = combined.len() > MAX_DIFF_BYTES;
    if diff_truncated {
        combined.truncate(MAX_DIFF_BYTES);
        combined.push_str("\n\n[Diff truncated by PARALITH]\n");
    }
    let conflicts = files
        .iter()
        .filter(|file| file.conflicted)
        .map(|file| file.path.clone())
        .collect();
    Ok(PaneGitReview {
        repository_path: repository.to_string_lossy().into_owned(),
        working_directory: working_directory.to_string_lossy().into_owned(),
        branch: branch.trim().to_owned(),
        files,
        diff: combined,
        diff_truncated,
        conflicts,
    })
}

#[tauri::command]
pub async fn stage_pane_file(
    workspace_id: String,
    pane_id: String,
    path: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<PaneGitReview> {
    state
        .windows
        .validate_workspace_caller(&workspace_id, window.label(), false)?;
    let state = state.inner().clone();
    let window_label = window.label().to_owned();
    run_git_blocking(move || {
        stage_pane_file_inner(&state, &workspace_id, &pane_id, &path, &window_label)
    })
    .await
}

fn stage_pane_file_inner(
    state: &AppState,
    workspace_id: &str,
    pane_id: &str,
    path: &str,
    window_label: &str,
) -> AppResult<PaneGitReview> {
    let workspace = state.database.get_workspace(workspace_id)?;
    let pane = pane(&workspace, pane_id)?;
    let working_directory = Path::new(&pane.working_directory);
    let repository = git_root(Path::new(&project_root(state, &workspace)?))?;
    let worktree = git_root(working_directory)?;
    let scope = git_scope(working_directory)?;
    let relative = sanitize_repo_relative_path(path)?;
    ensure_path_in_scope(&relative, &scope)?;
    run_pane_operation(
        state,
        &workspace.project_id,
        &repository,
        &worktree,
        window_label,
        RepositoryOperation::StagePaths {
            paths: vec![relative],
        },
        false,
    )?;
    get_pane_git_review_inner(state, workspace_id, pane_id)
}

#[tauri::command]
pub async fn restore_pane_file(
    workspace_id: String,
    pane_id: String,
    path: String,
    confirmed: bool,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<PaneGitReview> {
    if !confirmed {
        return Err(AppError::new(
            "git_discard_confirmation_required",
            "Discarding git changes requires explicit confirmation.",
            true,
        )
        .entity(path));
    }
    state
        .windows
        .validate_workspace_caller(&workspace_id, window.label(), false)?;
    let state = state.inner().clone();
    let window_label = window.label().to_owned();
    run_git_blocking(move || {
        restore_pane_file_inner(&state, &workspace_id, &pane_id, &path, &window_label)
    })
    .await
}

fn restore_pane_file_inner(
    state: &AppState,
    workspace_id: &str,
    pane_id: &str,
    path: &str,
    window_label: &str,
) -> AppResult<PaneGitReview> {
    let workspace = state.database.get_workspace(workspace_id)?;
    let pane = pane(&workspace, pane_id)?;
    let working_directory = Path::new(&pane.working_directory);
    let repository = git_root(Path::new(&project_root(state, &workspace)?))?;
    let worktree = git_root(working_directory)?;
    let scope = git_scope(working_directory)?;
    let relative = sanitize_repo_relative_path(path)?;
    ensure_path_in_scope(&relative, &scope)?;
    run_pane_operation(
        state,
        &workspace.project_id,
        &repository,
        &worktree,
        window_label,
        RepositoryOperation::RestorePaths {
            paths: vec![relative],
        },
        true,
    )?;
    get_pane_git_review_inner(state, workspace_id, pane_id)
}

#[tauri::command]
pub async fn create_isolated_pane_worktree(
    workspace_id: String,
    pane_id: String,
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<IsolatedWorktreeResult> {
    state
        .windows
        .validate_workspace_caller(&workspace_id, window.label(), false)?;
    let state = state.inner().clone();
    let window_label = window.label().to_owned();
    run_git_blocking(move || {
        create_isolated_pane_worktree_inner(&state, &workspace_id, &pane_id, &window_label)
    })
    .await
}

fn create_isolated_pane_worktree_inner(
    state: &AppState,
    workspace_id: &str,
    pane_id: &str,
    window_label: &str,
) -> AppResult<IsolatedWorktreeResult> {
    let mut workspace = state.database.get_workspace(workspace_id)?;
    let project = state.database.get_project(&workspace.project_id)?;
    let pane = pane(&workspace, pane_id)?.clone();
    let repository = git_root(Path::new(&project.root_path))?;
    let current_worktree = git_root(Path::new(&pane.working_directory))?;
    let base_ref = git_stdout(&current_worktree, &["rev-parse", "HEAD"])?
        .trim()
        .to_owned();
    let slug = slug(&format!("{}-{}", workspace.name, pane.title));
    let branch_name = unique_worktree_branch(&repository, &slug)?;
    let scope = git_scope(Path::new(&pane.working_directory))?;
    let record = run_pane_operation(
        state,
        &project.id,
        &repository,
        &current_worktree,
        window_label,
        RepositoryOperation::CreateAgentWorktree {
            branch: branch_name.clone(),
            base_commit: base_ref.clone(),
            agent_id: format!("pane:{pane_id}"),
            task_id: format!("workspace:{workspace_id}"),
            file_scope: if scope == "." {
                Vec::new()
            } else {
                vec![scope]
            },
            expires_at: None,
        },
        false,
    )?;
    let lease = record
        .result
        .as_ref()
        .and_then(|result| result.get("lease"))
        .cloned()
        .ok_or_else(|| {
            AppError::new(
                "worktree_creation_failed",
                "PARALITH did not return the created worktree lease.",
                false,
            )
        })?;
    let lease: crate::models::RepositoryWorktreeLease =
        serde_json::from_value(lease).map_err(AppError::database)?;
    let worktree_path = PathBuf::from(&lease.worktree_path);
    for item in &mut workspace.panes {
        if item.id == pane_id {
            item.working_directory = worktree_path.to_string_lossy().into_owned();
            item.working_directory_mode = "custom".into();
        }
    }
    let updated = state
        .database
        .save_workspace(&crate::models::WorkspaceSaveRequest {
            id: Some(workspace.id.clone()),
            project_id: workspace.project_id.clone(),
            name: workspace.name.clone(),
            layout: workspace.layout.clone(),
            active_pane_id: workspace.active_pane_id.clone(),
            restore_behavior: workspace.restore_behavior.clone(),
            panes: workspace.panes.clone(),
        })?;
    let repository_path = repository.to_string_lossy();
    let worktree_path_text = worktree_path.to_string_lossy();
    state
        .database
        .record_pane_worktree(crate::database::PaneWorktreeRecord {
            project_id: &project.id,
            workspace_id,
            pane_id,
            repository_path: &repository_path,
            worktree_path: &worktree_path_text,
            branch_name: &branch_name,
            base_ref: &base_ref,
        })?;
    Ok(IsolatedWorktreeResult {
        workspace: updated,
        repository_path: repository.to_string_lossy().into_owned(),
        worktree_path: worktree_path.to_string_lossy().into_owned(),
        branch_name,
        base_ref,
    })
}

fn pane<'a>(
    workspace: &'a Workspace,
    pane_id: &str,
) -> AppResult<&'a crate::models::PaneAssignment> {
    workspace
        .panes
        .iter()
        .find(|pane| pane.id == pane_id)
        .ok_or_else(|| {
            AppError::new(
                "pane_not_found",
                "The selected pane could not be found.",
                true,
            )
            .entity(pane_id)
        })
}

fn git_root(directory: &Path) -> AppResult<PathBuf> {
    let root = git_stdout(directory, &["rev-parse", "--show-toplevel"])?;
    let root = PathBuf::from(root.trim());
    if !root.is_dir() {
        return Err(AppError::new(
            "git_repository_not_found",
            "No git repository owns this pane directory.",
            true,
        )
        .entity(directory.display().to_string()));
    }
    Ok(root)
}

fn git_scope(directory: &Path) -> AppResult<String> {
    let prefix = git_stdout(directory, &["rev-parse", "--show-prefix"])?;
    let scope = prefix.trim_end_matches(['\r', '\n', '/', '\\']);
    Ok(if scope.is_empty() {
        ".".into()
    } else {
        scope.replace('\\', "/")
    })
}

fn git_stdout(directory: &Path, args: &[&str]) -> AppResult<String> {
    let output = Command::new("git")
        .current_dir(directory)
        .args(args)
        .output()
        .map_err(|error| {
            AppError::new("git_unavailable", "PARALITH could not run git.", true)
                .detail(error.to_string())
        })?;
    if !output.status.success() {
        return Err(AppError::new(
            "git_command_failed",
            "Git rejected the requested pane operation.",
            true,
        )
        .detail(String::from_utf8_lossy(&output.stderr).trim().to_owned())
        .entity(directory.display().to_string()));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn git_success(directory: &Path, args: &[&str]) -> AppResult<bool> {
    let output = Command::new("git")
        .current_dir(directory)
        .args(args)
        .output()
        .map_err(|error| {
            AppError::new("git_unavailable", "PARALITH could not run git.", true)
                .detail(error.to_string())
        })?;
    Ok(output.status.success())
}

fn unique_worktree_branch(repository: &Path, slug: &str) -> AppResult<String> {
    for _ in 0..10 {
        let suffix = Uuid::new_v4().to_string();
        let branch_name = format!("paralith/{slug}-{suffix}");
        let branch_exists = git_success(
            repository,
            &[
                "show-ref",
                "--verify",
                "--quiet",
                &format!("refs/heads/{branch_name}"),
            ],
        )?;
        if !branch_exists {
            return Ok(branch_name);
        }
    }
    Err(AppError::new(
        "worktree_collision",
        "PARALITH could not allocate a unique managed worktree path.",
        true,
    ))
}

fn project_root(state: &AppState, workspace: &Workspace) -> AppResult<String> {
    Ok(state.database.get_project(&workspace.project_id)?.root_path)
}

fn run_pane_operation(
    state: &AppState,
    project_id: &str,
    repository: &Path,
    worktree: &Path,
    window_label: &str,
    operation: RepositoryOperation,
    confirmed: bool,
) -> AppResult<crate::models::RepositoryOperationRecord> {
    let snapshot = state.repository.inspect(
        project_id,
        Some(repository.to_string_lossy().as_ref()),
        Some(worktree.to_string_lossy().as_ref()),
    )?;
    let request = RepositoryOperationRequest {
        context: RepositoryOperationContext {
            project_id: project_id.to_owned(),
            repository_path: Some(repository.to_string_lossy().into_owned()),
            worktree_path: Some(worktree.to_string_lossy().into_owned()),
            actor: RepositoryActor {
                kind: RepositoryActorKind::Human,
                id: format!("local-window:{window_label}"),
                display_name: "Local PARALITH user".into(),
                agent_run_id: None,
                model: None,
                task_id: None,
            },
            base_commit: Some(snapshot.head_sha.clone()),
            expected_branch: snapshot.branch.clone(),
            approval_id: None,
            idempotency_key: Uuid::new_v4().to_string(),
            timeout_seconds: Some(120),
        },
        operation,
    };
    let mut record = state.repository.execute(request, |_| {})?;
    if record.status == RepositoryOperationStatus::AwaitingApproval {
        if !confirmed {
            return Err(AppError::new(
                "repository_approval_required",
                "Repository policy requires approval before this pane operation can run.",
                true,
            )
            .entity(record.id));
        }
        let approval: RepositoryApprovalRequest =
            serde_json::from_value(record.result.clone().ok_or_else(|| {
                AppError::new(
                    "repository_approval_missing",
                    "PARALITH did not persist the required approval request.",
                    false,
                )
            })?)
            .map_err(AppError::database)?;
        state.repository.decide_approval(&ApprovalDecisionRequest {
            project_id: project_id.to_owned(),
            approval_id: approval.id.clone(),
            approved: true,
            human_id: format!("local-window:{window_label}"),
            reason: Some("Confirmed in the pane repository review.".into()),
        })?;
        record = state.repository.execute_approved(&approval.id, |_| {})?;
    }
    if record.status != RepositoryOperationStatus::Succeeded {
        return Err(AppError::new(
            "repository_operation_incomplete",
            "The pane repository operation did not complete.",
            true,
        )
        .entity(record.id));
    }
    Ok(record)
}

fn parse_status(status: &str) -> Vec<GitChangedFile> {
    status
        .lines()
        .filter_map(|line| {
            if line.len() < 4 {
                return None;
            }
            let index_status = line[0..1].to_owned();
            let worktree_status = line[1..2].to_owned();
            let path = line[3..]
                .split(" -> ")
                .last()
                .unwrap_or(&line[3..])
                .to_owned();
            let conflicted = index_status == "U"
                || worktree_status == "U"
                || matches!(
                    (index_status.as_str(), worktree_status.as_str()),
                    ("A", "A") | ("D", "D")
                );
            Some(GitChangedFile {
                path,
                index_status,
                worktree_status,
                conflicted,
            })
        })
        .collect()
}

fn ensure_path_in_scope(relative: &str, scope: &str) -> AppResult<()> {
    if scope == "." || relative == scope || relative.starts_with(&format!("{scope}/")) {
        return Ok(());
    }
    Err(AppError::new(
        "git_path_outside_pane_scope",
        "The selected file is outside this pane's review scope.",
        true,
    )
    .entity(relative))
}

fn sanitize_repo_relative_path(path: &str) -> AppResult<String> {
    let value = path.trim().replace('\\', "/");
    if value.is_empty()
        || value.starts_with('/')
        || value.contains('\0')
        || value.split('/').any(|part| part == "..")
    {
        return Err(AppError::new(
            "invalid_git_path",
            "The selected git path is not a safe repository-relative path.",
            true,
        ));
    }
    Ok(value)
}

fn slug(value: &str) -> String {
    let mut out = String::new();
    for ch in value.chars().flat_map(char::to_lowercase) {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    let trimmed = out.trim_matches('-');
    if trimmed.is_empty() {
        "pane".into()
    } else {
        trimmed.chars().take(48).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;

    fn temp_repo(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("paralith-git-{name}-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        git_raw(&root, &["init"]).unwrap();
        git_raw(&root, &["config", "user.email", "test@example.invalid"]).unwrap();
        git_raw(&root, &["config", "user.name", "PARALITH Test"]).unwrap();
        write_file(&root.join("root.txt"), "root\n");
        fs::create_dir_all(root.join("pane")).unwrap();
        write_file(&root.join("pane").join("owned.txt"), "owned\n");
        git_raw(&root, &["add", "."]).unwrap();
        git_raw(&root, &["commit", "-m", "initial"]).unwrap();
        root
    }

    fn git_raw(directory: &Path, args: &[&str]) -> std::io::Result<()> {
        let output = Command::new("git")
            .current_dir(directory)
            .args(args)
            .output()?;
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
        Ok(())
    }

    fn write_file(path: &Path, content: &str) {
        let mut file = fs::File::create(path).unwrap();
        file.write_all(content.as_bytes()).unwrap();
    }

    #[test]
    fn pane_review_is_scoped_to_working_directory() {
        let root = temp_repo("scope");
        write_file(&root.join("root.txt"), "outside\n");
        write_file(&root.join("pane").join("owned.txt"), "inside\n");
        let review = build_pane_git_review(&root.join("pane")).unwrap();
        assert_eq!(review.files.len(), 1);
        assert_eq!(review.files[0].path, "pane/owned.txt");
        assert!(review.diff.contains("inside"));
        assert!(!review.diff.contains("outside"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn discard_rejects_path_outside_pane_scope() {
        assert!(ensure_path_in_scope("root.txt", "pane").is_err());
        assert!(ensure_path_in_scope("pane/owned.txt", "pane").is_ok());
    }

    #[test]
    fn unique_worktree_branch_avoids_existing_branch() {
        let root = temp_repo("collision");
        let branch = unique_worktree_branch(&root, "pane").unwrap();
        assert!(branch.starts_with("paralith/pane-"));
        fs::remove_dir_all(root).unwrap();
    }
}

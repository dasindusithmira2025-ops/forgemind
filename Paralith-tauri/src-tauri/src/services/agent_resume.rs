use crate::database::DatabaseService;
use crate::errors::{AppError, AppResult};
use crate::models::{
    AgentProvider, AgentResumeRecord, ResumeAgentSessionRequest, ResumeAgentSessionResult,
};
use crate::services::TerminalManager;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use uuid::Uuid;

#[derive(Clone)]
pub struct AgentResumeService {
    database: Arc<DatabaseService>,
    terminals: TerminalManager,
}

impl AgentResumeService {
    pub fn new(database: Arc<DatabaseService>, terminals: TerminalManager) -> Self {
        Self {
            database,
            terminals,
        }
    }

    pub fn reconcile(&self) -> AppResult<Vec<AgentResumeRecord>> {
        let live = self.terminals.list_live_sessions(None);
        for record in self.database.list_agent_resume_records(false)? {
            if record.dismissed_at.is_some()
                || matches!(record.recovery_status.as_str(), "completed" | "restored")
            {
                continue;
            }
            let running = live.iter().find(|session| {
                session.id == record.terminal_session_id
                    || record.running_terminal_session_id.as_deref() == Some(&session.id)
                    || (session.provider == record.provider
                        && launch_has_session(
                            &session.provider,
                            &session.arguments,
                            record.provider_session_id.as_deref(),
                        ))
            });
            if let Some(session) = running {
                self.database.set_agent_recovery_state(
                    &record.terminal_session_id,
                    "running",
                    None,
                    None,
                    Some(&session.id),
                )?;
                continue;
            }
            match self.validate(record.clone(), false) {
                Ok(_) => {
                    let reason =
                        if record.status == "running" || record.recovery_status == "reconciling" {
                            "unclean_shutdown"
                        } else if record.shutdown_reason == "running" {
                            "process_disconnected"
                        } else {
                            record.shutdown_reason.as_str()
                        };
                    self.database.set_agent_recovery_state(
                        &record.terminal_session_id,
                        "resumable",
                        Some(reason),
                        None,
                        None,
                    )?;
                }
                Err(error) => {
                    self.database.set_agent_recovery_state(
                        &record.terminal_session_id,
                        "unavailable",
                        None,
                        Some((&error.code, &error.message)),
                        None,
                    )?;
                }
            }
        }
        self.database.list_agent_resume_records(false)
    }

    pub fn resume(
        &self,
        request: ResumeAgentSessionRequest,
    ) -> AppResult<ResumeAgentSessionResult> {
        self.database
            .claim_agent_resume(&request.terminal_session_id)?;
        let source = self
            .database
            .get_agent_resume_record(&request.terminal_session_id)?;
        let record = match self.validate(source.clone(), request.in_new_terminal) {
            Ok(record) => record,
            Err(error) => {
                self.database.set_agent_recovery_state(
                    &source.terminal_session_id,
                    "unavailable",
                    None,
                    Some((&error.code, &error.message)),
                    None,
                )?;
                return Err(error);
            }
        };
        let launch = self.database.create_resume_terminal_request(
            &record,
            request.in_new_terminal,
            request.cols.max(1),
            request.rows.max(1),
        )?;
        let pane_id = launch.pane_id.clone();
        let workspace_id = launch.workspace_id.clone();
        match self.terminals.create_session(launch) {
            Ok(terminal) => {
                self.database
                    .mark_agent_resume_launched(&record.terminal_session_id, &terminal.id)?;
                Ok(ResumeAgentSessionResult {
                    source_terminal_session_id: record.terminal_session_id,
                    terminal,
                    workspace_id,
                    pane_id,
                })
            }
            Err(error) => {
                if request.in_new_terminal {
                    let _ = self
                        .database
                        .rollback_resume_pane(&record.workspace_id, &pane_id);
                }
                self.database.set_agent_recovery_state(
                    &record.terminal_session_id,
                    "resumable",
                    None,
                    Some((&error.code, &error.message)),
                    None,
                )?;
                Err(error)
            }
        }
    }

    pub fn relocate_worktree(
        &self,
        terminal_session_id: &str,
        candidate: &str,
    ) -> AppResult<AgentResumeRecord> {
        let record = self.database.get_agent_resume_record(terminal_session_id)?;
        let path = canonical_directory(
            candidate,
            "worktree_missing",
            "The selected worktree does not exist.",
        )?;
        let identity = git_value(&path, &["rev-parse", "--git-common-dir"])
            .map(PathBuf::from)
            .map(|value| {
                if value.is_absolute() {
                    value
                } else {
                    path.join(value)
                }
            })
            .and_then(|value| std::fs::canonicalize(&value).ok().or(Some(value)))
            .ok_or_else(|| {
                resume_error(
                    "invalid_worktree",
                    "The selected folder is not a Git worktree.",
                    "Choose another worktree for the same repository.",
                )
            })?;
        let expected = canonical_key(Path::new(&record.repository_identity));
        if !expected.is_empty() && canonical_key(&identity) != expected {
            return Err(resume_error(
                "worktree_repository_mismatch",
                "The selected worktree belongs to a different repository.",
                "Choose a worktree created from the original repository.",
            ));
        }
        let branch = git_value(&path, &["branch", "--show-current"]);
        self.database.relocate_agent_resume_worktree(
            terminal_session_id,
            &path.to_string_lossy(),
            branch.as_deref(),
        )?;
        self.database.get_agent_resume_record(terminal_session_id)
    }

    fn validate(
        &self,
        mut record: AgentResumeRecord,
        allow_missing_pane: bool,
    ) -> AppResult<AgentResumeRecord> {
        if !matches!(
            record.provider,
            AgentProvider::Claude | AgentProvider::Codex
        ) {
            return Err(resume_error(
                "provider_unavailable",
                "Only Claude Code and Codex sessions can be resumed.",
                "Remove this unsupported session.",
            ));
        }
        let identifier = record.provider_session_id.as_deref().ok_or_else(|| {
            resume_error(
                "session_identity_missing",
                "The exact provider session identifier was not captured.",
                "Start a new session or remove this unavailable record.",
            )
        })?;
        Uuid::parse_str(identifier).map_err(|_| {
            resume_error(
                "invalid_provider_session",
                "The saved provider session identifier is corrupted.",
                "Remove this session from the Resume Center.",
            )
        })?;
        let project = self.database.get_project(&record.project_id)?;
        let workspace = self.database.get_workspace(&record.workspace_id)?;
        if workspace.project_id != record.project_id {
            return Err(resume_error(
                "workspace_project_mismatch",
                "The saved Workspace belongs to a different Project.",
                "Remove this corrupted session or open the original Project.",
            ));
        }
        if !workspace.panes.iter().any(|pane| pane.id == record.pane_id) && !allow_missing_pane {
            return Err(resume_error(
                "pane_missing",
                "The original terminal pane no longer exists.",
                "Resume in a new terminal or remove this session.",
            ));
        }
        if workspace.panes.is_empty() {
            return Err(resume_error(
                "workspace_empty",
                "The saved Workspace has no terminal pane to host this session.",
                "Open the Project and add a terminal, then retry in a new terminal.",
            ));
        }
        let repository = canonical_directory(
            &record.repository_root,
            "project_missing",
            "The original Project folder is missing.",
        )?;
        let project_root = canonical_directory(
            &project.canonical_root_path,
            "project_missing",
            "The Project folder is missing.",
        )?;
        if canonical_key(&repository) != canonical_key(&project_root) {
            return Err(resume_error(
                "project_identity_mismatch",
                "The saved session no longer belongs to this Project.",
                "Locate the original Project or remove this corrupted session.",
            ));
        }
        let worktree = canonical_directory(
            &record.worktree_path,
            "worktree_missing",
            "The original worktree is missing.",
        )?;
        let cwd = canonical_directory(
            &record.working_directory,
            "working_directory_missing",
            "The original working directory is missing.",
        )?;
        if !path_is_within(&cwd, &worktree) {
            return Err(resume_error(
                "working_directory_mismatch",
                "The saved working directory is outside the selected worktree.",
                "Select a valid worktree before resuming.",
            ));
        }
        if !worktree_matches_repository(
            &repository,
            &worktree,
            Path::new(&record.repository_identity),
        ) {
            return Err(resume_error(
                "worktree_repository_mismatch",
                "The saved worktree belongs to a different repository.",
                "Select a worktree created from the original repository.",
            ));
        }
        if cfg!(windows)
            && (record.working_directory.starts_with('/')
                || record.worktree_path.starts_with("/mnt/"))
        {
            return Err(resume_error(
                "runtime_boundary_mismatch",
                "A native Windows provider cannot resume inside a WSL-only path.",
                "Open the matching native worktree or start the provider inside WSL.",
            ));
        }
        let executable = if Path::new(&record.launch_executable).is_file()
            && provider_executable_matches(&record.provider, &record.launch_executable)
        {
            PathBuf::from(&record.launch_executable)
        } else {
            which::which(match record.provider {
                AgentProvider::Claude => "claude",
                AgentProvider::Codex => "codex",
                _ => unreachable!(),
            })
            .map_err(|_| {
                resume_error(
                    "provider_cli_missing",
                    "The provider CLI is not installed or no longer available.",
                    "Install or configure the provider, then retry.",
                )
            })?
        };
        if !provider_session_exists(&record.provider, identifier) {
            return Err(resume_error(
                "provider_session_missing",
                "The provider no longer has this exact session on disk.",
                "Check the provider profile or remove this unavailable session.",
            ));
        }
        record.repository_root = repository.to_string_lossy().into_owned();
        record.worktree_path = worktree.to_string_lossy().into_owned();
        record.working_directory = cwd.to_string_lossy().into_owned();
        record.launch_executable = executable.to_string_lossy().into_owned();
        Ok(record)
    }
}

fn provider_session_exists(provider: &AgentProvider, identifier: &str) -> bool {
    provider_session_exists_in_roots(provider_session_roots(provider), identifier)
}

fn provider_session_exists_in_roots(
    roots: impl IntoIterator<Item = PathBuf>,
    identifier: &str,
) -> bool {
    roots.into_iter().any(|root| {
        let mut pending = vec![(root, 0_u8)];
        let needle = identifier.to_ascii_lowercase();
        let mut visited = 0_usize;
        while let Some((directory, depth)) = pending.pop() {
            if depth > 8 || visited >= 100_000 {
                continue;
            }
            let Ok(entries) = std::fs::read_dir(directory) else {
                continue;
            };
            for entry in entries.flatten() {
                visited += 1;
                if visited >= 100_000 {
                    break;
                }
                let path = entry.path();
                if path.is_dir() {
                    pending.push((path, depth + 1));
                } else if path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.to_ascii_lowercase().contains(&needle))
                {
                    return true;
                }
            }
        }
        false
    })
}

fn provider_session_roots(provider: &AgentProvider) -> Vec<PathBuf> {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from);
    match provider {
        AgentProvider::Claude => vec![std::env::var_os("CLAUDE_CONFIG_DIR")
            .map(PathBuf::from)
            .or_else(|| home.map(|path| path.join(".claude")))
            .unwrap_or_default()
            .join("projects")],
        AgentProvider::Codex => {
            let root = std::env::var_os("CODEX_HOME")
                .map(PathBuf::from)
                .or_else(|| home.map(|path| path.join(".codex")))
                .unwrap_or_default();
            vec![root.join("sessions"), root.join("archived_sessions")]
        }
        _ => Vec::new(),
    }
}

fn canonical_directory(path: &str, code: &str, message: &str) -> AppResult<PathBuf> {
    let path = Path::new(path);
    if !path.is_dir() {
        return Err(resume_error(
            code,
            message,
            "Locate the Project or select another valid worktree.",
        ));
    }
    std::fs::canonicalize(path).map_err(|error| {
        resume_error(code, message, "Check folder permissions and retry.").detail(error.to_string())
    })
}

fn canonical_key(path: &Path) -> String {
    let normalized = path
        .to_string_lossy()
        .trim_end_matches(['\\', '/'])
        .replace('\\', "/");
    if cfg!(windows) {
        normalized.to_ascii_lowercase()
    } else {
        normalized
    }
}

fn path_is_within(path: &Path, root: &Path) -> bool {
    let path = canonical_key(path);
    let root = canonical_key(root);
    path == root
        || path
            .strip_prefix(&root)
            .is_some_and(|rest| rest.starts_with('/'))
}

fn worktree_matches_repository(
    repository: &Path,
    worktree: &Path,
    expected_identity: &Path,
) -> bool {
    let expected = canonical_key(expected_identity);
    let current = git_value(worktree, &["rev-parse", "--git-common-dir"])
        .map(PathBuf::from)
        .map(|value| {
            if value.is_absolute() {
                value
            } else {
                worktree.join(value)
            }
        })
        .and_then(|value| std::fs::canonicalize(&value).ok().or(Some(value)));
    match current {
        Some(current) => {
            canonical_key(&current) == expected
                || (canonical_key(repository) == expected && path_is_within(worktree, repository))
        }
        None => path_is_within(worktree, repository),
    }
}

fn provider_executable_matches(provider: &AgentProvider, executable: &str) -> bool {
    let stem = Path::new(executable)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    match provider {
        AgentProvider::Claude => stem.eq_ignore_ascii_case("claude"),
        AgentProvider::Codex => stem.eq_ignore_ascii_case("codex"),
        _ => false,
    }
}

fn git_value(directory: &Path, arguments: &[&str]) -> Option<String> {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(directory)
        .args(arguments)
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

fn launch_has_session(
    provider: &AgentProvider,
    arguments: &[String],
    expected: Option<&str>,
) -> bool {
    let Some(expected) = expected else {
        return false;
    };
    match provider {
        AgentProvider::Claude => arguments.windows(2).any(|pair| {
            matches!(pair[0].as_str(), "--resume" | "--session-id" | "-r") && pair[1] == expected
        }),
        AgentProvider::Codex => arguments
            .windows(2)
            .any(|pair| pair[0] == "resume" && pair[1] == expected),
        _ => false,
    }
}

fn resume_error(code: &str, message: &str, action: &str) -> AppError {
    AppError::new(code, message, true)
        .action(action)
        .layer("agent_resume")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_session_matching_does_not_accept_latest() {
        let id = "5bb49df0-2afe-4fe2-8fd4-8aa4ba2943a9";
        assert!(launch_has_session(
            &AgentProvider::Claude,
            &["--resume".into(), id.into()],
            Some(id)
        ));
        assert!(launch_has_session(
            &AgentProvider::Codex,
            &["resume".into(), id.into()],
            Some(id)
        ));
        assert!(!launch_has_session(
            &AgentProvider::Codex,
            &["resume".into(), "--last".into()],
            Some(id)
        ));
    }

    #[test]
    fn path_scope_handles_unicode_and_rejects_siblings() {
        assert!(path_is_within(
            Path::new("C:/repos/පැරලිත්/worktree/src"),
            Path::new("C:/repos/පැරලිත්/worktree")
        ));
        assert!(!path_is_within(
            Path::new("C:/repos/other"),
            Path::new("C:/repos/පැරලිත්/worktree")
        ));
    }

    #[test]
    fn missing_paths_return_actionable_recovery_codes() {
        let missing = std::env::temp_dir().join(format!("paralith-missing-{}", Uuid::new_v4()));
        let error = canonical_directory(
            &missing.to_string_lossy(),
            "worktree_missing",
            "The original worktree is missing.",
        )
        .unwrap_err();
        assert_eq!(error.code, "worktree_missing");
        assert!(error.recommended_action.is_some());
    }

    #[test]
    fn provider_identity_fallback_checks_filenames_without_reading_transcripts() {
        let root = std::env::temp_dir().join(format!("paralith-provider-{}", Uuid::new_v4()));
        let nested = root.join("2026").join("07").join("30");
        std::fs::create_dir_all(&nested).unwrap();
        let identifier = Uuid::new_v4().to_string();
        std::fs::write(
            nested.join(format!("rollout-{identifier}.jsonl")),
            b"not valid transcript data",
        )
        .unwrap();
        assert!(provider_session_exists_in_roots(
            [root.clone()],
            &identifier
        ));
        assert!(!provider_session_exists_in_roots(
            [root.clone()],
            &Uuid::new_v4().to_string()
        ));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn provider_executables_reject_corrupted_cross_provider_metadata() {
        assert!(provider_executable_matches(
            &AgentProvider::Claude,
            "C:/tools/claude.exe"
        ));
        assert!(provider_executable_matches(
            &AgentProvider::Codex,
            "C:/tools/codex.cmd"
        ));
        assert!(!provider_executable_matches(
            &AgentProvider::Claude,
            "C:/tools/codex.exe"
        ));
        assert!(!provider_executable_matches(
            &AgentProvider::Codex,
            "C:/tools/powershell.exe"
        ));
    }
}

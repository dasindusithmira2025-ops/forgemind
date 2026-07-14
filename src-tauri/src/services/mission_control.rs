use crate::agents::{
    AgentExecutionAdapter, AgentExecutionContext, CliAgentExecutionAdapter, CompletionSignal,
};
use crate::database::DatabaseService;
use crate::errors::{AppError, AppResult};
use crate::models::*;
use crate::services::{mission_domain, TerminalManager};
use chrono::Utc;
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::collections::{BTreeSet, HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

#[derive(Clone)]
pub struct MissionControlService {
    database: Arc<DatabaseService>,
    terminals: TerminalManager,
    app: AppHandle,
    verification_cancellations: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

impl MissionControlService {
    pub fn new(database: Arc<DatabaseService>, terminals: TerminalManager, app: AppHandle) -> Self {
        Self {
            database,
            terminals,
            app,
            verification_cancellations: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn suggest_plan(&self, mission_id: &str) -> AppResult<Vec<MissionPlanSuggestion>> {
        let bundle = self.database.get_mission_bundle(mission_id)?;
        let all = bundle
            .acceptance_criteria
            .iter()
            .map(|criterion| criterion.id.clone())
            .collect::<Vec<_>>();
        let mut suggestions = vec![MissionPlanSuggestion {
            title: "Implement mission changes".into(),
            description: bundle.mission.objective.clone(),
            role: "General implementation".into(),
            dependency_indexes: vec![],
            acceptance_criterion_ids: all.clone(),
            priority: 0,
        }];
        if bundle.mission.risk_level == "high"
            || bundle
                .mission
                .objective
                .to_ascii_lowercase()
                .contains("security")
            || bundle
                .mission
                .objective
                .to_ascii_lowercase()
                .contains("auth")
        {
            suggestions.push(MissionPlanSuggestion { title:"Review security and failure modes".into(),description:"Review permission boundaries, sensitive data handling, abuse cases, and rollback behavior.".into(),role:"Security reviewer".into(),dependency_indexes:vec![0],acceptance_criterion_ids:all.clone(),priority:1 });
        }
        suggestions.push(MissionPlanSuggestion { title:"Verify acceptance criteria".into(),description:"Run the approved verification profile, inspect the final diff, and map evidence to every acceptance criterion.".into(),role:"QA".into(),dependency_indexes:(0..suggestions.len()).collect(),acceptance_criterion_ids:all,priority:suggestions.len() as i64 });
        Ok(suggestions)
    }

    pub fn discover_project_context(&self, project_id: &str) -> AppResult<ProjectContextDiscovery> {
        let project = self.database.get_project(project_id)?;
        let root = Path::new(&project.root_path);
        let mut stack = project.major_languages.clone();
        if let Some(framework) = project.detected_framework.clone() {
            stack.push(framework);
        }
        if let Some(manager) = project.package_manager.clone() {
            stack.push(manager);
        }
        stack.sort();
        stack.dedup();
        let instruction_files = ["AGENTS.md", "CLAUDE.md", "CONTRIBUTING.md", "README.md"]
            .iter()
            .map(|name| root.join(name))
            .filter(|path| path.is_file())
            .map(|path| path.display().to_string())
            .collect::<Vec<_>>();
        let mut build_commands = Vec::new();
        let mut test_commands = Vec::new();
        let mut checks = Vec::new();
        if let Ok(text) = fs::read_to_string(root.join("package.json")) {
            if let Ok(value) = serde_json::from_str::<Value>(&text) {
                if let Some(scripts) = value.get("scripts").and_then(Value::as_object) {
                    for (name, _) in scripts {
                        let command = format!("npm run {name}");
                        let lower = name.to_ascii_lowercase();
                        if lower.contains("test") {
                            test_commands.push(command.clone());
                        }
                        if lower == "build" || lower.contains("typecheck") || lower.contains("lint")
                        {
                            build_commands.push(command.clone());
                        }
                        if matches!(name.as_str(), "lint" | "typecheck" | "test" | "build") {
                            checks.push(VerificationCheckDefinition {
                                id: Uuid::new_v4().to_string(),
                                name: display_check_name(name),
                                command,
                                required: true,
                                timeout_ms: if name == "test" { 300_000 } else { 180_000 },
                                working_directory: None,
                                continue_on_failure: true,
                            });
                        }
                    }
                }
            }
        }
        if root.join("Cargo.toml").is_file() || root.join("src-tauri").join("Cargo.toml").is_file()
        {
            let working = if root.join("Cargo.toml").is_file() {
                None
            } else {
                Some("src-tauri".into())
            };
            for (name, command, timeout) in [
                ("Rust format", "cargo fmt --check", 120_000),
                ("Rust tests", "cargo test", 300_000),
            ] {
                checks.push(VerificationCheckDefinition {
                    id: Uuid::new_v4().to_string(),
                    name: name.into(),
                    command: command.into(),
                    required: true,
                    timeout_ms: timeout,
                    working_directory: working.clone(),
                    continue_on_failure: true,
                });
            }
            test_commands.push("cargo test".into());
        }
        let context = ProjectContext {
            project_id: project.id.clone(),
            architecture_summary: None,
            technology_stack: stack,
            important_paths: vec![project.root_path.clone()],
            conventions: vec![],
            build_commands,
            test_commands,
            user_instructions: instruction_files
                .iter()
                .map(|path| format!("Read and follow {path}"))
                .collect(),
            updated_at: Utc::now().to_rfc3339(),
        };
        let profile = VerificationProfile {
            id: Uuid::new_v4().to_string(),
            project_id: project.id,
            name: "Suggested project checks".into(),
            checks,
            approved: false,
            created_at: Utc::now().to_rfc3339(),
            updated_at: Utc::now().to_rfc3339(),
        };
        Ok(ProjectContextDiscovery {
            context,
            suggested_verification_profile: profile,
            instruction_files,
        })
    }

    pub fn dispatch_task(&self, request: &DispatchTaskRequest) -> AppResult<DispatchResult> {
        let mut task = self.database.get_mission_task(&request.task_id)?;
        self.database.refresh_dependency_states(&task.mission_id)?;
        task = self.database.get_mission_task(&request.task_id)?;
        if task.status != "ready" && task.status != "failed" && task.status != "review" {
            return Err(AppError::new(
                "task_not_ready",
                "This task cannot start until every required dependency passes.",
                true,
            )
            .entity(&task.id)
            .layer("mission-domain"));
        }
        let _lock = self.database.acquire_task_lock(&task.id)?;
        match self.dispatch_locked(task, request) {
            Ok(result) => Ok(result),
            Err(error) => {
                let task = self.database.get_mission_task(&request.task_id).ok();
                if let Some(task) = task {
                    let _ = self.database.release_task_lock(&task.id, "failed");
                    let _ = self.database.add_task_event(
                        &task.mission_id,
                        Some(&task.id),
                        "task-failed",
                        "Task dispatch failed",
                        &error.message,
                        "failed",
                        json!({"code":error.code}),
                    );
                    let _ = self.database.add_audit_event(
                        Some(&task.mission_id),
                        Some(&task.id),
                        "session-launch",
                        "failed",
                        &error.message,
                        json!({"code":error.code}),
                    );
                }
                Err(error)
            }
        }
    }

    fn dispatch_locked(
        &self,
        task: MissionTask,
        request: &DispatchTaskRequest,
    ) -> AppResult<DispatchResult> {
        let mission = self.database.get_mission(&task.mission_id)?;
        let project = self.database.get_project(&mission.project_id)?;
        let agent_id = task.agent_id.as_deref().ok_or_else(|| {
            AppError::new(
                "agent_required",
                "Assign a detected coding agent before dispatching this task.",
                true,
            )
            .entity(&task.id)
            .layer("mission-domain")
        })?;
        let profile = self.database.get_agent_profile(agent_id)?;
        if !matches!(
            mission.permission_profile.as_str(),
            "edit-worktree" | "full-project-access"
        ) {
            return Err(AppError::new(
                "permission_profile_not_dispatchable",
                "This permission profile does not allow an autonomous coding-agent session.",
                true,
            )
            .entity(&mission.id)
            .action("Choose Edit worktree, or use approved verification commands without agent dispatch.")
            .layer("mission-permissions"));
        }
        let existing_worktree = self
            .database
            .get_worktree_for_task(&task.id)?
            .filter(|record| {
                Path::new(&record.worktree_path).is_dir()
                    && matches!(record.status.as_str(), "ready" | "dirty" | "conflicted")
            });
        let (worktree, mut warning) = if project.is_git_repository {
            let record = if let Some(record) = existing_worktree {
                record
            } else {
                self.create_worktree(
                    &mission,
                    &task,
                    &project,
                    request.base_ref.as_deref().unwrap_or("HEAD"),
                )?
            };
            (Some(record), None)
        } else if request.allow_non_isolated {
            (None, Some("This project is not a Git repository. The task is running without worktree isolation; parallel execution is unsafe.".into()))
        } else {
            return Err(AppError::new("git_repository_required", "This project is not Git-enabled. Confirm non-isolated execution before dispatching.", true).entity(&project.root_path).action("Initialize Git or explicitly allow non-isolated execution.").layer("worktree"));
        };
        let working_directory = worktree
            .as_ref()
            .map(|record| record.worktree_path.clone())
            .unwrap_or(project.root_path.clone());
        let bundle = self.database.get_mission_bundle(&mission.id)?;
        let relevant_criteria = bundle
            .acceptance_criteria
            .iter()
            .filter(|criterion| task.acceptance_criterion_ids.contains(&criterion.id))
            .map(|criterion| criterion.description.clone())
            .collect();
        let dependencies = bundle
            .tasks
            .iter()
            .filter(|candidate| task.dependency_ids.contains(&candidate.id))
            .map(|candidate| format!("{}: {}", candidate.title, candidate.status))
            .collect();
        let adapter = CliAgentExecutionAdapter::new(profile.clone());
        let context = AgentExecutionContext {
            mission: mission.clone(),
            acceptance_criteria: relevant_criteria,
            dependency_summaries: dependencies,
            project_instructions: self.project_instructions(Path::new(&project.root_path)),
            working_directory: working_directory.clone(),
        };
        let launch = adapter.build_launch_command(&task, &context)?;
        debug_assert_eq!(adapter.agent_id(), profile.id);
        let (workspace_id, pane_id) = self.database.create_mission_runtime_workspace(
            &mission,
            &task,
            &profile,
            &working_directory,
        )?;
        let terminal = self.terminals.create_session(CreateTerminalRequest {
            project_id: project.id,
            workspace_id: workspace_id.clone(),
            pane_id: pane_id.clone(),
            provider: profile.provider.clone(),
            title: task.title.clone(),
            executable_path: profile.executable_path.clone(),
            args: launch.arguments,
            working_directory: working_directory.clone(),
            cols: 120,
            rows: 32,
            restoration_attempt: false,
        })?;
        if matches!(
            profile.provider,
            AgentProvider::Powershell | AgentProvider::CommandPrompt | AgentProvider::Wsl
        ) {
            warning = Some("This task uses a regular shell session. ForgeMind tracks its session and verification, but the task instructions must be executed manually.".into());
            self.database.add_task_event(
                &mission.id,
                Some(&task.id),
                "warning",
                "Manual shell task",
                warning.as_deref().unwrap_or_default(),
                "warning",
                json!({}),
            )?;
        }
        let now = Utc::now().to_rfc3339();
        let persisted = PersistedAgentSession {
            id: Uuid::new_v4().to_string(),
            mission_id: mission.id.clone(),
            task_id: task.id.clone(),
            agent_id: profile.id,
            terminal_session_id: Some(terminal.id.clone()),
            workspace_id: Some(workspace_id),
            pane_id: Some(pane_id),
            worktree_id: worktree.as_ref().map(|record| record.id.clone()),
            working_directory: working_directory.clone(),
            command: launch.command_summary,
            process_id: terminal.process_id,
            external_session_id: None,
            transcript_path: terminal.log_path.clone(),
            status: "running".into(),
            started_at: now.clone(),
            last_heartbeat_at: Some(now),
            recovery_metadata: json!({"terminalStatus":"running"}),
        };
        self.database.save_mission_session(&persisted)?;
        self.database.update_task_runtime(
            &task.id,
            "running",
            Some(&working_directory),
            worktree.as_ref().map(|record| record.id.as_str()),
            Some(&persisted.id),
        )?;
        self.database.recompute_mission_status(&mission.id)?;
        self.database.add_task_event(&mission.id,Some(&task.id),"task-started","Agent execution started",warning.as_deref().unwrap_or("Task launched in an isolated ForgeMind worktree."),"running",json!({"terminalSessionId":terminal.id,"worktreeId":worktree.as_ref().map(|record|&record.id)}))?;
        self.database.add_audit_event(
            Some(&mission.id),
            Some(&task.id),
            "session-launch",
            "passed",
            "ForgeMind launched the assigned agent through the owned terminal runtime.",
            json!({"terminalSessionId":terminal.id,"agentId":persisted.agent_id}),
        )?;
        let _ = self.app.emit_to(
            crate::services::MAIN_WINDOW_LABEL,
            "mission-task-event",
            json!({"missionId":mission.id,"taskId":task.id,"type":"task-started"}),
        );
        Ok(DispatchResult {
            task: self.database.get_mission_task(&task.id)?,
            worktree,
            session: persisted,
            terminal_session_id: Some(terminal.id),
            warning,
        })
    }

    pub fn create_worktree(
        &self,
        mission: &Mission,
        task: &MissionTask,
        project: &Project,
        base_ref: &str,
    ) -> AppResult<WorktreeRecord> {
        let repository = PathBuf::from(&project.root_path);
        if git(&repository, ["rev-parse", "--is-inside-work-tree"])?.trim() != "true" {
            return Err(worktree_error(
                "not_git_repository",
                "ForgeMind could not verify this Project as a Git repository.",
                &project.root_path,
            ));
        }
        let primary_dirty = !git(&repository, ["status", "--porcelain"])?.is_empty();
        let resolved_base = git(&repository, ["rev-parse", base_ref])?.trim().to_owned();
        let mission_short = &mission.id[..mission.id.len().min(8)];
        let task_short = &task.id[..task.id.len().min(8)];
        let slug = mission_domain::sanitize_slug(&task.title, 32);
        let branch = format!(
            "forgemind/{mission_short}/{task_short}-{}",
            if slug.is_empty() { "task" } else { &slug }
        );
        if git_status(
            &repository,
            [
                "show-ref",
                "--verify",
                "--quiet",
                &format!("refs/heads/{branch}"),
            ],
        )?
        .0
        {
            return Err(worktree_error(
                "worktree_branch_collision",
                "The deterministic ForgeMind task branch already exists.",
                &branch,
            ));
        }
        let root = self
            .database
            .path()
            .and_then(Path::parent)
            .ok_or_else(|| {
                worktree_error(
                    "worktree_root_unavailable",
                    "ForgeMind could not resolve its controlled worktree directory.",
                    &task.id,
                )
            })?
            .join("worktrees")
            .join(&project.id)
            .join(mission_short);
        fs::create_dir_all(&root).map_err(|error| {
            worktree_error(
                "worktree_create_failed",
                "ForgeMind could not create its controlled worktree directory.",
                &error.to_string(),
            )
        })?;
        let mut path = root.join(format!(
            "{task_short}-{}",
            if slug.is_empty() { "task" } else { &slug }
        ));
        if path.to_string_lossy().len() > 230 {
            path = root.join(task_short);
        }
        if path.exists() {
            return Err(worktree_error(
                "worktree_path_collision",
                "The deterministic task worktree path already exists.",
                &path.display().to_string(),
            ));
        }
        // Ownership metadata lives beside the worktree, not inside it, so it
        // can never pollute the agent's diff or be committed into the project.
        let id = Uuid::new_v4().to_string();
        let marker = root.join(format!(".{task_short}.forgemind-owner.json"));
        let now = Utc::now().to_rfc3339();
        let base_branch = git(&repository, ["branch", "--show-current"])
            .ok()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());
        let mut record = WorktreeRecord {
            id: id.clone(),
            mission_id: mission.id.clone(),
            task_id: task.id.clone(),
            repository_path: project.root_path.clone(),
            worktree_path: path.display().to_string(),
            branch_name: branch.clone(),
            base_ref: resolved_base.clone(),
            base_branch,
            status: "creating".into(),
            owner_marker_path: marker.display().to_string(),
            restore_ref: None,
            merge_commit: None,
            created_at: now.clone(),
            updated_at: now,
        };
        self.database.save_worktree(&record)?;
        let output = git_output(
            &repository,
            [
                "worktree",
                "add",
                "-b",
                &branch,
                &record.worktree_path,
                &resolved_base,
            ],
        )?;
        if !output.status.success() {
            record.status = "cleanup-failed".into();
            record.updated_at = Utc::now().to_rfc3339();
            self.database.save_worktree(&record)?;
            return Err(worktree_error(
                "worktree_create_failed",
                "Git could not create the task worktree.",
                &safe_output(&output),
            ));
        }
        if let Err(error) = fs::write(&marker,json!({"owner":"ForgeMind","worktreeId":id,"missionId":mission.id,"taskId":task.id,"repositoryPath":project.root_path}).to_string()) {
            record.status = "cleanup-failed".into();
            record.updated_at = Utc::now().to_rfc3339();
            self.database.save_worktree(&record)?;
            self.database.add_audit_event(Some(&mission.id), Some(&task.id), "worktree-creation", "failed", "The worktree exists but ownership metadata could not be written; automatic cleanup is disabled.", json!({"diagnostic":error.to_string()}))?;
            return Err(worktree_error("worktree_marker_failed","ForgeMind created the worktree but could not write its ownership marker. It was preserved for manual recovery.",&error.to_string()));
        }
        record.status = "ready".into();
        record.updated_at = Utc::now().to_rfc3339();
        self.database.save_worktree(&record)?;
        self.database.add_task_event(
            &mission.id,
            Some(&task.id),
            "worktree-created",
            "Isolated worktree created",
            &format!("Branch {} at {}", record.branch_name, record.worktree_path),
            "passed",
            json!({"dirtyPrimaryCheckout":primary_dirty}),
        )?;
        if primary_dirty {
            self.database.add_task_event(
                &mission.id,
                Some(&task.id),
                "warning",
                "Primary checkout has uncommitted changes",
                "The task is isolated from those changes. ForgeMind will require a clean primary checkout before merge.",
                "warning",
                json!({}),
            )?;
        }
        self.database.add_audit_event(
            Some(&mission.id),
            Some(&task.id),
            "worktree-creation",
            "passed",
            "ForgeMind created and marked an owned Git worktree.",
            json!({"worktreeId":record.id,"branch":record.branch_name}),
        )?;
        Ok(record)
    }

    pub fn run_verification(
        &self,
        task_id: &str,
        check_id: Option<&str>,
    ) -> AppResult<Vec<VerificationResult>> {
        let task = self.database.get_mission_task(task_id)?;
        if !matches!(
            task.status.as_str(),
            "verifying" | "review" | "blocked" | "passed"
        ) {
            return Err(AppError::new(
                "verification_task_not_ready",
                "Verification can start only after agent execution has stopped.",
                true,
            )
            .entity(task_id)
            .layer("verification"));
        }
        let mission = self.database.get_mission(&task.mission_id)?;
        let profile_id = task
            .verification_profile_id
            .as_deref()
            .or(mission.verification_profile_id.as_deref())
            .ok_or_else(|| {
                AppError::new(
                    "verification_profile_required",
                    "Select and approve a verification profile before running checks.",
                    true,
                )
                .entity(task_id)
                .layer("verification")
            })?;
        let profiles = self
            .database
            .list_verification_profiles(&mission.project_id)?;
        let profile = profiles
            .into_iter()
            .find(|profile| profile.id == profile_id)
            .ok_or_else(|| {
                AppError::new(
                    "verification_profile_not_found",
                    "The selected verification profile no longer exists.",
                    true,
                )
                .entity(profile_id)
                .layer("verification")
            })?;
        if !profile.approved {
            return Err(AppError::new(
                "verification_profile_unapproved",
                "Review and approve the suggested commands before running them.",
                true,
            )
            .entity(profile_id)
            .layer("verification"));
        }
        let root = task.working_directory.as_deref().ok_or_else(|| {
            AppError::new(
                "task_working_directory_missing",
                "This task has no execution directory.",
                true,
            )
            .entity(task_id)
            .layer("verification")
        })?;
        let selected = profile
            .checks
            .iter()
            .filter(|check| check_id.map_or(true, |id| id == check.id))
            .cloned()
            .collect::<Vec<_>>();
        if selected.is_empty() {
            return Err(AppError::new(
                "verification_check_not_found",
                "The requested verification check does not exist.",
                true,
            )
            .entity(check_id.unwrap_or_default())
            .layer("verification"));
        }
        self.database
            .update_task_runtime(task_id, "verifying", None, None, None)?;
        let mut results = Vec::new();
        for check in selected {
            let result = self.run_check(&mission, &task, &check, Path::new(root))?;
            let failed = result.status != "passed";
            results.push(result);
            if failed && check.required && !check.continue_on_failure {
                break;
            }
        }
        let required_passed = mission_domain::verification_passed(
            &profile.checks,
            &self
                .database
                .get_mission_bundle(&mission.id)?
                .verification_results,
        );
        self.database.update_task_runtime(
            task_id,
            if required_passed { "review" } else { "blocked" },
            None,
            None,
            None,
        )?;
        self.database.recompute_mission_status(&mission.id)?;
        Ok(results)
    }

    fn run_check(
        &self,
        mission: &Mission,
        task: &MissionTask,
        check: &VerificationCheckDefinition,
        root: &Path,
    ) -> AppResult<VerificationResult> {
        let key = format!("{}:{}", task.id, check.id);
        let cancel = Arc::new(AtomicBool::new(false));
        self.verification_cancellations
            .lock()
            .insert(key.clone(), cancel.clone());
        let requested_working = check
            .working_directory
            .as_deref()
            .map(|relative| root.join(relative))
            .unwrap_or_else(|| root.to_path_buf());
        if !requested_working.is_dir() {
            self.verification_cancellations.lock().remove(&key);
            return Err(AppError::new(
                "verification_directory_missing",
                "A verification working directory does not exist.",
                true,
            )
            .entity(requested_working.display().to_string())
            .layer("verification"));
        }
        let canonical_root = match fs::canonicalize(root) {
            Ok(path) => path,
            Err(error) => {
                self.verification_cancellations.lock().remove(&key);
                return Err(AppError::new(
                    "verification_directory_unavailable",
                    "ForgeMind could not verify the task worktree.",
                    true,
                )
                .detail(error.to_string())
                .entity(root.display().to_string())
                .layer("verification"));
            }
        };
        let working = match fs::canonicalize(&requested_working) {
            Ok(path) => path,
            Err(error) => {
                self.verification_cancellations.lock().remove(&key);
                return Err(AppError::new(
                    "verification_directory_unavailable",
                    "ForgeMind could not verify the check working directory.",
                    true,
                )
                .detail(error.to_string())
                .entity(requested_working.display().to_string())
                .layer("verification"));
            }
        };
        if !working.starts_with(&canonical_root) {
            self.verification_cancellations.lock().remove(&key);
            return Err(AppError::new(
                "verification_directory_outside_worktree",
                "Verification commands may only run inside the assigned task worktree.",
                true,
            )
            .entity(working.display().to_string())
            .layer("mission-permissions"));
        }
        self.database.add_task_event(
            &mission.id,
            Some(&task.id),
            "verification",
            "Verification started",
            &check.name,
            "running",
            json!({"checkId":check.id,"command":check.command}),
        )?;
        let started = Utc::now().to_rfc3339();
        let started_clock = Instant::now();
        let mut command = command_shell(&check.command);
        command
            .current_dir(&working)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = command.spawn().map_err(|error| {
            self.verification_cancellations.lock().remove(&key);
            AppError::new(
                "verification_launch_failed",
                "ForgeMind could not start a verification command.",
                true,
            )
            .detail(error.to_string())
            .entity(&check.id)
            .layer("verification")
        })?;
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let out_thread = thread::spawn(move || read_pipe(stdout));
        let err_thread = thread::spawn(move || read_pipe(stderr));
        let timeout = Duration::from_millis(check.timeout_ms.max(100));
        let mut timed_out = false;
        let mut cancelled = false;
        let status = loop {
            if cancel.load(Ordering::Relaxed) {
                cancelled = true;
                let _ = child.kill();
                break child.wait().ok();
            }
            if started_clock.elapsed() >= timeout {
                timed_out = true;
                let _ = child.kill();
                break child.wait().ok();
            }
            match child.try_wait() {
                Ok(Some(status)) => break Some(status),
                Ok(None) => thread::sleep(Duration::from_millis(50)),
                Err(_) => break None,
            }
        };
        let mut output = out_thread.join().unwrap_or_default();
        output.extend_from_slice(&err_thread.join().unwrap_or_default());
        let safe = mission_domain::redact_secrets(&String::from_utf8_lossy(&output));
        let status_name = if timed_out {
            "timed-out"
        } else if cancelled {
            "cancelled"
        } else if status.is_some_and(|value| value.success()) {
            "passed"
        } else {
            "failed"
        };
        let completed = Utc::now().to_rfc3339();
        let result_id = Uuid::new_v4().to_string();
        let artifact = self.artifact_path(
            &mission.id,
            &task.id,
            &format!("verification-{result_id}.log"),
        )?;
        fs::write(&artifact, &safe).map_err(|error| {
            AppError::new(
                "artifact_write_failed",
                "ForgeMind could not preserve the verification log.",
                true,
            )
            .detail(error.to_string())
            .layer("verification")
        })?;
        let excerpt = tail_chars(&safe, 8000);
        let result = VerificationResult {
            id: result_id.clone(),
            task_id: task.id.clone(),
            check_id: check.id.clone(),
            status: status_name.into(),
            exit_code: status.and_then(|value| value.code()),
            started_at: Some(started),
            completed_at: Some(completed),
            duration_ms: Some(
                started_clock
                    .elapsed()
                    .as_millis()
                    .min(u128::from(u64::MAX)) as u64,
            ),
            output_excerpt: Some(excerpt),
            artifact_ids: vec![artifact.display().to_string()],
        };
        self.database.save_verification_result(&result)?;
        let evidence = EvidenceRecord {
            id: Uuid::new_v4().to_string(),
            mission_id: mission.id.clone(),
            task_id: Some(task.id.clone()),
            acceptance_criterion_id: None,
            evidence_type: if check.name.to_ascii_lowercase().contains("build") {
                "build-result".into()
            } else {
                "test-result".into()
            },
            title: check.name.clone(),
            summary: format!(
                "{} (exit code {})",
                status_name,
                result
                    .exit_code
                    .map(|v| v.to_string())
                    .unwrap_or_else(|| "none".into())
            ),
            status: if status_name == "passed" {
                "passed".into()
            } else {
                "failed".into()
            },
            source_path: Some(working.display().to_string()),
            command: Some(check.command.clone()),
            artifact_path: Some(artifact.display().to_string()),
            metadata: json!({"checkId":check.id,"durationMs":result.duration_ms,"timedOut":timed_out}),
            created_at: Utc::now().to_rfc3339(),
        };
        self.database.save_evidence(&evidence)?;
        // A verification check is proof for every criterion assigned to this
        // task. Keep separate records so criterion aggregation remains
        // deterministic and a failed required check fails each covered item.
        if check.required {
            for criterion_id in &task.acceptance_criterion_ids {
                let mut criterion_evidence = evidence.clone();
                criterion_evidence.id = Uuid::new_v4().to_string();
                criterion_evidence.acceptance_criterion_id = Some(criterion_id.clone());
                self.database.save_evidence(&criterion_evidence)?;
            }
        }
        self.database.add_task_event(
            &mission.id,
            Some(&task.id),
            "verification",
            "Verification completed",
            &evidence.summary,
            &evidence.status,
            json!({"checkId":check.id,"resultId":result.id}),
        )?;
        self.verification_cancellations.lock().remove(&key);
        let _ = self.app.emit_to(
            crate::services::MAIN_WINDOW_LABEL,
            "mission-task-event",
            json!({"missionId":mission.id,"taskId":task.id,"type":"verification"}),
        );
        Ok(result)
    }

    pub fn cancel_verification(&self, task_id: &str, check_id: &str) -> bool {
        self.verification_cancellations
            .lock()
            .get(&format!("{task_id}:{check_id}"))
            .is_some_and(|flag| {
                flag.store(true, Ordering::Relaxed);
                true
            })
    }

    pub fn collect_evidence(&self, task_id: &str) -> AppResult<Vec<EvidenceRecord>> {
        let task = self.database.get_mission_task(task_id)?;
        let mission = self.database.get_mission(&task.mission_id)?;
        let mut created = Vec::new();
        if let Some(worktree) = self.database.get_worktree_for_task(task_id)? {
            let path = Path::new(&worktree.worktree_path);
            let files = changed_file_paths(path, &worktree.base_ref)?;
            let count = files.len();
            let evidence = EvidenceRecord {
                id: Uuid::new_v4().to_string(),
                mission_id: mission.id.clone(),
                task_id: Some(task.id.clone()),
                acceptance_criterion_id: None,
                evidence_type: "changed-file-list".into(),
                title: "Changed files".into(),
                summary: format!("{count} changed file{}", if count == 1 { "" } else { "s" }),
                status: "informational".into(),
                source_path: Some(worktree.worktree_path.clone()),
                command: Some("git status --porcelain".into()),
                artifact_path: None,
                metadata: json!({"files":files}),
                created_at: Utc::now().to_rfc3339(),
            };
            self.database.save_evidence(&evidence)?;
            created.push(evidence);
            let diff = git(path, ["diff", "--stat", &worktree.base_ref])?;
            let evidence = EvidenceRecord {
                id: Uuid::new_v4().to_string(),
                mission_id: mission.id.clone(),
                task_id: Some(task.id.clone()),
                acceptance_criterion_id: None,
                evidence_type: "git-diff".into(),
                title: "Git diff summary".into(),
                summary: if diff.trim().is_empty() {
                    "No tracked diff detected.".into()
                } else {
                    tail_chars(&diff, 2000)
                },
                status: if count == 0 {
                    "warning".into()
                } else {
                    "informational".into()
                },
                source_path: Some(worktree.worktree_path),
                command: Some(format!("git diff --stat {}", worktree.base_ref)),
                artifact_path: None,
                metadata: json!({}),
                created_at: Utc::now().to_rfc3339(),
            };
            self.database.save_evidence(&evidence)?;
            created.push(evidence);
        }
        self.database.add_task_event(
            &mission.id,
            Some(&task.id),
            "task-completed",
            "Evidence summary collected",
            &format!("{} evidence records created", created.len()),
            "passed",
            json!({}),
        )?;
        Ok(created)
    }

    pub fn add_manual_evidence(
        &self,
        task_id: &str,
        criterion_id: &str,
        summary: &str,
        passed: bool,
    ) -> AppResult<EvidenceRecord> {
        let task = self.database.get_mission_task(task_id)?;
        if !task
            .acceptance_criterion_ids
            .iter()
            .any(|id| id == criterion_id)
            || summary.trim().is_empty()
        {
            return Err(AppError::new("invalid_manual_evidence", "Manual evidence requires a note and an acceptance criterion assigned to this task.", true).entity(task_id).layer("evidence"));
        }
        let evidence = EvidenceRecord {
            id: Uuid::new_v4().to_string(),
            mission_id: task.mission_id.clone(),
            task_id: Some(task.id.clone()),
            acceptance_criterion_id: Some(criterion_id.into()),
            evidence_type: "manual-verification-note".into(),
            title: "Manual verification".into(),
            summary: summary.trim().into(),
            status: if passed {
                "passed".into()
            } else {
                "warning".into()
            },
            source_path: None,
            command: None,
            artifact_path: None,
            metadata: json!({"userApproved":true}),
            created_at: Utc::now().to_rfc3339(),
        };
        self.database.save_evidence(&evidence)?;
        self.database.add_task_event(
            &task.mission_id,
            Some(task_id),
            "verification",
            "Manual evidence recorded",
            &evidence.summary,
            &evidence.status,
            json!({"evidenceId":evidence.id,"criterionId":criterion_id}),
        )?;
        self.database.add_audit_event(
            Some(&task.mission_id),
            Some(task_id),
            "manual-evidence",
            "passed",
            "The user recorded a manual verification note.",
            json!({"evidenceId":evidence.id,"criterionId":criterion_id,"status":evidence.status}),
        )?;
        Ok(evidence)
    }

    pub fn review(&self, task_id: &str) -> AppResult<ReviewSnapshot> {
        let task = self.database.get_mission_task(task_id)?;
        let bundle = self.database.get_mission_bundle(&task.mission_id)?;
        let worktree = self.database.get_worktree_for_task(task_id)?;
        let mut changed_files = Vec::new();
        let mut file_diffs = Vec::new();
        let mut unified_diff = String::new();
        let mut commits = Vec::new();
        let mut conflicts = Vec::new();
        if let Some(record) = &worktree {
            let path = Path::new(&record.worktree_path);
            if path.is_dir() {
                changed_files = changed_file_paths(path, &record.base_ref)?;
                file_diffs = changed_files
                    .iter()
                    .map(|file| build_file_diff(path, &record.base_ref, file))
                    .collect::<AppResult<Vec<_>>>()?;
                unified_diff = tail_chars(
                    &file_diffs
                        .iter()
                        .map(|file| file.diff.as_str())
                        .collect::<Vec<_>>()
                        .join("\n"),
                    1_000_000,
                );
                commits = git(
                    path,
                    ["log", "--oneline", &format!("{}..HEAD", record.base_ref)],
                )?
                .lines()
                .map(str::to_owned)
                .collect();
                conflicts = git(path, ["diff", "--name-only", "--diff-filter=U"])?
                    .lines()
                    .map(str::to_owned)
                    .collect();
            }
        }
        let results = bundle
            .verification_results
            .iter()
            .filter(|result| result.task_id == task.id)
            .cloned()
            .collect::<Vec<_>>();
        let evidence = bundle
            .evidence
            .iter()
            .filter(|evidence| evidence.task_id.as_deref() == Some(&task.id))
            .cloned()
            .collect::<Vec<_>>();
        let profile_id = task
            .verification_profile_id
            .as_deref()
            .or(bundle.mission.verification_profile_id.as_deref());
        let checks = profile_id
            .and_then(|id| {
                self.database
                    .list_verification_profiles(&bundle.mission.project_id)
                    .ok()?
                    .into_iter()
                    .find(|profile| profile.id == id)
                    .map(|profile| profile.checks)
            })
            .unwrap_or_default();
        let passed = mission_domain::verification_passed(&checks, &results);
        let mut warnings = Vec::new();
        if worktree.is_none() {
            warnings.push("Task ran without Git worktree isolation.".into());
        }
        if changed_files.is_empty() {
            warnings.push("No changed files were detected.".into());
        }
        if results.iter().any(|result| result.status != "passed") {
            warnings.push("One or more verification checks did not pass.".into());
        }
        let lower_files = changed_files
            .iter()
            .map(|value| value.to_ascii_lowercase())
            .collect::<Vec<_>>();
        let dependency_changes = changed_files
            .iter()
            .filter(|file| {
                matches!(
                    file.to_ascii_lowercase().as_str(),
                    "package.json"
                        | "package-lock.json"
                        | "pnpm-lock.yaml"
                        | "yarn.lock"
                        | "cargo.toml"
                        | "cargo.lock"
                        | "requirements.txt"
                        | "pyproject.toml"
                )
            })
            .cloned()
            .collect();
        let migration_files = changed_files
            .iter()
            .zip(&lower_files)
            .filter(|(_, lower)| {
                lower.contains("migration")
                    || lower.contains("migrations/")
                    || lower.contains("migrations\\")
            })
            .map(|(file, _)| file.clone())
            .collect();
        let environment_variable_names = extract_env_names(&unified_diff);
        let mut blockers = mission_domain::merge_blockers(
            &task,
            passed,
            !conflicts.is_empty(),
            worktree.as_ref().map(|record| record.status.as_str()),
        );
        let criterion_coverage = bundle.acceptance_criteria;
        for criterion in criterion_coverage.iter().filter(|criterion| {
            criterion.required
                && task.acceptance_criterion_ids.contains(&criterion.id)
                && criterion.status != "passed"
        }) {
            blockers.push(format!(
                "Required acceptance criterion is not proven: {}",
                criterion.description
            ));
        }
        Ok(ReviewSnapshot {
            task,
            worktree,
            changed_files,
            file_diffs,
            unified_diff,
            commits,
            verification_results: results,
            evidence,
            warnings,
            dependency_changes,
            migration_files,
            environment_variable_names,
            conflicts,
            criterion_coverage,
            merge_eligible: blockers.is_empty(),
            merge_blockers: blockers,
        })
    }

    pub fn accept_task(&self, task_id: &str) -> AppResult<MissionTask> {
        let review = self.review(task_id)?;
        if !review
            .merge_blockers
            .iter()
            .all(|blocker| blocker == "Task has not been explicitly accepted.")
        {
            return Err(AppError::new(
                "task_acceptance_blocked",
                "Required verification or worktree checks still block acceptance.",
                true,
            )
            .detail(review.merge_blockers.join(" "))
            .entity(task_id)
            .layer("review"));
        }
        self.database.release_task_lock(task_id, "passed")?;
        self.database.add_audit_event(
            Some(&review.task.mission_id),
            Some(task_id),
            "task-acceptance",
            "passed",
            "The user explicitly accepted the reviewed task.",
            json!({}),
        )?;
        self.database
            .refresh_dependency_states(&review.task.mission_id)?;
        self.database
            .recompute_mission_status(&review.task.mission_id)?;
        self.database.get_mission_task(task_id)
    }

    pub fn request_changes(&self, task_id: &str, instruction: &str) -> AppResult<MissionTask> {
        if instruction.trim().is_empty() {
            return Err(AppError::new(
                "follow_up_required",
                "A follow-up instruction is required.",
                true,
            )
            .entity(task_id)
            .layer("mission-domain"));
        }
        let task = self.database.get_mission_task(task_id)?;
        self.database
            .append_task_instruction(task_id, instruction)?;
        self.database.release_task_lock(task_id, "blocked")?;
        self.database.add_task_event(
            &task.mission_id,
            Some(task_id),
            "input-requested",
            "Changes requested",
            instruction,
            "warning",
            json!({}),
        )?;
        self.database.add_audit_event(
            Some(&task.mission_id),
            Some(task_id),
            "request-changes",
            "passed",
            "The user requested changes before acceptance.",
            json!({}),
        )?;
        self.database.get_mission_task(task_id)
    }

    pub fn stop_task(&self, task_id: &str) -> AppResult<MissionTask> {
        let task = self.database.get_mission_task(task_id)?;
        if let Some(session_id) = task.session_id.as_deref() {
            let bundle = self.database.get_mission_bundle(&task.mission_id)?;
            if let Some(session) = bundle
                .sessions
                .iter()
                .find(|session| session.id == session_id)
            {
                if let Some(terminal_id) = session.terminal_session_id.as_deref() {
                    let _ = self.terminals.terminate_session(terminal_id);
                }
                self.database
                    .update_mission_session_status(&session.id, "stopped", None)?;
            }
        }
        self.database.release_task_lock(task_id, "cancelled")?;
        self.database.recompute_mission_status(&task.mission_id)?;
        self.database.add_task_event(
            &task.mission_id,
            Some(task_id),
            "warning",
            "Task execution stopped",
            "The Agent Session was stopped by the user. Its worktree and evidence were preserved.",
            "warning",
            json!({}),
        )?;
        self.database.get_mission_task(task_id)
    }
    pub fn retry_task(&self, task_id: &str) -> AppResult<MissionTask> {
        let task = self.database.get_mission_task(task_id)?;
        if let Some(session_id) = task.session_id.as_deref() {
            let bundle = self.database.get_mission_bundle(&task.mission_id)?;
            if let Some(session) = bundle
                .sessions
                .iter()
                .find(|session| session.id == session_id)
                .and_then(|session| session.terminal_session_id.as_deref())
            {
                let _ = self.terminals.terminate_session(session);
            }
        }
        self.database.release_task_lock(task_id, "ready")?;
        self.database.refresh_dependency_states(&task.mission_id)?;
        self.database.recompute_mission_status(&task.mission_id)?;
        self.database.add_task_event(
            &task.mission_id,
            Some(task_id),
            "warning",
            "Task queued for retry",
            "The previous attempt and its evidence were preserved.",
            "warning",
            json!({"nextAttempt":task.attempt+1}),
        )?;
        self.database.get_mission_task(task_id)
    }

    pub fn merge_task(&self, task_id: &str) -> AppResult<WorktreeRecord> {
        let review = self.review(task_id)?;
        if !review.merge_eligible {
            return Err(AppError::new(
                "merge_blocked",
                "This task is not eligible to merge.",
                true,
            )
            .detail(review.merge_blockers.join(" "))
            .entity(task_id)
            .layer("merge"));
        }
        let task = review.task;
        let mut record = review.worktree.ok_or_else(|| {
            worktree_error(
                "worktree_missing",
                "The task worktree is unavailable.",
                task_id,
            )
        })?;
        let repository = Path::new(&record.repository_path);
        let worktree = Path::new(&record.worktree_path);
        if !git(repository, ["status", "--porcelain"])?
            .trim()
            .is_empty()
        {
            return Err(AppError::new(
                "primary_checkout_dirty",
                "The primary checkout has uncommitted changes. ForgeMind will not merge over them.",
                true,
            )
            .entity(&record.repository_path)
            .action("Commit or stash primary-checkout changes, then retry.")
            .layer("merge"));
        }
        let base_branch = record.base_branch.as_deref().ok_or_else(|| {
            AppError::new(
                "base_branch_unknown",
                "ForgeMind cannot verify the original base branch because dispatch started from a detached checkout.",
                true,
            )
            .entity(task_id)
            .action("Check out the intended base branch and retry this task from that branch.")
            .layer("merge")
        })?;
        if !git_status(
            repository,
            [
                "show-ref",
                "--verify",
                "--quiet",
                &format!("refs/heads/{base_branch}"),
            ],
        )?
        .0
        {
            return Err(AppError::new(
                "base_branch_missing",
                "The task's original base branch no longer exists.",
                true,
            )
            .entity(base_branch)
            .layer("merge"));
        }
        let current_branch = git(repository, ["symbolic-ref", "--quiet", "--short", "HEAD"])?
            .trim()
            .to_owned();
        if current_branch != base_branch {
            return Err(AppError::new(
                "base_branch_changed",
                "The primary checkout is no longer on the task's original base branch.",
                true,
            )
            .detail(format!("Expected {base_branch}; found {current_branch}."))
            .action("Switch back to the original base branch, then review and retry the merge.")
            .layer("merge"));
        }
        if !git_status(
            repository,
            [
                "show-ref",
                "--verify",
                "--quiet",
                &format!("refs/heads/{}", record.branch_name),
            ],
        )?
        .0
        {
            return Err(worktree_error(
                "task_branch_missing",
                "The task branch no longer exists.",
                &record.branch_name,
            ));
        }

        // Agents are not required to commit. The explicit Merge action creates
        // one auditable snapshot of the exact reviewed worktree before merging.
        if !git(worktree, ["status", "--porcelain"])?.trim().is_empty() {
            git_checked(worktree, ["add", "-A"])?;
            let message = format!("ForgeMind: {}", task.title);
            let commit = git_output(
                worktree,
                [
                    "-c",
                    "user.name=ForgeMind",
                    "-c",
                    "user.email=forgemind@local",
                    "commit",
                    "--no-gpg-sign",
                    "-m",
                    &message,
                ],
            )?;
            if !commit.status.success() {
                let _ = git_output(worktree, ["reset"]);
                return Err(AppError::new(
                    "merge_snapshot_failed",
                    "ForgeMind could not create the accepted task snapshot.",
                    true,
                )
                .detail(safe_output(&commit))
                .entity(task_id)
                .action("Resolve the reported Git issue in the task worktree, then retry.")
                .layer("merge"));
            }
            self.database.add_audit_event(
                Some(&record.mission_id),
                Some(task_id),
                "merge-snapshot",
                "passed",
                "ForgeMind committed the explicitly accepted worktree state before merge.",
                json!({"branch":record.branch_name}),
            )?;
        }

        let commits_ahead = git(
            worktree,
            ["rev-list", "--count", &format!("{}..HEAD", record.base_ref)],
        )?
        .trim()
        .parse::<u64>()
        .map_err(|error| {
            AppError::new(
                "merge_commit_count_invalid",
                "ForgeMind could not verify the task branch commit count.",
                true,
            )
            .detail(error.to_string())
            .entity(task_id)
            .layer("merge")
        })?;
        if commits_ahead == 0 {
            record.status = "merged".into();
            record.merge_commit = None;
            record.updated_at = Utc::now().to_rfc3339();
            self.database.save_worktree(&record)?;
            self.database.add_audit_event(
                Some(&record.mission_id), Some(task_id), "merge", "passed",
                "The explicitly accepted task contained no repository changes; ForgeMind recorded it as merged without modifying the base branch.",
                json!({"emptyChangeSet":true}),
            )?;
            self.database.recompute_mission_status(&record.mission_id)?;
            return Ok(record);
        }

        let before = git(repository, ["rev-parse", "HEAD"])?.trim().to_owned();
        let restore_ref = format!(
            "refs/forgemind/restore/{}",
            &task_id[..task_id.len().min(12)]
        );
        git_checked(repository, ["update-ref", &restore_ref, &before])?;
        record.restore_ref = Some(restore_ref.clone());
        record.updated_at = Utc::now().to_rfc3339();
        self.database.save_worktree(&record)?;
        let output = git_output(
            repository,
            ["merge", "--no-ff", "--no-edit", &record.branch_name],
        )?;
        if !output.status.success() {
            let _ = git_output(repository, ["merge", "--abort"]);
            record.status = "conflicted".into();
            record.updated_at = Utc::now().to_rfc3339();
            self.database.save_worktree(&record)?;
            self.database.add_audit_event(Some(&record.mission_id), Some(task_id), "merge", "failed", "Git reported a merge conflict; ForgeMind aborted the merge and preserved the worktree.", json!({"diagnostic":safe_output(&output)}))?;
            return Err(AppError::new("merge_conflict", "Git reported merge conflicts. The merge was aborted and the task worktree was preserved.", true)
                .detail(safe_output(&output)).entity(task_id).layer("merge"));
        }
        record.merge_commit = Some(git(repository, ["rev-parse", "HEAD"])?.trim().into());
        record.status = "merged".into();
        record.updated_at = Utc::now().to_rfc3339();
        self.database.save_worktree(&record)?;
        self.database.add_audit_event(
            Some(&record.mission_id),
            Some(task_id),
            "merge",
            "passed",
            "ForgeMind merged the explicitly accepted task and recorded a restore ref.",
            json!({"restoreRef":restore_ref,"mergeCommit":record.merge_commit}),
        )?;
        self.database.recompute_mission_status(&record.mission_id)?;
        Ok(record)
    }

    pub fn discard_task(&self, task_id: &str) -> AppResult<WorktreeRecord> {
        let task = self.database.get_mission_task(task_id)?;
        if let Some(session_id) = task.session_id.as_deref() {
            let bundle = self.database.get_mission_bundle(&task.mission_id)?;
            if let Some(terminal) = bundle
                .sessions
                .iter()
                .find(|session| session.id == session_id)
                .and_then(|session| session.terminal_session_id.as_deref())
            {
                let _ = self.terminals.terminate_session(terminal);
            }
        }
        let mut record = self
            .database
            .get_worktree_for_task(task_id)?
            .ok_or_else(|| {
                worktree_error(
                    "worktree_missing",
                    "The task does not have an isolated worktree to discard.",
                    task_id,
                )
            })?;
        if record.status == "cleanup-failed" && !Path::new(&record.worktree_path).exists() {
            return self.finish_partial_cleanup(&task, record);
        }
        self.verify_owned_worktree(&record)?;
        if !record.branch_name.starts_with("forgemind/") {
            return Err(worktree_error(
                "worktree_ownership_unverified",
                "ForgeMind refused discard because the recorded branch is not ForgeMind-owned.",
                &record.branch_name,
            ));
        }
        let repository = Path::new(&record.repository_path);
        let output = git_output(
            repository,
            ["worktree", "remove", "--force", &record.worktree_path],
        )?;
        if !output.status.success() {
            self.persist_cleanup_failure(
                &task,
                &mut record,
                "Git could not remove the owned task worktree.",
                &safe_output(&output),
            )?;
            return Err(worktree_error(
                "worktree_cleanup_failed",
                "Git could not remove the owned task worktree.",
                &safe_output(&output),
            ));
        }
        let branch_output = git_output(repository, ["branch", "-D", &record.branch_name])?;
        if !branch_output.status.success() {
            self.persist_cleanup_failure(
                &task,
                &mut record,
                "The worktree was removed, but Git could not remove the ForgeMind task branch.",
                &safe_output(&branch_output),
            )?;
            return Err(worktree_error("branch_cleanup_failed", "ForgeMind removed the task worktree but could not remove its branch. The partial cleanup was preserved for recovery.", &safe_output(&branch_output)));
        }
        if let Err(error) = fs::remove_file(&record.owner_marker_path) {
            self.persist_cleanup_failure(
                &task,
                &mut record,
                "Git resources were removed, but ForgeMind could not remove the ownership marker.",
                &error.to_string(),
            )?;
            return Err(worktree_error(
                "marker_cleanup_failed",
                "Git cleanup succeeded, but ownership-marker cleanup remains incomplete.",
                &error.to_string(),
            ));
        }
        record.status = "discarded".into();
        record.updated_at = Utc::now().to_rfc3339();
        self.database.save_worktree(&record)?;
        self.database.release_task_lock(task_id, "cancelled")?;
        self.database.add_audit_event(Some(&record.mission_id),Some(task_id),"discard","passed","ForgeMind removed only the verified owned worktree and task branch. Evidence was retained.",json!({"worktreeId":record.id}))?;
        self.database.recompute_mission_status(&record.mission_id)?;
        Ok(record)
    }

    pub fn cleanup_merged_worktree(&self, task_id: &str) -> AppResult<WorktreeRecord> {
        let task = self.database.get_mission_task(task_id)?;
        let mut record = self
            .database
            .get_worktree_for_task(task_id)?
            .ok_or_else(|| {
                worktree_error(
                    "worktree_missing",
                    "The task does not have a worktree to clean up.",
                    task_id,
                )
            })?;
        if record.status != "merged" {
            return Err(worktree_error(
                "cleanup_not_ready",
                "Only a successfully merged task worktree can use post-merge cleanup.",
                task_id,
            ));
        }
        self.verify_owned_worktree(&record)?;
        if !record.branch_name.starts_with("forgemind/") {
            return Err(worktree_error(
                "worktree_ownership_unverified",
                "ForgeMind refused cleanup because the recorded branch is not ForgeMind-owned.",
                &record.branch_name,
            ));
        }
        let repository = Path::new(&record.repository_path);
        let output = git_output(
            repository,
            ["worktree", "remove", "--force", &record.worktree_path],
        )?;
        if !output.status.success() {
            self.persist_cleanup_failure(
                &task,
                &mut record,
                "Git could not remove the merged task worktree.",
                &safe_output(&output),
            )?;
            return Err(worktree_error(
                "worktree_cleanup_failed",
                "Git could not remove the merged task worktree.",
                &safe_output(&output),
            ));
        }
        let branch_output = git_output(repository, ["branch", "-D", &record.branch_name])?;
        if !branch_output.status.success() {
            self.persist_cleanup_failure(
                &task,
                &mut record,
                "The merged worktree was removed, but its ForgeMind branch remains.",
                &safe_output(&branch_output),
            )?;
            return Err(worktree_error(
                "branch_cleanup_failed",
                "Post-merge cleanup is incomplete; the ForgeMind branch remains.",
                &safe_output(&branch_output),
            ));
        }
        if let Err(error) = fs::remove_file(&record.owner_marker_path) {
            self.persist_cleanup_failure(
                &task,
                &mut record,
                "Git cleanup succeeded, but ownership-marker cleanup remains incomplete.",
                &error.to_string(),
            )?;
            return Err(worktree_error(
                "marker_cleanup_failed",
                "Git cleanup succeeded, but ownership-marker cleanup remains incomplete.",
                &error.to_string(),
            ));
        }
        record.updated_at = Utc::now().to_rfc3339();
        self.database.save_worktree(&record)?;
        self.database.add_audit_event(
            Some(&record.mission_id),
            Some(task_id),
            "cleanup",
            "passed",
            "ForgeMind removed the merged task worktree and task branch after explicit approval.",
            json!({"worktreeId":record.id}),
        )?;
        Ok(record)
    }

    fn finish_partial_cleanup(
        &self,
        task: &MissionTask,
        mut record: WorktreeRecord,
    ) -> AppResult<WorktreeRecord> {
        let marker = Path::new(&record.owner_marker_path);
        let value: Value = serde_json::from_str(&fs::read_to_string(marker).map_err(|error| {
            worktree_error(
                "worktree_ownership_unverified",
                "ForgeMind could not verify the partial-cleanup ownership marker.",
                &error.to_string(),
            )
        })?)
        .map_err(|error| {
            worktree_error(
                "worktree_ownership_unverified",
                "The partial-cleanup ownership marker is invalid.",
                &error.to_string(),
            )
        })?;
        if !ownership_marker_matches(&value, &record)
            || !record.branch_name.starts_with("forgemind/")
        {
            return Err(worktree_error(
                "worktree_ownership_unverified",
                "ForgeMind refused partial cleanup because ownership does not match.",
                &record.id,
            ));
        }
        let controlled = self
            .database
            .path()
            .and_then(Path::parent)
            .map(|base| base.join("worktrees"))
            .ok_or_else(|| {
                worktree_error(
                    "worktree_root_unavailable",
                    "ForgeMind cannot verify its controlled worktree root.",
                    &record.worktree_path,
                )
            })?;
        let marker_parent = marker.parent().ok_or_else(|| {
            worktree_error(
                "worktree_ownership_unverified",
                "The ownership marker has no controlled parent.",
                &record.owner_marker_path,
            )
        })?;
        if !fs::canonicalize(marker_parent)
            .map_err(|error| {
                worktree_error(
                    "worktree_ownership_unverified",
                    "ForgeMind could not verify the marker directory.",
                    &error.to_string(),
                )
            })?
            .starts_with(fs::canonicalize(controlled).map_err(|error| {
                worktree_error(
                    "worktree_ownership_unverified",
                    "ForgeMind could not verify the controlled worktree root.",
                    &error.to_string(),
                )
            })?)
        {
            return Err(worktree_error(
                "worktree_ownership_unverified",
                "ForgeMind refused partial cleanup outside its controlled worktree root.",
                &record.owner_marker_path,
            ));
        }
        let repository = Path::new(&record.repository_path);
        let listed = git(repository, ["worktree", "list", "--porcelain"])?;
        if listed.lines().any(|line| {
            line.strip_prefix("worktree ").is_some_and(|listed_path| {
                paths_equal(Path::new(listed_path), Path::new(&record.worktree_path))
            })
        }) {
            return Err(worktree_error(
                "partial_cleanup_state_changed",
                "Git still lists the worktree; use the normal owned-worktree cleanup path.",
                &record.worktree_path,
            ));
        }
        if git_status(
            repository,
            [
                "show-ref",
                "--verify",
                "--quiet",
                &format!("refs/heads/{}", record.branch_name),
            ],
        )?
        .0
        {
            let output = git_output(repository, ["branch", "-D", &record.branch_name])?;
            if !output.status.success() {
                self.persist_cleanup_failure(
                    task,
                    &mut record,
                    "ForgeMind still could not remove the residual task branch.",
                    &safe_output(&output),
                )?;
                return Err(worktree_error(
                    "branch_cleanup_failed",
                    "The residual ForgeMind branch could not be removed.",
                    &safe_output(&output),
                ));
            }
        }
        fs::remove_file(marker).map_err(|error| {
            worktree_error(
                "marker_cleanup_failed",
                "ForgeMind removed Git resources but could not remove the ownership marker.",
                &error.to_string(),
            )
        })?;
        record.status = "discarded".into();
        record.updated_at = Utc::now().to_rfc3339();
        self.database.save_worktree(&record)?;
        self.database.release_task_lock(&task.id, "cancelled")?;
        self.database
            .update_recovery_status(&format!("cleanup-{}", record.id), "resolved")
            .ok();
        self.database.add_audit_event(
            Some(&record.mission_id),
            Some(&task.id),
            "cleanup",
            "passed",
            "ForgeMind completed a previously partial owned-resource cleanup.",
            json!({"worktreeId":record.id}),
        )?;
        self.database.recompute_mission_status(&record.mission_id)?;
        Ok(record)
    }

    fn persist_cleanup_failure(
        &self,
        task: &MissionTask,
        record: &mut WorktreeRecord,
        reason: &str,
        diagnostic: &str,
    ) -> AppResult<()> {
        record.status = "cleanup-failed".into();
        record.updated_at = Utc::now().to_rfc3339();
        self.database.save_worktree(record)?;
        self.database.release_task_lock(&task.id, "blocked")?;
        let now = Utc::now().to_rfc3339();
        self.database.save_recovery_state(&RecoveryState {
            id: format!("cleanup-{}", record.id),
            mission_id: record.mission_id.clone(),
            task_id: Some(task.id.clone()),
            session_id: task.session_id.clone(),
            status: "needs-recovery".into(),
            reason: reason.into(),
            available_actions: vec!["clean-up".into(), "mark-failed".into()],
            metadata: json!({"diagnostic":mission_domain::redact_secrets(diagnostic)}),
            created_at: now.clone(),
            updated_at: now,
        })?;
        self.database.add_audit_event(
            Some(&record.mission_id),
            Some(&task.id),
            "cleanup",
            "failed",
            reason,
            json!({"diagnostic":mission_domain::redact_secrets(diagnostic)}),
        )?;
        Ok(())
    }

    pub fn rollback_merge(&self, task_id: &str) -> AppResult<WorktreeRecord> {
        let mut record = self
            .database
            .get_worktree_for_task(task_id)?
            .ok_or_else(|| {
                worktree_error(
                    "worktree_missing",
                    "No ForgeMind merge record exists for this task.",
                    task_id,
                )
            })?;
        let commit = record.merge_commit.as_deref().ok_or_else(|| {
            worktree_error(
                "rollback_unavailable",
                "This task has no recorded ForgeMind merge commit.",
                task_id,
            )
        })?;
        let repository = Path::new(&record.repository_path);
        if !git(repository, ["status", "--porcelain"])?
            .trim()
            .is_empty()
        {
            return Err(AppError::new(
                "primary_checkout_dirty",
                "Rollback requires a clean primary checkout.",
                true,
            )
            .entity(&record.repository_path)
            .layer("rollback"));
        }
        let output = git_output(repository, ["revert", "-m", "1", "--no-edit", commit])?;
        if !output.status.success() {
            let _ = git_output(repository, ["revert", "--abort"]);
            self.database.add_audit_event(
                Some(&record.mission_id),
                Some(task_id),
                "rollback",
                "failed",
                "Git could not complete the rollback; the revert was aborted.",
                json!({"diagnostic":safe_output(&output)}),
            )?;
            return Err(AppError::new(
                "rollback_failed",
                "ForgeMind could not revert the recorded merge safely.",
                true,
            )
            .detail(safe_output(&output))
            .entity(task_id)
            .layer("rollback"));
        }
        record.status = "discarded".into();
        record.updated_at = Utc::now().to_rfc3339();
        self.database.save_worktree(&record)?;
        self.database.add_audit_event(
            Some(&record.mission_id),
            Some(task_id),
            "rollback",
            "passed",
            "ForgeMind reverted only the recorded merge commit.",
            json!({"mergeCommit":commit}),
        )?;
        self.database.recompute_mission_status(&record.mission_id)?;
        Ok(record)
    }

    pub fn reconcile(&self) -> AppResult<Vec<RecoveryState>> {
        let missions = self.database.list_missions(None)?;
        let mut states = Vec::new();
        for mission in missions
            .into_iter()
            .filter(|mission| !matches!(mission.status.as_str(), "completed" | "cancelled"))
        {
            let bundle = self.database.get_mission_bundle(&mission.id)?;
            let live = self
                .terminals
                .list_live_sessions(None)
                .into_iter()
                .map(|session| session.id)
                .collect::<HashSet<_>>();
            for session in bundle
                .sessions
                .iter()
                .filter(|session| session.status == "running")
            {
                let worktree_missing = session
                    .worktree_id
                    .as_ref()
                    .and_then(|id| bundle.worktrees.iter().find(|record| &record.id == id))
                    .is_some_and(|record| !Path::new(&record.worktree_path).is_dir());
                let terminal_id = session.terminal_session_id.as_deref();
                let terminal_live = terminal_id.is_some_and(|id| live.contains(id));
                if terminal_live && !worktree_missing {
                    continue;
                }

                // A normal process exit is first written to SQLite and then
                // removed from the live map. Reconcile that durable snapshot
                // before creating a recovery incident.
                if !worktree_missing {
                    if let Some(snapshot) = terminal_id
                        .and_then(|id| self.database.get_terminal_session(id).ok().flatten())
                    {
                        if snapshot.status != "running" {
                            let profile = self.database.get_agent_profile(&session.agent_id)?;
                            if matches!(
                                CliAgentExecutionAdapter::new(profile).detect_completion(&snapshot),
                                CompletionSignal::Passed | CompletionSignal::Failed
                            ) {
                                let task = self.database.get_mission_task(&session.task_id)?;
                                self.apply_completion_snapshot(&task, session, &snapshot)?;
                                continue;
                            }
                        }
                    }
                }

                let now = Utc::now().to_rfc3339();
                let reason = if worktree_missing {
                    "The persisted task worktree is missing."
                } else {
                    "The persisted agent session has no live ForgeMind terminal process."
                };
                let mut available_actions =
                    vec!["retry".into(), "mark-failed".into(), "clean-up".into()];
                if terminal_live {
                    available_actions.insert(0, "reattach".into());
                }
                let state = RecoveryState {
                    id: format!("recovery-{}", session.id),
                    mission_id: mission.id.clone(),
                    task_id: Some(session.task_id.clone()),
                    session_id: Some(session.id.clone()),
                    status: "needs-recovery".into(),
                    reason: reason.into(),
                    available_actions,
                    metadata: json!({"terminalLive":terminal_live,"worktreeMissing":worktree_missing}),
                    created_at: now.clone(),
                    updated_at: now,
                };
                self.database.save_recovery_state(&state)?;
                self.database
                    .update_mission_session_status(&session.id, "needs-recovery", None)?;
                self.database
                    .release_task_lock(&session.task_id, "blocked")?;
                states.push(state);
            }
            self.database.recompute_mission_status(&mission.id)?;
        }
        Ok(states)
    }

    pub fn refresh_task_from_terminal(&self, task_id: &str) -> AppResult<MissionTask> {
        let task = self.database.get_mission_task(task_id)?;
        let Some(session_id) = task.session_id.as_deref() else {
            return Ok(task);
        };
        let bundle = self.database.get_mission_bundle(&task.mission_id)?;
        let Some(session) = bundle
            .sessions
            .iter()
            .find(|session| session.id == session_id)
        else {
            return Ok(task);
        };
        if session.status != "running" {
            return Ok(task);
        }
        let Some(terminal_id) = session.terminal_session_id.as_deref() else {
            return Ok(task);
        };
        let snapshot = self
            .terminals
            .session_status(terminal_id)
            .ok()
            .or(self.database.get_terminal_session(terminal_id)?);
        if let Some(snapshot) = snapshot {
            self.apply_completion_snapshot(&task, session, &snapshot)?;
        } else {
            let _ = self.reconcile()?;
        }
        self.database.recompute_mission_status(&task.mission_id)?;
        self.database.get_mission_task(task_id)
    }

    pub fn recover_session(&self, recovery_id: &str, action: &str) -> AppResult<RecoveryState> {
        let recovery = self.database.get_recovery_state(recovery_id)?;
        if recovery.status != "needs-recovery" {
            return Ok(recovery);
        }
        let task_id = recovery.task_id.as_deref().ok_or_else(|| {
            AppError::new(
                "recovery_task_missing",
                "This recovery incident is not attached to a task.",
                true,
            )
            .entity(recovery_id)
            .layer("recovery")
        })?;
        let task = self.database.get_mission_task(task_id)?;
        match action {
            "retry" => {
                self.retry_task(task_id)?;
            }
            "mark-failed" => {
                if let Some(session_id) = recovery.session_id.as_deref() {
                    self.database
                        .update_mission_session_status(session_id, "failed", None)?;
                }
                self.database.release_task_lock(task_id, "failed")?;
                self.database.add_task_event(
                    &task.mission_id,
                    Some(task_id),
                    "task-failed",
                    "Recovery marked failed",
                    "The user explicitly marked the abandoned execution as failed.",
                    "failed",
                    json!({"recoveryId":recovery_id}),
                )?;
            }
            "reattach" => {
                let bundle = self.database.get_mission_bundle(&task.mission_id)?;
                let persisted = recovery
                    .session_id
                    .as_deref()
                    .and_then(|id| bundle.sessions.iter().find(|session| session.id == id))
                    .ok_or_else(|| {
                        AppError::new(
                            "recovery_session_missing",
                            "The persisted agent session is unavailable.",
                            true,
                        )
                        .entity(recovery_id)
                        .layer("recovery")
                    })?;
                let terminal_id = persisted.terminal_session_id.as_deref().ok_or_else(|| {
                    AppError::new(
                        "recovery_terminal_missing",
                        "This session has no terminal to reattach.",
                        true,
                    )
                    .entity(recovery_id)
                    .layer("recovery")
                })?;
                let snapshot = self.terminals.session_status(terminal_id).map_err(|_| {
                    AppError::new(
                        "recovery_terminal_not_live",
                        "The original terminal process is no longer live and cannot be reattached.",
                        true,
                    )
                    .entity(terminal_id)
                    .action("Retry the task or mark this attempt failed.")
                    .layer("recovery")
                })?;
                self.database.update_mission_session_status(
                    &persisted.id,
                    "running",
                    snapshot.process_id,
                )?;
                self.database
                    .update_task_runtime(task_id, "running", None, None, None)?;
            }
            "clean-up" => {
                self.discard_task(task_id)?;
            }
            _ => {
                return Err(AppError::new(
                    "invalid_recovery_action",
                    "That recovery action is not supported.",
                    true,
                )
                .entity(action)
                .layer("recovery"))
            }
        }
        self.database
            .update_recovery_status(recovery_id, "resolved")?;
        self.database.add_audit_event(
            Some(&task.mission_id),
            Some(task_id),
            "recovery",
            "passed",
            "The user resolved a persisted execution recovery incident.",
            json!({"recoveryId":recovery_id,"action":action}),
        )?;
        self.database.recompute_mission_status(&task.mission_id)?;
        self.database.get_recovery_state(recovery_id)
    }

    fn apply_completion_snapshot(
        &self,
        task: &MissionTask,
        session: &PersistedAgentSession,
        snapshot: &TerminalSession,
    ) -> AppResult<()> {
        let profile = self.database.get_agent_profile(&session.agent_id)?;
        match CliAgentExecutionAdapter::new(profile).detect_completion(snapshot) {
            CompletionSignal::Running => self.database.update_mission_session_status(
                &session.id,
                "running",
                snapshot.process_id,
            )?,
            CompletionSignal::Passed => {
                self.database
                    .update_mission_session_status(&session.id, "completed", None)?;
                self.database.release_task_lock(&task.id, "verifying")?;
                self.database.add_task_event(
                    &task.mission_id,
                    Some(&task.id),
                    "task-completed",
                    "Agent process exited successfully",
                    "Verification is required before acceptance.",
                    "passed",
                    json!({"exitCode":snapshot.exit_code}),
                )?;
            }
            CompletionSignal::Failed => {
                self.database
                    .update_mission_session_status(&session.id, "failed", None)?;
                self.database.release_task_lock(&task.id, "failed")?;
                self.database.add_task_event(
                    &task.mission_id,
                    Some(&task.id),
                    "task-failed",
                    "Agent process failed",
                    "The agent terminal exited with a non-zero or terminated status.",
                    "failed",
                    json!({"exitCode":snapshot.exit_code}),
                )?;
            }
            CompletionSignal::NeedsRecovery => {
                self.database
                    .update_mission_session_status(&session.id, "needs-recovery", None)?;
                self.database.release_task_lock(&task.id, "blocked")?;
            }
        }
        Ok(())
    }

    fn verify_owned_worktree(&self, record: &WorktreeRecord) -> AppResult<()> {
        let path = Path::new(&record.worktree_path);
        let marker = Path::new(&record.owner_marker_path);
        if !path.is_dir() || !marker.is_file() {
            return Err(worktree_error(
                "worktree_ownership_unverified",
                "ForgeMind refused cleanup because the worktree or ownership marker is missing.",
                &record.worktree_path,
            ));
        }
        let value: Value = serde_json::from_str(&fs::read_to_string(marker).map_err(|error| {
            worktree_error(
                "worktree_ownership_unverified",
                "ForgeMind could not read the ownership marker.",
                &error.to_string(),
            )
        })?)
        .map_err(|error| {
            worktree_error(
                "worktree_ownership_unverified",
                "The ownership marker is invalid.",
                &error.to_string(),
            )
        })?;
        if !ownership_marker_matches(&value, record) {
            return Err(worktree_error(
                "worktree_ownership_unverified",
                "ForgeMind refused cleanup because ownership metadata does not match.",
                &record.worktree_path,
            ));
        }
        let controlled = self
            .database
            .path()
            .and_then(Path::parent)
            .map(|base| base.join("worktrees"))
            .ok_or_else(|| {
                worktree_error(
                    "worktree_root_unavailable",
                    "ForgeMind cannot verify the controlled worktree root.",
                    &record.worktree_path,
                )
            })?;
        let canonical_path = fs::canonicalize(path).map_err(|error| {
            worktree_error(
                "worktree_ownership_unverified",
                "ForgeMind could not canonicalize the task worktree.",
                &error.to_string(),
            )
        })?;
        let canonical_root = fs::canonicalize(controlled).map_err(|error| {
            worktree_error(
                "worktree_ownership_unverified",
                "ForgeMind could not canonicalize its worktree root.",
                &error.to_string(),
            )
        })?;
        if !canonical_path.starts_with(canonical_root) {
            return Err(worktree_error(
                "worktree_ownership_unverified",
                "ForgeMind refused to remove a directory outside its controlled worktree root.",
                &record.worktree_path,
            ));
        }
        let listed = git(
            Path::new(&record.repository_path),
            ["worktree", "list", "--porcelain"],
        )?;
        if !listed.lines().any(|line| {
            line.strip_prefix("worktree ")
                .is_some_and(|listed_path| paths_equal(Path::new(listed_path), path))
        }) {
            return Err(worktree_error(
                "worktree_ownership_unverified",
                "Git no longer recognizes the recorded path as a worktree.",
                &record.worktree_path,
            ));
        }
        Ok(())
    }

    fn artifact_path(&self, mission_id: &str, task_id: &str, name: &str) -> AppResult<PathBuf> {
        let root = self
            .database
            .path()
            .and_then(Path::parent)
            .ok_or_else(|| {
                AppError::new(
                    "artifact_root_unavailable",
                    "ForgeMind could not resolve artifact storage.",
                    true,
                )
                .layer("evidence")
            })?
            .join("artifacts")
            .join(mission_id)
            .join(task_id);
        fs::create_dir_all(&root).map_err(|error| {
            AppError::new(
                "artifact_write_failed",
                "ForgeMind could not create artifact storage.",
                true,
            )
            .detail(error.to_string())
            .layer("evidence")
        })?;
        Ok(root.join(name))
    }
    fn project_instructions(&self, root: &Path) -> Vec<String> {
        ["AGENTS.md", "CLAUDE.md", "CONTRIBUTING.md"]
            .iter()
            .filter_map(|name| {
                let path = root.join(name);
                if path.is_file() {
                    Some(format!("Read and follow {}", path.display()))
                } else {
                    None
                }
            })
            .collect()
    }
}

fn changed_file_paths(root: &Path, base_ref: &str) -> AppResult<Vec<String>> {
    let mut paths = BTreeSet::new();
    for args in [
        vec!["diff", "--name-only", "-z", base_ref],
        vec!["ls-files", "--others", "--exclude-standard", "-z"],
    ] {
        let output = Command::new("git")
            .args(&args)
            .current_dir(root)
            .output()
            .map_err(|error| {
                worktree_error(
                    "git_unavailable",
                    "ForgeMind could not inspect changed files.",
                    &error.to_string(),
                )
            })?;
        if !output.status.success() {
            return Err(worktree_error(
                "git_command_failed",
                "Git could not inspect changed files.",
                &safe_output(&output),
            ));
        }
        for value in output
            .stdout
            .split(|byte| *byte == 0)
            .filter(|value| !value.is_empty())
        {
            let path = String::from_utf8_lossy(value).into_owned();
            let relative = Path::new(&path);
            if !relative.is_absolute()
                && !relative.components().any(|component| {
                    matches!(component, Component::ParentDir | Component::Prefix(_))
                })
            {
                paths.insert(path);
            }
        }
    }
    Ok(paths.into_iter().collect())
}

fn build_file_diff(root: &Path, base_ref: &str, file: &str) -> AppResult<FileDiff> {
    let normalized = file.replace('\\', "/").to_ascii_lowercase();
    let name = normalized.rsplit('/').next().unwrap_or(&normalized);
    if name == ".env"
        || name.starts_with(".env.")
        || normalized.starts_with(".ssh/")
        || normalized.contains("/.ssh/")
        || matches!(
            name,
            "id_rsa" | "id_ed25519" | "credentials" | "credentials.json"
        )
    {
        return Ok(FileDiff { path:file.into(), diff:format!("diff --git a/{file} b/{file}\nProtected file changed; content omitted from ForgeMind review.") });
    }
    let output = git_output(
        root,
        ["diff", "--no-ext-diff", "--unified=3", base_ref, "--", file],
    )?;
    if !output.status.success() {
        return Err(worktree_error(
            "git_command_failed",
            "Git could not build a per-file review diff.",
            &safe_output(&output),
        ));
    }
    let tracked = mission_domain::redact_secrets(&String::from_utf8_lossy(&output.stdout));
    if !tracked.trim().is_empty() {
        return Ok(FileDiff {
            path: file.into(),
            diff: tail_chars(&tracked, 500_000),
        });
    }

    let relative = Path::new(file);
    if relative.is_absolute()
        || relative
            .components()
            .any(|component| matches!(component, Component::ParentDir | Component::Prefix(_)))
    {
        return Err(worktree_error(
            "review_path_outside_worktree",
            "ForgeMind refused to read a changed file outside the task worktree.",
            file,
        ));
    }
    let target = root.join(relative);
    let canonical_root = fs::canonicalize(root).map_err(|error| {
        worktree_error(
            "review_path_unavailable",
            "ForgeMind could not verify the task worktree.",
            &error.to_string(),
        )
    })?;
    let canonical_target = fs::canonicalize(&target).map_err(|error| {
        worktree_error(
            "review_path_unavailable",
            "ForgeMind could not inspect an untracked changed file.",
            &error.to_string(),
        )
    })?;
    if !canonical_target.starts_with(canonical_root) || !canonical_target.is_file() {
        return Err(worktree_error(
            "review_path_outside_worktree",
            "ForgeMind refused to read an untracked file outside the task worktree.",
            file,
        ));
    }
    let metadata = fs::metadata(&canonical_target).map_err(|error| {
        worktree_error(
            "review_file_unavailable",
            "ForgeMind could not inspect an untracked file.",
            &error.to_string(),
        )
    })?;
    if metadata.len() > 500_000 {
        return Ok(FileDiff { path:file.into(), diff:format!("diff --git a/{file} b/{file}\nBinary or large untracked file ({} bytes); content omitted.", metadata.len()) });
    }
    let bytes = fs::read(&canonical_target).map_err(|error| {
        worktree_error(
            "review_file_unavailable",
            "ForgeMind could not read an untracked file for review.",
            &error.to_string(),
        )
    })?;
    let Ok(text) = String::from_utf8(bytes) else {
        return Ok(FileDiff {
            path: file.into(),
            diff: format!("diff --git a/{file} b/{file}\nBinary untracked file; content omitted."),
        });
    };
    let safe = mission_domain::redact_secrets(&text);
    let line_count = safe.lines().count();
    let additions = safe
        .lines()
        .map(|line| format!("+{line}"))
        .collect::<Vec<_>>()
        .join("\n");
    Ok(FileDiff { path:file.into(), diff:format!("diff --git a/{file} b/{file}\nnew file mode 100644\n--- /dev/null\n+++ b/{file}\n@@ -0,0 +1,{line_count} @@\n{additions}") })
}

fn command_shell(command: &str) -> Command {
    #[cfg(windows)]
    {
        let mut value = Command::new("powershell.exe");
        value.args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            command,
        ]);
        value
    }
    #[cfg(not(windows))]
    {
        let mut value = Command::new("sh");
        value.args(["-lc", command]);
        value
    }
}
fn read_pipe(pipe: Option<impl Read>) -> Vec<u8> {
    let Some(mut pipe) = pipe else {
        return Vec::new();
    };
    let mut value = Vec::new();
    let _ = pipe.read_to_end(&mut value);
    value
}
fn git<const N: usize>(root: &Path, args: [&str; N]) -> AppResult<String> {
    let output = git_output(root, args)?;
    if output.status.success() {
        Ok(mission_domain::redact_secrets(&String::from_utf8_lossy(
            &output.stdout,
        )))
    } else {
        Err(worktree_error(
            "git_command_failed",
            "Git could not complete the requested operation.",
            &safe_output(&output),
        ))
    }
}
fn git_checked<const N: usize>(root: &Path, args: [&str; N]) -> AppResult<()> {
    git(root, args).map(|_| ())
}
fn git_status<const N: usize>(root: &Path, args: [&str; N]) -> AppResult<(bool, String)> {
    let output = git_output(root, args)?;
    Ok((output.status.success(), safe_output(&output)))
}
fn git_output<const N: usize>(root: &Path, args: [&str; N]) -> AppResult<Output> {
    Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .map_err(|error| {
            worktree_error(
                "git_unavailable",
                "ForgeMind could not run Git.",
                &error.to_string(),
            )
        })
}
fn safe_output(output: &Output) -> String {
    mission_domain::redact_secrets(&format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    ))
}
fn worktree_error(code: &'static str, message: &str, detail: &str) -> AppError {
    AppError::new(code, message, true)
        .detail(mission_domain::redact_secrets(detail))
        .layer("worktree")
}
fn tail_chars(value: &str, limit: usize) -> String {
    let count = value.chars().count();
    if count <= limit {
        value.into()
    } else {
        value.chars().skip(count - limit).collect()
    }
}
fn paths_equal(a: &Path, b: &Path) -> bool {
    let left = a.to_string_lossy();
    let right = b.to_string_lossy();
    if cfg!(windows) {
        left.eq_ignore_ascii_case(&right)
    } else {
        left == right
    }
}
fn ownership_marker_matches(value: &Value, record: &WorktreeRecord) -> bool {
    value.get("owner").and_then(Value::as_str) == Some("ForgeMind")
        && value.get("worktreeId").and_then(Value::as_str) == Some(&record.id)
        && value.get("missionId").and_then(Value::as_str) == Some(&record.mission_id)
        && value.get("taskId").and_then(Value::as_str) == Some(&record.task_id)
        && value.get("repositoryPath").and_then(Value::as_str) == Some(&record.repository_path)
}
fn extract_env_names(diff: &str) -> Vec<String> {
    let mut names = HashSet::new();
    for line in diff
        .lines()
        .filter(|line| line.starts_with('+') && !line.starts_with("+++"))
    {
        for token in
            line.split(|character: char| !character.is_ascii_alphanumeric() && character != '_')
        {
            if token.len() >= 3
                && token.chars().all(|character| {
                    character.is_ascii_uppercase() || character.is_ascii_digit() || character == '_'
                })
                && token.contains('_')
            {
                names.insert(token.to_owned());
            }
        }
    }
    let mut values = names.into_iter().collect::<Vec<_>>();
    values.sort();
    values
}
fn display_check_name(value: &str) -> String {
    value
        .split(['-', '_'])
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn environment_evidence_never_keeps_values() {
        let names =
            extract_env_names("+DATABASE_URL=postgres://secret\n+const API_TOKEN = env.API_TOKEN");
        assert!(names.contains(&"DATABASE_URL".into()));
        assert!(names.contains(&"API_TOKEN".into()));
        assert!(names.iter().all(|name| !name.contains("secret")));
    }
    #[test]
    fn controlled_path_comparison_is_platform_aware() {
        assert!(paths_equal(Path::new("a/b"), Path::new("a/b")));
    }
    #[test]
    fn worktree_ownership_requires_every_record_identity() {
        let record = WorktreeRecord {
            id: "worktree-1".into(),
            mission_id: "mission-1".into(),
            task_id: "task-1".into(),
            repository_path: "repo".into(),
            worktree_path: "tree".into(),
            branch_name: "forgemind/m/t".into(),
            base_ref: "abc".into(),
            base_branch: Some("main".into()),
            status: "ready".into(),
            owner_marker_path: "owner".into(),
            restore_ref: None,
            merge_commit: None,
            created_at: "now".into(),
            updated_at: "now".into(),
        };
        let valid = json!({"owner":"ForgeMind","worktreeId":"worktree-1","missionId":"mission-1","taskId":"task-1","repositoryPath":"repo"});
        assert!(ownership_marker_matches(&valid, &record));
        let forged = json!({"owner":"ForgeMind","worktreeId":"worktree-1","missionId":"other","taskId":"task-1","repositoryPath":"repo"});
        assert!(!ownership_marker_matches(&forged, &record));
    }

    #[test]
    fn isolated_git_worktree_can_snapshot_merge_and_cleanup() {
        if Command::new("git").arg("--version").output().is_err() {
            return;
        }
        let root = std::env::temp_dir().join(format!("forgemind-git-flow-{}", Uuid::new_v4()));
        let repository = root.join("repository");
        let worktree = root.join("worktree");
        fs::create_dir_all(&repository).unwrap();
        assert!(git_output(&repository, ["init", "-b", "main"])
            .unwrap()
            .status
            .success());
        fs::write(repository.join("proof.txt"), "base\n").unwrap();
        git_checked(&repository, ["add", "-A"]).unwrap();
        assert!(git_output(
            &repository,
            [
                "-c",
                "user.name=ForgeMind Test",
                "-c",
                "user.email=test@local",
                "commit",
                "-m",
                "base"
            ]
        )
        .unwrap()
        .status
        .success());
        let path = worktree.to_string_lossy().to_string();
        assert!(git_output(
            &repository,
            [
                "worktree",
                "add",
                "-b",
                "forgemind/test/task",
                &path,
                "HEAD"
            ]
        )
        .unwrap()
        .status
        .success());
        fs::write(worktree.join("proof.txt"), "accepted\n").unwrap();
        git_checked(&worktree, ["add", "-A"]).unwrap();
        assert!(git_output(
            &worktree,
            [
                "-c",
                "user.name=ForgeMind",
                "-c",
                "user.email=forgemind@local",
                "commit",
                "-m",
                "accepted snapshot"
            ]
        )
        .unwrap()
        .status
        .success());
        assert!(git_output(
            &repository,
            [
                "-c",
                "user.name=ForgeMind",
                "-c",
                "user.email=forgemind@local",
                "merge",
                "--no-ff",
                "--no-edit",
                "forgemind/test/task"
            ]
        )
        .unwrap()
        .status
        .success());
        assert_eq!(
            fs::read_to_string(repository.join("proof.txt"))
                .unwrap()
                .replace("\r\n", "\n"),
            "accepted\n"
        );
        assert!(
            git_output(&repository, ["worktree", "remove", "--force", &path])
                .unwrap()
                .status
                .success()
        );
        assert!(
            git_output(&repository, ["branch", "-D", "forgemind/test/task"])
                .unwrap()
                .status
                .success()
        );
        fs::remove_dir_all(root).unwrap();
    }
}

//! Real-provider canary for the canonical Run Engine.
//!
//! Every other Run Engine test scripts the executor, which proves the *engine* but leaves the
//! last link unproven: that `SingleAgentExecutor` can actually drive an installed provider CLI
//! from `Queued` to `Succeeded` and leave a real file change behind. Mission Control depends on
//! that link, so it is exercised here against the production stack — real database, real
//! Repository control plane, real Context Fabric, real `TerminalManager` PTY, real provider.
//!
//! It is `#[ignore]`d because it spends provider quota and needs an authenticated CLI, so it
//! never runs in ordinary `cargo test`. Run it deliberately:
//!
//! ```text
//! cargo test --lib run_engine_canary -- --ignored --nocapture --test-threads=1
//! ```
//!
//! The work it asks for is deliberately trivial and confined to a throwaway Git repository under
//! the OS temp directory: nothing in this repository is touched.

use crate::database::DatabaseService;
use crate::models::run::*;
use crate::models::Project;
use crate::services::run_executor::SingleAgentExecutor;
use crate::services::run_service::RunService;
use crate::services::{
    AgentDetector, ContextCompiler, FileSystemService, RepositoryService, SelfWriteLedger,
    TerminalManager,
};
use chrono::Utc;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use uuid::Uuid;

/// Ceiling on how long the canary waits for a provider to finish. Generous because a cold CLI
/// start plus one tool call is not fast, bounded because a hung canary must fail, not hang CI.
const CANARY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(300);
const CANARY_FILE: &str = "CANARY.txt";
const CANARY_CONTENT: &str = "paralith-run-canary";

struct Fixture {
    database: Arc<DatabaseService>,
    service: RunService,
    project_id: String,
    root: PathBuf,
    app_data: PathBuf,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        // Everything the canary created lives under these two throwaway directories, including
        // the leased worktree. Removal is best effort: a locked file must not fail the test.
        let _ = std::fs::remove_dir_all(&self.root);
        let _ = std::fs::remove_dir_all(&self.app_data);
    }
}

fn git(root: &Path, arguments: &[&str]) {
    let status = Command::new("git")
        .args(arguments)
        .current_dir(root)
        .status()
        .unwrap_or_else(|error| panic!("git {arguments:?} could not run: {error}"));
    assert!(status.success(), "git {arguments:?} failed");
}

/// A disposable Git repository with one commit, registered as a Project.
fn fixture() -> Fixture {
    let unique = Uuid::new_v4().to_string();
    // `display_path` strips the `\?\` extended-length prefix `canonicalize` adds on Windows.
    // Git for Windows cannot create leading directories under that prefix, so a worktree root
    // carrying it fails; production paths come from Tauri's resolver and never carry one.
    let base = PathBuf::from(crate::services::project_service::display_path(
        &std::fs::canonicalize(std::env::temp_dir()).unwrap(),
    ));
    let root = base.join(format!("paralith-canary-{unique}"));
    let app_data = base.join(format!("paralith-canary-data-{unique}"));
    std::fs::create_dir_all(&root).unwrap();
    std::fs::create_dir_all(&app_data).unwrap();
    std::fs::write(root.join("README.md"), "# canary fixture\n").unwrap();

    git(&root, &["init", "--initial-branch=main"]);
    git(&root, &["config", "user.email", "canary@paralith.local"]);
    git(&root, &["config", "user.name", "Paralith Canary"]);
    git(&root, &["add", "."]);
    git(&root, &["commit", "-m", "canary fixture"]);

    let database = Arc::new(DatabaseService::in_memory().unwrap());
    let root_path = crate::services::project_service::display_path(&root);
    let now = Utc::now().to_rfc3339();
    let project = Project {
        id: Uuid::new_v4().to_string(),
        name: "canary".into(),
        canonical_root_path: if cfg!(windows) {
            root_path.to_lowercase()
        } else {
            root_path.clone()
        },
        root_path: root_path.clone(),
        git_branch: Some("main".into()),
        detected_framework: None,
        package_manager: None,
        major_languages: Vec::new(),
        is_git_repository: true,
        has_package_json: false,
        has_lockfile: false,
        created_at: now.clone(),
        updated_at: now.clone(),
        last_opened_at: now,
    };
    database.upsert_project(&project).unwrap();

    let filesystem = FileSystemService::new(Arc::clone(&database), SelfWriteLedger::default());
    let repository = Arc::new(RepositoryService::new(Arc::clone(&database), &app_data));
    let context = ContextCompiler::new(Arc::clone(&database), filesystem);
    let executor = SingleAgentExecutor::new(
        Arc::clone(&database),
        Arc::new(AgentDetector::default()),
        TerminalManager::headless(Arc::clone(&database)),
        repository,
        context,
    );
    let service = RunService::for_tests(Arc::clone(&database), vec![Box::new(executor)]);
    Fixture {
        database,
        service,
        project_id: project.id,
        root,
        app_data,
    }
}

/// Drive the engine the way its own scheduler thread does, and report the terminal Run.
fn drive_to_completion(fixture: &Fixture, run_id: &str) -> Run {
    let deadline = std::time::Instant::now() + CANARY_TIMEOUT;
    loop {
        fixture.service.tick().unwrap();
        let run = fixture.database.get_run(run_id).unwrap();
        if run.status.is_terminal() || run.status == RunStatus::Interrupted {
            return run;
        }
        if std::time::Instant::now() >= deadline {
            // A hung canary is almost always a launch problem, and the launch is invisible from
            // the Run alone. Dump exactly what was spawned and what came back before failing.
            if let Some(session_id) = run.terminal_session_id.as_deref() {
                if let Ok(Some(record)) = fixture.database.get_terminal_session(session_id) {
                    println!("exe={:?}", record.executable);
                    println!("cwd={:?}", record.working_directory);
                    println!("args={:#?}", record.arguments);
                    println!(
                        "status={} exit={:?} ended={:?}",
                        record.status, record.exit_code, record.ended_at
                    );
                    println!(
                        "--- output tail ---\n{}",
                        String::from_utf8_lossy(&record.output_tail)
                    );
                }
            }
            panic!(
                "the canary Run never reached a terminal state (last status: {})",
                run.status.as_str()
            );
        }
        std::thread::sleep(std::time::Duration::from_millis(900));
    }
}

fn canary(provider_id: &str, model_id: &str) {
    let fixture = fixture();
    let request = CreateRunRequest {
        project_id: fixture.project_id.clone(),
        workspace_id: None,
        objective: format!(
            "Create a file named {CANARY_FILE} in the repository root whose entire contents are \
             the single line `{CANARY_CONTENT}`. Do not modify any other file, do not run any \
             command, and do not commit. Then finish."
        ),
        parent_run_id: None,
        retry_of_run_id: None,
        swarm_id: None,
        swarm_task_id: None,
        mission_id: None,
        mission_task_id: None,
        run_type: RunType::AgentTask,
        execution_strategy: RunExecutionStrategy::SingleAgent,
        isolation: RunIsolation::IsolatedWorktree,
        provider_id: Some(provider_id.into()),
        model_id: Some(model_id.into()),
        reasoning_effort: Some("low".into()),
        focus_files: Vec::new(),
        idempotency_key: None,
        trigger_source: Some(RunTriggerSource::Manual),
        metadata: None,
    };

    let created = fixture.service.create(&request, "canary").unwrap();
    assert_eq!(created.status, RunStatus::Queued);

    let finished = drive_to_completion(&fixture, &created.id);
    let detail = fixture.database.run_detail(&created.id).unwrap();
    let journal: Vec<String> = detail
        .events
        .iter()
        .map(|event| format!("{} — {}", event.kind.as_str(), event.summary))
        .collect();
    println!("--- {provider_id} canary journal ---");
    for line in &journal {
        println!("{line}");
    }
    println!(
        "worktree={:?} branch={:?} contextPack={:?} status={} reason={:?}",
        finished.worktree_path,
        finished.branch_name,
        finished.context_pack_id,
        finished.status.as_str(),
        finished.error_code,
    );

    // Every link in the production path, asserted individually so a failure names the link.
    let kinds: Vec<&str> = detail
        .events
        .iter()
        .map(|event| event.kind.as_str())
        .collect();
    assert!(kinds.contains(&"created"), "{journal:?}");
    assert!(kinds.contains(&"preparing"), "{journal:?}");
    assert!(
        kinds.contains(&"worktree_attached"),
        "the Run must lease an isolated worktree: {journal:?}"
    );
    assert!(
        kinds.contains(&"context_compiled"),
        "the Run must compile a Context Fabric pack: {journal:?}"
    );
    assert!(kinds.contains(&"started"), "{journal:?}");
    assert!(
        finished.context_pack_id.is_some(),
        "context provenance must be recorded on the Run"
    );
    assert!(
        finished.terminal_session_id.is_some(),
        "the provider session must be recorded on the Run"
    );

    let worktree = finished
        .worktree_path
        .clone()
        .expect("an isolated Run records its worktree");
    let lease_exists = Path::new(&worktree).is_dir();
    assert!(lease_exists, "the leased worktree must exist at {worktree}");

    assert_eq!(
        finished.status,
        RunStatus::Succeeded,
        "the provider did not complete cleanly: {:?} {:?} — {journal:?}",
        finished.error_code,
        finished.error_message
    );

    let produced = Path::new(&worktree).join(CANARY_FILE);
    let body = std::fs::read_to_string(&produced)
        .unwrap_or_else(|error| panic!("{CANARY_FILE} was not created in {worktree}: {error}"));
    assert!(
        body.contains(CANARY_CONTENT),
        "the provider wrote {produced:?} but not the requested content: {body:?}"
    );
}

#[test]
#[ignore = "real provider canary: spends quota and requires an authenticated Claude Code CLI"]
fn run_engine_canary_claude_writes_a_real_file_and_succeeds() {
    canary("claude", "sonnet");
}

#[test]
#[ignore = "real provider canary: spends quota and requires an authenticated Codex CLI"]
fn run_engine_canary_codex_writes_a_real_file_and_succeeds() {
    canary("codex", "gpt-5.5");
}

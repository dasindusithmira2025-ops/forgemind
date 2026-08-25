//! Real-provider canary for Mission Control.
//!
//! The Mission tests script the provider, which proves the *orchestration*. This proves the whole
//! chain against production code and a real agent:
//!
//! ```text
//! Mission → Preflight → Acceptance Criteria → Task DAG → Run Engine → provider → worktree
//!        → Task implemented → dependent Task unlocked → Mission implementation complete
//! ```
//!
//! `#[ignore]`d because it spends provider quota and needs an authenticated CLI. Run it
//! deliberately:
//!
//! ```text
//! cargo test --lib mission_control_canary -- --ignored --nocapture --test-threads=1
//! ```
//!
//! Everything it touches lives in a throwaway Git repository under the OS temp directory.

use crate::database::DatabaseService;
use crate::models::mission::*;
use crate::models::run::RunStatus;
use crate::models::Project;
use crate::services::mission_planner::MissionPlanner;
use crate::services::mission_service::MissionService;
use crate::services::run_executor::SingleAgentExecutor;
use crate::services::run_service::RunService;
use crate::services::{
    AgentDetector, CodeIntelligence, ContextCompiler, FileSystemService, MemoryService,
    RepositoryService, SelfWriteLedger, TerminalManager,
};
use chrono::Utc;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use uuid::Uuid;

/// Two small agent turns plus preparation. Generous, but bounded: a hung canary must fail.
const CANARY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(600);

struct Fixture {
    database: Arc<DatabaseService>,
    missions: MissionService,
    runs: RunService,
    project_id: String,
    root: PathBuf,
    app_data: PathBuf,
}

impl Drop for Fixture {
    fn drop(&mut self) {
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

fn fixture() -> Fixture {
    let unique = Uuid::new_v4().to_string();
    // `display_path` strips the `\\?\` prefix `canonicalize` adds on Windows; Git cannot create
    // worktree directories underneath it.
    let base = PathBuf::from(crate::services::project_service::display_path(
        &std::fs::canonicalize(std::env::temp_dir()).unwrap(),
    ));
    let root = base.join(format!("paralith-mission-canary-{unique}"));
    let app_data = base.join(format!("paralith-mission-canary-data-{unique}"));
    std::fs::create_dir_all(root.join("docs")).unwrap();
    std::fs::create_dir_all(&app_data).unwrap();
    std::fs::write(root.join("README.md"), "# mission canary fixture\n").unwrap();

    git(&root, &["init", "--initial-branch=main"]);
    git(&root, &["config", "user.email", "canary@paralith.local"]);
    git(&root, &["config", "user.name", "Paralith Canary"]);
    git(&root, &["add", "."]);
    git(&root, &["commit", "-m", "mission canary fixture"]);

    let database = Arc::new(DatabaseService::in_memory().unwrap());
    let root_path = crate::services::project_service::display_path(&root);
    let now = Utc::now().to_rfc3339();
    let project = Project {
        id: Uuid::new_v4().to_string(),
        name: "mission-canary".into(),
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
    let context = ContextCompiler::new(Arc::clone(&database), filesystem.clone());
    let runs = RunService::for_tests(
        Arc::clone(&database),
        vec![Box::new(SingleAgentExecutor::new(
            Arc::clone(&database),
            Arc::new(AgentDetector::default()),
            TerminalManager::headless(Arc::clone(&database)),
            Arc::clone(&repository),
            context.clone(),
        ))],
    );
    let missions = MissionService::for_tests(
        Arc::clone(&database),
        runs.clone(),
        MissionPlanner::new(
            CodeIntelligence::new(Arc::clone(&database)),
            MemoryService::new(Arc::clone(&database), filesystem),
            repository,
            context,
        ),
    );
    Fixture {
        database,
        missions,
        runs,
        project_id: project.id,
        root,
        app_data,
    }
}

/// Drive both schedulers the way the two background threads do in production.
fn drive(fixture: &Fixture, mission_id: &str) -> Mission {
    let deadline = std::time::Instant::now() + CANARY_TIMEOUT;
    loop {
        fixture.missions.tick().unwrap();
        fixture.runs.tick().unwrap();
        let mission = fixture.database.get_mission(mission_id).unwrap();
        if matches!(
            mission.status,
            MissionStatus::ReviewReady
                | MissionStatus::Blocked
                | MissionStatus::Failed
                | MissionStatus::Cancelled
                | MissionStatus::Completed
        ) {
            return mission;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "the canary Mission never settled (last status: {})",
            mission.status.as_str()
        );
        std::thread::sleep(std::time::Duration::from_millis(800));
    }
}

fn plan_task(key: &str, title: &str, objective: &str, depends_on: &[&str]) -> MissionPlanTask {
    MissionPlanTask {
        key: key.into(),
        title: title.into(),
        objective: objective.into(),
        description: None,
        depends_on: depends_on.iter().map(|value| (*value).into()).collect(),
        criteria: vec!["AC-01".into()],
        focus_files: Vec::new(),
        execution_mode: None,
        provider_id: None,
        model_id: None,
        isolation: None,
        risk_level: None,
    }
}

fn canary(provider_id: &str, model_id: &str) {
    let fixture = fixture();

    let mission = fixture
        .missions
        .create(
            &CreateMissionRequest {
                project_id: fixture.project_id.clone(),
                objective:
                    "Document the canary fixture in docs/, in two dependent steps, without touching any other file."
                        .into(),
                constraints: vec!["README.md must not be modified".into()],
                default_provider_id: Some(provider_id.into()),
                default_model_id: Some(model_id.into()),
                ..CreateMissionRequest::default()
            },
            "canary",
        )
        .unwrap();
    assert_eq!(mission.status, MissionStatus::Draft);

    let prepared = fixture.missions.prepare(&mission.id, "canary").unwrap();
    assert_eq!(prepared.status, MissionStatus::Ready);
    assert_eq!(prepared.preflight_status, MissionPreflightStatus::Completed);

    // An explicit two-step chain, so the dependency unlock is genuinely exercised rather than
    // inferred. Each step is one tiny file write.
    let plan = MissionPlanDraft {
        summary: "Two dependent documentation steps".into(),
        criteria: vec![MissionPlanCriterion {
            key: "AC-01".into(),
            title: "The canary fixture is documented".into(),
            description: "docs/STEP-ONE.md and docs/STEP-TWO.md exist and describe the fixture."
                .into(),
            kind: AcceptanceCriterionKind::Behavioral,
            required: true,
            verification_hint: None,
        }],
        tasks: vec![
            plan_task(
                "T1",
                "Write step one",
                "Create the file docs/STEP-ONE.md containing exactly the single line `step one`. Do not modify any other file, do not run any command, and do not commit. Then finish.",
                &[],
            ),
            plan_task(
                "T2",
                "Write step two",
                "Create the file docs/STEP-TWO.md containing exactly the single line `step two`. Do not modify any other file, do not run any command, and do not commit. Then finish.",
                &["T1"],
            ),
        ],
        risk_level: Some(MissionRisk::Low),
    };
    fixture
        .missions
        .revise_plan(&mission.id, &plan, "canary plan", "canary")
        .unwrap();

    let detail = fixture.missions.detail(&mission.id).unwrap();
    assert_eq!(detail.tasks.len(), 2);
    assert_eq!(detail.dependencies.len(), 1);
    // The deterministic plan's constraint criterion is retired by the revision rather than
    // deleted, so its identity survives: count the active ones.
    assert_eq!(
        detail
            .criteria
            .iter()
            .filter(|criterion| criterion.retired_at.is_none())
            .count(),
        1
    );

    fixture.missions.start(&mission.id).unwrap();
    let settled = drive(&fixture, &mission.id);

    let detail = fixture.missions.detail(&mission.id).unwrap();
    let runs = fixture.missions.runs(&mission.id).unwrap();
    println!("--- {provider_id} mission canary ---");
    for event in fixture.missions.events(&mission.id, 500).unwrap() {
        println!(
            "{:>3} {} — {}",
            event.sequence,
            event.kind.as_str(),
            event.summary
        );
    }
    for task in &detail.tasks {
        println!(
            "task {} {} status={} attempts={} run={:?}",
            task.key,
            task.title,
            task.status.as_str(),
            task.attempt_count,
            task.current_run_id
        );
    }
    for run in &runs {
        println!(
            "run {} status={} branch={:?} worktree={:?} error={:?}",
            &run.id[..8],
            run.status.as_str(),
            run.branch_name,
            run.worktree_path,
            run.error_code
        );
    }

    assert_eq!(
        settled.status,
        MissionStatus::ReviewReady,
        "the Mission did not reach implementation-complete: {:?}",
        settled.status_reason
    );
    assert_eq!(
        settled.status_reason.as_deref(),
        Some("implementation_complete_verification_pending")
    );

    for key in ["T1", "T2"] {
        let task = detail.tasks.iter().find(|task| task.key == key).unwrap();
        assert_eq!(
            task.status,
            MissionTaskStatus::Implemented,
            "{key} did not complete"
        );
    }

    assert_eq!(runs.len(), 2, "one Run per Task attempt");
    for run in &runs {
        assert_eq!(run.status, RunStatus::Succeeded);
        assert_eq!(run.mission_id.as_deref(), Some(mission.id.as_str()));
        assert!(run.mission_task_id.is_some());
        assert!(
            run.worktree_path.is_some(),
            "each Task got its own worktree"
        );
        assert!(
            run.context_pack_id.is_some(),
            "context provenance is recorded"
        );
    }
    // Different Tasks must not share a worktree: that is what makes parallel Tasks safe.
    assert_ne!(runs[0].worktree_path, runs[1].worktree_path);

    // The real files the agents wrote.
    for (task_key, file) in [("T1", "docs/STEP-ONE.md"), ("T2", "docs/STEP-TWO.md")] {
        let task = detail
            .tasks
            .iter()
            .find(|task| task.key == task_key)
            .unwrap();
        let run = runs
            .iter()
            .find(|run| run.mission_task_id.as_deref() == Some(task.id.as_str()))
            .unwrap();
        let path = Path::new(run.worktree_path.as_deref().unwrap()).join(file);
        assert!(
            path.is_file(),
            "{task_key} did not produce {file} at {path:?}"
        );
    }

    // The handoff a dependent Task actually received.
    let outputs = fixture.missions.task_outputs(&mission.id).unwrap();
    assert!(outputs
        .iter()
        .any(|output| output.kind == MissionTaskOutputKind::Artifact));

    // And the honest part: nothing verified the Acceptance Criterion.
    assert_eq!(detail.progress.criteria_total, 1);
    assert_eq!(detail.progress.criteria_verified, 0);
    let active = detail
        .criteria
        .iter()
        .find(|criterion| criterion.retired_at.is_none())
        .unwrap();
    assert_eq!(active.status, AcceptanceCriterionStatus::Unverified);
}

#[test]
#[ignore = "real provider canary: spends quota and requires an authenticated Claude Code CLI"]
fn mission_control_canary_claude_drives_a_two_task_mission_to_implementation_complete() {
    canary("claude", "sonnet");
}

#[test]
#[ignore = "real provider canary: spends quota and requires an authenticated Codex CLI"]
fn mission_control_canary_codex_drives_a_two_task_mission_to_implementation_complete() {
    canary("codex", "gpt-5.5");
}

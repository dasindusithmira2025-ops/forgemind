//! Mission Control behaviour tests.
//!
//! These drive the real service against a real database and a real Run Engine; only the *provider
//! execution* is scripted, because that is the one thing a test must not spend money on. Every
//! transition, claim, reconciliation and recovery path below is the production code path.

use super::*;
use crate::models::run::{RunEventKind, RunStatus};
use crate::models::Project;
use crate::services::run_executor::{
    RunBindings, RunContext, RunExecutor, RunPollOutcome, RunStartOutcome,
};
use crate::services::{
    CodeIntelligence, ContextCompiler, FileSystemService, MemoryService, RepositoryService,
    SelfWriteLedger,
};
use chrono::Utc;
use std::sync::Arc;
use uuid::Uuid;

/// A provider that does exactly what the test says, in order. The last outcome repeats, so a test
/// that only cares about the first transition does not have to script every tick.
struct ScriptedProvider {
    polls: Mutex<Vec<RunPollOutcome>>,
    /// Set to fail every `start`, to exercise the launch-failure path.
    refuse_start: bool,
    started: Mutex<Vec<String>>,
    cancelled: Mutex<Vec<String>>,
}

impl ScriptedProvider {
    fn new(polls: Vec<RunPollOutcome>) -> Arc<Self> {
        Arc::new(Self {
            polls: Mutex::new(polls),
            refuse_start: false,
            started: Mutex::new(Vec::new()),
            cancelled: Mutex::new(Vec::new()),
        })
    }

    fn refusing() -> Arc<Self> {
        Arc::new(Self {
            polls: Mutex::new(Vec::new()),
            refuse_start: true,
            started: Mutex::new(Vec::new()),
            cancelled: Mutex::new(Vec::new()),
        })
    }
}

struct ScriptedHandle(Arc<ScriptedProvider>);

impl RunExecutor for ScriptedHandle {
    fn strategy(&self) -> RunExecutionStrategy {
        RunExecutionStrategy::SingleAgent
    }

    fn start(&self, context: &RunContext) -> AppResult<RunStartOutcome> {
        if self.0.refuse_start {
            return Err(AppError::new(
                "provider_refused",
                "No provider available.",
                true,
            ));
        }
        self.0.started.lock().push(context.run.id.clone());
        Ok(RunStartOutcome::Started(RunBindings {
            terminal_session_id: Some(format!("session-{}", context.run.id)),
            working_directory: Some(context.project_root.clone()),
            worktree_path: Some(format!("{}/wt", context.project_root)),
            branch_name: Some(format!("paralith/run-{}", &context.run.id[..8])),
            context_pack_id: Some("pack".into()),
            provider_id: Some("claude".into()),
            ..RunBindings::default()
        }))
    }

    fn poll(&self, _context: &RunContext) -> AppResult<RunPollOutcome> {
        let mut polls = self.0.polls.lock();
        if polls.len() > 1 {
            Ok(polls.remove(0))
        } else {
            Ok(polls
                .first()
                .cloned()
                .unwrap_or(RunPollOutcome::Running { activity: None }))
        }
    }

    fn cancel(&self, context: &RunContext, _hard: bool) -> AppResult<()> {
        self.0.cancelled.lock().push(context.run.id.clone());
        Ok(())
    }
}

fn finished(succeeded: bool) -> RunPollOutcome {
    RunPollOutcome::Finished {
        succeeded,
        summary: if succeeded {
            "Implemented the change.".into()
        } else {
            "The agent could not finish.".into()
        },
        error_code: (!succeeded).then(|| "provider_reported_failure".to_string()),
        error_message: (!succeeded).then(|| "The agent reported failure.".to_string()),
    }
}

struct Fixture {
    database: Arc<DatabaseService>,
    missions: MissionService,
    runs: RunService,
    provider: Arc<ScriptedProvider>,
    project_id: String,
    root: std::path::PathBuf,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

fn fixture_with(provider: Arc<ScriptedProvider>) -> Fixture {
    let unique = Uuid::new_v4().to_string();
    let base = std::fs::canonicalize(std::env::temp_dir()).unwrap();
    let root = base.join(format!("paralith-mission-{unique}"));
    std::fs::create_dir_all(root.join("src")).unwrap();
    std::fs::write(root.join("src/main.rs"), "fn main() {}\n").unwrap();

    let database = Arc::new(DatabaseService::in_memory().unwrap());
    let root_path = crate::services::project_service::display_path(&root);
    let now = Utc::now().to_rfc3339();
    let project = Project {
        id: Uuid::new_v4().to_string(),
        name: "fixture".into(),
        canonical_root_path: if cfg!(windows) {
            root_path.to_lowercase()
        } else {
            root_path.clone()
        },
        root_path: root_path.clone(),
        git_branch: None,
        detected_framework: None,
        package_manager: None,
        major_languages: Vec::new(),
        is_git_repository: false,
        has_package_json: false,
        has_lockfile: false,
        created_at: now.clone(),
        updated_at: now.clone(),
        last_opened_at: now,
    };
    database.upsert_project(&project).unwrap();

    let filesystem = FileSystemService::new(Arc::clone(&database), SelfWriteLedger::default());
    let planner = MissionPlanner::new(
        CodeIntelligence::new(Arc::clone(&database)),
        MemoryService::new(Arc::clone(&database), filesystem.clone()),
        Arc::new(RepositoryService::new(Arc::clone(&database), &root)),
        ContextCompiler::new(Arc::clone(&database), filesystem),
    );
    let runs = RunService::for_tests(
        Arc::clone(&database),
        vec![Box::new(ScriptedHandle(Arc::clone(&provider)))],
    );
    let missions = MissionService::for_tests(Arc::clone(&database), runs.clone(), planner);
    Fixture {
        database,
        missions,
        runs,
        provider,
        project_id: project.id,
        root,
    }
}

fn fixture() -> Fixture {
    fixture_with(ScriptedProvider::new(vec![RunPollOutcome::Running {
        activity: None,
    }]))
}

impl Fixture {
    /// One scheduler round, in the order production runs it: Missions launch Runs, the Run Engine
    /// prepares and then polls them, and Missions reconcile from what the Runs became. Two Run
    /// ticks because starting and observing a Run are separate steps of its own state machine.
    fn round(&self) {
        self.missions.tick().unwrap();
        self.runs.tick().unwrap();
        self.runs.tick().unwrap();
        self.missions.tick().unwrap();
    }

    fn task(&self, mission_id: &str, key: &str) -> MissionTask {
        self.database
            .mission_tasks(mission_id)
            .unwrap()
            .into_iter()
            .find(|task| task.key == key)
            .unwrap_or_else(|| panic!("no Task {key}"))
    }

    fn mission(&self, mission_id: &str) -> Mission {
        self.database.get_mission(mission_id).unwrap()
    }
}

fn create(fixture: &Fixture, constraints: Vec<&str>) -> Mission {
    fixture
        .missions
        .create(
            &CreateMissionRequest {
                project_id: fixture.project_id.clone(),
                objective: "Add team invitations to the dashboard.".into(),
                constraints: constraints.into_iter().map(str::to_owned).collect(),
                ..CreateMissionRequest::default()
            },
            "tester",
        )
        .unwrap()
}

fn plan_task(key: &str, depends_on: &[&str]) -> MissionPlanTask {
    MissionPlanTask {
        key: key.into(),
        title: format!("Task {key}"),
        objective: format!("Do {key}"),
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

fn chain_plan() -> MissionPlanDraft {
    MissionPlanDraft {
        summary: "Backend then UI".into(),
        criteria: vec![MissionPlanCriterion {
            key: "AC-01".into(),
            title: "Invitations can be sent".into(),
            description: "A member can invite someone by email.".into(),
            kind: AcceptanceCriterionKind::Behavioral,
            required: true,
            verification_hint: None,
        }],
        tasks: vec![plan_task("T1", &[]), plan_task("T2", &["T1"])],
        risk_level: None,
    }
}

/// A Mission with an explicit two-Task chain, prepared and ready to start.
fn ready_mission(fixture: &Fixture) -> Mission {
    let mission = create(fixture, Vec::new());
    fixture.missions.prepare(&mission.id, "tester").unwrap();
    fixture
        .missions
        .revise_plan(&mission.id, &chain_plan(), "explicit test plan", "tester")
        .unwrap()
}

// -- Preparation ------------------------------------------------------------------------------

#[test]
fn preparing_a_mission_runs_preflight_then_produces_a_validated_plan() {
    let fixture = fixture();
    let mission = create(&fixture, vec!["Existing membership must keep working"]);
    let prepared = fixture.missions.prepare(&mission.id, "tester").unwrap();

    assert_eq!(prepared.status, MissionStatus::Ready);
    assert_eq!(prepared.preflight_status, MissionPreflightStatus::Completed);

    let detail = fixture.missions.detail(&mission.id).unwrap();
    let preflight = detail.preflight.expect("Preflight must be persisted");
    assert!(
        !preflight.provenance.is_empty(),
        "every Preflight finding must name the subsystem that produced it"
    );
    assert!(!detail.tasks.is_empty());
    assert!(
        detail
            .criteria
            .iter()
            .any(|criterion| criterion.title == "Existing membership must keep working"),
        "a stated constraint must become an Acceptance Criterion"
    );
    assert!(
        detail
            .criteria
            .iter()
            .all(|criterion| criterion.status == AcceptanceCriterionStatus::Unverified),
        "planning must never mark a criterion verified"
    );
    // Preflight ran against a Project with no code index and no Git: the honest answer is
    // "unavailable", not a fabricated finding.
    assert!(preflight
        .provenance
        .iter()
        .any(|entry| entry.source == "project_graph" && !entry.available));
}

#[test]
fn a_mission_records_its_plan_as_a_revision_that_later_edits_never_overwrite() {
    let fixture = fixture();
    let mission = ready_mission(&fixture);
    let revisions = fixture.missions.plan_revisions(&mission.id).unwrap();
    assert_eq!(
        revisions.len(),
        2,
        "the deterministic plan and the revision"
    );
    assert_eq!(revisions[0].revision, 2);
    assert_eq!(revisions[0].reason, "explicit test plan");
    assert_eq!(revisions[1].revision, 1);
}

#[test]
fn a_mission_cannot_be_prepared_twice() {
    let fixture = fixture();
    let mission = create(&fixture, Vec::new());
    fixture.missions.prepare(&mission.id, "tester").unwrap();
    assert_eq!(
        fixture
            .missions
            .prepare(&mission.id, "tester")
            .unwrap_err()
            .code,
        "mission_not_preparable"
    );
}

#[test]
fn a_mission_without_a_plan_cannot_be_started() {
    let fixture = fixture();
    let mission = create(&fixture, Vec::new());
    assert_eq!(
        fixture.missions.start(&mission.id).unwrap_err().code,
        "mission_not_startable"
    );
}

// -- Execution --------------------------------------------------------------------------------

#[test]
fn starting_a_mission_launches_only_the_task_whose_dependencies_are_satisfied() {
    let fixture = fixture();
    let mission = ready_mission(&fixture);
    fixture.missions.start(&mission.id).unwrap();

    assert_eq!(fixture.mission(&mission.id).status, MissionStatus::Running);
    assert_eq!(
        fixture.task(&mission.id, "T1").status,
        MissionTaskStatus::Running
    );
    assert_eq!(
        fixture.task(&mission.id, "T2").status,
        MissionTaskStatus::Waiting,
        "a dependent Task must not launch before its dependency finishes"
    );

    let runs = fixture.missions.runs(&mission.id).unwrap();
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].run_type, RunType::MissionTask);
    assert_eq!(
        runs[0].mission_task_id.as_deref(),
        Some(fixture.task(&mission.id, "T1").id.as_str())
    );
    assert_eq!(runs[0].trigger_source, RunTriggerSource::Engine);
}

#[test]
fn a_completed_run_implements_its_task_and_unlocks_the_next_one() {
    let fixture = fixture_with(ScriptedProvider::new(vec![finished(true)]));
    let mission = ready_mission(&fixture);
    fixture.missions.start(&mission.id).unwrap();
    fixture.round();

    assert_eq!(
        fixture.task(&mission.id, "T1").status,
        MissionTaskStatus::Implemented
    );
    assert_eq!(
        fixture.task(&mission.id, "T2").status,
        MissionTaskStatus::Running,
        "the dependent Task must launch as soon as its dependency is implemented"
    );
    assert_eq!(fixture.missions.runs(&mission.id).unwrap().len(), 2);
}

#[test]
fn a_failed_run_fails_its_task_and_leaves_its_dependents_waiting() {
    let fixture = fixture_with(ScriptedProvider::new(vec![finished(false)]));
    let mission = ready_mission(&fixture);
    fixture.missions.start(&mission.id).unwrap();
    fixture.round();

    let first = fixture.task(&mission.id, "T1");
    assert_eq!(first.status, MissionTaskStatus::Failed);
    assert_eq!(
        first.status_reason.as_deref(),
        Some("provider_reported_failure")
    );
    assert_eq!(
        fixture.task(&mission.id, "T2").status,
        MissionTaskStatus::Waiting,
        "a failed dependency must never unlock downstream work"
    );
    assert_eq!(
        fixture.mission(&mission.id).status,
        MissionStatus::Blocked,
        "a Mission with no runnable work is blocked, not silently idle"
    );
    assert!(
        !fixture.mission(&mission.id).status.is_terminal(),
        "one failed Task must not destroy the Mission"
    );
}

#[test]
fn retrying_a_failed_task_creates_a_second_run_and_keeps_the_first() {
    let fixture = fixture_with(ScriptedProvider::new(vec![
        finished(false),
        RunPollOutcome::Running { activity: None },
    ]));
    let mission = ready_mission(&fixture);
    fixture.missions.start(&mission.id).unwrap();
    fixture.round();
    let failed_run = fixture.missions.runs(&mission.id).unwrap()[0].clone();
    assert_eq!(failed_run.status, RunStatus::Failed);

    let task = fixture.task(&mission.id, "T1");
    fixture.missions.retry_task(&task.id).unwrap();
    fixture.round();

    let runs = fixture.missions.runs(&mission.id).unwrap();
    assert_eq!(runs.len(), 2, "a retry is a new Run, not a rewritten one");
    assert!(
        runs.iter()
            .any(|run| run.id == failed_run.id && run.status == RunStatus::Failed),
        "the failed attempt must remain recorded"
    );
    let retried = fixture.task(&mission.id, "T1");
    assert_eq!(retried.attempt_count, 2);
    assert_eq!(retried.status, MissionTaskStatus::Running);
    assert_eq!(fixture.mission(&mission.id).status, MissionStatus::Running);
}

#[test]
fn an_interrupted_run_blocks_its_task_with_an_action_rather_than_looking_busy() {
    let fixture = fixture_with(ScriptedProvider::new(vec![RunPollOutcome::Lost {
        reason: "process_lost".into(),
    }]));
    let mission = ready_mission(&fixture);
    fixture.missions.start(&mission.id).unwrap();
    fixture.round();

    let task = fixture.task(&mission.id, "T1");
    assert_eq!(task.status, MissionTaskStatus::Blocked);
    assert_eq!(task.blocker_kind, Some(MissionBlockerKind::Interrupted));
    assert!(
        task.required_action.is_some(),
        "a blocker must say what to do"
    );
    assert_eq!(fixture.mission(&mission.id).status, MissionStatus::Blocked);
}

#[test]
fn an_approval_blocks_the_task_and_resolving_it_resumes_the_task() {
    let fixture = fixture_with(ScriptedProvider::new(vec![RunPollOutcome::NeedsApproval {
        kind: "permission".into(),
        summary: "Write outside the worktree?".into(),
        payload: serde_json::json!({}),
    }]));
    let mission = ready_mission(&fixture);
    fixture.missions.start(&mission.id).unwrap();
    fixture.round();

    let task = fixture.task(&mission.id, "T1");
    assert_eq!(task.status, MissionTaskStatus::Blocked);
    assert_eq!(task.blocker_kind, Some(MissionBlockerKind::Approval));

    // The approval is a Run concern; Mission Control surfaces it and never duplicates it.
    let approval = fixture
        .database
        .run_detail(task.current_run_id.as_deref().unwrap())
        .unwrap()
        .approvals
        .remove(0);
    *fixture.provider.polls.lock() = vec![RunPollOutcome::Running { activity: None }];
    fixture
        .runs
        .decide_approval(&approval.id, true, "tester", None)
        .unwrap();
    fixture.round();

    assert_eq!(
        fixture.task(&mission.id, "T1").status,
        MissionTaskStatus::Running
    );
    assert_eq!(fixture.mission(&mission.id).status, MissionStatus::Running);
}

#[test]
fn a_provider_that_cannot_start_fails_the_task_with_the_engines_own_reason() {
    let fixture = fixture_with(ScriptedProvider::refusing());
    let mission = ready_mission(&fixture);
    fixture.missions.start(&mission.id).unwrap();
    fixture.round();

    let task = fixture.task(&mission.id, "T1");
    assert_eq!(task.status, MissionTaskStatus::Failed);
    assert_eq!(task.status_reason.as_deref(), Some("provider_refused"));
    assert_eq!(fixture.mission(&mission.id).status, MissionStatus::Blocked);
}

/// A Task claimed but never attached to a Run — the process died between the two writes — must be
/// reported as a *launch* failure, which is retryable without implying an agent tried and failed.
#[test]
fn a_task_claimed_without_a_run_is_blocked_as_a_launch_failure_not_an_execution_failure() {
    let fixture = fixture();
    let mission = ready_mission(&fixture);
    fixture.missions.start(&mission.id).unwrap();
    let task = fixture.task(&mission.id, "T1");
    fixture
        .database
        .clear_mission_task_run_for_test(&task.id)
        .unwrap();

    fixture.missions.reconcile_after_restart().unwrap();

    let recovered = fixture.task(&mission.id, "T1");
    assert_eq!(recovered.status, MissionTaskStatus::Blocked);
    assert_eq!(
        recovered.blocker_kind,
        Some(MissionBlockerKind::LaunchFailed)
    );
    assert!(recovered.required_action.is_some());
}

#[test]
fn a_manual_task_never_launches_a_run() {
    let fixture = fixture();
    let mission = create(&fixture, Vec::new());
    fixture.missions.prepare(&mission.id, "tester").unwrap();
    let mut plan = chain_plan();
    plan.tasks[0].execution_mode = Some(MissionTaskExecutionMode::Manual);
    fixture
        .missions
        .revise_plan(&mission.id, &plan, "manual first step", "tester")
        .unwrap();
    fixture.missions.start(&mission.id).unwrap();
    fixture.round();

    assert_eq!(
        fixture.task(&mission.id, "T1").status,
        MissionTaskStatus::Ready
    );
    assert!(fixture.missions.runs(&mission.id).unwrap().is_empty());
    assert_eq!(
        fixture.mission(&mission.id).status,
        MissionStatus::Running,
        "a Mission waiting on a person is still running, not blocked"
    );

    let task = fixture.task(&mission.id, "T1");
    fixture
        .missions
        .complete_manual_task(&task.id, "tester")
        .unwrap();
    assert_eq!(
        fixture.task(&mission.id, "T1").status,
        MissionTaskStatus::Implemented
    );
    assert_eq!(
        fixture.task(&mission.id, "T2").status,
        MissionTaskStatus::Running
    );
}

// -- Concurrency ------------------------------------------------------------------------------

#[test]
fn two_ticks_never_launch_the_same_task_twice() {
    let fixture = fixture();
    let mission = ready_mission(&fixture);
    fixture.missions.start(&mission.id).unwrap();
    for _ in 0..5 {
        fixture.missions.tick().unwrap();
    }
    assert_eq!(
        fixture.missions.runs(&mission.id).unwrap().len(),
        1,
        "repeated scheduling must not spend a second provider session"
    );
    assert_eq!(fixture.task(&mission.id, "T1").attempt_count, 1);
}

#[test]
fn the_scheduler_never_runs_more_tasks_than_the_per_mission_ceiling() {
    let fixture = fixture();
    let mission = create(&fixture, Vec::new());
    fixture.missions.prepare(&mission.id, "tester").unwrap();
    let wide = MissionPlanDraft {
        criteria: vec![MissionPlanCriterion {
            key: "AC-01".into(),
            title: "It works".into(),
            description: String::new(),
            kind: AcceptanceCriterionKind::Behavioral,
            required: true,
            verification_hint: None,
        }],
        tasks: (1..=6)
            .map(|index| plan_task(&format!("T{index}"), &[]))
            .collect(),
        ..MissionPlanDraft::default()
    };
    fixture
        .missions
        .revise_plan(&mission.id, &wide, "six independent tasks", "tester")
        .unwrap();
    fixture.missions.start(&mission.id).unwrap();
    fixture.missions.tick().unwrap();

    let running = fixture
        .database
        .mission_tasks(&mission.id)
        .unwrap()
        .into_iter()
        .filter(|task| task.status == MissionTaskStatus::Running)
        .count();
    assert_eq!(running, MAX_CONCURRENT_MISSION_TASKS);
}

// -- Completion -------------------------------------------------------------------------------

#[test]
fn a_mission_whose_tasks_all_finish_reaches_review_with_its_criteria_still_unverified() {
    let fixture = fixture_with(ScriptedProvider::new(vec![finished(true)]));
    let mission = ready_mission(&fixture);
    fixture.missions.start(&mission.id).unwrap();
    fixture.round();
    fixture.round();

    let settled = fixture.mission(&mission.id);
    assert_eq!(settled.status, MissionStatus::ReviewReady);
    assert_eq!(
        settled.status_reason.as_deref(),
        Some("implementation_complete_verification_pending"),
        "the state must say implementation is done, not that the outcome is verified"
    );
    let detail = fixture.missions.detail(&mission.id).unwrap();
    assert_eq!(detail.progress.implemented, 2);
    assert_eq!(
        detail.progress.criteria_verified, 0,
        "no verification engine exists, so nothing may be verified"
    );
}

#[test]
fn accepting_a_mission_is_a_human_act_and_says_what_was_not_verified() {
    let fixture = fixture_with(ScriptedProvider::new(vec![finished(true)]));
    let mission = ready_mission(&fixture);
    fixture.missions.start(&mission.id).unwrap();
    fixture.round();
    fixture.round();

    let accepted = fixture.missions.accept(&mission.id, "tester").unwrap();
    assert_eq!(accepted.status, MissionStatus::Completed);
    assert_eq!(accepted.accepted_by.as_deref(), Some("tester"));
    assert_eq!(
        accepted.status_reason.as_deref(),
        Some("accepted_without_verification")
    );
    let events = fixture.missions.events(&mission.id, 200).unwrap();
    assert!(events
        .iter()
        .any(|event| event.kind == MissionEventKind::Completed
            && event.summary.contains("unverified")));
}

#[test]
fn a_mission_cannot_be_accepted_before_its_implementation_is_complete() {
    let fixture = fixture();
    let mission = ready_mission(&fixture);
    fixture.missions.start(&mission.id).unwrap();
    assert_eq!(
        fixture
            .missions
            .accept(&mission.id, "tester")
            .unwrap_err()
            .code,
        "mission_not_acceptable"
    );
}

// -- Cancellation -----------------------------------------------------------------------------

#[test]
fn cancelling_a_mission_stops_new_launches_cancels_active_runs_and_deletes_nothing() {
    let fixture = fixture();
    let mission = ready_mission(&fixture);
    fixture.missions.start(&mission.id).unwrap();
    // Let the Run acquire its worktree before cancelling, so the retention claim is about a
    // worktree that actually exists.
    fixture.runs.tick().unwrap();
    let first_run = fixture.missions.runs(&mission.id).unwrap()[0].clone();
    assert!(first_run.worktree_path.is_some());

    fixture.missions.cancel(&mission.id, "tester").unwrap();
    for _ in 0..3 {
        fixture.round();
    }

    assert_eq!(
        fixture.mission(&mission.id).status,
        MissionStatus::Cancelled
    );
    assert_eq!(
        fixture.task(&mission.id, "T1").status,
        MissionTaskStatus::Cancelled
    );
    assert_eq!(
        fixture.task(&mission.id, "T2").status,
        MissionTaskStatus::Cancelled
    );
    assert_eq!(
        fixture.missions.runs(&mission.id).unwrap().len(),
        1,
        "cancellation must prevent further launches"
    );
    assert!(
        fixture.provider.cancelled.lock().contains(&first_run.id),
        "the active Run must actually be cancelled, not just marked"
    );
    // The worktree the Run leased is retained: cancelled work stays inspectable.
    let cancelled_run = fixture.database.get_run(&first_run.id).unwrap();
    assert!(cancelled_run.worktree_path.is_some());
    assert!(!fixture
        .missions
        .events(&mission.id, 500)
        .unwrap()
        .is_empty());
}

#[test]
fn a_cancelled_mission_refuses_further_task_retries() {
    let fixture = fixture();
    let mission = ready_mission(&fixture);
    fixture.missions.start(&mission.id).unwrap();
    let task = fixture.task(&mission.id, "T1");
    fixture.missions.cancel(&mission.id, "tester").unwrap();
    assert_eq!(
        fixture.missions.retry_task(&task.id).unwrap_err().code,
        "mission_not_active"
    );
}

// -- Handoff ----------------------------------------------------------------------------------

#[test]
fn a_dependent_task_is_briefed_with_its_predecessors_structured_outputs() {
    let fixture = fixture_with(ScriptedProvider::new(vec![finished(true)]));
    let mission = ready_mission(&fixture);
    fixture.missions.start(&mission.id).unwrap();
    fixture.round();

    let outputs = fixture.missions.task_outputs(&mission.id).unwrap();
    assert!(
        outputs
            .iter()
            .any(|output| output.kind == MissionTaskOutputKind::Finding),
        "a finished Task must leave a structured finding, not a transcript"
    );
    assert!(
        outputs
            .iter()
            .any(|output| output.kind == MissionTaskOutputKind::Artifact
                && output.title.starts_with("Changes on ")),
        "the branch the work landed on is what a successor actually needs"
    );

    let second = fixture.task(&mission.id, "T2");
    let brief = fixture
        .missions
        .task_brief(&fixture.mission(&mission.id), &second)
        .unwrap();
    assert!(brief.contains("WHAT EARLIER TASKS IN THIS MISSION PRODUCED"));
    assert!(brief.contains("AC-01"));
    assert!(brief.contains("Do T2"));
}

#[test]
fn a_task_brief_carries_the_missions_constraints_and_non_goals() {
    let fixture = fixture();
    let mission = fixture
        .missions
        .create(
            &CreateMissionRequest {
                project_id: fixture.project_id.clone(),
                objective: "Add team invitations.".into(),
                constraints: vec!["Organization membership must keep working".into()],
                non_goals: vec!["Do not redesign the dashboard".into()],
                ..CreateMissionRequest::default()
            },
            "tester",
        )
        .unwrap();
    fixture.missions.prepare(&mission.id, "tester").unwrap();
    fixture
        .missions
        .revise_plan(&mission.id, &chain_plan(), "explicit", "tester")
        .unwrap();
    let task = fixture.task(&mission.id, "T1");
    let brief = fixture
        .missions
        .task_brief(&fixture.mission(&mission.id), &task)
        .unwrap();
    assert!(brief.contains("Organization membership must keep working"));
    assert!(brief.contains("Do not redesign the dashboard"));
}

// -- Plan revision ----------------------------------------------------------------------------

#[test]
fn revising_a_plan_mid_flight_preserves_completed_work_and_adds_the_new_task() {
    let fixture = fixture_with(ScriptedProvider::new(vec![finished(true)]));
    let mission = ready_mission(&fixture);
    fixture.missions.start(&mission.id).unwrap();
    fixture.round();
    assert_eq!(
        fixture.task(&mission.id, "T1").status,
        MissionTaskStatus::Implemented
    );

    let mut revised = chain_plan();
    revised.tasks.push(plan_task("T3", &["T1"]));
    fixture
        .missions
        .revise_plan(
            &mission.id,
            &revised,
            "discovered a migration is needed",
            "tester",
        )
        .unwrap();

    assert_eq!(
        fixture.task(&mission.id, "T1").status,
        MissionTaskStatus::Implemented,
        "a revision must not rewind finished work"
    );
    let added = fixture.task(&mission.id, "T3");
    assert!(matches!(
        added.status,
        MissionTaskStatus::Ready | MissionTaskStatus::Running
    ));
    let events = fixture.missions.events(&mission.id, 500).unwrap();
    assert!(events
        .iter()
        .any(|event| event.kind == MissionEventKind::PlanRevised));
}

#[test]
fn a_revision_that_would_deadlock_the_scheduler_is_refused() {
    let fixture = fixture();
    let mission = ready_mission(&fixture);
    let cyclic = MissionPlanDraft {
        criteria: chain_plan().criteria,
        tasks: vec![plan_task("T1", &["T2"]), plan_task("T2", &["T1"])],
        ..MissionPlanDraft::default()
    };
    assert_eq!(
        fixture
            .missions
            .revise_plan(&mission.id, &cyclic, "bad", "tester")
            .unwrap_err()
            .code,
        "mission_task_dependency_cycle"
    );
    assert_eq!(fixture.mission(&mission.id).plan_revision, 2);
}

// -- Recovery ---------------------------------------------------------------------------------

#[test]
fn restart_recovery_never_leaves_a_mission_running_with_no_active_work() {
    let fixture = fixture();
    let mission = ready_mission(&fixture);
    fixture.missions.start(&mission.id).unwrap();
    // Let the Run actually reach `running`: a Run still queued survives a restart legitimately,
    // and the interesting case is the one that claimed a live process.
    fixture.runs.tick().unwrap();
    assert_eq!(
        fixture
            .database
            .get_run(
                fixture
                    .task(&mission.id, "T1")
                    .current_run_id
                    .as_deref()
                    .unwrap()
            )
            .unwrap()
            .status,
        RunStatus::Running
    );

    // Exactly what a restart does, in the order production does it.
    fixture.runs.reconcile_after_restart().unwrap();
    let reconciled = fixture.missions.reconcile_after_restart().unwrap();
    assert!(reconciled >= 1);

    let task = fixture.task(&mission.id, "T1");
    assert_eq!(task.status, MissionTaskStatus::Blocked);
    assert_eq!(task.blocker_kind, Some(MissionBlockerKind::Interrupted));
    assert_eq!(fixture.mission(&mission.id).status, MissionStatus::Blocked);
    assert!(fixture
        .missions
        .events(&mission.id, 500)
        .unwrap()
        .iter()
        .any(|event| event.kind == MissionEventKind::Recovered));
}

#[test]
fn a_mission_interrupted_during_preflight_returns_to_draft_with_its_findings() {
    let fixture = fixture();
    let mission = create(&fixture, Vec::new());
    // Simulate a crash mid-Preflight: the Mission is in `Preflight` with nothing durable running.
    fixture
        .database
        .transition_mission(
            &mission.id,
            MissionStatus::Preflight,
            MissionEventKind::PreflightStarted,
            "analysing",
            &MissionTransitionUpdate::default(),
            &serde_json::json!({}),
        )
        .unwrap();

    fixture.missions.reconcile_after_restart().unwrap();

    let recovered = fixture.mission(&mission.id);
    assert_eq!(recovered.status, MissionStatus::Draft);
    assert_eq!(
        recovered.failure_code.as_deref(),
        Some("preflight_interrupted")
    );
    // Recoverable: preparing again must work.
    assert!(fixture.missions.prepare(&mission.id, "tester").is_ok());
}

#[test]
fn recovery_leaves_finished_missions_alone() {
    let fixture = fixture_with(ScriptedProvider::new(vec![finished(true)]));
    let mission = ready_mission(&fixture);
    fixture.missions.start(&mission.id).unwrap();
    fixture.round();
    fixture.round();
    fixture.missions.accept(&mission.id, "tester").unwrap();

    fixture.missions.reconcile_after_restart().unwrap();
    assert_eq!(
        fixture.mission(&mission.id).status,
        MissionStatus::Completed
    );
}

// -- Criteria ---------------------------------------------------------------------------------

#[test]
fn a_criterion_can_be_waived_with_a_reason_but_never_verified_by_mission_control() {
    let fixture = fixture();
    let mission = ready_mission(&fixture);
    let criterion = fixture
        .missions
        .detail(&mission.id)
        .unwrap()
        .criteria
        .remove(0);

    assert_eq!(
        fixture
            .missions
            .waive_criterion(&criterion.id, "   ", "tester")
            .unwrap_err()
            .code,
        "mission_waiver_reason_required"
    );
    let waived = fixture
        .missions
        .waive_criterion(&criterion.id, "Covered by the existing suite", "tester")
        .unwrap();
    assert_eq!(waived.status, AcceptanceCriterionStatus::Waived);

    let detail = fixture.missions.detail(&mission.id).unwrap();
    assert_eq!(detail.progress.criteria_waived, 1);
    assert_eq!(detail.progress.criteria_verified, 0);
}

// -- Journal ----------------------------------------------------------------------------------

#[test]
fn the_mission_journal_correlates_every_task_transition_with_its_run() {
    let fixture = fixture_with(ScriptedProvider::new(vec![finished(true)]));
    let mission = ready_mission(&fixture);
    fixture.missions.start(&mission.id).unwrap();
    fixture.round();

    let events = fixture.missions.events(&mission.id, 500).unwrap();
    let sequences: Vec<i64> = events.iter().map(|event| event.sequence).collect();
    let mut expected: Vec<i64> = (1..=sequences.len() as i64).collect();
    expected.sort_unstable();
    assert_eq!(
        sequences, expected,
        "the journal must be gap-free and ordered"
    );

    let started = events
        .iter()
        .find(|event| event.kind == MissionEventKind::TaskStarted && event.run_id.is_some())
        .expect("a Task start must record the Run that executes it");
    let run_id = started.run_id.clone().unwrap();
    assert!(fixture
        .missions
        .runs(&mission.id)
        .unwrap()
        .iter()
        .any(|run| run.id == run_id));
}

#[test]
fn a_run_created_by_a_mission_carries_the_correlation_a_timeline_needs() {
    let fixture = fixture();
    let mission = ready_mission(&fixture);
    fixture.missions.start(&mission.id).unwrap();
    let run = fixture.missions.runs(&mission.id).unwrap().remove(0);
    assert_eq!(run.mission_id.as_deref(), Some(mission.id.as_str()));
    assert!(run.mission_task_id.is_some());
    let detail = fixture.database.run_detail(&run.id).unwrap();
    assert!(detail
        .events
        .iter()
        .any(|event| event.kind == RunEventKind::Created));
}

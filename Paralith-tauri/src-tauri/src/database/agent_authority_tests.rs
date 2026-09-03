//! Durable behaviour for the authority engine, approvals, Skills and Routines.
//!
//! These are the invariants a user's trust actually rests on — that a teammate cannot publish
//! because it feels senior, that an approval survives a restart and executes once, and that a
//! Routine which fell due while the laptop was shut does not fire a fortnight of backlog.

use super::DatabaseService;
use crate::models::{
    AgentCapabilityDecision, CreateOrganizationalAgentInput, SaveAgentRoutineInput,
    SaveAgentSkillInput,
};
use chrono::{Duration, Utc};
use uuid::Uuid;

fn agent(name: &str) -> CreateOrganizationalAgentInput {
    CreateOrganizationalAgentInput {
        name: name.into(),
        role: "Engineering Lead".into(),
        brief: "Own implementation quality.".into(),
        responsibilities: vec!["Engineering delivery".into()],
        intelligence_preference: "automatic".into(),
        project_id: None,
        workspace_id: None,
        project_access: None,
    }
}

fn project(root: &std::path::Path) -> crate::models::Project {
    let now = Utc::now().to_rfc3339();
    crate::models::Project {
        id: Uuid::new_v4().to_string(),
        name: "Paralith".into(),
        root_path: root.display().to_string(),
        canonical_root_path: root.display().to_string(),
        git_branch: None,
        detected_framework: None,
        package_manager: None,
        major_languages: vec!["Rust".into()],
        is_git_repository: false,
        has_package_json: false,
        has_lockfile: false,
        created_at: now.clone(),
        updated_at: now.clone(),
        last_opened_at: now,
    }
}

fn fixture() -> (DatabaseService, crate::models::Project, String) {
    let database = DatabaseService::in_memory().unwrap();
    let root = std::env::temp_dir().join(format!("paralith-authority-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let saved = database.upsert_project(&project(&root)).unwrap();
    let forge = database
        .create_organizational_agent(CreateOrganizationalAgentInput {
            project_id: Some(saved.id.clone()),
            project_access: Some("read_write".into()),
            ..agent("Forge")
        })
        .unwrap();
    (database, saved, forge.id)
}

/// A read/write grant is permission to work, never permission to publish. Nothing an Agent is
/// called or assigned changes that; only an explicit capability does.
#[test]
fn a_workspace_grant_never_carries_publishing_with_it() {
    let (database, project, forge) = fixture();
    let authority = database
        .agent_work_authority(&forge, &project.id, None, "")
        .unwrap();
    assert!(authority.read && authority.write && authority.run_commands);
    assert!(!authority.commit && !authority.push);
    assert!(!authority.commit_requires_approval && !authority.push_requires_approval);
}

#[test]
fn an_allowed_capability_grants_it_and_an_asked_one_does_not() {
    let (database, project, forge) = fixture();
    database
        .set_agent_capability(&forge, "commit", AgentCapabilityDecision::Allow)
        .unwrap();
    database
        .set_agent_capability(&forge, "push", AgentCapabilityDecision::Ask)
        .unwrap();
    let authority = database
        .agent_work_authority(&forge, &project.id, None, "")
        .unwrap();
    assert!(authority.commit, "allow grants the capability outright");
    assert!(
        !authority.push,
        "ask grants the run nothing; it only opens the request"
    );
    assert!(authority.push_requires_approval);
}

/// Revoking a capability has to reach every Project at once. A user who takes write away from a
/// teammate should not have to remember which grants exist.
#[test]
fn revoking_a_capability_overrides_the_project_grant() {
    let (database, project, forge) = fixture();
    database
        .set_agent_capability(&forge, "workspace_write", AgentCapabilityDecision::Deny)
        .unwrap();
    database
        .set_agent_capability(&forge, "run_commands", AgentCapabilityDecision::Deny)
        .unwrap();
    let authority = database
        .agent_work_authority(&forge, &project.id, None, "")
        .unwrap();
    assert!(authority.read);
    assert!(!authority.write && !authority.run_commands);
}

/// A delegation may only narrow. "Do not push" removes the request as well as the act — otherwise
/// the run could come back and ask for exactly the thing it was told not to do.
#[test]
fn a_delegation_constraint_closes_the_approval_route_too() {
    let (database, project, forge) = fixture();
    database
        .set_agent_capability(&forge, "commit", AgentCapabilityDecision::Ask)
        .unwrap();
    database
        .set_agent_capability(&forge, "push", AgentCapabilityDecision::Ask)
        .unwrap();
    let open = database
        .agent_work_authority(&forge, &project.id, None, "")
        .unwrap();
    assert!(open.push_requires_approval);
    let narrowed = database
        .agent_work_authority(&forge, &project.id, None, "Do not commit or push.")
        .unwrap();
    assert!(!narrowed.commit_requires_approval && !narrowed.push_requires_approval);
    assert!(!narrowed.commit && !narrowed.push);
}

/// Pushing without committing is incoherent. A half-configured policy resolves to the narrower
/// of the two rather than to something that cannot be carried out.
#[test]
fn push_without_commit_resolves_to_neither() {
    let (database, project, forge) = fixture();
    database
        .set_agent_capability(&forge, "push", AgentCapabilityDecision::Allow)
        .unwrap();
    database
        .set_agent_capability(&forge, "commit", AgentCapabilityDecision::Deny)
        .unwrap();
    let authority = database
        .agent_work_authority(&forge, &project.id, None, "")
        .unwrap();
    assert!(!authority.push && !authority.commit);
}

#[test]
fn an_unknown_capability_cannot_be_invented() {
    let (database, _, forge) = fixture();
    let error = database
        .set_agent_capability(
            &forge,
            "deploy_to_production",
            AgentCapabilityDecision::Allow,
        )
        .unwrap_err();
    assert_eq!(error.code, "agent_capability_unknown");
}

/// The whole approval contract in one pass: it is durable, it is unique per run and kind, only
/// one caller can decide it, and an executed approval cannot be executed again.
#[test]
fn an_approval_is_durable_unique_and_executes_exactly_once() {
    let (database, project, forge) = fixture();
    let work = database
        .create_agent_work(super::agent_work::NewAgentWork {
            agent_id: &forge,
            delegation_id: None,
            parent_work_id: None,
            objective: "Ship the composer repair.",
            constraints: "",
            expected_result: "",
            project_id: &project.id,
            workspace_id: None,
            origin_conversation_id: None,
            runtime_preference: None,
            authority: database
                .agent_work_authority(&forge, &project.id, None, "")
                .unwrap(),
        })
        .unwrap();
    let first = database
        .create_agent_approval(
            &work.id,
            &project.id,
            "push",
            "Forge wants to push",
            &serde_json::json!({ "branch": "feat/agent-mode" }),
        )
        .unwrap();
    // Asking twice must not queue a second card. The user's answer is the same either way.
    let again = database
        .create_agent_approval(
            &work.id,
            &project.id,
            "push",
            "Forge wants to push",
            &serde_json::json!({}),
        )
        .unwrap();
    assert_eq!(first.id, again.id);
    assert_eq!(database.open_agent_approvals().unwrap().len(), 1);
    assert_eq!(first.agent_name.as_deref(), Some("Forge"));
    assert_eq!(
        first.detail.get("branch").and_then(|value| value.as_str()),
        Some("feat/agent-mode")
    );

    assert!(database
        .decide_agent_approval(&first.id, true, Some("Looks right"))
        .unwrap());
    // A second decision — another window, or a replayed call after a restart — changes nothing
    // and, crucially, tells its caller so, which is what stops a second push.
    assert!(!database
        .decide_agent_approval(&first.id, true, None)
        .unwrap());
    assert!(database.open_agent_approvals().unwrap().is_empty());

    assert!(database
        .mark_agent_approval_executed(&first.id, "executed")
        .unwrap());
    assert!(!database
        .mark_agent_approval_executed(&first.id, "executed")
        .unwrap());
    let settled = database.get_agent_approval(&first.id).unwrap();
    assert_eq!(settled.status, "executed");
    assert_eq!(settled.decision_note.as_deref(), Some("Looks right"));
    assert!(settled.decided_at.is_some());
}

/// A denied approval is a recorded refusal, not a disappearance.
#[test]
fn a_denial_is_recorded_and_cannot_be_reversed_by_replay() {
    let (database, project, forge) = fixture();
    let work = database
        .create_agent_work(super::agent_work::NewAgentWork {
            agent_id: &forge,
            delegation_id: None,
            parent_work_id: None,
            objective: "Publish",
            constraints: "",
            expected_result: "",
            project_id: &project.id,
            workspace_id: None,
            origin_conversation_id: None,
            runtime_preference: None,
            authority: Default::default(),
        })
        .unwrap();
    let approval = database
        .create_agent_approval(
            &work.id,
            &project.id,
            "push",
            "Push",
            &serde_json::json!({}),
        )
        .unwrap();
    assert!(database
        .decide_agent_approval(&approval.id, false, Some("Not yet"))
        .unwrap());
    // Denied approvals are not `approved`, so the execution guard refuses them outright.
    assert!(!database
        .mark_agent_approval_executed(&approval.id, "executed")
        .unwrap());
    assert_eq!(
        database.get_agent_approval(&approval.id).unwrap().status,
        "denied"
    );
}

#[test]
fn a_skill_is_editable_in_place_and_keeps_its_assignments() {
    let (database, _, forge) = fixture();
    let skill = database
        .save_agent_skill(SaveAgentSkillInput {
            id: None,
            name: "Release checklist".into(),
            summary: "How we ship".into(),
            applies_when: "Preparing a release".into(),
            procedure: "Run the suite, review the diff, tag.".into(),
            validation: "cargo test".into(),
            expected_result: "A reviewed tag".into(),
        })
        .unwrap();
    database
        .set_agent_skill_assigned(&forge, &skill.id, true)
        .unwrap();
    assert_eq!(database.skills_for_agent(&forge).unwrap().len(), 1);

    let edited = database
        .save_agent_skill(SaveAgentSkillInput {
            id: Some(skill.id.clone()),
            name: "Release checklist".into(),
            summary: "How we ship".into(),
            applies_when: "Preparing a release".into(),
            procedure: "Run the suite, review the diff, then tag.".into(),
            validation: "cargo test".into(),
            expected_result: "A reviewed tag".into(),
        })
        .unwrap();
    assert_eq!(edited.id, skill.id);
    assert_eq!(
        database.skills_for_agent(&forge).unwrap().len(),
        1,
        "editing a procedure must not detach it from the teammate using it"
    );

    database
        .set_agent_skill_assigned(&forge, &skill.id, false)
        .unwrap();
    assert!(database.skills_for_agent(&forge).unwrap().is_empty());
}

#[test]
fn a_skill_needs_a_procedure_not_just_a_name() {
    let (database, _, _) = fixture();
    let error = database
        .save_agent_skill(SaveAgentSkillInput {
            id: None,
            name: "Vague".into(),
            summary: String::new(),
            applies_when: String::new(),
            procedure: "   ".into(),
            validation: String::new(),
            expected_result: String::new(),
        })
        .unwrap_err();
    assert_eq!(error.code, "agent_skill_procedure_required");
}

/// A Routine that fell due while Paralith was closed runs once, and claiming it moves the
/// schedule forward so a second tick arriving mid-launch does not run it again.
#[test]
fn an_overdue_routine_is_claimed_once_and_rescheduled_forward() {
    let (database, project, forge) = fixture();
    let routine = database
        .save_agent_routine(SaveAgentRoutineInput {
            id: None,
            agent_id: forge.clone(),
            name: "Competitor review".into(),
            objective: "Summarise what changed this week.".into(),
            constraints: "Read only.".into(),
            project_id: project.id.clone(),
            cadence: "daily".into(),
            enabled: true,
        })
        .unwrap();
    assert!(
        routine.next_run_at.is_some(),
        "an enabled Routine is scheduled"
    );
    assert!(
        database.due_agent_routines().unwrap().is_empty(),
        "a Routine created now is not immediately due"
    );

    // Backdate it the way a laptop being shut for two days would.
    let overdue = (Utc::now() - Duration::days(2)).to_rfc3339();
    database
        .connection
        .lock()
        .execute(
            "UPDATE agent_routines SET next_run_at=?2 WHERE id=?1",
            rusqlite::params![routine.id, overdue],
        )
        .unwrap();
    let due = database.due_agent_routines().unwrap();
    assert_eq!(due.len(), 1);

    assert!(database.claim_agent_routine(&routine.id, &overdue).unwrap());
    // The losing tick sees the schedule has already moved and stands down.
    assert!(!database.claim_agent_routine(&routine.id, &overdue).unwrap());
    assert!(
        database.due_agent_routines().unwrap().is_empty(),
        "claiming reschedules forward, so two days missed is not two days of backlog"
    );
}

/// Editing the objective must not silently reschedule; pausing and resuming must not fire
/// immediately.
#[test]
fn editing_a_routine_preserves_its_schedule_and_resuming_recomputes_it() {
    let (database, project, forge) = fixture();
    let input = |id: Option<String>, enabled: bool, objective: &str| SaveAgentRoutineInput {
        id,
        agent_id: forge.clone(),
        name: "Daily review".into(),
        objective: objective.into(),
        constraints: String::new(),
        project_id: project.id.clone(),
        cadence: "daily".into(),
        enabled,
    };
    let created = database
        .save_agent_routine(input(None, true, "Review"))
        .unwrap();
    let scheduled = created.next_run_at.clone().unwrap();

    let edited = database
        .save_agent_routine(input(Some(created.id.clone()), true, "Review harder"))
        .unwrap();
    assert_eq!(
        edited.next_run_at.as_deref(),
        Some(scheduled.as_str()),
        "changing what a Routine does must not change when it runs"
    );

    let paused = database
        .save_agent_routine(input(Some(created.id.clone()), false, "Review harder"))
        .unwrap();
    assert!(paused.next_run_at.is_none());
    assert!(database.due_agent_routines().unwrap().is_empty());

    let resumed = database
        .save_agent_routine(input(Some(created.id.clone()), true, "Review harder"))
        .unwrap();
    assert!(resumed.next_run_at.is_some());
    assert!(
        database.due_agent_routines().unwrap().is_empty(),
        "a resumed Routine waits a full cadence rather than firing on the spot"
    );
}

#[test]
fn a_cadence_paralith_cannot_schedule_is_refused() {
    let (database, project, forge) = fixture();
    let error = database
        .save_agent_routine(SaveAgentRoutineInput {
            id: None,
            agent_id: forge,
            name: "Every third Tuesday".into(),
            objective: "Something".into(),
            constraints: String::new(),
            project_id: project.id,
            cadence: "0 0 * * 2".into(),
            enabled: true,
        })
        .unwrap_err();
    assert_eq!(error.code, "agent_routine_cadence_invalid");
}

/// Delegating is a capability like any other. A teammate whose policy refuses it cannot hand
/// work to anyone, whatever it writes in a conversation.
#[test]
fn delegating_is_allowed_by_default_and_can_be_taken_away() {
    let (database, _, forge) = fixture();
    assert_eq!(
        database.agent_capability(&forge, "delegate_work").unwrap(),
        AgentCapabilityDecision::Allow
    );
    database
        .set_agent_capability(&forge, "delegate_work", AgentCapabilityDecision::Deny)
        .unwrap();
    assert_eq!(
        database.agent_capability(&forge, "delegate_work").unwrap(),
        AgentCapabilityDecision::Deny
    );
}

/// A teammate that has never been configured still has a complete, closed posture. Absence is
/// never permission.
#[test]
fn an_unconfigured_teammate_has_a_complete_and_closed_posture() {
    let (database, _, forge) = fixture();
    let posture = database.agent_capabilities(&forge).unwrap();
    assert_eq!(
        posture.len(),
        super::agent_authority::CAPABILITY_DEFAULTS.len()
    );
    for capability in &posture {
        let expected = match capability.capability.as_str() {
            "commit" | "push" => AgentCapabilityDecision::Deny,
            _ => AgentCapabilityDecision::Allow,
        };
        assert_eq!(capability.decision, expected, "{}", capability.capability);
    }
}

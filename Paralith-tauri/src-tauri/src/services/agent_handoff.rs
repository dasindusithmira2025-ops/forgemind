//! Automatic agent handoffs.
//!
//! When an agent run finishes, what it did is knowable from artifacts that already exist — the run
//! row, its changed files, its evidence, its structured result. Nobody should have to write that up
//! by hand, and nobody does write it up by hand, which is why the next agent normally starts from
//! nothing.
//!
//! ## The rule this module holds to
//!
//! **Never fabricate a field.** An agent that ran no tests reports no tests. A run with no commit
//! reports no commit. A handoff whose "tests" section is invented is worse than no handoff, because
//! the next agent believes it.
//!
//! A handoff is evidence, not canonical Memory. Durable candidates are extracted from it by
//! [`crate::services::knowledge_intelligence`] and pass the same policy as everything else.

use crate::models::intelligence::{AgentHandoff, CandidateInput, CandidateOrigin, FactEvidence};
use crate::models::swarm::SwarmAgentRun;

/// Longest single line kept from a run's narrative output.
const MAX_LINE_CHARS: usize = 300;

/// Most files listed per bucket. A refactor touching four hundred files produces a handoff nobody
/// reads; the count is preserved in the outcome line so nothing is silently hidden.
const MAX_FILES: usize = 40;

/// Most findings extracted as durable candidates from one handoff.
const MAX_FINDINGS: usize = 12;

/// Bound a line and strip anything credential-shaped out of it.
///
/// A handoff is assembled from an agent's own narrative output, which is the one input in this
/// pipeline neither Paralith nor the user wrote. It is redacted here — at the single funnel every
/// field passes through — rather than at each field, because a handoff is persisted, rendered into
/// the Timeline, and read by the next agent, and a secret that reaches any of those is not
/// recoverable.
fn clip(line: &str) -> String {
    let redacted = redact_tokens(line);
    let trimmed = redacted.trim();
    if trimmed.chars().count() <= MAX_LINE_CHARS {
        return trimmed.to_owned();
    }
    trimmed.chars().take(MAX_LINE_CHARS - 1).collect::<String>() + "…"
}

/// Run the shared redactor over each whitespace-delimited token rather than the whole line.
///
/// [`crate::orchestration::redaction::redact_text`] recognizes a `NAME=value` assignment only when
/// the name is the whole line, which is right for a log tail and wrong for prose: an agent writes
/// "Used api_key=sk-live-… to reproduce", and that is exactly the shape a narrative handoff
/// carries. Tokenizing first — the same thing `memory_markdown::reject_secrets` does before its
/// own check — applies the existing rules without changing them, so there is one redaction
/// vocabulary in the codebase and not two.
fn redact_tokens(line: &str) -> String {
    line.split_whitespace()
        .map(crate::orchestration::redaction::redact_text)
        .collect::<Vec<_>>()
        .join(" ")
}

/// Pull a list of strings out of a structured result, tolerating both `["a","b"]` and a newline
/// blob. Agent runtimes disagree about the shape, and a handoff that only works for one of them is
/// a handoff that is usually empty.
fn string_list(value: Option<&serde_json::Value>) -> Vec<String> {
    let Some(value) = value else {
        return Vec::new();
    };
    match value {
        serde_json::Value::Array(items) => items
            .iter()
            .filter_map(|item| item.as_str())
            .map(clip)
            .filter(|line| !line.is_empty())
            .collect(),
        serde_json::Value::String(text) => text
            .lines()
            .map(clip)
            .filter(|line| !line.is_empty())
            .collect(),
        _ => Vec::new(),
    }
}

/// Build a handoff from a completed agent run.
///
/// `task` and `goal` come from the caller because the run row knows its task id, not its wording.
pub fn from_agent_run(
    project_id: &str,
    run: &SwarmAgentRun,
    goal: &str,
    task: &str,
    branch_name: Option<&str>,
    worktree_path: Option<&str>,
) -> AgentHandoff {
    let structured = run.structured_result.as_ref();
    let field = |name: &str| structured.and_then(|value| value.get(name));

    // The runtime reports a flat changed-files list; classifying it into created/modified/deleted
    // needs a diff we do not have here, so everything lands in `files_modified` rather than being
    // guessed at. A wrong "created" is worse than an honest "modified".
    let mut files_modified: Vec<String> = run.files_changed.iter().map(|path| clip(path)).collect();
    let total_files = files_modified.len();
    files_modified.truncate(MAX_FILES);

    let outcome = match run.status.as_str() {
        "finished" => "completed",
        "failed" => "failed",
        "cancelled" => "cancelled",
        "interrupted" => "interrupted",
        other => other,
    };

    let summary = field("summary")
        .and_then(|value| value.as_str())
        .map(clip)
        .unwrap_or_default();
    let mut work_completed = string_list(field("workCompleted"));
    if work_completed.is_empty() && !summary.is_empty() {
        work_completed.push(summary.clone());
    }

    let mut failures = string_list(field("failures"));
    for reason in [&run.failure_reason, &run.cancellation_reason] {
        if let Some(reason) = reason.as_deref().filter(|value| !value.trim().is_empty()) {
            failures.push(clip(reason));
        }
    }
    if let Some(code) = run.exit_code.filter(|code| *code != 0) {
        failures.push(format!("Process exited with code {code}."));
    }

    AgentHandoff {
        id: String::new(),
        project_id: project_id.to_owned(),
        run_id: Some(run.id.clone()),
        swarm_id: Some(run.swarm_id.clone()),
        task_id: run.task_id.clone(),
        agent: run.member_id.clone(),
        model: Some(run.resolved_model_id.clone()).filter(|value| !value.is_empty()),
        goal: clip(goal),
        task: clip(task),
        outcome: if total_files > MAX_FILES {
            format!("{outcome} ({total_files} files changed)")
        } else {
            outcome.to_owned()
        },
        work_completed,
        files_created: Vec::new(),
        files_modified,
        files_deleted: Vec::new(),
        decisions: string_list(field("decisions")),
        findings: string_list(field("findings")),
        tests: string_list(field("tests")),
        commands: string_list(field("commands")),
        evidence_ids: run.evidence_ids.clone(),
        failures,
        remaining_work: string_list(field("remainingWork")),
        recommended_next: field("recommendedNext")
            .and_then(|value| value.as_str())
            .map(clip)
            .filter(|value| !value.is_empty()),
        branch_name: branch_name.map(str::to_owned),
        worktree_path: worktree_path.map(str::to_owned),
        commit_sha: field("commit")
            .and_then(|value| value.as_str())
            .map(str::to_owned),
        created_at: run
            .finished_at
            .clone()
            .unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
    }
}

/// A readable Markdown rendering, for the Timeline detail pane and the Markdown mirror.
///
/// Empty sections are omitted rather than printed with "none": a document full of empty headings
/// reads as a template nobody filled in, which is exactly the impression to avoid.
pub fn render_markdown(handoff: &AgentHandoff) -> String {
    let mut out = String::new();
    out.push_str(&format!("**Goal.** {}\n\n", handoff.goal));
    if !handoff.task.is_empty() {
        out.push_str(&format!("**Task.** {}\n\n", handoff.task));
    }
    out.push_str(&format!("**Outcome.** {}\n", handoff.outcome));
    if let Some(branch) = &handoff.branch_name {
        out.push_str(&format!("**Branch.** `{branch}`\n"));
    }
    if let Some(commit) = &handoff.commit_sha {
        out.push_str(&format!("**Commit.** `{commit}`\n"));
    }
    out.push('\n');

    let section = |title: &str, items: &[String], out: &mut String| {
        if items.is_empty() {
            return;
        }
        out.push_str(&format!("## {title}\n\n"));
        for item in items {
            out.push_str(&format!("- {item}\n"));
        }
        out.push('\n');
    };
    section("Work completed", &handoff.work_completed, &mut out);
    section("Decisions", &handoff.decisions, &mut out);
    section("Findings", &handoff.findings, &mut out);
    section("Files changed", &handoff.files_modified, &mut out);
    section("Tests", &handoff.tests, &mut out);
    section("Commands", &handoff.commands, &mut out);
    section("Failures and limitations", &handoff.failures, &mut out);
    section("Remaining work", &handoff.remaining_work, &mut out);
    if let Some(next) = &handoff.recommended_next {
        out.push_str(&format!("## Recommended next\n\n{next}\n"));
    }
    out
}

/// Extract durable knowledge candidates from a handoff.
///
/// Only *findings* and *decisions* become candidates. Work logs, file lists, and command output are
/// what happened once; a finding is a claim about how the system is. Turning the former into Memory
/// is transcript dumping with extra steps.
pub fn candidates_from_handoff(handoff: &AgentHandoff) -> Vec<CandidateInput> {
    let mut out = Vec::new();
    // The files the run touched are the evidence for anything it learned. Without them a handoff
    // candidate would be an unsupported assertion, which policy rejects anyway.
    let evidence: Vec<FactEvidence> = handoff
        .files_modified
        .iter()
        .take(5)
        .map(|path| FactEvidence {
            path: path.clone(),
            kind: "file".into(),
            excerpt: None,
        })
        .collect();
    let subject = handoff
        .task
        .split_whitespace()
        .take(8)
        .collect::<Vec<_>>()
        .join(" ");
    let subject = if subject.is_empty() {
        handoff.agent.clone()
    } else {
        subject
    };

    for (statement, predicate, memory_type, confidence) in handoff
        .findings
        .iter()
        .take(MAX_FINDINGS)
        .map(|text| (text, "finding", "note", 0.6))
        .chain(
            handoff
                .decisions
                .iter()
                .take(MAX_FINDINGS)
                // A decision an agent recorded is high-risk by memory type, so it will always reach
                // review — which is the intent. An agent does not get to set project policy.
                .map(|text| (text, "decided", "decision", 0.6)),
        )
    {
        out.push(CandidateInput {
            kind: format!("handoff.{predicate}"),
            subject: subject.clone(),
            subject_kind: crate::models::intelligence::entity_kind::TASK.to_owned(),
            subject_identity: handoff.task_id.as_ref().map(|id| format!("task:{id}")),
            predicate: predicate.to_owned(),
            object: clip(statement),
            statement: clip(statement),
            suggested_memory_type: memory_type.to_owned(),
            confidence,
            origin: CandidateOrigin::Handoff,
            branch_name: handoff.branch_name.clone(),
            created_by: format!("handoff:{}", handoff.agent),
            evidence: evidence.clone(),
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::swarm::SwarmMemberModelConfig;

    fn run(status: &str, structured: Option<serde_json::Value>) -> SwarmAgentRun {
        SwarmAgentRun {
            id: "run-1".into(),
            swarm_run_id: "sr-1".into(),
            swarm_id: "s-1".into(),
            member_id: "implementer".into(),
            task_id: Some("t-1".into()),
            terminal_session_id: None,
            process_id: None,
            status: status.into(),
            attempt: 1,
            requested_provider_id: "claude".into(),
            requested_model_id: "claude-opus-5".into(),
            resolved_provider_id: "claude".into(),
            resolved_model_id: "claude-opus-5".into(),
            reasoning_effort: "high".into(),
            fallback_used: false,
            fallback_reason: None,
            provider_runtime_version: None,
            execution_config_snapshot: SwarmMemberModelConfig::configured(
                "claude",
                "claude-opus-5",
                "Claude",
                "Opus 5",
            ),
            exit_code: Some(0),
            failure_reason: None,
            cancellation_reason: None,
            structured_result: structured,
            files_changed: vec!["src/auth/token.rs".into(), "src/auth/session.rs".into()],
            evidence_ids: vec!["ev-1".into()],
            created_at: "2026-01-01T00:00:00Z".into(),
            started_at: Some("2026-01-01T00:00:00Z".into()),
            finished_at: Some("2026-01-01T00:10:00Z".into()),
            updated_at: "2026-01-01T00:10:00Z".into(),
        }
    }

    #[test]
    fn a_completed_run_becomes_a_handoff_with_its_real_artifacts() {
        let handoff = from_agent_run(
            "p1",
            &run(
                "finished",
                Some(serde_json::json!({
                    "summary": "Rotated tokens inside the transaction.",
                    "findings": ["Token invalidation was outside the transaction."],
                    "tests": ["cargo test auth"],
                    "commit": "a1b2c3"
                })),
            ),
            "Fix token invalidation",
            "Move invalidation inside the transaction",
            Some("fix/token-invalidation"),
            None,
        );
        assert_eq!(handoff.outcome, "completed");
        assert_eq!(handoff.run_id.as_deref(), Some("run-1"));
        assert_eq!(handoff.files_modified.len(), 2);
        assert_eq!(handoff.tests, vec!["cargo test auth".to_owned()]);
        assert_eq!(handoff.commit_sha.as_deref(), Some("a1b2c3"));
        assert_eq!(handoff.evidence_ids, vec!["ev-1".to_owned()]);
        assert_eq!(
            handoff.branch_name.as_deref(),
            Some("fix/token-invalidation")
        );
    }

    #[test]
    fn a_run_with_no_structured_result_reports_empty_sections_not_invented_ones() {
        let handoff = from_agent_run("p1", &run("finished", None), "Goal", "Task", None, None);
        assert!(handoff.tests.is_empty());
        assert!(handoff.decisions.is_empty());
        assert!(handoff.findings.is_empty());
        assert!(handoff.commit_sha.is_none());
        assert!(handoff.recommended_next.is_none());
        // And the rendering omits the empty sections rather than printing hollow headings.
        let markdown = render_markdown(&handoff);
        assert!(!markdown.contains("## Tests"));
        assert!(!markdown.contains("## Findings"));
    }

    #[test]
    fn a_failed_run_carries_its_real_failure_reason() {
        let mut failed = run("failed", None);
        failed.failure_reason = Some("cargo test exited 101".into());
        failed.exit_code = Some(101);
        let handoff = from_agent_run("p1", &failed, "Goal", "Task", None, None);
        assert_eq!(handoff.outcome, "failed");
        assert!(handoff
            .failures
            .iter()
            .any(|line| line.contains("cargo test exited 101")));
        assert!(handoff.failures.iter().any(|line| line.contains("101")));
    }

    #[test]
    fn findings_become_candidates_and_work_logs_do_not() {
        let handoff = from_agent_run(
            "p1",
            &run(
                "finished",
                Some(serde_json::json!({
                    "findings": ["Token invalidation was outside the transaction."],
                    "workCompleted": ["Edited three files.", "Ran the suite."],
                    "decisions": ["Refresh tokens rotate on use."]
                })),
            ),
            "Goal",
            "Fix token invalidation",
            None,
            None,
        );
        let candidates = candidates_from_handoff(&handoff);
        assert_eq!(candidates.len(), 2, "a work log is not durable knowledge");
        assert!(candidates.iter().any(|item| item.predicate == "finding"));
        let decision = candidates
            .iter()
            .find(|item| item.predicate == "decided")
            .expect("a recorded decision becomes a candidate");
        // Typed as a decision, which is high risk, which means it can only ever reach review.
        assert_eq!(decision.suggested_memory_type, "decision");
        assert_eq!(decision.origin, CandidateOrigin::Handoff);
        for candidate in &candidates {
            assert!(
                !candidate.evidence.is_empty(),
                "the touched files are the evidence"
            );
        }
    }

    #[test]
    fn a_credential_in_an_agents_own_output_never_reaches_the_handoff() {
        let handoff = from_agent_run(
            "p1",
            &run(
                "finished",
                Some(serde_json::json!({
                    "findings": ["Used api_key=sk-live-abcdefghijklmnopqrstuvwxyz012345 to reproduce."],
                    "summary": "Set AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIKbFAKEKEYbPxRfiCYEXAMPLEKEY"
                })),
            ),
            "Goal",
            "Task",
            None,
            None,
        );
        let rendered = render_markdown(&handoff);
        assert!(
            !rendered.contains("sk-live-abcdefghijklmnopqrstuvwxyz012345"),
            "a secret in an agent's narrative must not be persisted: {rendered}"
        );
        assert!(!rendered.contains("wJalrXUtnFEMIKbFAKEKEYbPxRfiCYEXAMPLEKEY"));
        // The finding itself is still recorded — redacted, not dropped, so the next agent still
        // learns what happened.
        assert_eq!(handoff.findings.len(), 1);
        assert!(handoff.findings[0].contains("to reproduce."));
    }

    #[test]
    fn a_string_blob_of_findings_is_read_as_a_list() {
        let handoff = from_agent_run(
            "p1",
            &run(
                "finished",
                Some(serde_json::json!({ "findings": "first line\nsecond line" })),
            ),
            "Goal",
            "Task",
            None,
            None,
        );
        assert_eq!(handoff.findings.len(), 2);
    }

    #[test]
    fn an_enormous_change_set_is_bounded_and_says_so() {
        let mut huge = run("finished", None);
        huge.files_changed = (0..500)
            .map(|index| format!("src/file{index}.rs"))
            .collect();
        let handoff = from_agent_run("p1", &huge, "Goal", "Task", None, None);
        assert_eq!(handoff.files_modified.len(), MAX_FILES);
        assert!(
            handoff.outcome.contains("500 files"),
            "truncation must be visible, not silent: {}",
            handoff.outcome
        );
    }
}

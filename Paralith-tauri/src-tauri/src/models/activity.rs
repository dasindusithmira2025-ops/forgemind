use serde::{Deserialize, Serialize};

/// Where an Activity Thread came from. Deliberately closed: Activity is a small operational
/// surface over Paralith's own work, not a generic event platform.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActivitySource {
    Agent,
    Github,
    System,
}

impl ActivitySource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Agent => "agent",
            Self::Github => "github",
            Self::System => "system",
        }
    }
}

/// The normalized Paralith state. GitHub's implementation-specific vocabulary
/// (`queued`/`in_progress`/`waiting`/`completed` crossed with
/// `success`/`failure`/`cancelled`/`skipped`) and the agent runtime's own states both collapse
/// into this. Raw provider detail survives on [`ActivityDetail`] for the expanded view; it is
/// never the primary product vocabulary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActivityState {
    Queued,
    Running,
    /// A human decision is required before anything else can happen.
    WaitingForUser,
    /// Work stopped for a reason outside the user's control and can resume (provider limit).
    Paused,
    /// Work stopped and needs the user to unblock it (authentication, permission).
    Blocked,
    Completed,
    Failed,
    Cancelled,
}

impl ActivityState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Running => "running",
            Self::WaitingForUser => "waiting_for_user",
            Self::Paused => "paused",
            Self::Blocked => "blocked",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }

    /// A settled outcome. Terminal threads never regress: a duplicate or out-of-order observation
    /// claiming a finished run is running again is dropped rather than applied.
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Cancelled)
    }

    /// Belongs in NEEDS YOU: nothing progresses until a human acts.
    pub fn needs_attention(self) -> bool {
        matches!(self, Self::WaitingForUser | Self::Blocked)
    }

    /// Counts toward the "work currently running" pulse.
    pub fn is_live(self) -> bool {
        matches!(self, Self::Queued | Self::Running)
    }
}

/// Why work stopped. Precise reasons exist so the UI never has to say "Task failed" about an
/// agent that simply ran out of provider quota with all of its work intact.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActivityInterruption {
    ProviderLimit,
    AuthenticationRequired,
    PermissionRequired,
    NetworkFailure,
    ProcessExit,
    DependencyFailure,
    UserCancelled,
    Unknown,
}

/// One stage inside a thread: a GitHub job, or a phase of a release ("Agent work", "Push").
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityStep {
    pub key: String,
    pub label: String,
    pub state: ActivityState,
}

/// A protected GitHub deployment waiting on review. `can_approve` reflects GitHub's own answer for
/// the authenticated identity: Paralith is another interface to the authorized operation, never a
/// way around the environment's protection rules.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityApproval {
    pub run_id: i64,
    pub environment: String,
    pub environment_ids: Vec<i64>,
    pub can_approve: bool,
    /// Set when the authenticated identity may not approve, so the UI explains the fallback
    /// instead of offering a control that GitHub will reject.
    pub restriction: Option<String>,
}

/// Provider-specific detail. Belongs behind progressive disclosure, not on the face of the card.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityDetail {
    pub workflow_path: Option<String>,
    pub branch: Option<String>,
    pub commit_sha: Option<String>,
    pub run_number: Option<i64>,
    pub attempt: Option<i64>,
    pub url: Option<String>,
    pub environment: Option<String>,
    pub event: Option<String>,
    pub provider: Option<String>,
    pub workspace_id: Option<String>,
    pub pane_id: Option<String>,
    pub terminal_session_id: Option<String>,
    /// Canonical Agent Work run behind a provider terminal, when this thread belongs to Agent
    /// Mode rather than an ordinary Code Mode session.
    pub agent_work_id: Option<String>,
}

/// One evolving unit of work. A release that runs an agent, commits, pushes, validates on GitHub,
/// waits for approval and publishes is *one* thread through its whole life, not eight
/// notifications.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityThread {
    /// Stable across the thread's life, derived from its origin (`github:{project}:{run}`,
    /// `agent:{workspace}:{pane}`). Identity is what keeps one card evolving instead of many.
    pub id: String,
    pub project_id: String,
    pub source: ActivitySource,
    pub title: String,
    pub summary: String,
    pub state: ActivityState,
    pub interruption: Option<ActivityInterruption>,
    /// Human sentence for a non-obvious state. Never a raw provider error.
    pub reason: Option<String>,
    pub steps: Vec<ActivityStep>,
    pub approval: Option<ActivityApproval>,
    #[serde(default)]
    pub detail: ActivityDetail,
    pub started_at: String,
    /// The source's own timestamp for the state, when it publishes one.
    pub updated_at: String,
    /// When Paralith observed this. Drives the out-of-order guard.
    pub observed_at: String,
    pub resolved_at: Option<String>,
    /// Increments only on a real change, so the UI can key transitions without diffing payloads.
    pub revision: i64,
}

impl ActivityThread {
    /// Everything a viewer can see. Timestamps and revision are excluded: a poll that observes an
    /// unchanged run must not look like a change, or the dock would animate on every tick.
    fn visible(&self) -> impl PartialEq + '_ {
        (
            &self.title,
            &self.summary,
            self.state,
            self.interruption,
            &self.reason,
            &self.steps,
            &self.approval,
            &self.detail,
        )
    }

    /// Fold a fresh observation into the known thread.
    ///
    /// Returns `None` when nothing a user could see changed: a duplicate event, a poll that found
    /// the same state, or an observation older than what is already known. The realtime channel is
    /// allowed to be lossy, duplicated and out of order; this is where that stops being the UI's
    /// problem.
    pub fn apply(&self, incoming: &ActivityThread) -> Option<ActivityThread> {
        if incoming.observed_at < self.observed_at {
            return None;
        }
        // A settled run stays settled. A late "running" for a completed run is stale by
        // definition, never a regression to display.
        let agent_work_waiting = incoming.state == ActivityState::WaitingForUser
            && incoming.detail.agent_work_id.is_some();
        if self.state.is_terminal() && !incoming.state.is_terminal() && !agent_work_waiting {
            return None;
        }
        if self.visible() == incoming.visible() {
            return None;
        }
        let resolved_at = if incoming.state.is_terminal() {
            self.resolved_at
                .clone()
                .or_else(|| Some(incoming.observed_at.clone()))
        } else {
            None
        };
        Some(ActivityThread {
            started_at: self.started_at.clone(),
            resolved_at,
            revision: self.revision + 1,
            ..incoming.clone()
        })
    }
}

/// Broadcast payload. One thread per event keeps the message small enough to send on every
/// transition without a payload budget.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityChangedEvent {
    pub thread: ActivityThread,
    /// True the first time Paralith has ever seen this thread, so the UI can distinguish
    /// "appeared" from "advanced".
    pub created: bool,
}

/// Normalize GitHub's run/job vocabulary. `conclusion` is only meaningful once `status` is
/// `completed`, which is exactly the trap that makes a naive mapping report success early.
pub fn github_state(status: &str, conclusion: Option<&str>) -> ActivityState {
    match status {
        "queued" | "requested" | "pending" => ActivityState::Queued,
        "in_progress" => ActivityState::Running,
        "waiting" | "action_required" => ActivityState::WaitingForUser,
        "completed" => match conclusion.unwrap_or_default() {
            "success" | "skipped" | "neutral" => ActivityState::Completed,
            "cancelled" => ActivityState::Cancelled,
            "action_required" => ActivityState::WaitingForUser,
            "" => ActivityState::Running,
            _ => ActivityState::Failed,
        },
        _ => ActivityState::Queued,
    }
}

/// Classify why an agent stopped, from the signal the terminal runtime already produces. The
/// distinction matters: a usage limit is a pause with the work preserved, not a failure.
pub fn agent_interruption(reason: &str) -> Option<ActivityInterruption> {
    let text = reason.to_ascii_lowercase();
    if text.contains("usage limit") || text.contains("rate limit") || text.contains("quota") {
        return Some(ActivityInterruption::ProviderLimit);
    }
    if text.contains("authenticat") || text.contains("log in") || text.contains("api key") {
        return Some(ActivityInterruption::AuthenticationRequired);
    }
    if text.contains("permission") {
        return Some(ActivityInterruption::PermissionRequired);
    }
    if text.contains("network") || text.contains("connection") {
        return Some(ActivityInterruption::NetworkFailure);
    }
    if text.contains("cancel") {
        return Some(ActivityInterruption::UserCancelled);
    }
    if text.contains("exit") {
        return Some(ActivityInterruption::ProcessExit);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn thread(state: ActivityState, observed_at: &str) -> ActivityThread {
        ActivityThread {
            id: "github:p:1".into(),
            project_id: "p".into(),
            source: ActivitySource::Github,
            title: "Stable 0.4.18".into(),
            summary: "Validating".into(),
            state,
            interruption: None,
            reason: None,
            steps: Vec::new(),
            approval: None,
            detail: ActivityDetail::default(),
            started_at: "2026-01-01T00:00:00Z".into(),
            updated_at: observed_at.into(),
            observed_at: observed_at.into(),
            resolved_at: None,
            revision: 1,
        }
    }

    #[test]
    fn duplicate_observation_produces_no_change() {
        let known = thread(ActivityState::Running, "2026-01-01T00:00:01Z");
        let repeat = thread(ActivityState::Running, "2026-01-01T00:00:05Z");
        assert!(known.apply(&repeat).is_none());
    }

    #[test]
    fn out_of_order_observation_is_dropped() {
        let known = thread(ActivityState::Completed, "2026-01-01T00:00:09Z");
        let late = thread(ActivityState::Running, "2026-01-01T00:00:02Z");
        assert!(known.apply(&late).is_none());
    }

    #[test]
    fn a_settled_thread_never_regresses_to_running() {
        let known = thread(ActivityState::Completed, "2026-01-01T00:00:01Z");
        let stale = thread(ActivityState::Running, "2026-01-01T00:00:30Z");
        assert!(known.apply(&stale).is_none());
    }

    #[test]
    fn advancing_preserves_start_and_stamps_resolution() {
        let known = thread(ActivityState::Running, "2026-01-01T00:00:01Z");
        let done = thread(ActivityState::Completed, "2026-01-01T00:00:30Z");
        let merged = known.apply(&done).expect("state change applies");
        assert_eq!(merged.state, ActivityState::Completed);
        assert_eq!(merged.started_at, known.started_at);
        assert_eq!(merged.resolved_at.as_deref(), Some("2026-01-01T00:00:30Z"));
        assert_eq!(merged.revision, known.revision + 1);
    }

    #[test]
    fn a_job_transition_alone_is_a_visible_change() {
        let mut known = thread(ActivityState::Running, "2026-01-01T00:00:01Z");
        known.steps = vec![ActivityStep {
            key: "1".into(),
            label: "macOS".into(),
            state: ActivityState::Running,
        }];
        let mut next = thread(ActivityState::Running, "2026-01-01T00:00:04Z");
        next.steps = vec![ActivityStep {
            key: "1".into(),
            label: "macOS".into(),
            state: ActivityState::Completed,
        }];
        assert!(known.apply(&next).is_some());
    }

    #[test]
    fn github_conclusion_is_ignored_until_the_run_completes() {
        assert_eq!(
            github_state("in_progress", Some("success")),
            ActivityState::Running
        );
        assert_eq!(
            github_state("completed", Some("success")),
            ActivityState::Completed
        );
        assert_eq!(
            github_state("completed", Some("failure")),
            ActivityState::Failed
        );
        assert_eq!(github_state("waiting", None), ActivityState::WaitingForUser);
        assert_eq!(github_state("completed", None), ActivityState::Running);
    }

    #[test]
    fn a_usage_limit_is_a_provider_limit_not_a_generic_failure() {
        assert_eq!(
            agent_interruption("Claude usage limit reached"),
            Some(ActivityInterruption::ProviderLimit)
        );
        assert_eq!(
            agent_interruption("terminal process exited with code 1"),
            Some(ActivityInterruption::ProcessExit)
        );
        assert_eq!(agent_interruption("agent output received"), None);
    }
}

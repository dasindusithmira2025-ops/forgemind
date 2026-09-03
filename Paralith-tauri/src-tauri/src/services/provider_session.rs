//! Following one provider process from launch to its real end.
//!
//! Both Agent Mode surfaces run a coding provider headlessly and then have to answer the same
//! question: *did that actually finish, and with what?* A conversation turn wants an answer; a
//! unit of engineering work wants a result and evidence. The observation, the timeout, the
//! cancellation check and the exit classification are identical, and getting any of them subtly
//! different between the two is exactly how one surface starts reporting a quota stop as a crash.
//!
//! So the loop lives here once. It owns no vocabulary of its own beyond what a provider process
//! can truthfully be observed to do; each caller maps [`ProviderOutcome`] into its own state
//! machine.

use crate::database::DatabaseService;
use crate::models::swarm::SwarmRuntimeKind;
use crate::services::agent_conversation::read_turn;
use crate::services::TerminalManager;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

/// How often a live session's output is drained. This exists only while a session is in flight,
/// so it is observation of a running process rather than presence polling.
const DRAIN_INTERVAL: Duration = Duration::from_millis(180);

/// What a provider process was observed to do. Deliberately not a product state: "the runtime hit
/// its quota" is a fact, and whether that means a paused conversation or paused engineering work
/// is the caller's decision.
#[derive(Debug, Clone, PartialEq)]
pub enum ProviderOutcome {
    /// Ran to completion and produced text.
    Completed,
    /// Ran to completion and produced nothing.
    Empty,
    /// Stopped because the account is out of quota. Never a failure.
    ProviderLimit,
    /// Stopped because the caller asked it to.
    Cancelled,
    /// Produced neither completion nor exit within the budget.
    Timeout,
    /// The process disappeared without a recorded exit.
    Lost,
    /// Exited without completing. Carries the shared provider failure classification.
    Failed(String),
}

pub struct FollowResult {
    /// Everything the provider said, as of the last observation.
    pub text: String,
    pub outcome: ProviderOutcome,
}

/// Follow `session_id` to its end, calling `on_progress` with the full text each time it grows.
///
/// `on_progress` is what makes a long run legible while it happens; it is called only on real
/// change, so a silent provider costs nothing.
pub fn follow(
    terminals: &TerminalManager,
    database: &DatabaseService,
    session_id: &str,
    runtime: SwarmRuntimeKind,
    cancel: &AtomicBool,
    timeout: Duration,
    mut on_progress: impl FnMut(&str),
) -> FollowResult {
    let started = Instant::now();
    let mut published = String::new();
    loop {
        if cancel.load(Ordering::SeqCst) {
            let _ = terminals.terminate_session(session_id);
            return FollowResult {
                text: published,
                outcome: ProviderOutcome::Cancelled,
            };
        }
        if started.elapsed() > timeout {
            let _ = terminals.terminate_session(session_id);
            return FollowResult {
                text: published,
                outcome: ProviderOutcome::Timeout,
            };
        }
        let live = terminals.session_status(session_id).ok();
        let output = match &live {
            Some(session) => session.output_tail.clone(),
            None => match database.get_terminal_session(session_id) {
                Ok(Some(session)) => session.output_tail,
                _ => {
                    return FollowResult {
                        text: published,
                        outcome: ProviderOutcome::Lost,
                    }
                }
            },
        };
        let mut reading = read_turn(runtime, &output);
        if reading.answer != published {
            published = std::mem::take(&mut reading.answer);
            on_progress(&published);
        }
        if live.is_none() {
            let exit_code = database
                .get_terminal_session(session_id)
                .ok()
                .flatten()
                .and_then(|session| session.exit_code);
            let outcome = if reading.provider_limit {
                ProviderOutcome::ProviderLimit
            } else if crate::agents::provider_session_succeeded(
                exit_code,
                reading.completed,
                reading.failed,
            ) {
                if published.trim().is_empty() {
                    ProviderOutcome::Empty
                } else {
                    ProviderOutcome::Completed
                }
            } else {
                ProviderOutcome::Failed(
                    crate::agents::provider_session_failure_code(
                        exit_code,
                        reading.completed,
                        reading.failed,
                    )
                    .unwrap_or("provider_exit")
                    .to_string(),
                )
            };
            return FollowResult {
                text: published,
                outcome,
            };
        }
        if reading.completed || reading.failed {
            // Codex `exec` keeps reading from an attached PTY after its terminal event. Closing
            // stdin lets it exit with its real status while the terminal manager continues to own
            // draining and reaping.
            let _ = terminals.close_input(session_id);
        }
        std::thread::sleep(DRAIN_INTERVAL);
    }
}

/// The human sentence for an outcome that is not a plain success. Kept beside the classification
/// so two surfaces cannot describe the same provider behaviour differently.
pub fn outcome_message(outcome: &ProviderOutcome) -> Option<String> {
    Some(match outcome {
        ProviderOutcome::Completed => return None,
        ProviderOutcome::Empty => "The runtime finished without producing anything.".into(),
        ProviderOutcome::ProviderLimit => {
            "This runtime reached its usage limit. Choose another connected runtime to continue."
                .into()
        }
        ProviderOutcome::Cancelled => "This was cancelled.".into(),
        ProviderOutcome::Timeout => "The runtime did not finish in time.".into(),
        ProviderOutcome::Lost => "The runtime process was lost.".into(),
        ProviderOutcome::Failed(code) => match code.as_str() {
            "provider_reported_failure" => "The runtime reported a failure.".into(),
            "completion_not_observed" => "The runtime exited before completing.".into(),
            _ => "The runtime exited with an error.".into(),
        },
    })
}

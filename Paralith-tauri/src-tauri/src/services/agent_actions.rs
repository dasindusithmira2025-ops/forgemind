//! The typed action vocabulary an Agent may use from an ordinary conversation.
//!
//! Before this, Atlas could only *describe* a handoff and the user had to reopen the Delegate
//! Work panel and retype it. This is what closes that gap without giving a language model a
//! wider surface than it should have.
//!
//! The mechanism is deliberately the small one. Paralith drives Claude Code and Codex as
//! one-shot CLI invocations, so there is no provider tool loop to hook and adding one would mean
//! a second execution stack per provider. Instead the turn's prompt states a contract, the reply
//! may end with one fenced `paralith-actions` block, and this module reads it back. What the
//! model produces is a *request*, never an effect:
//!
//! * The block is data. Parsing it grants nothing — every request is validated against the
//!   caller's real authority in [`crate::services::agent_conversation`] before anything happens.
//! * An unknown or malformed request is rejected with a reason and recorded, not silently
//!   dropped and not guessed at.
//! * The block never reaches the transcript. A user reads what their teammate said; the actions
//!   appear as the delegations and work rows they actually became.
//!
//! This is also why there is no `read_file`, `run_command` or `write` verb here. A conversation
//! is the control plane: it may organise work, and only work — which carries its own authority
//! record — may touch a repository.

use crate::errors::AppResult;
use crate::models::StartAgentWorkInput;
use serde::Deserialize;

/// The execution the conversation borrows to make an action real.
///
/// A conversation cannot own the work service: work already owns the conversation service, for
/// runtime resolution. Rather than merge the two or duplicate the spawn, the conversation is
/// handed this narrow view after both exist. It is deliberately two methods wide — the control
/// plane can start and stop work and nothing else.
pub trait AgentActionExecutor: Send + Sync {
    fn start_work(&self, input: StartAgentWorkInput) -> AppResult<String>;
    fn cancel_work(&self, work_id: &str) -> AppResult<()>;
}

/// The fence language that marks an action block. Distinct enough that a model quoting example
/// JSON in prose cannot trip it by accident.
const FENCE: &str = "paralith-actions";

/// One thing an Agent asked Paralith to do. A request only: existing in this list permits
/// nothing, and the roster and authority checks happen at execution.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum RequestedAction {
    /// Hand bounded work to another teammate. `to` names a teammate the way a human would — the
    /// executor resolves it against the roster rather than trusting an id the model invented.
    DelegateWork {
        to: String,
        objective: String,
        #[serde(default)]
        context: String,
        #[serde(default)]
        constraints: String,
        #[serde(default, alias = "expected_result")]
        expected_result: String,
        /// Start the work now. A delegation without this is recorded as an intention and waits,
        /// which is the honest representation of "plan it but do not run it yet".
        #[serde(default = "yes")]
        execute: bool,
    },
    /// Stop work this Agent owns. Ownership is checked at execution; naming another Agent's work
    /// here does not reach it.
    CancelWork {
        #[serde(alias = "work_id")]
        work_id: String,
    },
}

fn yes() -> bool {
    true
}

/// A request that will not be attempted, and why. Kept rather than discarded so the user sees
/// that their teammate tried to do something and what stopped it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RejectedAction {
    pub summary: String,
    pub reason: String,
}

#[derive(Debug, Default)]
pub struct ParsedTurn {
    /// The reply with every action block removed. This is what the transcript shows.
    pub body: String,
    pub actions: Vec<RequestedAction>,
    pub rejected: Vec<RejectedAction>,
}

/// Split a completed reply into what the user reads and what the Agent asked for.
///
/// Every block is consumed, not just the first: a model that emits one fence per delegation is
/// following the contract as sensibly as one that emits a single array, and only accepting the
/// first would silently lose the second teammate's work.
pub fn parse_turn(text: &str) -> ParsedTurn {
    let mut parsed = ParsedTurn::default();
    let mut body = String::with_capacity(text.len());
    let mut cursor = 0;
    while let Some(found) = find_block(&text[cursor..]) {
        body.push_str(&text[cursor..cursor + found.open]);
        read_block(&text[cursor + found.start..cursor + found.end], &mut parsed);
        cursor += found.after;
    }
    body.push_str(&text[cursor..]);
    parsed.body = body.trim().to_string();
    parsed
}

struct FoundBlock {
    /// Byte offset of the opening backticks.
    open: usize,
    /// Byte range of the block's contents.
    start: usize,
    end: usize,
    /// Byte offset just past the closing backticks.
    after: usize,
}

/// Locate the next ` ```paralith-actions ` fence, skipping over ordinary code blocks on the way.
///
/// An unterminated fence yields nothing, which leaves it in the body: truncating a reply at a
/// fence that never closed would hide the answer as well as the intent.
fn find_block(text: &str) -> Option<FoundBlock> {
    let mut cursor = 0;
    while let Some(relative) = text[cursor..].find("```") {
        let open = cursor + relative;
        let language_start = open + 3;
        let language_end = language_start + text[language_start..].find('\n')?;
        let start = language_end + 1;
        let end = start + text[start..].find("```")?;
        if text[language_start..language_end].trim() == FENCE {
            return Some(FoundBlock {
                open,
                start,
                end,
                after: end + 3,
            });
        }
        cursor = end + 3;
    }
    None
}

/// Read one block's contents. A block that is not usable JSON is reported as one rejection
/// rather than as several imaginary actions.
fn read_block(block: &str, parsed: &mut ParsedTurn) {
    let trimmed = block.trim();
    if trimmed.is_empty() {
        return;
    }
    let value: serde_json::Value = match serde_json::from_str(trimmed) {
        Ok(value) => value,
        Err(error) => {
            parsed.rejected.push(RejectedAction {
                summary: "Unreadable action block".into(),
                reason: format!("The action block was not valid JSON: {error}"),
            });
            return;
        }
    };
    // Both shapes are accepted because both are the obvious thing to write: a bare array, or an
    // object with an `actions` key. Rejecting one on style would only cost a retry.
    let items = match &value {
        serde_json::Value::Array(items) => items.clone(),
        serde_json::Value::Object(map) => match map.get("actions") {
            Some(serde_json::Value::Array(items)) => items.clone(),
            // A single action object written without a wrapper.
            _ if map.contains_key("action") => vec![value.clone()],
            _ => {
                parsed.rejected.push(RejectedAction {
                    summary: "Empty action block".into(),
                    reason: "The action block contained no actions.".into(),
                });
                return;
            }
        },
        _ => {
            parsed.rejected.push(RejectedAction {
                summary: "Unreadable action block".into(),
                reason: "The action block was not a list of actions.".into(),
            });
            return;
        }
    };
    for item in items {
        let label = item
            .get("action")
            .and_then(|value| value.as_str())
            .unwrap_or("unnamed")
            .to_string();
        match serde_json::from_value::<RequestedAction>(item) {
            Ok(action) => parsed.actions.push(action),
            Err(error) => parsed.rejected.push(RejectedAction {
                summary: format!("Unsupported action `{label}`"),
                reason: error.to_string(),
            }),
        }
    }
}

/// The contract stated in the prompt, appended only when the Agent can actually act.
///
/// It names the exact verbs and — just as importantly — what a conversation may never do, so a
/// capable runtime spends the turn organising work rather than attempting an edit it would be
/// denied anyway.
pub fn action_contract(teammates: &[String], can_delegate: bool) -> String {
    if !can_delegate || teammates.is_empty() {
        return String::new();
    }
    format!(
        "\n## Acting on this team\n\
         You can hand bounded work to a teammate yourself. To do it, end your reply with one fenced block:\n\n\
         ```{FENCE}\n\
         {{\"actions\":[{{\"action\":\"delegate_work\",\"to\":\"<teammate name>\",\"objective\":\"<one bounded outcome>\",\"context\":\"<what they need to know>\",\"constraints\":\"<limits, e.g. do not commit or push>\",\"expectedResult\":\"<what you want back>\"}}]}}\n\
         ```\n\n\
         Rules:\n\
         - Only these teammates exist: {}. Never invent one.\n\
         - One action per teammate per outcome. Split work that belongs to different people.\n\
         - Carry the user's limits into `constraints` verbatim. If they said not to push, write that.\n\
         - Add `\"execute\": false` when the user asked you to plan the handoff but not start it.\n\
         - `{{\"action\":\"cancel_work\",\"workId\":\"<id>\"}}` stops work you delegated.\n\
         - Write the block only when you are actually delegating. Say what you are doing in your reply as well; the block itself is never shown.\n\
         - You cannot edit files, run commands or use Git in this conversation. Delegating is how work happens.\n",
        teammates.join(", ")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_delegation_block_is_read_and_removed_from_the_reply() {
        let parsed = parse_turn(
            "I'll put Forge on it.\n\n```paralith-actions\n{\"actions\":[{\"action\":\"delegate_work\",\"to\":\"Forge\",\"objective\":\"Repair the composer\",\"constraints\":\"do not push\"}]}\n```\n",
        );
        assert_eq!(parsed.body, "I'll put Forge on it.");
        assert_eq!(parsed.actions.len(), 1);
        assert!(parsed.rejected.is_empty());
        match &parsed.actions[0] {
            RequestedAction::DelegateWork {
                to,
                objective,
                constraints,
                execute,
                ..
            } => {
                assert_eq!(to, "Forge");
                assert_eq!(objective, "Repair the composer");
                assert_eq!(constraints, "do not push");
                // Absent `execute` means the handoff is real, which is what a user asking for
                // work expects. Planning without running is the explicit case.
                assert!(execute);
            }
            other => panic!("unexpected action {other:?}"),
        }
    }

    #[test]
    fn several_teammates_in_one_turn_each_become_an_action() {
        let parsed = parse_turn(
            "Splitting this.\n```paralith-actions\n[{\"action\":\"delegate_work\",\"to\":\"Forge\",\"objective\":\"Implement\"},{\"action\":\"delegate_work\",\"to\":\"Mira\",\"objective\":\"Review\"}]\n```",
        );
        assert_eq!(parsed.actions.len(), 2);
        assert_eq!(parsed.body, "Splitting this.");
    }

    #[test]
    fn a_second_block_is_not_lost() {
        let parsed = parse_turn(
            "One.\n```paralith-actions\n{\"action\":\"delegate_work\",\"to\":\"Forge\",\"objective\":\"A\"}\n```\nTwo.\n```paralith-actions\n{\"action\":\"delegate_work\",\"to\":\"Mira\",\"objective\":\"B\"}\n```",
        );
        assert_eq!(parsed.actions.len(), 2);
        assert_eq!(parsed.body, "One.\n\nTwo.");
    }

    #[test]
    fn an_ordinary_code_block_is_left_alone() {
        let text = "Here:\n```rust\nfn main() {}\n```\nDone.";
        let parsed = parse_turn(text);
        assert!(parsed.actions.is_empty());
        assert_eq!(parsed.body, text);
    }

    #[test]
    fn a_malformed_block_is_reported_not_guessed_at() {
        let parsed = parse_turn("Trying.\n```paralith-actions\n{not json\n```");
        assert!(parsed.actions.is_empty());
        assert_eq!(parsed.rejected.len(), 1);
        assert_eq!(parsed.body, "Trying.");
    }

    #[test]
    fn an_invented_verb_is_rejected_and_the_rest_of_the_block_still_runs() {
        let parsed = parse_turn(
            "```paralith-actions\n[{\"action\":\"run_command\",\"command\":\"rm -rf /\"},{\"action\":\"delegate_work\",\"to\":\"Forge\",\"objective\":\"Fix\"}]\n```",
        );
        assert_eq!(parsed.actions.len(), 1);
        assert_eq!(parsed.rejected.len(), 1);
        assert!(parsed.rejected[0].summary.contains("run_command"));
    }

    #[test]
    fn an_unterminated_block_leaves_the_reply_readable() {
        let text = "I'll delegate.\n```paralith-actions\n{\"action\":\"delegate_work\"";
        let parsed = parse_turn(text);
        assert!(parsed.actions.is_empty());
        assert_eq!(parsed.body, text.trim());
    }

    #[test]
    fn the_contract_is_absent_when_there_is_nobody_to_delegate_to() {
        assert!(action_contract(&[], true).is_empty());
        assert!(action_contract(&["Forge".into()], false).is_empty());
        assert!(action_contract(&["Forge".into()], true).contains("Forge"));
    }
}

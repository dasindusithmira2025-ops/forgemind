//! Provider-neutral agent invocation.
//!
//! The Run Engine and the Swarm engine both need to turn "run this model, in this directory,
//! with this prompt, with these write permissions" into a provider-native argument vector.
//! Neither engine may know Claude's or Codex's command-line grammar, so that knowledge lives
//! here once and both call [`provider_arguments`].

use crate::models::AgentProvider;

/// Everything a provider CLI needs, expressed without reference to Swarm, Run, or any other
/// orchestration domain.
#[derive(Debug, Clone)]
pub struct AgentInvocation {
    pub provider: AgentProvider,
    pub model_id: String,
    pub reasoning_effort: String,
    /// Whether this execution may modify repository files. Read-only roles get a deny-by-default
    /// permission mode and lose every direct write/delegation tool.
    pub may_write: bool,
    /// Case-preserving working directory the provider is launched in. For Codex this is also
    /// passed as `--cd` because its sandbox root is an explicit option.
    pub working_directory: String,
    /// Fully composed instruction. Callers own prompt construction; this module never invents
    /// domain text.
    pub prompt: String,
    pub resume_session_id: Option<String>,
}

/// Local verification commands a non-interactive session may run without an approval prompt.
/// Kept deliberately narrow: a headless agent cannot answer a permission dialog, so anything
/// outside this list is denied rather than silently auto-approved.
const ALLOWED_VERIFICATION_TOOLS: &str = "Bash(npm test*),Bash(npm run test*),Bash(node --test*),Bash(cargo test*),Bash(cargo check*),Bash(pnpm test*),Bash(yarn test*),Bash(bun test*),Bash(pytest*),Bash(go test*),Bash(dotnet test*),PowerShell(npm test*),PowerShell(npm run test*),PowerShell(node --test*),PowerShell(cargo test*),PowerShell(cargo check*),PowerShell(pnpm test*),PowerShell(yarn test*),PowerShell(bun test*),PowerShell(pytest*),PowerShell(go test*),PowerShell(dotnet test*)";

/// Build the provider-native argument vector for one headless, structured-output agent run.
/// Returns an empty vector for providers that are shells rather than coding agents; callers
/// gate on that rather than launching a shell as if it were an agent.
pub fn provider_arguments(invocation: &AgentInvocation) -> Vec<String> {
    match invocation.provider {
        AgentProvider::Claude => claude_arguments(invocation),
        AgentProvider::Codex => codex_arguments(invocation),
        _ => Vec::new(),
    }
}

fn claude_arguments(invocation: &AgentInvocation) -> Vec<String> {
    let permission_mode = if invocation.may_write {
        "acceptEdits"
    } else {
        // `plan` mode is interactive: it refuses verification commands and writes a plan file,
        // which is the opposite of a headless read-only role. `dontAsk` denies everything not
        // explicitly allowlisted below.
        "dontAsk"
    };
    let mut arguments = vec![
        "--print".into(),
        "--model".into(),
        invocation.model_id.clone(),
        "--effort".into(),
        invocation.reasoning_effort.clone(),
        "--verbose".into(),
        "--output-format".into(),
        "stream-json".into(),
        // `--allowedTools` is variadic in Claude's CLI. Keep the positional prompt before that
        // option or the parser consumes the prompt as another tool pattern and exits with
        // `Input must be provided`.
        invocation.prompt.clone(),
        "--permission-mode".into(),
        permission_mode.into(),
    ];
    if let Some(session_id) = invocation.resume_session_id.as_deref() {
        arguments.extend(["--resume".into(), session_id.to_string()]);
    }
    arguments.extend(["--allowedTools".into(), ALLOWED_VERIFICATION_TOOLS.into()]);
    if !invocation.may_write {
        arguments.extend([
            "--disallowedTools".into(),
            "Edit,Write,NotebookEdit,Task,EnterWorktree,ExitWorktree".into(),
        ]);
    }
    arguments
}

fn codex_arguments(invocation: &AgentInvocation) -> Vec<String> {
    let sandbox = if invocation.may_write {
        "workspace-write"
    } else {
        "read-only"
    };
    // Approval, sandbox and working-directory controls are top-level Codex options. Placing them
    // after `exec` is rejected by current CLIs before a thread can start.
    let mut arguments = vec![
        "--model".into(),
        invocation.model_id.clone(),
        "-c".into(),
        format!("model_reasoning_effort=\"{}\"", invocation.reasoning_effort),
        "--ask-for-approval".into(),
        "never".into(),
        "--sandbox".into(),
        sandbox.into(),
        "--cd".into(),
        invocation.working_directory.clone(),
        "exec".into(),
    ];
    match invocation.resume_session_id.as_deref() {
        Some(session_id) => arguments.extend([
            "resume".into(),
            "--json".into(),
            "--skip-git-repo-check".into(),
            session_id.to_string(),
            invocation.prompt.clone(),
        ]),
        None => arguments.extend([
            "--json".into(),
            "--skip-git-repo-check".into(),
            invocation.prompt.clone(),
        ]),
    }
    arguments
}

/// Exit statuses that describe *Paralith's own teardown* of a provider session rather than a
/// provider failure.
///
/// Both supervising engines close a session's stdin once the provider has emitted its terminal
/// event, because Codex `exec` keeps reading from an attached PTY afterwards and would otherwise
/// never exit. On Windows ConPTY delivers that close to the child as `STATUS_CONTROL_C_EXIT`
/// (`0xC000013A`), and on Unix an interrupted read surfaces as 130/143. Reading those codes as a
/// provider failure means the host blames the provider for something the host did.
pub fn is_host_teardown_exit(exit_code: Option<i32>) -> bool {
    matches!(exit_code, Some(-1_073_741_510) | Some(130) | Some(143))
}

/// The completion gate every engine that supervises a provider session shares.
///
/// A clean process exit is never sufficient: only the provider's own explicit terminal event may
/// satisfy it. An exit status may still *veto* that event — a provider that reported success and
/// then died with a real error has not succeeded — except when the status is the host's own
/// teardown, which carries no information about the work.
pub fn provider_session_succeeded(
    exit_code: Option<i32>,
    provider_completed: bool,
    provider_failed: bool,
) -> bool {
    provider_completed
        && !provider_failed
        && (exit_code == Some(0) || is_host_teardown_exit(exit_code))
}

/// Machine-readable reason a provider session did not satisfy the completion gate, or `None`
/// when it did. Ordered so the most specific cause wins.
pub fn provider_session_failure_code(
    exit_code: Option<i32>,
    provider_completed: bool,
    provider_failed: bool,
) -> Option<&'static str> {
    if provider_failed {
        Some("provider_reported_failure")
    } else if !provider_completed {
        Some("completion_not_observed")
    } else if exit_code != Some(0) && !is_host_teardown_exit(exit_code) {
        Some("provider_exit")
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn invocation(provider: AgentProvider, may_write: bool) -> AgentInvocation {
        AgentInvocation {
            provider,
            model_id: "model-x".into(),
            reasoning_effort: "high".into(),
            may_write,
            working_directory: "C:/repo".into(),
            prompt: "do the work".into(),
            resume_session_id: None,
        }
    }

    fn option_value(arguments: &[String], option: &str) -> Option<String> {
        arguments
            .windows(2)
            .find(|pair| pair[0] == option)
            .map(|pair| pair[1].clone())
    }

    #[test]
    fn a_writing_claude_run_accepts_edits_and_keeps_write_tools() {
        let arguments = provider_arguments(&invocation(AgentProvider::Claude, true));
        assert_eq!(
            option_value(&arguments, "--permission-mode").as_deref(),
            Some("acceptEdits")
        );
        assert!(!arguments.iter().any(|value| value == "--disallowedTools"));
    }

    #[test]
    fn a_read_only_claude_run_denies_unlisted_commands_and_write_tools() {
        let arguments = provider_arguments(&invocation(AgentProvider::Claude, false));
        assert_eq!(
            option_value(&arguments, "--permission-mode").as_deref(),
            Some("dontAsk")
        );
        let denied = option_value(&arguments, "--disallowedTools")
            .expect("read-only runs must deny write tools");
        assert!(denied.contains("Write"));
    }

    #[test]
    fn the_claude_prompt_precedes_the_variadic_allowed_tools_option() {
        let arguments = provider_arguments(&invocation(AgentProvider::Claude, true));
        let prompt = arguments
            .iter()
            .position(|value| value == "do the work")
            .expect("prompt is passed positionally");
        let allowed = arguments
            .iter()
            .position(|value| value == "--allowedTools")
            .expect("verification allowlist is always passed");
        assert!(prompt < allowed);
    }

    #[test]
    fn a_read_only_codex_run_uses_the_read_only_sandbox_rooted_at_its_working_directory() {
        let arguments = provider_arguments(&invocation(AgentProvider::Codex, false));
        assert_eq!(
            option_value(&arguments, "--sandbox").as_deref(),
            Some("read-only")
        );
        assert_eq!(option_value(&arguments, "--cd").as_deref(), Some("C:/repo"));
        // Sandbox and approval controls must precede the `exec` subcommand.
        let exec = arguments.iter().position(|value| value == "exec").unwrap();
        let sandbox = arguments
            .iter()
            .position(|value| value == "--sandbox")
            .unwrap();
        assert!(sandbox < exec);
    }

    #[test]
    fn resuming_a_codex_session_passes_the_provider_session_id_to_the_resume_subcommand() {
        let mut request = invocation(AgentProvider::Codex, true);
        request.resume_session_id = Some("thread-9".into());
        let arguments = provider_arguments(&request);
        let resume = arguments
            .iter()
            .position(|value| value == "resume")
            .unwrap();
        assert!(arguments[resume..].iter().any(|value| value == "thread-9"));
    }

    #[test]
    fn a_shell_provider_produces_no_agent_arguments() {
        assert!(provider_arguments(&invocation(AgentProvider::Powershell, true)).is_empty());
    }

    #[test]
    fn an_explicit_completion_survives_the_hosts_own_stdin_close() {
        // Regression: after closing stdin so Codex can exit, ConPTY reports STATUS_CONTROL_C_EXIT.
        // Treating that as a provider failure made every real Codex session fail on Windows even
        // though it had already reported `turn.completed`.
        assert!(provider_session_succeeded(
            Some(-1_073_741_510),
            true,
            false
        ));
        assert!(provider_session_succeeded(Some(130), true, false));
        assert!(provider_session_succeeded(Some(0), true, false));
        assert_eq!(
            provider_session_failure_code(Some(-1_073_741_510), true, false),
            None
        );
    }

    #[test]
    fn a_real_nonzero_exit_still_vetoes_a_reported_completion() {
        assert!(!provider_session_succeeded(Some(1), true, false));
        assert_eq!(
            provider_session_failure_code(Some(1), true, false),
            Some("provider_exit")
        );
    }

    #[test]
    fn a_clean_exit_without_an_observed_completion_is_never_success() {
        assert!(!provider_session_succeeded(Some(0), false, false));
        assert_eq!(
            provider_session_failure_code(Some(0), false, false),
            Some("completion_not_observed")
        );
    }

    #[test]
    fn a_reported_failure_outranks_everything_else() {
        assert!(!provider_session_succeeded(Some(0), true, true));
        assert_eq!(
            provider_session_failure_code(Some(0), true, true),
            Some("provider_reported_failure")
        );
    }
}

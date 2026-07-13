use crate::errors::{AppError, AppResult};
use crate::models::AgentProvider;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct AgentLaunchSpec {
    pub executable: PathBuf,
    pub arguments: Vec<String>,
    pub working_directory: PathBuf,
    pub environment_overrides: Vec<(String, String)>,
    pub display_name: String,
}

pub trait AgentAdapter: Send + Sync {
    fn provider_id(&self) -> AgentProvider;
    fn launch_spec(
        &self,
        executable_path: &Path,
        working_directory: &Path,
        arguments: &[String],
    ) -> AppResult<AgentLaunchSpec>;
}

/// Wrap Windows script shims so a ConPTY can launch them. PowerShell is used for
/// `.cmd`/`.bat` shims too: passing an embedded quoted command through Rust's normal
/// `Command` argument encoder makes `cmd.exe` treat the quotes as literal characters when
/// the shim lives below a path containing spaces. A single PowerShell command string keeps
/// the script path and every argument unambiguous without involving a second command parser.
fn wrap_script_shim(executable: PathBuf, arguments: Vec<String>) -> (PathBuf, Vec<String>) {
    #[cfg(windows)]
    {
        let extension = executable
            .extension()
            .and_then(|value| value.to_str())
            .map(str::to_ascii_lowercase);
        match extension.as_deref() {
            Some("ps1") => {
                let shell = which::which("pwsh")
                    .or_else(|_| which::which("powershell"))
                    .unwrap_or_else(|_| PathBuf::from("powershell.exe"));
                let mut wrapped = vec![
                    "-NoLogo".to_string(),
                    "-ExecutionPolicy".to_string(),
                    "Bypass".to_string(),
                    "-File".to_string(),
                    executable.to_string_lossy().into_owned(),
                ];
                wrapped.extend(arguments);
                return (shell, wrapped);
            }
            Some("cmd") | Some("bat") => {
                let shell = which::which("pwsh")
                    .or_else(|_| which::which("powershell"))
                    .unwrap_or_else(|_| PathBuf::from("powershell.exe"));
                let mut command = format!(
                    "& {}",
                    quote_powershell_literal(&executable.to_string_lossy())
                );
                for argument in arguments {
                    command.push(' ');
                    command.push_str(&quote_powershell_literal(&argument));
                }
                let wrapped = vec![
                    "-NoLogo".to_string(),
                    "-NoProfile".to_string(),
                    "-ExecutionPolicy".to_string(),
                    "Bypass".to_string(),
                    "-Command".to_string(),
                    command,
                ];
                return (shell, wrapped);
            }
            _ => {}
        }
    }
    (executable, arguments)
}

#[cfg(windows)]
fn quote_powershell_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

pub struct ProviderAdapter(pub AgentProvider);

impl AgentAdapter for ProviderAdapter {
    fn provider_id(&self) -> AgentProvider {
        self.0.clone()
    }

    fn launch_spec(
        &self,
        executable_path: &Path,
        working_directory: &Path,
        arguments: &[String],
    ) -> AppResult<AgentLaunchSpec> {
        if !executable_path.is_file() {
            return Err(AppError::new(
                "executable_not_found",
                "The assigned executable no longer exists.",
                true,
            )
            .entity(executable_path.display().to_string()));
        }
        if !working_directory.is_dir() {
            return Err(AppError::new(
                "invalid_working_directory",
                "The assigned working directory is unavailable.",
                true,
            )
            .entity(working_directory.display().to_string()));
        }
        let display_name = match self.0 {
            AgentProvider::Claude => "Claude Code",
            AgentProvider::Codex => "Codex CLI",
            AgentProvider::Opencode => "OpenCode",
            AgentProvider::Powershell => "PowerShell",
            AgentProvider::CommandPrompt => "Command Prompt",
            AgentProvider::Wsl => "WSL",
            AgentProvider::CustomShell => "Custom shell",
        }
        .into();
        // A pseudo-terminal spawns the target through `CreateProcessW`, which can only run
        // real executables. CLI agents installed via npm/pipx are commonly `.ps1`/`.cmd`/`.bat`
        // shims (e.g. `opencode.ps1`), and launching one directly fails with "%1 is not a valid
        // Win32 application" (os error 193). Route those through their interpreter instead.
        let (executable, arguments) =
            wrap_script_shim(executable_path.to_path_buf(), arguments.to_vec());
        Ok(AgentLaunchSpec {
            executable,
            arguments,
            working_directory: working_directory.to_path_buf(),
            environment_overrides: Vec::new(),
            display_name,
        })
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn powershell_shim_is_launched_through_powershell() {
        let (executable, arguments) = wrap_script_shim(
            PathBuf::from("C:\\Users\\dev\\AppData\\Roaming\\npm\\opencode.ps1"),
            vec!["--flag".into()],
        );
        assert!(executable
            .file_stem()
            .and_then(|value| value.to_str())
            .is_some_and(
                |stem| stem.eq_ignore_ascii_case("pwsh") || stem.eq_ignore_ascii_case("powershell")
            ));
        assert_eq!(arguments.first().map(String::as_str), Some("-NoLogo"));
        assert!(arguments.iter().any(|arg| arg == "-File"));
        assert!(arguments.iter().any(|arg| arg.ends_with("opencode.ps1")));
        assert_eq!(arguments.last().map(String::as_str), Some("--flag"));
    }

    #[test]
    fn cmd_shim_is_launched_through_a_quote_safe_shell() {
        let (executable, arguments) = wrap_script_shim(
            PathBuf::from("C:\\Users\\dev\\AppData\\Roaming\\npm\\claude.cmd"),
            vec![],
        );
        assert!(executable
            .file_stem()
            .and_then(|value| value.to_str())
            .is_some_and(
                |stem| stem.eq_ignore_ascii_case("pwsh") || stem.eq_ignore_ascii_case("powershell")
            ));
        assert!(arguments.iter().any(|arg| arg == "-Command"));
        assert!(arguments.iter().any(|arg| arg.contains("claude.cmd")));
    }

    #[test]
    fn cmd_shim_path_with_spaces_is_quoted_as_one_command() {
        let directory =
            std::env::temp_dir().join(format!("forgemind shim {}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let shim = directory.join("fixture.cmd");
        std::fs::write(&shim, "@echo FORGEMIND_SHIM_OK\r\n").unwrap();
        let (executable, arguments) = wrap_script_shim(shim, Vec::new());
        let output = std::process::Command::new(executable)
            .args(arguments)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "stdout={:?} stderr={:?}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(String::from_utf8_lossy(&output.stdout).contains("FORGEMIND_SHIM_OK"));
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn real_executables_pass_through_untouched() {
        let original = PathBuf::from("C:\\Users\\dev\\.local\\bin\\claude.exe");
        let (executable, arguments) = wrap_script_shim(original.clone(), vec!["--version".into()]);
        assert_eq!(executable, original);
        assert_eq!(arguments, vec!["--version".to_string()]);
    }
}

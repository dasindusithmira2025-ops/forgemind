use crate::errors::{AppError, AppResult};
use crate::models::{AgentDetectionResult, AgentProvider, ShellProfile};
use crate::services::process_util::background_command;
use chrono::Utc;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::thread;
use std::time::{Duration, Instant};
use wait_timeout::ChildExt;

const DETECTION_TIMEOUT: Duration = Duration::from_secs(3);
const CACHE_TTL: Duration = Duration::from_secs(20);
const OUTPUT_LIMIT: usize = 8 * 1024;

pub struct AgentDetector {
    cache: Mutex<HashMap<AgentProvider, (Instant, AgentDetectionResult)>>,
}

impl Default for AgentDetector {
    fn default() -> Self {
        Self {
            cache: Mutex::new(HashMap::new()),
        }
    }
}

impl AgentDetector {
    pub fn detect_all(
        &self,
        force: bool,
        custom_paths: &HashMap<AgentProvider, String>,
    ) -> Vec<AgentDetectionResult> {
        let providers = [
            AgentProvider::Claude,
            AgentProvider::Codex,
            AgentProvider::Opencode,
        ];
        // Version probes are independent and each has its own timeout. Running them serially
        // made one unhealthy installation delay workspace setup by up to nine seconds.
        thread::scope(|scope| {
            let handles = providers
                .into_iter()
                .map(|provider| {
                    let fallback = provider.clone();
                    let custom_path = custom_paths.get(&provider).cloned();
                    let handle =
                        scope.spawn(move || self.detect(provider, custom_path.as_deref(), force));
                    (fallback, handle)
                })
                .collect::<Vec<_>>();
            handles
                .into_iter()
                .map(|(provider, handle)| {
                    handle.join().unwrap_or_else(|_| {
                        unavailable(
                            provider,
                            "detection_worker_failed",
                            "The agent version probe stopped unexpectedly.",
                        )
                    })
                })
                .collect()
        })
    }

    pub fn detect(
        &self,
        provider: AgentProvider,
        custom_path: Option<&str>,
        force: bool,
    ) -> AgentDetectionResult {
        if !force && custom_path.is_none() {
            if let Some((when, result)) = self.cache.lock().get(&provider) {
                if when.elapsed() < CACHE_TTL {
                    return result.clone();
                }
            }
        }
        let executable_name = match provider {
            AgentProvider::Claude => "claude",
            AgentProvider::Codex => "codex",
            AgentProvider::Opencode => "opencode",
            _ => {
                return unavailable(
                    provider,
                    "unsupported_provider",
                    "Only coding agents use version detection.",
                )
            }
        };
        let executable =
            match custom_path {
                Some(path) => {
                    let path = PathBuf::from(path);
                    if !path.is_file() {
                        return unavailable(
                            provider,
                            "path_invalid",
                            "The custom executable path is not a file.",
                        );
                    }
                    if is_blocked_windows_alias(&path) {
                        return unavailable(
                        provider,
                        "windows_alias_blocked",
                        "The selected WindowsApps execution alias is not a launchable executable.",
                    );
                    }
                    path
                }
                None => match which::which(executable_name) {
                    Ok(path) if !is_blocked_windows_alias(&path) => path,
                    Ok(_) => return unavailable(
                        provider,
                        "windows_alias_blocked",
                        "Only a WindowsApps execution alias was found; locate the real executable.",
                    ),
                    Err(_) => {
                        return unavailable(
                            provider,
                            "executable_not_found",
                            "The executable was not found on PATH.",
                        )
                    }
                },
            };
        let result = run_version(provider.clone(), &executable, DETECTION_TIMEOUT);
        if custom_path.is_none() {
            self.cache
                .lock()
                .insert(provider, (Instant::now(), result.clone()));
        }
        result
    }

    pub fn detect_shells(&self) -> Vec<ShellProfile> {
        let mut profiles = Vec::new();
        if let Ok(path) = which::which("pwsh") {
            if !is_blocked_windows_alias(&path) {
                profiles.push(profile("PowerShell", path, vec!["-NoLogo".into()]));
            }
        }
        #[cfg(windows)]
        {
            if profiles.iter().all(|profile| profile.name != "PowerShell") {
                let path =
                    PathBuf::from(std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".into()))
                        .join("System32")
                        .join("WindowsPowerShell")
                        .join("v1.0")
                        .join("powershell.exe");
                if path.is_file() {
                    profiles.push(profile("Windows PowerShell", path, vec!["-NoLogo".into()]));
                }
            }
            let cmd = PathBuf::from(
                std::env::var("COMSPEC")
                    .unwrap_or_else(|_| "C:\\Windows\\System32\\cmd.exe".into()),
            );
            if cmd.is_file() {
                profiles.push(profile("Command Prompt", cmd, vec![]));
            }
            if let Ok(wsl) = which::which("wsl.exe") {
                let distributions = wsl_distributions(&wsl);
                if distributions.is_empty() {
                    profiles.push(profile("WSL", wsl.clone(), vec![]));
                }
                for distribution in distributions {
                    profiles.push(profile(
                        &format!("WSL: {distribution}"),
                        wsl.clone(),
                        vec!["--distribution".into(), distribution],
                    ));
                }
            }
        }
        #[cfg(not(windows))]
        {
            let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
            let path = PathBuf::from(shell);
            if path.is_file() {
                profiles.push(profile(
                    path.file_name()
                        .and_then(|value| value.to_str())
                        .unwrap_or("Shell"),
                    path.clone(),
                    vec![],
                ));
            }
        }
        profiles
    }

    pub fn validate_custom_executable(&self, path: &str) -> AppResult<String> {
        let path = Path::new(path);
        if !path.is_file() {
            return Err(AppError::new(
                "executable_not_found",
                "The selected executable does not exist.",
                true,
            )
            .entity(path.display().to_string()));
        }
        if is_blocked_windows_alias(path) {
            return Err(AppError::new(
                "windows_alias_blocked",
                "The selected WindowsApps execution alias cannot be used as a terminal executable.",
                true,
            )
            .action("Locate the real installed executable instead.")
            .layer("provider"));
        }
        let canonical = std::fs::canonicalize(path).map_err(|error| {
            AppError::new(
                "executable_not_launchable",
                "The selected executable could not be resolved.",
                true,
            )
            .detail(error.to_string())
        })?;
        Ok(canonical.to_string_lossy().to_string())
    }
}

fn is_blocked_windows_alias(path: &Path) -> bool {
    #[cfg(windows)]
    {
        let normalized = path.to_string_lossy().replace('/', "\\").to_lowercase();
        normalized.contains("\\microsoft\\windowsapps\\")
            || path
                .metadata()
                .map(|metadata| metadata.len() == 0)
                .unwrap_or(true)
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        false
    }
}

fn profile(name: &str, executable_path: PathBuf, args: Vec<String>) -> ShellProfile {
    let executable_path = executable_path.to_string_lossy().to_string();
    ShellProfile {
        id: stable_profile_id(name, &executable_path, &args),
        name: name.into(),
        executable_path,
        args,
        available: true,
        source: "detected".into(),
    }
}

fn stable_profile_id(name: &str, executable_path: &str, args: &[String]) -> String {
    // FNV-1a gives detected shells a compact identity that survives rescans and restarts.
    // The settings UI stores this ID, so generating a random UUID here made the selected
    // default shell impossible to resolve on the next launch.
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in name
        .bytes()
        .chain([0])
        .chain(executable_path.bytes())
        .chain([0])
        .chain(args.iter().flat_map(|arg| arg.bytes().chain([0])))
    {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("detected-{hash:016x}")
}

fn wsl_distributions(wsl: &Path) -> Vec<String> {
    // Hidden probe: a plain spawn from the GUI-subsystem app pops a visible console window.
    let mut child = match background_command(wsl)
        .args(["--list", "--quiet"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(child) => child,
        Err(_) => return Vec::new(),
    };
    let success = match child.wait_timeout(DETECTION_TIMEOUT) {
        Ok(Some(status)) => status.success(),
        Ok(None) => {
            let _ = child.kill();
            let _ = child.wait();
            false
        }
        Err(_) => false,
    };
    if !success {
        return Vec::new();
    }
    let mut bytes = Vec::new();
    if let Some(stdout) = child.stdout.take() {
        let _ = stdout.take(OUTPUT_LIMIT as u64).read_to_end(&mut bytes);
    }
    let decoded = decode_wsl_output(&bytes);
    decoded
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_owned)
        .collect()
}

fn decode_wsl_output(bytes: &[u8]) -> String {
    let looks_utf16 = bytes.starts_with(&[0xff, 0xfe])
        || bytes.iter().filter(|byte| **byte == 0).count() > bytes.len() / 4;
    if looks_utf16 {
        let start = usize::from(bytes.starts_with(&[0xff, 0xfe])) * 2;
        let words: Vec<u16> = bytes[start..]
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        String::from_utf16_lossy(&words)
    } else {
        String::from_utf8_lossy(bytes).into_owned()
    }
}

fn run_version(
    provider: AgentProvider,
    executable: &Path,
    timeout: Duration,
) -> AgentDetectionResult {
    run_detection_command(provider, executable, &["--version"], timeout)
}

fn run_detection_command(
    provider: AgentProvider,
    executable: &Path,
    arguments: &[&str],
    timeout: Duration,
) -> AgentDetectionResult {
    let now = Utc::now().to_rfc3339();
    // Hidden probe: version checks run in parallel on workspace load; visible console
    // windows here were one source of the "PARALITH opens external terminals" reports.
    let mut child = match background_command(executable)
        .args(arguments)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(error) => {
            return AgentDetectionResult {
                provider,
                available: false,
                executable_path: Some(executable.to_string_lossy().to_string()),
                version: None,
                error_code: Some("executable_not_launchable".into()),
                error_message: Some(error.to_string()),
                detected_at: now,
            }
        }
    };
    match child.wait_timeout(timeout) {
        Ok(Some(status)) => {
            let mut bytes = Vec::new();
            if let Some(stdout) = child.stdout.take() {
                let _ = stdout.take(OUTPUT_LIMIT as u64).read_to_end(&mut bytes);
            }
            if let Some(stderr) = child.stderr.take() {
                let _ = stderr
                    .take(OUTPUT_LIMIT.saturating_sub(bytes.len()) as u64)
                    .read_to_end(&mut bytes);
            }
            let output = String::from_utf8_lossy(&bytes).trim().to_owned();
            if status.success() {
                AgentDetectionResult {
                    provider,
                    available: true,
                    executable_path: Some(executable.to_string_lossy().to_string()),
                    version: (!output.is_empty()).then_some(parse_version(&output)),
                    error_code: None,
                    error_message: None,
                    detected_at: now,
                }
            } else {
                AgentDetectionResult {
                    provider,
                    available: false,
                    executable_path: Some(executable.to_string_lossy().to_string()),
                    version: None,
                    error_code: Some("detection_failed".into()),
                    error_message: Some(format!(
                        "Version command exited with {status}: {}",
                        bounded(&output)
                    )),
                    detected_at: now,
                }
            }
        }
        Ok(None) => {
            let _ = child.kill();
            let _ = child.wait();
            AgentDetectionResult {
                provider,
                available: false,
                executable_path: Some(executable.to_string_lossy().to_string()),
                version: None,
                error_code: Some("agent_detection_timeout".into()),
                error_message: Some("Version detection exceeded three seconds.".into()),
                detected_at: now,
            }
        }
        Err(error) => AgentDetectionResult {
            provider,
            available: false,
            executable_path: Some(executable.to_string_lossy().to_string()),
            version: None,
            error_code: Some("detection_failed".into()),
            error_message: Some(error.to_string()),
            detected_at: now,
        },
    }
}

fn parse_version(output: &str) -> String {
    bounded(
        output
            .lines()
            .find(|line| !line.trim().is_empty())
            .unwrap_or(output)
            .trim(),
    )
}
fn bounded(value: &str) -> String {
    value.chars().take(512).collect()
}
fn unavailable(provider: AgentProvider, code: &str, message: &str) -> AgentDetectionResult {
    AgentDetectionResult {
        provider,
        available: false,
        executable_path: None,
        version: None,
        error_code: Some(code.into()),
        error_message: Some(message.into()),
        detected_at: Utc::now().to_rfc3339(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detected_shell_ids_are_stable_and_distinguish_arguments() {
        let path = PathBuf::from("shell.exe");
        let first = profile("WSL: Ubuntu", path.clone(), vec!["Ubuntu".into()]);
        let repeated = profile("WSL: Ubuntu", path.clone(), vec!["Ubuntu".into()]);
        let other = profile("WSL: Debian", path, vec!["Debian".into()]);
        assert_eq!(first.id, repeated.id);
        assert_ne!(first.id, other.id);
    }

    #[test]
    fn version_parser_is_bounded_and_uses_first_line() {
        assert_eq!(parse_version("claude 2.1.0\nmore"), "claude 2.1.0");
        assert_eq!(parse_version("codex-cli 1.2.3"), "codex-cli 1.2.3");
        assert_eq!(
            parse_version("opencode version 0.9"),
            "opencode version 0.9"
        );
    }

    #[test]
    fn invalid_custom_path_is_rejected() {
        assert_eq!(
            AgentDetector::default()
                .validate_custom_executable("definitely-missing-forgemind-bin")
                .unwrap_err()
                .code,
            "executable_not_found"
        );
    }

    #[test]
    fn missing_executable_is_unavailable() {
        let result = AgentDetector::default().detect(
            AgentProvider::Claude,
            Some("definitely-missing-forgemind-bin"),
            true,
        );
        assert!(!result.available);
        assert_eq!(result.error_code.as_deref(), Some("path_invalid"));
    }

    #[test]
    fn wsl_utf16_output_is_normalized() {
        let bytes: Vec<u8> = "Ubuntu-24.04\r\n"
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect();
        assert_eq!(decode_wsl_output(&bytes).trim(), "Ubuntu-24.04");
    }

    #[test]
    fn detection_handles_non_zero_exit_and_timeout() {
        #[cfg(windows)]
        let (shell, failure_args, timeout_args): (PathBuf, Vec<&str>, Vec<&str>) = (
            PathBuf::from(
                std::env::var("COMSPEC")
                    .unwrap_or_else(|_| "C:\\Windows\\System32\\cmd.exe".into()),
            ),
            vec!["/C", "exit 7"],
            vec!["/C", "ping -n 3 127.0.0.1 > nul"],
        );
        #[cfg(not(windows))]
        let (shell, failure_args, timeout_args): (PathBuf, Vec<&str>, Vec<&str>) = (
            PathBuf::from("/bin/sh"),
            vec!["-c", "exit 7"],
            vec!["-c", "sleep 2"],
        );
        let failure = run_detection_command(
            AgentProvider::Codex,
            &shell,
            &failure_args,
            Duration::from_secs(1),
        );
        assert_eq!(failure.error_code.as_deref(), Some("detection_failed"));
        let timeout = run_detection_command(
            AgentProvider::Codex,
            &shell,
            &timeout_args,
            Duration::from_millis(80),
        );
        assert_eq!(
            timeout.error_code.as_deref(),
            Some("agent_detection_timeout")
        );
    }
}

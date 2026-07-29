use crate::errors::{AppError, AppResult};
use crate::models::Project;
use crate::services::process_util::background_command;
use chrono::Utc;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use uuid::Uuid;

pub struct ProjectService;

impl ProjectService {
    pub fn inspect(path: &str) -> AppResult<Project> {
        let requested = Path::new(path);
        if !requested.exists() {
            return Err(AppError::new(
                "project_not_found",
                "The selected project folder does not exist.",
                true,
            )
            .entity(path));
        }
        if !requested.is_dir() {
            return Err(AppError::new(
                "invalid_project_path",
                "Select a folder, not a file.",
                true,
            )
            .entity(path));
        }
        let canonical = std::fs::canonicalize(requested).map_err(|error| {
            AppError::new(
                "invalid_project_path",
                "PARALITH could not resolve this folder.",
                true,
            )
            .detail(error.to_string())
            .entity(path)
        })?;
        let canonical_display = display_path(&canonical);
        let canonical_key = if cfg!(windows) {
            canonical_display.to_lowercase()
        } else {
            canonical_display.clone()
        };
        let name = canonical
            .file_name()
            .and_then(|value| value.to_str())
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("Project")
            .to_owned();
        let package_json = canonical.join("package.json").is_file();
        let lockfiles = [
            ("pnpm-lock.yaml", "pnpm"),
            ("yarn.lock", "yarn"),
            ("bun.lockb", "bun"),
            ("bun.lock", "bun"),
            ("package-lock.json", "npm"),
        ];
        let package_manager = lockfiles
            .iter()
            .find(|(file, _)| canonical.join(file).is_file())
            .map(|(_, manager)| (*manager).to_owned());
        let git_dir = canonical.join(".git");
        let is_git_repository = git_dir.exists();
        let git_branch = is_git_repository.then(|| git_branch(&canonical)).flatten();
        let framework = detect_framework(&canonical, package_json);
        let languages = detect_languages(&canonical);
        let now = Utc::now().to_rfc3339();
        Ok(Project {
            id: Uuid::new_v4().to_string(),
            name,
            root_path: canonical_display,
            canonical_root_path: canonical_key,
            git_branch,
            detected_framework: framework,
            package_manager,
            major_languages: languages,
            is_git_repository,
            has_package_json: package_json,
            has_lockfile: lockfiles
                .iter()
                .any(|(file, _)| canonical.join(file).is_file()),
            created_at: now.clone(),
            updated_at: now.clone(),
            last_opened_at: now,
        })
    }

    pub fn validate_working_directory(
        project_root: &str,
        working_directory: &str,
        allow_external: bool,
    ) -> AppResult<String> {
        let root = canonical_dir(Path::new(project_root), "invalid_project_path")?;
        let working = canonical_dir(Path::new(working_directory), "invalid_working_directory")?;
        if !allow_external && !path_starts_with(&working, &root) {
            return Err(AppError::new(
                "invalid_working_directory",
                "The terminal working directory must remain inside the project folder.",
                true,
            )
            .entity(working_directory));
        }
        Ok(display_path(&working))
    }
}

pub(crate) fn display_path(path: &Path) -> String {
    let value = path.to_string_lossy();
    if cfg!(windows) {
        if let Some(unc) = value.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{unc}");
        }
        if let Some(local) = value.strip_prefix(r"\\?\") {
            return local.to_owned();
        }
    }
    value.into_owned()
}

fn canonical_dir(path: &Path, code: &str) -> AppResult<PathBuf> {
    if !path.is_dir() {
        return Err(AppError::new(
            code,
            "The selected working directory is not available.",
            true,
        )
        .entity(path.display().to_string()));
    }
    std::fs::canonicalize(path).map_err(|error| {
        AppError::new(code, "The selected directory could not be resolved.", true)
            .detail(error.to_string())
    })
}

fn path_starts_with(child: &Path, parent: &Path) -> bool {
    if cfg!(windows) {
        let child = child.to_string_lossy().to_lowercase();
        let parent = parent
            .to_string_lossy()
            .to_lowercase()
            .trim_end_matches(['\\', '/'])
            .to_owned();
        child == parent
            || child
                .strip_prefix(&parent)
                .is_some_and(|remainder| remainder.starts_with('\\') || remainder.starts_with('/'))
    } else {
        child.starts_with(parent)
    }
}

fn git_branch(root: &Path) -> Option<String> {
    // Hidden helper: a plain spawn from the GUI-subsystem app flashes a console window
    // every time a Project is opened or refreshed.
    background_command("git")
        .args(["-C", &root.to_string_lossy(), "branch", "--show-current"])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn detect_framework(root: &Path, has_package_json: bool) -> Option<String> {
    if root.join("src-tauri").is_dir() {
        return Some("Tauri".into());
    }
    if root.join("Cargo.toml").is_file() {
        return Some("Rust".into());
    }
    if root.join("pyproject.toml").is_file() {
        return Some("Python".into());
    }
    if has_package_json {
        if let Ok(text) = std::fs::read_to_string(root.join("package.json")) {
            let lowered = text.to_lowercase();
            for (needle, name) in [
                ("\"next\"", "Next.js"),
                ("\"@angular/core\"", "Angular"),
                ("\"svelte\"", "Svelte"),
                ("\"vue\"", "Vue"),
                ("\"react\"", "React"),
            ] {
                if lowered.contains(needle) {
                    return Some(name.into());
                }
            }
        }
        return Some("Node.js".into());
    }
    None
}

fn detect_languages(root: &Path) -> Vec<String> {
    let mut counts: HashMap<&'static str, usize> = HashMap::new();
    let mut stack = vec![(root.to_path_buf(), 0usize)];
    let mut scanned = 0usize;
    while let Some((directory, depth)) = stack.pop() {
        if depth > 3 || scanned > 2_000 {
            continue;
        }
        let Ok(entries) = std::fs::read_dir(directory) else {
            continue;
        };
        for entry in entries.flatten() {
            scanned += 1;
            let path = entry.path();
            let name = path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("");
            if path.is_dir() {
                if !matches!(
                    name,
                    ".git" | "node_modules" | "target" | "dist" | "build" | ".next"
                ) {
                    stack.push((path, depth + 1));
                }
                continue;
            }
            let language = match path
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("")
                .to_ascii_lowercase()
                .as_str()
            {
                "rs" => Some("Rust"),
                "ts" | "tsx" => Some("TypeScript"),
                "js" | "jsx" => Some("JavaScript"),
                "py" => Some("Python"),
                "go" => Some("Go"),
                "java" => Some("Java"),
                "cs" => Some("C#"),
                "cpp" | "cc" | "cxx" | "c" | "h" => Some("C/C++"),
                "swift" => Some("Swift"),
                "kt" | "kts" => Some("Kotlin"),
                _ => None,
            };
            if let Some(language) = language {
                *counts.entry(language).or_default() += 1;
            }
        }
    }
    let mut languages: Vec<_> = counts.into_iter().collect();
    languages.sort_by_key(|(_, count)| std::cmp::Reverse(*count));
    languages
        .into_iter()
        .take(4)
        .map(|(language, _)| language.to_owned())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn valid_missing_and_file_paths() {
        let root = std::env::temp_dir().join(format!("forgemind-project-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        fs::write(
            root.join("package.json"),
            "{\"dependencies\":{\"react\":\"1\"}}",
        )
        .unwrap();
        assert_eq!(
            ProjectService::inspect(&root.to_string_lossy())
                .unwrap()
                .detected_framework
                .as_deref(),
            Some("React")
        );
        assert_eq!(
            ProjectService::inspect(&root.join("missing").to_string_lossy())
                .unwrap_err()
                .code,
            "project_not_found"
        );
        assert_eq!(
            ProjectService::inspect(&root.join("package.json").to_string_lossy())
                .unwrap_err()
                .code,
            "invalid_project_path"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn working_directory_is_safe_for_windows_child_processes() {
        let root = std::env::temp_dir().join(format!("paralith-working-dir-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let validated = ProjectService::validate_working_directory(
            &root.to_string_lossy(),
            &root.to_string_lossy(),
            false,
        )
        .unwrap();
        if cfg!(windows) {
            assert!(!validated.starts_with(r"\\?\"));
        }
        assert!(Path::new(&validated).is_dir());
        fs::remove_dir_all(root).unwrap();
    }
}

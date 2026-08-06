//! Project-scoped filesystem access for the Code surface.
//!
//! Every read and write is mediated by [`ProjectPathGuard`], which resolves a caller-supplied
//! Project-relative path to a canonical absolute path and refuses anything that escapes the
//! Project root — including `..` traversal, absolute paths, and symbolic links that point
//! outside the root. Writes are atomic (temp file in the same directory, then rename) and can
//! be guarded by the SHA-256 of the version the caller last saw, so a concurrent external or
//! agent edit is reported instead of silently overwritten.
//!
//! This service deliberately does not know about editor tabs, diffs, or agent attribution;
//! those are separate concerns layered on top of a trustworthy filesystem boundary.

use crate::database::DatabaseService;
use crate::errors::{AppError, AppResult};
use crate::models::{
    DirectoryEntry, DirectoryListing, FileContents, FileEncoding, FileKind, FileWriteResult,
    FsEntryInfo, FsPath, LineEnding, ProjectFileIndex,
};
use parking_lot::Mutex;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant, UNIX_EPOCH};
use uuid::Uuid;

/// Largest file PARALITH will decode into the editor or accept for a text write. Larger files
/// are reported with a typed `file_too_large` error; they remain visible in the Explorer.
pub const MAX_TEXT_FILE_BYTES: u64 = 5_000_000;

/// Largest previewable media file (image or PDF) PARALITH will hand to the editor's preview.
/// Media bytes are never decoded — they cross the IPC boundary once and are rendered by the
/// webview — so the cap is far more generous than the text limit but still bounded.
pub const MAX_MEDIA_FILE_BYTES: u64 = 48 * 1024 * 1024;

/// Extension → MIME type for the file kinds the editor can preview. The MIME type is decided by
/// the extension alone and never by sniffing content, so a file cannot talk the webview into
/// treating it as a more powerful type than its name claims.
const PREVIEWABLE_MEDIA: &[(&str, &str)] = &[
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("gif", "image/gif"),
    ("webp", "image/webp"),
    ("avif", "image/avif"),
    ("bmp", "image/bmp"),
    ("ico", "image/x-icon"),
    ("svg", "image/svg+xml"),
    ("pdf", "application/pdf"),
];

/// Largest number of entries returned for a single directory listing. Beyond this the listing
/// is flagged `truncated` so the UI can prompt for a filter rather than freezing on a
/// generated or vendored directory with tens of thousands of files.
pub const MAX_DIRECTORY_ENTRIES: usize = 5_000;

/// Bytes inspected when deciding whether a file is binary.
const BINARY_SNIFF_BYTES: usize = 8_192;

/// Upper bound on the number of files returned for Quick Open indexing.
pub const MAX_INDEXED_FILES: usize = 20_000;

/// Directories never descended into during Quick Open indexing: version-control internals and
/// well-known dependency/build output that would otherwise dominate the index and slow the walk.
const NON_SOURCE_DIRECTORIES: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    "out",
    ".next",
    ".turbo",
    ".cache",
    "coverage",
    ".venv",
    "venv",
    "__pycache__",
    ".idea",
    ".gradle",
    "vendor",
    ".svn",
    ".hg",
];

/// How long a PARALITH-originated write is remembered so the file watcher can distinguish it
/// from an external/agent edit and avoid an event feedback loop.
const SELF_WRITE_TTL: Duration = Duration::from_secs(2);

/// Records the paths PARALITH itself just wrote so the [`FileWatchService`] can suppress the
/// resulting filesystem events instead of echoing the editor's own saves back to it. Shared by
/// reference between the write path and the watcher.
#[derive(Clone, Default)]
pub struct SelfWriteLedger {
    entries: Arc<Mutex<HashMap<PathBuf, Instant>>>,
}

impl SelfWriteLedger {
    pub fn mark(&self, path: &Path) {
        self.entries
            .lock()
            .insert(path.to_path_buf(), Instant::now());
    }

    /// Returns whether `path` was written by PARALITH within [`SELF_WRITE_TTL`], pruning expired
    /// entries as a side effect so the ledger cannot grow without bound.
    pub fn recently_written(&self, path: &Path) -> bool {
        let now = Instant::now();
        let mut entries = self.entries.lock();
        entries.retain(|_, marked| now.duration_since(*marked) < SELF_WRITE_TTL);
        entries.contains_key(path)
    }
}

#[derive(Clone)]
pub struct FileSystemService {
    database: Arc<DatabaseService>,
    ledger: SelfWriteLedger,
}

impl FileSystemService {
    pub fn new(database: Arc<DatabaseService>, ledger: SelfWriteLedger) -> Self {
        Self { database, ledger }
    }

    fn guard(&self, project_id: &str) -> AppResult<ProjectPathGuard> {
        let project = self.database.get_project(project_id)?;
        ProjectPathGuard::new(Path::new(&project.root_path))
    }

    pub fn list_directory(
        &self,
        project_id: &str,
        relative_path: &str,
    ) -> AppResult<DirectoryListing> {
        let guard = self.guard(project_id)?;
        let (normalized, dir) = guard.resolve_existing(relative_path)?;
        if !dir.is_dir() {
            return Err(AppError::new(
                "not_a_directory",
                "This path is a file, not a folder.",
                true,
            )
            .entity(relative_path)
            .layer("filesystem"));
        }
        let reader = fs::read_dir(&dir).map_err(|error| map_io("list", relative_path, error))?;
        let mut entries = Vec::new();
        let mut total = 0usize;
        let mut truncated = false;
        for entry in reader {
            let Ok(entry) = entry else { continue };
            total += 1;
            if entries.len() >= MAX_DIRECTORY_ENTRIES {
                truncated = true;
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            let symlink_meta = entry.path().symlink_metadata().ok();
            let is_symlink = symlink_meta
                .as_ref()
                .map(|meta| meta.file_type().is_symlink())
                .unwrap_or(false);
            // `metadata()` follows links; a broken link yields an error and is surfaced as such
            // rather than dropped, so the user can see (and delete) it.
            let (kind, size, modified_ms, symlink_broken, readonly) = match entry.metadata() {
                Ok(meta) => {
                    let kind = if meta.is_dir() {
                        FileKind::Directory
                    } else {
                        FileKind::File
                    };
                    (
                        kind,
                        meta.len(),
                        modified_ms(&meta),
                        false,
                        meta.permissions().readonly(),
                    )
                }
                Err(_) => (FileKind::Symlink, 0, None, is_symlink, true),
            };
            let rel = join_relative(&normalized, &name);
            entries.push(DirectoryEntry {
                is_hidden: name.starts_with('.'),
                name,
                relative_path: rel,
                kind,
                size,
                modified_ms,
                is_symlink,
                symlink_broken,
                readonly,
            });
        }
        entries.sort_by(|a, b| {
            let a_dir = a.kind == FileKind::Directory;
            let b_dir = b.kind == FileKind::Directory;
            b_dir
                .cmp(&a_dir)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        Ok(DirectoryListing {
            project_id: project_id.to_owned(),
            relative_path: normalized,
            entries,
            truncated,
            total_entries: total,
        })
    }

    pub fn read_file(&self, project_id: &str, relative_path: &str) -> AppResult<FileContents> {
        let guard = self.guard(project_id)?;
        let (normalized, path) = guard.resolve_existing(relative_path)?;
        let meta = fs::metadata(&path).map_err(|error| map_io("read", relative_path, error))?;
        if meta.is_dir() {
            return Err(not_a_file(relative_path));
        }
        let readonly = meta.permissions().readonly();
        let media_type = media_type_for(&normalized);
        if meta.len() > MAX_TEXT_FILE_BYTES {
            // An image or PDF is previewed, not decoded, so being past the text limit is not a
            // reason to refuse it. Return the metadata the preview needs and let the caller pull
            // the bytes through `read_media` instead of loading them here.
            if media_type.is_some() && meta.len() <= MAX_MEDIA_FILE_BYTES {
                return Ok(FileContents {
                    project_id: project_id.to_owned(),
                    relative_path: normalized,
                    content: None,
                    sha256: hash_file(&path, relative_path)?,
                    size: meta.len(),
                    encoding: FileEncoding::Binary,
                    line_ending: LineEnding::None,
                    binary: true,
                    media_type: media_type.map(str::to_owned),
                    readonly,
                });
            }
            return Err(file_too_large(relative_path, meta.len()));
        }
        let bytes = fs::read(&path).map_err(|error| map_io("read", relative_path, error))?;
        let sha256 = hex_sha256(&bytes);
        let size = bytes.len() as u64;
        if is_binary(&bytes) {
            return Ok(FileContents {
                project_id: project_id.to_owned(),
                relative_path: normalized,
                content: None,
                sha256,
                size,
                encoding: FileEncoding::Binary,
                line_ending: LineEnding::None,
                binary: true,
                media_type: media_type.map(str::to_owned),
                readonly,
            });
        }
        let (content, encoding) = decode_text(&bytes, relative_path)?;
        let line_ending = detect_line_ending(&content);
        Ok(FileContents {
            project_id: project_id.to_owned(),
            relative_path: normalized,
            content: Some(content),
            sha256,
            size,
            encoding,
            line_ending,
            binary: false,
            // Text media (an SVG) keeps its editable content; the editor offers a preview of it
            // alongside the source rather than instead of it.
            media_type: media_type.map(str::to_owned),
            readonly,
        })
    }

    /// Raw bytes of a previewable media file, for the editor's image/PDF preview. Nothing is
    /// decoded: the caller renders the bytes with the MIME type reported by [`Self::read_file`],
    /// which is derived from the extension. Anything that is not a previewable media extension is
    /// refused so this path cannot be used as a general "read any file as bytes" escape hatch.
    pub fn read_media(&self, project_id: &str, relative_path: &str) -> AppResult<Vec<u8>> {
        let guard = self.guard(project_id)?;
        read_media_bytes(&guard, relative_path)
    }

    /// Atomically write `content` to `relative_path`, creating the file if its parent directory
    /// already exists. When `expected_sha256` is supplied it must match the current on-disk
    /// bytes, otherwise the write is refused with `file_changed_since_read` and the caller can
    /// present a conflict resolution flow instead of losing the concurrent change.
    pub fn write_file(
        &self,
        project_id: &str,
        relative_path: &str,
        content: &str,
        expected_sha256: Option<&str>,
    ) -> AppResult<FileWriteResult> {
        if content.len() as u64 > MAX_TEXT_FILE_BYTES {
            return Err(file_too_large(relative_path, content.len() as u64));
        }
        let guard = self.guard(project_id)?;
        let (normalized, path) = match guard.resolve_existing(relative_path) {
            Ok(resolved) => resolved,
            Err(error) if error.code == "file_not_found" => guard.resolve_new(relative_path)?,
            Err(error) => return Err(error),
        };
        if path.is_dir() {
            return Err(AppError::new(
                "not_a_file",
                "This path is a folder and cannot be written as a file.",
                true,
            )
            .entity(relative_path)
            .layer("filesystem"));
        }
        if let Some(expected) = expected_sha256 {
            let current = match fs::read(&path) {
                Ok(bytes) => Some(hex_sha256(&bytes)),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
                Err(error) => return Err(map_io("read", relative_path, error)),
            };
            let matches = match &current {
                Some(hash) => hash == expected,
                None => expected.is_empty(),
            };
            if !matches {
                return Err(AppError::new(
                    "file_changed_since_read",
                    "This file changed on disk since it was opened. Review the incoming change before overwriting it.",
                    true,
                )
                .entity(relative_path)
                .detail(current.unwrap_or_default())
                .layer("filesystem"));
            }
        }
        let bytes = content.as_bytes();
        atomic_write(&path, bytes)?;
        self.ledger.mark(&path);
        let sha256 = hex_sha256(bytes);
        let modified_ms = fs::metadata(&path).ok().and_then(|meta| modified_ms(&meta));
        Ok(FileWriteResult {
            project_id: project_id.to_owned(),
            relative_path: normalized,
            sha256,
            size: bytes.len() as u64,
            modified_ms,
        })
    }

    pub fn create_file(&self, project_id: &str, relative_path: &str) -> AppResult<FsEntryInfo> {
        let guard = self.guard(project_id)?;
        let (normalized, path) = guard.resolve_new(relative_path)?;
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                return Err(already_exists(relative_path));
            }
            Err(error) => return Err(map_io("create", relative_path, error)),
        }
        self.ledger.mark(&path);
        entry_info(project_id, &normalized, &path)
    }

    pub fn create_directory(
        &self,
        project_id: &str,
        relative_path: &str,
    ) -> AppResult<FsEntryInfo> {
        let guard = self.guard(project_id)?;
        let (normalized, path) = guard.resolve_new(relative_path)?;
        match fs::create_dir(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                return Err(already_exists(relative_path));
            }
            Err(error) => return Err(map_io("create", relative_path, error)),
        }
        self.ledger.mark(&path);
        entry_info(project_id, &normalized, &path)
    }

    /// Rename or move an entry. Both endpoints are validated inside the Project root and the
    /// destination must not already exist, so a move never clobbers an unrelated file.
    pub fn rename_entry(&self, project_id: &str, from: &str, to: &str) -> AppResult<FsEntryInfo> {
        let guard = self.guard(project_id)?;
        let (_, source) = guard.resolve_existing(from)?;
        let (normalized_to, target) = guard.resolve_new(to)?;
        if target.exists() {
            return Err(already_exists(to));
        }
        fs::rename(&source, &target).map_err(|error| map_io("rename", to, error))?;
        self.ledger.mark(&source);
        self.ledger.mark(&target);
        entry_info(project_id, &normalized_to, &target)
    }

    pub fn copy_entry(&self, project_id: &str, from: &str, to: &str) -> AppResult<FsEntryInfo> {
        let guard = self.guard(project_id)?;
        let (_, source) = guard.resolve_existing(from)?;
        let (normalized_to, target) = guard.resolve_new(to)?;
        if target.exists() {
            return Err(already_exists(to));
        }
        if source.is_dir() {
            copy_directory(&source, &target).map_err(|error| map_io("copy", to, error))?;
        } else {
            fs::copy(&source, &target).map_err(|error| map_io("copy", to, error))?;
        }
        self.ledger.mark(&target);
        entry_info(project_id, &normalized_to, &target)
    }

    /// Delete a file or directory. Non-empty directories are only removed when `recursive` is
    /// set, so an accidental delete of a populated folder fails loudly instead of wiping it.
    pub fn delete_entry(
        &self,
        project_id: &str,
        relative_path: &str,
        recursive: bool,
    ) -> AppResult<FsPath> {
        let guard = self.guard(project_id)?;
        let (normalized, path) = guard.resolve_existing(relative_path)?;
        // Record the delete before it happens so the watcher treats the removal as PARALITH's
        // own action rather than an external change that should be reported back to the editor.
        self.ledger.mark(&path);
        let meta =
            fs::symlink_metadata(&path).map_err(|error| map_io("delete", relative_path, error))?;
        if meta.is_dir() {
            let result = if recursive {
                fs::remove_dir_all(&path)
            } else {
                fs::remove_dir(&path)
            };
            result.map_err(|error| {
                if is_directory_not_empty_error(&error) {
                    AppError::new(
                        "directory_not_empty",
                        "This folder is not empty. Confirm a recursive delete to remove it.",
                        true,
                    )
                    .entity(relative_path)
                    .layer("filesystem")
                } else {
                    map_io("delete", relative_path, error)
                }
            })?;
        } else {
            fs::remove_file(&path).map_err(|error| map_io("delete", relative_path, error))?;
        }
        Ok(FsPath {
            project_id: project_id.to_owned(),
            relative_path: normalized,
        })
    }

    /// Bounded, single-pass index of the Project's source files for Quick Open. Descends the tree
    /// iteratively (no recursion depth risk), prunes version-control and dependency/build
    /// directories, skips symlinked directories to avoid cycles, and excludes binary/generated
    /// files. The walk stops once `limit` files are collected and reports `truncated` so the UI
    /// can prompt for a narrower search on very large repositories.
    pub fn search_project_files(
        &self,
        project_id: &str,
        limit: Option<usize>,
    ) -> AppResult<ProjectFileIndex> {
        let guard = self.guard(project_id)?;
        let (_, root) = guard.resolve_existing("")?;
        let cap = limit.unwrap_or(MAX_INDEXED_FILES).min(MAX_INDEXED_FILES);
        let mut files = Vec::new();
        let mut truncated = false;
        let mut stack = vec![root.clone()];
        'walk: while let Some(dir) = stack.pop() {
            let Ok(reader) = fs::read_dir(&dir) else {
                continue;
            };
            for entry in reader {
                let Ok(entry) = entry else { continue };
                let Ok(file_type) = entry.file_type() else {
                    continue;
                };
                let name = entry.file_name().to_string_lossy().into_owned();
                if file_type.is_dir() {
                    if file_type.is_symlink() || NON_SOURCE_DIRECTORIES.contains(&name.as_str()) {
                        continue;
                    }
                    stack.push(entry.path());
                } else if file_type.is_file() && is_indexable_file(&name) {
                    if files.len() >= cap {
                        truncated = true;
                        break 'walk;
                    }
                    if let Ok(relative) = entry.path().strip_prefix(&root) {
                        files.push(relative.to_string_lossy().replace('\\', "/"));
                    }
                }
            }
        }
        files.sort();
        Ok(ProjectFileIndex {
            project_id: project_id.to_owned(),
            files,
            truncated,
        })
    }
}

/// Enforces that every resolved path stays within one canonical Project root.
pub struct ProjectPathGuard {
    root: PathBuf,
}

impl ProjectPathGuard {
    pub fn new(project_root: &Path) -> AppResult<Self> {
        let root = canonicalize_plain(project_root).map_err(|error| {
            AppError::new(
                "project_folder_missing",
                "The Project folder is unavailable.",
                true,
            )
            .detail(error.to_string())
            .layer("filesystem")
        })?;
        Ok(Self { root })
    }

    /// Normalize a caller path to a forward-slash, root-relative form, rejecting traversal,
    /// absolute paths, NUL bytes, and drive/UNC-qualified components. An empty result denotes
    /// the Project root itself.
    fn normalize_relative(&self, relative: &str) -> AppResult<String> {
        let unified = relative.trim().replace('\\', "/");
        if unified.contains('\0') {
            return Err(reject_path("The path contains an illegal character."));
        }
        let mut parts: Vec<&str> = Vec::new();
        for part in unified.split('/') {
            match part {
                "" | "." => continue,
                ".." => return Err(reject_path("Path traversal is not permitted.")),
                _ => {
                    if part.contains(':') {
                        return Err(reject_path("The path contains an illegal component."));
                    }
                    parts.push(part);
                }
            }
        }
        Ok(parts.join("/"))
    }

    /// Resolve an existing path and assert that its real location (symlinks resolved) is inside
    /// the Project root.
    pub fn resolve_existing(&self, relative: &str) -> AppResult<(String, PathBuf)> {
        let normalized = self.normalize_relative(relative)?;
        let joined = if normalized.is_empty() {
            self.root.clone()
        } else {
            self.root.join(&normalized)
        };
        let canonical =
            canonicalize_plain(&joined).map_err(|error| map_io("resolve", relative, error))?;
        if !canonical.starts_with(&self.root) {
            return Err(path_escape(relative));
        }
        Ok((normalized, canonical))
    }

    /// Resolve a path that may not exist yet (a create or rename destination). The parent must
    /// exist and resolve inside the root; the leaf name is validated but need not exist.
    pub fn resolve_new(&self, relative: &str) -> AppResult<(String, PathBuf)> {
        let normalized = self.normalize_relative(relative)?;
        if normalized.is_empty() {
            return Err(reject_path("A file or folder name is required."));
        }
        let (parent_rel, leaf) = match normalized.rsplit_once('/') {
            Some((parent, leaf)) => (parent.to_owned(), leaf.to_owned()),
            None => (String::new(), normalized.clone()),
        };
        validate_leaf_name(&leaf)?;
        let parent_canonical = match self.resolve_existing(&parent_rel) {
            Ok((_, parent)) => parent,
            // A missing parent is a create-into-nonexistent-folder attempt, not a caller-facing
            // "file not found"; report it as such so the UI prompts to create the folder first.
            Err(error) if error.code == "file_not_found" => {
                return Err(parent_missing(relative));
            }
            Err(error) => return Err(error),
        };
        if !parent_canonical.is_dir() {
            return Err(parent_missing(relative));
        }
        let target = parent_canonical.join(&leaf);
        Ok((normalized, target))
    }
}

fn validate_leaf_name(name: &str) -> AppResult<()> {
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.contains('/')
        || name.contains('\\')
        || name.contains('\0')
    {
        return Err(reject_path("That name is not allowed."));
    }
    Ok(())
}

fn join_relative(base: &str, name: &str) -> String {
    if base.is_empty() {
        name.to_owned()
    } else {
        format!("{base}/{name}")
    }
}

/// Canonicalize a path, then strip the Windows `\\?\` verbatim prefix so containment checks and
/// values handed to other tooling stay in plain drive form. Mirrors the repository service's
/// `git_canonicalize` for consistent cross-subsystem path comparison.
pub(crate) fn canonicalize_plain(path: &Path) -> std::io::Result<PathBuf> {
    let canonical = path.canonicalize()?;
    #[cfg(windows)]
    {
        let text = canonical.to_string_lossy();
        if let Some(unc) = text.strip_prefix(r"\\?\UNC\") {
            return Ok(PathBuf::from(format!(r"\\{unc}")));
        }
        if let Some(local) = text.strip_prefix(r"\\?\") {
            return Ok(PathBuf::from(local.to_owned()));
        }
    }
    Ok(canonical)
}

fn atomic_write(path: &Path, bytes: &[u8]) -> AppResult<()> {
    let parent = path.parent().ok_or_else(|| {
        AppError::new(
            "invalid_write_target",
            "The write target has no parent directory.",
            false,
        )
        .layer("filesystem")
    })?;
    let temp = parent.join(format!(".paralith-tmp-{}", Uuid::new_v4()));
    let write_result = (|| -> std::io::Result<()> {
        let mut file = fs::File::create(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        Ok(())
    })();
    if let Err(error) = write_result {
        let _ = fs::remove_file(&temp);
        return Err(map_io("write", &path.to_string_lossy(), error));
    }
    // Preserve the existing file's permission bits (notably the read-only flag) across the
    // atomic replace so saving does not silently make a protected file writable.
    if let Ok(meta) = fs::metadata(path) {
        let _ = fs::set_permissions(&temp, meta.permissions());
    }
    if let Err(error) = fs::rename(&temp, path) {
        let _ = fs::remove_file(&temp);
        return Err(map_io("write", &path.to_string_lossy(), error));
    }
    Ok(())
}

fn copy_directory(source: &Path, target: &Path) -> std::io::Result<()> {
    fs::create_dir(target)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let child_target = target.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_directory(&entry.path(), &child_target)?;
        } else {
            fs::copy(entry.path(), &child_target)?;
        }
    }
    Ok(())
}

fn entry_info(project_id: &str, normalized: &str, path: &Path) -> AppResult<FsEntryInfo> {
    let meta = fs::symlink_metadata(path).map_err(|error| map_io("stat", normalized, error))?;
    let kind = if meta.file_type().is_symlink() {
        FileKind::Symlink
    } else if meta.is_dir() {
        FileKind::Directory
    } else {
        FileKind::File
    };
    let name = normalized
        .rsplit('/')
        .next()
        .unwrap_or(normalized)
        .to_owned();
    Ok(FsEntryInfo {
        project_id: project_id.to_owned(),
        relative_path: normalized.to_owned(),
        name,
        kind,
        size: meta.len(),
        modified_ms: modified_ms(&meta),
    })
}

fn modified_ms(meta: &fs::Metadata) -> Option<i64> {
    meta.modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|elapsed| elapsed.as_millis() as i64)
}

fn hex_sha256(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex_digest(hasher)
}

/// Hash a file without holding it in memory. Used for media files, which are allowed to be far
/// larger than the text limit and are streamed to the preview rather than decoded.
fn hash_file(path: &Path, relative_path: &str) -> AppResult<String> {
    let mut file = fs::File::open(path).map_err(|error| map_io("read", relative_path, error))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| map_io("read", relative_path, error))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex_digest(hasher))
}

fn hex_digest(hasher: Sha256) -> String {
    let digest = hasher.finalize();
    let mut out = String::with_capacity(digest.len() * 2);
    for byte in digest {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

/// Guarded media read, split out from [`FileSystemService::read_media`] so the path, type, and
/// size rules can be exercised without a database-backed Project.
fn read_media_bytes(guard: &ProjectPathGuard, relative_path: &str) -> AppResult<Vec<u8>> {
    let (normalized, path) = guard.resolve_existing(relative_path)?;
    if media_type_for(&normalized).is_none() {
        return Err(AppError::new(
            "unsupported_media",
            "This file type cannot be previewed.",
            true,
        )
        .entity(relative_path)
        .layer("filesystem"));
    }
    let meta = fs::metadata(&path).map_err(|error| map_io("read", relative_path, error))?;
    if meta.is_dir() {
        return Err(not_a_file(relative_path));
    }
    if meta.len() > MAX_MEDIA_FILE_BYTES {
        return Err(media_too_large(relative_path, meta.len()));
    }
    fs::read(&path).map_err(|error| map_io("read", relative_path, error))
}

/// The MIME type the editor will preview `relative_path` as, or `None` when the file is not a
/// previewable image or PDF. Matching is on the extension only.
pub fn media_type_for(relative_path: &str) -> Option<&'static str> {
    let name = relative_path.rsplit('/').next()?;
    let (_, extension) = name.rsplit_once('.')?;
    let extension = extension.to_ascii_lowercase();
    PREVIEWABLE_MEDIA
        .iter()
        .find(|(candidate, _)| *candidate == extension)
        .map(|(_, mime)| *mime)
}

/// A file is treated as binary if a NUL byte appears in its leading bytes. This matches how
/// Git and most editors detect binary content and avoids decoding a media/executable file into
/// the text editor.
fn is_binary(bytes: &[u8]) -> bool {
    bytes.iter().take(BINARY_SNIFF_BYTES).any(|byte| *byte == 0)
}

/// Extensions excluded from the Quick Open index: media, archives, compiled artifacts, and
/// fonts that are never opened as source in the editor.
const NON_SOURCE_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "bmp", "ico", "webp", "avif", "svgz", "mp3", "wav", "flac", "ogg",
    "mp4", "mov", "avi", "mkv", "webm", "pdf", "zip", "gz", "tar", "rar", "7z", "bz2", "xz", "exe",
    "dll", "so", "dylib", "bin", "obj", "o", "a", "lib", "class", "jar", "wasm", "woff", "woff2",
    "ttf", "otf", "eot", "psd", "ai", "sketch", "db", "sqlite", "lock",
];

fn is_indexable_file(name: &str) -> bool {
    // Images and PDFs are excluded as *source*, but the editor can now preview them, so Quick Open
    // must be able to reach them the same way the Explorer can.
    if media_type_for(name).is_some() {
        return true;
    }
    match name.rsplit_once('.') {
        Some((_, extension)) => {
            !NON_SOURCE_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str())
        }
        None => true,
    }
}

fn decode_text(bytes: &[u8], relative_path: &str) -> AppResult<(String, FileEncoding)> {
    let (body, encoding) = match bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        Some(rest) => (rest, FileEncoding::Utf8Bom),
        None => (bytes, FileEncoding::Utf8),
    };
    match std::str::from_utf8(body) {
        Ok(text) => Ok((text.to_owned(), encoding)),
        Err(_) => Err(AppError::new(
            "invalid_encoding",
            "This file is not valid UTF-8 and cannot be opened as text yet.",
            true,
        )
        .entity(relative_path)
        .layer("filesystem")),
    }
}

fn detect_line_ending(text: &str) -> LineEnding {
    let crlf = text.matches("\r\n").count();
    let lf_total = text.matches('\n').count();
    let lf_only = lf_total.saturating_sub(crlf);
    match (crlf > 0, lf_only > 0) {
        (true, true) => LineEnding::Mixed,
        (true, false) => LineEnding::Crlf,
        (false, true) => LineEnding::Lf,
        (false, false) => LineEnding::None,
    }
}

fn map_io(action: &str, relative_path: &str, error: std::io::Error) -> AppError {
    use std::io::ErrorKind;
    let (code, message, recoverable) = match error.kind() {
        ErrorKind::NotFound => (
            "file_not_found",
            "The requested file or folder no longer exists.",
            true,
        ),
        ErrorKind::PermissionDenied => (
            "permission_denied",
            "PARALITH does not have permission to access this path.",
            true,
        ),
        ErrorKind::AlreadyExists => ("path_exists", "A file or folder already exists here.", true),
        _ => ("filesystem_error", "A file operation failed.", true),
    };
    AppError::new(code, message, recoverable)
        .detail(format!("{action}: {error}"))
        .entity(relative_path)
        .layer("filesystem")
}

fn file_too_large(relative_path: &str, size: u64) -> AppError {
    AppError::new(
        "file_too_large",
        "This file is too large to open in the editor.",
        true,
    )
    .detail(format!(
        "{size} bytes exceeds the {MAX_TEXT_FILE_BYTES} byte editor limit"
    ))
    .entity(relative_path)
    .layer("filesystem")
}

fn media_too_large(relative_path: &str, size: u64) -> AppError {
    AppError::new(
        "file_too_large",
        "This file is too large to preview in the editor.",
        true,
    )
    .detail(format!(
        "{size} bytes exceeds the {MAX_MEDIA_FILE_BYTES} byte preview limit"
    ))
    .entity(relative_path)
    .layer("filesystem")
}

fn not_a_file(relative_path: &str) -> AppError {
    AppError::new("not_a_file", "This path is a folder, not a file.", true)
        .entity(relative_path)
        .layer("filesystem")
}

fn parent_missing(relative_path: &str) -> AppError {
    AppError::new(
        "parent_not_a_directory",
        "The destination's parent folder does not exist.",
        true,
    )
    .entity(relative_path)
    .layer("filesystem")
}

fn already_exists(relative_path: &str) -> AppError {
    AppError::new(
        "path_exists",
        "A file or folder with that name already exists.",
        true,
    )
    .entity(relative_path)
    .layer("filesystem")
}

fn reject_path(message: &str) -> AppError {
    AppError::new("path_outside_project", message, false).layer("filesystem_security")
}

fn path_escape(relative_path: &str) -> AppError {
    AppError::new(
        "path_outside_project",
        "That path resolves outside the Project and was refused.",
        false,
    )
    .entity(relative_path)
    .layer("filesystem_security")
}

fn is_directory_not_empty_error(error: &std::io::Error) -> bool {
    matches!(
        error.raw_os_error(),
        // POSIX ENOTEMPTY / Darwin ENOTEMPTY / Windows ERROR_DIR_NOT_EMPTY.
        Some(39 | 66 | 145)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempProject {
        root: PathBuf,
    }

    impl TempProject {
        fn new(label: &str) -> Self {
            let root = std::env::temp_dir().join(format!("paralith-fs-{label}-{}", Uuid::new_v4()));
            fs::create_dir_all(&root).unwrap();
            Self { root }
        }

        fn guard(&self) -> ProjectPathGuard {
            ProjectPathGuard::new(&self.root).unwrap()
        }

        fn write(&self, relative: &str, contents: &[u8]) -> PathBuf {
            let path = self.root.join(relative);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            fs::write(&path, contents).unwrap();
            path
        }
    }

    impl Drop for TempProject {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn normalizes_separators_and_collapses_current_dir() {
        let project = TempProject::new("normalize");
        let guard = project.guard();
        assert_eq!(
            guard.normalize_relative("./src\\main.rs").unwrap(),
            "src/main.rs"
        );
        assert_eq!(guard.normalize_relative("").unwrap(), "");
        assert_eq!(guard.normalize_relative("a//b/").unwrap(), "a/b");
    }

    #[test]
    fn rejects_traversal_absolute_and_drive_paths() {
        let project = TempProject::new("traversal");
        let guard = project.guard();
        for bad in ["../secrets", "a/../../b", "..", "foo/../../etc"] {
            let error = guard.normalize_relative(bad).unwrap_err();
            assert_eq!(error.code, "path_outside_project", "input {bad}");
        }
        assert_eq!(
            guard.normalize_relative("C:/Windows").unwrap_err().code,
            "path_outside_project"
        );
        assert_eq!(
            guard.normalize_relative("a\0b").unwrap_err().code,
            "path_outside_project"
        );
    }

    #[test]
    fn resolve_existing_rejects_paths_outside_root() {
        let project = TempProject::new("outside");
        let guard = project.guard();
        assert_eq!(
            guard.resolve_existing("../..").unwrap_err().code,
            "path_outside_project"
        );
    }

    #[test]
    fn symlink_escape_is_refused() {
        let project = TempProject::new("symlink");
        let outside = std::env::temp_dir().join(format!("paralith-outside-{}", Uuid::new_v4()));
        fs::write(&outside, b"secret").unwrap();
        let link = project.root.join("escape");
        #[cfg(unix)]
        let created = std::os::unix::fs::symlink(&outside, &link).is_ok();
        #[cfg(windows)]
        let created = std::os::windows::fs::symlink_file(&outside, &link).is_ok();
        if created {
            let guard = project.guard();
            let error = guard.resolve_existing("escape").unwrap_err();
            assert_eq!(error.code, "path_outside_project");
        }
        let _ = fs::remove_file(&outside);
    }

    #[test]
    fn atomic_write_creates_then_replaces() {
        let project = TempProject::new("roundtrip");
        let guard = project.guard();
        // The database-backed methods re-use these guarded primitives; here we exercise the pure
        // filesystem path (resolution + atomic replace + hashing) without a DatabaseService.
        fs::create_dir_all(project.root.join("notes")).unwrap();
        let (_, path) = guard.resolve_new("notes/todo.txt").unwrap();
        atomic_write(&path, b"first\n").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"first\n");
        let first_hash = hex_sha256(b"first\n");
        atomic_write(&path, b"second\n").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"second\n");
        assert_ne!(first_hash, hex_sha256(b"second\n"));
    }

    #[test]
    fn atomic_write_preserves_unicode_paths() {
        let project = TempProject::new("unicode");
        fs::create_dir_all(project.root.join("café")).unwrap();
        let guard = project.guard();
        let (normalized, path) = guard.resolve_new("café/naïve.txt").unwrap();
        assert_eq!(normalized, "café/naïve.txt");
        atomic_write(&path, "héllo\n".as_bytes()).unwrap();
        let bytes = fs::read(&path).unwrap();
        assert_eq!(bytes, "héllo\n".as_bytes());
    }

    #[test]
    fn binary_detection_and_encoding() {
        assert!(is_binary(b"abc\0def"));
        assert!(!is_binary(b"plain text"));
        let (text, encoding) = decode_text(b"hello", "a.txt").unwrap();
        assert_eq!(text, "hello");
        assert_eq!(encoding, FileEncoding::Utf8);
        let (text, encoding) = decode_text(&[0xEF, 0xBB, 0xBF, b'h', b'i'], "a.txt").unwrap();
        assert_eq!(text, "hi");
        assert_eq!(encoding, FileEncoding::Utf8Bom);
        assert_eq!(
            decode_text(&[0xFF, 0xFE, 0x00], "a.bin").unwrap_err().code,
            "invalid_encoding"
        );
    }

    #[test]
    fn line_ending_detection() {
        assert_eq!(detect_line_ending("a\nb\n"), LineEnding::Lf);
        assert_eq!(detect_line_ending("a\r\nb\r\n"), LineEnding::Crlf);
        assert_eq!(detect_line_ending("a\r\nb\n"), LineEnding::Mixed);
        assert_eq!(detect_line_ending("single line"), LineEnding::None);
    }

    #[test]
    fn media_type_is_resolved_from_the_extension_only() {
        assert_eq!(media_type_for("assets/logo.PNG"), Some("image/png"));
        assert_eq!(media_type_for("docs/manual.pdf"), Some("application/pdf"));
        assert_eq!(media_type_for("icons/mark.svg"), Some("image/svg+xml"));
        assert_eq!(media_type_for("photo.jpeg"), Some("image/jpeg"));
        assert_eq!(media_type_for("src/main.rs"), None);
        assert_eq!(media_type_for("README"), None);
        // A name that merely contains a media extension is not media.
        assert_eq!(media_type_for("notes/png-guide.md"), None);
        assert_eq!(media_type_for("archive.pdf.zip"), None);
    }

    #[test]
    fn hash_file_matches_the_in_memory_hash() {
        let project = TempProject::new("hash");
        project.write("image.png", b"\x89PNG\r\n\x1a\nbody");
        let hashed = hash_file(&project.root.join("image.png"), "image.png").unwrap();
        assert_eq!(hashed, hex_sha256(b"\x89PNG\r\n\x1a\nbody"));
    }

    #[test]
    fn media_read_returns_bytes_only_for_previewable_files_inside_the_project() {
        let project = TempProject::new("media");
        project.write("assets/logo.png", b"\x89PNG\r\n\x1a\npixels");
        project.write("secrets/keys.env", b"TOKEN=1");
        fs::create_dir_all(project.root.join("assets/nested.png")).unwrap();
        let guard = project.guard();

        assert_eq!(
            read_media_bytes(&guard, "assets/logo.png").unwrap(),
            b"\x89PNG\r\n\x1a\npixels"
        );
        // Not a previewable extension: refused rather than streamed as opaque bytes.
        assert_eq!(
            read_media_bytes(&guard, "secrets/keys.env")
                .unwrap_err()
                .code,
            "unsupported_media"
        );
        // A directory that happens to be named like an image is still not a file.
        assert_eq!(
            read_media_bytes(&guard, "assets/nested.png")
                .unwrap_err()
                .code,
            "not_a_file"
        );
        // The Project boundary applies to media exactly as it does to text.
        assert_eq!(
            read_media_bytes(&guard, "../outside.png").unwrap_err().code,
            "path_outside_project"
        );
    }

    #[test]
    fn media_size_guard_reports_the_preview_limit() {
        let error = media_too_large("huge.pdf", MAX_MEDIA_FILE_BYTES + 1);
        assert_eq!(error.code, "file_too_large");
        assert!(error
            .detail
            .as_deref()
            .unwrap_or_default()
            .contains(&MAX_MEDIA_FILE_BYTES.to_string()));
    }

    #[test]
    fn size_guard_rejects_oversized_reads() {
        assert_eq!(
            file_too_large("big.bin", MAX_TEXT_FILE_BYTES + 1).code,
            "file_too_large"
        );
    }

    #[test]
    fn resolve_new_requires_existing_parent() {
        let project = TempProject::new("parent");
        let guard = project.guard();
        assert_eq!(
            guard.resolve_new("missing/child.txt").unwrap_err().code,
            "parent_not_a_directory"
        );
    }

    #[test]
    fn copy_directory_is_recursive() {
        let project = TempProject::new("copy");
        project.write("srcdir/a.txt", b"a");
        project.write("srcdir/nested/b.txt", b"b");
        let guard = project.guard();
        let (_, source) = guard.resolve_existing("srcdir").unwrap();
        let (_, target) = guard.resolve_new("destdir").unwrap();
        copy_directory(&source, &target).unwrap();
        assert!(project.root.join("destdir/a.txt").exists());
        assert!(project.root.join("destdir/nested/b.txt").exists());
    }

    #[test]
    fn self_write_ledger_expires_and_reports_membership() {
        let ledger = SelfWriteLedger::default();
        let path = std::env::temp_dir().join("paralith-ledger-probe.txt");
        assert!(!ledger.recently_written(&path));
        ledger.mark(&path);
        assert!(ledger.recently_written(&path));
        assert!(!ledger.recently_written(Path::new("some/other/path")));
    }

    #[test]
    fn quick_open_index_excludes_binaries_and_generated_names() {
        assert!(is_indexable_file("main.rs"));
        assert!(is_indexable_file("README"));
        assert!(is_indexable_file("component.tsx"));
        assert!(!is_indexable_file("bundle.wasm"));
        assert!(!is_indexable_file("yarn.lock"));
        assert!(!is_indexable_file("track.mp3"));
        // Previewable media is reachable from Quick Open because the editor can now open it.
        assert!(is_indexable_file("logo.PNG"));
        assert!(is_indexable_file("manual.pdf"));
    }

    #[test]
    fn non_source_directories_are_pruned_from_the_walk() {
        assert!(NON_SOURCE_DIRECTORIES.contains(&"node_modules"));
        assert!(NON_SOURCE_DIRECTORIES.contains(&".git"));
        assert!(NON_SOURCE_DIRECTORIES.contains(&"target"));
    }
}

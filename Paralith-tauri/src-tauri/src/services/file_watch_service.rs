//! Centralized, project-scoped filesystem watching for the Code surface.
//!
//! There is one recursive OS watcher per open Project root, shared by every window that uses
//! the Project — never one watcher per editor tab or React component. Raw notify events are
//! debounced and coalesced on a dedicated thread, filtered against the [`SelfWriteLedger`] so
//! PARALITH's own atomic saves do not echo back as external changes, and delivered as typed
//! [`ProjectFileChangeBatch`] events only to the windows authorized for that Project.
//!
//! The watcher deliberately records *what* changed, not *who* changed it. Source attribution
//! (user vs. agent vs. git) is a separate slice with its own evidence model.

use crate::database::DatabaseService;
use crate::errors::{AppError, AppResult};
use crate::models::{FileChangeKind, ProjectFileChange, ProjectFileChangeBatch};
use crate::services::filesystem_service::{canonicalize_plain, SelfWriteLedger};
use notify::event::ModifyKind;
use notify::{Event, EventKind, RecursiveMode, Watcher};
use parking_lot::Mutex;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// Quiet period after the last event before a batch is flushed. Long enough to coalesce the
/// create+modify bursts a single save produces, short enough to feel immediate in the editor.
const DEBOUNCE: Duration = Duration::from_millis(150);

/// Flush early when a burst accumulates this many distinct paths, so a large checkout or branch
/// switch does not sit unbounded in the pending buffer.
const MAX_PENDING: usize = 400;

pub const PROJECT_FILE_CHANGED_EVENT: &str = "project-file-changed";

struct ProjectWatch {
    /// Window labels currently subscribed to this Project's changes.
    subscribers: Arc<Mutex<HashSet<String>>>,
    /// Dropping the watcher stops the OS subscription and disconnects the event channel, which
    /// ends the debounce thread.
    _watcher: notify::RecommendedWatcher,
}

#[derive(Clone)]
pub struct FileWatchService {
    database: Arc<DatabaseService>,
    app: AppHandle,
    ledger: SelfWriteLedger,
    watchers: Arc<Mutex<HashMap<PathBuf, ProjectWatch>>>,
}

impl FileWatchService {
    pub fn new(database: Arc<DatabaseService>, app: AppHandle, ledger: SelfWriteLedger) -> Self {
        Self {
            database,
            app,
            ledger,
            watchers: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Ensure a watcher exists for the Project and register `window_label` as a subscriber. The
    /// second and later windows for a Project reuse the single existing watcher.
    pub fn watch(&self, project_id: &str, window_label: &str) -> AppResult<()> {
        let project = self.database.get_project(project_id)?;
        let root = canonicalize_plain(Path::new(&project.root_path)).map_err(|error| {
            AppError::new(
                "project_folder_missing",
                "The Project folder is unavailable, so its files cannot be watched.",
                true,
            )
            .detail(error.to_string())
            .layer("file_watch")
        })?;
        let mut watchers = self.watchers.lock();
        if let Some(existing) = watchers.get(&root) {
            existing.subscribers.lock().insert(window_label.to_owned());
            return Ok(());
        }
        let subscribers = Arc::new(Mutex::new(HashSet::from([window_label.to_owned()])));
        let (sender, receiver) = std::sync::mpsc::channel::<Event>();
        let mut watcher = notify::recommended_watcher(move |result: notify::Result<Event>| {
            if let Ok(event) = result {
                // A closed receiver means the watch was released; the send error is expected and
                // ignored so the OS callback stays infallible.
                let _ = sender.send(event);
            }
        })
        .map_err(|error| watcher_failed(error, project_id))?;
        watcher
            .watch(&root, RecursiveMode::Recursive)
            .map_err(|error| watcher_failed(error, project_id))?;
        self.spawn_debounce_thread(
            project_id.to_owned(),
            root.clone(),
            receiver,
            subscribers.clone(),
        );
        watchers.insert(
            root,
            ProjectWatch {
                subscribers,
                _watcher: watcher,
            },
        );
        Ok(())
    }

    /// Remove a window's subscription. When the last subscriber for a Project leaves, its watcher
    /// is dropped and the OS resources released.
    pub fn unwatch(&self, project_id: &str, window_label: &str) {
        let root = self
            .database
            .get_project(project_id)
            .ok()
            .and_then(|project| canonicalize_plain(Path::new(&project.root_path)).ok());
        let mut watchers = self.watchers.lock();
        if let Some(root) = root {
            if self.deregister(&mut watchers, &root, window_label) {
                watchers.remove(&root);
            }
            return;
        }
        // The folder may be gone; fall back to dropping the label from every watch it appears in.
        let empty = self.deregister_everywhere(&mut watchers, window_label);
        for root in empty {
            watchers.remove(&root);
        }
    }

    /// Release every subscription held by a window. Called when a window is destroyed so a closed
    /// detached editor cannot keep a watcher alive.
    pub fn forget_window(&self, window_label: &str) {
        let mut watchers = self.watchers.lock();
        let empty = self.deregister_everywhere(&mut watchers, window_label);
        for root in empty {
            watchers.remove(&root);
        }
    }

    fn deregister(
        &self,
        watchers: &mut HashMap<PathBuf, ProjectWatch>,
        root: &Path,
        window_label: &str,
    ) -> bool {
        if let Some(watch) = watchers.get(root) {
            let mut subscribers = watch.subscribers.lock();
            subscribers.remove(window_label);
            return subscribers.is_empty();
        }
        false
    }

    fn deregister_everywhere(
        &self,
        watchers: &mut HashMap<PathBuf, ProjectWatch>,
        window_label: &str,
    ) -> Vec<PathBuf> {
        let mut empty = Vec::new();
        for (root, watch) in watchers.iter() {
            let mut subscribers = watch.subscribers.lock();
            subscribers.remove(window_label);
            if subscribers.is_empty() {
                empty.push(root.clone());
            }
        }
        empty
    }

    fn spawn_debounce_thread(
        &self,
        project_id: String,
        root: PathBuf,
        receiver: Receiver<Event>,
        subscribers: Arc<Mutex<HashSet<String>>>,
    ) {
        let app = self.app.clone();
        let ledger = self.ledger.clone();
        std::thread::Builder::new()
            .name(format!("paralith-fswatch-{project_id}"))
            .spawn(move || {
                let mut pending: HashMap<String, FileChangeKind> = HashMap::new();
                loop {
                    match receiver.recv_timeout(DEBOUNCE) {
                        Ok(event) => {
                            for (relative, kind) in
                                classify_event(&root, &event.paths, &event.kind, &ledger)
                            {
                                let merged = merge_change(pending.get(&relative).copied(), kind);
                                pending.insert(relative, merged);
                            }
                            if pending.len() >= MAX_PENDING {
                                flush(&app, &project_id, &subscribers, &mut pending);
                            }
                        }
                        Err(RecvTimeoutError::Timeout) => {
                            if !pending.is_empty() {
                                flush(&app, &project_id, &subscribers, &mut pending);
                            }
                        }
                        Err(RecvTimeoutError::Disconnected) => {
                            if !pending.is_empty() {
                                flush(&app, &project_id, &subscribers, &mut pending);
                            }
                            break;
                        }
                    }
                }
            })
            .ok();
    }
}

fn flush(
    app: &AppHandle,
    project_id: &str,
    subscribers: &Arc<Mutex<HashSet<String>>>,
    pending: &mut HashMap<String, FileChangeKind>,
) {
    let changes: Vec<ProjectFileChange> = pending
        .drain()
        .map(|(relative_path, kind)| ProjectFileChange {
            relative_path,
            kind,
        })
        .collect();
    if changes.is_empty() {
        return;
    }
    let batch = ProjectFileChangeBatch {
        project_id: project_id.to_owned(),
        changes,
    };
    let targets: Vec<String> = subscribers.lock().iter().cloned().collect();
    for label in targets {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.emit(PROJECT_FILE_CHANGED_EVENT, &batch);
        }
    }
}

/// Translate a raw notify event into zero or more `(relative_path, kind)` changes, dropping
/// anything outside the root, PARALITH's own temp/atomic-save churn, `.git` internals, and paths
/// the [`SelfWriteLedger`] shows were just written by PARALITH itself.
fn classify_event(
    root: &Path,
    paths: &[PathBuf],
    kind: &EventKind,
    ledger: &SelfWriteLedger,
) -> Vec<(String, FileChangeKind)> {
    let keep = |path: &PathBuf| -> Option<String> {
        let relative = relativize(root, path)?;
        if is_ignored_relative(&relative) || ledger.recently_written(path) {
            return None;
        }
        Some(relative)
    };
    match kind {
        EventKind::Create(_) => paths
            .iter()
            .filter_map(|path| keep(path).map(|relative| (relative, FileChangeKind::Created)))
            .collect(),
        EventKind::Remove(_) => paths
            .iter()
            .filter_map(|path| keep(path).map(|relative| (relative, FileChangeKind::Deleted)))
            .collect(),
        // A rename reported with both endpoints becomes a delete of the source and a create of the
        // destination; a single-ended rename is reported as a neutral modification because the
        // endpoint (from vs. to) is ambiguous.
        EventKind::Modify(ModifyKind::Name(_)) if paths.len() >= 2 => {
            let mut changes = Vec::new();
            if let Some(source) = keep(&paths[0]) {
                changes.push((source, FileChangeKind::Deleted));
            }
            for path in &paths[1..] {
                if let Some(destination) = keep(path) {
                    changes.push((destination, FileChangeKind::Created));
                }
            }
            changes
        }
        EventKind::Modify(_) => paths
            .iter()
            .filter_map(|path| keep(path).map(|relative| (relative, FileChangeKind::Modified)))
            .collect(),
        // Access events carry no change; anything else is treated conservatively as a modification.
        EventKind::Access(_) => Vec::new(),
        _ => paths
            .iter()
            .filter_map(|path| keep(path).map(|relative| (relative, FileChangeKind::Modified)))
            .collect(),
    }
}

/// Coalesce a new change into what is already pending for the same path.
fn merge_change(existing: Option<FileChangeKind>, incoming: FileChangeKind) -> FileChangeKind {
    match (existing, incoming) {
        // A freshly created file that is then written is still, to the editor, a new file.
        (Some(FileChangeKind::Created), FileChangeKind::Modified) => FileChangeKind::Created,
        // A delete always wins: the file is gone regardless of earlier churn.
        (_, FileChangeKind::Deleted) => FileChangeKind::Deleted,
        (_, incoming) => incoming,
    }
}

fn relativize(root: &Path, path: &Path) -> Option<String> {
    path.strip_prefix(root)
        .ok()
        .map(|relative| relative.to_string_lossy().replace('\\', "/"))
}

fn is_ignored_relative(relative: &str) -> bool {
    if relative.is_empty() || relative == ".git" || relative.starts_with(".git/") {
        return true;
    }
    relative
        .rsplit('/')
        .next()
        .map(|name| name.starts_with(".paralith-tmp-"))
        .unwrap_or(false)
}

fn watcher_failed(error: impl std::fmt::Display, project_id: &str) -> AppError {
    AppError::new(
        "file_watcher_failed",
        "PARALITH could not start watching this Project's files.",
        true,
    )
    .detail(error.to_string())
    .entity(project_id)
    .layer("file_watch")
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{CreateKind, ModifyKind, RemoveKind, RenameMode};

    fn root() -> PathBuf {
        PathBuf::from(if cfg!(windows) { r"C:\proj" } else { "/proj" })
    }

    fn under(parts: &[&str]) -> PathBuf {
        let mut path = root();
        for part in parts {
            path.push(part);
        }
        path
    }

    #[test]
    fn classifies_create_modify_delete() {
        let ledger = SelfWriteLedger::default();
        let created = classify_event(
            &root(),
            &[under(&["src", "new.rs"])],
            &EventKind::Create(CreateKind::File),
            &ledger,
        );
        assert_eq!(
            created,
            vec![("src/new.rs".to_owned(), FileChangeKind::Created)]
        );

        let modified = classify_event(
            &root(),
            &[under(&["a.txt"])],
            &EventKind::Modify(ModifyKind::Data(notify::event::DataChange::Content)),
            &ledger,
        );
        assert_eq!(
            modified,
            vec![("a.txt".to_owned(), FileChangeKind::Modified)]
        );

        let removed = classify_event(
            &root(),
            &[under(&["gone.txt"])],
            &EventKind::Remove(RemoveKind::File),
            &ledger,
        );
        assert_eq!(
            removed,
            vec![("gone.txt".to_owned(), FileChangeKind::Deleted)]
        );
    }

    #[test]
    fn two_ended_rename_becomes_delete_and_create() {
        let ledger = SelfWriteLedger::default();
        let changes = classify_event(
            &root(),
            &[under(&["old.txt"]), under(&["new.txt"])],
            &EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
            &ledger,
        );
        assert_eq!(
            changes,
            vec![
                ("old.txt".to_owned(), FileChangeKind::Deleted),
                ("new.txt".to_owned(), FileChangeKind::Created),
            ]
        );
    }

    #[test]
    fn ignores_git_internals_temp_files_and_out_of_root_paths() {
        let ledger = SelfWriteLedger::default();
        assert!(classify_event(
            &root(),
            &[under(&[".git", "index"])],
            &EventKind::Modify(ModifyKind::Any),
            &ledger,
        )
        .is_empty());
        assert!(classify_event(
            &root(),
            &[under(&["src", ".paralith-tmp-abc"])],
            &EventKind::Create(CreateKind::File),
            &ledger,
        )
        .is_empty());
        assert!(classify_event(
            &root(),
            &[PathBuf::from(if cfg!(windows) {
                r"C:\other\x"
            } else {
                "/other/x"
            })],
            &EventKind::Create(CreateKind::File),
            &ledger,
        )
        .is_empty());
    }

    #[test]
    fn suppresses_paralith_own_writes() {
        let ledger = SelfWriteLedger::default();
        let path = under(&["saved.rs"]);
        ledger.mark(&path);
        let changes = classify_event(
            &root(),
            &[path],
            &EventKind::Modify(ModifyKind::Data(notify::event::DataChange::Content)),
            &ledger,
        );
        assert!(changes.is_empty(), "own write must not echo back");
    }

    #[test]
    fn access_events_are_dropped() {
        let ledger = SelfWriteLedger::default();
        let changes = classify_event(
            &root(),
            &[under(&["a.txt"])],
            &EventKind::Access(notify::event::AccessKind::Read),
            &ledger,
        );
        assert!(changes.is_empty());
    }

    #[test]
    fn coalescing_rules() {
        assert_eq!(
            merge_change(Some(FileChangeKind::Created), FileChangeKind::Modified),
            FileChangeKind::Created
        );
        assert_eq!(
            merge_change(Some(FileChangeKind::Modified), FileChangeKind::Deleted),
            FileChangeKind::Deleted
        );
        assert_eq!(
            merge_change(Some(FileChangeKind::Created), FileChangeKind::Deleted),
            FileChangeKind::Deleted
        );
        assert_eq!(
            merge_change(None, FileChangeKind::Modified),
            FileChangeKind::Modified
        );
    }

    #[test]
    fn large_burst_coalesces_duplicate_paths() {
        let mut pending: HashMap<String, FileChangeKind> = HashMap::new();
        for _ in 0..1000 {
            let merged = merge_change(pending.get("hot.txt").copied(), FileChangeKind::Modified);
            pending.insert("hot.txt".to_owned(), merged);
        }
        assert_eq!(pending.len(), 1);
        assert_eq!(pending["hot.txt"], FileChangeKind::Modified);
    }
}

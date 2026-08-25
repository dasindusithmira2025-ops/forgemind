//! Centralized, project-scoped filesystem watching for the Code surface.
//!
//! There is one recursive OS watcher per open Project root, shared by every window that uses
//! the Project — never one watcher per editor tab or React component. Raw notify events are
//! debounced and coalesced on a dedicated thread, filtered against the [`SelfWriteLedger`] so
//! PARALITH's own atomic saves do not echo back as external changes, and delivered as typed
//! [`ProjectFileChangeBatch`] events only to the windows authorized for that Project.
//!
//! The watcher records *what* changed **and who caused it**. Origin comes from the
//! [`SelfWriteLedger`] stamp on the write, not from a guess about the path, which is what lets a
//! memory-mirror write be suppressed while a user's edit to a Skill file in the same directory
//! reaches the Context Fabric normally.

use crate::database::DatabaseService;
use crate::errors::{AppError, AppResult};
use crate::models::{ChangeOrigin, FileChangeKind, ProjectFileChange, ProjectFileChangeBatch};
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
const PROJECT_SESSION_SUBSCRIBER: &str = "__project_session__";

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
    app: Option<AppHandle>,
    ledger: SelfWriteLedger,
    watchers: Arc<Mutex<HashMap<PathBuf, ProjectWatch>>>,
    /// Present in the running application. Database Studio re-extracts only when a batch actually
    /// contains a database artifact, so editing a component never triggers schema work.
    database_studio: Option<crate::services::database_studio::DatabaseStudioRuntime>,
    /// Present in the running application. The lifecycle only *enqueues* here — impact analysis
    /// and any staleness write happen on its own worker thread, so a branch switch that touches
    /// thousands of files costs this thread one row insert.
    knowledge: Option<crate::services::KnowledgeLifecycle>,
    /// Present in the running application. Keeps the code graph current for exactly the files a
    /// change touched, never by rewalking the Project.
    code: Option<crate::services::CodeIntelligence>,
}

impl FileWatchService {
    pub fn new(database: Arc<DatabaseService>, app: AppHandle, ledger: SelfWriteLedger) -> Self {
        Self {
            database,
            app: Some(app),
            ledger,
            watchers: Arc::new(Mutex::new(HashMap::new())),
            database_studio: None,
            knowledge: None,
            code: None,
        }
    }

    #[cfg(test)]
    pub fn new_for_tests(database: Arc<DatabaseService>, ledger: SelfWriteLedger) -> Self {
        Self {
            database,
            app: None,
            ledger,
            watchers: Arc::new(Mutex::new(HashMap::new())),
            database_studio: None,
            knowledge: None,
            code: None,
        }
    }

    pub fn with_code_intelligence(mut self, code: crate::services::CodeIntelligence) -> Self {
        self.code = Some(code);
        self
    }

    pub fn with_database_studio(
        mut self,
        database_studio: crate::services::database_studio::DatabaseStudioRuntime,
    ) -> Self {
        self.database_studio = Some(database_studio);
        self
    }

    pub fn with_knowledge_lifecycle(
        mut self,
        knowledge: crate::services::KnowledgeLifecycle,
    ) -> Self {
        self.knowledge = Some(knowledge);
        self
    }

    /// Ensure a watcher exists for the Project and register `window_label` as a subscriber. The
    /// second and later windows for a Project reuse the single existing watcher.
    pub fn watch(&self, project_id: &str, window_label: &str) -> AppResult<()> {
        self.watch_for_subscriber(project_id, window_label)
    }

    /// Ensure the Project session itself owns a watcher. Renderer surfaces may still subscribe,
    /// but Memory, Code Graph, and Database Studio do not depend on any surface being mounted.
    pub fn ensure_project_session_watch(&self, project_id: &str) -> AppResult<()> {
        self.watch_for_subscriber(project_id, PROJECT_SESSION_SUBSCRIBER)
    }

    /// Release the session-owned subscription. Window subscriptions, if any remain, keep using
    /// the same OS watcher until they unsubscribe or their window is destroyed.
    pub fn release_project_session_watch(&self, project_id: &str) {
        self.unwatch(project_id, PROJECT_SESSION_SUBSCRIBER);
    }

    /// Re-establish watchers for Projects that were already open in the restored main session.
    pub fn ensure_open_project_session_watches(&self) -> AppResult<usize> {
        let sessions = self.database.list_open_project_sessions()?;
        let mut established = 0usize;
        for session in sessions {
            self.ensure_project_session_watch(&session.project_id)?;
            established += 1;
        }
        Ok(established)
    }

    fn watch_for_subscriber(&self, project_id: &str, subscriber: &str) -> AppResult<()> {
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
            existing.subscribers.lock().insert(subscriber.to_owned());
            return Ok(());
        }
        let subscribers = Arc::new(Mutex::new(HashSet::from([subscriber.to_owned()])));
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

    #[cfg(test)]
    fn watcher_count(&self) -> usize {
        self.watchers.lock().len()
    }

    #[cfg(test)]
    fn subscriber_count_for_project(&self, project_id: &str) -> AppResult<usize> {
        let project = self.database.get_project(project_id)?;
        let root = canonicalize_plain(Path::new(&project.root_path))?;
        Ok(self
            .watchers
            .lock()
            .get(&root)
            .map(|watch| watch.subscribers.lock().len())
            .unwrap_or(0))
    }

    #[cfg(test)]
    pub fn dispatch_changes_for_test(&self, project_id: &str, changes: Vec<ProjectFileChange>) {
        let subscribers = Arc::new(Mutex::new(HashSet::new()));
        let mut pending: HashMap<String, (FileChangeKind, ChangeOrigin)> = changes
            .into_iter()
            .map(|change| (change.relative_path, (change.kind, change.origin)))
            .collect();
        let sinks = ChangeSinks {
            database_studio: self.database_studio.clone(),
            knowledge: self.knowledge.clone(),
            code: self.code.clone(),
        };
        flush(&self.app, project_id, &subscribers, &mut pending, &sinks);
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
        let sinks = ChangeSinks {
            database_studio: self.database_studio.clone(),
            knowledge: self.knowledge.clone(),
            code: self.code.clone(),
        };
        std::thread::Builder::new()
            .name(format!("paralith-fswatch-{project_id}"))
            .spawn(move || {
                let mut pending: HashMap<String, (FileChangeKind, ChangeOrigin)> = HashMap::new();
                loop {
                    match receiver.recv_timeout(DEBOUNCE) {
                        Ok(event) => {
                            for (relative, kind, origin) in
                                classify_event(&root, &event.paths, &event.kind, &ledger)
                            {
                                let previous = pending.get(&relative).copied();
                                let merged = merge_change(previous.map(|(kind, _)| kind), kind);
                                let merged_origin =
                                    merge_origin(previous.map(|(_, origin)| origin), origin);
                                pending.insert(relative, (merged, merged_origin));
                            }
                            if pending.len() >= MAX_PENDING {
                                flush(&app, &project_id, &subscribers, &mut pending, &sinks);
                            }
                        }
                        Err(RecvTimeoutError::Timeout) => {
                            if !pending.is_empty() {
                                flush(&app, &project_id, &subscribers, &mut pending, &sinks);
                            }
                        }
                        Err(RecvTimeoutError::Disconnected) => {
                            if !pending.is_empty() {
                                flush(&app, &project_id, &subscribers, &mut pending, &sinks);
                            }
                            break;
                        }
                    }
                }
            })
            .ok();
    }
}

/// The subsystems a flushed batch is handed to, besides the windows.
///
/// Both are `Option` because the watcher is constructed in tests without a running application.
/// Each decides relevance itself: the watcher does not know what a database artifact is, and it
/// does not know what can carry knowledge provenance.
#[derive(Clone, Default)]
struct ChangeSinks {
    database_studio: Option<crate::services::database_studio::DatabaseStudioRuntime>,
    knowledge: Option<crate::services::KnowledgeLifecycle>,
    code: Option<crate::services::CodeIntelligence>,
}

fn flush(
    app: &Option<AppHandle>,
    project_id: &str,
    subscribers: &Arc<Mutex<HashSet<String>>>,
    pending: &mut HashMap<String, (FileChangeKind, ChangeOrigin)>,
    sinks: &ChangeSinks,
) {
    let changes: Vec<ProjectFileChange> = pending
        .drain()
        .map(|(relative_path, (kind, origin))| ProjectFileChange {
            relative_path,
            kind,
            origin,
        })
        .collect();
    if changes.is_empty() {
        return;
    }
    // Only changes PARALITH did not itself produce are repository changes. A memory mirror write,
    // a Skill save, or a Canvas export re-entering analysis would be the application reacting to
    // its own output — the feedback loop the old `.paralith/` blacklist existed to prevent, now
    // prevented by the fact rather than by the path.
    let paths: Vec<String> = changes
        .iter()
        .filter(|change| !change.origin.is_self_write())
        .map(|change| change.relative_path.clone())
        .collect();
    if !paths.is_empty() {
        if let Some(database_studio) = &sinks.database_studio {
            // Relevance is decided inside the runtime, which owns the definition of a database
            // artifact; an unrelated batch returns immediately without touching the graph.
            if let Err(error) = database_studio.handle_changed_paths(project_id, &paths) {
                log::warn!(
                    "database studio incremental refresh skipped: {}",
                    error.message
                );
            }
        }
        if let Some(knowledge) = &sinks.knowledge {
            // Enqueue only. Impact analysis and any staleness write happen on the lifecycle worker,
            // because this thread must return to coalescing the next burst immediately.
            if let Err(error) =
                knowledge.handle_file_change_batch(project_id, &external_changes(&changes))
            {
                log::warn!("knowledge impact analysis not queued: {}", error.message);
            }
        }
        if let Some(code) = &sinks.code {
            // Reindexing the changed paths is bounded by the batch, not by the size of the
            // Project, so it runs here rather than costing a second queue.
            if let Err(error) = code.index_paths(project_id, &paths) {
                log::warn!("code index not updated: {}", error.message);
            }
        }
    }
    // Windows are told about *external* changes only. An editor that received its own save back
    // would show a spurious "changed on disk" conflict on every keystroke-triggered write, which
    // is the behaviour the ledger has always existed to prevent.
    let external: Vec<ProjectFileChange> = changes
        .into_iter()
        .filter(|change| !change.origin.is_self_write())
        .collect();
    if external.is_empty() {
        return;
    }
    let batch = ProjectFileChangeBatch {
        project_id: project_id.to_owned(),
        changes: external,
    };
    let targets: Vec<String> = subscribers.lock().iter().cloned().collect();
    let Some(app) = app else {
        return;
    };
    for label in targets {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.emit(PROJECT_FILE_CHANGED_EVENT, &batch);
        }
    }
}

fn external_changes(changes: &[ProjectFileChange]) -> Vec<ProjectFileChange> {
    changes
        .iter()
        .filter(|change| !change.origin.is_self_write())
        .cloned()
        .collect()
}

/// Translate a raw notify event into zero or more `(relative_path, kind, origin)` changes, dropping
/// anything outside the root, PARALITH's own temp/atomic-save churn, and `.git` internals.
///
/// A path the [`SelfWriteLedger`] recognizes is **kept and attributed**, not dropped. Dropping it
/// was the old behaviour and it conflated two different needs: the editor must not see its own
/// save echoed back, but the code index and the knowledge lifecycle need to know the change
/// happened *and* that PARALITH caused it. Attribution serves both; suppression served only one.
fn classify_event(
    root: &Path,
    paths: &[PathBuf],
    kind: &EventKind,
    ledger: &SelfWriteLedger,
) -> Vec<(String, FileChangeKind, ChangeOrigin)> {
    let keep = |path: &PathBuf| -> Option<(String, ChangeOrigin)> {
        let relative = relativize(root, path)?;
        if is_ignored_relative(&relative) {
            return None;
        }
        let origin = ledger.origin_of(path).unwrap_or(ChangeOrigin::Filesystem);
        Some((relative, origin))
    };
    let map_all = |change: FileChangeKind| -> Vec<(String, FileChangeKind, ChangeOrigin)> {
        paths
            .iter()
            .filter_map(|path| keep(path).map(|(relative, origin)| (relative, change, origin)))
            .collect()
    };
    match kind {
        EventKind::Create(_) => map_all(FileChangeKind::Created),
        EventKind::Remove(_) => map_all(FileChangeKind::Deleted),
        // A rename reported with both endpoints becomes a delete of the source and a create of the
        // destination; a single-ended rename is reported as a neutral modification because the
        // endpoint (from vs. to) is ambiguous.
        EventKind::Modify(ModifyKind::Name(_)) if paths.len() >= 2 => {
            let mut changes = Vec::new();
            if let Some((source, origin)) = keep(&paths[0]) {
                changes.push((source, FileChangeKind::Deleted, origin));
            }
            for path in &paths[1..] {
                if let Some((destination, origin)) = keep(path) {
                    changes.push((destination, FileChangeKind::Created, origin));
                }
            }
            changes
        }
        EventKind::Modify(_) => map_all(FileChangeKind::Modified),
        // Access events carry no change; anything else is treated conservatively as a modification.
        EventKind::Access(_) => Vec::new(),
        _ => map_all(FileChangeKind::Modified),
    }
}

/// Coalesce two origins for the same path within one quiet period.
///
/// An external write always wins. If anyone other than PARALITH touched the path during the
/// window, the batch is no longer purely our own output and must reach the editor and the
/// analyzers — the conservative direction, because the cost of a wrong "external" is one extra
/// analysis while the cost of a wrong "self" is a change that is silently never seen.
fn merge_origin(existing: Option<ChangeOrigin>, incoming: ChangeOrigin) -> ChangeOrigin {
    match existing {
        Some(existing) if incoming.is_self_write() => existing,
        Some(_) | None => incoming,
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
    use uuid::Uuid;

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
            vec![(
                "src/new.rs".to_owned(),
                FileChangeKind::Created,
                ChangeOrigin::Filesystem
            )]
        );

        let modified = classify_event(
            &root(),
            &[under(&["a.txt"])],
            &EventKind::Modify(ModifyKind::Data(notify::event::DataChange::Content)),
            &ledger,
        );
        assert_eq!(
            modified,
            vec![(
                "a.txt".to_owned(),
                FileChangeKind::Modified,
                ChangeOrigin::Filesystem
            )]
        );

        let removed = classify_event(
            &root(),
            &[under(&["gone.txt"])],
            &EventKind::Remove(RemoveKind::File),
            &ledger,
        );
        assert_eq!(
            removed,
            vec![(
                "gone.txt".to_owned(),
                FileChangeKind::Deleted,
                ChangeOrigin::Filesystem
            )]
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
                (
                    "old.txt".to_owned(),
                    FileChangeKind::Deleted,
                    ChangeOrigin::Filesystem
                ),
                (
                    "new.txt".to_owned(),
                    FileChangeKind::Created,
                    ChangeOrigin::Filesystem
                ),
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
    fn paralith_own_writes_are_attributed_rather_than_dropped() {
        let ledger = SelfWriteLedger::default();
        let path = under(&["saved.rs"]);
        ledger.mark(&path);
        let changes = classify_event(
            &root(),
            &[path],
            &EventKind::Modify(ModifyKind::Data(notify::event::DataChange::Content)),
            &ledger,
        );
        assert_eq!(changes.len(), 1, "the change is still observed");
        assert_eq!(changes[0].2, ChangeOrigin::User);
        assert!(
            changes[0].2.is_self_write(),
            "a self-write must be filterable, which is what keeps it out of the editor"
        );
    }

    #[test]
    fn the_memory_mirror_is_distinguishable_from_a_user_editing_the_same_directory() {
        let ledger = SelfWriteLedger::default();
        let mirrored = under(&[".paralith", "memory", "auth.md"]);
        let skill = under(&[".paralith", "skills", "review.md"]);
        ledger.mark_origin(&mirrored, ChangeOrigin::MemoryMirror);

        let changes = classify_event(
            &root(),
            &[mirrored, skill],
            &EventKind::Modify(ModifyKind::Data(notify::event::DataChange::Content)),
            &ledger,
        );
        let by_path: HashMap<String, ChangeOrigin> = changes
            .iter()
            .map(|(path, _, origin)| (path.clone(), *origin))
            .collect();
        assert_eq!(
            by_path[".paralith/memory/auth.md"],
            ChangeOrigin::MemoryMirror,
            "the mirror writing itself must be suppressible"
        );
        assert_eq!(
            by_path[".paralith/skills/review.md"],
            ChangeOrigin::Filesystem,
            "an unstamped .paralith edit is an ordinary external change"
        );
    }

    #[test]
    fn an_external_write_during_the_same_window_outranks_a_self_write() {
        assert_eq!(
            merge_origin(Some(ChangeOrigin::MemoryMirror), ChangeOrigin::Filesystem),
            ChangeOrigin::Filesystem
        );
        assert_eq!(
            merge_origin(Some(ChangeOrigin::Filesystem), ChangeOrigin::MemoryMirror),
            ChangeOrigin::Filesystem
        );
        assert_eq!(merge_origin(None, ChangeOrigin::Skill), ChangeOrigin::Skill);
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

    fn project_at(root: &Path) -> crate::models::Project {
        let now = chrono::Utc::now().to_rfc3339();
        let root_path = crate::services::project_service::display_path(root);
        crate::models::Project {
            id: Uuid::new_v4().to_string(),
            name: "watch-fixture".into(),
            root_path: root_path.clone(),
            canonical_root_path: if cfg!(windows) {
                root_path.to_lowercase()
            } else {
                root_path
            },
            git_branch: None,
            detected_framework: None,
            package_manager: None,
            major_languages: Vec::new(),
            is_git_repository: false,
            has_package_json: false,
            has_lockfile: false,
            created_at: now.clone(),
            updated_at: now.clone(),
            last_opened_at: now,
        }
    }

    #[test]
    fn project_session_watcher_is_idempotent_and_independent_of_code_surface() {
        let database = Arc::new(DatabaseService::in_memory().unwrap());
        let root = std::fs::canonicalize(std::env::temp_dir())
            .unwrap()
            .join(format!("paralith-watch-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let project = database.upsert_project(&project_at(&root)).unwrap();
        let service = FileWatchService::new_for_tests(database, SelfWriteLedger::default());

        service.ensure_project_session_watch(&project.id).unwrap();
        assert_eq!(service.watcher_count(), 1);
        assert_eq!(
            service.subscriber_count_for_project(&project.id).unwrap(),
            1
        );

        service.ensure_project_session_watch(&project.id).unwrap();
        assert_eq!(
            service.watcher_count(),
            1,
            "repeat opens reuse one native watcher"
        );
        assert_eq!(
            service.subscriber_count_for_project(&project.id).unwrap(),
            1,
            "repeat opens do not add duplicate session subscribers"
        );

        service.watch(&project.id, "main").unwrap();
        assert_eq!(service.watcher_count(), 1);
        assert_eq!(
            service.subscriber_count_for_project(&project.id).unwrap(),
            2,
            "Code Surface subscribes to the existing Project watcher"
        );
        service.unwatch(&project.id, "main");
        assert_eq!(
            service.subscriber_count_for_project(&project.id).unwrap(),
            1,
            "the Project session keeps Memory watching after Code Surface unmounts"
        );
        service.release_project_session_watch(&project.id);
        assert_eq!(service.watcher_count(), 0);
        let _ = std::fs::remove_dir_all(root);
    }
}

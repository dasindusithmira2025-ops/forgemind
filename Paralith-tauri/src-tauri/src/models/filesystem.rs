use serde::{Deserialize, Serialize};

/// What a directory entry resolves to on disk. `Symlink` is reported for links whose target
/// could not be read (broken links); a link to a real file or directory inside the Project is
/// reported as its resolved kind so the Explorer can treat it normally.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FileKind {
    File,
    Directory,
    Symlink,
}

/// The dominant line ending of a decoded text file. `Mixed` means both `\n` and `\r\n` are
/// present; `None` means the file has no line breaks. The editor uses this to keep saved
/// content consistent with what was opened.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LineEnding {
    Lf,
    Crlf,
    Mixed,
    None,
}

/// How a file's bytes were interpreted. `Binary` files are never decoded to text; `Utf8Bom`
/// preserves the knowledge that the file began with a UTF-8 byte-order mark.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FileEncoding {
    Utf8,
    Utf8Bom,
    Binary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryEntry {
    pub name: String,
    /// Forward-slash path relative to the Project root. Stable across platforms.
    pub relative_path: String,
    pub kind: FileKind,
    pub size: u64,
    pub modified_ms: Option<i64>,
    pub is_symlink: bool,
    /// A symbolic link whose target metadata could not be read.
    pub symlink_broken: bool,
    /// Dotfile or dot-directory. The Explorer hides these unless the user opts in.
    pub is_hidden: bool,
    pub readonly: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryListing {
    pub project_id: String,
    pub relative_path: String,
    pub entries: Vec<DirectoryEntry>,
    /// The directory held more entries than PARALITH will return in one listing.
    pub truncated: bool,
    pub total_entries: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContents {
    pub project_id: String,
    pub relative_path: String,
    /// Decoded text, or `None` when the file is binary and therefore not editable as text.
    pub content: Option<String>,
    /// Hex SHA-256 of the exact bytes on disk. Callers keep this to detect concurrent changes
    /// on the next write.
    pub sha256: String,
    pub size: u64,
    pub encoding: FileEncoding,
    pub line_ending: LineEnding,
    pub binary: bool,
    pub readonly: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileWriteResult {
    pub project_id: String,
    pub relative_path: String,
    pub sha256: String,
    pub size: u64,
    pub modified_ms: Option<i64>,
}

/// Compact description of a path produced by a mutation (create / rename / copy).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsEntryInfo {
    pub project_id: String,
    pub relative_path: String,
    pub name: String,
    pub kind: FileKind,
    pub size: u64,
    pub modified_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsPath {
    pub project_id: String,
    pub relative_path: String,
}

/// Bounded list of a Project's source files for Quick Open. `truncated` indicates the walk hit
/// its file cap before exhausting the tree.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFileIndex {
    pub project_id: String,
    pub files: Vec<String>,
    pub truncated: bool,
}

/// The kind of change the watcher observed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FileChangeKind {
    Created,
    Modified,
    Deleted,
}

/// Who caused a change.
///
/// This replaces a path blacklist with a fact. `.paralith/` used to be excluded wholesale from
/// knowledge analysis, because the Markdown memory mirror lives there and a memory save must not
/// invalidate memories. That blacklist was a *path* test standing in for an *origin* test, and it
/// stopped being correct the moment `.paralith/` also held Skills, Bases, and Canvases — artifacts
/// a user genuinely edits, whose changes genuinely should reach the Context Fabric.
///
/// Origin is recorded at the write, not inferred at the read: [`crate::services::SelfWriteLedger`]
/// stamps every PARALITH-originated write, and the watcher reads the stamp back. A change with no
/// stamp is [`ChangeOrigin::Filesystem`] — an external editor, a `git checkout`, or an agent
/// process writing directly — which is exactly the set that should be analyzed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChangeOrigin {
    /// A person editing through PARALITH's own Code surface.
    User,
    /// Not stamped by PARALITH: an external editor, a VCS operation, or an agent's own process.
    #[default]
    Filesystem,
    /// A write PARALITH made on an agent's behalf, such as an MCP tool call.
    Agent,
    /// The Markdown memory mirror writing itself. The one origin that must never reach impact
    /// analysis, because it *is* the output of the knowledge it would invalidate.
    MemoryMirror,
    Skill,
    Canvas,
    Base,
    Import,
    /// PARALITH internals that are not one of the above.
    System,
}

impl ChangeOrigin {
    /// Whether PARALITH itself produced this write.
    ///
    /// A self-write is never reported to the Code surface as an external change, and never enters
    /// knowledge impact analysis: both would be the application reacting to its own output.
    pub fn is_self_write(self) -> bool {
        !matches!(self, Self::Filesystem)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFileChange {
    pub relative_path: String,
    pub kind: FileChangeKind,
    pub origin: ChangeOrigin,
}

/// A debounced, coalesced batch of filesystem changes for one Project, delivered to every
/// window authorized for that Project.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFileChangeBatch {
    pub project_id: String,
    pub changes: Vec<ProjectFileChange>,
}

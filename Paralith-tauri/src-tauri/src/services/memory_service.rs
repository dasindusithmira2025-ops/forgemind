//! Context Fabric application service.
//!
//! This is the layer between the Tauri commands and the two stores a memory actually lives in:
//! SQLite (authoritative, indexed, queryable) and a Markdown mirror inside the Project
//! (portable, diffable, readable without Paralith).
//!
//! ## Why SQLite is canonical and Markdown is a mirror
//!
//! The v8 schema makes revisions immutable at the database level, which is what makes history,
//! provenance, and evidence trustworthy. Making files canonical instead would mean rebuilding
//! that guarantee on top of a directory anyone can edit, and would require a two-way
//! reconciliation engine before the first memory could be saved. So the database leads and the
//! file follows — but the file is a *complete* document with frontmatter, not an export stub, so
//! the knowledge genuinely survives without this application.
//!
//! ponytail: the mirror is one-directional. Editing `.paralith/memory/*.md` outside Paralith does
//! not currently flow back into the database. The upgrade path is an import pass that reads the
//! directory and writes changed files back through `save_memory` — the file already carries every
//! field that would need, which is why the mirror is written as a full document today.

use crate::database::DatabaseService;
use crate::errors::{AppError, AppResult};
use crate::models::graph::*;
use crate::models::intelligence::TimelineKind;
use crate::models::memory::*;
use crate::services::filesystem_service::FileSystemService;
use crate::services::memory_markdown::{
    parse_memory, reject_secrets, render_markdown, slugify, MAX_MEMORY_BODY_BYTES,
};
use std::sync::Arc;

/// Directory inside the Project holding the portable Markdown mirror.
const MEMORY_DIRECTORY: &str = ".paralith/memory";

/// Longest staleness reason stored. It is a sentence explaining why a memory should be re-read,
/// not a place to paste a build log.
const MAX_STALE_REASON_BYTES: usize = 500;

/// Source types accepted for evidence. An unknown type is rejected rather than stored, so the
/// provenance vocabulary stays closed and the UI can render every source it receives.
const SOURCE_TYPES: &[&str] = &[
    "file", "commit", "command", "test", "run", "task", "url", "note",
];

/// Relation vocabulary. Keeping this closed is what makes the knowledge graph typed rather than
/// a bag of arbitrary strings; new kinds are added here deliberately.
const RELATION_TYPES: &[&str] = &[
    "supersedes",
    "contradicts",
    "supports",
    "depends_on",
    "implements",
    "documents",
    "derived_from",
    "related_to",
];

#[derive(Clone)]
pub struct MemoryService {
    database: Arc<DatabaseService>,
    filesystem: FileSystemService,
}

impl MemoryService {
    pub fn new(database: Arc<DatabaseService>, filesystem: FileSystemService) -> Self {
        Self {
            database,
            filesystem,
        }
    }

    pub fn list(&self, project_id: &str, limit: Option<usize>) -> AppResult<Vec<MemorySummary>> {
        self.database.list_memories(project_id, limit)
    }

    pub fn get(&self, project_id: &str, item_id: &str) -> AppResult<MemoryDetail> {
        self.database.get_memory(project_id, item_id)
    }

    pub fn search(&self, request: &SearchMemoryRequest) -> AppResult<Vec<MemorySearchHit>> {
        self.database
            .search_memories(&request.project_id, &request.query, request.limit)
    }

    pub fn connections(&self, project_id: &str, item_id: &str) -> AppResult<MemoryConnections> {
        self.database.memory_connections(project_id, item_id)
    }

    pub fn history(
        &self,
        project_id: &str,
        item_id: &str,
    ) -> AppResult<Vec<MemoryRevisionSummary>> {
        self.database.memory_history(project_id, item_id)
    }

    pub fn revision_body(
        &self,
        project_id: &str,
        item_id: &str,
        revision_id: &str,
    ) -> AppResult<String> {
        self.database
            .memory_revision_body(project_id, item_id, revision_id)
    }

    /// Validate, parse, persist, then mirror.
    ///
    /// Order matters: the secret check runs before anything is written, so rejected content never
    /// reaches the database, the FTS index, or the filesystem.
    ///
    /// A failure to write the mirror does not fail the save — the knowledge is already durable in
    /// SQLite, and a read-only or missing Project folder must not cost the user their edit. The
    /// consequence is visible rather than hidden: `filePath` on the returned memory stays `null`,
    /// which is what the inspector renders as "not mirrored to the Project".
    pub fn save(&self, request: &SaveMemoryRequest) -> AppResult<MemoryDetail> {
        if request.body.len() > MAX_MEMORY_BODY_BYTES {
            return Err(AppError::new(
                "memory_too_large",
                "This memory is too large to store.",
                true,
            )
            .layer("memory"));
        }
        reject_secrets(&request.title)?;
        reject_secrets(&request.body)?;
        let parsed = parse_memory(&request.body);
        let creating = request.item_id.is_none();
        let item_id = self.database.save_memory(request, &parsed)?;

        if request.write_file.unwrap_or(true) {
            if let Ok(relative) = self.mirror_to_project(&request.project_id, &item_id) {
                self.database.set_memory_file_path(&item_id, &relative)?;
            }
        }
        // Knowledge history is appended here rather than by each caller, so a memory written by a
        // person, an agent, or the candidate pipeline all appear on the Timeline identically.
        // Best-effort: a timeline write must never fail the save it describes.
        let _ = self.database.append_timeline(
            &request.project_id,
            if creating {
                TimelineKind::MemoryCreated
            } else {
                TimelineKind::MemoryRevised
            },
            &request.title,
            None,
            "user",
            Some(&item_id),
            None,
            None,
        );
        self.database.get_memory(&request.project_id, &item_id)
    }

    /// Write `.paralith/memory/<slug>.md` through the Project path guard.
    ///
    /// The guard is what keeps this inside the Project: the slug is derived from the title by
    /// `slugify`, which emits only alphanumerics and `-`, and the resulting relative path is then
    /// still resolved and containment-checked by `FileSystemService`. There is no path the caller
    /// controls directly.
    fn mirror_to_project(&self, project_id: &str, item_id: &str) -> AppResult<String> {
        let detail = self.database.get_memory(project_id, item_id)?;
        self.ensure_memory_directory(project_id)?;
        let slug = slugify(&detail.summary.slug);
        if slug.is_empty() {
            return Err(AppError::new(
                "memory_path_unavailable",
                "This memory has no usable file name.",
                true,
            )
            .layer("memory"));
        }
        let relative = format!("{MEMORY_DIRECTORY}/{slug}.md");
        let properties: Vec<(String, String)> = detail
            .properties
            .iter()
            .map(|property| (property.key.clone(), property.value.clone()))
            .collect();
        let document = render_markdown(
            &detail.summary.title,
            &detail.summary.memory_type,
            detail.summary.quality.as_str(),
            &detail.summary.tags,
            &properties,
            &detail.body,
        );
        // `expected_sha256: None` — the database is authoritative, so the mirror is always
        // overwritten from it rather than conflict-checked against whatever is on disk.
        //
        // The `MemoryMirror` origin is what stops this write from re-entering impact analysis as a
        // repository change. Without it, saving a memory would queue an analysis that could mark
        // that same memory stale — the feedback loop the whole origin model exists to break.
        self.filesystem.write_file_as(
            project_id,
            &relative,
            &document,
            None,
            crate::models::ChangeOrigin::MemoryMirror,
        )?;
        Ok(relative)
    }

    /// Create `.paralith` and `.paralith/memory` if they are missing. `create_directory` reports
    /// an existing directory as an error, which is the expected steady state here.
    fn ensure_memory_directory(&self, project_id: &str) -> AppResult<()> {
        for directory in [".paralith", MEMORY_DIRECTORY] {
            match self.filesystem.create_directory(project_id, directory) {
                Ok(_) => {}
                Err(error) if error.code == "path_exists" => {}
                Err(error) => return Err(error),
            }
        }
        Ok(())
    }

    pub fn set_quality(&self, request: &SetMemoryQualityRequest) -> AppResult<MemoryDetail> {
        self.database.set_memory_quality(request)?;
        // Quality is rendered into the mirror's frontmatter, so the file has to follow.
        let _ = self.mirror_to_project(&request.project_id, &request.item_id);
        let detail = self
            .database
            .get_memory(&request.project_id, &request.item_id)?;
        // A promotion to `verified` is a different event from an ordinary quality change: it is
        // the moment the project decided to rely on something, which is what a reader scanning the
        // Timeline is usually looking for.
        let _ = self.database.append_timeline(
            &request.project_id,
            if request.quality == MemoryQuality::Verified {
                TimelineKind::Verified
            } else {
                TimelineKind::QualityChanged
            },
            &detail.summary.title,
            Some(request.quality.as_str()),
            "user",
            Some(&request.item_id),
            None,
            None,
        );
        Ok(detail)
    }

    pub fn set_pinned(&self, project_id: &str, item_id: &str, pinned: bool) -> AppResult<()> {
        self.database.set_memory_pinned(project_id, item_id, pinned)
    }

    pub fn archive(&self, project_id: &str, item_id: &str) -> AppResult<()> {
        self.database.archive_memory(project_id, item_id)
    }

    pub fn save_claim(&self, request: &SaveClaimRequest) -> AppResult<Vec<MemoryClaim>> {
        reject_secrets(&request.statement)?;
        self.database.save_claim(request)?;
        // A claim is the unit that actually goes stale or gets contradicted, so a change to one is
        // a knowledge event in its own right — not merely a revision of the document holding it.
        let _ = self.database.append_timeline(
            &request.project_id,
            TimelineKind::ClaimChanged,
            &request.statement,
            Some(request.status.as_str()),
            "user",
            Some(&request.item_id),
            None,
            None,
        );
        Ok(self
            .database
            .get_memory(&request.project_id, &request.item_id)?
            .claims)
    }

    pub fn delete_claim(
        &self,
        project_id: &str,
        item_id: &str,
        claim_id: &str,
    ) -> AppResult<Vec<MemoryClaim>> {
        self.database.delete_claim(project_id, claim_id)?;
        Ok(self.database.get_memory(project_id, item_id)?.claims)
    }

    /// Attach evidence. A `file` source must resolve inside the Project root; every other source
    /// type carries a caller-supplied URI that is stored but never dereferenced here.
    pub fn attach_source(&self, request: &AttachSourceRequest) -> AppResult<MemoryDetail> {
        if !SOURCE_TYPES.contains(&request.source_type.as_str()) {
            return Err(AppError::new(
                "unsupported_source_type",
                "That evidence type is not supported.",
                true,
            )
            .entity(&request.source_type)
            .layer("memory"));
        }
        if let Some(excerpt) = &request.excerpt {
            reject_secrets(excerpt)?;
        }
        let uri = if request.source_type == "file" {
            let path = request.file_path.as_deref().ok_or_else(|| {
                AppError::new(
                    "source_path_required",
                    "A file evidence record needs a path.",
                    true,
                )
                .layer("memory")
            })?;
            // The guard rejects traversal, absolute paths, and symlink escape before any row is
            // written, so a stored `file` source can only ever name something in this Project.
            let normalized = self
                .filesystem
                .resolve_project_relative(&request.project_id, path)?;
            match (request.line_start, request.line_end) {
                (Some(start), Some(end)) => format!("file:{normalized}#L{start}-L{end}"),
                (Some(start), None) => format!("file:{normalized}#L{start}"),
                _ => format!("file:{normalized}"),
            }
        } else {
            request
                .uri
                .clone()
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| {
                    AppError::new(
                        "source_uri_required",
                        "This evidence needs a reference.",
                        true,
                    )
                    .layer("memory")
                })?
        };
        self.database.attach_source(request, &uri)?;
        self.database
            .get_memory(&request.project_id, &request.item_id)
    }

    pub fn save_relation(&self, request: &SaveRelationRequest) -> AppResult<Vec<MemoryRelation>> {
        if !RELATION_TYPES.contains(&request.relation_type.as_str()) {
            return Err(AppError::new(
                "unsupported_relation_type",
                "That relationship type is not supported.",
                true,
            )
            .entity(&request.relation_type)
            .layer("memory"));
        }
        self.database.save_relation(request)?;
        Ok(self
            .database
            .get_memory(&request.project_id, &request.from_item_id)?
            .relations)
    }

    pub fn delete_relation(
        &self,
        project_id: &str,
        item_id: &str,
        relation_id: &str,
    ) -> AppResult<Vec<MemoryRelation>> {
        self.database.delete_relation(project_id, relation_id)?;
        Ok(self.database.get_memory(project_id, item_id)?.relations)
    }

    /// Project a graph slice. The service adds no logic of its own — the projection belongs in
    /// SQL, where it can be a single indexed pass rather than a fan-out of per-node reads.
    pub fn graph(&self, request: &GraphRequest) -> AppResult<KnowledgeGraph> {
        self.database.knowledge_graph(request)
    }

    /// Memories a change to `file_path` puts in question.
    ///
    /// The path is validated against the Project root before it reaches SQL. Impact is a read,
    /// but it is a read keyed by a renderer-supplied path, and a path that escapes the Project
    /// must not be able to probe which files another Project's knowledge cites.
    pub fn impact(
        &self,
        project_id: &str,
        file_path: &str,
        limit: Option<usize>,
    ) -> AppResult<ImpactReport> {
        let relative = self
            .filesystem
            .normalize_project_relative(project_id, file_path)?;
        self.database.impact_report(project_id, &relative, limit)
    }

    pub fn health(&self, project_id: &str) -> AppResult<KnowledgeHealth> {
        self.database.knowledge_health(project_id)
    }

    /// Flag memories for re-verification, or clear the flag with an empty reason.
    ///
    /// The reason is user- and agent-supplied text that ends up on a knowledge surface, so it
    /// goes through the same secret rejection as a memory body. It is capped because a stale
    /// reason is a sentence, not a log.
    pub fn mark_stale(
        &self,
        project_id: &str,
        item_ids: &[String],
        reason: Option<&str>,
    ) -> AppResult<usize> {
        let reason = reason.map(str::trim).filter(|value| !value.is_empty());
        if let Some(reason) = reason {
            if reason.len() > MAX_STALE_REASON_BYTES {
                return Err(AppError::new(
                    "stale_reason_too_long",
                    "That staleness reason is too long.",
                    true,
                )
                .layer("memory"));
            }
            reject_secrets(reason)?;
        }
        let marked = self
            .database
            .mark_memories_stale(project_id, item_ids, reason)?;
        // Only a *set* reason is history. Clearing the flag is a correction, not a change in what
        // the project knows, and recording it would make the Timeline noisier without saying more.
        if let Some(reason) = reason {
            for item_id in item_ids {
                let title = self
                    .database
                    .get_memory(project_id, item_id)
                    .map(|detail| detail.summary.title)
                    .unwrap_or_else(|_| item_id.clone());
                let _ = self.database.append_timeline(
                    project_id,
                    TimelineKind::MarkedStale,
                    &title,
                    Some(reason),
                    "system",
                    Some(item_id),
                    None,
                    None,
                );
            }
        }
        Ok(marked)
    }

    /// The closed vocabularies, so the renderer builds its pickers from the backend contract
    /// rather than hard-coding a list that can drift out of sync.
    pub fn vocabulary() -> (Vec<String>, Vec<String>) {
        (
            RELATION_TYPES
                .iter()
                .map(|value| value.to_string())
                .collect(),
            SOURCE_TYPES.iter().map(|value| value.to_string()).collect(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::filesystem_service::SelfWriteLedger;
    use chrono::Utc;
    use std::path::PathBuf;
    use uuid::Uuid;

    /// A real on-disk Project root, so the Markdown mirror and the path guard are exercised for
    /// real rather than stubbed. The database stays in memory.
    struct Fixture {
        service: MemoryService,
        database: Arc<DatabaseService>,
        project_id: String,
        root: PathBuf,
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    fn fixture() -> Fixture {
        let database = Arc::new(DatabaseService::in_memory().unwrap());
        let root = std::fs::canonicalize(std::env::temp_dir())
            .unwrap()
            .join(format!("paralith-memory-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let project_id = seed_project(&database, &root);
        let filesystem = FileSystemService::new(Arc::clone(&database), SelfWriteLedger::default());
        let service = MemoryService::new(Arc::clone(&database), filesystem);
        Fixture {
            service,
            database,
            project_id,
            root,
        }
    }

    fn seed_project(database: &DatabaseService, root: &std::path::Path) -> String {
        let now = Utc::now().to_rfc3339();
        let root_path = crate::services::project_service::display_path(root);
        let canonical_root_path = if cfg!(windows) {
            root_path.to_lowercase()
        } else {
            root_path.clone()
        };
        let project = crate::models::Project {
            id: Uuid::new_v4().to_string(),
            name: "fixture".into(),
            root_path,
            canonical_root_path,
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
        };
        database.upsert_project(&project).unwrap();
        project.id
    }

    fn save(fixture: &Fixture, title: &str, body: &str) -> MemoryDetail {
        fixture
            .service
            .save(&SaveMemoryRequest {
                project_id: fixture.project_id.clone(),
                item_id: None,
                title: title.into(),
                body: body.into(),
                memory_type: Some("decision".into()),
                workspace_id: None,
                branch_name: None,
                write_file: Some(true),
            })
            .unwrap()
    }

    fn revise(fixture: &Fixture, item_id: &str, title: &str, body: &str) -> MemoryDetail {
        fixture
            .service
            .save(&SaveMemoryRequest {
                project_id: fixture.project_id.clone(),
                item_id: Some(item_id.into()),
                title: title.into(),
                body: body.into(),
                memory_type: None,
                workspace_id: None,
                branch_name: None,
                write_file: Some(true),
            })
            .unwrap()
    }

    #[test]
    fn saving_a_memory_derives_slug_tags_properties_and_links() {
        let fixture = fixture();
        let detail = save(
            &fixture,
            "ADR 14: Token Rotation",
            "---\ntags:\n  - auth\ncomponent: AuthService\n---\n\nRefresh tokens rotate. See [[Token Repository]].",
        );
        assert_eq!(detail.summary.slug, "adr-14-token-rotation");
        assert_eq!(detail.summary.tags, vec!["auth"]);
        assert_eq!(detail.summary.revision_number, 1);
        assert_eq!(detail.summary.quality, MemoryQuality::Working);
        assert!(detail
            .properties
            .iter()
            .any(|property| property.key == "component" && property.value == "AuthService"));
        assert_eq!(detail.outgoing_links.len(), 1);
        // The target does not exist yet: an unresolved link is a normal row, not an error.
        assert_eq!(detail.outgoing_links[0].target_slug, "token-repository");
        assert!(detail.outgoing_links[0].target_item_id.is_none());
        // Frontmatter is stripped from the stored body.
        assert!(!detail.body.contains("tags:"));
    }

    #[test]
    fn a_link_resolves_once_its_target_exists() {
        let fixture = fixture();
        let source = save(&fixture, "Auth Design", "Depends on [[Token Repository]].");
        let target = save(
            &fixture,
            "Token Repository",
            "Stores hashed refresh tokens.",
        );
        let reloaded = fixture
            .service
            .get(&fixture.project_id, &source.summary.id)
            .unwrap();
        assert_eq!(
            reloaded.outgoing_links[0].target_item_id.as_deref(),
            Some(target.summary.id.as_str())
        );
    }

    #[test]
    fn editing_appends_a_revision_and_an_identical_save_does_not() {
        let fixture = fixture();
        let created = save(&fixture, "Auth Design", "First body.");
        let edited = revise(&fixture, &created.summary.id, "Auth Design", "Second body.");
        assert_eq!(edited.summary.revision_number, 2);

        let unchanged = revise(&fixture, &created.summary.id, "Auth Design", "Second body.");
        assert_eq!(unchanged.summary.revision_number, 2);

        let history = fixture
            .service
            .history(&fixture.project_id, &created.summary.id)
            .unwrap();
        assert_eq!(history.len(), 2);
        assert_eq!(history[0].revision_number, 2);
        // The superseded body is still readable — history is append-only, not a title log.
        let old = fixture
            .service
            .revision_body(&fixture.project_id, &created.summary.id, &history[1].id)
            .unwrap();
        assert_eq!(old.trim(), "First body.");
    }

    #[test]
    fn backlinks_resolve_through_the_slug_and_through_aliases() {
        let fixture = fixture();
        let target = save(
            &fixture,
            "Authentication Service",
            "---\naliases:\n  - Auth Service\n---\n\nOwns login.",
        );
        save(
            &fixture,
            "Rotation ADR",
            "Implemented in [[Authentication Service]].",
        );
        save(&fixture, "Session Notes", "Handled by [[Auth Service]].");

        let connections = fixture
            .service
            .connections(&fixture.project_id, &target.summary.id)
            .unwrap();
        let titles: Vec<&str> = connections
            .backlinks
            .iter()
            .map(|backlink| backlink.source_title.as_str())
            .collect();
        assert_eq!(titles.len(), 2);
        assert!(titles.contains(&"Rotation ADR"));
        assert!(titles.contains(&"Session Notes"));
        assert!(!connections.backlinks[0].excerpt.is_empty());
        assert!(!connections.orphan);
    }

    #[test]
    fn a_prose_mention_is_a_suggestion_and_a_linked_one_is_not() {
        let fixture = fixture();
        let target = save(&fixture, "Token Repository", "Stores tokens.");
        save(
            &fixture,
            "Mentions It",
            "The Token Repository is involved here.",
        );
        save(&fixture, "Links It", "See [[Token Repository]].");

        let connections = fixture
            .service
            .connections(&fixture.project_id, &target.summary.id)
            .unwrap();
        let mentions: Vec<&str> = connections
            .unlinked_mentions
            .iter()
            .map(|mention| mention.source_title.as_str())
            .collect();
        assert_eq!(mentions, vec!["Mentions It"]);
        assert_eq!(connections.backlinks.len(), 1);
    }

    #[test]
    fn an_isolated_memory_reports_as_an_orphan() {
        let fixture = fixture();
        let alone = save(&fixture, "Standalone Note", "Nothing points here.");
        let connections = fixture
            .service
            .connections(&fixture.project_id, &alone.summary.id)
            .unwrap();
        assert!(connections.orphan);
    }

    #[test]
    fn search_combines_full_text_with_structured_filters() {
        let fixture = fixture();
        save(
            &fixture,
            "Refresh Rotation",
            "---\ntags:\n  - auth\n---\n\nRefresh tokens rotate after each use.",
        );
        save(
            &fixture,
            "Layout Engine",
            "---\ntags:\n  - ui\n---\n\nPane splitting rules.",
        );

        let search = |query: &str| {
            fixture
                .service
                .search(&SearchMemoryRequest {
                    project_id: fixture.project_id.clone(),
                    query: query.into(),
                    limit: None,
                })
                .unwrap()
        };

        let lexical = search("rotate");
        assert_eq!(lexical.len(), 1);
        assert_eq!(lexical[0].summary.title, "Refresh Rotation");
        assert_eq!(lexical[0].match_reason, "lexical");
        assert!(lexical[0].snippet.to_lowercase().contains("rotate"));

        // Prefix matching: a partial term still finds the memory as the user types.
        assert_eq!(search("rotat").len(), 1);
        // Filter-only queries are a metadata listing, not an empty result.
        let tagged = search("tag:ui");
        assert_eq!(tagged.len(), 1);
        assert_eq!(tagged[0].match_reason, "filter");
        assert_eq!(search("type:decision").len(), 2);
        assert!(search("tag:auth splitting").is_empty());
    }

    #[test]
    fn search_input_cannot_become_full_text_query_syntax() {
        let fixture = fixture();
        save(&fixture, "Quoted", "Ordinary body text.");
        for hostile in ["\"", "*", "NEAR(a b)", "a OR b", "^", "body\"("] {
            // The assertion is that none of these error out; a raw pass-through would be an
            // FTS5 parse failure rather than an empty result set.
            fixture
                .service
                .search(&SearchMemoryRequest {
                    project_id: fixture.project_id.clone(),
                    query: hostile.into(),
                    limit: None,
                })
                .unwrap();
        }
    }

    #[test]
    fn one_projects_memory_is_invisible_to_another() {
        let fixture = fixture();
        let mine = save(&fixture, "Private Decision", "Only for this project.");
        let other_root = fixture.root.join("other");
        std::fs::create_dir_all(&other_root).unwrap();
        let other_project = seed_project(&fixture.database, &other_root);

        assert!(fixture
            .service
            .list(&other_project, None)
            .unwrap()
            .is_empty());
        assert_eq!(
            fixture
                .service
                .get(&other_project, &mine.summary.id)
                .unwrap_err()
                .code,
            "memory_not_found"
        );
        assert!(fixture
            .service
            .search(&SearchMemoryRequest {
                project_id: other_project.clone(),
                query: "Private".into(),
                limit: None,
            })
            .unwrap()
            .is_empty());
        assert_eq!(
            fixture
                .service
                .connections(&other_project, &mine.summary.id)
                .unwrap_err()
                .code,
            "memory_not_found"
        );
    }

    #[test]
    fn secret_shaped_content_never_reaches_the_database_or_the_disk() {
        let fixture = fixture();
        let error = fixture
            .service
            .save(&SaveMemoryRequest {
                project_id: fixture.project_id.clone(),
                item_id: None,
                title: "Deploy Notes".into(),
                body: "Use AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCY when deploying."
                    .into(),
                memory_type: None,
                workspace_id: None,
                branch_name: None,
                write_file: Some(true),
            })
            .unwrap_err();
        assert_eq!(error.code, "memory_secret_rejected");
        assert!(fixture
            .service
            .list(&fixture.project_id, None)
            .unwrap()
            .is_empty());
        assert!(!fixture.root.join(".paralith").exists());
    }

    #[test]
    fn the_markdown_mirror_is_a_complete_portable_document() {
        let fixture = fixture();
        let detail = save(
            &fixture,
            "Token Rotation",
            "---\ntags:\n  - auth\ncomponent: AuthService\n---\n\nRotate on use. See [[Auth Service]].",
        );
        let path = fixture.root.join(".paralith/memory/token-rotation.md");
        assert_eq!(
            detail.file_path.as_deref(),
            Some(".paralith/memory/token-rotation.md")
        );
        let written = std::fs::read_to_string(&path).unwrap();
        assert!(written.starts_with("---\n"));
        assert!(written.contains("title: Token Rotation"));
        assert!(written.contains("quality: working"));
        assert!(written.contains("  - auth"));
        assert!(written.contains("component: AuthService"));
        assert!(written.contains("[[Auth Service]]"));
        // The mirror-path bookkeeping property is not leaked back into the document.
        assert!(!written.contains("paralith-file"));

        // A quality change rewrites the mirror, so the file never contradicts the database.
        fixture
            .service
            .set_quality(&SetMemoryQualityRequest {
                project_id: fixture.project_id.clone(),
                item_id: detail.summary.id.clone(),
                quality: MemoryQuality::Canonical,
            })
            .unwrap();
        assert!(std::fs::read_to_string(&path)
            .unwrap()
            .contains("quality: canonical"));
    }

    #[test]
    fn colliding_titles_get_distinct_slugs_and_distinct_files() {
        let fixture = fixture();
        let first = save(&fixture, "Auth Notes", "One.");
        let second = save(&fixture, "Auth Notes", "Two.");
        assert_eq!(first.summary.slug, "auth-notes");
        assert_eq!(second.summary.slug, "auth-notes-2");
        assert!(fixture.root.join(".paralith/memory/auth-notes.md").exists());
        assert!(fixture
            .root
            .join(".paralith/memory/auth-notes-2.md")
            .exists());
    }

    #[test]
    fn file_evidence_must_resolve_inside_the_project_root() {
        let fixture = fixture();
        let detail = save(&fixture, "Auth Design", "Body.");
        std::fs::write(fixture.root.join("token.rs"), "fn rotate() {}").unwrap();

        let mut request = AttachSourceRequest {
            project_id: fixture.project_id.clone(),
            item_id: detail.summary.id.clone(),
            claim_id: None,
            source_type: "file".into(),
            file_path: Some("token.rs".into()),
            line_start: Some(1),
            line_end: Some(1),
            uri: None,
            excerpt: Some("fn rotate() {}".into()),
        };
        let attached = fixture.service.attach_source(&request).unwrap();
        assert_eq!(attached.sources.len(), 1);
        assert_eq!(attached.sources[0].uri, "file:token.rs#L1-L1");

        for escape in ["../outside.rs", "/etc/passwd", "..\\..\\outside.rs"] {
            request.file_path = Some(escape.into());
            let error = fixture.service.attach_source(&request).unwrap_err();
            assert_ne!(
                error.code, "memory_not_found",
                "{escape} must be refused by the path guard, not treated as a missing memory"
            );
            assert!(
                fixture
                    .service
                    .get(&fixture.project_id, &detail.summary.id)
                    .unwrap()
                    .sources
                    .len()
                    == 1,
                "{escape} must not have been recorded"
            );
        }

        // Attaching the same range twice reuses the source row rather than duplicating evidence.
        request.file_path = Some("token.rs".into());
        let again = fixture.service.attach_source(&request).unwrap();
        assert_eq!(again.sources.len(), 1);

        request.source_type = "screenshot".into();
        assert_eq!(
            fixture.service.attach_source(&request).unwrap_err().code,
            "unsupported_source_type"
        );
    }

    #[test]
    fn evidence_supports_a_claim_but_does_not_verify_it() {
        let fixture = fixture();
        let detail = save(&fixture, "Auth Design", "Body.");
        std::fs::write(fixture.root.join("token.rs"), "fn rotate() {}").unwrap();
        let claims = fixture
            .service
            .save_claim(&SaveClaimRequest {
                project_id: fixture.project_id.clone(),
                item_id: detail.summary.id.clone(),
                claim_id: None,
                statement: "Refresh tokens are stored hashed.".into(),
                status: ClaimStatus::Open,
                confidence: Some(0.6),
                valid_from: None,
                valid_until: None,
            })
            .unwrap();
        assert_eq!(claims.len(), 1);
        assert_eq!(claims[0].status, ClaimStatus::Open);

        fixture
            .service
            .attach_source(&AttachSourceRequest {
                project_id: fixture.project_id.clone(),
                item_id: detail.summary.id.clone(),
                claim_id: Some(claims[0].id.clone()),
                source_type: "file".into(),
                file_path: Some("token.rs".into()),
                line_start: None,
                line_end: None,
                uri: None,
                excerpt: None,
            })
            .unwrap();

        let reloaded = fixture
            .service
            .get(&fixture.project_id, &detail.summary.id)
            .unwrap();
        assert_eq!(reloaded.claims[0].status, ClaimStatus::Supported);
        assert_eq!(reloaded.claims[0].sources.len(), 1);
        assert!(reloaded.claims[0].verified_at.is_none());

        // Verification is a deliberate act and is the thing that stamps a time.
        let verified = fixture
            .service
            .save_claim(&SaveClaimRequest {
                project_id: fixture.project_id.clone(),
                item_id: detail.summary.id.clone(),
                claim_id: Some(reloaded.claims[0].id.clone()),
                statement: reloaded.claims[0].statement.clone(),
                status: ClaimStatus::Verified,
                confidence: Some(0.95),
                valid_from: None,
                valid_until: None,
            })
            .unwrap();
        assert_eq!(verified[0].status, ClaimStatus::Verified);
        assert!(verified[0].verified_at.is_some());
        // Evidence survives the status change.
        assert_eq!(verified[0].sources.len(), 1);
    }

    #[test]
    fn a_claim_cannot_be_attached_across_projects() {
        let fixture = fixture();
        let mine = save(&fixture, "Auth Design", "Body.");
        let other_root = fixture.root.join("other");
        std::fs::create_dir_all(&other_root).unwrap();
        let other_project = seed_project(&fixture.database, &other_root);
        let error = fixture
            .service
            .save_claim(&SaveClaimRequest {
                project_id: other_project,
                item_id: mine.summary.id.clone(),
                claim_id: None,
                statement: "Injected.".into(),
                status: ClaimStatus::Open,
                confidence: None,
                valid_from: None,
                valid_until: None,
            })
            .unwrap_err();
        assert_eq!(error.code, "memory_not_found");
    }

    #[test]
    fn relations_are_typed_bidirectional_and_project_scoped() {
        let fixture = fixture();
        let new_adr = save(&fixture, "ADR 15", "Replaces the old rule.");
        let old_adr = save(&fixture, "ADR 14", "The old rule.");

        let relations = fixture
            .service
            .save_relation(&SaveRelationRequest {
                project_id: fixture.project_id.clone(),
                from_item_id: new_adr.summary.id.clone(),
                to_item_id: old_adr.summary.id.clone(),
                relation_type: "supersedes".into(),
                confidence: None,
            })
            .unwrap();
        assert_eq!(relations.len(), 1);
        assert_eq!(relations[0].to_title, "ADR 14");
        // The superseded memory sees the same edge from its own side.
        let reverse = fixture
            .service
            .get(&fixture.project_id, &old_adr.summary.id)
            .unwrap();
        assert_eq!(reverse.relations.len(), 1);
        assert_eq!(reverse.relations[0].to_title, "ADR 15");

        assert_eq!(
            fixture
                .service
                .save_relation(&SaveRelationRequest {
                    project_id: fixture.project_id.clone(),
                    from_item_id: new_adr.summary.id.clone(),
                    to_item_id: old_adr.summary.id.clone(),
                    relation_type: "vibes_with".into(),
                    confidence: None,
                })
                .unwrap_err()
                .code,
            "unsupported_relation_type"
        );
        assert_eq!(
            fixture
                .service
                .save_relation(&SaveRelationRequest {
                    project_id: fixture.project_id.clone(),
                    from_item_id: new_adr.summary.id.clone(),
                    to_item_id: new_adr.summary.id.clone(),
                    relation_type: "supersedes".into(),
                    confidence: None,
                })
                .unwrap_err()
                .code,
            "relation_self_reference"
        );

        let removed = fixture
            .service
            .delete_relation(&fixture.project_id, &new_adr.summary.id, &relations[0].id)
            .unwrap();
        assert!(removed.is_empty());
    }

    #[test]
    fn archiving_removes_a_memory_from_search_without_destroying_it() {
        let fixture = fixture();
        let detail = save(
            &fixture,
            "Deprecated Rule",
            "Tokens expire after thirty minutes.",
        );
        fixture
            .service
            .archive(&fixture.project_id, &detail.summary.id)
            .unwrap();

        assert!(fixture
            .service
            .search(&SearchMemoryRequest {
                project_id: fixture.project_id.clone(),
                query: "thirty".into(),
                limit: None,
            })
            .unwrap()
            .is_empty());
        assert!(fixture
            .service
            .list(&fixture.project_id, None)
            .unwrap()
            .is_empty());
        // Canonical rows and history survive: this is knowledge about what was once believed.
        let still_there = fixture
            .service
            .get(&fixture.project_id, &detail.summary.id)
            .unwrap();
        assert_eq!(still_there.summary.state, "archived");
        assert!(still_there.body.contains("thirty minutes"));
        assert_eq!(
            fixture
                .service
                .history(&fixture.project_id, &detail.summary.id)
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn quality_promotion_stamps_verification_and_demotion_clears_it() {
        let fixture = fixture();
        let detail = save(&fixture, "Auth Design", "Body.");
        let set = |quality| {
            fixture
                .service
                .set_quality(&SetMemoryQualityRequest {
                    project_id: fixture.project_id.clone(),
                    item_id: detail.summary.id.clone(),
                    quality,
                })
                .unwrap()
        };
        assert!(set(MemoryQuality::Verified).summary.verified_at.is_some());
        assert!(set(MemoryQuality::Canonical).summary.verified_at.is_some());
        // A memory must never display "verified at …" under a quality that no longer claims it.
        let demoted = set(MemoryQuality::Deprecated);
        assert_eq!(demoted.summary.quality, MemoryQuality::Deprecated);
        assert!(demoted.summary.verified_at.is_none());
    }

    #[test]
    fn an_oversized_body_is_refused_before_anything_is_written() {
        let fixture = fixture();
        let error = fixture
            .service
            .save(&SaveMemoryRequest {
                project_id: fixture.project_id.clone(),
                item_id: None,
                title: "Huge".into(),
                body: "x".repeat(MAX_MEMORY_BODY_BYTES + 1),
                memory_type: None,
                workspace_id: None,
                branch_name: None,
                write_file: Some(true),
            })
            .unwrap_err();
        assert_eq!(error.code, "memory_too_large");
        assert!(fixture
            .service
            .list(&fixture.project_id, None)
            .unwrap()
            .is_empty());
    }

    // ---- Graph -------------------------------------------------------------------------------

    fn graph_request(fixture: &Fixture) -> GraphRequest {
        GraphRequest {
            project_id: fixture.project_id.clone(),
            ..GraphRequest::default()
        }
    }

    fn node_titles(graph: &KnowledgeGraph) -> Vec<String> {
        let mut titles: Vec<String> = graph.nodes.iter().map(|node| node.label.clone()).collect();
        titles.sort();
        titles
    }

    #[test]
    fn a_wikilink_becomes_an_edge_only_once_its_target_exists() {
        let fixture = fixture();
        let source = save(&fixture, "Auth Decision", "Uses [[Token Repository]].");

        // Target missing: the link is recorded but is not drawable, so the graph has one node.
        let before = fixture.service.graph(&graph_request(&fixture)).unwrap();
        assert_eq!(before.nodes.len(), 1);
        assert!(before.edges.is_empty());

        let target = save(&fixture, "Token Repository", "Stores refresh tokens.");
        let after = fixture.service.graph(&graph_request(&fixture)).unwrap();
        assert_eq!(after.edges.len(), 1);
        assert_eq!(after.edges[0].kind, edge_kind::LINK);
        assert!(after.edges[0].source.ends_with(&source.summary.id));
        assert!(after.edges[0].target.ends_with(&target.summary.id));
        // Degree is computed over the returned slice, and both ends carry it.
        assert!(after.nodes.iter().all(|node| node.degree == 1));
    }

    #[test]
    fn repeated_mentions_of_one_memory_are_a_single_edge() {
        let fixture = fixture();
        save(&fixture, "Token Repository", "Stores refresh tokens.");
        save(
            &fixture,
            "Auth Decision",
            "See [[Token Repository]] and again [[Token Repository]] and once more \
             [[Token Repository|the repo]].",
        );
        let graph = fixture.service.graph(&graph_request(&fixture)).unwrap();
        assert_eq!(graph.edges.len(), 1);
    }

    #[test]
    fn a_local_graph_expands_one_hop_at_a_time() {
        let fixture = fixture();
        let hub = save(&fixture, "Auth Decision", "Uses [[Token Repository]].");
        let middle = save(&fixture, "Token Repository", "Stores refresh tokens.");
        let far = save(&fixture, "Rotation Runbook", "How to rotate.");
        fixture
            .service
            .save_relation(&SaveRelationRequest {
                project_id: fixture.project_id.clone(),
                from_item_id: middle.summary.id.clone(),
                to_item_id: far.summary.id.clone(),
                relation_type: "documents".into(),
                confidence: None,
            })
            .unwrap();

        let one_hop = fixture
            .service
            .graph(&GraphRequest {
                focus_item_id: Some(hub.summary.id.clone()),
                depth: Some(1),
                ..graph_request(&fixture)
            })
            .unwrap();
        assert_eq!(node_titles(&one_hop), ["Auth Decision", "Token Repository"]);

        let two_hops = fixture
            .service
            .graph(&GraphRequest {
                focus_item_id: Some(hub.summary.id.clone()),
                depth: Some(2),
                ..graph_request(&fixture)
            })
            .unwrap();
        assert_eq!(
            node_titles(&two_hops),
            ["Auth Decision", "Rotation Runbook", "Token Repository"]
        );
        // Hop distance is reported, so the UI can fade by ring rather than guess.
        let far_node = two_hops
            .nodes
            .iter()
            .find(|node| node.label == "Rotation Runbook")
            .unwrap();
        assert_eq!(far_node.distance, Some(2));
        assert!(two_hops
            .focus_id
            .as_deref()
            .unwrap()
            .ends_with(&hub.summary.id));
    }

    #[test]
    fn an_isolated_memory_still_renders_as_its_own_node() {
        let fixture = fixture();
        let alone = save(&fixture, "Lonely Note", "No links here.");
        let graph = fixture
            .service
            .graph(&GraphRequest {
                focus_item_id: Some(alone.summary.id.clone()),
                depth: Some(3),
                ..graph_request(&fixture)
            })
            .unwrap();
        assert_eq!(graph.nodes.len(), 1);
        assert_eq!(graph.nodes[0].distance, Some(0));
    }

    #[test]
    fn relation_and_type_filters_narrow_the_graph() {
        let fixture = fixture();
        let one = save(&fixture, "Alpha", "a");
        let two = save(&fixture, "Beta", "b");
        fixture
            .service
            .save_relation(&SaveRelationRequest {
                project_id: fixture.project_id.clone(),
                from_item_id: one.summary.id.clone(),
                to_item_id: two.summary.id.clone(),
                relation_type: "depends_on".into(),
                confidence: Some(0.4),
            })
            .unwrap();

        let kept = fixture
            .service
            .graph(&GraphRequest {
                relation_types: vec!["depends_on".into()],
                ..graph_request(&fixture)
            })
            .unwrap();
        assert_eq!(kept.edges.len(), 1);

        let dropped = fixture
            .service
            .graph(&GraphRequest {
                relation_types: vec!["supersedes".into()],
                ..graph_request(&fixture)
            })
            .unwrap();
        assert!(dropped.edges.is_empty());

        // Confidence is a filter on edges, not on nodes: the memories stay, the weak edge goes.
        let confident = fixture
            .service
            .graph(&GraphRequest {
                min_confidence: Some(0.9),
                ..graph_request(&fixture)
            })
            .unwrap();
        assert_eq!(confident.nodes.len(), 2);
        assert!(confident.edges.is_empty());
    }

    #[test]
    fn evidence_and_tag_overlays_are_opt_in() {
        let fixture = fixture();
        let item = save(
            &fixture,
            "Auth Decision",
            "---\ntags:\n  - auth\n---\n\nBody.",
        );
        std::fs::create_dir_all(fixture.root.join("src")).unwrap();
        std::fs::write(fixture.root.join("src/token.rs"), "fn rotate() {}").unwrap();
        fixture
            .service
            .attach_source(&AttachSourceRequest {
                project_id: fixture.project_id.clone(),
                item_id: item.summary.id.clone(),
                claim_id: None,
                source_type: "file".into(),
                file_path: Some("src/token.rs".into()),
                line_start: Some(1),
                line_end: Some(1),
                uri: None,
                excerpt: None,
            })
            .unwrap();

        let plain = fixture.service.graph(&graph_request(&fixture)).unwrap();
        assert_eq!(plain.nodes.len(), 1, "memory-only graph must stay cheap");

        let overlaid = fixture
            .service
            .graph(&GraphRequest {
                include_kinds: vec![node_kind::FILE.into(), node_kind::TAG.into()],
                ..graph_request(&fixture)
            })
            .unwrap();
        assert!(overlaid
            .nodes
            .iter()
            .any(|node| node.kind == node_kind::FILE && node.sublabel == "src/token.rs"));
        assert!(overlaid
            .nodes
            .iter()
            .any(|node| node.kind == node_kind::TAG && node.label == "#auth"));
        assert!(overlaid
            .edges
            .iter()
            .any(|edge| edge.kind == edge_kind::EVIDENCE));
    }

    #[test]
    fn another_projects_knowledge_is_never_reachable() {
        let fixture = fixture();
        save(&fixture, "Alpha", "a");
        let other = seed_project(&fixture.database, &fixture.root);
        let graph = fixture
            .service
            .graph(&GraphRequest {
                project_id: other,
                ..GraphRequest::default()
            })
            .unwrap();
        assert!(graph.nodes.is_empty());
    }

    // ---- Impact ------------------------------------------------------------------------------

    fn seed_impact(fixture: &Fixture) -> (MemoryDetail, MemoryDetail) {
        std::fs::create_dir_all(fixture.root.join("src/auth")).unwrap();
        std::fs::write(fixture.root.join("src/auth/token.rs"), "fn rotate() {}").unwrap();
        let cited = save(fixture, "Rotation Decision", "Rotate on use.");
        fixture
            .service
            .attach_source(&AttachSourceRequest {
                project_id: fixture.project_id.clone(),
                item_id: cited.summary.id.clone(),
                claim_id: None,
                source_type: "file".into(),
                file_path: Some("src/auth/token.rs".into()),
                line_start: Some(1),
                line_end: Some(1),
                uri: None,
                excerpt: None,
            })
            .unwrap();
        let neighbour = save(fixture, "Session Runbook", "Steps.");
        fixture
            .service
            .save_relation(&SaveRelationRequest {
                project_id: fixture.project_id.clone(),
                from_item_id: neighbour.summary.id.clone(),
                to_item_id: cited.summary.id.clone(),
                relation_type: "documents".into(),
                confidence: None,
            })
            .unwrap();
        // Re-read: attaching evidence and relations does not change the summaries captured above.
        (
            fixture
                .service
                .get(&fixture.project_id, &cited.summary.id)
                .unwrap(),
            fixture
                .service
                .get(&fixture.project_id, &neighbour.summary.id)
                .unwrap(),
        )
    }

    #[test]
    fn impact_finds_direct_citations_and_their_neighbours() {
        let fixture = fixture();
        let (cited, neighbour) = seed_impact(&fixture);
        let report = fixture
            .service
            .impact(&fixture.project_id, "src/auth/token.rs", None)
            .unwrap();

        let direct = report
            .hits
            .iter()
            .find(|hit| hit.summary.id == cited.summary.id)
            .expect("the memory citing the path is a direct hit");
        assert_eq!(direct.distance, 0);
        assert!(direct.reason.contains("src/auth/token.rs"));

        let indirect = report
            .hits
            .iter()
            .find(|hit| hit.summary.id == neighbour.summary.id)
            .expect("a related memory is reached at one hop");
        assert_eq!(indirect.distance, 1);
    }

    #[test]
    fn impact_matches_a_directory_prefix_but_not_a_sibling_with_a_shared_stem() {
        let fixture = fixture();
        let (cited, _) = seed_impact(&fixture);
        let directory = fixture
            .service
            .impact(&fixture.project_id, "src/auth", None)
            .unwrap();
        assert!(directory
            .hits
            .iter()
            .any(|hit| hit.summary.id == cited.summary.id));

        // `src/au` must not match `src/auth/...` — the prefix rule joins on a separator.
        let sibling = fixture
            .service
            .impact(&fixture.project_id, "src/au", None)
            .unwrap();
        assert!(sibling.hits.is_empty());
    }

    #[test]
    fn impact_flags_verified_knowledge_for_re_verification() {
        let fixture = fixture();
        let (cited, _) = seed_impact(&fixture);
        fixture
            .service
            .set_quality(&SetMemoryQualityRequest {
                project_id: fixture.project_id.clone(),
                item_id: cited.summary.id.clone(),
                quality: MemoryQuality::Canonical,
            })
            .unwrap();
        let report = fixture
            .service
            .impact(&fixture.project_id, "src/auth/token.rs", None)
            .unwrap();
        assert!(report.needs_verification.contains(&cited.summary.id));
    }

    #[test]
    fn impact_refuses_a_path_that_escapes_the_project() {
        let fixture = fixture();
        seed_impact(&fixture);
        for attempt in [
            "../outside.rs",
            "..\\..\\secrets.env",
            "C:/Windows/hosts",
            "a\0b",
        ] {
            let error = fixture
                .service
                .impact(&fixture.project_id, attempt, None)
                .unwrap_err();
            assert!(
                matches!(
                    error.code.as_str(),
                    "path_rejected" | "path_outside_project"
                ),
                "{attempt} must not reach the query, got {}",
                error.code
            );
        }

        // A leading separator is neutralized rather than rejected, so an absolute path is read as
        // Project-relative and can only ever name a file inside this Project.
        let neutralized = fixture
            .service
            .impact(&fixture.project_id, "/etc/passwd", None)
            .unwrap();
        assert_eq!(neutralized.file_path, "etc/passwd");
        assert!(neutralized.hits.is_empty());
    }

    // ---- Health ------------------------------------------------------------------------------

    #[test]
    fn health_counts_only_rows_a_user_can_navigate_to() {
        let fixture = fixture();
        // Orphan with no evidence, plus a broken link out of a second memory.
        save(&fixture, "Lonely Note", "No links, no evidence.");
        save(&fixture, "Pointer", "Refers to [[Nothing At All]].");

        let health = fixture.service.health(&fixture.project_id).unwrap();
        assert_eq!(health.total, 2);
        assert_eq!(health.broken_links, 1);
        assert_eq!(health.missing_evidence, 2);
        // `Pointer` has an outgoing link, so only `Lonely Note` is an orphan.
        assert_eq!(health.orphans, 1);
        assert_eq!(health.stale, 0);
        assert_eq!(health.stale_canonical, 0);
        assert!(health
            .by_quality
            .iter()
            .any(|(quality, count)| quality == "working" && *count == 2));
    }

    #[test]
    fn a_stale_canonical_memory_is_counted_in_the_highest_risk_bucket() {
        let fixture = fixture();
        let item = save(&fixture, "Rotation Decision", "Rotate on use.");
        fixture
            .service
            .set_quality(&SetMemoryQualityRequest {
                project_id: fixture.project_id.clone(),
                item_id: item.summary.id.clone(),
                quality: MemoryQuality::Canonical,
            })
            .unwrap();
        fixture
            .service
            .mark_stale(
                &fixture.project_id,
                std::slice::from_ref(&item.summary.id),
                Some("src/auth/token.rs changed"),
            )
            .unwrap();
        let health = fixture.service.health(&fixture.project_id).unwrap();
        assert_eq!(health.stale, 1);
        assert_eq!(health.stale_canonical, 1);
    }
}

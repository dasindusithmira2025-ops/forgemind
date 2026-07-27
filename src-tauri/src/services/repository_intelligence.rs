//! Repository intelligence: the extractor that turns a Git working tree into the graph
//! projection persisted by `replace_repository_graph_snapshot`, plus the impact summary derived
//! from it.
//!
//! Everything here is extracted from Git and the tracked file list, so the feature works offline
//! and never depends on a provider. Two relationships are deliberately *heuristic* rather than
//! exact, and are labelled as such all the way to the UI:
//!
//! * `tests` edges are matched by filename stem (`parser.rs` ↔ `parser.test.ts`).
//! * `depends_on` edges come from a fixed-string `git grep` for a changed file's stem.
//!
//! Both carry sub-1.0 confidence and an evidence string naming how they were derived, so an
//! operator reads them as leads to check rather than facts. Replacing these two steps with a real
//! AST/import extractor would not change the persisted contract or the command surface.

use crate::errors::{AppError, AppResult};
use crate::models::*;
use crate::services::RepositoryService;
use chrono::Utc;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use uuid::Uuid;

/// Bumped whenever the extraction logic changes shape. Stored on every snapshot so a projection
/// built by an older build is identifiable (and can be rebuilt) rather than silently trusted.
pub const EXTRACTOR_VERSION: &str = "repo-graph-v1";

/// Upper bound on changed files expanded into dependent/test lookups. Each expansion runs a
/// `git grep` over the tracked tree, so this is what keeps a 900-file change set from turning a
/// refresh into a multi-minute stall.
const MAX_EXPANDED_FILES: usize = 40;
/// Stems shorter than this, or in [`GENERIC_STEMS`], match far too much to be useful evidence.
const MIN_STEM_LENGTH: usize = 4;
const GENERIC_STEMS: &[&str] = &[
    "index", "main", "mod", "lib", "test", "tests", "types", "utils", "util", "common", "config",
    "setup", "app", "core",
];
/// Cap on `git grep` hits considered per changed file — beyond this the stem is too common to be
/// meaningful evidence and the result is discarded rather than shown as noise.
const MAX_DEPENDENT_HITS: usize = 25;

const SOURCE_EXTENSIONS: &[&str] = &[
    "rs", "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "go", "java", "kt", "rb", "cs", "swift",
    "c", "h", "cc", "cpp", "hpp",
];

impl RepositoryService {
    /// Rebuild and persist the repository-intelligence projection for a Project.
    ///
    /// Returns the freshly built [`RepositoryIntelligence`]. The previous snapshot's nodes and
    /// edges are replaced atomically by the writer, so a refresh never leaves a half-updated
    /// graph visible.
    pub fn build_intelligence(
        &self,
        request: &RepositoryIntelligenceRequest,
    ) -> AppResult<RepositoryIntelligence> {
        let project = self.database.get_project(&request.project_id)?;
        if !project.is_git_repository {
            return Err(AppError::new(
                "git_repository_not_found",
                "The selected Project is not a Git repository.",
                true,
            )
            .entity(&request.project_id)
            .layer("repository"));
        }
        let repository =
            self.validate_repository_path(&project, request.repository_path.as_deref())?;
        let worktree = self.validate_worktree_path(
            &request.project_id,
            &repository,
            request.worktree_path.as_deref(),
        )?;
        let snapshot = self.inspect_validated(&request.project_id, &repository, &worktree)?;

        let repository_id = repository_identity(&repository);
        let snapshot_id = Uuid::new_v4().to_string();
        let observed_at = Utc::now().to_rfc3339();
        let status_hash = status_fingerprint(&snapshot);

        // The tracked file list is the universe the extractor is allowed to reason about. Using
        // `git ls-files` (rather than walking the filesystem) means ignored and build-output files
        // never enter the graph.
        let tracked = self.tracked_files(&worktree)?;

        // Honour an explicit path filter when the caller supplies one; otherwise every file Git
        // reports as changed is in scope.
        let changed: Vec<RepositoryFileStatus> = snapshot
            .files
            .iter()
            .filter(|file| match request.paths.as_deref() {
                Some(paths) if !paths.is_empty() => {
                    paths.iter().any(|prefix| file.path.starts_with(prefix))
                }
                _ => true,
            })
            .cloned()
            .collect();

        let mut builder = GraphBuilder::new(
            snapshot_id.clone(),
            repository_id.clone(),
            observed_at.clone(),
        );

        let repo_label = repository
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| repository.to_string_lossy().into_owned());
        let repository_node = builder.node(
            RepositoryGraphNodeKind::Repository,
            &repository.to_string_lossy(),
            &repo_label,
            json!({
                "path": repository.to_string_lossy(),
                "remotes": snapshot.remotes,
                "trackedFiles": tracked.len(),
            }),
            Origin::exact(RepositoryGraphSourceKind::Git),
        );

        if worktree != repository {
            let worktree_node = builder.node(
                RepositoryGraphNodeKind::Worktree,
                &worktree.to_string_lossy(),
                &worktree.to_string_lossy(),
                json!({ "path": worktree.to_string_lossy() }),
                Origin::exact(RepositoryGraphSourceKind::Git),
            );
            builder.edge(
                &repository_node,
                &worktree_node,
                RepositoryGraphEdgeKind::Contains,
                json!({}),
                Origin::exact(RepositoryGraphSourceKind::Git),
            );
        }

        let commit_subject = self
            .git_text(
                &worktree,
                &["log", "-1", "--no-color", "--format=%s"],
                None,
                None,
            )
            .unwrap_or_default()
            .trim()
            .to_owned();
        let commit_node = builder.node(
            RepositoryGraphNodeKind::Commit,
            &snapshot.head_sha,
            &short_sha(&snapshot.head_sha),
            json!({ "sha": snapshot.head_sha, "subject": commit_subject }),
            Origin::exact_with(
                RepositoryGraphSourceKind::Git,
                format!("git log -1 {}", short_sha(&snapshot.head_sha)),
            ),
        );

        if let Some(branch) = snapshot.branch.as_deref() {
            let branch_node = builder.node(
                RepositoryGraphNodeKind::Branch,
                branch,
                branch,
                json!({
                    "upstream": snapshot.upstream,
                    "ahead": snapshot.ahead,
                    "behind": snapshot.behind,
                }),
                Origin::exact(RepositoryGraphSourceKind::Git),
            );
            builder.edge(
                &repository_node,
                &branch_node,
                RepositoryGraphEdgeKind::Contains,
                json!({}),
                Origin::exact(RepositoryGraphSourceKind::Git),
            );
            builder.edge(
                &branch_node,
                &commit_node,
                RepositoryGraphEdgeKind::PointsTo,
                json!({}),
                Origin::exact(RepositoryGraphSourceKind::Git),
            );
        }

        // The working-tree change set is a first-class node so the impact summary has something
        // to hang its `modifies` edges off, and so a later run can diff two change sets.
        let change_set_node = builder.node(
            RepositoryGraphNodeKind::ChangeSet,
            &format!("worktree:{status_hash}"),
            &format!("{} uncommitted file(s)", changed.len()),
            json!({
                "statusHash": status_hash,
                "fileCount": changed.len(),
                "conflicted": changed.iter().filter(|f| f.conflicted).count(),
            }),
            Origin::exact_with(
                RepositoryGraphSourceKind::Git,
                "git status --porcelain=v2".into(),
            ),
        );

        let workflow_paths = workflow_files(&tracked);
        for path in &workflow_paths {
            let node = builder.node(
                RepositoryGraphNodeKind::Workflow,
                path,
                path.rsplit('/').next().unwrap_or(path),
                json!({ "path": path }),
                Origin::exact_with(
                    RepositoryGraphSourceKind::Workflow,
                    format!("tracked workflow definition {path}"),
                ),
            );
            builder.edge(
                &node,
                &repository_node,
                RepositoryGraphEdgeKind::Builds,
                json!({}),
                Origin::exact(RepositoryGraphSourceKind::Workflow),
            );
        }

        let test_index = TestIndex::build(&tracked);
        let mut impact = RepositoryImpactSummary {
            changed_files: changed.iter().map(|file| file.path.clone()).collect(),
            changed_symbols: Vec::new(),
            direct_dependents: Vec::new(),
            related_tests: Vec::new(),
            related_workflows: Vec::new(),
            risk_signals: Vec::new(),
            missing_test_signals: Vec::new(),
            explanations: Vec::new(),
            generated_at: observed_at.clone(),
        };

        let depth = request.depth.unwrap_or(1).max(1);
        let expandable = (MAX_EXPANDED_FILES * depth as usize).min(MAX_EXPANDED_FILES * 3);
        let mut seen_dependents = BTreeSet::new();
        let mut seen_tests = BTreeSet::new();

        for file in changed.iter().take(expandable) {
            let file_node = builder.node(
                RepositoryGraphNodeKind::File,
                &file.path,
                &file.path,
                json!({
                    "indexStatus": file.index_status,
                    "worktreeStatus": file.worktree_status,
                    "conflicted": file.conflicted,
                    "untracked": file.untracked,
                    "renamed": file.renamed,
                    "deleted": file.deleted,
                }),
                Origin::exact_with(
                    RepositoryGraphSourceKind::Git,
                    format!("git status reported {}", file.path),
                ),
            );
            builder.edge(
                &change_set_node,
                &file_node,
                RepositoryGraphEdgeKind::Modifies,
                json!({ "status": file.worktree_status }),
                Origin::exact(RepositoryGraphSourceKind::Git),
            );
            builder.edge(
                &repository_node,
                &file_node,
                RepositoryGraphEdgeKind::Contains,
                json!({}),
                Origin::exact(RepositoryGraphSourceKind::Filesystem),
            );

            // Changed symbols come from the diff's hunk headers, which Git computes with its own
            // language-aware `xfuncname` patterns. That is real evidence rather than a guess,
            // though it is only as good as Git's per-language heuristic — hence 0.7.
            for symbol in self.changed_symbols(&worktree, &file.path) {
                let symbol_node = builder.node(
                    RepositoryGraphNodeKind::Symbol,
                    &format!("{}#{symbol}", file.path),
                    &symbol,
                    json!({ "file": file.path }),
                    Origin::heuristic(
                        RepositoryGraphSourceKind::Git,
                        0.7,
                        format!("diff hunk header in {}", file.path),
                    ),
                );
                builder.edge(
                    &file_node,
                    &symbol_node,
                    RepositoryGraphEdgeKind::Declares,
                    json!({}),
                    Origin::heuristic(
                        RepositoryGraphSourceKind::Git,
                        0.7,
                        format!("diff hunk header in {}", file.path),
                    ),
                );
                impact.changed_symbols.push(RepositoryImpactItem {
                    path: format!("{}#{symbol}", file.path),
                    reason: "Appears in a changed diff hunk.".into(),
                    confidence: 0.7,
                    evidence: vec![format!("git diff hunk header in {}", file.path)],
                });
            }

            // Related tests: filename-stem match against the tracked test files.
            if let Some(stem) = usable_stem(&file.path) {
                for test_path in test_index.matches(&stem) {
                    if !seen_tests.insert(test_path.clone()) {
                        continue;
                    }
                    let test_node = builder.node(
                        RepositoryGraphNodeKind::Test,
                        &test_path,
                        &test_path,
                        json!({ "path": test_path, "matchedStem": stem }),
                        Origin::heuristic(
                            RepositoryGraphSourceKind::Test,
                            0.6,
                            format!("filename stem '{stem}' matched {test_path}"),
                        ),
                    );
                    builder.edge(
                        &test_node,
                        &file_node,
                        RepositoryGraphEdgeKind::Tests,
                        json!({ "matchedStem": stem }),
                        Origin::heuristic(
                            RepositoryGraphSourceKind::Test,
                            0.6,
                            format!("filename stem '{stem}' matched {}", file.path),
                        ),
                    );
                    impact.related_tests.push(RepositoryImpactItem {
                        path: test_path.clone(),
                        reason: format!("Test filename matches the stem '{stem}'."),
                        confidence: 0.6,
                        evidence: vec![format!("stem match: {} ↔ {test_path}", file.path)],
                    });
                    impact.explanations.push(RepositoryImpactExplanation {
                        target_type: "test".into(),
                        target: test_path.clone(),
                        relationship: "tests".into(),
                        reason: format!("Filename stem '{stem}' matches the changed file."),
                        evidence: vec![format!("changed: {}", file.path)],
                        confidence: 0.6,
                    });
                }

                // Direct dependents: files that literally mention the stem.
                for dependent in self.stem_references(&worktree, &stem, &file.path)? {
                    if !seen_dependents.insert(dependent.clone()) {
                        continue;
                    }
                    let dependent_node = builder.node(
                        RepositoryGraphNodeKind::File,
                        &dependent,
                        &dependent,
                        json!({ "referencesStem": stem }),
                        Origin::heuristic(
                            RepositoryGraphSourceKind::Filesystem,
                            0.5,
                            format!("git grep -F '{stem}' matched {dependent}"),
                        ),
                    );
                    builder.edge(
                        &dependent_node,
                        &file_node,
                        RepositoryGraphEdgeKind::DependsOn,
                        json!({ "matchedStem": stem }),
                        Origin::heuristic(
                            RepositoryGraphSourceKind::Filesystem,
                            0.5,
                            format!("git grep -F '{stem}'"),
                        ),
                    );
                    impact.direct_dependents.push(RepositoryImpactItem {
                        path: dependent.clone(),
                        reason: format!("References the stem '{stem}' of a changed file."),
                        confidence: 0.5,
                        evidence: vec![format!("git grep -F '{stem}'")],
                    });
                    impact.explanations.push(RepositoryImpactExplanation {
                        target_type: "file".into(),
                        target: dependent.clone(),
                        relationship: "depends_on".into(),
                        reason: format!(
                            "Textual reference to '{stem}'; confirm it is a real import."
                        ),
                        evidence: vec![format!("changed: {}", file.path)],
                        confidence: 0.5,
                    });
                }
            }
        }

        // A changed workflow definition is itself part of the impact surface.
        for path in &workflow_paths {
            if changed.iter().any(|file| &file.path == path) {
                impact.related_workflows.push(RepositoryImpactItem {
                    path: path.clone(),
                    reason: "This workflow definition is itself modified.".into(),
                    confidence: 1.0,
                    evidence: vec!["git status".into()],
                });
            }
        }

        impact.risk_signals = risk_signals(&changed, expandable);
        impact.missing_test_signals = missing_test_signals(&changed, &seen_tests, expandable);

        if changed.len() > expandable {
            impact.risk_signals.push(RepositoryRiskSignal {
                code: "impact_analysis_truncated".into(),
                severity: "low".into(),
                summary: format!(
                    "Only the first {expandable} of {} changed files were expanded.",
                    changed.len()
                ),
                evidence: vec![format!(
                    "extractor bound MAX_EXPANDED_FILES={MAX_EXPANDED_FILES}"
                )],
            });
        }

        let graph = RepositoryGraphSnapshot {
            id: snapshot_id,
            repository_id: repository_id.clone(),
            project_id: request.project_id.clone(),
            worktree_path: worktree.to_string_lossy().into_owned(),
            head_sha: snapshot.head_sha.clone(),
            status_hash: status_hash.clone(),
            extractor_version: EXTRACTOR_VERSION.into(),
            created_at: observed_at,
            nodes: builder.nodes,
            edges: builder.edges,
        };

        let impact_value = serde_json::to_value(&impact).map_err(|error| {
            AppError::new(
                "repository_graph_serialize_failed",
                "The repository impact summary could not be stored.",
                false,
            )
            .detail(error.to_string())
        })?;
        self.database
            .replace_repository_graph_snapshot(&graph, &impact_value)?;

        Ok(RepositoryIntelligence {
            project_id: request.project_id.clone(),
            repository_id,
            worktree_path: graph.worktree_path.clone(),
            head_sha: graph.head_sha.clone(),
            status_hash,
            graph,
            impact,
        })
    }

    /// Read the last persisted projection without re-extracting. Returns `None` when the
    /// extractor has never run for this repository.
    pub fn stored_intelligence(
        &self,
        project_id: &str,
        repository_path: Option<&str>,
    ) -> AppResult<Option<RepositoryIntelligence>> {
        let project = self.database.get_project(project_id)?;
        let repository = self.validate_repository_path(&project, repository_path)?;
        self.database
            .latest_repository_intelligence(project_id, &repository_identity(&repository))
    }

    fn tracked_files(&self, worktree: &Path) -> AppResult<Vec<String>> {
        Ok(self
            .git_text(worktree, &["ls-files", "-z"], None, None)?
            .split('\0')
            .filter(|entry| !entry.trim().is_empty())
            .map(str::to_owned)
            .collect())
    }

    /// Symbol names taken from the diff's hunk headers (`@@ ... @@ <context>`). Git derives that
    /// trailing context with its own language-aware patterns, so this reflects real structure
    /// rather than a regex of ours — but it is best-effort and silently yields nothing for
    /// languages Git has no pattern for.
    fn changed_symbols(&self, worktree: &Path, path: &str) -> Vec<String> {
        let Ok(diff) = self.git_text(
            worktree,
            &[
                "--literal-pathspecs",
                "diff",
                "--no-ext-diff",
                "--no-color",
                "--unified=0",
                "HEAD",
                "--",
                path,
            ],
            None,
            None,
        ) else {
            return Vec::new();
        };
        let mut symbols = BTreeSet::new();
        for line in diff.lines() {
            let Some(rest) = line.strip_prefix("@@") else {
                continue;
            };
            let Some(context) = rest.split("@@").nth(1) else {
                continue;
            };
            let context = context.trim();
            if context.is_empty() {
                continue;
            }
            if let Some(name) = symbol_name(context) {
                symbols.insert(name);
            }
        }
        symbols.into_iter().take(12).collect()
    }

    /// Files that textually reference `stem`, via a fixed-string `git grep` over tracked files.
    /// Deliberately not a language-aware import graph — see the module docs.
    fn stem_references(
        &self,
        worktree: &Path,
        stem: &str,
        changed_path: &str,
    ) -> AppResult<Vec<String>> {
        // `git grep` exits non-zero when there are no matches, which `git_text` surfaces as an
        // error. That is an ordinary "no dependents" outcome, not a failure.
        let Ok(output) = self.git_text(
            worktree,
            &[
                "grep",
                "--fixed-strings",
                "--files-with-matches",
                "--no-color",
                "-I",
                "-e",
                stem,
            ],
            None,
            None,
        ) else {
            return Ok(Vec::new());
        };
        let hits: Vec<String> = output
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty() && *line != changed_path)
            .filter(|line| is_source_file(line))
            .map(str::to_owned)
            .collect();
        if hits.len() > MAX_DEPENDENT_HITS {
            // Too common to be evidence of anything.
            return Ok(Vec::new());
        }
        Ok(hits)
    }
}

/// Repository-shaped risks read directly off the change set. These are deterministic
/// classifications of *what changed*, not predictions, so each carries concrete file evidence.
fn risk_signals(changed: &[RepositoryFileStatus], expandable: usize) -> Vec<RepositoryRiskSignal> {
    let mut signals = Vec::new();
    let conflicted: Vec<&RepositoryFileStatus> =
        changed.iter().filter(|file| file.conflicted).collect();
    if !conflicted.is_empty() {
        signals.push(RepositoryRiskSignal {
            code: "unresolved_conflicts".into(),
            severity: "critical".into(),
            summary: format!(
                "{} file(s) have unresolved merge conflicts.",
                conflicted.len()
            ),
            evidence: conflicted
                .iter()
                .take(10)
                .map(|file| file.path.clone())
                .collect(),
        });
    }

    let ci_changed: Vec<&RepositoryFileStatus> = changed
        .iter()
        .filter(|file| is_workflow_path(&file.path))
        .collect();
    if !ci_changed.is_empty() {
        signals.push(RepositoryRiskSignal {
            code: "ci_configuration_changed".into(),
            severity: "high".into(),
            summary: "CI workflow definitions are modified; delivery behavior may change.".into(),
            evidence: ci_changed.iter().map(|file| file.path.clone()).collect(),
        });
    }

    let migrations: Vec<&RepositoryFileStatus> = changed
        .iter()
        .filter(|file| file.path.contains("migration"))
        .collect();
    if !migrations.is_empty() {
        signals.push(RepositoryRiskSignal {
            code: "schema_migration_changed".into(),
            severity: "high".into(),
            summary: "Schema migration code is modified; installed databases are affected.".into(),
            evidence: migrations
                .iter()
                .take(10)
                .map(|file| file.path.clone())
                .collect(),
        });
    }

    let manifests: Vec<&RepositoryFileStatus> = changed
        .iter()
        .filter(|file| is_dependency_manifest(&file.path))
        .collect();
    if !manifests.is_empty() {
        signals.push(RepositoryRiskSignal {
            code: "dependency_manifest_changed".into(),
            severity: "medium".into(),
            summary: "Dependency manifests or lockfiles are modified.".into(),
            evidence: manifests.iter().map(|file| file.path.clone()).collect(),
        });
    }

    if changed.len() > expandable {
        signals.push(RepositoryRiskSignal {
            code: "large_change_set".into(),
            severity: "medium".into(),
            summary: format!(
                "{} files are changed, which is large enough to review in slices.",
                changed.len()
            ),
            evidence: vec![format!("{} changed files", changed.len())],
        });
    }

    signals
}

/// Source files with no stem-matching test, reported so the gap is visible rather than assumed
/// absent. This is a *coverage lead*, not a coverage measurement — a file can be well covered by a
/// test whose name does not match its stem.
fn missing_test_signals(
    changed: &[RepositoryFileStatus],
    matched_tests: &BTreeSet<String>,
    expandable: usize,
) -> Vec<RepositoryRiskSignal> {
    let untested: Vec<String> = changed
        .iter()
        .take(expandable)
        .filter(|file| !file.deleted && is_source_file(&file.path) && !is_test_path(&file.path))
        .filter(|file| {
            usable_stem(&file.path)
                .map(|stem| {
                    !matched_tests
                        .iter()
                        .any(|test| test.to_ascii_lowercase().contains(&stem))
                })
                .unwrap_or(false)
        })
        .map(|file| file.path.clone())
        .collect();
    if untested.is_empty() {
        return Vec::new();
    }
    vec![RepositoryRiskSignal {
        code: "no_matching_test".into(),
        severity: "medium".into(),
        summary: format!(
            "{} changed source file(s) have no test whose filename matches.",
            untested.len()
        ),
        evidence: untested.into_iter().take(15).collect(),
    }]
}

/// Accumulates nodes and edges while assigning the stable identity every node needs before an
/// edge can point at it.
struct GraphBuilder {
    snapshot_id: String,
    repository_id: String,
    observed_at: String,
    nodes: Vec<RepositoryGraphNode>,
    edges: Vec<RepositoryGraphEdge>,
    node_ids: BTreeMap<String, String>,
    edge_keys: BTreeSet<String>,
}

impl GraphBuilder {
    fn new(snapshot_id: String, repository_id: String, observed_at: String) -> Self {
        Self {
            snapshot_id,
            repository_id,
            observed_at,
            nodes: Vec::new(),
            edges: Vec::new(),
            node_ids: BTreeMap::new(),
            edge_keys: BTreeSet::new(),
        }
    }

    fn provenance(&self, origin: Origin) -> RepositoryGraphProvenance {
        RepositoryGraphProvenance {
            source: origin.source,
            repository_id: self.repository_id.clone(),
            snapshot: self.snapshot_id.clone(),
            observed_at: self.observed_at.clone(),
            extractor_version: EXTRACTOR_VERSION.into(),
            confidence: origin.confidence,
            evidence_ref: origin.evidence_ref,
        }
    }

    /// Insert a node, or return the existing id when `(kind, external_key)` was already recorded.
    /// The writer upserts on that same tuple, so de-duplicating here keeps the in-memory graph
    /// consistent with what will be persisted.
    fn node(
        &mut self,
        kind: RepositoryGraphNodeKind,
        external_key: &str,
        label: &str,
        metadata: serde_json::Value,
        origin: Origin,
    ) -> String {
        let dedupe_key = format!("{}::{external_key}", kind.as_str());
        if let Some(existing) = self.node_ids.get(&dedupe_key) {
            return existing.clone();
        }
        let id = Uuid::new_v4().to_string();
        let content_hash = format!(
            "{:x}",
            Sha256::digest(format!("{dedupe_key}::{label}::{metadata}").as_bytes())
        );
        self.nodes.push(RepositoryGraphNode {
            id: id.clone(),
            repository_id: self.repository_id.clone(),
            node_type: kind,
            external_key: external_key.to_owned(),
            label: label.to_owned(),
            metadata,
            content_hash,
            provenance: self.provenance(origin),
        });
        self.node_ids.insert(dedupe_key, id.clone());
        id
    }

    fn edge(
        &mut self,
        source_node_id: &str,
        target_node_id: &str,
        kind: RepositoryGraphEdgeKind,
        metadata: serde_json::Value,
        origin: Origin,
    ) {
        let key = format!("{source_node_id}->{target_node_id}::{}", kind.as_str());
        if !self.edge_keys.insert(key) {
            return;
        }
        self.edges.push(RepositoryGraphEdge {
            id: Uuid::new_v4().to_string(),
            repository_id: self.repository_id.clone(),
            source_node_id: source_node_id.to_owned(),
            target_node_id: target_node_id.to_owned(),
            edge_type: kind,
            metadata,
            provenance: self.provenance(origin),
        });
    }
}

/// Where a graph element came from and how far the extractor trusts it. Grouping these three
/// forces every call site to state its confidence explicitly, which is what keeps an exact Git
/// fact from being recorded as if it were the same kind of claim as a filename-stem guess.
struct Origin {
    source: RepositoryGraphSourceKind,
    confidence: f32,
    evidence_ref: Option<String>,
}

impl Origin {
    /// A fact observed directly from Git or the filesystem.
    fn exact(source: RepositoryGraphSourceKind) -> Self {
        Self {
            source,
            confidence: 1.0,
            evidence_ref: None,
        }
    }

    /// An exact fact that can name the command or artifact it came from.
    fn exact_with(source: RepositoryGraphSourceKind, evidence: String) -> Self {
        Self {
            source,
            confidence: 1.0,
            evidence_ref: Some(evidence),
        }
    }

    /// An inferred relationship. Callers must supply both a confidence below 1.0 and the evidence
    /// that produced it, so the UI can always explain why a lead was suggested.
    fn heuristic(source: RepositoryGraphSourceKind, confidence: f32, evidence: String) -> Self {
        Self {
            source,
            confidence,
            evidence_ref: Some(evidence),
        }
    }
}

/// Tracked test files indexed by lowercase path, so a changed file's stem can be matched without
/// rescanning the tree per lookup.
struct TestIndex {
    tests: Vec<(String, String)>,
}

impl TestIndex {
    fn build(tracked: &[String]) -> Self {
        Self {
            tests: tracked
                .iter()
                .filter(|path| is_test_path(path))
                .map(|path| (path.to_ascii_lowercase(), path.clone()))
                .collect(),
        }
    }

    fn matches(&self, stem: &str) -> Vec<String> {
        self.tests
            .iter()
            .filter(|(lowered, _)| lowered.contains(stem))
            .map(|(_, path)| path.clone())
            .take(10)
            .collect()
    }
}

/// A repository's stable identity within a Project: the SHA-256 of its canonical root path. It is
/// derived rather than stored so the projection survives a database that predates this feature.
fn repository_identity(repository: &Path) -> String {
    let digest = Sha256::digest(repository.to_string_lossy().as_bytes());
    format!("{digest:x}")[..32].to_owned()
}

/// A fingerprint of the working tree's status, used to tell whether a stored projection still
/// describes the tree in front of the operator.
fn status_fingerprint(snapshot: &RepositorySnapshot) -> String {
    let mut hasher = Sha256::new();
    hasher.update(snapshot.head_sha.as_bytes());
    for file in &snapshot.files {
        hasher.update(file.path.as_bytes());
        hasher.update(file.index_status.as_bytes());
        hasher.update(file.worktree_status.as_bytes());
    }
    format!("{:x}", hasher.finalize())[..32].to_owned()
}

fn short_sha(sha: &str) -> String {
    sha.chars().take(8).collect()
}

/// The lowercase filename stem used for test and dependent matching, or `None` when it is too
/// short or too generic to be evidence of anything.
fn usable_stem(path: &str) -> Option<String> {
    let file = path.rsplit('/').next()?;
    let stem = file.split('.').next()?.to_ascii_lowercase();
    if stem.len() < MIN_STEM_LENGTH || GENERIC_STEMS.contains(&stem.as_str()) {
        return None;
    }
    Some(stem)
}

fn extension(path: &str) -> Option<String> {
    let file = path.rsplit('/').next()?;
    let (_, ext) = file.rsplit_once('.')?;
    Some(ext.to_ascii_lowercase())
}

fn is_source_file(path: &str) -> bool {
    extension(path)
        .map(|ext| SOURCE_EXTENSIONS.contains(&ext.as_str()))
        .unwrap_or(false)
}

fn is_test_path(path: &str) -> bool {
    let lowered = path.to_ascii_lowercase();
    // The `test_` convention is a *filename prefix*, so it must be checked against the file name
    // rather than the whole path — a substring check would classify `latest_release.ts` as a test.
    let file = lowered.rsplit('/').next().unwrap_or(&lowered);
    file.contains(".test.")
        || file.contains(".spec.")
        || file.contains("_test.")
        || file.starts_with("test_")
        || lowered.starts_with("tests/")
        || lowered.contains("/tests/")
        || lowered.contains("/__tests__/")
}

fn is_workflow_path(path: &str) -> bool {
    path.starts_with(".github/workflows/")
}

fn workflow_files(tracked: &[String]) -> Vec<String> {
    tracked
        .iter()
        .filter(|path| is_workflow_path(path))
        .filter(|path| {
            let lowered = path.to_ascii_lowercase();
            lowered.ends_with(".yml") || lowered.ends_with(".yaml")
        })
        .cloned()
        .collect()
}

fn is_dependency_manifest(path: &str) -> bool {
    let file = path.rsplit('/').next().unwrap_or(path);
    matches!(
        file,
        "package.json"
            | "package-lock.json"
            | "Cargo.toml"
            | "Cargo.lock"
            | "pnpm-lock.yaml"
            | "yarn.lock"
            | "requirements.txt"
            | "go.mod"
            | "go.sum"
    )
}

/// Pull a plausible identifier out of a diff hunk's trailing context, e.g.
/// `fn build_intelligence(&self` → `build_intelligence`.
fn symbol_name(context: &str) -> Option<String> {
    let candidate = context
        .split(|c: char| !(c.is_alphanumeric() || c == '_'))
        .filter(|token| {
            token.len() > 2
                && !matches!(
                    *token,
                    "pub"
                        | "fn"
                        | "const"
                        | "let"
                        | "var"
                        | "def"
                        | "class"
                        | "struct"
                        | "impl"
                        | "enum"
                        | "type"
                        | "interface"
                        | "export"
                        | "default"
                        | "async"
                        | "function"
                        | "static"
                        | "public"
                        | "private"
                )
        })
        .find(|token| !token.chars().all(|c| c.is_ascii_digit()))?;
    Some(candidate.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usable_stem_rejects_generic_and_short_names() {
        assert_eq!(
            usable_stem("src/features/parser.ts").as_deref(),
            Some("parser")
        );
        assert_eq!(usable_stem("src/index.ts"), None, "generic stem");
        assert_eq!(
            usable_stem("src/db.rs"),
            None,
            "stem shorter than the floor"
        );
        assert_eq!(
            usable_stem("a/b/repository_service.rs").as_deref(),
            Some("repository_service")
        );
    }

    #[test]
    fn test_paths_are_recognized_across_ecosystem_conventions() {
        for path in [
            "src/parser.test.ts",
            "src/parser.spec.tsx",
            "pkg/parser_test.go",
            "tests/test_parser.py",
            "src/__tests__/parser.ts",
        ] {
            assert!(is_test_path(path), "{path} should be a test path");
        }
        assert!(!is_test_path("src/parser.ts"));
        // "latest/" contains "test" but must not be mistaken for a test directory.
        assert!(!is_test_path("src/latest/parser.ts"));
        // `latest_release.ts` contains the literal "test_" — a naive substring check would
        // misclassify it, and every such file would then be excluded from the untested-file signal.
        assert!(!is_test_path("src/latest_release.ts"));
        assert!(!is_test_path("src/greatest_hits.rs"));
    }

    #[test]
    fn test_index_matches_by_stem_only() {
        let tracked = vec![
            "src/parser.ts".to_owned(),
            "src/parser.test.ts".to_owned(),
            "src/renderer.test.ts".to_owned(),
        ];
        let index = TestIndex::build(&tracked);
        assert_eq!(
            index.matches("parser"),
            vec!["src/parser.test.ts".to_owned()]
        );
        assert!(index.matches("missing").is_empty());
    }

    #[test]
    fn symbol_name_skips_language_keywords() {
        assert_eq!(
            symbol_name("fn build_intelligence(&self").as_deref(),
            Some("build_intelligence")
        );
        assert_eq!(
            symbol_name("export function renderPane(").as_deref(),
            Some("renderPane")
        );
        assert_eq!(symbol_name("   ").as_deref(), None);
    }

    #[test]
    fn graph_builder_dedupes_nodes_and_edges() {
        let mut builder = GraphBuilder::new("snap".into(), "repo".into(), "now".into());
        let first = builder.node(
            RepositoryGraphNodeKind::File,
            "src/a.ts",
            "src/a.ts",
            json!({}),
            Origin::exact(RepositoryGraphSourceKind::Git),
        );
        let second = builder.node(
            RepositoryGraphNodeKind::File,
            "src/a.ts",
            "src/a.ts",
            json!({}),
            Origin::exact(RepositoryGraphSourceKind::Git),
        );
        assert_eq!(
            first, second,
            "same (kind, external_key) must reuse the node"
        );
        assert_eq!(builder.nodes.len(), 1);

        let other = builder.node(
            RepositoryGraphNodeKind::File,
            "src/b.ts",
            "src/b.ts",
            json!({}),
            Origin::exact(RepositoryGraphSourceKind::Git),
        );
        builder.edge(
            &first,
            &other,
            RepositoryGraphEdgeKind::DependsOn,
            json!({}),
            Origin::heuristic(RepositoryGraphSourceKind::Filesystem, 0.5, "stem".into()),
        );
        builder.edge(
            &first,
            &other,
            RepositoryGraphEdgeKind::DependsOn,
            json!({}),
            Origin::heuristic(RepositoryGraphSourceKind::Filesystem, 0.5, "stem".into()),
        );
        assert_eq!(builder.edges.len(), 1, "duplicate edges must collapse");
    }

    #[test]
    fn repository_identity_is_stable_and_path_scoped() {
        let a = repository_identity(Path::new("/projects/alpha"));
        let b = repository_identity(Path::new("/projects/alpha"));
        let c = repository_identity(Path::new("/projects/beta"));
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert_eq!(a.len(), 32);
    }

    #[test]
    fn dependency_manifests_and_workflows_are_classified() {
        assert!(is_dependency_manifest("package.json"));
        assert!(is_dependency_manifest("src-tauri/Cargo.lock"));
        assert!(!is_dependency_manifest("src/package.ts"));
        assert!(is_workflow_path(".github/workflows/ci.yml"));
        assert!(!is_workflow_path("docs/workflows/ci.yml"));
        assert_eq!(
            workflow_files(&[
                ".github/workflows/ci.yml".to_owned(),
                ".github/workflows/README.md".to_owned(),
            ]),
            vec![".github/workflows/ci.yml".to_owned()]
        );
    }
}

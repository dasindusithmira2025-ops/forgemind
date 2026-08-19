//! The Project Analyzer: what this repository actually *is*, read off the repository.
//!
//! Deterministic and evidence-first. The analyzer never asks a model what framework a project uses;
//! it reads the manifest, and it records the manifest as the reason. Every fact it produces carries
//! at least one project-relative path, because a stated architectural fact with no file behind it
//! is exactly the kind of confident wrongness this system exists to prevent.
//!
//! ## Shape of the pass
//!
//! ```text
//! bounded walk  →  per-file detectors  →  manifest parsing  →  census  →  facts
//!               →  candidate extraction
//! ```
//!
//! The walk is bounded three ways — depth, total entries, and files opened — so analysis of a
//! large monorepo is slow-ish once rather than unbounded. Generated directories are skipped before
//! they are descended, so `node_modules` costs one `is_excluded` call rather than a subtree.
//!
//! ## What it deliberately does not do
//!
//! No language server, no full parse, no symbol table. Detection reaches into file *contents* only
//! for a small set of high-value signals (Tauri commands, HTTP routes, SQL objects), each capped by
//! file size and file count. Building a real index is a different feature with a different cost.

use crate::errors::{AppError, AppResult};
use crate::models::intelligence::{
    dimension, entity_kind, CandidateInput, CandidateOrigin, FactEvidence, ProjectFact,
};
use crate::services::filesystem_service::ProjectPathGuard;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

/// Deepest directory level walked. Six is enough for `packages/app/src/features/x/y`; past it the
/// marginal fact is a leaf file whose parent already told us what we needed.
const MAX_DEPTH: usize = 6;

/// Directory entries visited before the walk stops. A bound the analyzer *reports* rather than one
/// it hides: `files_scanned` is part of the durable result.
const MAX_ENTRIES: usize = 40_000;

/// Files whose contents are read. Manifests and configs are always read; the content-scan detectors
/// share this budget, so a repository of a hundred thousand source files does not turn one analysis
/// into a full-text index build.
const MAX_CONTENT_READS: usize = 1_200;

/// Largest file the analyzer will read. A 4 MB minified bundle has nothing to tell us that its
/// filename did not.
const MAX_FILE_BYTES: u64 = 512 * 1024;

/// Longest evidence excerpt stored. Bounded because evidence is a pointer, not a copy.
const MAX_EXCERPT_CHARS: usize = 160;

/// Most values reported per dimension. A repository with four hundred modules produces a fact list
/// nobody reads; the cap keeps the Overview a summary.
const MAX_PER_DIMENSION: usize = 40;

/// Directories never descended. Generated output and dependency trees carry no architectural
/// meaning and dominate the walk cost if included.
const EXCLUDED_DIRECTORIES: [&str; 17] = [
    ".git",
    ".paralith",
    "node_modules",
    "target",
    "dist",
    "build",
    "out",
    ".next",
    ".nuxt",
    ".svelte-kit",
    "vendor",
    "__pycache__",
    ".venv",
    "venv",
    "coverage",
    ".turbo",
    ".cache",
];

/// One walked entry.
struct Entry {
    /// Project-relative, forward slashes.
    path: String,
    /// Lowercased final component.
    name: String,
    depth: usize,
    is_dir: bool,
}

/// One accumulating fact: its qualifier, its confidence so far, and what it rests on.
type FactSlot = (Option<String>, f64, Vec<FactEvidence>);

/// Accumulates facts while keeping evidence attached to the right one.
#[derive(Default)]
struct Findings {
    /// `(dimension, value) → slot`
    facts: BTreeMap<(String, String), FactSlot>,
    files_scanned: usize,
    content_reads: usize,
}

impl Findings {
    fn add(
        &mut self,
        dimension: &str,
        value: impl Into<String>,
        detail: Option<String>,
        confidence: f64,
        evidence: FactEvidence,
    ) {
        let key = (dimension.to_owned(), value.into());
        let slot = self
            .facts
            .entry(key)
            .or_insert_with(|| (detail.clone(), confidence, Vec::new()));
        // Corroboration raises confidence without ever reaching certainty: two manifests agreeing
        // is stronger than one, but the analyzer is still reading files, not running the code.
        if !slot.2.iter().any(|known| known.path == evidence.path) {
            slot.2.push(evidence);
            slot.1 = (slot.1 + 0.05).min(0.98);
        }
        if slot.0.is_none() {
            slot.0 = detail;
        }
    }

    fn into_facts(self) -> Vec<ProjectFact> {
        let mut by_dimension: BTreeMap<String, Vec<ProjectFact>> = BTreeMap::new();
        for ((dimension, value), (detail, confidence, evidence)) in self.facts {
            by_dimension
                .entry(dimension.clone())
                .or_default()
                .push(ProjectFact {
                    dimension,
                    value,
                    detail,
                    confidence,
                    evidence,
                });
        }
        let mut out = Vec::new();
        for (_, mut facts) in by_dimension {
            facts.sort_by(|left, right| {
                right
                    .confidence
                    .partial_cmp(&left.confidence)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| left.value.cmp(&right.value))
            });
            facts.truncate(MAX_PER_DIMENSION);
            out.append(&mut facts);
        }
        out
    }
}

fn evidence(path: &str, kind: &str) -> FactEvidence {
    FactEvidence {
        path: path.to_owned(),
        kind: kind.to_owned(),
        excerpt: None,
    }
}

fn evidence_with(path: &str, kind: &str, excerpt: &str) -> FactEvidence {
    let trimmed = excerpt.trim();
    let bounded: String = if trimmed.chars().count() > MAX_EXCERPT_CHARS {
        trimmed.chars().take(MAX_EXCERPT_CHARS).collect::<String>() + "…"
    } else {
        trimmed.to_owned()
    };
    FactEvidence {
        path: path.to_owned(),
        kind: kind.to_owned(),
        // An excerpt that trips the credential detector is dropped rather than stored. Evidence is
        // a pointer to a file; the pointer alone is still useful, and a secret in the knowledge
        // base is not recoverable once it is there.
        excerpt: match crate::services::memory_markdown::reject_secrets(&bounded) {
            Ok(()) => Some(bounded),
            Err(_) => None,
        },
    }
}

/// Walk the Project root, breadth-first, honouring the exclusion list and the three bounds.
fn walk(root: &Path) -> Vec<Entry> {
    let mut entries = Vec::new();
    let mut queue: std::collections::VecDeque<(std::path::PathBuf, String, usize)> =
        std::collections::VecDeque::new();
    queue.push_back((root.to_path_buf(), String::new(), 0));

    while let Some((directory, relative, depth)) = queue.pop_front() {
        if depth > MAX_DEPTH || entries.len() >= MAX_ENTRIES {
            break;
        }
        let Ok(read) = std::fs::read_dir(&directory) else {
            // An unreadable directory is skipped, not fatal: a permission-denied subtree must not
            // make the whole Project unanalyzable.
            continue;
        };
        for item in read.flatten() {
            if entries.len() >= MAX_ENTRIES {
                break;
            }
            let name = item.file_name().to_string_lossy().to_string();
            let lowered = name.to_lowercase();
            let is_dir = item.file_type().map(|kind| kind.is_dir()).unwrap_or(false);
            if is_dir && EXCLUDED_DIRECTORIES.contains(&lowered.as_str()) {
                continue;
            }
            let path = if relative.is_empty() {
                name.clone()
            } else {
                format!("{relative}/{name}")
            };
            if is_dir {
                queue.push_back((item.path(), path.clone(), depth + 1));
            }
            entries.push(Entry {
                path,
                name: lowered,
                depth,
                is_dir,
            });
        }
    }
    entries
}

/// Read a bounded file, respecting the content-read budget.
fn read_bounded(root: &Path, relative: &str, findings: &mut Findings) -> Option<String> {
    if findings.content_reads >= MAX_CONTENT_READS {
        return None;
    }
    let full = root.join(relative.replace('/', std::path::MAIN_SEPARATOR_STR));
    let size = std::fs::metadata(&full).ok()?.len();
    if size > MAX_FILE_BYTES {
        return None;
    }
    findings.content_reads += 1;
    std::fs::read_to_string(&full).ok()
}

/// Analyze a Project root and return the facts it supports.
///
/// The root is resolved through [`ProjectPathGuard`] before anything is read, so the analyzer
/// inherits the same canonicalization and escape rejection as every other Project filesystem
/// consumer rather than growing its own.
pub fn analyze(project_root: &str) -> AppResult<(Vec<ProjectFact>, usize)> {
    let guard = ProjectPathGuard::new(Path::new(project_root))?;
    // Resolving the empty path yields the canonical root; a Project whose folder has been removed
    // fails here rather than half-way through the walk.
    let (_, root) = guard.resolve_existing("")?;
    if !root.is_dir() {
        return Err(AppError::new(
            "project_folder_missing",
            "The Project folder is unavailable.",
            true,
        )
        .layer("project_analyzer"));
    }

    let entries = walk(&root);
    let mut findings = Findings {
        files_scanned: entries.iter().filter(|entry| !entry.is_dir).count(),
        ..Findings::default()
    };

    detect_by_filename(&entries, &mut findings);
    detect_languages(&entries, &mut findings);
    detect_manifests(&root, &entries, &mut findings);
    detect_monorepo(&root, &entries, &mut findings);
    detect_modules(&entries, &mut findings);
    detect_api_surfaces(&root, &entries, &mut findings);
    detect_schemas(&root, &entries, &mut findings);

    let scanned = findings.files_scanned;
    Ok((findings.into_facts(), scanned))
}

// ---- Filename-driven detection ---------------------------------------------------------------

/// `(filename or suffix, dimension, value, confidence)` — the flat table of things a name alone
/// proves. Kept as data rather than a chain of `if`s so adding a framework is one row and the
/// evidence wiring cannot be forgotten.
const FILENAME_SIGNALS: &[(&str, &str, &str, f64)] = &[
    // Package managers, from lockfiles — the strongest signal there is, since a lockfile is
    // written by exactly one tool.
    ("package-lock.json", dimension::PACKAGE_MANAGER, "npm", 0.95),
    ("yarn.lock", dimension::PACKAGE_MANAGER, "Yarn", 0.95),
    ("pnpm-lock.yaml", dimension::PACKAGE_MANAGER, "pnpm", 0.95),
    ("bun.lockb", dimension::PACKAGE_MANAGER, "Bun", 0.95),
    ("cargo.lock", dimension::PACKAGE_MANAGER, "Cargo", 0.95),
    ("poetry.lock", dimension::PACKAGE_MANAGER, "Poetry", 0.95),
    ("uv.lock", dimension::PACKAGE_MANAGER, "uv", 0.95),
    ("pipfile.lock", dimension::PACKAGE_MANAGER, "Pipenv", 0.95),
    ("gemfile.lock", dimension::PACKAGE_MANAGER, "Bundler", 0.95),
    ("go.sum", dimension::PACKAGE_MANAGER, "Go modules", 0.95),
    (
        "composer.lock",
        dimension::PACKAGE_MANAGER,
        "Composer",
        0.95,
    ),
    // Build systems.
    ("vite.config.ts", dimension::BUILD_SYSTEM, "Vite", 0.9),
    ("vite.config.js", dimension::BUILD_SYSTEM, "Vite", 0.9),
    ("vite.config.mts", dimension::BUILD_SYSTEM, "Vite", 0.9),
    ("webpack.config.js", dimension::BUILD_SYSTEM, "webpack", 0.9),
    ("rollup.config.js", dimension::BUILD_SYSTEM, "Rollup", 0.9),
    (
        "esbuild.config.js",
        dimension::BUILD_SYSTEM,
        "esbuild",
        0.85,
    ),
    ("makefile", dimension::BUILD_SYSTEM, "Make", 0.8),
    ("build.gradle", dimension::BUILD_SYSTEM, "Gradle", 0.9),
    ("build.gradle.kts", dimension::BUILD_SYSTEM, "Gradle", 0.9),
    ("pom.xml", dimension::BUILD_SYSTEM, "Maven", 0.9),
    ("turbo.json", dimension::BUILD_SYSTEM, "Turborepo", 0.9),
    ("nx.json", dimension::BUILD_SYSTEM, "Nx", 0.9),
    // Frameworks whose config file is unambiguous.
    ("next.config.js", dimension::FRAMEWORK, "Next.js", 0.9),
    ("next.config.mjs", dimension::FRAMEWORK, "Next.js", 0.9),
    ("next.config.ts", dimension::FRAMEWORK, "Next.js", 0.9),
    ("nuxt.config.ts", dimension::FRAMEWORK, "Nuxt", 0.9),
    ("svelte.config.js", dimension::FRAMEWORK, "Svelte", 0.9),
    ("astro.config.mjs", dimension::FRAMEWORK, "Astro", 0.9),
    ("angular.json", dimension::FRAMEWORK, "Angular", 0.9),
    ("remix.config.js", dimension::FRAMEWORK, "Remix", 0.9),
    (
        "tailwind.config.js",
        dimension::FRAMEWORK,
        "Tailwind CSS",
        0.85,
    ),
    (
        "tailwind.config.ts",
        dimension::FRAMEWORK,
        "Tailwind CSS",
        0.85,
    ),
    ("manage.py", dimension::FRAMEWORK, "Django", 0.8),
    // Test systems.
    ("vitest.config.ts", dimension::TEST_SYSTEM, "Vitest", 0.9),
    ("vitest.config.js", dimension::TEST_SYSTEM, "Vitest", 0.9),
    ("jest.config.js", dimension::TEST_SYSTEM, "Jest", 0.9),
    ("jest.config.ts", dimension::TEST_SYSTEM, "Jest", 0.9),
    (
        "playwright.config.ts",
        dimension::TEST_SYSTEM,
        "Playwright",
        0.9,
    ),
    ("cypress.config.ts", dimension::TEST_SYSTEM, "Cypress", 0.9),
    ("pytest.ini", dimension::TEST_SYSTEM, "pytest", 0.9),
    ("conftest.py", dimension::TEST_SYSTEM, "pytest", 0.8),
    ("karma.conf.js", dimension::TEST_SYSTEM, "Karma", 0.85),
    // Containers and deployment.
    ("dockerfile", dimension::CONTAINER, "Docker", 0.95),
    (
        "docker-compose.yml",
        dimension::CONTAINER,
        "Docker Compose",
        0.95,
    ),
    (
        "docker-compose.yaml",
        dimension::CONTAINER,
        "Docker Compose",
        0.95,
    ),
    ("chart.yaml", dimension::CONTAINER, "Helm", 0.85),
    ("vercel.json", dimension::DEPLOYMENT_SYSTEM, "Vercel", 0.9),
    ("netlify.toml", dimension::DEPLOYMENT_SYSTEM, "Netlify", 0.9),
    ("fly.toml", dimension::DEPLOYMENT_SYSTEM, "Fly.io", 0.9),
    ("render.yaml", dimension::DEPLOYMENT_SYSTEM, "Render", 0.9),
    ("procfile", dimension::DEPLOYMENT_SYSTEM, "Procfile", 0.8),
    (
        "serverless.yml",
        dimension::DEPLOYMENT_SYSTEM,
        "Serverless",
        0.9,
    ),
    ("app.yaml", dimension::DEPLOYMENT_SYSTEM, "App Engine", 0.7),
    // CI.
    (".gitlab-ci.yml", dimension::CI_SYSTEM, "GitLab CI", 0.95),
    (
        "azure-pipelines.yml",
        dimension::CI_SYSTEM,
        "Azure Pipelines",
        0.95,
    ),
    ("jenkinsfile", dimension::CI_SYSTEM, "Jenkins", 0.9),
    ("appveyor.yml", dimension::CI_SYSTEM, "AppVeyor", 0.9),
    // Desktop runtimes.
    ("tauri.conf.json", dimension::DESKTOP_RUNTIME, "Tauri", 0.95),
    (
        "electron-builder.yml",
        dimension::DESKTOP_RUNTIME,
        "Electron",
        0.9,
    ),
    // Conventions.
    (".editorconfig", dimension::CONVENTION, "EditorConfig", 0.9),
    (".prettierrc", dimension::CONVENTION, "Prettier", 0.9),
    (".prettierrc.json", dimension::CONVENTION, "Prettier", 0.9),
    ("rustfmt.toml", dimension::CONVENTION, "rustfmt", 0.9),
    ("clippy.toml", dimension::CONVENTION, "Clippy", 0.9),
    ("eslint.config.js", dimension::CONVENTION, "ESLint", 0.9),
    (".eslintrc.json", dimension::CONVENTION, "ESLint", 0.9),
    (".oxlintrc.json", dimension::CONVENTION, "oxlint", 0.9),
    (
        "tsconfig.json",
        dimension::CONVENTION,
        "TypeScript strict build",
        0.6,
    ),
];

/// Documents worth knowing about by name. Separated from the table above because their *detail* is
/// what they are for, and an agent asking "what should I read first" wants that, not a label.
const DOCUMENT_SIGNALS: &[(&str, &str)] = &[
    ("readme.md", "Project overview"),
    ("claude.md", "Agent operating contract"),
    ("agents.md", "Agent operating contract"),
    ("contributing.md", "Contribution rules"),
    ("architecture.md", "Architecture reference"),
    ("security.md", "Security policy"),
    ("changelog.md", "Release history"),
    ("codeowners", "Ownership map"),
];

fn detect_by_filename(entries: &[Entry], findings: &mut Findings) {
    for entry in entries {
        if entry.is_dir {
            detect_directory_signal(entry, findings);
            continue;
        }
        for (name, dimension, value, confidence) in FILENAME_SIGNALS {
            // Dockerfile variants (`Dockerfile.dev`) still prove Docker.
            let matches = entry.name == *name
                || (*name == "dockerfile" && entry.name.starts_with("dockerfile."));
            if matches {
                findings.add(
                    dimension,
                    *value,
                    None,
                    *confidence,
                    evidence(&entry.path, "config"),
                );
            }
        }
        for (name, purpose) in DOCUMENT_SIGNALS {
            if entry.name == *name {
                findings.add(
                    dimension::DOCUMENT,
                    entry.path.clone(),
                    Some((*purpose).to_owned()),
                    0.9,
                    evidence(&entry.path, "file"),
                );
            }
        }
        // GitHub Actions: the workflow *file* is the fact, since "which workflows exist" is what a
        // developer actually needs, not merely "this repo has CI".
        if entry.path.starts_with(".github/workflows/")
            && (entry.name.ends_with(".yml") || entry.name.ends_with(".yaml"))
        {
            findings.add(
                dimension::CI_SYSTEM,
                "GitHub Actions",
                None,
                0.95,
                evidence(&entry.path, "config"),
            );
        }
        // An ADR directory turns each record into a document worth surfacing.
        if entry.path.to_lowercase().contains("/adr/") && entry.name.ends_with(".md") {
            findings.add(
                dimension::DOCUMENT,
                entry.path.clone(),
                Some("Architecture decision record".to_owned()),
                0.85,
                evidence(&entry.path, "file"),
            );
        }
    }
}

fn detect_directory_signal(entry: &Entry, findings: &mut Findings) {
    match entry.name.as_str() {
        "migrations" | "migration" => findings.add(
            dimension::SCHEMA,
            "Versioned migrations",
            Some(entry.path.clone()),
            0.85,
            evidence(&entry.path, "directory"),
        ),
        ".github" => {}
        "k8s" | "kubernetes" => findings.add(
            dimension::CONTAINER,
            "Kubernetes",
            Some(entry.path.clone()),
            0.85,
            evidence(&entry.path, "directory"),
        ),
        "tests" | "test" | "__tests__" | "spec" => findings.add(
            dimension::TEST_SYSTEM,
            "Dedicated test directory",
            Some(entry.path.clone()),
            0.7,
            evidence(&entry.path, "directory"),
        ),
        _ => {}
    }
}

// ---- Language census -------------------------------------------------------------------------

/// Extension → language. Only extensions that identify a language unambiguously; `.h` could be C or
/// C++ and is therefore absent rather than guessed.
const LANGUAGE_EXTENSIONS: &[(&str, &str)] = &[
    ("rs", "Rust"),
    ("ts", "TypeScript"),
    ("tsx", "TypeScript"),
    ("js", "JavaScript"),
    ("jsx", "JavaScript"),
    ("mjs", "JavaScript"),
    ("py", "Python"),
    ("go", "Go"),
    ("java", "Java"),
    ("kt", "Kotlin"),
    ("swift", "Swift"),
    ("rb", "Ruby"),
    ("php", "PHP"),
    ("cs", "C#"),
    ("cpp", "C++"),
    ("cc", "C++"),
    ("c", "C"),
    ("scala", "Scala"),
    ("ex", "Elixir"),
    ("exs", "Elixir"),
    ("dart", "Dart"),
    ("sql", "SQL"),
    ("sh", "Shell"),
    ("ps1", "PowerShell"),
];

/// Share of source files a language must reach to be reported. Below this it is a script or a
/// single generated file, and listing it as a project language is noise.
const LANGUAGE_THRESHOLD: f64 = 0.02;

fn detect_languages(entries: &[Entry], findings: &mut Findings) {
    let mut counts: BTreeMap<&str, (usize, String)> = BTreeMap::new();
    let mut total = 0usize;
    for entry in entries {
        if entry.is_dir {
            continue;
        }
        let Some(extension) = entry.name.rsplit_once('.').map(|(_, ext)| ext) else {
            continue;
        };
        let Some((_, language)) = LANGUAGE_EXTENSIONS
            .iter()
            .find(|(known, _)| *known == extension)
        else {
            continue;
        };
        total += 1;
        let slot = counts.entry(language).or_insert((0, entry.path.clone()));
        slot.0 += 1;
    }
    if total == 0 {
        return;
    }
    for (language, (count, example)) in counts {
        let share = count as f64 / total as f64;
        if share < LANGUAGE_THRESHOLD {
            continue;
        }
        findings.add(
            dimension::LANGUAGE,
            language,
            Some(format!("{count} files")),
            // A language that dominates is reported with high confidence; one at the threshold is
            // reported as present, not as what the project is written in.
            (0.6 + share * 0.35).min(0.95),
            evidence(&example, "file"),
        );
    }
}

// ---- Manifest parsing ------------------------------------------------------------------------

/// npm dependency → what its presence proves. Ordered most specific first so `next` is reported as
/// Next.js *and* React rather than only React.
const NPM_SIGNALS: &[(&str, &str, &str)] = &[
    ("next", dimension::FRAMEWORK, "Next.js"),
    ("nuxt", dimension::FRAMEWORK, "Nuxt"),
    ("react", dimension::FRAMEWORK, "React"),
    ("vue", dimension::FRAMEWORK, "Vue"),
    ("svelte", dimension::FRAMEWORK, "Svelte"),
    ("@angular/core", dimension::FRAMEWORK, "Angular"),
    ("solid-js", dimension::FRAMEWORK, "SolidJS"),
    ("express", dimension::FRAMEWORK, "Express"),
    ("fastify", dimension::FRAMEWORK, "Fastify"),
    ("@nestjs/core", dimension::FRAMEWORK, "NestJS"),
    ("electron", dimension::DESKTOP_RUNTIME, "Electron"),
    ("@tauri-apps/api", dimension::DESKTOP_RUNTIME, "Tauri"),
    ("react-native", dimension::FRAMEWORK, "React Native"),
    ("vitest", dimension::TEST_SYSTEM, "Vitest"),
    ("jest", dimension::TEST_SYSTEM, "Jest"),
    ("@playwright/test", dimension::TEST_SYSTEM, "Playwright"),
    ("mocha", dimension::TEST_SYSTEM, "Mocha"),
    ("typescript", dimension::LANGUAGE, "TypeScript"),
    ("prisma", dimension::DATABASE, "Prisma"),
    ("@prisma/client", dimension::DATABASE, "Prisma"),
    ("drizzle-orm", dimension::DATABASE, "Drizzle"),
    ("mongoose", dimension::DATABASE, "MongoDB"),
    ("pg", dimension::DATABASE, "PostgreSQL"),
    ("mysql2", dimension::DATABASE, "MySQL"),
    ("better-sqlite3", dimension::DATABASE, "SQLite"),
    ("redis", dimension::DATABASE, "Redis"),
    ("typeorm", dimension::DATABASE, "TypeORM"),
    ("vite", dimension::BUILD_SYSTEM, "Vite"),
    ("webpack", dimension::BUILD_SYSTEM, "webpack"),
    ("eslint", dimension::CONVENTION, "ESLint"),
    ("oxlint", dimension::CONVENTION, "oxlint"),
    ("prettier", dimension::CONVENTION, "Prettier"),
];

/// Cargo dependency → what it proves.
const CARGO_SIGNALS: &[(&str, &str, &str)] = &[
    ("tauri", dimension::DESKTOP_RUNTIME, "Tauri"),
    ("axum", dimension::FRAMEWORK, "Axum"),
    ("actix-web", dimension::FRAMEWORK, "Actix Web"),
    ("rocket", dimension::FRAMEWORK, "Rocket"),
    ("warp", dimension::FRAMEWORK, "Warp"),
    ("tokio", dimension::FRAMEWORK, "Tokio"),
    ("rusqlite", dimension::DATABASE, "SQLite"),
    ("sqlx", dimension::DATABASE, "SQLx"),
    ("diesel", dimension::DATABASE, "Diesel"),
    ("sea-orm", dimension::DATABASE, "SeaORM"),
    ("redis", dimension::DATABASE, "Redis"),
    ("serde", dimension::DEPENDENCY, "serde"),
];

/// Python dependency → what it proves.
const PYTHON_SIGNALS: &[(&str, &str, &str)] = &[
    ("django", dimension::FRAMEWORK, "Django"),
    ("flask", dimension::FRAMEWORK, "Flask"),
    ("fastapi", dimension::FRAMEWORK, "FastAPI"),
    ("sqlalchemy", dimension::DATABASE, "SQLAlchemy"),
    ("psycopg2", dimension::DATABASE, "PostgreSQL"),
    ("pytest", dimension::TEST_SYSTEM, "pytest"),
];

fn detect_manifests(root: &Path, entries: &[Entry], findings: &mut Findings) {
    for entry in entries {
        if entry.is_dir {
            continue;
        }
        match entry.name.as_str() {
            "package.json" => detect_package_json(root, &entry.path, findings),
            "cargo.toml" => detect_cargo_toml(root, &entry.path, findings),
            "pyproject.toml" | "requirements.txt" => {
                detect_python(root, &entry.path, findings);
            }
            "go.mod" => {
                findings.add(
                    dimension::LANGUAGE,
                    "Go",
                    None,
                    0.9,
                    evidence(&entry.path, "manifest"),
                );
                if let Some(text) = read_bounded(root, &entry.path, findings) {
                    if let Some(module) = text
                        .lines()
                        .find_map(|line| line.strip_prefix("module ").map(str::trim))
                    {
                        findings.add(
                            dimension::APPLICATION,
                            module.to_owned(),
                            Some("Go module".to_owned()),
                            0.9,
                            evidence(&entry.path, "manifest"),
                        );
                    }
                }
            }
            "tauri.conf.json" => detect_tauri(root, &entry.path, findings),
            _ => {}
        }
    }
}

fn detect_package_json(root: &Path, path: &str, findings: &mut Findings) {
    let Some(text) = read_bounded(root, path, findings) else {
        return;
    };
    let Ok(manifest) = serde_json::from_str::<Value>(&text) else {
        // A manifest this analyzer cannot parse is left unreported rather than guessed at. Its
        // *existence* was already recorded by the filename pass where that matters.
        return;
    };
    if let Some(name) = manifest.get("name").and_then(Value::as_str) {
        let is_root = !path.contains('/');
        findings.add(
            if is_root {
                dimension::APPLICATION
            } else {
                dimension::MODULE
            },
            name.to_owned(),
            Some(path.to_owned()),
            0.9,
            evidence(path, "manifest"),
        );
    }
    // `packageManager: "pnpm@9"` is authoritative when present — it is the field Corepack reads.
    if let Some(declared) = manifest.get("packageManager").and_then(Value::as_str) {
        let name = declared.split('@').next().unwrap_or(declared);
        findings.add(
            dimension::PACKAGE_MANAGER,
            capitalize(name),
            Some(declared.to_owned()),
            0.95,
            evidence_with(path, "manifest", declared),
        );
    }

    let mut dependencies: BTreeMap<String, String> = BTreeMap::new();
    for section in ["dependencies", "devDependencies", "peerDependencies"] {
        if let Some(map) = manifest.get(section).and_then(Value::as_object) {
            for (name, version) in map {
                dependencies.insert(
                    name.to_lowercase(),
                    version.as_str().unwrap_or_default().to_owned(),
                );
            }
        }
    }
    for (dependency, dimension_key, value) in NPM_SIGNALS {
        if let Some(version) = dependencies.get(*dependency) {
            findings.add(
                dimension_key,
                *value,
                Some(version.clone()),
                0.9,
                evidence_with(path, "manifest", &format!("{dependency}: {version}")),
            );
        }
    }
    // Scripts are how a developer actually builds and tests this package; recording the names is
    // more useful than inferring a build system from a config file that may not be the one run.
    if let Some(scripts) = manifest.get("scripts").and_then(Value::as_object) {
        for name in ["build", "test", "lint", "typecheck", "dev"] {
            if let Some(command) = scripts.get(name).and_then(Value::as_str) {
                let dimension_key = match name {
                    "test" => dimension::TEST_SYSTEM,
                    "lint" | "typecheck" => dimension::CONVENTION,
                    _ => dimension::BUILD_SYSTEM,
                };
                findings.add(
                    dimension_key,
                    format!("npm run {name}"),
                    Some(command.to_owned()),
                    0.85,
                    evidence_with(path, "manifest", command),
                );
            }
        }
    }
}

fn detect_cargo_toml(root: &Path, path: &str, findings: &mut Findings) {
    let Some(text) = read_bounded(root, path, findings) else {
        return;
    };
    findings.add(
        dimension::LANGUAGE,
        "Rust",
        None,
        0.9,
        evidence(path, "manifest"),
    );
    // A deliberately small TOML reader rather than a dependency: the analyzer needs the package
    // name, the workspace members, and which dependency names appear — all of which are visible
    // in section headers and `key =` lines.
    let mut section = String::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            section = trimmed.trim_matches(['[', ']']).to_lowercase();
            continue;
        }
        let Some((key, value)) = trimmed.split_once('=') else {
            continue;
        };
        let key = key.trim().trim_matches('"').to_lowercase();
        let value = value.trim();
        if section == "package" && key == "name" {
            findings.add(
                dimension::MODULE,
                value.trim_matches('"').to_owned(),
                Some(path.to_owned()),
                0.9,
                evidence(path, "manifest"),
            );
        }
        if section.ends_with("dependencies") {
            for (dependency, dimension_key, detected) in CARGO_SIGNALS {
                if key == *dependency {
                    findings.add(
                        dimension_key,
                        *detected,
                        Some(value.trim_matches(['"', '{', '}', ' ']).to_owned()),
                        0.9,
                        evidence_with(path, "manifest", trimmed),
                    );
                }
            }
        }
    }
}

fn detect_python(root: &Path, path: &str, findings: &mut Findings) {
    let Some(text) = read_bounded(root, path, findings) else {
        return;
    };
    findings.add(
        dimension::LANGUAGE,
        "Python",
        None,
        0.85,
        evidence(path, "manifest"),
    );
    let lowered = text.to_lowercase();
    for (dependency, dimension_key, value) in PYTHON_SIGNALS {
        if lowered.contains(dependency) {
            findings.add(dimension_key, *value, None, 0.8, evidence(path, "manifest"));
        }
    }
}

fn detect_tauri(root: &Path, path: &str, findings: &mut Findings) {
    findings.add(
        dimension::DESKTOP_RUNTIME,
        "Tauri",
        None,
        0.95,
        evidence(path, "config"),
    );
    let Some(text) = read_bounded(root, path, findings) else {
        return;
    };
    let Ok(config) = serde_json::from_str::<Value>(&text) else {
        return;
    };
    if let Some(identifier) = config.get("identifier").and_then(Value::as_str) {
        findings.add(
            dimension::APPLICATION,
            identifier.to_owned(),
            Some("Tauri bundle identifier".to_owned()),
            0.9,
            evidence_with(path, "config", identifier),
        );
    }
    if let Some(product) = config
        .get("productName")
        .and_then(Value::as_str)
        .or_else(|| {
            config
                .pointer("/package/productName")
                .and_then(Value::as_str)
        })
    {
        findings.add(
            dimension::APPLICATION,
            product.to_owned(),
            Some("Tauri product".to_owned()),
            0.9,
            evidence_with(path, "config", product),
        );
    }
}

// ---- Monorepo and module structure -------------------------------------------------------------

fn detect_monorepo(root: &Path, entries: &[Entry], findings: &mut Findings) {
    for entry in entries {
        if entry.is_dir {
            continue;
        }
        match entry.name.as_str() {
            "pnpm-workspace.yaml" => findings.add(
                dimension::WORKSPACE,
                "pnpm workspace",
                None,
                0.95,
                evidence(&entry.path, "config"),
            ),
            "lerna.json" => findings.add(
                dimension::WORKSPACE,
                "Lerna",
                None,
                0.9,
                evidence(&entry.path, "config"),
            ),
            "package.json" if !entry.path.contains('/') => {
                if let Some(text) = read_bounded(root, &entry.path, findings) {
                    if let Ok(manifest) = serde_json::from_str::<Value>(&text) {
                        if manifest.get("workspaces").is_some() {
                            findings.add(
                                dimension::WORKSPACE,
                                "npm workspaces",
                                None,
                                0.95,
                                evidence(&entry.path, "manifest"),
                            );
                        }
                    }
                }
            }
            "cargo.toml" if !entry.path.contains('/') => {
                if let Some(text) = read_bounded(root, &entry.path, findings) {
                    if text.contains("[workspace]") {
                        findings.add(
                            dimension::WORKSPACE,
                            "Cargo workspace",
                            None,
                            0.95,
                            evidence(&entry.path, "manifest"),
                        );
                    }
                }
            }
            _ => {}
        }
    }
}

/// Entry points and top-level modules, from directory shape alone.
fn detect_modules(entries: &[Entry], findings: &mut Findings) {
    const ENTRY_POINTS: [&str; 9] = [
        "src/main.tsx",
        "src/main.ts",
        "src/main.rs",
        "src/index.ts",
        "src/index.tsx",
        "src/lib.rs",
        "main.py",
        "main.go",
        "app/main.py",
    ];
    let paths: BTreeSet<&str> = entries.iter().map(|entry| entry.path.as_str()).collect();
    for candidate in ENTRY_POINTS {
        // Match at the root and one level down, which covers `src-tauri/src/lib.rs` and
        // `packages/app/src/main.tsx` without walking every depth.
        for path in &paths {
            if *path == candidate
                || path
                    .strip_suffix(candidate)
                    .is_some_and(|prefix| prefix.ends_with('/') && prefix.matches('/').count() <= 2)
            {
                findings.add(
                    dimension::ENTRY_POINT,
                    (*path).to_owned(),
                    None,
                    0.85,
                    evidence(path, "file"),
                );
            }
        }
    }
    for entry in entries {
        // Second-level directories under a conventional container are the project's modules.
        if !entry.is_dir || entry.depth != 1 {
            continue;
        }
        let Some((parent, _)) = entry.path.rsplit_once('/') else {
            continue;
        };
        if matches!(
            parent,
            "packages" | "apps" | "crates" | "services" | "src/features" | "libs"
        ) {
            findings.add(
                dimension::MODULE,
                entry.path.clone(),
                Some(format!("under {parent}/")),
                0.8,
                evidence(&entry.path, "directory"),
            );
        }
    }
}

// ---- Content-scan detectors ---------------------------------------------------------------------

/// Tauri commands and HTTP routes. Both are cheap string scans over files already known to matter,
/// bounded by the shared content-read budget.
fn detect_api_surfaces(root: &Path, entries: &[Entry], findings: &mut Findings) {
    for entry in entries {
        if entry.is_dir || findings.content_reads >= MAX_CONTENT_READS {
            continue;
        }
        // Next.js route conventions are structural, so they cost no read at all.
        if entry.name == "route.ts" || entry.name == "route.js" {
            if let Some(route) = entry.path.strip_suffix(&format!("/{}", entry.name)) {
                findings.add(
                    dimension::API_SURFACE,
                    format!("/{}", route.trim_start_matches("app/")),
                    Some("Next.js route handler".to_owned()),
                    0.85,
                    evidence(&entry.path, "file"),
                );
            }
            continue;
        }
        if entry.path.starts_with("pages/api/") || entry.path.contains("/pages/api/") {
            findings.add(
                dimension::API_SURFACE,
                entry.path.clone(),
                Some("Next.js API route".to_owned()),
                0.85,
                evidence(&entry.path, "file"),
            );
            continue;
        }
        // Content scans only for files that plausibly declare an interface.
        let scan_rust = entry.name.ends_with(".rs")
            && (entry.path.contains("command") || entry.path.contains("route"));
        let scan_js = (entry.name.ends_with(".ts") || entry.name.ends_with(".js"))
            && (entry.path.contains("route") || entry.path.contains("api"));
        if !scan_rust && !scan_js {
            continue;
        }
        let Some(text) = read_bounded(root, &entry.path, findings) else {
            continue;
        };
        if scan_rust {
            for name in tauri_command_names(&text) {
                findings.add(
                    dimension::API_SURFACE,
                    name.clone(),
                    Some("Tauri command".to_owned()),
                    0.9,
                    evidence_with(&entry.path, "content", &format!("#[tauri::command] {name}")),
                );
            }
        }
        if scan_js {
            for route in express_routes(&text) {
                findings.add(
                    dimension::API_SURFACE,
                    route.clone(),
                    Some("HTTP route".to_owned()),
                    0.8,
                    evidence_with(&entry.path, "content", &route),
                );
            }
        }
    }
}

/// Function names annotated `#[tauri::command]`.
///
/// A line scan rather than a parse: the attribute always sits on the line before the signature, and
/// a full Rust parse to learn a list of names would cost a syntax crate and a lot of time for
/// information the two lines already carry.
fn tauri_command_names(source: &str) -> Vec<String> {
    let lines: Vec<&str> = source.lines().collect();
    let mut names = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        if !line.trim_start().starts_with("#[tauri::command") {
            continue;
        }
        for next in lines.iter().skip(index + 1).take(4) {
            let trimmed = next.trim_start();
            let Some(rest) = trimmed
                .strip_prefix("pub async fn ")
                .or_else(|| trimmed.strip_prefix("pub fn "))
                .or_else(|| trimmed.strip_prefix("async fn "))
                .or_else(|| trimmed.strip_prefix("fn "))
            else {
                continue;
            };
            if let Some(name) = rest.split(['(', '<', ' ']).next() {
                if !name.is_empty() {
                    names.push(name.to_owned());
                }
            }
            break;
        }
    }
    names.sort();
    names.dedup();
    names
}

/// `app.get('/path'` / `router.post("/path"` occurrences.
fn express_routes(source: &str) -> Vec<String> {
    const METHODS: [&str; 5] = [".get(", ".post(", ".put(", ".patch(", ".delete("];
    let mut routes = Vec::new();
    for line in source.lines() {
        for method in METHODS {
            let Some(position) = line.find(method) else {
                continue;
            };
            let rest = &line[position + method.len()..];
            let Some(quote) = rest.chars().next().filter(|c| *c == '\'' || *c == '"') else {
                continue;
            };
            let Some(end) = rest[1..].find(quote) else {
                continue;
            };
            let path = &rest[1..1 + end];
            if path.starts_with('/') {
                let verb = method.trim_start_matches('.').trim_end_matches('(');
                routes.push(format!("{} {path}", verb.to_uppercase()));
            }
        }
    }
    routes.sort();
    routes.dedup();
    routes.truncate(20);
    routes
}

/// SQL objects from migration and schema files.
fn detect_schemas(root: &Path, entries: &[Entry], findings: &mut Findings) {
    for entry in entries {
        if entry.is_dir || findings.content_reads >= MAX_CONTENT_READS {
            continue;
        }
        let is_sql = entry.name.ends_with(".sql");
        let is_prisma = entry.name == "schema.prisma";
        if !is_sql && !is_prisma {
            continue;
        }
        let Some(text) = read_bounded(root, &entry.path, findings) else {
            continue;
        };
        let mut tables: Vec<String> = Vec::new();
        if is_sql {
            for line in text.lines() {
                let lowered = line.trim().to_lowercase();
                let Some(rest) = lowered
                    .strip_prefix("create table if not exists ")
                    .or_else(|| lowered.strip_prefix("create table "))
                else {
                    continue;
                };
                if let Some(name) = rest.split(['(', ' ']).next() {
                    if !name.is_empty() {
                        tables.push(name.trim_matches(['"', '`', '[', ']']).to_owned());
                    }
                }
            }
        } else {
            for line in text.lines() {
                if let Some(rest) = line.trim().strip_prefix("model ") {
                    if let Some(name) = rest.split([' ', '{']).next() {
                        tables.push(name.to_owned());
                    }
                }
            }
        }
        tables.sort();
        tables.dedup();
        tables.truncate(30);
        for table in tables {
            findings.add(
                dimension::SCHEMA,
                table.clone(),
                Some("table".to_owned()),
                0.9,
                evidence_with(&entry.path, "content", &format!("table {table}")),
            );
        }
    }
}

fn capitalize(value: &str) -> String {
    let mut chars = value.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

// ---- Candidate extraction ------------------------------------------------------------------------

/// Which entity kind a fact's subject belongs to, and whether it is worth learning at all.
///
/// Not every detected fact is durable knowledge. "TypeScript is a language here" is true and
/// uninteresting — it is already the Overview's job. What earns a candidate is a fact an agent
/// would otherwise have to rediscover: what the app is, what it exposes, what it stores in.
fn candidate_shape(dimension_key: &str) -> Option<(&'static str, &'static str, &'static str, f64)> {
    // (entity kind, predicate, suggested memory type, confidence)
    Some(match dimension_key {
        dimension::FRAMEWORK => (entity_kind::COMPONENT, "uses_framework", "component", 0.9),
        dimension::DESKTOP_RUNTIME => (entity_kind::COMPONENT, "runs_on", "component", 0.9),
        dimension::API_SURFACE => (entity_kind::API, "exposes", "api", 0.9),
        dimension::DATABASE => (entity_kind::DATABASE, "stores_in", "database", 0.9),
        dimension::SCHEMA => (entity_kind::TABLE, "defines_table", "database", 0.9),
        dimension::TEST_SYSTEM => (entity_kind::MODULE, "tested_with", "test", 0.85),
        dimension::CI_SYSTEM => (entity_kind::MODULE, "built_by", "component", 0.85),
        dimension::DEPLOYMENT_SYSTEM => (entity_kind::MODULE, "deployed_by", "component", 0.85),
        dimension::MODULE | dimension::APPLICATION => {
            (entity_kind::MODULE, "is_module_of", "component", 0.85)
        }
        dimension::ENTRY_POINT => (entity_kind::MODULE, "entry_point", "component", 0.85),
        dimension::CONTAINER => (entity_kind::MODULE, "packaged_by", "component", 0.85),
        // Languages, package managers, workspaces, documents, and conventions stay in the Overview
        // rather than becoming Memory: they are structural facts a surface already shows, and
        // promoting them would fill Review with rows nobody needs to decide about.
        _ => return None,
    })
}

/// Turn analyzer facts into knowledge candidates.
///
/// `project_name` is used as the subject for project-wide facts so the resulting entity is the
/// project itself rather than a nameless subject.
pub fn candidates_from_facts(facts: &[ProjectFact], project_name: &str) -> Vec<CandidateInput> {
    let mut out = Vec::new();
    for fact in facts {
        let Some((subject_kind, predicate, memory_type, base_confidence)) =
            candidate_shape(&fact.dimension)
        else {
            continue;
        };
        // The entity is the *subject* the fact is about. For a route or a table that is the object
        // itself; for everything else it is the project.
        let (subject, subject_identity, object) = match fact.dimension.as_str() {
            dimension::API_SURFACE => (
                fact.value.clone(),
                Some(format!("route:{}", fact.value)),
                fact.detail.clone().unwrap_or_else(|| "route".to_owned()),
            ),
            dimension::SCHEMA => (
                fact.value.clone(),
                Some(format!("table:{}", fact.value)),
                "table".to_owned(),
            ),
            dimension::MODULE | dimension::APPLICATION | dimension::ENTRY_POINT => (
                fact.value.clone(),
                Some(format!("module:{}", fact.value)),
                project_name.to_owned(),
            ),
            _ => (project_name.to_owned(), None, fact.value.clone()),
        };
        let statement = match fact.dimension.as_str() {
            dimension::API_SURFACE => format!("{subject} is an API surface of {project_name}"),
            dimension::SCHEMA => format!("{project_name} defines the table {subject}"),
            dimension::MODULE | dimension::APPLICATION => {
                format!("{subject} is a module of {project_name}")
            }
            dimension::ENTRY_POINT => format!("{subject} is an entry point of {project_name}"),
            _ => format!("{project_name} {} {object}", predicate.replace('_', " ")),
        };
        out.push(CandidateInput {
            kind: format!("project_analyzer.{}", fact.dimension),
            subject,
            subject_kind: subject_kind.to_owned(),
            subject_identity,
            predicate: predicate.to_owned(),
            object,
            statement,
            suggested_memory_type: memory_type.to_owned(),
            // A candidate is never more confident than the fact it rests on.
            confidence: base_confidence.min(fact.confidence),
            origin: CandidateOrigin::Deterministic,
            branch_name: None,
            created_by: "project_analyzer".to_owned(),
            evidence: fact.evidence.clone(),
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    struct Sandbox {
        root: PathBuf,
    }

    impl Drop for Sandbox {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    fn sandbox() -> Sandbox {
        let root = std::fs::canonicalize(std::env::temp_dir())
            .unwrap()
            .join(format!("paralith-analyzer-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        Sandbox { root }
    }

    fn write(sandbox: &Sandbox, relative: &str, contents: &str) {
        let path = sandbox.root.join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, contents).unwrap();
    }

    fn facts(sandbox: &Sandbox) -> Vec<ProjectFact> {
        analyze(sandbox.root.to_str().unwrap()).unwrap().0
    }

    fn values(facts: &[ProjectFact], dimension_key: &str) -> Vec<String> {
        facts
            .iter()
            .filter(|fact| fact.dimension == dimension_key)
            .map(|fact| fact.value.clone())
            .collect()
    }

    #[test]
    fn a_react_vite_project_is_detected_from_its_manifest_and_config() {
        let sandbox = sandbox();
        write(
            &sandbox,
            "package.json",
            r#"{"name":"web","dependencies":{"react":"19.0.0"},"devDependencies":{"vite":"6.0.0"}}"#,
        );
        write(&sandbox, "vite.config.ts", "export default {}");
        write(&sandbox, "pnpm-lock.yaml", "lockfileVersion: 9");
        write(&sandbox, "src/main.tsx", "export function App() {}");

        let facts = facts(&sandbox);
        assert!(values(&facts, dimension::FRAMEWORK).contains(&"React".to_owned()));
        assert!(values(&facts, dimension::BUILD_SYSTEM).contains(&"Vite".to_owned()));
        assert!(values(&facts, dimension::PACKAGE_MANAGER).contains(&"pnpm".to_owned()));
        assert!(values(&facts, dimension::ENTRY_POINT).contains(&"src/main.tsx".to_owned()));
    }

    #[test]
    fn a_tauri_project_reports_its_desktop_runtime_and_bundle() {
        let sandbox = sandbox();
        write(
            &sandbox,
            "src-tauri/tauri.conf.json",
            r#"{"productName":"Paralith","identifier":"com.corelith.paralith"}"#,
        );
        write(
            &sandbox,
            "src-tauri/Cargo.toml",
            "[package]\nname = \"paralith\"\n\n[dependencies]\ntauri = \"2\"\nrusqlite = \"0.32\"\n",
        );

        let facts = facts(&sandbox);
        assert!(values(&facts, dimension::DESKTOP_RUNTIME).contains(&"Tauri".to_owned()));
        assert!(values(&facts, dimension::APPLICATION).contains(&"Paralith".to_owned()));
        assert!(values(&facts, dimension::DATABASE).contains(&"SQLite".to_owned()));
        assert!(values(&facts, dimension::LANGUAGE).contains(&"Rust".to_owned()));
    }

    #[test]
    fn a_monorepo_is_recognized_and_its_packages_become_modules() {
        let sandbox = sandbox();
        write(
            &sandbox,
            "package.json",
            r#"{"name":"root","workspaces":["packages/*"]}"#,
        );
        write(
            &sandbox,
            "packages/api/package.json",
            r#"{"name":"@app/api"}"#,
        );
        write(
            &sandbox,
            "packages/web/package.json",
            r#"{"name":"@app/web"}"#,
        );

        let facts = facts(&sandbox);
        assert!(values(&facts, dimension::WORKSPACE).contains(&"npm workspaces".to_owned()));
        let modules = values(&facts, dimension::MODULE);
        assert!(modules.contains(&"@app/api".to_owned()));
        assert!(modules.contains(&"packages/web".to_owned()));
    }

    #[test]
    fn ci_container_and_deployment_configuration_are_detected() {
        let sandbox = sandbox();
        write(&sandbox, ".github/workflows/ci.yml", "name: CI");
        write(&sandbox, "Dockerfile", "FROM node:22");
        write(&sandbox, "fly.toml", "app = 'x'");

        let facts = facts(&sandbox);
        assert!(values(&facts, dimension::CI_SYSTEM).contains(&"GitHub Actions".to_owned()));
        assert!(values(&facts, dimension::CONTAINER).contains(&"Docker".to_owned()));
        assert!(values(&facts, dimension::DEPLOYMENT_SYSTEM).contains(&"Fly.io".to_owned()));
    }

    #[test]
    fn database_tables_are_read_out_of_migration_sql() {
        let sandbox = sandbox();
        write(
            &sandbox,
            "migrations/001_init.sql",
            "CREATE TABLE users(id TEXT);\nCREATE TABLE IF NOT EXISTS sessions(id TEXT);",
        );
        let facts = facts(&sandbox);
        let tables = values(&facts, dimension::SCHEMA);
        assert!(tables.contains(&"users".to_owned()));
        assert!(tables.contains(&"sessions".to_owned()));
    }

    #[test]
    fn tauri_commands_are_detected_as_an_api_surface() {
        let source = r#"
#[tauri::command]
pub async fn memory_search(request: SearchMemoryRequest) -> AppResult<Vec<Hit>> { }

#[tauri::command]
fn memory_list() {}

fn not_a_command() {}
"#;
        let names = tauri_command_names(source);
        assert_eq!(names, vec!["memory_list", "memory_search"]);
    }

    #[test]
    fn express_routes_are_detected_with_their_verb() {
        let source = "app.get('/api/sessions', handler)\nrouter.post(\"/api/users\", handler)";
        assert_eq!(
            express_routes(source),
            vec!["GET /api/sessions".to_owned(), "POST /api/users".to_owned()]
        );
    }

    #[test]
    fn every_fact_carries_at_least_one_piece_of_evidence() {
        let sandbox = sandbox();
        write(
            &sandbox,
            "package.json",
            r#"{"name":"web","dependencies":{"react":"19"}}"#,
        );
        write(&sandbox, "src/index.ts", "export {}");
        for fact in facts(&sandbox) {
            assert!(
                !fact.evidence.is_empty(),
                "{}={} was reported without evidence",
                fact.dimension,
                fact.value
            );
            assert!(fact.confidence > 0.0 && fact.confidence <= 1.0);
        }
    }

    #[test]
    fn nothing_is_claimed_about_an_empty_project() {
        let sandbox = sandbox();
        let (facts, scanned) = analyze(sandbox.root.to_str().unwrap()).unwrap();
        assert!(facts.is_empty(), "an empty folder supports no claims");
        assert_eq!(scanned, 0);
    }

    #[test]
    fn generated_directories_are_never_walked() {
        let sandbox = sandbox();
        write(&sandbox, "package.json", r#"{"name":"web"}"#);
        write(
            &sandbox,
            "node_modules/next/package.json",
            r#"{"name":"next","dependencies":{"react":"19"}}"#,
        );
        write(&sandbox, "target/debug/build.rs", "fn main() {}");

        let facts = facts(&sandbox);
        assert!(
            values(&facts, dimension::FRAMEWORK).is_empty(),
            "a dependency's own manifest must not become this project's framework"
        );
        assert!(!facts.iter().any(|fact| fact
            .evidence
            .iter()
            .any(|item| item.path.contains("node_modules"))));
    }

    #[test]
    fn an_unparseable_manifest_is_skipped_rather_than_guessed_at() {
        let sandbox = sandbox();
        write(&sandbox, "package.json", "{ this is not json");
        write(&sandbox, "yarn.lock", "");
        let facts = facts(&sandbox);
        // The lockfile still proves the package manager; the broken manifest proves nothing.
        assert!(values(&facts, dimension::PACKAGE_MANAGER).contains(&"Yarn".to_owned()));
        assert!(values(&facts, dimension::APPLICATION).is_empty());
    }

    #[test]
    fn a_missing_project_folder_is_an_error_not_an_empty_result() {
        let error = analyze("this/path/does/not/exist").unwrap_err();
        assert!(
            error.code.contains("project_folder") || error.code.contains("path"),
            "got {}",
            error.code
        );
    }

    #[test]
    fn candidates_are_generated_only_for_facts_worth_learning() {
        let sandbox = sandbox();
        write(
            &sandbox,
            "package.json",
            r#"{"name":"web","dependencies":{"react":"19"}}"#,
        );
        write(
            &sandbox,
            "migrations/001.sql",
            "CREATE TABLE users(id TEXT);",
        );
        write(&sandbox, "src/index.ts", "export {}");

        let facts = facts(&sandbox);
        let candidates = candidates_from_facts(&facts, "web");
        assert!(candidates
            .iter()
            .any(|candidate| candidate.predicate == "uses_framework"));
        assert!(candidates
            .iter()
            .any(|candidate| candidate.predicate == "defines_table"));
        assert!(
            !candidates
                .iter()
                .any(|candidate| candidate.kind.ends_with("language")),
            "a language census belongs on the Overview, not in Review"
        );
        for candidate in &candidates {
            assert!(
                !candidate.evidence.is_empty(),
                "a candidate must inherit the evidence of the fact behind it"
            );
        }
    }

    #[test]
    fn an_evidence_excerpt_that_looks_like_a_credential_is_dropped() {
        let clean = evidence_with("package.json", "manifest", "react: 19.0.0");
        assert!(clean.excerpt.is_some());
        let secret = evidence_with(
            ".env",
            "content",
            "api_key=sk-live-abcdefghijklmnopqrstuvwxyz",
        );
        assert!(
            secret.excerpt.is_none(),
            "the pointer stays, the credential does not"
        );
        assert_eq!(secret.path, ".env");
    }
}

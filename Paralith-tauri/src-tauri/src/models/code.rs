//! The code graph contract: files, symbols, imports, and references.
//!
//! This is deliberately *not* a language server. A language server answers "what does this
//! expression evaluate to"; the code graph answers "what exists, what names it, and what would a
//! change here put in question". The second question is answerable from a deterministic scan and
//! is the one the Context Fabric actually asks.
//!
//! ## Symbol identity is content-addressed
//!
//! [`SymbolIdentity`] hashes `(project, path, kind, container, name)`. Two consequences follow, and
//! both are the point:
//!
//! * a reindex of an unchanged file produces byte-identical ids, so references resolved before the
//!   reindex still resolve after it without a rewrite pass;
//! * moving a function to another file gives it a *new* id, which is correct — a caller that
//!   pointed at `auth.rs::verify` is not automatically pointing at `session.rs::verify`, and
//!   pretending otherwise would fabricate a relationship nobody asserted.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Languages the deterministic indexer understands. Anything else is recorded as a file with no
/// symbols rather than skipped, because "this file exists and we could not read its structure" is
/// different from "this file does not exist".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CodeLanguage {
    Rust,
    TypeScript,
    Tsx,
    JavaScript,
    Jsx,
    Python,
    Go,
    Java,
    CSharp,
    Ruby,
    Php,
    Css,
    Json,
    Markdown,
    Sql,
    Toml,
    Yaml,
    Other,
}

impl CodeLanguage {
    pub fn from_path(path: &str) -> Self {
        let extension = path.rsplit('.').next().unwrap_or_default().to_lowercase();
        match extension.as_str() {
            "rs" => Self::Rust,
            "ts" | "mts" | "cts" => Self::TypeScript,
            "tsx" => Self::Tsx,
            "js" | "mjs" | "cjs" => Self::JavaScript,
            "jsx" => Self::Jsx,
            "py" | "pyi" => Self::Python,
            "go" => Self::Go,
            "java" => Self::Java,
            "cs" => Self::CSharp,
            "rb" => Self::Ruby,
            "php" => Self::Php,
            "css" | "scss" | "less" => Self::Css,
            "json" => Self::Json,
            "md" | "mdx" => Self::Markdown,
            "sql" => Self::Sql,
            "toml" => Self::Toml,
            "yaml" | "yml" => Self::Yaml,
            _ => Self::Other,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Rust => "rust",
            Self::TypeScript => "typescript",
            Self::Tsx => "tsx",
            Self::JavaScript => "javascript",
            Self::Jsx => "jsx",
            Self::Python => "python",
            Self::Go => "go",
            Self::Java => "java",
            Self::CSharp => "csharp",
            Self::Ruby => "ruby",
            Self::Php => "php",
            Self::Css => "css",
            Self::Json => "json",
            Self::Markdown => "markdown",
            Self::Sql => "sql",
            Self::Toml => "toml",
            Self::Yaml => "yaml",
            Self::Other => "other",
        }
    }

    /// Whether the deterministic indexer has a symbol grammar for this language. A language
    /// without one is still recorded as a file and still participates in the import graph where a
    /// manifest names it.
    pub fn has_symbol_grammar(self) -> bool {
        matches!(
            self,
            Self::Rust
                | Self::TypeScript
                | Self::Tsx
                | Self::JavaScript
                | Self::Jsx
                | Self::Python
                | Self::Go
                | Self::Java
                | Self::CSharp
        )
    }
}

/// What a symbol is. A closed vocabulary, for the same reason relation types are closed: a bag of
/// strings stops being a graph.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SymbolKind {
    Function,
    Method,
    Class,
    Struct,
    Enum,
    Interface,
    TypeAlias,
    Trait,
    Impl,
    Constant,
    Variable,
    Component,
    Module,
    Hook,
    Test,
}

impl SymbolKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Function => "function",
            Self::Method => "method",
            Self::Class => "class",
            Self::Struct => "struct",
            Self::Enum => "enum",
            Self::Interface => "interface",
            Self::TypeAlias => "type_alias",
            Self::Trait => "trait",
            Self::Impl => "impl",
            Self::Constant => "constant",
            Self::Variable => "variable",
            Self::Component => "component",
            Self::Module => "module",
            Self::Hook => "hook",
            Self::Test => "test",
        }
    }

    pub fn parse(value: &str) -> Self {
        match value {
            "method" => Self::Method,
            "class" => Self::Class,
            "struct" => Self::Struct,
            "enum" => Self::Enum,
            "interface" => Self::Interface,
            "type_alias" => Self::TypeAlias,
            "trait" => Self::Trait,
            "impl" => Self::Impl,
            "constant" => Self::Constant,
            "variable" => Self::Variable,
            "component" => Self::Component,
            "module" => Self::Module,
            "hook" => Self::Hook,
            "test" => Self::Test,
            _ => Self::Function,
        }
    }

    /// Whether this kind can contain other symbols, which is what makes `container` meaningful.
    pub fn is_container(self) -> bool {
        matches!(
            self,
            Self::Class | Self::Struct | Self::Enum | Self::Interface | Self::Trait | Self::Impl
        )
    }
}

/// How a reference relates its site to its target.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReferenceKind {
    /// The name appears; the indexer does not claim it is invoked.
    Reference,
    /// The name appears in call position.
    Call,
    Extends,
    Implements,
    /// A JSX/TSX element naming a component.
    Renders,
}

impl ReferenceKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Reference => "reference",
            Self::Call => "call",
            Self::Extends => "extends",
            Self::Implements => "implements",
            Self::Renders => "renders",
        }
    }

    pub fn parse(value: &str) -> Self {
        match value {
            "call" => Self::Call,
            "extends" => Self::Extends,
            "implements" => Self::Implements,
            "renders" => Self::Renders,
            _ => Self::Reference,
        }
    }
}

/// Stable, content-addressed symbol identity.
pub struct SymbolIdentity;

impl SymbolIdentity {
    pub fn compute(
        project_id: &str,
        path: &str,
        kind: SymbolKind,
        container: Option<&str>,
        name: &str,
    ) -> String {
        let mut hasher = Sha256::new();
        hasher.update(project_id.as_bytes());
        hasher.update([0u8]);
        hasher.update(path.as_bytes());
        hasher.update([0u8]);
        hasher.update(kind.as_str().as_bytes());
        hasher.update([0u8]);
        hasher.update(container.unwrap_or_default().as_bytes());
        hasher.update([0u8]);
        hasher.update(name.as_bytes());
        format!("sym_{:x}", hasher.finalize())[..24].to_owned()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeFileRecord {
    pub id: String,
    pub path: String,
    pub language: String,
    pub module: Option<String>,
    pub content_hash: String,
    pub size_bytes: u64,
    pub line_count: usize,
    pub parser: String,
    pub indexed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeSymbol {
    pub id: String,
    pub path: String,
    pub kind: SymbolKind,
    pub name: String,
    pub container: Option<String>,
    pub signature: Option<String>,
    pub doc: Option<String>,
    pub start_line: usize,
    pub end_line: usize,
    pub exported: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeImport {
    pub id: String,
    pub path: String,
    pub specifier: String,
    pub resolved_path: Option<String>,
    pub external: bool,
    pub symbols: Vec<String>,
    pub line: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeReference {
    pub id: String,
    pub path: String,
    pub symbol_name: String,
    pub target_symbol_id: Option<String>,
    pub from_symbol_id: Option<String>,
    pub kind: ReferenceKind,
    pub line: usize,
}

/// Everything the indexer derived from one file, before persistence.
#[derive(Debug, Clone, Default)]
pub struct ParsedFile {
    pub language: String,
    pub module: Option<String>,
    pub line_count: usize,
    pub symbols: Vec<ParsedSymbol>,
    pub imports: Vec<ParsedImport>,
    pub references: Vec<ParsedReference>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedSymbol {
    pub kind: SymbolKind,
    pub name: String,
    pub container: Option<String>,
    pub signature: Option<String>,
    pub doc: Option<String>,
    pub start_line: usize,
    pub end_line: usize,
    pub exported: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedImport {
    pub specifier: String,
    pub symbols: Vec<String>,
    pub line: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedReference {
    pub symbol_name: String,
    pub kind: ReferenceKind,
    pub line: usize,
    /// Name of the enclosing symbol at the reference site, resolved to an id at persistence time.
    pub from_symbol: Option<String>,
}

/// What one indexing pass did. Reported rather than logged, because "the index is stale because we
/// hit the file bound" is a fact the surface has to be able to show.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeIndexReport {
    pub project_id: String,
    pub files_indexed: usize,
    pub files_removed: usize,
    pub files_skipped: usize,
    pub symbols_indexed: usize,
    pub references_indexed: usize,
    pub imports_indexed: usize,
    /// True when a bound stopped the walk before the tree was exhausted.
    pub truncated: bool,
    pub elapsed_ms: u64,
    pub incremental: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeIndexState {
    pub project_id: String,
    pub files_indexed: usize,
    pub symbols_indexed: usize,
    pub references_indexed: usize,
    pub revision: i64,
    pub truncated: bool,
    pub indexed_at: Option<String>,
}

/// A symbol with the edges that make it useful to an agent.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SymbolDetail {
    pub symbol: CodeSymbol,
    pub callers: Vec<CodeReference>,
    pub callees: Vec<CodeSymbol>,
    pub references: Vec<CodeReference>,
    /// Memories whose provenance cites this symbol's file and overlaps its line range.
    pub related_memory_ids: Vec<String>,
}

/// What a file depends on and what depends on it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDependencies {
    pub path: String,
    pub imports: Vec<CodeImport>,
    /// Project files that import this one.
    pub dependents: Vec<String>,
    pub external: Vec<String>,
}

/// The blast radius of changing a file or symbol, expressed as code edges only. Knowledge impact
/// stays in `memory_impact`; the two are joined at the surface, not conflated in one report.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeImpact {
    pub root: String,
    pub direct_dependents: Vec<String>,
    pub transitive_dependents: Vec<String>,
    pub affected_symbols: Vec<CodeSymbol>,
    pub truncated: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn symbol_identity_is_stable_and_scoped() {
        let a = SymbolIdentity::compute("p1", "src/a.rs", SymbolKind::Function, None, "run");
        let again = SymbolIdentity::compute("p1", "src/a.rs", SymbolKind::Function, None, "run");
        assert_eq!(a, again, "the same symbol must hash identically on reindex");

        let other_project =
            SymbolIdentity::compute("p2", "src/a.rs", SymbolKind::Function, None, "run");
        let other_path =
            SymbolIdentity::compute("p1", "src/b.rs", SymbolKind::Function, None, "run");
        let other_container = SymbolIdentity::compute(
            "p1",
            "src/a.rs",
            SymbolKind::Function,
            Some("Engine"),
            "run",
        );
        assert_ne!(a, other_project);
        assert_ne!(a, other_path);
        assert_ne!(a, other_container);
    }

    #[test]
    fn language_detection_covers_the_repository() {
        assert_eq!(CodeLanguage::from_path("src/lib.rs"), CodeLanguage::Rust);
        assert_eq!(CodeLanguage::from_path("src/App.tsx"), CodeLanguage::Tsx);
        assert_eq!(
            CodeLanguage::from_path("scripts/build.mjs"),
            CodeLanguage::JavaScript
        );
        assert_eq!(CodeLanguage::from_path("Cargo.toml"), CodeLanguage::Toml);
        assert_eq!(CodeLanguage::from_path("noextension"), CodeLanguage::Other);
    }

    #[test]
    fn every_enum_round_trips_through_its_wire_form() {
        for kind in [
            SymbolKind::Function,
            SymbolKind::Method,
            SymbolKind::Class,
            SymbolKind::Struct,
            SymbolKind::Enum,
            SymbolKind::Interface,
            SymbolKind::TypeAlias,
            SymbolKind::Trait,
            SymbolKind::Impl,
            SymbolKind::Constant,
            SymbolKind::Variable,
            SymbolKind::Component,
            SymbolKind::Module,
            SymbolKind::Hook,
            SymbolKind::Test,
        ] {
            assert_eq!(SymbolKind::parse(kind.as_str()), kind);
        }
        for kind in [
            ReferenceKind::Reference,
            ReferenceKind::Call,
            ReferenceKind::Extends,
            ReferenceKind::Implements,
            ReferenceKind::Renders,
        ] {
            assert_eq!(ReferenceKind::parse(kind.as_str()), kind);
        }
    }
}

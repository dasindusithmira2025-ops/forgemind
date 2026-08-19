//! Deterministic Markdown analysis for the Context Fabric.
//!
//! Everything in this module is a pure function over text: no database, no filesystem, no model.
//! That is the point — a memory's slug, its properties, its outgoing links, and its summary are
//! derived the same way on every machine and every run, so the link graph is reproducible and an
//! index rebuild can never invent a different answer than the original write.
//!
//! Semantic extraction (turning prose into claims) deliberately does **not** live here. Claims
//! are created explicitly through the claim API by a user or an agent, because a claim carries a
//! confidence and evidence that a regex cannot honestly produce.

use crate::errors::{AppError, AppResult};
use crate::orchestration::redaction::redact_text;

/// Upper bound on a single memory body. Large enough for a long architecture decision record,
/// small enough that parsing, hashing, and FTS indexing stay well inside the interaction budget.
pub const MAX_MEMORY_BODY_BYTES: usize = 512_000;

/// Cap on links recorded per memory. A pathological body cannot expand into an unbounded number
/// of graph edges.
const MAX_LINKS_PER_MEMORY: usize = 500;

/// Cap on frontmatter entries recorded per memory.
const MAX_PROPERTIES_PER_MEMORY: usize = 200;

/// Frontmatter keys whose values are treated as tags rather than ordinary properties.
const TAG_KEYS: &[&str] = &["tag", "tags"];

/// Frontmatter keys that name alternative titles this memory also answers to. Aliases participate
/// in link resolution, so `[[Auth Service]]` can reach a memory titled "Authentication Service".
const ALIAS_KEYS: &[&str] = &["alias", "aliases"];

/// The parsed form of a memory document.
#[derive(Debug, Clone, Default)]
pub struct ParsedMemory {
    /// Body with the frontmatter block removed, as stored and indexed.
    pub body: String,
    /// Ordered `(key, value)` frontmatter pairs, list values flattened into repeated keys.
    pub properties: Vec<(String, String)>,
    pub tags: Vec<String>,
    pub aliases: Vec<String>,
    pub links: Vec<ParsedLink>,
    /// First paragraph of prose, used as the list/search summary.
    pub summary: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedLink {
    /// Normalized target used for graph joins.
    pub target_slug: String,
    /// The target exactly as the author typed it, preserved for display and for repair when a
    /// link stays unresolved.
    pub target_text: String,
    pub anchor: Option<String>,
    pub alias: Option<String>,
}

/// Normalize a title or link target into the stable key used for identity and link resolution.
///
/// Lowercase, ASCII alphanumerics kept, every other run of characters collapsed to a single `-`.
/// Non-ASCII characters are kept as-is once lowercased so a non-English title still produces a
/// stable, non-empty slug rather than collapsing to nothing.
pub fn slugify(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut pending_separator = false;
    for character in input.trim().chars() {
        if character.is_alphanumeric() {
            if pending_separator && !out.is_empty() {
                out.push('-');
            }
            pending_separator = false;
            out.extend(character.to_lowercase());
        } else {
            pending_separator = true;
        }
    }
    out
}

/// Reject a body that carries recognizable secret material.
///
/// This reuses the orchestration redactor rather than growing a second detector: if redaction
/// would change the text, the text contains something that must not be persisted or indexed.
/// Memory blocks instead of redacting, because a silently altered document would be a lie about
/// what the user wrote — and the FTS index would still have seen the original.
///
/// The redactor is line-oriented: it recognizes `NAME=value` only when the name occupies the
/// whole line prefix, which is the right rule for a log tail but the wrong one for a memory,
/// where prose like "export `AWS_SECRET_ACCESS_KEY=…` before deploying" is exactly the shape that
/// must not be stored. So each whitespace-delimited token is also checked on its own, which makes
/// an embedded assignment look like the single-assignment line the redactor already understands.
pub fn reject_secrets(body: &str) -> AppResult<()> {
    let flagged =
        redact_text(body) != body || secret_tokens(body).any(|token| redact_text(token) != token);
    if !flagged {
        return Ok(());
    }
    Err(secret_error(first_sensitive_name(body).as_deref()))
}

/// Whitespace-delimited tokens with Markdown decoration stripped from both ends.
///
/// The stripping matters: a memory writes a credential as ``` `api_key=sk-live-…` ``` far more
/// often than bare, and a leading backtick is enough to stop the redactor recognizing the name.
fn secret_tokens(body: &str) -> impl Iterator<Item = &str> {
    body.split_whitespace()
        .map(|token| token.trim_matches(|character: char| MARKDOWN_DELIMITERS.contains(character)))
        .filter(|token| !token.is_empty())
}

const MARKDOWN_DELIMITERS: &str = "`\"'*_~()[]{}<>,;.!?";

/// The key name of the first credential-shaped assignment, for a message the user can act on.
/// Only the *name* is surfaced — never the value, which is the part that must not be repeated
/// into an error, a log, or a diagnostic export.
fn first_sensitive_name(text: &str) -> Option<String> {
    for line in text.lines() {
        for token in std::iter::once(line).chain(secret_tokens(line)) {
            if redact_text(token) == token {
                continue;
            }
            if let Some((name, _)) = token.split_once(['=', ':']) {
                let name = name
                    .trim()
                    .trim_matches(|character: char| MARKDOWN_DELIMITERS.contains(character));
                if !name.is_empty() && name.len() <= 64 && !name.contains(char::is_whitespace) {
                    return Some(name.to_owned());
                }
            }
        }
    }
    None
}

fn secret_error(name: Option<&str>) -> AppError {
    let message = match name {
        Some(name) => format!(
            "`{name}` looks like a credential. Memory will not store secrets, so this was not saved."
        ),
        None => "This memory looks like it contains a credential, token, or key, so it was not saved."
            .to_string(),
    };
    AppError::new("memory_secret_rejected", message, true)
        .action("Replace the secret with a reference to where it is stored.")
        .layer("memory")
}

/// Parse a memory document: split frontmatter, collect properties/tags/aliases, extract outgoing
/// links, and derive a summary.
pub fn parse_memory(raw: &str) -> ParsedMemory {
    let (frontmatter, body) = split_frontmatter(raw);
    let mut parsed = ParsedMemory {
        summary: derive_summary(body),
        body: body.to_owned(),
        links: extract_links(body),
        ..Default::default()
    };
    for (key, value) in parse_frontmatter(frontmatter) {
        let lower = key.to_ascii_lowercase();
        if TAG_KEYS.contains(&lower.as_str()) {
            let tag = normalize_tag(&value);
            if !tag.is_empty() && !parsed.tags.contains(&tag) {
                parsed.tags.push(tag);
            }
            continue;
        }
        if ALIAS_KEYS.contains(&lower.as_str()) {
            let alias = slugify(&value);
            if !alias.is_empty() && !parsed.aliases.contains(&alias) {
                parsed.aliases.push(alias);
            }
        }
        if parsed.properties.len() < MAX_PROPERTIES_PER_MEMORY {
            parsed.properties.push((lower, value));
        }
    }
    // Inline `#tag` markers are a second, lighter-weight way to tag a memory. Only leading-hash
    // words on their own are considered, so a Markdown `# Heading` or a `#4` issue reference is
    // never mistaken for a tag.
    for tag in extract_inline_tags(body) {
        if !parsed.tags.contains(&tag) {
            parsed.tags.push(tag);
        }
    }
    parsed
}

/// Split a leading `---` fenced frontmatter block from the body. A document without frontmatter
/// returns an empty block and the original text, so this is safe on arbitrary Markdown.
fn split_frontmatter(raw: &str) -> (&str, &str) {
    let trimmed = raw.strip_prefix('\u{feff}').unwrap_or(raw);
    let Some(rest) = trimmed.strip_prefix("---") else {
        return ("", trimmed);
    };
    // The opening fence must be alone on its line.
    let rest = match rest
        .strip_prefix("\r\n")
        .or_else(|| rest.strip_prefix('\n'))
    {
        Some(value) => value,
        None => return ("", trimmed),
    };
    let mut offset = 0usize;
    for line in rest.split_inclusive('\n') {
        if line.trim_end() == "---" {
            let body = &rest[offset + line.len()..];
            return (&rest[..offset], body);
        }
        offset += line.len();
    }
    // Unterminated fence: treat the whole document as body rather than swallowing it.
    ("", trimmed)
}

/// Parse the frontmatter block into ordered pairs. Supports `key: value` and the YAML block-list
/// form; a list expands into one repeated pair per item so ordering survives storage.
fn parse_frontmatter(block: &str) -> Vec<(String, String)> {
    let mut pairs = Vec::new();
    let mut pending_list_key: Option<String> = None;
    for line in block.lines() {
        let trimmed = line.trim_end();
        if trimmed.trim().is_empty() || trimmed.trim_start().starts_with('#') {
            continue;
        }
        if let Some(item) = trimmed.trim_start().strip_prefix("- ") {
            if let Some(key) = &pending_list_key {
                let value = clean_scalar(item);
                if !value.is_empty() {
                    pairs.push((key.clone(), value));
                }
            }
            continue;
        }
        let Some((key, value)) = trimmed.split_once(':') else {
            continue;
        };
        let key = key.trim();
        if key.is_empty() || key.contains(' ') && key.split_whitespace().count() > 4 {
            continue;
        }
        let value = value.trim();
        if value.is_empty() {
            pending_list_key = Some(key.to_owned());
            continue;
        }
        pending_list_key = None;
        // Inline `[a, b]` flow sequences expand the same way block lists do.
        if let Some(inner) = value.strip_prefix('[').and_then(|v| v.strip_suffix(']')) {
            for item in inner.split(',') {
                let item = clean_scalar(item);
                if !item.is_empty() {
                    pairs.push((key.to_owned(), item));
                }
            }
            continue;
        }
        pairs.push((key.to_owned(), clean_scalar(value)));
    }
    pairs
}

fn clean_scalar(value: &str) -> String {
    let trimmed = value.trim();
    let unquoted = trimmed
        .strip_prefix('"')
        .and_then(|v| v.strip_suffix('"'))
        .or_else(|| {
            trimmed
                .strip_prefix('\'')
                .and_then(|v| v.strip_suffix('\''))
        })
        .unwrap_or(trimmed);
    unquoted.trim().to_owned()
}

fn normalize_tag(value: &str) -> String {
    slugify(value.trim_start_matches('#'))
}

/// Extract `[[Target]]`, `[[Target|Alias]]`, `[[Target#Heading]]` and the combined form.
///
/// Fenced and inline code are skipped: a `[[…]]` inside a code block is sample text, not an
/// assertion about the knowledge graph, and treating it as an edge would pollute every backlink
/// list on a memory that documents this very syntax.
fn extract_links(body: &str) -> Vec<ParsedLink> {
    let mut links: Vec<ParsedLink> = Vec::new();
    for segment in code_free_segments(body) {
        let bytes = segment.as_bytes();
        let mut index = 0usize;
        while index + 3 < bytes.len() {
            if bytes[index] != b'[' || bytes[index + 1] != b'[' {
                index += 1;
                continue;
            }
            let Some(end) = segment[index + 2..].find("]]") else {
                break;
            };
            let inner = &segment[index + 2..index + 2 + end];
            index += end + 4;
            if inner.is_empty() || inner.contains('\n') {
                continue;
            }
            let (target_part, alias) = match inner.split_once('|') {
                Some((target, alias)) => (target, Some(alias.trim().to_owned())),
                None => (inner, None),
            };
            let (target_text, anchor) = match target_part.split_once('#') {
                Some((target, anchor)) => (target.trim(), Some(anchor.trim().to_owned())),
                None => (target_part.trim(), None),
            };
            let target_slug = slugify(target_text);
            if target_slug.is_empty() {
                continue;
            }
            // One edge per target. Linking the same memory twice — or under two different
            // aliases, or at two different headings — is still one relationship in the graph, so
            // the first occurrence wins and later ones are dropped rather than duplicating the
            // edge and inflating every backlink count that reads it.
            if !links.iter().any(|link| link.target_slug == target_slug) {
                links.push(ParsedLink {
                    target_slug,
                    target_text: target_text.to_owned(),
                    anchor: anchor.filter(|value| !value.is_empty()),
                    alias: alias.filter(|value| !value.is_empty()),
                });
            }
            if links.len() >= MAX_LINKS_PER_MEMORY {
                return links;
            }
        }
    }
    links
}

/// Standalone `#tag` words outside code. A `#` immediately followed by a letter, preceded by
/// whitespace or start-of-line, and not part of a Markdown heading.
fn extract_inline_tags(body: &str) -> Vec<String> {
    let mut tags = Vec::new();
    for segment in code_free_segments(body) {
        for line in segment.lines() {
            // A Markdown heading is `#` + space; a tag is `#` + word character.
            for (offset, _) in line.match_indices('#') {
                if offset > 0 {
                    let previous = line[..offset].chars().next_back();
                    if !matches!(previous, Some(character) if character.is_whitespace()) {
                        continue;
                    }
                } else if line.trim_start().starts_with("# ") {
                    continue;
                }
                let rest = &line[offset + 1..];
                let word: String = rest
                    .chars()
                    .take_while(|c| c.is_alphanumeric() || *c == '-' || *c == '_' || *c == '/')
                    .collect();
                if word.len() < 2 || !word.chars().next().is_some_and(|c| c.is_alphabetic()) {
                    continue;
                }
                let tag = slugify(&word);
                if !tag.is_empty() && !tags.contains(&tag) {
                    tags.push(tag);
                }
            }
        }
    }
    tags
}

/// Split a document into the segments that are *not* fenced code blocks or inline code spans.
fn code_free_segments(body: &str) -> Vec<&str> {
    let mut segments = Vec::new();
    let mut in_fence = false;
    for line in body.split_inclusive('\n') {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        // Strip inline code spans by keeping only the odd-indexed halves of a backtick split.
        for (index, part) in line.split('`').enumerate() {
            if index % 2 == 0 {
                segments.push(part);
            }
        }
    }
    segments
}

/// First paragraph of readable prose: skips headings, frontmatter leftovers, list bullets, and
/// fenced code so the summary is a sentence rather than a `##`.
fn derive_summary(body: &str) -> String {
    let mut in_fence = false;
    let mut collected = String::new();
    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        if trimmed.is_empty() {
            if !collected.is_empty() {
                break;
            }
            continue;
        }
        if trimmed.starts_with('#') || trimmed.starts_with('>') || trimmed.starts_with("---") {
            continue;
        }
        if !collected.is_empty() {
            collected.push(' ');
        }
        collected.push_str(trimmed);
        if collected.chars().count() >= 280 {
            break;
        }
    }
    let cleaned = collected.replace("[[", "").replace("]]", "");
    truncate_chars(cleaned.trim(), 280)
}

fn truncate_chars(value: &str, limit: usize) -> String {
    if value.chars().count() <= limit {
        return value.to_owned();
    }
    let mut out: String = value.chars().take(limit).collect();
    out.push('…');
    out
}

/// Render a memory back to a portable Markdown document with frontmatter. This is what gets
/// mirrored into the Project so the knowledge survives without Paralith.
pub fn render_markdown(
    title: &str,
    memory_type: &str,
    quality: &str,
    tags: &[String],
    properties: &[(String, String)],
    body: &str,
) -> String {
    let mut out = String::from("---\n");
    out.push_str(&format!("title: {}\n", yaml_scalar(title)));
    out.push_str(&format!("type: {}\n", yaml_scalar(memory_type)));
    out.push_str(&format!("quality: {}\n", yaml_scalar(quality)));
    if !tags.is_empty() {
        out.push_str("tags:\n");
        for tag in tags {
            out.push_str(&format!("  - {}\n", yaml_scalar(tag)));
        }
    }
    for (key, value) in properties {
        // The reserved keys above are rendered from authoritative columns, not echoed back.
        if matches!(key.as_str(), "title" | "type" | "quality") || TAG_KEYS.contains(&key.as_str())
        {
            continue;
        }
        out.push_str(&format!("{key}: {}\n", yaml_scalar(value)));
    }
    out.push_str("---\n\n");
    out.push_str(body.trim_start_matches('\n'));
    if !out.ends_with('\n') {
        out.push('\n');
    }
    out
}

/// Quote a scalar when it would otherwise change meaning as bare YAML.
fn yaml_scalar(value: &str) -> String {
    let needs_quotes = value.is_empty()
        || value.starts_with(' ')
        || value.ends_with(' ')
        || value.contains(':')
        || value.contains('#')
        || value.contains('\n')
        || value.starts_with('[')
        || value.starts_with('-');
    if needs_quotes {
        format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
    } else {
        value.to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugify_is_stable_across_punctuation_and_case() {
        assert_eq!(slugify("Auth Service"), "auth-service");
        assert_eq!(slugify("  Auth   Service  "), "auth-service");
        assert_eq!(slugify("AuthService/rotate()"), "authservice-rotate");
        assert_eq!(slugify("ADR-14: Token Rotation"), "adr-14-token-rotation");
        // Same slug from the title and from a link that points at it.
        assert_eq!(slugify("Auth Service"), slugify("auth service"));
        assert_eq!(slugify("!!!"), "");
    }

    #[test]
    fn frontmatter_is_split_from_body_and_parsed() {
        let parsed = parse_memory(
            "---\ntitle: Token Rotation\ntype: decision\ntags:\n  - auth\n  - security\ncomponents: [AuthService, TokenRepository]\n---\n\nRefresh tokens rotate after use.\n",
        );
        assert_eq!(parsed.body.trim(), "Refresh tokens rotate after use.");
        assert_eq!(parsed.tags, vec!["auth", "security"]);
        assert!(parsed
            .properties
            .contains(&("title".into(), "Token Rotation".into())));
        assert!(parsed
            .properties
            .contains(&("components".into(), "AuthService".into())));
        assert!(parsed
            .properties
            .contains(&("components".into(), "TokenRepository".into())));
    }

    #[test]
    fn a_document_without_frontmatter_keeps_its_whole_body() {
        let parsed = parse_memory("# Heading\n\nPlain text.");
        assert!(parsed.body.starts_with("# Heading"));
        assert!(parsed.properties.is_empty());
        assert_eq!(parsed.summary, "Plain text.");
    }

    #[test]
    fn an_unterminated_frontmatter_fence_does_not_swallow_the_document() {
        let parsed = parse_memory("---\ntitle: Broken\n\nStill body text.");
        assert!(parsed.body.contains("Still body text."));
    }

    #[test]
    fn wikilinks_capture_alias_and_anchor_forms() {
        let parsed = parse_memory(
            "See [[Auth Service]], [[Token Repository|the repo]], [[ADR 14#Rotation]] and [[ADR 15#Rotation|here]].",
        );
        let slugs: Vec<&str> = parsed
            .links
            .iter()
            .map(|link| link.target_slug.as_str())
            .collect();
        assert_eq!(
            slugs,
            vec!["auth-service", "token-repository", "adr-14", "adr-15"]
        );
        assert_eq!(parsed.links[1].alias.as_deref(), Some("the repo"));
        assert_eq!(parsed.links[1].target_text, "Token Repository");
        assert_eq!(parsed.links[2].anchor.as_deref(), Some("Rotation"));
        assert!(parsed.links[2].alias.is_none());
        assert_eq!(parsed.links[3].alias.as_deref(), Some("here"));
        assert_eq!(parsed.links[3].anchor.as_deref(), Some("Rotation"));
    }

    #[test]
    fn links_inside_code_are_not_graph_edges() {
        let parsed = parse_memory(
            "Real [[Auth Service]].\n\n```md\n[[Not A Link]]\n```\n\nInline `[[Also Not]]` here.",
        );
        let slugs: Vec<&str> = parsed
            .links
            .iter()
            .map(|link| link.target_slug.as_str())
            .collect();
        assert_eq!(slugs, vec!["auth-service"]);
    }

    #[test]
    fn repeated_links_to_one_target_collapse_to_a_single_edge() {
        // Different casing, a different alias, and a different heading all name the same memory.
        let parsed = parse_memory(
            "[[Auth Service]], again [[auth service]], [[Auth Service|the service]] and [[Auth Service#Rotation]].",
        );
        assert_eq!(parsed.links.len(), 1);
        assert_eq!(parsed.links[0].target_slug, "auth-service");
        // The first occurrence is the one kept.
        assert_eq!(parsed.links[0].target_text, "Auth Service");
        assert!(parsed.links[0].alias.is_none());
    }

    #[test]
    fn inline_tags_are_collected_but_headings_are_not() {
        let parsed = parse_memory(
            "# Heading\n\nRelates to #auth and #token-rotation.\n\nIssue #4 stays untouched.",
        );
        assert_eq!(parsed.tags, vec!["auth", "token-rotation"]);
    }

    #[test]
    fn aliases_participate_as_slugs() {
        let parsed = parse_memory("---\naliases:\n  - Auth Service\n  - AuthSvc\n---\n\nBody.");
        assert_eq!(parsed.aliases, vec!["auth-service", "authsvc"]);
    }

    #[test]
    fn secret_shaped_content_is_rejected_and_ordinary_prose_is_not() {
        assert!(reject_secrets("Refresh tokens rotate after each use.").is_ok());
        assert!(reject_secrets("The auth service stores a password hash.").is_ok());
        // Mid-prose assignments, not just whole-line ones.
        for secret in [
            "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCY",
            "Set AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCY before deploying.",
            "Call it with `api_key=sk-live-abcdef123456` for now.",
            "Send Authorization: Bearer eyJhbGciOiJIUzI1NiJ9 on every request.",
        ] {
            let error = reject_secrets(secret).unwrap_err();
            assert_eq!(error.code, "memory_secret_rejected", "missed: {secret}");
            // The message may name the key but must never repeat the value.
            assert!(
                !error.message.contains("wJalrXUtnFEMIK7MDENGbPxRfiCY")
                    && !error.message.contains("sk-live-abcdef123456")
                    && !error.message.contains("eyJhbGciOiJIUzI1NiJ9"),
                "secret value leaked into the error: {}",
                error.message
            );
        }
    }

    #[test]
    fn rendered_markdown_round_trips_through_the_parser() {
        let rendered = render_markdown(
            "ADR 14: Token Rotation",
            "decision",
            "canonical",
            &["auth".to_string()],
            &[("component".to_string(), "AuthService".to_string())],
            "Refresh tokens rotate after use. See [[Token Repository]].",
        );
        let parsed = parse_memory(&rendered);
        assert!(parsed
            .properties
            .contains(&("title".into(), "ADR 14: Token Rotation".into())));
        assert_eq!(parsed.tags, vec!["auth"]);
        assert!(parsed
            .properties
            .contains(&("component".into(), "AuthService".into())));
        assert_eq!(parsed.links[0].target_slug, "token-repository");
        assert!(parsed.body.trim().starts_with("Refresh tokens rotate"));
    }

    #[test]
    fn summary_skips_headings_and_code_and_is_bounded() {
        let parsed =
            parse_memory("## Title\n\n```rust\nfn main() {}\n```\n\nThe real summary line.");
        assert_eq!(parsed.summary, "The real summary line.");
        let long = "x".repeat(600);
        assert!(parse_memory(&long).summary.chars().count() <= 281);
    }
}

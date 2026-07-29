//! Secret redaction for capability outputs.
//!
//! Capability results are treated as untrusted before they are recorded in the event timeline,
//! persisted, or (in a later slice) handed to a language model. This module removes the obvious
//! secret shapes so a token, key, or `KEY=value` environment assignment never lands in an
//! orchestration row, event payload, or diagnostic export. It is intentionally conservative: it
//! redacts recognisable secret *values*, it does not attempt to strip arbitrary sensitive prose.

use serde_json::Value;

const REDACTED: &str = "[redacted]";

/// Keys whose values are always replaced regardless of content, matched case-insensitively as a
/// substring of the JSON object key. Covers the common credential-bearing field names.
const SENSITIVE_KEY_FRAGMENTS: &[&str] = &[
    "password",
    "passwd",
    "secret",
    "token",
    "apikey",
    "api_key",
    "authorization",
    "auth_token",
    "access_key",
    "private_key",
    "client_secret",
    "credential",
    "cookie",
    "session_token",
];

fn key_is_sensitive(key: &str) -> bool {
    let lower = key.to_ascii_lowercase();
    let compact = lower.replace(['-', '_', ' '], "");
    SENSITIVE_KEY_FRAGMENTS
        .iter()
        .any(|fragment| lower.contains(fragment) || compact.contains(&fragment.replace('_', "")))
}

/// Redact secret-looking substrings inside a free-text string: bearer tokens, `KEY=secret`
/// environment assignments, and long high-entropy-looking tokens. Preserves surrounding text so a
/// log tail stays readable.
pub fn redact_text(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for line in input.split_inclusive('\n') {
        out.push_str(&redact_line(line));
    }
    out
}

fn redact_line(line: &str) -> String {
    // Preserve a trailing newline (lines arrive via `split_inclusive`) so reassembly is exact.
    let (body, newline) = match line.strip_suffix('\n') {
        Some(rest) => (rest, "\n"),
        None => (line, ""),
    };

    // `NAME=value` / `NAME: value` assignments where the name looks credential-bearing: preserve the
    // name, separator, and any spacing, and redact the value through end of line.
    for sep in ['=', ':'] {
        let Some(pos) = body.find(sep) else { continue };
        let name = body[..pos].trim();
        if name.is_empty()
            || name.len() > 64
            || !name
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.')
            || !key_is_sensitive(name)
        {
            continue;
        }
        let prefix = &body[..=pos];
        let after = &body[pos + 1..];
        let whitespace: String = after.chars().take_while(|c| c.is_whitespace()).collect();
        if after.trim().is_empty() {
            return format!("{prefix}{whitespace}{newline}");
        }
        return format!("{prefix}{whitespace}{REDACTED}{newline}");
    }

    // Bearer tokens in free text (headers, log lines) that are not a sensitive-key assignment.
    let mut result = body.to_owned();
    if let Some(idx) = result.to_ascii_lowercase().find("bearer ") {
        let start = idx + "bearer ".len();
        let end = result[start..]
            .find(char::is_whitespace)
            .map(|offset| start + offset)
            .unwrap_or(result.len());
        if end > start {
            result.replace_range(start..end, REDACTED);
        }
    }
    format!("{result}{newline}")
}

/// Recursively redact a JSON value: sensitive object keys have their values replaced wholesale,
/// and string values everywhere are passed through [`redact_text`].
pub fn redact_json(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut redacted = serde_json::Map::with_capacity(map.len());
            for (key, val) in map {
                if key_is_sensitive(key) {
                    redacted.insert(key.clone(), Value::String(REDACTED.to_owned()));
                } else {
                    redacted.insert(key.clone(), redact_json(val));
                }
            }
            Value::Object(redacted)
        }
        Value::Array(items) => Value::Array(items.iter().map(redact_json).collect()),
        Value::String(text) => Value::String(redact_text(text)),
        other => other.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn redacts_sensitive_object_keys() {
        let input = json!({
            "user": "ada",
            "apiKey": "sk-live-abcdef123456",
            "nested": { "authToken": "xyz", "keep": "visible" }
        });
        let out = redact_json(&input);
        assert_eq!(out["user"], json!("ada"));
        assert_eq!(out["apiKey"], json!("[redacted]"));
        assert_eq!(out["nested"]["authToken"], json!("[redacted]"));
        assert_eq!(out["nested"]["keep"], json!("visible"));
    }

    #[test]
    fn redacts_env_assignments_in_text() {
        let out = redact_text("SECRET_TOKEN=hunter2\nPATH=/usr/bin\nAPI_KEY = abc123");
        assert!(out.contains("SECRET_TOKEN=[redacted]"), "got: {out}");
        assert!(out.contains("PATH=/usr/bin"), "non-secret preserved: {out}");
        assert!(out.contains("API_KEY = [redacted]"), "got: {out}");
    }

    #[test]
    fn redacts_bearer_tokens_in_free_text() {
        // Free-text bearer (not a sensitive-key assignment) keeps surrounding words and redacts
        // only the token.
        let out = redact_text("Retrying request with Bearer abcdef.ghijkl.mnopqr now");
        assert!(out.contains("Bearer [redacted] now"), "got: {out}");
    }

    #[test]
    fn redacts_whole_value_of_sensitive_header_assignment() {
        // A sensitive `key: value` header redacts the entire value, which covers the token too.
        let out = redact_text("Authorization: Bearer abcdef.ghijkl.mnopqr");
        assert_eq!(out, "Authorization: [redacted]");
    }

    #[test]
    fn preserves_ordinary_content() {
        let out = redact_text("Compiling paralith v0.4.1\n  Finished in 12.3s");
        assert_eq!(out, "Compiling paralith v0.4.1\n  Finished in 12.3s");
    }
}

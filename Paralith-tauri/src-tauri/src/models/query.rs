//! The unified query contract.
//!
//! One query architecture serves Search, Review filters, Timeline filters, knowledge-health
//! drilldowns, graph filters, and the Context Compiler's structured candidate source. Each of those
//! growing its own filter syntax is how a product ends up with six subtly different meanings for
//! `type:decision`.
//!
//! ## Why an AST and not a string
//!
//! The parser turns user text into [`QueryExpression`] and the translator turns *that* into SQL
//! with bound parameters. No caller-supplied text ever reaches a SQL string. The AST is also what
//! makes the query inspectable: the UI can show what it understood, and a malformed query produces
//! a diagnostic instead of silently matching nothing.

use serde::{Deserialize, Serialize};

/// What a clause compares against. Kept small on purpose: the operators here cover every filter the
/// product currently needs, and an unused operator is a parser branch nobody tests.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Comparator {
    Equals,
    NotEquals,
    /// `field:>value` — numeric or ISO-date greater-than.
    GreaterThan,
    /// `field:<value` — numeric or ISO-date less-than. Also how `verified:<30d` reads.
    LessThan,
    /// Substring match on a text column.
    Contains,
}

impl Comparator {
    pub fn as_sql(self) -> &'static str {
        match self {
            Self::Equals => "=",
            Self::NotEquals => "<>",
            Self::GreaterThan => ">",
            Self::LessThan => "<",
            Self::Contains => "LIKE",
        }
    }
}

/// A resolved field. Parsing a field name to this enum — rather than passing the raw name into
/// SQL — is what makes column injection structurally impossible rather than merely filtered.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QueryField {
    /// Domain selector: `is:conflict`, `is:candidate`, `is:memory`. Restricts which stores a search
    /// touches rather than filtering rows within one, which is why it is a field the executor reads
    /// specially rather than an ordinary column comparison.
    Is,
    Type,
    Quality,
    Status,
    Tag,
    Title,
    Pinned,
    Stale,
    Verified,
    Confidence,
    Importance,
    Branch,
    Component,
    Created,
    Updated,
    Property,
    Relation,
    Evidence,
    Risk,
    Origin,
    Entity,
}

impl QueryField {
    /// Accepted spellings. Aliases exist because a developer typing a filter should not have to
    /// remember whether the column is `memory_type` or `type`.
    pub fn parse(name: &str) -> Option<Self> {
        Some(match name.to_ascii_lowercase().as_str() {
            "is" | "in" => Self::Is,
            "type" | "kind" | "memorytype" => Self::Type,
            "quality" => Self::Quality,
            "status" | "state" => Self::Status,
            "tag" | "tags" => Self::Tag,
            "title" | "name" => Self::Title,
            "pinned" => Self::Pinned,
            "stale" => Self::Stale,
            "verified" => Self::Verified,
            "confidence" => Self::Confidence,
            "importance" => Self::Importance,
            "branch" | "worktree" => Self::Branch,
            "component" | "module" => Self::Component,
            "created" => Self::Created,
            "updated" => Self::Updated,
            "prop" | "property" => Self::Property,
            "relation" | "rel" => Self::Relation,
            "evidence" | "cites" | "file" => Self::Evidence,
            "risk" => Self::Risk,
            "origin" | "source" => Self::Origin,
            "entity" | "subject" => Self::Entity,
            _ => return None,
        })
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Is => "is",
            Self::Type => "type",
            Self::Quality => "quality",
            Self::Status => "status",
            Self::Tag => "tag",
            Self::Title => "title",
            Self::Pinned => "pinned",
            Self::Stale => "stale",
            Self::Verified => "verified",
            Self::Confidence => "confidence",
            Self::Importance => "importance",
            Self::Branch => "branch",
            Self::Component => "component",
            Self::Created => "created",
            Self::Updated => "updated",
            Self::Property => "property",
            Self::Relation => "relation",
            Self::Evidence => "evidence",
            Self::Risk => "risk",
            Self::Origin => "origin",
            Self::Entity => "entity",
        }
    }
}

/// One comparison. `key` carries the sub-key for `property:` clauses (`prop:owner=auth`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldClause {
    pub field: QueryField,
    pub comparator: Comparator,
    pub value: String,
    pub key: Option<String>,
}

/// The query tree.
#[derive(Debug, Clone, PartialEq)]
pub enum QueryExpression {
    /// Matches everything. The parse of an empty query — a filterless listing is a valid request.
    All,
    And(Vec<QueryExpression>),
    Or(Vec<QueryExpression>),
    Not(Box<QueryExpression>),
    Field(FieldClause),
    /// Free text, routed to FTS.
    Text(String),
}

impl Serialize for QueryExpression {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::Error as _;

        fn value(expression: &QueryExpression) -> serde_json::Result<serde_json::Value> {
            use serde_json::{Map, Value};

            let (node, fields) = match expression {
                QueryExpression::All => ("all", None),
                QueryExpression::And(parts) => (
                    "and",
                    Some(Value::Array(
                        parts.iter().map(value).collect::<Result<_, _>>()?,
                    )),
                ),
                QueryExpression::Or(parts) => (
                    "or",
                    Some(Value::Array(
                        parts.iter().map(value).collect::<Result<_, _>>()?,
                    )),
                ),
                QueryExpression::Not(inner) => ("not", Some(value(inner)?)),
                QueryExpression::Field(clause) => ("field", Some(serde_json::to_value(clause)?)),
                QueryExpression::Text(text) => ("text", Some(Value::String(text.clone()))),
            };

            let mut object = Map::new();
            object.insert("node".to_owned(), Value::String(node.to_owned()));
            if let Some(fields) = fields {
                object.insert("fields".to_owned(), fields);
            }
            Ok(Value::Object(object))
        }

        value(self).map_err(S::Error::custom)?.serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for QueryExpression {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        use serde::de::Error as _;
        use serde_json::Value;

        fn parse(value: Value) -> Result<QueryExpression, String> {
            let Value::Object(mut object) = value else {
                return Err("query expression must be an object".to_owned());
            };
            let node = object
                .remove("node")
                .and_then(|value| value.as_str().map(str::to_owned))
                .ok_or_else(|| "query expression is missing its node".to_owned())?;
            let fields = object.remove("fields");

            match node.as_str() {
                "all" => Ok(QueryExpression::All),
                "and" | "or" => {
                    let Value::Array(parts) = fields
                        .ok_or_else(|| format!("{node} query expression is missing fields"))?
                    else {
                        return Err(format!("{node} query expression fields must be an array"));
                    };
                    let parts = parts.into_iter().map(parse).collect::<Result<_, _>>()?;
                    if node == "and" {
                        Ok(QueryExpression::And(parts))
                    } else {
                        Ok(QueryExpression::Or(parts))
                    }
                }
                "not" => Ok(QueryExpression::Not(Box::new(parse(fields.ok_or_else(
                    || "not query expression is missing fields".to_owned(),
                )?)?))),
                "field" => serde_json::from_value(
                    fields.ok_or_else(|| "field query expression is missing fields".to_owned())?,
                )
                .map(QueryExpression::Field)
                .map_err(|error| error.to_string()),
                "text" => fields
                    .and_then(|value| value.as_str().map(str::to_owned))
                    .map(QueryExpression::Text)
                    .ok_or_else(|| "text query expression fields must be a string".to_owned()),
                _ => Err(format!("unsupported query expression node: {node}")),
            }
        }

        parse(Value::deserialize(deserializer)?).map_err(D::Error::custom)
    }
}

impl QueryExpression {
    /// Flattening constructor: `and([x])` is `x`, `and([])` is `All`. Keeps the tree — and the SQL
    /// it produces — free of one-child wrappers.
    pub fn and(mut parts: Vec<QueryExpression>) -> Self {
        parts.retain(|part| !matches!(part, QueryExpression::All));
        match parts.len() {
            0 => QueryExpression::All,
            1 => parts.pop().expect("length checked"),
            _ => QueryExpression::And(parts),
        }
    }

    pub fn or(mut parts: Vec<QueryExpression>) -> Self {
        match parts.len() {
            0 => QueryExpression::All,
            1 => parts.pop().expect("length checked"),
            _ => QueryExpression::Or(parts),
        }
    }

    /// Free-text fragments anywhere in the tree, in order. The FTS pass runs once over the union
    /// rather than per clause, so a query with three words is one index read.
    pub fn text_terms(&self) -> Vec<String> {
        let mut out = Vec::new();
        self.collect_text(&mut out);
        out
    }

    fn collect_text(&self, out: &mut Vec<String>) {
        match self {
            QueryExpression::Text(text) => out.push(text.clone()),
            QueryExpression::And(parts) | QueryExpression::Or(parts) => {
                for part in parts {
                    part.collect_text(out);
                }
            }
            // Text under a NOT is deliberately not collected: excluding by full-text would need a
            // second index pass to subtract, and reporting "we ignored that" is better than
            // returning results that quietly include what the user excluded.
            QueryExpression::Not(_) | QueryExpression::Field(_) | QueryExpression::All => {}
        }
    }
}

/// A parsed query plus what the parser had to say about it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedQuery {
    pub expression: QueryExpression,
    /// Non-fatal complaints: an unknown field, an unbalanced paren the parser recovered from. The
    /// query still runs; the UI shows what was not understood rather than returning nothing.
    pub diagnostics: Vec<String>,
}

/// Which stores a search touches. Requesting fewer is how the Context Compiler asks for memories
/// only without paying for a handoff scan.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SearchDomain {
    Memory,
    Claim,
    Entity,
    Candidate,
    Handoff,
    Conflict,
    Fact,
}

impl SearchDomain {
    pub fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "memory" => Self::Memory,
            "claim" => Self::Claim,
            "entity" => Self::Entity,
            "candidate" => Self::Candidate,
            "handoff" => Self::Handoff,
            "conflict" => Self::Conflict,
            "fact" => Self::Fact,
            _ => return None,
        })
    }

    pub const ALL: [Self; 7] = [
        Self::Memory,
        Self::Claim,
        Self::Entity,
        Self::Candidate,
        Self::Handoff,
        Self::Conflict,
        Self::Fact,
    ];
}

/// One hit. Deliberately typed rather than a bag of strings: a claim, a handoff, and a memory are
/// different things, and a result list that flattens them cannot be acted on.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub domain: SearchDomain,
    pub id: String,
    /// The memory this hit belongs to, when it is not itself a memory.
    pub item_id: Option<String>,
    pub title: String,
    pub excerpt: String,
    /// `lexical`, `filter`, `title`, `semantic`, or a combination joined by `+`.
    pub match_reason: String,
    pub score: f64,
    pub memory_type: Option<String>,
    pub quality: Option<String>,
    pub stale: bool,
    pub confidence: Option<f64>,
    pub branch_name: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRequest {
    pub project_id: String,
    pub query: String,
    /// Empty means every domain.
    #[serde(default)]
    pub domains: Vec<String>,
    pub limit: Option<usize>,
    /// Include semantic candidates when a provider is configured. Ignored in `Disabled` mode.
    pub semantic: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse {
    pub results: Vec<SearchResult>,
    /// The AST the backend actually ran, so the UI can show what it understood.
    pub parsed: ParsedQuery,
    pub total: usize,
    pub truncated: bool,
    pub elapsed_ms: u64,
    /// True when semantic candidates contributed. False in `Disabled` mode even if requested — the
    /// UI must never imply a capability that is not running.
    pub semantic_used: bool,
}

#[cfg(test)]
mod serialization_tests {
    use super::QueryExpression;

    #[test]
    fn query_expression_uses_the_frontend_contract_shape() {
        let expression = QueryExpression::And(vec![
            QueryExpression::Text("memory".to_owned()),
            QueryExpression::Not(Box::new(QueryExpression::All)),
        ]);

        let value = serde_json::to_value(&expression).unwrap();
        assert_eq!(
            value,
            serde_json::json!({
                "node": "and",
                "fields": [
                    { "node": "text", "fields": "memory" },
                    { "node": "not", "fields": { "node": "all" } }
                ]
            })
        );
        assert_eq!(
            serde_json::from_value::<QueryExpression>(value).unwrap(),
            expression
        );
    }
}

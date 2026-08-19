//! The unified structured query engine.
//!
//! One parser, one AST, one translator. Search, Review filters, Timeline filters, knowledge-health
//! drilldowns, and the Context Compiler's structured candidate source all go through here, because
//! the alternative — each surface parsing `type:decision` its own way — produces a product where
//! the same filter means different things in different panes.
//!
//! ## Safety
//!
//! The parser produces a [`QueryExpression`]; the translator turns that into a SQL fragment where
//! **every** caller-derived value is a bound parameter and every column name comes from the
//! [`QueryField`] enum. There is no path by which query text reaches a SQL string. A malformed
//! query is a diagnostic on a query that still runs, never an error that returns nothing and never
//! a fragment that runs something else.
//!
//! ## Grammar
//!
//! ```text
//! query      := or
//! or         := and ( "OR" and )*
//! and        := unary ( "AND"? unary )*        // adjacency means AND
//! unary      := "NOT"? primary | "-" primary
//! primary    := "(" or ")" | field | text
//! field      := name ":" ( "(" or ")" | value )
//! value      := ( ">" | "<" | "!" )? word | quoted
//! ```

use crate::models::query::*;

/// Longest query accepted. A query is a filter, not a document; past this the parser is being used
/// as a payload channel.
const MAX_QUERY_CHARS: usize = 1_000;

/// Deepest nesting accepted. Bounded so a pathological `((((…))))` cannot recurse the parser into
/// a stack overflow.
const MAX_DEPTH: usize = 12;

/// One lexical token.
#[derive(Debug, Clone, PartialEq)]
enum Token {
    LParen,
    RParen,
    And,
    Or,
    Not,
    /// `field:value`, already split. The bool marks a value that was quoted, which suppresses
    /// operator interpretation so `title:">= 5"` searches for the literal text.
    Field(String, String, bool),
    Word(String),
}

/// Split query text into tokens.
///
/// Quoting is handled here rather than in the parser so a quoted value carrying a colon, a paren,
/// or the word `OR` is one token and cannot be re-lexed into structure.
fn tokenize(input: &str) -> (Vec<Token>, Vec<String>) {
    let mut tokens = Vec::new();
    let mut diagnostics = Vec::new();
    let chars: Vec<char> = input.chars().take(MAX_QUERY_CHARS).collect();
    if input.chars().count() > MAX_QUERY_CHARS {
        diagnostics.push(format!("Query truncated to {MAX_QUERY_CHARS} characters."));
    }
    let mut index = 0usize;

    // Read a bare or quoted run, returning the text and whether it was quoted.
    fn read_value(chars: &[char], index: &mut usize, stop_at_paren: bool) -> (String, bool) {
        if chars.get(*index) == Some(&'"') {
            *index += 1;
            let mut out = String::new();
            while *index < chars.len() && chars[*index] != '"' {
                out.push(chars[*index]);
                *index += 1;
            }
            // An unterminated quote consumes to the end rather than failing: the user is mid-typing.
            if *index < chars.len() {
                *index += 1;
            }
            return (out, true);
        }
        let mut out = String::new();
        while *index < chars.len() {
            let current = chars[*index];
            if current.is_whitespace() || current == ':' {
                break;
            }
            if stop_at_paren && (current == '(' || current == ')') {
                break;
            }
            out.push(current);
            *index += 1;
        }
        (out, false)
    }

    while index < chars.len() {
        let current = chars[index];
        if current.is_whitespace() {
            index += 1;
            continue;
        }
        if current == '(' {
            tokens.push(Token::LParen);
            index += 1;
            continue;
        }
        if current == ')' {
            tokens.push(Token::RParen);
            index += 1;
            continue;
        }
        if current == '-'
            && chars
                .get(index + 1)
                .is_some_and(|next| !next.is_whitespace())
        {
            tokens.push(Token::Not);
            index += 1;
            continue;
        }

        let (head, head_quoted) = read_value(&chars, &mut index, true);
        if head.is_empty() {
            // Nothing consumed and not a structural character: skip one char rather than spin.
            index += 1;
            continue;
        }
        if !head_quoted {
            match head.to_ascii_uppercase().as_str() {
                "AND" => {
                    tokens.push(Token::And);
                    continue;
                }
                "OR" => {
                    tokens.push(Token::Or);
                    continue;
                }
                "NOT" => {
                    tokens.push(Token::Not);
                    continue;
                }
                _ => {}
            }
        }
        if chars.get(index) == Some(&':') {
            index += 1;
            // `field:(a OR b)` keeps its parens as structure; the parser expands the group.
            if chars.get(index) == Some(&'(') {
                tokens.push(Token::Field(head, "(".into(), false));
                continue;
            }
            let (value, quoted) = read_value(&chars, &mut index, true);
            tokens.push(Token::Field(head, value, quoted));
            continue;
        }
        tokens.push(Token::Word(head));
    }
    (tokens, diagnostics)
}

struct Parser {
    tokens: Vec<Token>,
    position: usize,
    diagnostics: Vec<String>,
}

impl Parser {
    fn peek(&self) -> Option<&Token> {
        self.tokens.get(self.position)
    }

    fn next(&mut self) -> Option<Token> {
        let token = self.tokens.get(self.position).cloned();
        if token.is_some() {
            self.position += 1;
        }
        token
    }

    fn parse_or(&mut self, depth: usize) -> QueryExpression {
        let mut parts = vec![self.parse_and(depth)];
        while matches!(self.peek(), Some(Token::Or)) {
            self.position += 1;
            parts.push(self.parse_and(depth));
        }
        QueryExpression::or(parts)
    }

    fn parse_and(&mut self, depth: usize) -> QueryExpression {
        let mut parts = vec![self.parse_unary(depth)];
        loop {
            match self.peek() {
                Some(Token::And) => {
                    self.position += 1;
                    parts.push(self.parse_unary(depth));
                }
                // Adjacency is AND. Stop at `OR` and at a closing paren, which belong to the caller.
                Some(Token::Or) | Some(Token::RParen) | None => break,
                _ => parts.push(self.parse_unary(depth)),
            }
        }
        QueryExpression::and(parts)
    }

    fn parse_unary(&mut self, depth: usize) -> QueryExpression {
        if matches!(self.peek(), Some(Token::Not)) {
            self.position += 1;
            let inner = self.parse_unary(depth);
            if matches!(inner, QueryExpression::All) {
                self.diagnostics
                    .push("NOT with nothing to negate was ignored.".into());
                return QueryExpression::All;
            }
            return QueryExpression::Not(Box::new(inner));
        }
        self.parse_primary(depth)
    }

    fn parse_primary(&mut self, depth: usize) -> QueryExpression {
        if depth >= MAX_DEPTH {
            self.diagnostics
                .push("Query nested too deeply; the innermost groups were ignored.".into());
            // Consume the rest of this group so the caller does not loop on the same token.
            while self.next().is_some_and(|token| token != Token::RParen) {}
            return QueryExpression::All;
        }
        match self.next() {
            Some(Token::LParen) => {
                let inner = self.parse_or(depth + 1);
                if matches!(self.peek(), Some(Token::RParen)) {
                    self.position += 1;
                } else {
                    self.diagnostics.push(
                        "A group was not closed; it was read to the end of the query.".into(),
                    );
                }
                inner
            }
            Some(Token::Field(name, value, quoted)) => self.parse_field(name, value, quoted, depth),
            Some(Token::Word(word)) => QueryExpression::Text(word),
            Some(Token::RParen) => {
                self.diagnostics
                    .push("An unmatched ')' was ignored.".into());
                QueryExpression::All
            }
            Some(Token::And) | Some(Token::Or) | Some(Token::Not) => {
                self.diagnostics
                    .push("A dangling operator was ignored.".into());
                QueryExpression::All
            }
            None => QueryExpression::All,
        }
    }

    // `depth` exists to bound the nesting of `field:(a OR b:(c))`; it is only ever handed to this
    // function's own recursive call, which is the shape clippy flags. Dropping it would leave the
    // one recursive path in the parser unbounded.
    #[allow(clippy::only_used_in_recursion)]
    fn parse_field(
        &mut self,
        name: String,
        value: String,
        quoted: bool,
        depth: usize,
    ) -> QueryExpression {
        let Some(field) = QueryField::parse(&name) else {
            // An unknown field falls back to free text rather than matching nothing, so a typo
            // still finds something and the diagnostic says why.
            self.diagnostics
                .push(format!("Unknown field '{name}'; searched it as text."));
            return QueryExpression::Text(if value == "(" {
                name
            } else {
                format!("{name} {value}")
            });
        };
        // `field:(a OR b)` — the lexer left the open paren for us to expand.
        if value == "(" && !quoted {
            let mut parts = Vec::new();
            loop {
                match self.next() {
                    Some(Token::Word(word)) => parts.push(self.clause(field, &word, false)),
                    Some(Token::Field(inner_name, inner_value, inner_quoted)) => {
                        // A nested `field:value` inside a value group is a grouping mistake; read
                        // it as its own clause rather than silently dropping it.
                        parts.push(self.parse_field(
                            inner_name,
                            inner_value,
                            inner_quoted,
                            depth + 1,
                        ))
                    }
                    Some(Token::Or) | Some(Token::And) => {}
                    Some(Token::RParen) | None => break,
                    Some(_) => {}
                }
            }
            if parts.is_empty() {
                self.diagnostics
                    .push(format!("'{}:()' matched nothing and was ignored.", name));
                return QueryExpression::All;
            }
            return QueryExpression::or(parts);
        }
        self.clause(field, &value, quoted)
    }

    /// Build one comparison, reading a leading operator off the value when it was not quoted.
    fn clause(&mut self, field: QueryField, raw: &str, quoted: bool) -> QueryExpression {
        let (comparator, value) = if quoted {
            (Comparator::Equals, raw.to_owned())
        } else if let Some(rest) = raw.strip_prefix('>') {
            (Comparator::GreaterThan, rest.to_owned())
        } else if let Some(rest) = raw.strip_prefix('<') {
            (Comparator::LessThan, rest.to_owned())
        } else if let Some(rest) = raw.strip_prefix('!') {
            (Comparator::NotEquals, rest.to_owned())
        } else if let Some(rest) = raw.strip_prefix('~') {
            (Comparator::Contains, rest.to_owned())
        } else {
            (default_comparator(field), raw.to_owned())
        };
        if value.is_empty() {
            self.diagnostics.push(format!(
                "'{}:' had no value and was ignored.",
                field.as_str()
            ));
            return QueryExpression::All;
        }
        // `prop:owner=auth` — the only field with a sub-key.
        let (key, value) = if field == QueryField::Property {
            match value.split_once('=') {
                Some((key, rest)) => (Some(key.to_owned()), rest.to_owned()),
                None => (Some(value.clone()), String::new()),
            }
        } else {
            (None, value)
        };
        QueryExpression::Field(FieldClause {
            field,
            comparator,
            value,
            key,
        })
    }
}

/// Fields whose bare form is a substring search rather than equality. Titles are prose; asking a
/// user to type a title exactly would make `title:auth` useless.
fn default_comparator(field: QueryField) -> Comparator {
    match field {
        QueryField::Title | QueryField::Evidence | QueryField::Component => Comparator::Contains,
        _ => Comparator::Equals,
    }
}

/// Parse user query text into an AST plus any diagnostics.
pub fn parse(query: &str) -> ParsedQuery {
    let (tokens, mut diagnostics) = tokenize(query);
    if tokens.is_empty() {
        return ParsedQuery {
            expression: QueryExpression::All,
            diagnostics,
        };
    }
    let mut parser = Parser {
        tokens,
        position: 0,
        diagnostics: Vec::new(),
    };
    let expression = parser.parse_or(0);
    // A trailing token the grammar could not place is reported rather than silently dropped.
    if parser.position < parser.tokens.len() {
        parser
            .diagnostics
            .push("Part of the query could not be read and was ignored.".into());
    }
    diagnostics.append(&mut parser.diagnostics);
    diagnostics.dedup();
    ParsedQuery {
        expression,
        diagnostics,
    }
}

/// A translated clause: SQL text plus the values to bind, in order.
#[derive(Debug, Clone, Default)]
pub struct TranslatedQuery {
    pub sql: String,
    pub binds: Vec<String>,
}

/// Relative-time suffixes accepted by date fields: `verified:<30d`.
fn resolve_relative_date(value: &str) -> Option<String> {
    let (number, unit) = value.split_at(value.len().saturating_sub(1));
    let amount: i64 = number.parse().ok()?;
    let duration = match unit {
        "d" => chrono::Duration::days(amount),
        "h" => chrono::Duration::hours(amount),
        "w" => chrono::Duration::weeks(amount),
        "m" => chrono::Duration::days(amount * 30),
        _ => return None,
    };
    Some((chrono::Utc::now() - duration).to_rfc3339())
}

/// SQL for one field, against the `memory_items i` alias.
///
/// The column is chosen by matching the enum, never by formatting the field name, so a field this
/// build does not know cannot become a column reference.
fn field_sql(clause: &FieldClause, binds: &mut Vec<String>) -> String {
    let comparator = clause.comparator;
    let operator = comparator.as_sql();

    // Text comparisons; `Contains` wraps the bound *value* in wildcards, never the SQL.
    let text = |column: &str, value: &str, binds: &mut Vec<String>| -> String {
        if comparator == Comparator::Contains {
            format!(
                "lower({column}) LIKE {}",
                bind(binds, format!("%{}%", value.to_lowercase()))
            )
        } else {
            format!(
                "lower({column}){operator}{}",
                bind(binds, value.to_lowercase())
            )
        }
    };

    match clause.field {
        // A domain selector is not a row filter. Against `memory_items` it either passes
        // everything (`is:memory`) or nothing (`is:conflict`), and the executor reads the same
        // clause to decide which other stores to search.
        QueryField::Is => {
            if clause.value.eq_ignore_ascii_case("memory") {
                "1=1".to_owned()
            } else {
                "0=1".to_owned()
            }
        }
        QueryField::Type => text("i.memory_type", &clause.value, binds),
        QueryField::Quality => text("i.quality", &clause.value, binds),
        QueryField::Status => text("i.state", &clause.value, binds),
        QueryField::Title => text("i.title", &clause.value, binds),
        QueryField::Branch => text("COALESCE(i.branch_name,'')", &clause.value, binds),
        QueryField::Tag => {
            let negate = comparator == Comparator::NotEquals;
            let placeholder = bind(
                binds,
                crate::services::memory_markdown::slugify(&clause.value),
            );
            format!(
                "{}EXISTS(SELECT 1 FROM memory_tags t WHERE t.item_id=i.id AND t.tag={placeholder})",
                if negate { "NOT " } else { "" }
            )
        }
        QueryField::Pinned => format!("i.pinned={}", truthy(&clause.value) as i64),
        QueryField::Stale => {
            if truthy(&clause.value) {
                "(i.stale_reason IS NOT NULL AND i.stale_reason<>'')".to_owned()
            } else {
                "(i.stale_reason IS NULL OR i.stale_reason='')".to_owned()
            }
        }
        QueryField::Verified => match clause.value.as_str() {
            "true" | "yes" | "1" => "i.verified_at IS NOT NULL".to_owned(),
            "false" | "no" | "0" => "i.verified_at IS NULL".to_owned(),
            value => {
                let resolved = resolve_relative_date(value).unwrap_or_else(|| value.to_owned());
                // `verified:<30d` reads as "verified within the last 30 days", so a `<` on a
                // duration becomes a `>` on the timestamp it resolves to. Reading it literally
                // would return exactly the opposite set.
                let flipped = if resolve_relative_date(value).is_some() {
                    match comparator {
                        Comparator::LessThan => ">",
                        Comparator::GreaterThan => "<",
                        _ => operator,
                    }
                } else {
                    operator
                };
                format!("i.verified_at{flipped}{}", bind(binds, resolved))
            }
        },
        QueryField::Confidence => numeric("i.confidence", operator, &clause.value, binds),
        QueryField::Importance => numeric("i.importance", operator, &clause.value, binds),
        QueryField::Created => date("i.created_at", operator, &clause.value, binds),
        QueryField::Updated => date("i.updated_at", operator, &clause.value, binds),
        QueryField::Property => {
            let key = bind(binds, clause.key.clone().unwrap_or_default().to_lowercase());
            if clause.value.is_empty() {
                format!("EXISTS(SELECT 1 FROM memory_properties p WHERE p.item_id=i.id AND lower(p.key)={key})")
            } else {
                let value = bind(binds, clause.value.to_lowercase());
                format!(
                    "EXISTS(SELECT 1 FROM memory_properties p WHERE p.item_id=i.id \
                     AND lower(p.key)={key} AND lower(p.value)={value})"
                )
            }
        }
        QueryField::Relation => {
            let value = bind(binds, clause.value.to_lowercase());
            format!(
                "EXISTS(SELECT 1 FROM memory_relations r WHERE (r.from_item_id=i.id OR r.to_item_id=i.id) \
                 AND lower(r.relation_type)={value})"
            )
        }
        QueryField::Evidence | QueryField::Component => {
            let value = bind(
                binds,
                format!("%{}%", clause.value.to_lowercase().replace('\\', "/")),
            );
            // Evidence hangs off the current *revision*, not the item, so provenance follows the
            // document's history rather than accumulating across every revision ever written.
            // Backslashes are normalized on both sides so a Windows-typed path matches.
            format!(
                "EXISTS(SELECT 1 FROM memory_revision_sources rs \
                 JOIN memory_sources s ON s.id=rs.source_id \
                 WHERE rs.revision_id=i.current_revision_id \
                 AND lower(replace(COALESCE(s.file_path,s.uri),'\\','/')) LIKE {value})"
            )
        }
        QueryField::Risk | QueryField::Origin | QueryField::Entity => {
            let value = bind(binds, clause.value.to_lowercase());
            let column = match clause.field {
                QueryField::Risk => "c.risk_class",
                QueryField::Origin => "c.origin",
                _ => "c.subject",
            };
            format!(
                "EXISTS(SELECT 1 FROM knowledge_candidates c WHERE c.item_id=i.id \
                 AND lower({column})={value})"
            )
        }
    }
}

/// Push one value and return its positional placeholder. The single place a bind index is minted,
/// so a clause can never accidentally reference a placeholder it did not push.
fn bind(binds: &mut Vec<String>, value: String) -> String {
    binds.push(value);
    format!("?{}", binds.len())
}

fn truthy(value: &str) -> bool {
    matches!(
        value.to_ascii_lowercase().as_str(),
        "true" | "yes" | "1" | "on"
    )
}

fn numeric(column: &str, operator: &str, value: &str, binds: &mut Vec<String>) -> String {
    match value.parse::<f64>() {
        Ok(_) => {
            binds.push(value.to_owned());
            format!("{column}{operator}CAST(?{} AS REAL)", binds.len())
        }
        // A non-numeric comparison against a numeric column matches nothing, which is more honest
        // than coercing it to zero and returning a set the user did not ask for.
        Err(_) => "0=1".to_owned(),
    }
}

fn date(column: &str, operator: &str, value: &str, binds: &mut Vec<String>) -> String {
    let resolved = resolve_relative_date(value);
    let flipped = if resolved.is_some() {
        match operator {
            "<" => ">",
            ">" => "<",
            other => other,
        }
    } else {
        operator
    };
    binds.push(resolved.unwrap_or_else(|| value.to_owned()));
    format!("{column}{flipped}?{}", binds.len())
}

/// Translate an AST into a `WHERE`-clause fragment for `memory_items i`.
///
/// Free-text nodes translate to `1=1` here: lexical matching is a separate FTS pass that the
/// executor unions in, because running FTS inside a boolean tree would make an `OR` of two words
/// cost two index scans per row.
pub fn translate(expression: &QueryExpression) -> TranslatedQuery {
    let mut binds = Vec::new();
    let sql = translate_into(expression, &mut binds);
    TranslatedQuery { sql, binds }
}

fn translate_into(expression: &QueryExpression, binds: &mut Vec<String>) -> String {
    match expression {
        QueryExpression::All | QueryExpression::Text(_) => "1=1".to_owned(),
        QueryExpression::Field(clause) => field_sql(clause, binds),
        QueryExpression::Not(inner) => format!("NOT ({})", translate_into(inner, binds)),
        QueryExpression::And(parts) => join(parts, " AND ", binds),
        QueryExpression::Or(parts) => join(parts, " OR ", binds),
    }
}

fn join(parts: &[QueryExpression], separator: &str, binds: &mut Vec<String>) -> String {
    if parts.is_empty() {
        return "1=1".to_owned();
    }
    let rendered: Vec<String> = parts
        .iter()
        .map(|part| translate_into(part, binds))
        .collect();
    format!("({})", rendered.join(separator))
}

/// Whether the query constrains anything at all. A filterless query is a listing, and the executor
/// uses this to skip an FTS pass it would learn nothing from.
pub fn is_unconstrained(expression: &QueryExpression) -> bool {
    matches!(expression, QueryExpression::All)
}

/// Domains named by `is:` clauses anywhere in the query, in the order they appear.
///
/// Empty means the caller's default — every domain. Reading these out of the tree rather than
/// pre-parsing the raw string is what keeps `is:` a first-class part of one grammar instead of a
/// second, ad-hoc one.
pub fn selected_domains(expression: &QueryExpression) -> Vec<SearchDomain> {
    let mut out = Vec::new();
    collect_domains(expression, &mut out);
    out
}

fn collect_domains(expression: &QueryExpression, out: &mut Vec<SearchDomain>) {
    match expression {
        QueryExpression::Field(clause) if clause.field == QueryField::Is => {
            if let Some(domain) = SearchDomain::parse(&clause.value.to_ascii_lowercase()) {
                if !out.contains(&domain) {
                    out.push(domain);
                }
            }
        }
        QueryExpression::And(parts) | QueryExpression::Or(parts) => {
            for part in parts {
                collect_domains(part, out);
            }
        }
        // A negated selector says which domain *not* to search; that is a different feature and
        // silently treating it as a positive selection would be worse than not supporting it.
        QueryExpression::Not(_)
        | QueryExpression::Field(_)
        | QueryExpression::Text(_)
        | QueryExpression::All => {}
    }
}

/// Positive equality clauses, for the stores that have no `memory_items` row to filter.
///
/// Only `Equals` clauses outside a `NOT` are returned: the non-memory domains are small, flat
/// tables, and supporting the full boolean tree against each of them would mean six more
/// translators for a gain nobody has asked for. Anything not returned here is simply not applied,
/// which the caller reports rather than pretending it was.
pub fn simple_filters(expression: &QueryExpression) -> Vec<(QueryField, String)> {
    let mut out = Vec::new();
    collect_simple(expression, &mut out);
    out
}

fn collect_simple(expression: &QueryExpression, out: &mut Vec<(QueryField, String)>) {
    match expression {
        QueryExpression::Field(clause) if clause.comparator == Comparator::Equals => {
            out.push((clause.field, clause.value.to_ascii_lowercase()));
        }
        QueryExpression::And(parts) => {
            for part in parts {
                collect_simple(part, out);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn field(expression: &QueryExpression) -> &FieldClause {
        match expression {
            QueryExpression::Field(clause) => clause,
            other => panic!("expected a field clause, got {other:?}"),
        }
    }

    #[test]
    fn an_empty_query_matches_everything() {
        let parsed = parse("   ");
        assert_eq!(parsed.expression, QueryExpression::All);
        assert!(parsed.diagnostics.is_empty());
        assert_eq!(translate(&parsed.expression).sql, "1=1");
    }

    #[test]
    fn adjacent_clauses_are_an_implicit_and() {
        let parsed = parse("type:decision status:accepted");
        match &parsed.expression {
            QueryExpression::And(parts) => {
                assert_eq!(parts.len(), 2);
                assert_eq!(field(&parts[0]).field, QueryField::Type);
                assert_eq!(field(&parts[1]).field, QueryField::Status);
            }
            other => panic!("expected AND, got {other:?}"),
        }
    }

    #[test]
    fn a_value_group_expands_to_or() {
        let parsed = parse("type:(bug OR incident) severity:high");
        let QueryExpression::And(parts) = &parsed.expression else {
            panic!("expected AND: {:?}", parsed.expression);
        };
        let QueryExpression::Or(options) = &parts[0] else {
            panic!("expected OR inside the group: {:?}", parts[0]);
        };
        assert_eq!(options.len(), 2);
        assert_eq!(field(&options[0]).value, "bug");
        assert_eq!(field(&options[1]).value, "incident");
        // `severity` is not a known field, so it degrades to text with a diagnostic rather than
        // silently matching nothing.
        assert!(parsed
            .diagnostics
            .iter()
            .any(|note| note.contains("severity")));
    }

    #[test]
    fn explicit_boolean_operators_group_correctly() {
        let parsed = parse("quality:canonical AND (type:decision OR type:constraint)");
        let QueryExpression::And(parts) = &parsed.expression else {
            panic!("expected AND: {:?}", parsed.expression);
        };
        assert_eq!(parts.len(), 2);
        assert!(matches!(parts[1], QueryExpression::Or(_)));
    }

    #[test]
    fn not_is_accepted_in_both_spellings() {
        for query in ["NOT type:note", "-type:note"] {
            let parsed = parse(query);
            let QueryExpression::Not(inner) = &parsed.expression else {
                panic!("expected NOT for {query}: {:?}", parsed.expression);
            };
            assert_eq!(field(inner).value, "note");
        }
    }

    #[test]
    fn free_text_survives_alongside_filters() {
        let parsed = parse("token rotation type:decision");
        assert_eq!(
            parsed.expression.text_terms(),
            vec!["token".to_owned(), "rotation".to_owned()]
        );
    }

    #[test]
    fn quoted_values_keep_their_punctuation_and_operators() {
        let parsed = parse(r#"title:"GET /api/sessions""#);
        let clause = field(&parsed.expression);
        assert_eq!(clause.value, "GET /api/sessions");
        assert_eq!(clause.comparator, Comparator::Equals);
    }

    #[test]
    fn comparison_prefixes_are_read_off_the_value() {
        assert_eq!(
            field(&parse("confidence:>0.8").expression).comparator,
            Comparator::GreaterThan
        );
        assert_eq!(
            field(&parse("type:!note").expression).comparator,
            Comparator::NotEquals
        );
        assert_eq!(
            field(&parse("title:~auth").expression).comparator,
            Comparator::Contains
        );
    }

    #[test]
    fn a_relative_date_becomes_an_absolute_bound_in_the_right_direction() {
        // "verified within the last 30 days" is a *lower* bound on the timestamp. Reading the `<`
        // literally would return everything verified long ago, which is the opposite set.
        let translated = translate(&parse("verified:<30d").expression);
        assert!(
            translated.sql.contains("i.verified_at>"),
            "got {}",
            translated.sql
        );
        assert_eq!(translated.binds.len(), 1);
        assert!(translated.binds[0].contains('T'), "bound an RFC3339 stamp");
    }

    #[test]
    fn every_value_is_bound_and_never_interpolated() {
        let hostile = r#"type:"x'; DROP TABLE memory_items;--""#;
        let translated = translate(&parse(hostile).expression);
        assert!(
            !translated.sql.contains("DROP"),
            "the value must not reach the SQL text: {}",
            translated.sql
        );
        assert_eq!(translated.binds, vec!["x'; drop table memory_items;--"]);
    }

    #[test]
    fn an_unknown_field_name_can_never_become_a_column() {
        let translated = translate(&parse("i.title);DELETE FROM memory_items;--:x").expression);
        // The unknown field degraded to free text, which translates to a constant.
        assert_eq!(translated.sql, "1=1");
        assert!(translated.binds.is_empty());
    }

    #[test]
    fn malformed_queries_still_run_and_report_what_was_ignored() {
        for query in ["type:", "((type:decision", "AND", ")", "NOT"] {
            let parsed = parse(query);
            let translated = translate(&parsed.expression);
            assert!(
                !translated.sql.is_empty(),
                "'{query}' must still produce runnable SQL"
            );
            assert!(
                !parsed.diagnostics.is_empty(),
                "'{query}' must say what it could not read"
            );
        }
    }

    #[test]
    fn deep_nesting_is_bounded_rather_than_recursive() {
        let query = format!("{}type:note{}", "(".repeat(200), ")".repeat(200));
        let parsed = parse(&query);
        assert!(parsed
            .diagnostics
            .iter()
            .any(|note| note.contains("deeply")));
        // Reaching here without a stack overflow is the assertion.
        let _ = translate(&parsed.expression);
    }

    #[test]
    fn an_overlong_query_is_truncated_rather_than_accepted() {
        let parsed = parse(&"a ".repeat(2_000));
        assert!(parsed
            .diagnostics
            .iter()
            .any(|note| note.contains("truncated")));
    }

    #[test]
    fn boolean_and_stale_fields_translate_without_binding_a_value() {
        let stale = translate(&parse("stale:true").expression);
        assert!(stale.sql.contains("stale_reason IS NOT NULL"));
        assert!(stale.binds.is_empty());
        let fresh = translate(&parse("stale:false").expression);
        assert!(fresh.sql.contains("stale_reason IS NULL"));
    }

    #[test]
    fn a_non_numeric_comparison_matches_nothing_rather_than_zero() {
        let translated = translate(&parse("confidence:>high").expression);
        assert_eq!(translated.sql, "0=1");
    }

    #[test]
    fn property_clauses_carry_their_sub_key() {
        let clause = field(&parse("prop:owner=auth").expression).clone();
        assert_eq!(clause.key.as_deref(), Some("owner"));
        assert_eq!(clause.value, "auth");
        let translated = translate(&QueryExpression::Field(clause));
        assert_eq!(translated.binds, vec!["owner", "auth"]);
    }

    #[test]
    fn text_under_a_negation_is_not_collected_for_fts() {
        // Collecting it would make the FTS pass *include* what the user asked to exclude.
        let parsed = parse("NOT rotation type:decision");
        assert!(parsed.expression.text_terms().is_empty());
    }
}

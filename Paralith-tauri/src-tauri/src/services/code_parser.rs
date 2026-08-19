//! Deterministic source parsing for the code graph.
//!
//! Pure by construction: no database, no filesystem, no clock, no model. That is what makes a
//! reindex reproduce the previous answer exactly, and what lets the whole grammar be tested
//! against string literals rather than against a checked-in repository.
//!
//! ## Why not a language server, and why not tree-sitter
//!
//! The product question is "what exists here, and what names it". A language server answers a much
//! harder question — types, overload resolution, generic instantiation — at the cost of running one
//! server process per language, with an install PARALITH does not control. Tree-sitter would give
//! exact syntax trees, but it is a grammar crate per language and a native build step, and the
//! precision it buys does not change any answer the Context Fabric asks: a call graph built from
//! "this identifier appears in call position inside this function" is the same call graph a parse
//! tree would produce for the overwhelming majority of real code, and where it differs it
//! *over*-reports rather than inventing an edge that does not exist.
//!
//! So this is the deterministic tier of the stated preference order (LSP → tree-sitter →
//! deterministic). The seam that would accept either richer tier is [`parse_source`]: it takes text
//! and returns [`ParsedFile`], so a future LSP-backed implementation replaces this function and
//! nothing above it changes.
//!
//! ## What the scanner guarantees
//!
//! * **Strings and comments never produce symbols or references.** [`sanitize`] blanks them first,
//!   preserving line and column structure so every line number stays truthful.
//! * **Reference over-reporting is bounded and one-directional.** An identifier in call position is
//!   recorded as a `call`; anything else naming a known symbol is recorded as a weaker `reference`.
//!   The indexer never claims a relationship it did not see text for.
//! * **Nothing here can loop unboundedly.** Every scan is one pass over a bounded line vector.

use crate::models::code::*;

/// Longest single line the scanner will examine. Minified bundles and generated data files produce
/// megabyte lines; scanning them costs time and yields nothing structural.
const MAX_LINE_CHARS: usize = 2_000;

/// Most symbols recorded from one file. A generated file with fifty thousand constants is real, but
/// indexing all of them buys nothing and costs the whole budget.
const MAX_SYMBOLS_PER_FILE: usize = 2_000;

/// Most references recorded from one file, for the same reason.
const MAX_REFERENCES_PER_FILE: usize = 4_000;

/// Identifiers that are language or standard-library machinery. Recording a reference to `if` or
/// `console` adds noise to every graph without adding a single true edge.
const NOISE_IDENTIFIERS: &[&str] = &[
    "if",
    "else",
    "for",
    "while",
    "return",
    "match",
    "let",
    "const",
    "var",
    "function",
    "class",
    "struct",
    "enum",
    "impl",
    "trait",
    "type",
    "interface",
    "import",
    "export",
    "from",
    "new",
    "await",
    "async",
    "try",
    "catch",
    "finally",
    "throw",
    "switch",
    "case",
    "break",
    "continue",
    "def",
    "self",
    "this",
    "super",
    "true",
    "false",
    "null",
    "None",
    "True",
    "False",
    "undefined",
    "console",
    "require",
    "module",
    "exports",
    "print",
    "String",
    "Number",
    "Boolean",
    "Object",
    "Array",
    "Promise",
    "Error",
    "Some",
    "None",
    "Ok",
    "Err",
    "Vec",
    "Option",
    "Result",
    "Box",
    "String",
    "HashMap",
    "static",
    "pub",
    "fn",
    "use",
    "mod",
    "package",
    "public",
    "private",
    "protected",
    "void",
    "int",
    "bool",
    "str",
    "usize",
    "i32",
    "i64",
    "f32",
    "f64",
    "in",
    "of",
    "as",
    "is",
    "not",
    "and",
    "or",
    "with",
    "yield",
    "lambda",
    "pass",
    "raise",
    "except",
    "elif",
    "do",
    "go",
    "defer",
    "chan",
    "range",
    "map",
    "make",
    "len",
    "append",
    "nil",
    "func",
    "var",
];

fn is_noise(identifier: &str) -> bool {
    NOISE_IDENTIFIERS.contains(&identifier)
}

/// Blank out string literals and comments, preserving length and line structure.
///
/// Replacing rather than removing is what keeps every reported line number equal to the line number
/// a developer sees in the editor. A parser that strips comments and then counts lines reports the
/// wrong line for everything after the first block comment.
fn sanitize(source: &str, language: CodeLanguage) -> Vec<String> {
    let hash_comments = matches!(
        language,
        CodeLanguage::Python | CodeLanguage::Ruby | CodeLanguage::Yaml | CodeLanguage::Toml
    );
    let mut out = Vec::new();
    let mut in_block_comment = false;
    // Python/Ruby triple-quote blocks behave like block comments for our purposes: nothing
    // structural is declared inside one.
    let mut in_triple = false;

    for raw in source.lines() {
        let line: String = raw.chars().take(MAX_LINE_CHARS).collect();
        let chars: Vec<char> = line.chars().collect();
        let mut blanked: Vec<char> = Vec::with_capacity(chars.len());
        let mut index = 0usize;
        let mut in_string: Option<char> = None;

        while index < chars.len() {
            let current = chars[index];
            let next = chars.get(index + 1).copied();

            if in_triple {
                if (current == '"' && next == Some('"') && chars.get(index + 2) == Some(&'"'))
                    || (current == '\''
                        && next == Some('\'')
                        && chars.get(index + 2) == Some(&'\''))
                {
                    in_triple = false;
                    blanked.extend([' ', ' ', ' ']);
                    index += 3;
                    continue;
                }
                blanked.push(' ');
                index += 1;
                continue;
            }

            if in_block_comment {
                if current == '*' && next == Some('/') {
                    in_block_comment = false;
                    blanked.extend([' ', ' ']);
                    index += 2;
                    continue;
                }
                blanked.push(' ');
                index += 1;
                continue;
            }

            if let Some(quote) = in_string {
                blanked.push(' ');
                if current == '\\' {
                    // Skip the escaped character so `"\""` does not close the literal early.
                    blanked.push(' ');
                    index += 2;
                    continue;
                }
                if current == quote {
                    in_string = None;
                }
                index += 1;
                continue;
            }

            if hash_comments && current == '#' {
                break;
            }
            if !hash_comments && current == '/' && next == Some('/') {
                break;
            }
            if !hash_comments && current == '/' && next == Some('*') {
                in_block_comment = true;
                blanked.extend([' ', ' ']);
                index += 2;
                continue;
            }
            if (current == '"' && next == Some('"') && chars.get(index + 2) == Some(&'"'))
                || (current == '\'' && next == Some('\'') && chars.get(index + 2) == Some(&'\''))
            {
                in_triple = true;
                blanked.extend([' ', ' ', ' ']);
                index += 3;
                continue;
            }
            if current == '"' || current == '\'' || current == '`' {
                in_string = Some(current);
                blanked.push(' ');
                index += 1;
                continue;
            }
            blanked.push(current);
            index += 1;
        }
        out.push(blanked.into_iter().collect());
    }
    out
}

/// Net brace delta of a sanitized line.
fn brace_delta(line: &str) -> i32 {
    line.chars()
        .fold(0i32, |accumulator, character| match character {
            '{' => accumulator + 1,
            '}' => accumulator - 1,
            _ => accumulator,
        })
}

fn indent_of(line: &str) -> usize {
    line.chars()
        .take_while(|character| *character == ' ' || *character == '\t')
        .count()
}

fn is_identifier_start(character: char) -> bool {
    character.is_ascii_alphabetic() || character == '_' || character == '$'
}

fn is_identifier_char(character: char) -> bool {
    character.is_ascii_alphanumeric() || character == '_' || character == '$'
}

/// Read the identifier starting at `index`, if there is one.
fn read_identifier(chars: &[char], index: usize) -> Option<(String, usize)> {
    if !is_identifier_start(*chars.get(index)?) {
        return None;
    }
    let mut end = index;
    while end < chars.len() && is_identifier_char(chars[end]) {
        end += 1;
    }
    Some((chars[index..end].iter().collect(), end))
}

/// The identifier immediately following `keyword ` on a trimmed line.
fn name_after(trimmed: &str, keyword: &str) -> Option<String> {
    let rest = trimmed.strip_prefix(keyword)?;
    let rest = rest.trim_start();
    let chars: Vec<char> = rest.chars().collect();
    let (name, _) = read_identifier(&chars, 0)?;
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

/// Strip every leading declaration modifier the brace languages allow, returning the remainder.
fn strip_modifiers(trimmed: &str) -> &str {
    // `const` and `static` are deliberately absent: in Rust they *are* the declaration keyword, and
    // in TypeScript `const Name = () =>` is how most of a modern codebase declares its functions.
    // Stripping them here would make both invisible to the recognizers below.
    const MODIFIERS: &[&str] = &[
        "pub(crate) ",
        "pub(super) ",
        "pub ",
        "export default ",
        "export ",
        "default ",
        "public ",
        "private ",
        "protected ",
        "internal ",
        "final ",
        "abstract ",
        "override ",
        "readonly ",
        "declare ",
        "async ",
        "unsafe ",
        "extern ",
        "sealed ",
        "partial ",
    ];
    let mut rest = trimmed;
    // Bounded: each pass strips at least one character, and the list is short.
    'outer: loop {
        for modifier in MODIFIERS {
            if let Some(stripped) = rest.strip_prefix(modifier) {
                rest = stripped.trim_start();
                continue 'outer;
            }
        }
        return rest;
    }
}

/// A declaration recognized on one line, before container and range resolution.
struct Declaration {
    kind: SymbolKind,
    name: String,
    exported: bool,
}

/// Recognize a declaration on a sanitized, trimmed line.
///
/// Returns `None` for every line that does not open a named construct, which is the overwhelming
/// majority — the scan is cheap because this function fails fast.
fn recognize(trimmed: &str, language: CodeLanguage, path: &str) -> Option<Declaration> {
    let exported = trimmed.starts_with("pub ")
        || trimmed.starts_with("pub(")
        || trimmed.starts_with("export ")
        || trimmed.starts_with("public ");
    let rest = strip_modifiers(trimmed);

    let declaration = match language {
        CodeLanguage::Rust => {
            if let Some(name) = name_after(rest, "fn ") {
                Some((SymbolKind::Function, name))
            } else if let Some(name) = name_after(rest, "struct ") {
                Some((SymbolKind::Struct, name))
            } else if let Some(name) = name_after(rest, "enum ") {
                Some((SymbolKind::Enum, name))
            } else if let Some(name) = name_after(rest, "trait ") {
                Some((SymbolKind::Trait, name))
            } else if let Some(name) = name_after(rest, "type ") {
                Some((SymbolKind::TypeAlias, name))
            } else if let Some(name) = name_after(rest, "mod ") {
                Some((SymbolKind::Module, name))
            } else if let Some(name) = impl_target(rest) {
                Some((SymbolKind::Impl, name))
            } else if let Some(name) = name_after(rest, "static ") {
                Some((SymbolKind::Constant, name))
            } else {
                name_after(rest, "const ").map(|name| (SymbolKind::Constant, name))
            }
        }
        CodeLanguage::TypeScript
        | CodeLanguage::Tsx
        | CodeLanguage::JavaScript
        | CodeLanguage::Jsx => {
            if let Some(name) = name_after(rest, "function ") {
                Some((SymbolKind::Function, name))
            } else if let Some(name) = name_after(rest, "function* ") {
                Some((SymbolKind::Function, name))
            } else if let Some(name) = name_after(rest, "class ") {
                Some((SymbolKind::Class, name))
            } else if let Some(name) = name_after(rest, "interface ") {
                Some((SymbolKind::Interface, name))
            } else if let Some(name) = name_after(rest, "enum ") {
                Some((SymbolKind::Enum, name))
            } else if let Some(name) = name_after(rest, "type ") {
                Some((SymbolKind::TypeAlias, name))
            } else if let Some(name) = arrow_binding(rest) {
                // `const Foo = () => …` and `const foo = function …` are declarations in every
                // sense that matters; treating them as anonymous variables would lose most of a
                // modern React codebase's call graph.
                let kind = classify_javascript_binding(&name, path);
                Some((kind, name))
            } else {
                None
            }
        }
        CodeLanguage::Python => {
            if let Some(name) = name_after(rest, "def ") {
                Some((SymbolKind::Function, name))
            } else if let Some(name) = name_after(rest, "async def ") {
                Some((SymbolKind::Function, name))
            } else {
                name_after(rest, "class ").map(|name| (SymbolKind::Class, name))
            }
        }
        CodeLanguage::Go => {
            if let Some(name) = go_function_name(rest) {
                Some((SymbolKind::Function, name))
            } else if let Some(name) = name_after(rest, "type ") {
                let kind = if rest.contains(" interface") {
                    SymbolKind::Interface
                } else if rest.contains(" struct") {
                    SymbolKind::Struct
                } else {
                    SymbolKind::TypeAlias
                };
                Some((kind, name))
            } else {
                None
            }
        }
        CodeLanguage::Java | CodeLanguage::CSharp => {
            if let Some(name) = name_after(rest, "class ") {
                Some((SymbolKind::Class, name))
            } else if let Some(name) = name_after(rest, "interface ") {
                Some((SymbolKind::Interface, name))
            } else if let Some(name) = name_after(rest, "enum ") {
                Some((SymbolKind::Enum, name))
            } else if let Some(name) = name_after(rest, "record ") {
                Some((SymbolKind::Struct, name))
            } else {
                java_method_name(rest).map(|name| (SymbolKind::Method, name))
            }
        }
        _ => None,
    };

    let (kind, name) = declaration?;
    if name.is_empty() || is_noise(&name) {
        return None;
    }
    Some(Declaration {
        kind,
        name,
        exported,
    })
}

/// The type an `impl` block belongs to.
///
/// `impl Trait for Type` names the **type**, not the trait: the methods inside belong to `Type`,
/// and a caller looking for `Type::method` must find it under `Type`. Generic parameters are
/// skipped on both sides so `impl<T> Engine<T>` still names `Engine`.
fn impl_target(rest: &str) -> Option<String> {
    let after = rest.strip_prefix("impl")?;
    if !after.starts_with(' ') && !after.starts_with('<') {
        return None;
    }
    let after = skip_generics(after.trim_start());
    let target = match after.split_once(" for ") {
        Some((_, tail)) => tail,
        None => after,
    };
    let chars: Vec<char> = skip_generics(target.trim_start()).chars().collect();
    read_identifier(&chars, 0).map(|(name, _)| name)
}

/// Skip a leading balanced `<…>` block, if present.
fn skip_generics(text: &str) -> &str {
    if !text.starts_with('<') {
        return text;
    }
    let mut depth = 0usize;
    for (index, character) in text.char_indices() {
        match character {
            '<' => depth += 1,
            '>' => {
                depth -= 1;
                if depth == 0 {
                    return text[index + character.len_utf8()..].trim_start();
                }
            }
            _ => {}
        }
    }
    text
}

/// `const Name = (…) =>` / `const name = function` / `let name = async (…) =>`.
fn arrow_binding(rest: &str) -> Option<String> {
    for keyword in ["const ", "let ", "var "] {
        if let Some(tail) = rest.strip_prefix(keyword) {
            let name = {
                let chars: Vec<char> = tail.trim_start().chars().collect();
                read_identifier(&chars, 0).map(|(name, _)| name)?
            };
            let after = tail.split_once('=')?.1;
            if after.contains("=>") || after.trim_start().starts_with("function") {
                return Some(name);
            }
            return None;
        }
    }
    // A bare `Name = () =>` inside an object is not a declaration; require a binding keyword.
    None
}

/// A capitalized binding in a `.tsx`/`.jsx` file is a component; a `useX` binding is a hook. Both
/// distinctions exist because both are things a developer searches for by category.
fn classify_javascript_binding(name: &str, path: &str) -> SymbolKind {
    let first = name.chars().next().unwrap_or('a');
    if name.starts_with("use")
        && name.len() > 3
        && name.chars().nth(3).is_some_and(|c| c.is_ascii_uppercase())
    {
        return SymbolKind::Hook;
    }
    if first.is_ascii_uppercase() && (path.ends_with(".tsx") || path.ends_with(".jsx")) {
        return SymbolKind::Component;
    }
    if first.is_ascii_uppercase() {
        return SymbolKind::Function;
    }
    SymbolKind::Function
}

/// `func Name(` or `func (r Receiver) Name(`.
fn go_function_name(rest: &str) -> Option<String> {
    let tail = rest.strip_prefix("func ")?.trim_start();
    let tail = if tail.starts_with('(') {
        tail.split_once(')')?.1.trim_start()
    } else {
        tail
    };
    let chars: Vec<char> = tail.chars().collect();
    read_identifier(&chars, 0).map(|(name, _)| name)
}

/// A Java/C# method signature: `ReturnType name(` with a brace or semicolon terminator.
fn java_method_name(rest: &str) -> Option<String> {
    let open = rest.find('(')?;
    let head = &rest[..open];
    let name = head.split_whitespace().next_back()?;
    if name.is_empty() || is_noise(name) {
        return None;
    }
    if !name.chars().all(is_identifier_char) {
        return None;
    }
    // Require a type before the name so a bare call like `doThing(x)` is not read as a declaration.
    if head.split_whitespace().count() < 2 {
        return None;
    }
    Some(name.to_owned())
}

/// Recognize an import on a sanitized, trimmed line.
fn recognize_import(trimmed: &str, language: CodeLanguage) -> Option<ParsedImport> {
    match language {
        CodeLanguage::Rust => {
            let rest = strip_modifiers(trimmed);
            let path = rest.strip_prefix("use ")?.trim_end_matches(';').trim();
            if path.is_empty() {
                return None;
            }
            let (specifier, symbols) = match path.split_once("::{") {
                Some((head, tail)) => (
                    head.trim().to_owned(),
                    tail.trim_end_matches('}')
                        .split(',')
                        .map(|part| part.trim().to_owned())
                        .filter(|part| !part.is_empty())
                        .collect(),
                ),
                None => {
                    let leaf = path.rsplit("::").next().unwrap_or(path).to_owned();
                    let head = path.rsplit_once("::").map(|(head, _)| head.to_owned());
                    (head.unwrap_or_else(|| path.to_owned()), vec![leaf])
                }
            };
            Some(ParsedImport {
                specifier,
                symbols,
                line: 0,
            })
        }
        CodeLanguage::TypeScript
        | CodeLanguage::Tsx
        | CodeLanguage::JavaScript
        | CodeLanguage::Jsx => {
            if let Some(rest) = trimmed.strip_prefix("import ") {
                // `import x from "y"` / `import {a, b} from "y"` / `import "y"`.
                let (clause, source) = match rest.rsplit_once(" from ") {
                    Some((clause, source)) => (clause, source),
                    None => ("", rest),
                };
                let specifier = extract_quoted(source)?;
                let symbols = clause
                    .trim()
                    .trim_start_matches('{')
                    .trim_end_matches('}')
                    .split(',')
                    .map(|part| {
                        part.split(" as ")
                            .last()
                            .unwrap_or(part)
                            .trim()
                            .trim_start_matches('{')
                            .trim_end_matches('}')
                            .trim()
                            .to_owned()
                    })
                    .filter(|part| !part.is_empty() && *part != "*")
                    .collect();
                return Some(ParsedImport {
                    specifier,
                    symbols,
                    line: 0,
                });
            }
            if trimmed.contains("require(") {
                let after = trimmed.split_once("require(")?.1;
                let specifier = extract_quoted(after)?;
                return Some(ParsedImport {
                    specifier,
                    symbols: Vec::new(),
                    line: 0,
                });
            }
            if trimmed.starts_with("export ") && trimmed.contains(" from ") {
                let source = trimmed.rsplit_once(" from ")?.1;
                let specifier = extract_quoted(source)?;
                return Some(ParsedImport {
                    specifier,
                    symbols: Vec::new(),
                    line: 0,
                });
            }
            None
        }
        CodeLanguage::Python => {
            if let Some(rest) = trimmed.strip_prefix("from ") {
                let (module, tail) = rest.split_once(" import ")?;
                let symbols = tail
                    .split(',')
                    .map(|part| part.split(" as ").last().unwrap_or(part).trim().to_owned())
                    .filter(|part| !part.is_empty() && part != "*")
                    .collect();
                return Some(ParsedImport {
                    specifier: module.trim().to_owned(),
                    symbols,
                    line: 0,
                });
            }
            let rest = trimmed.strip_prefix("import ")?;
            let module = rest.split(',').next()?.split(" as ").next()?.trim();
            if module.is_empty() {
                return None;
            }
            Some(ParsedImport {
                specifier: module.to_owned(),
                symbols: Vec::new(),
                line: 0,
            })
        }
        CodeLanguage::Go => {
            let rest = trimmed.strip_prefix("import ").unwrap_or(trimmed);
            let specifier = extract_quoted(rest)?;
            if specifier.is_empty() {
                return None;
            }
            Some(ParsedImport {
                specifier,
                symbols: Vec::new(),
                line: 0,
            })
        }
        CodeLanguage::Java | CodeLanguage::CSharp => {
            let rest = trimmed
                .strip_prefix("import ")
                .or_else(|| trimmed.strip_prefix("using "))?;
            let module = rest.trim_end_matches(';').trim();
            if module.is_empty() {
                return None;
            }
            Some(ParsedImport {
                specifier: module.to_owned(),
                symbols: Vec::new(),
                line: 0,
            })
        }
        _ => None,
    }
}

/// First single- or double-quoted run in `text`. Backticks are excluded: a template literal
/// specifier is dynamic and cannot be statically resolved anyway.
fn extract_quoted(text: &str) -> Option<String> {
    let bytes: Vec<char> = text.chars().collect();
    let mut index = 0usize;
    while index < bytes.len() {
        if bytes[index] == '"' || bytes[index] == '\'' {
            let quote = bytes[index];
            let start = index + 1;
            let mut end = start;
            while end < bytes.len() && bytes[end] != quote {
                end += 1;
            }
            if end <= bytes.len() {
                let value: String = bytes[start..end.min(bytes.len())].iter().collect();
                return Some(value);
            }
        }
        index += 1;
    }
    // The sanitizer blanks string literals, so import lines are re-read from the *raw* text; when
    // that is unavailable the specifier is simply not recoverable and the import is dropped.
    None
}

/// One entry on the container stack.
struct OpenContainer {
    name: String,
    /// Brace depth (or indent column, for Python) at which this container closes.
    close_at: i32,
    /// Index into the symbol vector, so the end line can be written when it closes.
    symbol_index: usize,
    is_container: bool,
}

/// Parse one file's source into symbols, imports, and references.
///
/// `path` is used only to pick the grammar and to classify `.tsx` components; nothing is read from
/// disk here.
pub fn parse_source(path: &str, source: &str) -> ParsedFile {
    let language = CodeLanguage::from_path(path);
    let raw_lines: Vec<&str> = source.lines().collect();
    let sanitized = sanitize(source, language);
    let mut parsed = ParsedFile {
        language: language.as_str().to_owned(),
        module: module_of(path),
        line_count: raw_lines.len(),
        ..Default::default()
    };
    if !language.has_symbol_grammar() {
        // Still record imports for manifest-adjacent languages that have none, which is a no-op —
        // but the file itself is recorded by the caller, which is the part that matters.
        return parsed;
    }

    let python = language == CodeLanguage::Python;
    let mut stack: Vec<OpenContainer> = Vec::new();
    let mut depth = 0i32;
    let mut pending_doc: Vec<String> = Vec::new();

    for (index, line) in sanitized.iter().enumerate() {
        let line_number = index + 1;
        let trimmed = line.trim();
        let raw_trimmed = raw_lines.get(index).copied().unwrap_or_default().trim();

        // Doc comments are read from the raw line, because the sanitizer blanked them.
        if raw_trimmed.starts_with("///")
            || raw_trimmed.starts_with("//!")
            || raw_trimmed.starts_with("* ")
            || raw_trimmed.starts_with("/**")
        {
            let text = raw_trimmed
                .trim_start_matches("/**")
                .trim_start_matches("///")
                .trim_start_matches("//!")
                .trim_start_matches("* ")
                .trim_start_matches('*')
                .trim();
            if !text.is_empty() && pending_doc.len() < 8 {
                pending_doc.push(text.to_owned());
            }
            continue;
        }

        if trimmed.is_empty() {
            continue;
        }

        // Close containers whose scope ended before this line.
        if python {
            let indent = indent_of(line) as i32;
            while stack.last().is_some_and(|open| indent <= open.close_at) {
                let open = stack.pop().expect("checked by the loop condition");
                parsed.symbols[open.symbol_index].end_line = line_number.saturating_sub(1).max(1);
            }
        }

        if let Some(import) =
            recognize_import(trimmed, language).or_else(|| recognize_import(raw_trimmed, language))
        {
            if parsed.imports.len() < 512 {
                parsed.imports.push(ParsedImport {
                    line: line_number,
                    ..import
                });
            }
        }

        let container = stack
            .iter()
            .rev()
            .find(|open| open.is_container)
            .map(|open| open.name.clone());
        let enclosing = stack.last().map(|open| open.name.clone());

        if parsed.symbols.len() < MAX_SYMBOLS_PER_FILE {
            if let Some(declaration) = recognize(trimmed, language, path) {
                let kind = if declaration.kind == SymbolKind::Function && container.is_some() {
                    SymbolKind::Method
                } else {
                    declaration.kind
                };
                let symbol_index = parsed.symbols.len();
                parsed.symbols.push(ParsedSymbol {
                    kind,
                    name: declaration.name.clone(),
                    container: container.clone(),
                    signature: Some(compact_signature(raw_trimmed)),
                    doc: if pending_doc.is_empty() {
                        None
                    } else {
                        Some(pending_doc.join(" "))
                    },
                    start_line: line_number,
                    end_line: line_number,
                    exported: declaration.exported,
                });
                let opens = if python {
                    trimmed.ends_with(':')
                } else {
                    brace_delta(line) > 0
                };
                if opens {
                    stack.push(OpenContainer {
                        name: declaration.name,
                        close_at: if python {
                            indent_of(line) as i32
                        } else {
                            depth
                        },
                        symbol_index,
                        is_container: kind.is_container(),
                    });
                }
            } else {
                collect_references(
                    trimmed,
                    line_number,
                    enclosing.as_deref(),
                    language,
                    &mut parsed.references,
                );
            }
        }
        pending_doc.clear();

        if !python {
            let before = depth;
            depth += brace_delta(line);
            // A line that closes braces ends every container opened at or above the new depth.
            if depth < before {
                while stack.last().is_some_and(|open| depth <= open.close_at) {
                    let open = stack.pop().expect("checked by the loop condition");
                    parsed.symbols[open.symbol_index].end_line = line_number;
                }
            }
        }
    }

    // Anything still open runs to the end of the file.
    let last = parsed.line_count.max(1);
    while let Some(open) = stack.pop() {
        parsed.symbols[open.symbol_index].end_line = last;
    }
    for symbol in &mut parsed.symbols {
        if symbol.end_line < symbol.start_line {
            symbol.end_line = symbol.start_line;
        }
    }
    parsed.references.truncate(MAX_REFERENCES_PER_FILE);
    parsed
}

/// Collect identifier references from one sanitized line.
fn collect_references(
    line: &str,
    line_number: usize,
    enclosing: Option<&str>,
    language: CodeLanguage,
    out: &mut Vec<ParsedReference>,
) {
    if out.len() >= MAX_REFERENCES_PER_FILE {
        return;
    }
    let chars: Vec<char> = line.chars().collect();
    let mut index = 0usize;
    let mut seen_on_line: Vec<String> = Vec::new();

    while index < chars.len() {
        let Some((identifier, end)) = read_identifier(&chars, index) else {
            index += 1;
            continue;
        };
        index = end;
        if is_noise(&identifier) || identifier.len() < 2 {
            continue;
        }
        // A member access (`foo.bar`) records the member, not the receiver chain; recording both
        // would double-count every fluent call.
        let previous = chars[..end - identifier.chars().count()]
            .iter()
            .rev()
            .find(|character| !character.is_whitespace())
            .copied();
        let next_significant = chars[end..]
            .iter()
            .find(|character| !character.is_whitespace())
            .copied();

        let kind = match next_significant {
            Some('(') => ReferenceKind::Call,
            _ => ReferenceKind::Reference,
        };
        // `extends X` / `implements X` are stronger, typed edges.
        let kind = if line.contains(&format!("extends {identifier}")) {
            ReferenceKind::Extends
        } else if line.contains(&format!("implements {identifier}")) {
            ReferenceKind::Implements
        } else if matches!(language, CodeLanguage::Tsx | CodeLanguage::Jsx)
            && previous == Some('<')
            && identifier
                .chars()
                .next()
                .is_some_and(|c| c.is_ascii_uppercase())
        {
            ReferenceKind::Renders
        } else {
            kind
        };

        if kind == ReferenceKind::Reference && previous == Some('.') {
            // A plain property read on an unknown receiver is not a useful edge.
            continue;
        }
        if seen_on_line.contains(&identifier) {
            continue;
        }
        seen_on_line.push(identifier.clone());
        out.push(ParsedReference {
            symbol_name: identifier,
            kind,
            line: line_number,
            from_symbol: enclosing.map(str::to_owned),
        });
        if out.len() >= MAX_REFERENCES_PER_FILE {
            return;
        }
    }
}

/// A one-line signature, bounded so a 400-character generic constraint does not enter the index.
fn compact_signature(raw: &str) -> String {
    let collapsed = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = collapsed.trim_end_matches('{').trim().to_owned();
    if trimmed.chars().count() > 200 {
        trimmed.chars().take(200).collect::<String>() + "…"
    } else {
        trimmed
    }
}

/// The module a path belongs to: the directory, which is the unit developers reason about.
fn module_of(path: &str) -> Option<String> {
    let normalized = path.replace('\\', "/");
    let (directory, _) = normalized.rsplit_once('/')?;
    if directory.is_empty() {
        None
    } else {
        Some(directory.to_owned())
    }
}

/// Resolve a relative import specifier against the importing file's directory.
///
/// Returns a project-relative path with no `..` segments left, or `None` when the specifier is not
/// relative (an external package) or escapes the Project root. Escape returns `None` rather than a
/// clamped path: an import that resolves outside the Project is not a Project edge, and silently
/// rewriting it to the root would fabricate one.
pub fn resolve_relative_import(from_path: &str, specifier: &str) -> Option<String> {
    if !specifier.starts_with("./") && !specifier.starts_with("../") && specifier != "." {
        return None;
    }
    let base = from_path.replace('\\', "/");
    let directory = base.rsplit_once('/').map(|(head, _)| head).unwrap_or("");
    let mut segments: Vec<&str> = if directory.is_empty() {
        Vec::new()
    } else {
        directory.split('/').collect()
    };
    for part in specifier.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                segments.pop()?;
            }
            other => segments.push(other),
        }
    }
    if segments.is_empty() {
        return None;
    }
    Some(segments.join("/"))
}

/// Candidate on-disk paths for a resolved import stem, in the order a bundler would try them.
pub fn import_candidates(stem: &str) -> Vec<String> {
    const EXTENSIONS: [&str; 8] = ["ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rs"];
    let mut candidates = vec![stem.to_owned()];
    for extension in EXTENSIONS {
        candidates.push(format!("{stem}.{extension}"));
        candidates.push(format!("{stem}/index.{extension}"));
    }
    candidates.push(format!("{stem}/mod.rs"));
    candidates.push(format!("{stem}/__init__.py"));
    candidates
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(parsed: &ParsedFile) -> Vec<&str> {
        parsed
            .symbols
            .iter()
            .map(|symbol| symbol.name.as_str())
            .collect()
    }

    #[test]
    fn rust_declarations_and_containers() {
        let source = r#"
use std::collections::{HashMap, HashSet};
use crate::services::MemoryService;

/// Runs the thing.
pub fn run(input: &str) -> usize {
    helper(input)
}

pub struct Engine {
    field: usize,
}

impl Engine {
    pub fn start(&self) -> bool {
        true
    }
}
"#;
        let parsed = parse_source("src/engine.rs", source);
        assert_eq!(parsed.language, "rust");
        assert!(names(&parsed).contains(&"run"));
        assert!(names(&parsed).contains(&"Engine"));
        assert!(names(&parsed).contains(&"start"));

        let start = parsed
            .symbols
            .iter()
            .find(|symbol| symbol.name == "start")
            .expect("start is indexed");
        assert_eq!(start.container.as_deref(), Some("Engine"));
        assert_eq!(start.kind, SymbolKind::Method);

        let run = parsed
            .symbols
            .iter()
            .find(|symbol| symbol.name == "run")
            .expect("run is indexed");
        assert!(run.exported);
        assert_eq!(run.doc.as_deref(), Some("Runs the thing."));
        assert!(run.end_line > run.start_line, "a body must span lines");

        let specifiers: Vec<&str> = parsed
            .imports
            .iter()
            .map(|import| import.specifier.as_str())
            .collect();
        assert!(specifiers.contains(&"std::collections"));
        assert!(specifiers.contains(&"crate::services"));
    }

    #[test]
    fn typescript_components_hooks_and_imports() {
        let source = r#"
import { useState, useEffect } from "react";
import Sidebar from "./Sidebar";

export const useProject = (id: string) => {
  return useState(id);
};

export function Workspace() {
  return <Sidebar />;
}
"#;
        let parsed = parse_source("src/Workspace.tsx", source);
        let hook = parsed
            .symbols
            .iter()
            .find(|symbol| symbol.name == "useProject")
            .expect("hook is indexed");
        assert_eq!(hook.kind, SymbolKind::Hook);
        assert!(names(&parsed).contains(&"Workspace"));

        let sidebar = parsed
            .imports
            .iter()
            .find(|import| import.specifier == "./Sidebar")
            .expect("relative import is indexed");
        assert_eq!(sidebar.symbols, vec!["Sidebar".to_owned()]);

        let react = parsed
            .imports
            .iter()
            .find(|import| import.specifier == "react")
            .expect("package import is indexed");
        assert!(react.symbols.contains(&"useState".to_owned()));

        assert!(parsed
            .references
            .iter()
            .any(|reference| reference.symbol_name == "Sidebar"
                && reference.kind == ReferenceKind::Renders));
    }

    #[test]
    fn python_indentation_closes_scopes() {
        let source =
            "class Engine:\n    def start(self):\n        return 1\n\ndef free():\n    return 2\n";
        let parsed = parse_source("app/engine.py", source);
        let start = parsed
            .symbols
            .iter()
            .find(|symbol| symbol.name == "start")
            .expect("method is indexed");
        assert_eq!(start.container.as_deref(), Some("Engine"));
        let free = parsed
            .symbols
            .iter()
            .find(|symbol| symbol.name == "free")
            .expect("module function is indexed");
        assert_eq!(free.container, None, "dedent must close the class");
    }

    #[test]
    fn strings_and_comments_never_declare() {
        let source = r#"
// pub fn ghost() {}
/* fn also_ghost() {} */
pub fn real() {
    let text = "pub fn string_ghost() {}";
    let _ = text;
}
"#;
        let parsed = parse_source("src/x.rs", source);
        assert_eq!(names(&parsed), vec!["real"]);
    }

    #[test]
    fn calls_are_distinguished_from_mentions() {
        let parsed = parse_source(
            "src/x.rs",
            "pub fn outer() {\n    inner(1);\n    let a = value;\n}\n",
        );
        let inner = parsed
            .references
            .iter()
            .find(|reference| reference.symbol_name == "inner")
            .expect("call recorded");
        assert_eq!(inner.kind, ReferenceKind::Call);
        assert_eq!(inner.from_symbol.as_deref(), Some("outer"));
        let value = parsed
            .references
            .iter()
            .find(|reference| reference.symbol_name == "value")
            .expect("mention recorded");
        assert_eq!(value.kind, ReferenceKind::Reference);
    }

    #[test]
    fn go_and_java_grammars() {
        let go = parse_source(
            "server/main.go",
            "package main\nimport \"fmt\"\nfunc Serve() {}\nfunc (s *Server) Handle() {}\ntype Server struct {}\n",
        );
        assert!(names(&go).contains(&"Serve"));
        assert!(names(&go).contains(&"Handle"));
        assert!(names(&go).contains(&"Server"));

        let java = parse_source(
            "src/Main.java",
            "import java.util.List;\npublic class Main {\n  public void run() {}\n}\n",
        );
        assert!(names(&java).contains(&"Main"));
        assert!(names(&java).contains(&"run"));
    }

    #[test]
    fn relative_imports_resolve_and_escapes_are_refused() {
        assert_eq!(
            resolve_relative_import("src/features/a/A.tsx", "./B"),
            Some("src/features/a/B".to_owned())
        );
        assert_eq!(
            resolve_relative_import("src/features/a/A.tsx", "../shared/util"),
            Some("src/features/shared/util".to_owned())
        );
        assert_eq!(resolve_relative_import("src/A.tsx", "react"), None);
        assert_eq!(
            resolve_relative_import("A.tsx", "../../outside"),
            None,
            "an import escaping the Project is not a Project edge"
        );
    }

    #[test]
    fn candidates_cover_the_usual_resolutions() {
        let candidates = import_candidates("src/features/a/B");
        assert!(candidates.contains(&"src/features/a/B.tsx".to_owned()));
        assert!(candidates.contains(&"src/features/a/B/index.ts".to_owned()));
        assert!(candidates.contains(&"src/features/a/B/mod.rs".to_owned()));
    }

    #[test]
    fn a_language_without_a_grammar_still_reports_its_shape() {
        let parsed = parse_source("README.md", "# Title\n\nSome prose.\n");
        assert_eq!(parsed.language, "markdown");
        assert_eq!(parsed.line_count, 3);
        assert!(parsed.symbols.is_empty());
    }

    #[test]
    fn pathological_input_is_bounded() {
        let long_line = "x".repeat(50_000);
        let source = format!("pub fn a() {{\n{long_line}\n}}\n");
        let parsed = parse_source("src/big.rs", &source);
        assert_eq!(names(&parsed), vec!["a"]);
        assert!(parsed.references.len() <= MAX_REFERENCES_PER_FILE);
    }
}

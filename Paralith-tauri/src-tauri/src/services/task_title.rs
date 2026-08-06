//! Derive a Pane title from the task a user just sent to a coding agent.
//!
//! Agent Panes are launched with a generic provider name ("Claude Code", "Codex CLI"), so a
//! Workspace running four agents shows four identical headers and the user has to read the
//! scrollback to remember which Pane is doing what. This module turns the prompt the user
//! actually submitted into a short, readable Pane title.
//!
//! Two pieces:
//!
//! * [`AgentTaskCapture`] reconstructs the submitted prompt from the raw byte stream written to
//!   the PTY. Everything the renderer sends — keystrokes, pastes, edits, cancels — arrives here
//!   as terminal input, so this is the one place that sees every task regardless of which window
//!   or surface produced it.
//! * [`derive_task_title`] compresses that prompt into a title.
//!
//! Both are pure and deterministic: no model call, no network, no added latency on the input
//! path. A title is only produced for text that actually reads like a task — permission answers
//! ("y"), slash commands, and bare acknowledgements are rejected, so an agent mid-run can never
//! rename its own Pane to "Yes".

/// Longest prompt prefix retained while typing. Far more than a title needs, and it stops a
/// runaway paste from growing the buffer without bound.
const MAX_CAPTURE_CHARS: usize = 4_000;

/// Character budget for a derived title. Pane headers also carry the provider label and status,
/// so anything longer truncates visually instead of informing.
const MAX_TITLE_CHARS: usize = 34;

/// A prompt shorter than this, and shorter than two words, is treated as a reply, not a task.
const MIN_TASK_CHARS: usize = 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
enum EscapeState {
    /// Normal typing.
    #[default]
    Idle,
    /// `ESC` seen; the next byte decides whether a sequence follows.
    Escape,
    /// Inside a `ESC [` control sequence, collecting parameter bytes.
    ControlSequence,
    /// Inside a `ESC ]` operating-system command, which runs until BEL or ST.
    OperatingSystemCommand,
    /// `ESC O` (application cursor keys) — exactly one more byte belongs to the sequence.
    SingleShift,
}

/// Reconstructs submitted agent prompts from raw PTY input bytes.
///
/// The renderer writes what the user typed rather than what the agent's TUI chose to display, so
/// only the input side of a terminal has to be modelled: printable text accumulates, editing keys
/// mutate the buffer, control sequences are skipped, and Enter submits.
#[derive(Debug, Default)]
pub struct AgentTaskCapture {
    line: String,
    /// Trailing bytes of an incomplete UTF-8 character split across two writes.
    partial: Vec<u8>,
    escape: EscapeState,
    /// Parameter bytes of the control sequence currently being consumed.
    sequence: String,
    /// Inside `ESC [200~ … ESC [201~`, where CR/LF are pasted content, not submission.
    bracketed_paste: bool,
}

impl AgentTaskCapture {
    pub fn new() -> Self {
        Self::default()
    }

    /// Feed one write of terminal input. Returns every prompt submitted within this chunk —
    /// normally zero or one, but a scripted write can carry several.
    pub fn feed(&mut self, data: &[u8]) -> Vec<String> {
        let mut submitted = Vec::new();
        // A lone ESC is the cancel key in every supported agent TUI. Longer chunks that start
        // with ESC are arrow keys, function keys, or paste markers, handled by the state machine.
        if data == [0x1b] {
            self.reset();
            return submitted;
        }
        let mut text = std::mem::take(&mut self.partial);
        text.extend_from_slice(data);
        let mut index = 0;
        while index < text.len() {
            let byte = text[index];
            match self.escape {
                EscapeState::Escape => {
                    self.escape = match byte {
                        b'[' => {
                            self.sequence.clear();
                            EscapeState::ControlSequence
                        }
                        b']' => EscapeState::OperatingSystemCommand,
                        b'O' => EscapeState::SingleShift,
                        // `ESC` + Enter is the newline binding in several agent TUIs, and `ESC`
                        // followed by anything else is a meta chord — neither submits.
                        _ => EscapeState::Idle,
                    };
                    index += 1;
                    continue;
                }
                EscapeState::SingleShift => {
                    self.escape = EscapeState::Idle;
                    index += 1;
                    continue;
                }
                EscapeState::OperatingSystemCommand => {
                    if byte == 0x07 || byte == 0x1b {
                        self.escape = EscapeState::Idle;
                    }
                    index += 1;
                    continue;
                }
                EscapeState::ControlSequence => {
                    if (0x40..=0x7e).contains(&byte) {
                        if byte == b'~' {
                            match self.sequence.as_str() {
                                "200" => self.bracketed_paste = true,
                                "201" => self.bracketed_paste = false,
                                _ => {}
                            }
                        }
                        self.escape = EscapeState::Idle;
                        self.sequence.clear();
                    } else {
                        self.sequence.push(byte as char);
                    }
                    index += 1;
                    continue;
                }
                EscapeState::Idle => {}
            }

            match byte {
                0x1b => {
                    self.escape = EscapeState::Escape;
                    index += 1;
                }
                b'\r' | b'\n' => {
                    if self.bracketed_paste {
                        self.push_char('\n');
                    } else if self.line.trim_end().ends_with('\\') {
                        // A trailing backslash asks the agent for a literal newline instead of
                        // submitting, so the same prompt keeps accumulating.
                        while self.line.ends_with([' ', '\t', '\\']) {
                            self.line.pop();
                        }
                        self.push_char('\n');
                    } else if let Some(prompt) = self.take_line() {
                        submitted.push(prompt);
                    }
                    index += 1;
                }
                // Backspace / delete.
                0x08 | 0x7f => {
                    self.line.pop();
                    index += 1;
                }
                // Ctrl+C, Ctrl+D, Ctrl+U, Ctrl+Z: interrupt or kill-line. The pending prompt is
                // gone either way, so no work should be attributed to this Pane.
                0x03 | 0x04 | 0x15 | 0x1a => {
                    self.reset();
                    index += 1;
                }
                // Ctrl+W deletes the previous word.
                0x17 => {
                    while self.line.ends_with(' ') {
                        self.line.pop();
                    }
                    while !self.line.is_empty() && !self.line.ends_with(' ') {
                        self.line.pop();
                    }
                    index += 1;
                }
                // Remaining C0 controls (Tab completion, Ctrl+arrow chords, bell) leave no text.
                0x00..=0x1f => index += 1,
                _ => {
                    let run_end = text[index..]
                        .iter()
                        .position(|candidate| *candidate < 0x20 || *candidate == 0x7f)
                        .map(|offset| index + offset)
                        .unwrap_or(text.len());
                    let run = &text[index..run_end];
                    match std::str::from_utf8(run) {
                        Ok(valid) => self.push_str(valid),
                        Err(error) => {
                            let valid_up_to = error.valid_up_to();
                            if let Ok(valid) = std::str::from_utf8(&run[..valid_up_to]) {
                                self.push_str(valid);
                            }
                            // A character truncated at the very end of this write: hold its bytes
                            // until the rest arrives. Genuinely invalid bytes are dropped.
                            if error.error_len().is_none() && run_end == text.len() {
                                self.partial.extend_from_slice(&run[valid_up_to..]);
                            }
                        }
                    }
                    index = run_end;
                }
            }
        }
        submitted
    }

    /// Discard the pending prompt.
    pub fn reset(&mut self) {
        self.line.clear();
        self.partial.clear();
        self.sequence.clear();
        self.escape = EscapeState::Idle;
        self.bracketed_paste = false;
    }

    fn push_char(&mut self, value: char) {
        if self.line.chars().count() >= MAX_CAPTURE_CHARS {
            return;
        }
        self.line.push(value);
    }

    fn push_str(&mut self, value: &str) {
        for character in value.chars() {
            self.push_char(character);
        }
    }

    fn take_line(&mut self) -> Option<String> {
        let prompt = std::mem::take(&mut self.line);
        let trimmed = prompt.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_owned())
        }
    }
}

/// Compress a submitted prompt into a Pane title, or return `None` when it is not a task.
pub fn derive_task_title(prompt: &str) -> Option<String> {
    let line = first_meaningful_line(prompt)?;
    if !is_task_like(&line) {
        return None;
    }
    let stripped = strip_leading_filler(&line);
    let clause = cut_trailing_clause(stripped);
    let title = build_title(clause)?;
    if title.chars().count() < 3 || is_filler_only(&title) {
        return None;
    }
    Some(title)
}

/// Take the first line carrying real content. A pasted task normally opens with its own summary
/// line, and everything after it is detail no title could hold.
fn first_meaningful_line(prompt: &str) -> Option<String> {
    prompt
        .lines()
        .map(|line| collapse_whitespace(line.trim()))
        .find(|line| line.chars().any(char::is_alphanumeric))
}

fn collapse_whitespace(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut space = false;
    for character in value.chars() {
        if character.is_whitespace() {
            space = !out.is_empty();
        } else {
            if space {
                out.push(' ');
            }
            space = false;
            out.push(character);
        }
    }
    out
}

/// Bare acknowledgements and permission answers, which agents ask for constantly. Renaming a Pane
/// to one of these would destroy the title the previous real task earned.
const NON_TASK_REPLIES: &[&str] = &[
    "y",
    "n",
    "yes",
    "no",
    "yep",
    "yeah",
    "nope",
    "ok",
    "okay",
    "k",
    "sure",
    "go",
    "go ahead",
    "continue",
    "keep going",
    "carry on",
    "proceed",
    "next",
    "done",
    "stop",
    "wait",
    "hold on",
    "exit",
    "quit",
    "clear",
    "undo",
    "retry",
    "try again",
    "again",
    "help",
    "thanks",
    "thank you",
    "ty",
    "nice",
    "nice work",
    "good job",
    "looks good",
    "sounds good",
    "lgtm",
    "perfect",
    "great",
    "please",
    "please continue",
    "approve",
    "approved",
    "deny",
    "reject",
    "accept",
    "cancel",
    "skip",
    "back",
    "resume",
    "run it",
    "do it",
    "same thing",
    "not yet",
    "no problem",
];

fn is_task_like(line: &str) -> bool {
    // Agent slash commands (`/clear`), shell escapes (`!ls`), and memory notes (`#`) instruct the
    // tool; they do not describe work.
    if line.starts_with('/') || line.starts_with('!') || line.starts_with('#') {
        return false;
    }
    let plain = line
        .trim_matches(|character: char| !character.is_alphanumeric())
        .to_lowercase();
    if plain.is_empty() || NON_TASK_REPLIES.contains(&plain.as_str()) {
        return false;
    }
    // Menu selections and numeric answers.
    if plain.chars().all(|character| character.is_ascii_digit()) {
        return false;
    }
    plain.chars().count() >= MIN_TASK_CHARS || plain.split_whitespace().count() >= 2
}

/// Politeness and framing that precede a prompt but describe no work. Ordered longest-first
/// within each family so the fuller phrase wins.
const FILLER_PREFIXES: &[&str] = &[
    "i would like you to",
    "i would like to",
    "i'd like you to",
    "id like you to",
    "i want you to",
    "i need you to",
    "please help me",
    "can you please",
    "could you please",
    "make sure you",
    "make sure to",
    "go ahead and",
    "i'd like to",
    "i would like",
    "i want to",
    "i need to",
    "we need to",
    "you need to",
    "we should",
    "you should",
    "could you",
    "would you",
    "can you",
    "will you",
    "help me",
    "i'd like",
    "let us",
    "let's",
    "lets",
    "try to",
    "please",
    "hello",
    "hey",
    "hi",
    "pls",
    "okay",
    "ok",
    "now",
    "also",
    "then",
    "next",
    "just",
    "quickly",
    "finally",
    "first",
    "so",
    "the",
    "an",
    "a",
];

fn strip_leading_filler(line: &str) -> &str {
    let mut current = line.trim();
    // Repeat so stacked framing ("ok, please can you fix …") is fully removed.
    'outer: for _ in 0..6 {
        for prefix in FILLER_PREFIXES {
            let Some(rest) = strip_word_prefix(current, prefix) else {
                continue;
            };
            let candidate = rest.trim_start_matches([' ', ',', ':', '-']).trim_start();
            // Never strip so far that nothing describing the work is left.
            if candidate.chars().any(char::is_alphanumeric) {
                current = candidate;
                continue 'outer;
            }
        }
        break;
    }
    // "i want you to" style framing can leave a dangling infinitive marker.
    if let Some(rest) = strip_word_prefix(current, "to") {
        let candidate = rest.trim_start();
        if candidate.chars().any(char::is_alphanumeric) {
            current = candidate;
        }
    }
    current
}

/// Strip an ASCII `prefix`, case-insensitively, only when it ends on a word boundary — so
/// "notify" never loses its "no".
fn strip_word_prefix<'a>(text: &'a str, prefix: &str) -> Option<&'a str> {
    let bytes = text.as_bytes();
    if bytes.len() < prefix.len() {
        return None;
    }
    for (index, expected) in prefix.as_bytes().iter().enumerate() {
        if bytes[index].to_ascii_lowercase() != *expected {
            return None;
        }
    }
    // Every matched byte is ASCII, so `prefix.len()` is a valid character boundary.
    let rest = &text[prefix.len()..];
    if ends_word(rest.as_bytes().first().copied()) {
        Some(rest)
    } else {
        None
    }
}

/// A word ends at the end of the text, at whitespace, or at connecting punctuation.
fn ends_word(next: Option<u8>) -> bool {
    match next {
        None => true,
        Some(byte) => byte.is_ascii_whitespace() || matches!(byte, b',' | b':' | b'-'),
    }
}

fn starts_word(previous: Option<u8>) -> bool {
    match previous {
        None => true,
        Some(byte) => byte.is_ascii_whitespace(),
    }
}

/// Connectives that introduce rationale or a follow-up rather than the task itself.
const CLAUSE_BREAKS: &[&str] = &[
    "so that",
    "in order to",
    "and then",
    "because",
    "since",
    "so",
    "but",
    "however",
    "while",
    "whilst",
    "which",
    "instead of",
    "rather than",
];

/// Cut at the first connective, keeping the part that names the work.
fn cut_trailing_clause(line: &str) -> &str {
    let bytes = line.as_bytes();
    let mut cut = line.len();
    for keyword in CLAUSE_BREAKS {
        let needle = keyword.as_bytes();
        if bytes.len() < needle.len() {
            continue;
        }
        for start in 0..=bytes.len() - needle.len() {
            if start >= cut {
                break;
            }
            let matches = needle
                .iter()
                .enumerate()
                .all(|(offset, expected)| bytes[start + offset].to_ascii_lowercase() == *expected);
            if !matches {
                continue;
            }
            let end = start + needle.len();
            if !starts_word(start.checked_sub(1).map(|index| bytes[index]))
                || !ends_word(bytes.get(end).copied())
            {
                continue;
            }
            // Require enough words before the break that what remains still says something.
            if line[..start].split_whitespace().count() >= 3 {
                cut = start;
                break;
            }
        }
    }
    line[..cut].trim_end()
}

/// Articles carry no information in a title, so they are dropped wherever they appear.
const DROPPED_WORDS: &[&str] = &["the", "a", "an"];

/// Trailing words that read as dangling once the title is truncated.
const DANGLING_WORDS: &[&str] = &[
    "to", "of", "in", "on", "at", "for", "with", "and", "or", "from", "into", "by", "as", "is",
    "it", "that", "this", "my", "our", "your", "its",
];

fn build_title(line: &str) -> Option<String> {
    let words: Vec<String> = line
        .split_whitespace()
        .map(clean_word)
        .filter(|word| !word.is_empty() && !DROPPED_WORDS.contains(&word.to_lowercase().as_str()))
        .collect();
    if words.is_empty() {
        return None;
    }
    let mut kept: Vec<String> = Vec::new();
    let mut length = 0usize;
    for word in &words {
        let width = word.chars().count();
        let extra = if kept.is_empty() { width } else { width + 1 };
        if !kept.is_empty() && length + extra > MAX_TITLE_CHARS {
            break;
        }
        kept.push(word.clone());
        length += extra;
    }
    // A single opening word longer than the budget still has to fit the header.
    if kept.len() == 1 && kept[0].chars().count() > MAX_TITLE_CHARS {
        let truncated: String = kept[0].chars().take(MAX_TITLE_CHARS - 1).collect();
        kept[0] = format!("{truncated}…");
    }
    while kept.len() > 1 && DANGLING_WORDS.contains(&kept[kept.len() - 1].to_lowercase().as_str()) {
        kept.pop();
    }
    let mut title = kept.join(" ");
    capitalize_first(&mut title);
    if title.is_empty() {
        None
    } else {
        Some(title)
    }
}

/// A title that survived stripping but says nothing ("Now", "Then") is not worth renaming for.
fn is_filler_only(title: &str) -> bool {
    let lowered = title.to_lowercase();
    title.split_whitespace().count() == 1
        && (FILLER_PREFIXES.contains(&lowered.as_str())
            || DANGLING_WORDS.contains(&lowered.as_str())
            || NON_TASK_REPLIES.contains(&lowered.as_str()))
}

/// Strip decoration a prompt carries but a title should not: markdown emphasis, quotes, and
/// sentence punctuation. Identifiers keep their own characters, so `auth.ts` and `use_state`
/// survive intact.
fn clean_word(word: &str) -> String {
    word.trim_matches([
        '`', '"', '\'', '*', '_', '(', ')', '[', ']', '{', '}', '<', '>',
    ])
    .trim_end_matches(['.', ',', ';', ':', '!', '?'])
    .to_owned()
}

/// Capitalize the opening word unless it carries meaningful case of its own — a path, an
/// identifier, or an acronym must never be rewritten.
fn capitalize_first(title: &mut String) {
    let Some(first) = title.split_whitespace().next() else {
        return;
    };
    let mixed_case = first.chars().any(char::is_uppercase);
    let identifier = first.contains(['/', '\\', '.', '_', '@', '-']);
    if mixed_case || identifier {
        return;
    }
    let mut characters = title.chars();
    if let Some(first) = characters.next() {
        *title = first.to_uppercase().collect::<String>() + characters.as_str();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn type_into(capture: &mut AgentTaskCapture, text: &str) -> Vec<String> {
        capture.feed(text.as_bytes())
    }

    #[test]
    fn enter_submits_the_typed_prompt() {
        let mut capture = AgentTaskCapture::new();
        assert!(type_into(&mut capture, "fix the login bug").is_empty());
        assert_eq!(capture.feed(b"\r"), vec!["fix the login bug"]);
        // The buffer is consumed, so a second Enter submits nothing.
        assert!(capture.feed(b"\r").is_empty());
    }

    #[test]
    fn keystrokes_arrive_one_write_at_a_time() {
        let mut capture = AgentTaskCapture::new();
        for character in "add dark mode".chars() {
            assert!(capture.feed(character.to_string().as_bytes()).is_empty());
        }
        assert_eq!(capture.feed(b"\r"), vec!["add dark mode"]);
    }

    #[test]
    fn backspace_edits_the_pending_prompt() {
        let mut capture = AgentTaskCapture::new();
        type_into(&mut capture, "fix teh\x7f\x7f\x7fthe tests");
        assert_eq!(capture.feed(b"\r"), vec!["fix the tests"]);
    }

    #[test]
    fn control_w_deletes_the_previous_word() {
        let mut capture = AgentTaskCapture::new();
        type_into(&mut capture, "rewrite the parser\x17scheduler");
        assert_eq!(capture.feed(b"\r"), vec!["rewrite the scheduler"]);
    }

    #[test]
    fn control_c_and_escape_discard_the_prompt() {
        let mut capture = AgentTaskCapture::new();
        type_into(&mut capture, "refactor everything");
        type_into(&mut capture, "\x03");
        assert!(capture.feed(b"\r").is_empty());

        type_into(&mut capture, "delete the database");
        capture.feed(&[0x1b]);
        assert!(capture.feed(b"\r").is_empty());
    }

    #[test]
    fn arrow_keys_do_not_become_text() {
        let mut capture = AgentTaskCapture::new();
        type_into(&mut capture, "\x1b[A\x1b[Bwrite the migration\x1b[D\x1b[C");
        assert_eq!(capture.feed(b"\r"), vec!["write the migration"]);
    }

    #[test]
    fn bracketed_paste_newlines_do_not_submit() {
        let mut capture = AgentTaskCapture::new();
        type_into(
            &mut capture,
            "\x1b[200~migrate the settings store\nkeep the old keys\x1b[201~",
        );
        assert_eq!(
            capture.feed(b"\r"),
            vec!["migrate the settings store\nkeep the old keys"]
        );
    }

    #[test]
    fn a_trailing_backslash_continues_the_prompt() {
        let mut capture = AgentTaskCapture::new();
        type_into(&mut capture, "update the changelog \\");
        assert!(capture.feed(b"\r").is_empty());
        type_into(&mut capture, "for the release");
        assert_eq!(
            capture.feed(b"\r"),
            vec!["update the changelog\nfor the release"]
        );
    }

    #[test]
    fn multibyte_characters_split_across_writes_are_rejoined() {
        let mut capture = AgentTaskCapture::new();
        let text = "corrige la función".as_bytes();
        let split = text.len() - 1;
        capture.feed(&text[..split]);
        capture.feed(&text[split..]);
        assert_eq!(capture.feed(b"\r"), vec!["corrige la función"]);
    }

    #[test]
    fn a_single_write_can_carry_several_prompts() {
        let mut capture = AgentTaskCapture::new();
        assert_eq!(
            capture.feed(b"first task here\rsecond task here\r"),
            vec!["first task here", "second task here"]
        );
    }

    #[test]
    fn capture_is_bounded() {
        let mut capture = AgentTaskCapture::new();
        capture.feed("x".repeat(MAX_CAPTURE_CHARS * 2).as_bytes());
        let submitted = capture.feed(b"\r");
        assert_eq!(submitted[0].chars().count(), MAX_CAPTURE_CHARS);
    }

    #[test]
    fn titles_describe_the_task() {
        let cases = [
            ("fix the login bug in auth.ts", "Fix login bug in auth.ts"),
            (
                "please add a dark mode toggle to the settings page",
                "Add dark mode toggle to settings",
            ),
            (
                "can you refactor the terminal manager so it uses a channel?",
                "Refactor terminal manager",
            ),
            (
                "write tests for the swarm scheduler",
                "Write tests for swarm scheduler",
            ),
            (
                "i need you to investigate the browser freeze",
                "Investigate browser freeze",
            ),
            (
                "update `src/theme/tokens.ts` with the new palette",
                "Update src/theme/tokens.ts",
            ),
            (
                "why does the updater fail on restart because of signing",
                "Why does updater fail on restart",
            ),
            ("fix bug", "Fix bug"),
        ];
        for (prompt, expected) in cases {
            assert_eq!(
                derive_task_title(prompt).as_deref(),
                Some(expected),
                "prompt: {prompt}"
            );
        }
    }

    #[test]
    fn titles_never_exceed_the_header_budget() {
        for prompt in [
            "implement a completely new orchestration pipeline for every registered provider",
            "documentthecompleteinternalreleasepipelineendtoendwithoutanyspaces at all",
        ] {
            let title = derive_task_title(prompt).expect("title");
            assert!(title.chars().count() <= MAX_TITLE_CHARS, "{title}");
        }
    }

    #[test]
    fn replies_and_commands_do_not_rename_a_pane() {
        for prompt in [
            "y",
            "yes",
            "Yes!",
            "ok",
            "continue",
            "go ahead",
            "2",
            "/clear",
            "/model opus",
            "!ls -la",
            "# remember this",
            "   ",
            "approve",
            "ok now",
            "looks good",
        ] {
            assert_eq!(derive_task_title(prompt), None, "prompt: {prompt}");
        }
    }

    #[test]
    fn identifiers_and_acronyms_keep_their_own_case() {
        assert_eq!(
            derive_task_title("auth.ts needs a null guard").as_deref(),
            Some("auth.ts needs null guard")
        );
        assert_eq!(
            derive_task_title("CI keeps failing on the release job").as_deref(),
            Some("CI keeps failing on release job")
        );
    }

    #[test]
    fn a_pasted_task_uses_its_summary_line() {
        let prompt = "\n\nAdd retry logic to the updater\n\n- exponential backoff\n- cap at 5";
        assert_eq!(
            derive_task_title(prompt).as_deref(),
            Some("Add retry logic to updater")
        );
    }

    #[test]
    fn a_title_never_ends_on_a_dangling_word() {
        let title = derive_task_title("rewrite the export pipeline for the reporting service")
            .expect("title");
        let last = title.split(' ').next_back().expect("word").to_lowercase();
        assert!(!DANGLING_WORDS.contains(&last.as_str()), "{title}");
    }

    #[test]
    fn non_ascii_prompts_are_handled_without_panicking() {
        for prompt in [
            "corrige el error de inicio de sesión",
            "ログインのバグを修正してください",
            "исправь ошибку входа в систему",
        ] {
            let _ = derive_task_title(prompt);
        }
    }
}

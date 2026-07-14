pub const MAX_MEMORY_BYTES: usize = 2 * 1024 * 1024;
pub const CHUNK_CHARS: usize = 2_000;

pub fn bounded_text(bytes: &[u8]) -> Option<String> {
    if bytes.len() > MAX_MEMORY_BYTES {
        return None;
    }
    String::from_utf8(bytes.to_vec()).ok()
}

pub fn summary(body: &str) -> String {
    body.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("Empty note")
        .chars()
        .take(240)
        .collect()
}

pub fn chunks(body: &str) -> Vec<String> {
    if body.is_empty() {
        return vec![String::new()];
    }
    let mut chunks = Vec::new();
    let mut current = String::new();
    for line in body.lines() {
        if !current.is_empty() && current.chars().count() + line.chars().count() + 1 > CHUNK_CHARS {
            chunks.push(std::mem::take(&mut current));
        }
        if !current.is_empty() {
            current.push('\n');
        }
        current.push_str(line);
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunks_are_bounded_without_losing_lines() {
        let input = (0..100)
            .map(|n| format!("line-{n}-{}", "x".repeat(40)))
            .collect::<Vec<_>>()
            .join("\n");
        let output = chunks(&input);
        assert!(output.len() > 1);
        assert_eq!(output.join("\n"), input);
    }
}

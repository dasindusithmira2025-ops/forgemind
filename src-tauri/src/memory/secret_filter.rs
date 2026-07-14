use crate::errors::{AppError, AppResult};

const SECRET_MARKERS: &[&str] = &[
    "-----begin private key-----",
    "-----begin rsa private key-----",
    "-----begin openssh private key-----",
    "aws_secret_access_key",
    "github_token",
    "private_key=",
    "client_secret=",
];

fn assignment_looks_secret(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    [
        "api_key",
        "apikey",
        "access_token",
        "auth_token",
        "password",
        "secret",
    ]
    .iter()
    .any(|key| {
        lower.find(key).is_some_and(|index| {
            let tail = lower[index + key.len()..].trim_start();
            let value = tail.trim_start_matches(['=', ':', ' ', '\'', '"']);
            (tail.starts_with('=') || tail.starts_with(':'))
                && !value.contains(['(', '{', '['])
                && !value.starts_with("env.")
                && value.chars().filter(|value| !value.is_whitespace()).count() >= 8
        })
    })
}

pub fn reject_secrets(content: &str) -> AppResult<()> {
    let lower = content.to_ascii_lowercase();
    if SECRET_MARKERS.iter().any(|marker| lower.contains(marker))
        || content.lines().any(assignment_looks_secret)
    {
        return Err(AppError::new(
            "memory_secret_detected",
            "ForgeMind refused to store content that appears to contain a secret.",
            true,
        )
        .action("Remove credentials or redact the sensitive value, then try again.")
        .layer("memory-secret-filter"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_private_keys_and_token_assignments() {
        assert!(reject_secrets("-----BEGIN PRIVATE KEY-----\nabc").is_err());
        assert!(reject_secrets("API_KEY=abcdefghijklmnop").is_err());
        assert!(reject_secrets("client_secret: long-secret-value").is_err());
    }

    #[test]
    fn ordinary_code_and_prose_pass() {
        reject_secrets("Use the project-scoped Memory API.\nconst secret = readFromVault();")
            .unwrap();
    }
}

use std::{env, fs, path::PathBuf, process::Command};

fn git_output(args: &[&str]) -> Option<String> {
    Command::new("git")
        .args(args)
        .current_dir("..")
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn env_or(name: &str, fallback: impl FnOnce() -> String) -> String {
    env::var(name)
        .ok()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(fallback)
}

fn main() {
    for name in [
        "PARALITH_EDITION",
        "PARALITH_RELEASE_CHANNEL",
        "PARALITH_GIT_COMMIT",
        "PARALITH_BUILD_TIMESTAMP",
        "PARALITH_UPDATE_ENDPOINT",
        "PARALITH_APP_IDENTIFIER",
        "PARALITH_UPDATER_PUBLIC_KEY",
    ] {
        println!("cargo:rerun-if-env-changed={name}");
    }
    println!("cargo:rerun-if-changed=../release/updater.pubkey");
    println!("cargo:rerun-if-changed=../release/updater.stable.pubkey");
    println!("cargo:rerun-if-changed=../release/generated/current-release.json");
    println!("cargo:rerun-if-changed=../release/version.json");

    let edition = env_or("PARALITH_EDITION", || "stable".into());
    let channel = env_or("PARALITH_RELEASE_CHANNEL", || edition.clone());
    let commit = env_or("PARALITH_GIT_COMMIT", || {
        git_output(&["rev-parse", "HEAD"]).unwrap_or_else(|| "unknown".into())
    });
    let timestamp = env_or("PARALITH_BUILD_TIMESTAMP", || {
        git_output(&["show", "-s", "--format=%cI", "HEAD"]).unwrap_or_else(|| "unknown".into())
    });
    let endpoint = env_or("PARALITH_UPDATE_ENDPOINT", || {
        format!("https://updates.invalid/paralith/{channel}/latest.json")
    });
    let identifier = env_or("PARALITH_APP_IDENTIFIER", || {
        if edition == "preview" {
            "com.corelith.paralith.preview".into()
        } else {
            "com.corelith.paralith".into()
        }
    });
    let expected_identifier = if edition == "preview" {
        "com.corelith.paralith.preview"
    } else {
        "com.corelith.paralith"
    };
    if identifier != expected_identifier {
        panic!("PARALITH {edition} must use identifier {expected_identifier}, not {identifier}");
    }
    if channel != edition {
        panic!("PARALITH {edition} must use its isolated {edition} update channel");
    }
    let public_key = env::var("PARALITH_UPDATER_PUBLIC_KEY")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            let file = if edition == "stable" {
                "updater.stable.pubkey"
            } else {
                "updater.pubkey"
            };
            fs::read_to_string(PathBuf::from("..").join("release").join(file)).unwrap_or_default()
        })
        .trim()
        .to_owned();
    let target = env::var("TARGET").unwrap_or_else(|_| "unknown".into());

    for (name, value) in [
        ("PARALITH_BUILD_EDITION", edition),
        ("PARALITH_BUILD_CHANNEL", channel),
        ("PARALITH_BUILD_COMMIT", commit),
        ("PARALITH_BUILD_TIMESTAMP_VALUE", timestamp),
        ("PARALITH_BUILD_UPDATE_ENDPOINT", endpoint),
        ("PARALITH_BUILD_IDENTIFIER", identifier),
        ("PARALITH_BUILD_PUBLIC_KEY", public_key),
        ("PARALITH_BUILD_TARGET", target),
    ] {
        println!("cargo:rustc-env={name}={value}");
    }

    tauri_build::build()
}

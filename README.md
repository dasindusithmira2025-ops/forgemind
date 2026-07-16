# PARALITH

PARALITH is a native multi-agent terminal workspace built with Tauri 2, Rust, React, TypeScript, SQLite, portable-pty, and xterm.js.

The durable product model, runtime boundaries, restoration policy, and persistence rules are documented in [Architecture](docs/ARCHITECTURE.md). The refactor baseline and decisions are recorded in [Engineering Audit](docs/ENGINEERING_AUDIT.md).

## Development

```powershell
npm install
npm run tauri dev
```

## Validation

```powershell
npm run typecheck
npm run lint
npm test
npm run build

Set-Location src-tauri
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
Set-Location ..

npm run tauri build
```

The Windows test manifest configuration in `.cargo/config.toml` ensures Rust test binaries load Common Controls v6, which Tauri's Windows runtime requires.

## Runtime ownership

Rust owns PTY handles, child processes, per-session bounded output pipelines, resize, termination, executable detection, path validation, restoration scheduling, and SQLite persistence. The React renderer renders terminals and recursive layouts through typed Tauri commands/events and a session-local external store. Inactive Workspace processes follow the saved setting; xterm canvases are hibernated when hidden. Saved Workspaces restore configuration after application restart and never claim that an old OS process survived exit.

## Diagnostics

PARALITH writes a rotating log (`paralith.log`, capped at 5 MB) to the edition-specific platform log directory in every build, so failures are diagnosable from a packaged install:

- Windows Stable: `%APPDATA%\com.corelith.paralith\logs\`
- Windows Preview: `%APPDATA%\com.corelith.paralith.preview\logs\`

If startup fails (for example, the application data directory or SQLite database cannot be opened), the app shows a native error dialog explaining the cause instead of exiting silently. The renderer is wrapped in an error boundary that offers a reload path if the interface hits an unexpected error.
# Internal Windows distribution

PARALITH has separate Stable and Preview Windows editions, protected GitHub validation/release workflows, signed in-app updates through a company-controlled endpoint, pre-migration backups, post-update health confirmation, and Safe Recovery. Administrator setup and release policy are documented in [docs/INTERNAL_RELEASES.md](docs/INTERNAL_RELEASES.md); the end-to-end recovery test is in [docs/UPDATE_RECOVERY.md](docs/UPDATE_RECOVERY.md).

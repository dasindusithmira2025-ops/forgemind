# PARALITH

PARALITH is a native multi-agent terminal workspace built with Tauri 2, Rust, React, TypeScript, SQLite, portable-pty, and xterm.js.

The durable product model, runtime boundaries, restoration policy, and persistence rules are documented in [Architecture](docs/ARCHITECTURE.md). The refactor baseline and decisions are recorded in [Engineering Audit](docs/ENGINEERING_AUDIT.md).

## Repository layout

PARALITH is an independent package inside the Corelith monorepo. Its frontend, Rust crate,
assets, product documentation, release metadata, and release tooling all live in this directory.
The sibling [`corelith-web`](../corelith-web/README.md) package has its own dependency graph and
lockfile. Commands in this document run from `Paralith-tauri`.

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

The Windows test manifest configuration in `.cargo/config.toml` ensures Rust test binaries load Common Controls v6, which Tauri's Windows runtime requires. Package validation is defined by the repository-level [desktop workflow](../.github/workflows/ci.yml).

## Runtime ownership

Rust owns PTY handles, child processes, per-session bounded output pipelines, resize, termination, executable detection, path validation, restoration scheduling, and SQLite persistence. The React renderer renders terminals and recursive layouts through typed Tauri commands/events and a session-local external store. Inactive Workspace processes follow the saved setting; xterm canvases are hibernated when hidden. Saved Workspaces restore configuration after application restart and never claim that an old OS process survived exit.

## Terminal branches

Each terminal menu can assign an existing local or GitHub remote branch without moving the shared Project checkout or sibling terminals. PARALITH stops only that terminal, attaches the branch to a managed Git worktree, preserves its Project-relative directory when the selected revision contains it, and restarts the terminal there. A branch already owned by another checkout is unavailable, and a terminal with uncommitted worktree changes must commit or stash before changing branches. Selecting the shared Project branch returns the terminal to the unchanged Project checkout.

## Diagnostics

PARALITH writes a rotating log (`paralith.log`, capped at 5 MB) to the edition-specific platform log directory in every build, so failures are diagnosable from a packaged install:

- Windows Stable: `%APPDATA%\com.corelith.paralith\logs\`
- Windows Preview: `%APPDATA%\com.corelith.paralith.preview\logs\`

If startup fails (for example, the application data directory or SQLite database cannot be opened), the app shows a native error dialog explaining the cause instead of exiting silently. The renderer is wrapped in an error boundary that offers a reload path if the interface hits an unexpected error.
# Stable Windows distribution

PARALITH ships through one manually confirmed Stable workflow. It validates tagged `main` source, builds signed Windows updater artifacts, atomically activates a 100% Stable manifest, and verifies the public checksums and live endpoint before reporting success. Administrator setup and release policy are documented in [docs/INTERNAL_RELEASES.md](docs/INTERNAL_RELEASES.md); the end-to-end recovery test is in [docs/UPDATE_RECOVERY.md](docs/UPDATE_RECOVERY.md).

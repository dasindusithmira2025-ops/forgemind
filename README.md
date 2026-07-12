# ForgeMind

ForgeMind is a native multi-agent terminal workspace built with Tauri 2, Rust, React, TypeScript, SQLite, portable-pty, and xterm.js.

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

Rust owns PTY handles, child processes, input, output, resize, termination, executable detection, path validation, and SQLite persistence. The React renderer renders terminals and layouts through typed Tauri commands and events. Saved workspaces restore configuration; they do not claim that terminal processes survive application exit.

## Diagnostics

ForgeMind writes a rotating log (`forgemind.log`, capped at 5 MB) to the platform log directory in every build, so failures are diagnosable from a packaged install:

- Windows: `%APPDATA%\com.forgemind.workspace\logs\`
- macOS: `~/Library/Logs/com.forgemind.workspace/`
- Linux: `~/.local/share/com.forgemind.workspace/logs/`

If startup fails (for example, the application data directory or SQLite database cannot be opened), the app shows a native error dialog explaining the cause instead of exiting silently. The renderer is wrapped in an error boundary that offers a reload path if the interface hits an unexpected error.

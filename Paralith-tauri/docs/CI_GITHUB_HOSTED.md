# PARALITH GitHub-hosted CI

PARALITH workflows use GitHub-managed ephemeral runners. No repository workflow targets a
self-hosted runner or depends on persistent workspace state.

## Runner allocation

| Workflow | Runner | Reason |
|---|---|---|
| `Validate` | `windows-latest` | Compiles the native Windows Tauri application on pull requests. |
| `Release Stable` | `windows-latest` | Builds the Windows MSI, NSIS package, and updater artifacts. |
| `Validate website` | `ubuntu-latest` | Runs the independent Next.js lint and production build gates. |
| `Validate product film` | `ubuntu-latest` | Runs the Remotion type, registry, and poster-render smoke gates. |

Every job starts from a clean checkout, uses Node 24.12.0 through the pinned official setup action, and
installs exactly from its package lockfile. Node's download cache is keyed by that lockfile. The
desktop workflows also cache Cargo registry and Git sources, but never cache Cargo target output:
target metadata embeds workspace paths and the directory is too large for a shared Actions cache.

Superseded validation runs are cancelled per ref. Stable publication uses one non-cancelling global
concurrency group so a second release waits instead of interrupting manifest activation.

## Security boundaries

Validation jobs have read-only repository permissions and persist no checkout credentials. Stable
publication alone receives `contents: write`, and only inside the `stable-release` environment. Its
signing and artifact-repository credentials are environment secrets and are removed from the job
workspace after publication. GitHub discards the hosted virtual machine when a job finishes.

Third-party workflow dependencies are avoided. Official checkout, Node setup, cache, and artifact
actions are pinned to full commit SHAs. Rust is configured through the `rustup` already supplied by
the GitHub Windows image.

## Local equivalent

From `Paralith-tauri` on Windows:

```powershell
npm ci
pwsh -NoProfile -File scripts/ci/run-checks.ps1 -IncludeTauriCompile
```

The Stable workflow adds release metadata validation, signed packaging, artifact verification,
public publication, and live updater-manifest verification. See [INTERNAL_RELEASES.md](INTERNAL_RELEASES.md).

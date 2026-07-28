# Paralith CI — self-hosted Windows runner

Operational reference for the machine that now runs every Paralith GitHub Actions job.

## Why this exists

GitHub-hosted jobs on this account are refused **before a runner is assigned**:

> The job was not started because recent account payments have failed or your spending limit
> needs to be increased.

This is an account-level scheduler refusal, not a workflow defect. It applies to
`ubuntu-latest` exactly as much as to `windows-latest` — run
[`30331914399`](https://github.com/dasindusithmira2025-ops/forgemind/actions/runs/30331914399)
targeted `ubuntu-latest` and still executed **zero steps**. Moving jobs between hosted runner
images therefore cannot fix it.

Self-hosted runners are not billed by GitHub for Actions minutes, on private repositories
included. Every workflow now runs on this PC.

## Runner facts

| Item | Value |
|---|---|
| Install directory | `C:\actions-runner\paralith` |
| Work directory | `E:\actions-runner\_work` |
| Runner name | `paralith-windows-release` |
| Labels | `self-hosted`, `Windows`, `X64`, `paralith`, `paralith-windows`, `paralith-release` |
| Scope | Repository-only — `dasindusithmira2025-ops/forgemind` |
| Auto-start | Scheduled task `GitHubActionsRunner-paralith`, at logon, **non-elevated** |
| Runner version | 2.336.0 |

The work directory deliberately sits on `E:`. Paralith's Rust target directory alone reaches
about **75 GB**, and `C:` has well under that free.

### Why a scheduled task and not a Windows service

The brief asked for a Windows service. A service was **not** used, for two concrete reasons:

1. Installing a service that runs as this user requires the account's Windows password, which
   automation cannot supply.
2. Service processes get an unfiltered token. Because this account is a local Administrator,
   a service would run every CI job **elevated**. The scheduled task runs with the normal
   filtered, non-administrator token, so jobs cannot modify system state.

The trade-off: the runner starts at **logon**, not at boot, and stops when the user signs out.
Jobs simply queue until then (see *When the PC is offline*).

To switch to a real service later, run this in an **elevated** PowerShell and supply the
password interactively:

```powershell
cd C:\actions-runner\paralith
$t = gh api -X POST repos/dasindusithmira2025-ops/forgemind/actions/runners/remove-token --jq .token
.\config.cmd remove --token $t
$r = gh api -X POST repos/dasindusithmira2025-ops/forgemind/actions/runners/registration-token --jq .token
.\config.cmd --unattended --url https://github.com/dasindusithmira2025-ops/forgemind `
  --token $r --name paralith-windows-release `
  --labels paralith,paralith-windows,paralith-release `
  --work E:\actions-runner\_work --runasservice
```

Then remove the scheduled task so the two do not both run:
`Unregister-ScheduledTask -TaskName GitHubActionsRunner-paralith -Confirm:$false`

## Checking status

**In GitHub:** Settings → Actions → Runners, or:

```powershell
gh api repos/dasindusithmira2025-ops/forgemind/actions/runners `
  --jq '.runners[] | {name, status, busy, labels: [.labels[].name]}'
```

`status` must be `online`. `busy: true` means a job is executing.

**Locally:**

```powershell
Get-ScheduledTask -TaskName GitHubActionsRunner-paralith    # State should be Ready or Running
Get-Process Runner.Listener -ErrorAction SilentlyContinue   # present => listening
```

## Start / stop / restart

```powershell
# Start
Start-ScheduledTask -TaskName GitHubActionsRunner-paralith

# Stop (also kills any job in flight)
Stop-ScheduledTask -TaskName GitHubActionsRunner-paralith
Get-Process Runner.Listener, Runner.Worker -ErrorAction SilentlyContinue | Stop-Process -Force

# Restart
Stop-ScheduledTask  -TaskName GitHubActionsRunner-paralith
Start-ScheduledTask -TaskName GitHubActionsRunner-paralith
```

Run it in the foreground instead, to watch it live:

```powershell
cd C:\actions-runner\paralith
.\run.cmd
```

## Logs

| What | Where |
|---|---|
| Listener / worker diagnostics | `C:\actions-runner\paralith\_diag\` |
| Per-job worker logs | `C:\actions-runner\paralith\_diag\Worker_*.log` |
| Foreground run capture | `C:\actions-runner\paralith\_diag\interactive-run.log` |
| Job workspace | `E:\actions-runner\_work\forgemind\forgemind` |

```powershell
Get-ChildItem C:\actions-runner\paralith\_diag\Worker_*.log |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1 | Get-Content -Tail 100
```

## Updating the runner

The runner self-updates when GitHub requires a newer version. To force it:

```powershell
Stop-ScheduledTask -TaskName GitHubActionsRunner-paralith
# Download the current release, verify its published SHA256, extract over the install dir,
# then start the task again. Never extract an archive whose checksum did not match.
Start-ScheduledTask -TaskName GitHubActionsRunner-paralith
```

## Removing the runner safely

```powershell
Stop-ScheduledTask -TaskName GitHubActionsRunner-paralith
Unregister-ScheduledTask -TaskName GitHubActionsRunner-paralith -Confirm:$false
cd C:\actions-runner\paralith
$t = gh api -X POST repos/dasindusithmira2025-ops/forgemind/actions/runners/remove-token --jq .token
.\config.cmd remove --token $t
```

Then delete `C:\actions-runner\paralith` and `E:\actions-runner\_work` if the machine is being
retired. **With no runner registered, every workflow queues indefinitely** — hosted runners are
still refused by billing.

## Rotating the registration

Registration tokens are short-lived (about one hour) and single-use. They are never committed,
never written into repository files, and never printed. Always mint one at the moment of use:

```powershell
gh api -X POST repos/dasindusithmira2025-ops/forgemind/actions/runners/registration-token --jq .token
```

To rotate, remove the runner (above) and register again. The runner's own credentials live in
`C:\actions-runner\paralith\.credentials` — treat that file as a secret and never copy it.

## Required toolchains

Verified by `scripts/ci/check-self-hosted-runner.ps1`, which every build runs before doing work:

| Tool | Verified |
|---|---|
| Node.js | v24.12.0 |
| npm | 11.6.2 |
| Rust / Cargo | 1.96.0 (`x86_64-pc-windows-msvc`) |
| rustfmt / clippy | 1.9.0 / 0.1.96 |
| MSVC | VS 2022 Community, VC x86/x64 tools |
| WebView2 | 150.0.4078.99 |
| WiX (MSI) | cached in `%LOCALAPPDATA%\tauri\WixTools314` |
| NSIS | cached in `%LOCALAPPDATA%\tauri\NSIS` |
| Git / GitHub CLI | 2.55.0 / 2.90.0 |

Run it by hand at any time:

```powershell
pwsh -NoProfile -File scripts/ci/check-self-hosted-runner.ps1              # validation floor: 15 GB
pwsh -NoProfile -File scripts/ci/check-self-hosted-runner.ps1 -ReleaseBuild # release floor: 60 GB
```

It reports `OK` / `WARN` / `FAIL` and exits non-zero on any `FAIL`. For sensitive variables it
prints **presence and length only** — never a value.

## Triggering workflows

```powershell
# Runner diagnostics — fast, builds nothing, publishes nothing
gh workflow run "Runner Diagnostics" --repo dasindusithmira2025-ops/forgemind

# Validate — runs automatically on pull requests and on pushes to main.
# To force it, push a commit to the branch.

# Release Internal — manual only, must be a commit already on main
gh workflow run "Release Internal" --repo dasindusithmira2025-ops/forgemind --ref main

# Watch
gh run list  --repo dasindusithmira2025-ops/forgemind --limit 5
gh run watch <run-id> --repo dasindusithmira2025-ops/forgemind
```

`workflow_dispatch` workflows must exist on `main` before GitHub will offer them.

## When the PC is offline

Queued jobs are **not** lost and **not** redirected to hosted runners. They wait until this PC
is powered on, connected, awake, signed in, and the runner is listening. A job that waits longer
than 24 hours is discarded by GitHub.

There is deliberately no hosted-runner fallback: adding one would reintroduce the billing block
and silently spend money.

Cancel queued work with:

```powershell
gh run cancel <run-id> --repo dasindusithmira2025-ops/forgemind
```

Diagnose a stuck queue by confirming the runner is `online` (above). If it is `offline`, start
the scheduled task.

## Recovering a stale workspace

`actions/checkout` runs with `clean: false` so that `node_modules` and the ~75 GB Rust target
directory survive between jobs. `scripts/ci/prepare-workspace.ps1` then does the precise
cleaning on every run:

- removes all untracked and ignored files **except** `node_modules` and `src-tauri/target`;
- deletes `.artifacts/`, and for releases `src-tauri/target/release/bundle`, so no installer
  from a previous run can ever be published;
- fails the job if `HEAD` is not the commit the event was raised for;
- fails the job if tracked files still differ from that commit after cleaning.

Manual reset — run this **only** in the runner workspace, never in a development clone:

```powershell
cd E:\actions-runner\_work\forgemind\forgemind
pwsh -NoProfile -File scripts/ci/prepare-workspace.ps1 -Force
```

> **Destructive.** The script deletes every untracked and ignored file except `node_modules`
> and `src-tauri/target`. In a working tree that means uncommitted new work. It therefore
> refuses to run outside GitHub Actions unless you pass `-Force`, and exits with code 2.

### Clearing build output safely

```powershell
# Repository-local output only
Remove-Item -Recurse -Force .\.artifacts, .\src-tauri\target\release\bundle -ErrorAction SilentlyContinue

# Full Rust rebuild (slow — reclaims ~75 GB)
Remove-Item -Recurse -Force .\src-tauri\target

# Nuclear: let the runner re-clone from scratch
Stop-ScheduledTask -TaskName GitHubActionsRunner-paralith
Remove-Item -Recurse -Force E:\actions-runner\_work\forgemind
Start-ScheduledTask -TaskName GitHubActionsRunner-paralith
```

Do **not** delete the global `~\.cargo` or npm cache as routine maintenance — they are shared
with normal development and only worth clearing if corruption is actually proven.

### Abandoned build processes

A cancelled job can leave `cargo`, `rustc`, `node`, or a launched Paralith binary holding locks.
Every workflow ends with an `always()` cleanup step running
`scripts/ci/cleanup-runner-processes.ps1`.

That script kills a process **only when its executable path is inside the job workspace**. Your
own editor, your own `npm run dev`, and your installed copy of Paralith are never touched — it
never matches on process name alone.

## Security model

The runner is a personal development PC, so the workflows constrain it deliberately:

- **Repository-scoped.** Registered to `forgemind` only, never to an organisation, so no other
  repository can schedule work here.
- **No fork execution.** `ci.yml` runs only when
  `github.event.pull_request.head.repo.full_name == github.repository`. A fork-originated pull
  request is skipped, never executed. The repository is also private.
- **No `pull_request_target`** anywhere. That trigger would give fork code access to secrets.
- **Specific labels.** Every job requests `[self-hosted, Windows, X64, paralith]` — never a bare
  `self-hosted`, which any future runner would match.
- **Least-privilege tokens.** `ci.yml` and the diagnostic use `contents: read`. Only the release
  workflows take `contents: write`.
- **Pinned actions.** Third-party actions are pinned to immutable commit SHAs.
- **No untrusted interpolation.** PR titles, branch names, and commit messages are never
  expanded into shell commands; values are quoted and passed through environment variables.
- **Non-elevated.** Jobs run with a filtered, non-administrator token.
- **Secrets stay off disk.** The release workflow sweeps `gha-creds-*.json` from `RUNNER_TEMP`
  in an `always()` step. Secrets are consumed as environment variables and never logged.
- **Release gating.** Release Internal refuses to run unless the commit is an ancestor of
  `origin/main`, and fails closed when the signing key is absent.

Note: this GitHub plan does not offer branch protection or rulesets for private repositories
(the API returns *"Upgrade to GitHub Pro"*), so there are no required status checks to preserve.
The pull-request Validate run is the gate by convention, not by enforcement.

## Cost and duplication changes

| Before | Now |
|---|---|
| Three jobs per validation, each with its own checkout and `npm ci`, passing `dist` through an uploaded artifact | One job, one checkout, one install, no artifact round-trip |
| Release workflows called `ci.yml` with `full: true`, compiling the crate, then compiled it again to bundle | Checks run inline once; the real signed bundle build is the compile proof |
| `release-windows.yml` in dispatch mode validated `github.sha` (the dispatched branch) rather than the tag it built | Checks run against the tagged checkout |
| Toolchains re-downloaded every run via `setup-node` / `rust-toolchain` / cache actions | Machine toolchain, verified by preflight; nothing re-downloaded |
| Superseded runs kept going | `cancel-in-progress` on validation |
| Internal releases could queue concurrently | Single repository-wide `release-internal` concurrency group |

Documentation-only changes still skip validation via `paths-ignore`.

## Deferred — external HTTPS hosting

**Not implemented, intentionally out of scope.** Preview updater payloads are still published to
Firebase Hosting exactly as before; this work changed only *where jobs execute*.

Still open, and unchanged by this work:

- the friend's file-hosting server;
- any HTTP/HTTPS update server, S3-compatible storage, or CDN;
- custom update manifests or a redesigned updater;
- migrating away from GitHub Releases.

Known external blocker: the Firebase Hosting deploy for Preview requires the
`corelithwebsite` project on the **Blaze** plan. Spark rejects `.exe`/`.msi` uploads, so the
Firebase publish steps of Release Internal cannot succeed until that upgrade happens. That is a
billing action outside this repository.

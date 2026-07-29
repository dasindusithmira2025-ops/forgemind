<#
.SYNOPSIS
    Brings a persistent self-hosted runner workspace to a known-good state.

.DESCRIPTION
    GitHub-hosted runners are disposable; this one is not. Between jobs the workspace keeps
    whatever the previous run left behind, which creates two distinct hazards:

      1. Stale build output can be mistaken for output of the current commit, so a broken
         build can appear to succeed and a previous run's installer can be published.
      2. Stray untracked source files from an earlier branch can silently change the build.

    `actions/checkout` is therefore run with `clean: false` (a full `git clean -ffdx` would
    delete node_modules and the ~75 GB Rust target directory, discarding the only real
    advantage of a persistent runner). This script does the precise cleaning instead:

      * removes every untracked/ignored file EXCEPT the package dependency/build caches,
      * removes assembled release output and bundle directories outright, so nothing from a
        prior run can ever be republished,
      * confirms the tree really is the commit the workflow was triggered for.

    It never deletes anything outside the repository working directory.

.PARAMETER ExpectedSha
    The commit the workflow intends to build. The script fails if HEAD is anything else.

.PARAMETER ReleaseBuild
    Also clear Paralith-tauri/src-tauri/target/release/bundle, forcing installers to be
    produced fresh.

.PARAMETER Force
    Required to run outside GitHub Actions. This script deletes untracked files, which in a
    development clone means uncommitted new work. The runner workspace
    (E:\actions-runner\_work\forgemind\forgemind) is a separate clone from any working tree,
    so the guard exists purely to stop an accidental run in the latter.
#>
[CmdletBinding()]
param(
    [string]$ExpectedSha,
    [switch]$ReleaseBuild,
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$global:LASTEXITCODE = 0

$repoRoot = (& git rev-parse --show-toplevel 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or -not $repoRoot) { throw 'Not inside a Git repository; refusing to clean anything.' }
$repoRoot = (Resolve-Path -LiteralPath $repoRoot).Path
Write-Host "Workspace: $repoRoot"

# Deleting untracked files is correct on a CI runner and destructive in a working tree, where
# untracked usually means "new work not yet committed". Require an explicit opt-in off-CI.
if ($env:GITHUB_ACTIONS -ne 'true' -and -not $Force) {
    Write-Host ''
    Write-Host 'Refusing to run outside GitHub Actions without -Force.' -ForegroundColor Yellow
    Write-Host 'This deletes every untracked and ignored file except package node_modules and' -ForegroundColor Yellow
    Write-Host 'Paralith-tauri/src-tauri/target, which in a development clone can contain local work.' -ForegroundColor Yellow
    Write-Host "Target that would be cleaned: $repoRoot" -ForegroundColor Yellow
    exit 2
}

# --------------------------------------------------------------------- commit identity
# Validate the exact SHA before doing any work, so a mis-targeted job cannot clean or build.
$head = (& git rev-parse HEAD 2>&1 | Out-String).Trim()
Write-Host "HEAD:      $head"
if ($ExpectedSha) {
    if ($head -ne $ExpectedSha) {
        throw "Workspace is at $head but the workflow expected $ExpectedSha. Refusing to continue."
    }
    Write-Host "Commit SHA matches the triggering event." -ForegroundColor Green
}

# --------------------------------------------------------------------- targeted clean
# Preserve only the caches that are expensive and safe to reuse. Cargo and npm both key on
# content, so reusing them cannot mask a source change; leftover *output* can, and is removed.
# Move the pre-monorepo cache locations once so the structural migration does not discard the
# persistent runner's dependency cache.
$cacheMoves = @(
    @{ From = 'node_modules'; To = 'Paralith-tauri/node_modules' },
    @{ From = 'src-tauri/target'; To = 'Paralith-tauri/src-tauri/target' }
)
foreach ($move in $cacheMoves) {
    $from = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $move.From))
    $to = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $move.To))
    $repoBoundary = $repoRoot.TrimEnd('\') + '\'
    if (-not $from.StartsWith($repoBoundary, [StringComparison]::OrdinalIgnoreCase) -or
        -not $to.StartsWith($repoBoundary, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to migrate a cache outside the repository: $from -> $to"
    }
    if ((Test-Path -LiteralPath $from) -and -not (Test-Path -LiteralPath $to)) {
        $parent = Split-Path -Parent $to
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
        Move-Item -LiteralPath $from -Destination $to
        Write-Host "Migrated persistent cache $($move.From) -> $($move.To)"
    }
}

$preserve = @(
    'Paralith-tauri/node_modules',
    'Paralith-tauri/src-tauri/target',
    'corelith-web/node_modules'
)
$cleanArgs = @('clean', '-ffdx') + ($preserve | ForEach-Object { "--exclude=$_" })

Write-Host ''
Write-Host "git $($cleanArgs -join ' ')"
$removed = & git @cleanArgs 2>&1
if ($LASTEXITCODE -ne 0) { throw "git clean failed: $removed" }
$removedCount = @($removed | Where-Object { $_ -match '\S' }).Count
Write-Host "Removed $removedCount untracked path(s); kept $($preserve -join ', ')."

# --------------------------------------------------------------------- release output
# These directories must never survive between runs: publishing globs them, so a leftover
# installer from an older version could be attached to a new release.
$mustBeEmpty = [System.Collections.Generic.List[string]]::new()
$mustBeEmpty.Add((Join-Path $repoRoot 'Paralith-tauri/.artifacts'))
if ($ReleaseBuild) {
    $mustBeEmpty.Add((Join-Path $repoRoot 'Paralith-tauri/src-tauri/target/release/bundle'))
}

foreach ($path in $mustBeEmpty) {
    # Defence in depth: never delete outside the repository root, whatever was passed in.
    $full = [System.IO.Path]::GetFullPath($path)
    if (-not $full.StartsWith($repoRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to delete '$full': outside the repository root."
    }
    if (Test-Path -LiteralPath $full) {
        Remove-Item -LiteralPath $full -Recurse -Force -ErrorAction Stop
        Write-Host "Cleared $full"
    } else {
        Write-Host "Absent (nothing to clear): $full"
    }
}

# --------------------------------------------------------------------- confirm clean tree
# After cleaning, tracked files must match the commit exactly. Anything else means the
# workspace is compromised and the build would not represent the commit under test.
$dirty = & git status --porcelain 2>&1
$dirtyLines = @($dirty | Where-Object { $_ -match '\S' })
if ($dirtyLines.Count -gt 0) {
    Write-Host 'Workspace still reports modifications after cleaning:' -ForegroundColor Red
    $dirtyLines | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    throw 'Tracked files diverge from the checked-out commit.'
}

Write-Host ''
Write-Host "Workspace prepared at $head" -ForegroundColor Green

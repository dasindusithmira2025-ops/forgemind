<#
.SYNOPSIS
    Terminates build processes abandoned inside the runner workspace.

.DESCRIPTION
    A cancelled or timed-out job can leave cargo, rustc, node or a launched Paralith binary
    running. Those processes hold file locks on the target directory and make the next run
    fail with "Access is denied" or "file is being used by another process".

    SAFETY: this runner is the developer's own PC, which is normally running their editor,
    their own `npm run dev`, and their installed copy of Paralith. This script therefore
    NEVER matches on process name alone. A process is killed only when its executable path
    lives inside the workspace being cleaned. Anything started from Program Files, from the
    user's profile, or from the runner's own tooling is left strictly alone -- including the
    Runner.Worker process that is executing this very step.

.PARAMETER Workspace
    Root directory to scope termination to. Defaults to GITHUB_WORKSPACE, then the repo root.
#>
[CmdletBinding()]
param(
    [string]$Workspace = $env:GITHUB_WORKSPACE
)

Set-StrictMode -Version Latest
# Cleanup runs in an `always()` step; a failure here must not mask the real job result.
$ErrorActionPreference = 'Continue'
$global:LASTEXITCODE = 0

if (-not $Workspace) {
    $Workspace = (& git rev-parse --show-toplevel 2>&1 | Out-String).Trim()
}
if (-not $Workspace -or -not (Test-Path -LiteralPath $Workspace)) {
    Write-Host 'No resolvable workspace; nothing to clean.'
    exit 0
}
$root = (Resolve-Path -LiteralPath $Workspace).Path.TrimEnd('\')
Write-Host "Scanning for build processes under: $root"

# Only these images are ever considered, and even then the path gate below must also pass.
$candidateNames = @(
    'cargo', 'rustc', 'rustup', 'cargo-clippy', 'rustfmt',
    'node', 'npm', 'vite', 'esbuild',
    'paralith', 'paralith-app', 'app', 'tauri-cli',
    'link', 'cl', 'candle', 'light', 'makensis'
)

$killed = 0
$inspected = 0

foreach ($proc in Get-Process -ErrorAction SilentlyContinue) {
    if ($candidateNames -notcontains $proc.ProcessName) { continue }

    # Access to .Path throws for processes we cannot open; treat those as "not ours".
    $path = $null
    try { $path = $proc.Path } catch { $path = $null }
    if (-not $path) { continue }

    $inspected++
    if (-not $path.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) { continue }

    # Never terminate the process tree currently executing this script.
    if ($proc.Id -eq $PID) { continue }

    try {
        Write-Host "  terminating PID $($proc.Id) $($proc.ProcessName) -> $path"
        $proc.Kill()
        if (-not $proc.WaitForExit(15000)) {
            Write-Host "    still alive after 15s; leaving it to the OS" -ForegroundColor Yellow
        }
        $killed++
    } catch {
        Write-Host "    could not terminate PID $($proc.Id): $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

Write-Host "Inspected $inspected candidate process(es) with a readable path; terminated $killed inside the workspace."
exit 0

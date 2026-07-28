<#
.SYNOPSIS
    Removes credential files a job may have left on the persistent runner.

.DESCRIPTION
    `google-github-actions/auth` writes a short-lived service-account credential file and
    normally deletes it in its own post step. That post step does not always run -- a
    hard-cancelled job can skip it -- and this runner keeps its disk between jobs, so a
    backstop is required.

    Observed behaviour: the action writes the file into GITHUB_WORKSPACE, not RUNNER_TEMP, and
    exports its location as GOOGLE_GHA_CREDS_PATH. All three are checked.

    Never reads or prints file contents; only leaf filenames are logged.

    This lives in a script rather than inline YAML because the earlier inline version had a
    silent PowerShell bug: `@($x) | Where-Object {...}` yields a *scalar* when one element
    matches, so a later `+=` performed string concatenation instead of appending to an array,
    and the sweep found nothing. A typed list makes that impossible.

.PARAMETER Directory
    Directories to scan for `gha-creds-*.json`. Defaults to GITHUB_WORKSPACE and RUNNER_TEMP.

.PARAMETER ExplicitPath
    An exact file to remove. Defaults to GOOGLE_GHA_CREDS_PATH.
#>
[CmdletBinding()]
param(
    [string[]]$Directory,
    [string]$ExplicitPath = $env:GOOGLE_GHA_CREDS_PATH
)

Set-StrictMode -Version Latest
# Runs in an always() step; never mask the real job result with a cleanup failure.
$ErrorActionPreference = 'Continue'
$global:LASTEXITCODE = 0

if (-not $Directory -or $Directory.Count -eq 0) {
    $Directory = @($env:GITHUB_WORKSPACE, $env:RUNNER_TEMP)
}

# Strongly typed so Add is always an append, never a string concatenation.
$targets = [System.Collections.Generic.List[string]]::new()

if (-not [string]::IsNullOrWhiteSpace($ExplicitPath)) {
    $targets.Add($ExplicitPath)
}

foreach ($dir in $Directory) {
    if ([string]::IsNullOrWhiteSpace($dir)) { continue }
    if (-not (Test-Path -LiteralPath $dir)) { continue }
    foreach ($f in (Get-ChildItem -LiteralPath $dir -Filter 'gha-creds-*.json' -File -ErrorAction SilentlyContinue)) {
        $targets.Add($f.FullName)
    }
}

$removed = 0
foreach ($path in ($targets | Sort-Object -Unique)) {
    if (-not (Test-Path -LiteralPath $path)) { continue }
    try {
        Remove-Item -LiteralPath $path -Force -ErrorAction Stop
        # Leaf name only. Contents are never read.
        Write-Host "removed $(Split-Path -Leaf $path)"
        $removed++
    } catch {
        Write-Host "could not remove $(Split-Path -Leaf $path): $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

Write-Host "Credential sweep complete; inspected $($targets.Count) candidate path(s), removed $removed file(s)."
exit 0

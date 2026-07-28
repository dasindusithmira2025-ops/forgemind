<#
.SYNOPSIS
    The single definition of Paralith's validation suite.

.DESCRIPTION
    Shared by Validate and by the release workflows so the checks can never drift apart.
    Nothing here is optional or skippable: every step that ran on the GitHub-hosted runners
    still runs. Ordering is load-bearing --

      * `npm run build` must precede any cargo step, because `tauri::generate_context!`
        embeds `frontendDist`; without a real bundle the crate does not compile.
      * the generated-file drift check must run after `release:sync` so an uncommitted
        version bump is caught rather than silently normalised.

.PARAMETER IncludeTauriCompile
    Additionally run a no-bundle Tauri Windows compile. Release workflows leave this off:
    they compile the real signed bundle immediately afterwards, and doing both would compile
    the same crate twice for one commit.

.PARAMETER SummaryTitle
    Heading used for the job-summary table.
#>
[CmdletBinding()]
param(
    [switch]$IncludeTauriCompile,
    [string]$SummaryTitle = 'Validation'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'
$global:LASTEXITCODE = 0

$script:Steps = [System.Collections.Generic.List[object]]::new()

# Runs one check, records its duration, and aborts the suite on first failure. Failing fast
# keeps a broken tree from occupying the single self-hosted runner for a full suite.
function Invoke-Check {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][scriptblock]$Body,
        [string]$WorkingDirectory
    )

    Write-Host ''
    Write-Host "==> $Name" -ForegroundColor Cyan
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $previous = $null
    if ($WorkingDirectory) { $previous = (Get-Location).Path; Set-Location -LiteralPath $WorkingDirectory }
    try {
        & $Body
        $code = $LASTEXITCODE
    } finally {
        if ($previous) { Set-Location -LiteralPath $previous }
    }
    $sw.Stop()
    $elapsed = [math]::Round($sw.Elapsed.TotalSeconds, 1)

    if ($code -ne 0) {
        $script:Steps.Add([pscustomobject]@{ Name = $Name; Status = 'FAIL'; Seconds = $elapsed })
        Write-Host "FAILED: $Name (exit $code after ${elapsed}s)" -ForegroundColor Red
        Write-Summary
        exit $code
    }
    $script:Steps.Add([pscustomobject]@{ Name = $Name; Status = 'PASS'; Seconds = $elapsed })
    Write-Host "ok: $Name (${elapsed}s)" -ForegroundColor Green
}

function Write-Summary {
    if (-not $env:GITHUB_STEP_SUMMARY) { return }
    $icon = @{ PASS = ':white_check_mark:'; FAIL = ':x:' }
    $md = [System.Collections.Generic.List[string]]::new()
    $md.Add("### $SummaryTitle")
    $md.Add('')
    $md.Add(("Commit ``{0}`` on runner ``{1}``" -f $env:GITHUB_SHA, $env:RUNNER_NAME))
    $md.Add('')
    $md.Add('| | Check | Seconds |')
    $md.Add('|---|---|---|')
    foreach ($s in $script:Steps) {
        $md.Add(('| {0} | {1} | {2} |' -f $icon[$s.Status], $s.Name, $s.Seconds))
    }
    $total = [math]::Round((($script:Steps | Measure-Object -Property Seconds -Sum).Sum), 1)
    $md.Add('')
    $md.Add("Total: **${total}s**")
    ($md -join "`n") | Out-File -FilePath $env:GITHUB_STEP_SUMMARY -Append -Encoding utf8
}

# ------------------------------------------------------------------ frontend and metadata
Invoke-Check 'Canonical release metadata' { npm run release:check }
Invoke-Check 'TypeScript'                 { npm run typecheck }
Invoke-Check 'Frontend lint'              { npm run lint }
Invoke-Check 'Frontend tests'             { npm test -- --run }
Invoke-Check 'Production frontend build'  { npm run build }

Invoke-Check 'Generated files and clean diff' {
    npm run release:sync
    if ($LASTEXITCODE -ne 0) { return }
    git diff --exit-code -- package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json release/generated/current-release.json
}

# ------------------------------------------------------------------ rust
Invoke-Check 'Rust formatting' -WorkingDirectory 'src-tauri' { cargo fmt --all -- --check }
Invoke-Check 'Rust clippy'     -WorkingDirectory 'src-tauri' { cargo clippy --all-targets --all-features -- -D warnings }
Invoke-Check 'Rust and migration tests' -WorkingDirectory 'src-tauri' { cargo test --all-targets --all-features }

# ------------------------------------------------------------------ optional compile
if ($IncludeTauriCompile) {
    Invoke-Check 'Tauri Windows compilation' {
        # Mirrors the old hosted job: a stable-edition compile with a deliberately invalid
        # endpoint, proving the Windows cfg arms and WebView2 linkage build. No bundle.
        $env:PARALITH_EDITION = 'stable'
        $env:PARALITH_RELEASE_CHANNEL = 'stable'
        $env:PARALITH_UPDATE_ENDPOINT = 'https://updates.invalid/paralith/stable/latest.json'
        npm run tauri -- build --no-bundle --config src-tauri/tauri.stable.conf.json
    }
}

Write-Summary
Write-Host ''
Write-Host "All checks passed ($($script:Steps.Count) steps)." -ForegroundColor Green
exit 0

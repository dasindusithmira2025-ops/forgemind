<#
.SYNOPSIS
    Preflight verification for the Paralith self-hosted Windows Actions runner.

.DESCRIPTION
    Confirms this machine can actually build and package Paralith before a workflow
    spends time on it. Every check reports OK / WARN / FAIL:

      * FAIL -> the build genuinely cannot succeed; the script exits non-zero.
      * WARN -> degraded but survivable (e.g. a bundler tool Tauri can still download).
      * OK   -> verified present.

    Secret safety: this script never prints the value of a secret. For sensitive
    environment variables it reports presence and length only.

.PARAMETER MinFreeGB
    Minimum free space required on the work and repository drives. Defaults to 15 GB,
    which is enough for validation. Use -ReleaseBuild for the packaging threshold.

.PARAMETER ReleaseBuild
    Apply release-build expectations: a much higher disk floor (Paralith's Rust target
    directory alone reaches ~75 GB) and presence checks for the signing/publish
    configuration that Release Internal requires.

.EXAMPLE
    pwsh -File scripts/ci/check-self-hosted-runner.ps1
.EXAMPLE
    pwsh -File scripts/ci/check-self-hosted-runner.ps1 -ReleaseBuild
#>
[CmdletBinding()]
param(
    [int]$MinFreeGB = 15,
    [switch]$ReleaseBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

# Strict mode treats an unset variable as an error, and $LASTEXITCODE does not exist until
# the first external process runs. Seed it so the first Get-ToolVersion call cannot throw
# and be misreported as a missing tool.
$global:LASTEXITCODE = 0

if ($ReleaseBuild -and -not $PSBoundParameters.ContainsKey('MinFreeGB')) {
    # A full MSI + NSIS release needs room for the Rust target dir, the staged bundle
    # and the assembled artifacts. Anything less than this has failed in practice.
    $MinFreeGB = 60
}

$script:Results = [System.Collections.Generic.List[object]]::new()
$script:Failed = 0

function Add-Result {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][ValidateSet('OK', 'WARN', 'FAIL')][string]$Status,
        [string]$Detail = ''
    )
    $script:Results.Add([pscustomobject]@{ Name = $Name; Status = $Status; Detail = $Detail })
    if ($Status -eq 'FAIL') { $script:Failed++ }

    $colour = switch ($Status) { 'OK' { 'Green' } 'WARN' { 'Yellow' } 'FAIL' { 'Red' } }
    Write-Host ('{0,-6} {1,-26} {2}' -f $Status, $Name, $Detail) -ForegroundColor $colour
}

# Runs a command and captures its first output line. Missing executables must not
# terminate the whole preflight, so failures are converted into a null result.
function Get-ToolVersion {
    param([Parameter(Mandatory)][string]$Exe, [string[]]$Arguments = @('--version'))

    if (-not (Get-Command $Exe -ErrorAction SilentlyContinue)) { return $null }
    try {
        $out = & $Exe @Arguments 2>&1 | Select-Object -First 1
        if ($LASTEXITCODE -ne 0 -and -not $out) { return $null }
        return ($out | Out-String).Trim()
    } catch { return $null }
}

function Test-Tool {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$Exe,
        [string[]]$Arguments = @('--version'),
        [switch]$Optional
    )
    $version = Get-ToolVersion -Exe $Exe -Arguments $Arguments
    if ($version) {
        Add-Result -Name $Name -Status 'OK' -Detail $version
        return $true
    }
    Add-Result -Name $Name -Status ($Optional ? 'WARN' : 'FAIL') -Detail "'$Exe' not found on PATH"
    return $false
}

Write-Host ''
Write-Host 'Paralith self-hosted runner preflight' -ForegroundColor Cyan
Write-Host ('mode: {0}   disk floor: {1} GB' -f ($ReleaseBuild ? 'release' : 'validation'), $MinFreeGB) -ForegroundColor Cyan
Write-Host ('-' * 78)

# ---------------------------------------------------------------------------- platform
$os = Get-CimInstance Win32_OperatingSystem
Add-Result -Name 'Windows version' -Status 'OK' -Detail ('{0} (build {1})' -f $os.Caption.Trim(), $os.BuildNumber)

$arch = $env:PROCESSOR_ARCHITECTURE
if ($arch -eq 'AMD64') {
    Add-Result -Name 'CPU architecture' -Status 'OK' -Detail "$arch ($([Environment]::ProcessorCount) logical cores)"
} else {
    Add-Result -Name 'CPU architecture' -Status 'FAIL' -Detail "$arch is not supported; x64 is required"
}

# ---------------------------------------------------------------------------- disk
# Check every distinct drive the build actually writes to: the runner work folder and
# the checked-out repository. They are deliberately allowed to differ.
$paths = @{}
if ($env:RUNNER_WORKSPACE) { $paths['runner workspace'] = $env:RUNNER_WORKSPACE }
if ($env:GITHUB_WORKSPACE) { $paths['repository'] = $env:GITHUB_WORKSPACE }
if ($paths.Count -eq 0) { $paths['current directory'] = (Get-Location).Path }

foreach ($label in $paths.Keys) {
    $root = try { [System.IO.Path]::GetPathRoot((Resolve-Path -LiteralPath $paths[$label] -ErrorAction Stop).Path) } catch { $null }
    if (-not $root) { Add-Result -Name "Disk ($label)" -Status 'WARN' -Detail "cannot resolve $($paths[$label])"; continue }

    $letter = $root.TrimEnd('\', ':')
    $vol = Get-Volume -DriveLetter $letter -ErrorAction SilentlyContinue
    if (-not $vol) { Add-Result -Name "Disk ($label)" -Status 'WARN' -Detail "cannot query volume $root"; continue }

    $freeGB = [math]::Round($vol.SizeRemaining / 1GB, 1)
    if ($freeGB -lt $MinFreeGB) {
        Add-Result -Name "Disk ($label)" -Status 'FAIL' -Detail "$root has ${freeGB} GB free; ${MinFreeGB} GB required"
    } else {
        Add-Result -Name "Disk ($label)" -Status 'OK' -Detail "$root has ${freeGB} GB free"
    }
}

# ---------------------------------------------------------------------------- toolchain
Test-Tool -Name 'Node.js'        -Exe 'node'  | Out-Null
Test-Tool -Name 'npm'            -Exe 'npm'   | Out-Null
Test-Tool -Name 'Rust (rustc)'   -Exe 'rustc' | Out-Null
Test-Tool -Name 'Cargo'          -Exe 'cargo' | Out-Null
Test-Tool -Name 'rustfmt'        -Exe 'cargo' -Arguments @('fmt', '--version')    | Out-Null
Test-Tool -Name 'clippy'         -Exe 'cargo' -Arguments @('clippy', '--version') | Out-Null
Test-Tool -Name 'Git'            -Exe 'git'   | Out-Null
Test-Tool -Name 'GitHub CLI'     -Exe 'gh'    -Optional | Out-Null

# The MSVC host target is mandatory: Paralith links against the Windows SDK.
$targets = Get-ToolVersion -Exe 'rustup' -Arguments @('target', 'list', '--installed')
if ($null -eq $targets) {
    Add-Result -Name 'rustup targets' -Status 'WARN' -Detail 'rustup not found; cannot enumerate targets'
} else {
    $installed = (& rustup target list --installed 2>&1) -split "`r?`n" | Where-Object { $_ }
    if ($installed -contains 'x86_64-pc-windows-msvc') {
        Add-Result -Name 'rustup targets' -Status 'OK' -Detail 'x86_64-pc-windows-msvc installed'
    } else {
        Add-Result -Name 'rustup targets' -Status 'FAIL' -Detail 'x86_64-pc-windows-msvc is missing'
    }
}

# ---------------------------------------------------------------------------- MSVC
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (Test-Path -LiteralPath $vswhere) {
    $vsPath = & $vswhere -latest -products '*' `
        -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
        -property installationPath 2>&1 | Select-Object -First 1
    if ($vsPath) {
        Add-Result -Name 'MSVC build tools' -Status 'OK' -Detail ($vsPath | Out-String).Trim()
    } else {
        Add-Result -Name 'MSVC build tools' -Status 'FAIL' -Detail 'no VS installation carries the VC x86/x64 tools'
    }
} elseif (Get-Command 'link.exe' -ErrorAction SilentlyContinue) {
    Add-Result -Name 'MSVC build tools' -Status 'OK' -Detail 'link.exe present on PATH'
} else {
    Add-Result -Name 'MSVC build tools' -Status 'FAIL' -Detail 'vswhere.exe and link.exe are both absent'
}

# ---------------------------------------------------------------------------- WebView2
# Tauri needs the Evergreen runtime at run time. Machine-wide installs land under the
# EdgeUpdate client key; the per-user key is a valid fallback.
$webview2Key = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
$webview2 = $null
foreach ($hive in @('HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients',
                    'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients',
                    'HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients')) {
    $key = Join-Path $hive $webview2Key
    if (Test-Path -LiteralPath $key) {
        $pv = (Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue).pv
        if ($pv) { $webview2 = $pv; break }
    }
}
if ($webview2) {
    Add-Result -Name 'WebView2 runtime' -Status 'OK' -Detail $webview2
} else {
    Add-Result -Name 'WebView2 runtime' -Status 'FAIL' -Detail 'Evergreen WebView2 runtime not detected'
}

# ---------------------------------------------------------------------------- Tauri CLI
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$cliManifest = Join-Path $repoRoot 'node_modules\@tauri-apps\cli\package.json'
if (Test-Path -LiteralPath $cliManifest) {
    $cliVersion = (Get-Content -LiteralPath $cliManifest -Raw | ConvertFrom-Json).version
    Add-Result -Name 'Tauri CLI' -Status 'OK' -Detail "@tauri-apps/cli $cliVersion"
} else {
    # Not fatal on its own: `npm ci` installs it. Only a problem if deps were skipped.
    Add-Result -Name 'Tauri CLI' -Status 'WARN' -Detail 'not installed yet (npm ci provides it)'
}

# ---------------------------------------------------------------------------- bundlers
# Tauri downloads WiX and NSIS into its local cache on first use. A cache miss costs a
# download, not a failure, so these are warnings.
$tauriCache = Join-Path $env:LOCALAPPDATA 'tauri'
$bundlers = @(
    @{ Name = 'WiX (MSI)'; Probe = 'WixTools314\candle.exe' }
    @{ Name = 'NSIS';      Probe = 'NSIS\makensis.exe' }
)
foreach ($b in $bundlers) {
    $probe = Join-Path $tauriCache $b.Probe
    if (Test-Path -LiteralPath $probe) {
        Add-Result -Name $b.Name -Status 'OK' -Detail 'cached locally'
    } else {
        Add-Result -Name $b.Name -Status 'WARN' -Detail 'not cached; Tauri will download on first bundle'
    }
}

# ---------------------------------------------------------------------------- secrets
# Presence and length only. Values are never printed, logged, or written to a summary.
if ($ReleaseBuild) {
    $required = @('TAURI_SIGNING_PRIVATE_KEY')
    $optional = @(
        'TAURI_SIGNING_PRIVATE_KEY_PASSWORD'
        'PARALITH_PREVIEW_UPDATE_ENDPOINT'
        'PARALITH_UPDATE_ARTIFACT_BASE_URL'
        'PARALITH_UPDATE_PUBLISH_PROVIDER'
        'FIREBASE_PROJECT_ID'
        'FIREBASE_HOSTING_SITE'
    )
    foreach ($name in $required) {
        $value = [Environment]::GetEnvironmentVariable($name)
        if ([string]::IsNullOrWhiteSpace($value)) {
            Add-Result -Name $name -Status 'FAIL' -Detail 'required for a release build; not set'
        } else {
            Add-Result -Name $name -Status 'OK' -Detail "set ($($value.Length) chars)"
        }
    }
    foreach ($name in $optional) {
        $value = [Environment]::GetEnvironmentVariable($name)
        if ([string]::IsNullOrWhiteSpace($value)) {
            Add-Result -Name $name -Status 'WARN' -Detail 'not set'
        } else {
            Add-Result -Name $name -Status 'OK' -Detail "set ($($value.Length) chars)"
        }
    }
}

# ---------------------------------------------------------------------------- summary
Write-Host ('-' * 78)
# Wrap in @() so a zero-match filter yields an empty array rather than $null, whose
# .Count is unreachable under strict mode.
$ok = @($script:Results | Where-Object Status -eq 'OK').Count
$warn = @($script:Results | Where-Object Status -eq 'WARN').Count
Write-Host ('{0} OK, {1} WARN, {2} FAIL' -f $ok, $warn, $script:Failed)

if ($env:GITHUB_STEP_SUMMARY) {
    $icon = @{ OK = ':white_check_mark:'; WARN = ':warning:'; FAIL = ':x:' }
    $lines = [System.Collections.Generic.List[string]]::new()
    $lines.Add('### Runner preflight')
    $lines.Add('')
    $lines.Add(('Mode: `{0}` &nbsp;&middot;&nbsp; disk floor: **{1} GB** &nbsp;&middot;&nbsp; runner: `{2}`' -f `
        ($ReleaseBuild ? 'release' : 'validation'), $MinFreeGB, $env:RUNNER_NAME))
    $lines.Add('')
    $lines.Add('| | Check | Detail |')
    $lines.Add('|---|---|---|')
    foreach ($r in $script:Results) {
        # Escape pipes so a version string can never break the table.
        $detail = ($r.Detail -replace '\|', '\|')
        $lines.Add(('| {0} | {1} | {2} |' -f $icon[$r.Status], $r.Name, $detail))
    }
    $lines.Add('')
    $lines.Add(('**{0} OK, {1} WARN, {2} FAIL**' -f $ok, $warn, $script:Failed))
    $lines -join "`n" | Out-File -FilePath $env:GITHUB_STEP_SUMMARY -Append -Encoding utf8
}

if ($script:Failed -gt 0) {
    Write-Host "Preflight failed: $($script:Failed) blocking problem(s)." -ForegroundColor Red
    exit 1
}
Write-Host 'Preflight passed.' -ForegroundColor Green
exit 0

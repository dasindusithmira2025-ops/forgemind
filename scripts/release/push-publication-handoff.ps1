param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('preview', 'stable')]
  [string]$Channel,

  [Parameter(Mandatory = $true)]
  [string]$Tag,

  [Parameter(Mandatory = $true)]
  [string]$SourceDirectory,

  [Parameter(Mandatory = $true)]
  [string]$Version
)

$ErrorActionPreference = 'Stop'

if (-not $env:PARALITH_UPDATES_REPOSITORY) {
  throw 'PARALITH_UPDATES_REPOSITORY is required.'
}
if (-not $env:PARALITH_UPDATES_DEPLOY_KEY) {
  throw 'PARALITH_UPDATES_DEPLOY_KEY is required.'
}
if ($Tag -notmatch '^[A-Za-z0-9._-]+$') {
  throw "Release tag '$Tag' is unsafe for a publication handoff path."
}

$runnerTemp = [System.IO.Path]::GetFullPath($env:RUNNER_TEMP)
$handoffRoot = Join-Path $runnerTemp "paralith-update-handoff-$([guid]::NewGuid().ToString('N'))"
$keyPath = Join-Path $handoffRoot 'deploy-key'
$clonePath = Join-Path $handoffRoot 'repository'
$account = $null

try {
  New-Item -ItemType Directory -Path $handoffRoot | Out-Null
  # GitHub preserves multiline secrets, but the Windows environment and PowerShell native pipeline
  # can introduce CRLF or a BOM. OpenSSH's libcrypto loader rejects that representation.
  $normalizedKey = ($env:PARALITH_UPDATES_DEPLOY_KEY -replace "`r`n", "`n").TrimEnd() + "`n"
  [System.IO.File]::WriteAllText($keyPath, $normalizedKey, [System.Text.UTF8Encoding]::new($false))

  if ($IsWindows) {
    $account = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    & icacls.exe $keyPath /inheritance:r /grant:r "${account}:(R)" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Failed to restrict the updater deploy-key file ACL.' }
  } else {
    & chmod 600 $keyPath
  }

  $env:GIT_SSH_COMMAND = "ssh -i `"$keyPath`" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
  git clone --depth 1 "git@github.com:$($env:PARALITH_UPDATES_REPOSITORY).git" $clonePath
  if ($LASTEXITCODE -ne 0) { throw 'Failed to clone the public update repository with its deploy key.' }

  $destination = Join-Path $clonePath (Join-Path 'incoming' $Tag)
  node scripts/release/github-artifacts-publisher.mjs stage $Channel $Tag $SourceDirectory $Version $destination
  if ($LASTEXITCODE -ne 0) { throw 'Failed to validate and stage the public update publication handoff.' }

  Push-Location $clonePath
  try {
    git config user.name 'paralith-release-bot'
    git config user.email 'paralith-release-bot@users.noreply.github.com'
    git add -- "incoming/$Tag"
    git commit -m "release($Channel): stage PARALITH $Version"
    if ($LASTEXITCODE -ne 0) { throw 'Failed to commit the public update publication handoff.' }
    git push origin HEAD:main
    if ($LASTEXITCODE -ne 0) { throw 'Failed to push the public update publication handoff.' }
  } finally {
    Pop-Location
  }

  node scripts/release/github-artifacts-publisher.mjs verify $Channel $Version
  if ($LASTEXITCODE -ne 0) { throw 'The public update repository did not activate and verify the staged release.' }
} finally {
  Remove-Item Env:\GIT_SSH_COMMAND -ErrorAction SilentlyContinue
  Remove-Item Env:\PARALITH_UPDATES_DEPLOY_KEY -ErrorAction SilentlyContinue
  $resolvedHandoff = [System.IO.Path]::GetFullPath($handoffRoot)
  if ($resolvedHandoff.StartsWith($runnerTemp, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedHandoff)) {
    if ($IsWindows -and $account -and (Test-Path -LiteralPath $keyPath)) {
      & icacls.exe $keyPath /grant:r "${account}:(F)" | Out-Null
    }
    Remove-Item -LiteralPath $resolvedHandoff -Recurse -Force
  }
}

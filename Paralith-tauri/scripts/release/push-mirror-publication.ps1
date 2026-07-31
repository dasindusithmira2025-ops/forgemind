param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('preview', 'stable')]
  [string]$Channel,

  [Parameter(Mandatory = $true)]
  [string]$Tag,

  [Parameter(Mandatory = $true)]
  [string]$SourceDirectory
)

# Uploads a published release to the partner-hosted mirror over SFTP.
#
# The mirror is a push target, so this step decides what installed clients will download. It gets
# the same handling as the updater deploy key: the private key never leaves RUNNER_TEMP, is ACL'd to
# the runner account, and is deleted in a finally block even when the upload fails. The mirror host
# key is pinned rather than accepted on first use -- trust-on-first-use would let anything that
# answers the address receive the release and report success.
#
# Ordering and atomicity live in mirror-publisher.mjs, which generates the sftp batch. `sftp -b`
# aborts on the first failing command, so a partial upload can never reach the rename that
# activates the manifest.

$ErrorActionPreference = 'Stop'

if (-not $env:PARALITH_MIRROR_SSH_KEY) { throw 'PARALITH_MIRROR_SSH_KEY is required.' }
if (-not $env:PARALITH_MIRROR_SSH_HOST_KEY) { throw 'PARALITH_MIRROR_SSH_HOST_KEY is required.' }
if (-not $env:PARALITH_MIRROR_SSH_HOST) { throw 'PARALITH_MIRROR_SSH_HOST is required.' }
if (-not $env:PARALITH_MIRROR_SSH_USER) { throw 'PARALITH_MIRROR_SSH_USER is required.' }
if ($Tag -notmatch '^[A-Za-z0-9._-]+$') { throw "Release tag '$Tag' is unsafe for a mirror publication path." }

$port = if ($env:PARALITH_MIRROR_SSH_PORT) { $env:PARALITH_MIRROR_SSH_PORT } else { '22' }
if ($port -notmatch '^\d+$') { throw 'PARALITH_MIRROR_SSH_PORT must be numeric.' }

$runnerTemp = [System.IO.Path]::GetFullPath($env:RUNNER_TEMP)
$mirrorRoot = Join-Path $runnerTemp "paralith-mirror-$([guid]::NewGuid().ToString('N'))"
$keyPath = Join-Path $mirrorRoot 'mirror-key'
$knownHostsPath = Join-Path $mirrorRoot 'known_hosts'
$batchPath = Join-Path $mirrorRoot 'upload.sftp'
$account = $null

try {
  New-Item -ItemType Directory -Path $mirrorRoot | Out-Null

  # OpenSSH rejects a key carrying CRLF or a BOM, which the Windows environment can introduce.
  $normalizedKey = ($env:PARALITH_MIRROR_SSH_KEY -replace "`r`n", "`n").TrimEnd() + "`n"
  [System.IO.File]::WriteAllText($keyPath, $normalizedKey, [System.Text.UTF8Encoding]::new($false))
  $normalizedHostKey = ($env:PARALITH_MIRROR_SSH_HOST_KEY -replace "`r`n", "`n").TrimEnd() + "`n"
  [System.IO.File]::WriteAllText($knownHostsPath, $normalizedHostKey, [System.Text.UTF8Encoding]::new($false))

  if ($IsWindows) {
    $account = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    & icacls.exe $keyPath /inheritance:r /grant:r "${account}:(R)" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Failed to restrict the mirror key file ACL.' }
  } else {
    & chmod 600 $keyPath
  }

  node scripts/release/mirror-publisher.mjs plan $Channel $Tag $SourceDirectory $batchPath
  if ($LASTEXITCODE -ne 0) { throw 'Failed to plan the mirror publication.' }

  & sftp.exe -b $batchPath -i $keyPath -P $port `
    -o IdentitiesOnly=yes `
    -o StrictHostKeyChecking=yes `
    -o "UserKnownHostsFile=$knownHostsPath" `
    -o BatchMode=yes `
    "$($env:PARALITH_MIRROR_SSH_USER)@$($env:PARALITH_MIRROR_SSH_HOST)"
  if ($LASTEXITCODE -ne 0) { throw 'The mirror upload failed; the channel manifest was not activated on the mirror.' }

  Write-Host "Published $Channel $Tag to the mirror."
} finally {
  Remove-Item Env:\PARALITH_MIRROR_SSH_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:\PARALITH_MIRROR_SSH_HOST_KEY -ErrorAction SilentlyContinue
  $resolvedMirror = [System.IO.Path]::GetFullPath($mirrorRoot)
  if ($resolvedMirror.StartsWith($runnerTemp, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedMirror)) {
    if ($IsWindows -and $account -and (Test-Path -LiteralPath $keyPath)) {
      & icacls.exe $keyPath /grant:r "${account}:(F)" | Out-Null
    }
    Remove-Item -LiteralPath $resolvedMirror -Recurse -Force
  }
}

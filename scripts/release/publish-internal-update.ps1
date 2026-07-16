param(
  [ValidateSet('filesystem','s3','ssh','http')][string]$Provider = $env:PARALITH_UPDATE_PUBLISH_PROVIDER,
  [string]$Source = (Join-Path $PSScriptRoot '..\..\.artifacts\update-site'),
  [string]$Target = $env:PARALITH_UPDATE_PUBLISH_TARGET
)
$ErrorActionPreference = 'Stop'
if (-not $Provider -or -not $Target) { throw 'Publication provider and target are required.' }
$resolvedSource = (Resolve-Path -LiteralPath $Source).Path
switch ($Provider) {
  'filesystem' {
    New-Item -ItemType Directory -Force -Path $Target | Out-Null
    Get-ChildItem -LiteralPath $resolvedSource -Force | Copy-Item -Destination $Target -Recurse -Force
  }
  's3' { & aws s3 sync $resolvedSource $Target --delete; if ($LASTEXITCODE) { throw "aws s3 sync failed: $LASTEXITCODE" } }
  'ssh' { & scp -r "$resolvedSource\*" $Target; if ($LASTEXITCODE) { throw "scp failed: $LASTEXITCODE" } }
  'http' {
    if (-not $env:PARALITH_UPDATE_PUBLISH_TOKEN) { throw 'PARALITH_UPDATE_PUBLISH_TOKEN is required for HTTP publication.' }
    Get-ChildItem -LiteralPath $resolvedSource -Recurse -File | ForEach-Object {
      $relative = $_.FullName.Substring($resolvedSource.Length).TrimStart('\').Replace('\','/')
      $uri = "$($Target.TrimEnd('/'))/$relative"
      Invoke-WebRequest -Method Put -Uri $uri -InFile $_.FullName -Headers @{ Authorization = "Bearer $env:PARALITH_UPDATE_PUBLISH_TOKEN" } | Out-Null
    }
  }
}
Write-Host "Published PARALITH update site using $Provider."

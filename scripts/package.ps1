param(
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$dist = Join-Path $root 'dist'
$staging = Join-Path $dist '.staging-vision'
$package = Get-Content -Raw -LiteralPath (Join-Path $root 'package.json') | ConvertFrom-Json
$version = [string]$package.version
if (-not $version) {
  throw 'package.json must declare a version.'
}

if (-not $OutputPath) {
  $OutputPath = Join-Path $dist "vision-v$version.zip"
}
$output = [IO.Path]::GetFullPath($OutputPath)
$stagingFull = [IO.Path]::GetFullPath($staging)
if (-not $stagingFull.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing unexpected staging path: $stagingFull"
}

$includes = @(
  '.agents',
  '.github',
  '.gitignore',
  'AGENTS.md',
  'README.md',
  'docs',
  'evaluation',
  'game',
  'marketplace.json',
  'package.json',
  'package-lock.json',
  'plugins',
  'proof\config.json',
  'proof\fixture',
  'proof\tasks',
  'proof\run-proof.mjs',
  'proof\finalize-proof.mjs',
  'scripts',
  'test',
  'tests'
)

New-Item -ItemType Directory -Force -Path $dist | Out-Null
if (Test-Path -LiteralPath $stagingFull) {
  Remove-Item -Recurse -Force -LiteralPath $stagingFull
}
New-Item -ItemType Directory -Path $stagingFull | Out-Null

try {
  foreach ($relative in $includes) {
    $source = Join-Path $root $relative
    $destination = Join-Path $stagingFull $relative
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
    Copy-Item -Recurse -Force -LiteralPath $source -Destination $destination
  }
  $privateHandoff = Join-Path $stagingFull 'docs\work-environment-handoff.md'
  if (Test-Path -LiteralPath $privateHandoff) {
    Remove-Item -Force -LiteralPath $privateHandoff
  }
  if (Test-Path -LiteralPath $output) {
    Remove-Item -Force -LiteralPath $output
  }
  Compress-Archive -Path (Join-Path $stagingFull '*') -DestinationPath $output -CompressionLevel Optimal
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $output).Hash.ToLowerInvariant()
  Write-Output "Created $output"
  Write-Output "SHA256 $hash"
}
finally {
  if (Test-Path -LiteralPath $stagingFull) {
    Remove-Item -Recurse -Force -LiteralPath $stagingFull
  }
}

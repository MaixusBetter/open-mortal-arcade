# get-node.ps1 - fetches a private copy of Node.js (current LTS) into .runtime\node next to the
# arcade, for computers without Node.js 20 or newer. Nothing is installed system-wide and no
# admin rights are needed. "Start Arcade.cmd" runs this when it has to.
#
# Set MA_NODE_MIRROR to use another mirror of https://nodejs.org/dist (same folder layout).

$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}

$root = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $root '.runtime'
$target = Join-Path $runtime 'node'
$mirror = if ($env:MA_NODE_MIRROR) { $env:MA_NODE_MIRROR.TrimEnd('/') } else { 'https://nodejs.org/dist' }
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'arm64' } else { 'x64' }
$web = New-Object Net.WebClient
$web.Headers.Add('User-Agent', 'mortal-arcade-setup')

try {
  # find the newest LTS build for this PC, with its published checksum
  $file = $null; $hash = $null; $channel = $null
  foreach ($c in @('latest-v24.x', 'latest-v22.x')) {
    try { $sums = $web.DownloadString("$mirror/$c/SHASUMS256.txt") } catch { continue }
    foreach ($line in ($sums -split "`n")) {
      $parts = $line.Trim() -split '\s+'
      if ($parts.Count -eq 2 -and $parts[1] -match "^node-v[\d.]+-win-$arch\.zip$") { $hash = $parts[0]; $file = $parts[1]; $channel = $c; break }
    }
    if ($file) { break }
  }
  if (-not $file) { throw "Could not reach $mirror to find Node.js." }

  New-Item -ItemType Directory -Force -Path $runtime | Out-Null
  $zip = Join-Path $runtime $file
  Write-Host "  Downloading $file ..."
  $web.DownloadFile("$mirror/$channel/$file", $zip)

  $got = (Get-FileHash -Algorithm SHA256 -Path $zip).Hash.ToLower()
  if ($got -ne $hash.ToLower()) { Remove-Item -Force $zip; throw "The Node.js download did not match its published checksum. Try again." }
  Write-Host '  Checked against the published checksum. Unpacking...'

  if (Test-Path $target) { Remove-Item -Recurse -Force $target }
  $folder = Join-Path $runtime ($file -replace '\.zip$', '')
  if (Test-Path $folder) { Remove-Item -Recurse -Force $folder }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $runtime)
  Rename-Item -Path $folder -NewName 'node'
  Remove-Item -Force $zip
  Write-Host "  Node.js is ready in .runtime\node."
  exit 0
} catch {
  Write-Host ''
  Write-Host "  ! $($_.Exception.Message)"
  Write-Host '  You can also install Node.js yourself (the LTS version) from https://nodejs.org/ and start again.'
  exit 1
}

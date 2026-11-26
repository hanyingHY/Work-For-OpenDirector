<#
.SYNOPSIS
  Build a standalone Windows x64 NSIS desktop installer (.exe) for OpenDirector v0.5.
.DESCRIPTION
  Builds dist/, prepares the bundled Python + FFmpeg runtime under apps/desktop/runtime/,
  and packages OpenDirector-v0.5.0-win-x64-unsigned.exe via electron-builder.
  Prerequisites: uv, Node.js 22+, and ffmpeg.exe + ffprobe.exe on PATH (or OPENDIRECTOR_FFMPEG_DIR).
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $RepoRoot

Write-Host "`n=== OpenDirector v0.5 · Windows x64 NSIS Installer Builder ===" -ForegroundColor Cyan

if (-not $env:OPENDIRECTOR_FFMPEG_DIR) {
  $ff = Get-Command "ffmpeg.exe" -ErrorAction SilentlyContinue
  $fp = Get-Command "ffprobe.exe" -ErrorAction SilentlyContinue
  if ($ff -and $fp -and (Split-Path $ff.Source) -eq (Split-Path $fp.Source)) {
    $env:OPENDIRECTOR_FFMPEG_DIR = Split-Path $ff.Source
    Write-Host "Auto-detected FFmpeg directory: $($env:OPENDIRECTOR_FFMPEG_DIR)" -ForegroundColor Green
  } else {
    throw "Set `$env:OPENDIRECTOR_FFMPEG_DIR to a folder containing standalone ffmpeg.exe and ffprobe.exe before building the installer."
  }
}

Write-Host "[1/4] Installing frontend and desktop dependencies..." -ForegroundColor Yellow
if (-not (Test-Path (Join-Path $RepoRoot "node_modules"))) { & npm ci }
if (-not (Test-Path (Join-Path $RepoRoot "apps\desktop\node_modules"))) { & npm --prefix apps/desktop ci }

Write-Host "[2/4] Building embedded desktop UI bundle..." -ForegroundColor Yellow
& npm run build

Write-Host "[3/4] Preparing bundled standalone Python + FFmpeg runtime..." -ForegroundColor Yellow
& npm --prefix apps/desktop run prepare:runtime

Write-Host "[4/4] Packaging Windows x64 NSIS installer (.exe)..." -ForegroundColor Yellow
& npm --prefix apps/desktop run pack:windows

$OutDir = Join-Path $RepoRoot "apps\desktop\build"
Write-Host "`nWindows Desktop Installer ready in: $OutDir" -ForegroundColor Green
Get-ChildItem -Path $OutDir -Filter "*.exe" -ErrorAction SilentlyContinue | ForEach-Object {
  Write-Host "  -> $($_.FullName)" -ForegroundColor Cyan
}

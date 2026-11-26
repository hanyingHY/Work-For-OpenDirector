<#
.SYNOPSIS
  Launch OpenDirector v0.5 as a NATIVE Windows 10/11 Electron Desktop Application.
.DESCRIPTION
  Does NOT open a web browser. Bootstraps Python (.venv + backend + imageio-ffmpeg fallback),
  installs Electron desktop dependencies, compiles the UI bundle (dist/) if needed, and
  launches the native Windows Electron desktop shell with private authenticated Python Host,
  Windows Mica titlebar, taskbar progress, system tray, native clipboard, and #473 file picker.
#>
[CmdletBinding()]
param(
  [switch]$Rebuild
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $RepoRoot

Write-Host "`n=== OpenDirector v0.5 · Native Windows Desktop Launcher ===" -ForegroundColor Cyan

# 1. Verify Python 3.11+ and Node.js 22+
$PythonCmd = $null
foreach ($candidate in @("python", "python3", "py")) {
  if (Get-Command $candidate -ErrorAction SilentlyContinue) {
    $PythonCmd = $candidate
    break
  }
}
if (-not $PythonCmd) {
  throw "Python 3.11+ not found. Install Python 3.11+ from https://www.python.org/downloads/ (check 'Add Python to PATH')."
}
if (-not (Get-Command "npm" -ErrorAction SilentlyContinue)) {
  throw "Node.js / npm not found. Install Node.js 22+ LTS from https://nodejs.org/."
}

# 2. Bootstrap Python .venv for private Desktop Host
$VenvPython = Join-Path $RepoRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $VenvPython)) {
  Write-Host "[1/5] Creating Python virtual environment (.venv)..." -ForegroundColor Yellow
  if ($PythonCmd -eq "py") {
    & py -3 -m venv .venv
  } else {
    & $PythonCmd -m venv .venv
  }
}

Write-Host "[2/5] Checking Python Desktop Host dependencies..." -ForegroundColor Yellow
$hostReady = $false
try {
  & $VenvPython -c "import fastapi, uvicorn, pydantic" 2>$null
  if ($LASTEXITCODE -eq 0) { $hostReady = $true }
} catch {}
if (-not $hostReady) {
  Write-Host "      Installing backend Python packages (first run only)..." -ForegroundColor DarkGray
  & $VenvPython -m pip install --upgrade pip
  if (Test-Path (Join-Path $RepoRoot "requirements.txt")) {
    & $VenvPython -m pip install -r requirements.txt
  }
  & $VenvPython -m pip install -e packages/core -e apps/api
}

# Ensure FFmpeg is discoverable (PATH or imageio-ffmpeg fallback)
if (-not (Get-Command "ffmpeg" -ErrorAction SilentlyContinue)) {
  $hasImageio = $false
  try {
    & $VenvPython -c "import imageio_ffmpeg; imageio_ffmpeg.get_ffmpeg_exe()" 2>$null
    if ($LASTEXITCODE -eq 0) { $hasImageio = $true }
  } catch {}
  if (-not $hasImageio) {
    Write-Host "      FFmpeg not on PATH — installing imageio-ffmpeg for native media probe/breakdown/video ops..." -ForegroundColor DarkGray
    & $VenvPython -m pip install imageio-ffmpeg
  }
}

# 3. Install root frontend deps & build desktop UI bundle (dist/index.html)
if (-not (Test-Path (Join-Path $RepoRoot "node_modules"))) {
  Write-Host "[3/5] Installing frontend packages (npm install)..." -ForegroundColor Yellow
  & npm install
}
$DistIndex = Join-Path $RepoRoot "dist\index.html"
if ($Rebuild -or -not (Test-Path $DistIndex)) {
  Write-Host "[3/5] Building embedded desktop UI bundle (npm run build)..." -ForegroundColor Yellow
  & npm run build
} else {
  Write-Host "[3/5] Embedded desktop UI bundle ready (use -Rebuild after editing src/)." -ForegroundColor Green
}

# 4. Install Electron Desktop Shell dependencies (apps/desktop)
$ElectronBin = Join-Path $RepoRoot "apps\desktop\node_modules\.bin\electron.cmd"
if (-not (Test-Path $ElectronBin)) {
  Write-Host "[4/5] Installing Windows Electron desktop shell (apps/desktop)..." -ForegroundColor Yellow
  & npm --prefix apps/desktop install
} else {
  Write-Host "[4/5] Electron desktop shell ready." -ForegroundColor Green
}

# 5. Launch native Windows Electron Desktop App (private authenticated Host + opendirector://app/)
Write-Host "[5/5] Launching OpenDirector Native Windows Desktop App..." -ForegroundColor Green
$env:OPENDIRECTOR_PYTHON = $VenvPython
& npm --prefix apps/desktop start

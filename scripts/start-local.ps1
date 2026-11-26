<#
.SYNOPSIS
  One-command local launcher for OpenDirector v0.5 Studio on Windows.
.DESCRIPTION
  Checks Python/Node/FFmpeg, bootstraps .venv and node_modules if missing,
  starts the persistent local FastAPI backend (127.0.0.1:8000) and Vite Studio (127.0.0.1:5173),
  and opens your browser automatically. Press Ctrl+C to stop both services cleanly.
#>
[CmdletBinding()]
param(
  [int]$ApiPort = 8000,
  [int]$WebPort = 5173,
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $RepoRoot

Write-Host "`n=== OpenDirector v0.5 Studio · Local Windows Launcher ===" -ForegroundColor Cyan

# 1. Locate Python 3.11+
$PythonCmd = $null
foreach ($candidate in @("python", "python3", "py")) {
  if (Get-Command $candidate -ErrorAction SilentlyContinue) {
    $PythonCmd = $candidate
    break
  }
}
if (-not $PythonCmd) {
  throw "Python 3.11+ not found on PATH. Please install Python 3.11+ from https://www.python.org/downloads/ and check 'Add Python to PATH'."
}

if (-not (Get-Command "npm" -ErrorAction SilentlyContinue)) {
  throw "Node.js / npm not found on PATH. Please install Node.js 22+ LTS from https://nodejs.org/."
}

# 2. Bootstrap Python virtual environment
$VenvPython = Join-Path $RepoRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $VenvPython)) {
  Write-Host "[1/4] Creating Python virtual environment (.venv)..." -ForegroundColor Yellow
  if ($PythonCmd -eq "py") {
    & py -3 -m venv .venv
  } else {
    & $PythonCmd -m venv .venv
  }
}

Write-Host "[2/4] Verifying Python backend dependencies..." -ForegroundColor Yellow
$uvicornOk = $false
try {
  & $VenvPython -c "import fastapi, uvicorn, pydantic" 2>$null
  if ($LASTEXITCODE -eq 0) { $uvicornOk = $true }
} catch {}

if (-not $uvicornOk) {
  Write-Host "      Installing backend packages (first run only)..." -ForegroundColor DarkGray
  & $VenvPython -m pip install --upgrade pip
  if (Test-Path (Join-Path $RepoRoot "requirements.txt")) {
    & $VenvPython -m pip install -r requirements.txt
  }
  & $VenvPython -m pip install -e packages/core -e apps/api
}

# Ensure FFmpeg is available either on PATH or via imageio-ffmpeg fallback
if (-not (Get-Command "ffmpeg" -ErrorAction SilentlyContinue)) {
  $hasImageio = $false
  try {
    & $VenvPython -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())" 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $hasImageio = $true }
  } catch {}
  if (-not $hasImageio) {
    Write-Host "      FFmpeg not found on PATH — installing imageio-ffmpeg automatically for local probe/breakdown/video ops..." -ForegroundColor DarkGray
    & $VenvPython -m pip install imageio-ffmpeg
  }
}

# 3. Bootstrap Frontend dependencies
if (-not (Test-Path (Join-Path $RepoRoot "node_modules"))) {
  Write-Host "[3/4] Installing frontend dependencies (npm install)..." -ForegroundColor Yellow
  & npm install
} else {
  Write-Host "[3/4] Frontend node_modules ready." -ForegroundColor Green
}

# 4. Launch Backend API + Vite Studio
$env:PYTHONPATH = "$RepoRoot\packages\core\src;$RepoRoot\apps\api\src"
$env:OPENDIRECTOR_API_PORT = "$ApiPort"

Write-Host "[4/4] Starting API server on http://127.0.0.1:$ApiPort and Studio on http://127.0.0.1:$WebPort ..." -ForegroundColor Cyan

$apiProc = Start-Process -FilePath $VenvPython `
  -ArgumentList @("-m", "opendirector_api.server", "--port", "$ApiPort") `
  -WorkingDirectory $RepoRoot `
  -PassThru -NoNewWindow

try {
  # Wait for backend health
  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 500
    if ($apiProc.HasExited) {
      throw "API server exited unexpectedly with code $($apiProc.ExitCode)."
    }
    try {
      $resp = Invoke-RestMethod -Uri "http://127.0.0.1:$ApiPort/api/desktop/runtime-health" -TimeoutSec 2
      if ($resp.status -eq "ok") {
        Write-Host "      API healthy · Python $($resp.pythonVersion) · FFmpeg available: $($resp.ffmpegAvailable)" -ForegroundColor Green
        $ready = $true
        break
      }
    } catch {}
  }

  if (-not $NoBrowser) {
    Start-Job -ScriptBlock {
      param($url)
      Start-Sleep -Seconds 2
      Start-Process $url
    } -ArgumentList "http://127.0.0.1:$WebPort" | Out-Null
  }

  Write-Host "`nOpenDirector v0.5 Studio is running -> http://127.0.0.1:$WebPort" -ForegroundColor Green
  Write-Host "Press Ctrl+C to stop both frontend and backend.`n" -ForegroundColor DarkGray

  & npm run dev -- --host 127.0.0.1 --port $WebPort
}
finally {
  Write-Host "`nStopping OpenDirector API server..." -ForegroundColor Yellow
  if ($apiProc -and -not $apiProc.HasExited) {
    Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
  }
}

@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-windows-desktop.ps1" %*
if errorlevel 1 (
  echo.
  echo [OpenDirector] Desktop launch exited with error code %ERRORLEVEL%.
  pause
)

@echo off
rem mdee: start the development version (node_modules\electron\dist\electron.exe) for checking.
rem The status bar shows the stall / input delay counters (for checking IME and input response, like mdew's Debug build).
rem Usage: dev.cmd [file or folder]
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo Electron is not installed. Run build.cmd or measure.cmd first.
  pause
  exit /b 1
)
start "" "node_modules\electron\dist\electron.exe" . %*

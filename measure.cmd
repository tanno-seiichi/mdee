@echo off
rem mdee: measure startup time (runs the development version: node_modules\electron\dist\electron.exe).
rem Installs Electron if needed (npm install, then the Electron binary), then starts mdee 5 times and exits each time automatically.
rem The startup times are written to %LOCALAPPDATA%\mdee\error.log.
cd /d "%~dp0"
if not exist "node_modules\electron\package.json" (
  echo Installing Electron ^(npm install^)...
  call npm install
  if errorlevel 1 goto failed
)
if not exist "node_modules\electron\dist\electron.exe" (
  echo Downloading the Electron binary...
  node node_modules\electron\install.js
  if errorlevel 1 goto failed
)
set MDEE_TRACE_LOG=1
for /L %%i in (1,1,5) do (
  echo Starting mdee: %%i / 5
  start "" /wait "node_modules\electron\dist\electron.exe" . --measure-exit "%~dp0README.md"
  timeout /t 2 /nobreak > nul
)
echo Done. See %LOCALAPPDATA%\mdee\error.log
pause
exit /b 0
:failed
echo Installing Electron failed.
pause
exit /b 1

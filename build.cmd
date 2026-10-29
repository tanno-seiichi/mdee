@echo off
rem mdee: build the installer.
rem  1. npm install (Electron and resedit), and the Electron binary if it is missing
rem  2. npm run package  -> out\mdee (mdee.exe, Electron files, resources\app)
rem  3. dotnet build msi -> msi\bin\x64\Release\ja-JP\mdee.msi and msi\bin\x64\Release\en-US\mdee.msi
rem Requires Node.js (npm) and the .NET SDK (dotnet). WiX Toolset is restored from NuGet automatically.
setlocal
cd /d "%~dp0"

echo [1/3] npm install
call npm install
if errorlevel 1 goto failed
if not exist "node_modules\electron\dist\electron.exe" (
  echo Downloading the Electron binary...
  node node_modules\electron\install.js
  if errorlevel 1 goto failed
)

echo [2/3] npm run package
call npm run package
if errorlevel 1 goto failed

echo [3/3] dotnet build msi\msi.wixproj
dotnet build msi\msi.wixproj -c Release -p:Platform=x64
if errorlevel 1 goto failed

echo.
echo Done:
echo   %~dp0msi\bin\x64\Release\ja-JP\mdee.msi
echo   %~dp0msi\bin\x64\Release\en-US\mdee.msi
if not "%~1"=="/nopause" pause
exit /b 0

:failed
echo.
echo Build failed.
if not "%~1"=="/nopause" pause
exit /b 1

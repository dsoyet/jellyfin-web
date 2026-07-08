@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

if not exist "node_modules\.bin\webpack.cmd" (
    echo [0/2] Rebuilding node_modules\.bin...
    call .\nenv.cmd npm rebuild
)

echo [1/2] Building...
set "PATH=%~dp0.nenv\node-v24.18.0-win-x64;%PATH%"
set NODE_ENV=production
node "%~dp0node_modules\webpack\bin\webpack.js" --config "%~dp0webpack.prod.js"
if %ERRORLEVEL% neq 0 exit /b 1

echo [2/2] Deploying...
robocopy "%~dp0dist" "D:\Jellyfin\system\jellyfin-web" /MIR /NJH /NJS /NP /NS /NC /NFL /NDL
echo Done.

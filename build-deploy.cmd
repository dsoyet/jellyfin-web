@echo off
setlocal enabledelayedexpansion
REM ============================================================
REM build-deploy.cmd - Build jellyfin-web and deploy to Jellyfin
REM Usage: .\build-deploy.cmd
REM ============================================================

cd /d "%~dp0"

REM ── 1. Install dependencies ──
echo [1/3] Installing dependencies... (mirror: npmmirror.com)
call .\nenv.cmd npm ci --no-audit --prefer-offline
if %ERRORLEVEL% neq 0 (
    echo ERROR: npm ci failed
    exit /b 1
)

REM ── 2. Build production ──
echo.
echo [2/3] Building...
call .\nenv.cmd npm run build:production
if %ERRORLEVEL% neq 0 (
    echo ERROR: build failed
    exit /b 1
)

REM ── 3. Deploy to Jellyfin ──
echo.
echo [3/3] Deploying to D:\Jellyfin\system\jellyfin-web...
set "TARGET=D:\Jellyfin\system\jellyfin-web"
if not exist "%TARGET%" mkdir "%TARGET%"
robocopy dist "%TARGET%" /MIR /NJH /NJS /NP /NS /NC /NFL /NDL >nul
if %ERRORLEVEL% geq 8 (
    echo ERROR: deploy failed
    exit /b 1
)

echo.
echo ========================================
echo   Build & Deploy Complete!
echo   Target: %TARGET%
echo ========================================

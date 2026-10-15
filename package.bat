@echo off
cd /d "%~dp0"
title Packaging GitView Standalone Release

echo ============================================================
echo          Packaging GitView Standalone Release Folder...
echo ============================================================
echo.

node scripts/package.js

if errorlevel 1 (
    echo.
    echo [ERROR] Packaging failed!
    pause
    exit /b 1
)

echo.
echo [OK] Packaging finished successfully! Opening release folder...
pause
start "" "release"

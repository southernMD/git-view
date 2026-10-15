@echo off
cd /d "%~dp0"
title GitView Server

echo ============================================================
echo               GitView Local Server
echo ============================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not found on your system!
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

if not exist "dist\index.html" (
    echo [INFO] dist directory not found, building project...
    call yarn build
    if errorlevel 1 (
        echo [ERROR] Build failed!
        pause
        exit /b 1
    )
    echo [OK] Build completed!
    echo.
)

echo [START] Starting GitView server (Port 3000)...
echo [INFO] Browser will open automatically. Press Ctrl+C to stop.
echo.
node server.js
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Server exited with code %errorlevel%.
    pause
)
pause

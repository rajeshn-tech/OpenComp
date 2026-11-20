@echo off
title OpenComp - Professional VFX Compositing Workstation
cd /d "%~dp0"

echo ================================================================
echo    OpenComp - Node-Based VFX Compositing Workstation
echo    (Professional VFX Compositor)
echo ================================================================
echo.

where node >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo [INFO] Starting OpenComp with local server...
    node server.js --open
) else (
    if exist ".venv\Scripts\python.exe" (
        echo [INFO] Node.js not found in PATH. Starting with Python venv server...
        start "" "http://127.0.0.1:8080/"
        ".venv\Scripts\python.exe" server.py 8080
    ) else (
        where python >nul 2>nul
        if %ERRORLEVEL% EQU 0 (
            echo [INFO] Node.js not found in PATH. Starting with system Python server...
            start "" "http://127.0.0.1:8080/"
            python server.py 8080
        ) else (
            echo [ERROR] Neither Node.js nor Python found on this system.
            echo OpenComp requires Node.js or Python to run its offline local server.
            echo Opening index.html directly via file:// is blocked by browser CORS security.
            pause
        )
    )
)


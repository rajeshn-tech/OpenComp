@echo off
setlocal enabledelayedexpansion
title OpenComp - Desktop Workstation (PySide6)
cd /d "%~dp0"

echo ================================================================
echo    OpenComp - Node-Based VFX Compositing Workstation
echo    (Desktop Workstation in Python / PySide6)
echo ================================================================
echo.

if exist ".venv\Scripts\python.exe" (
    echo [INFO] Starting OpenComp with virtual environment Python...
    ".venv\Scripts\python.exe" -m src.main
) else (
    :: Test if system python is functional (not Microsoft Store redirect stub)
    python -c "import sys" >nul 2>nul
    if !ERRORLEVEL! EQU 0 (
        echo [INFO] Starting OpenComp with system Python...
        python -m src.main
    ) else (
        where py >nul 2>nul
        if !ERRORLEVEL! EQU 0 (
            echo [INFO] Starting OpenComp via Python launcher (py -3)...
            py -3 -m src.main
        ) else (
            echo [ERROR] No working Python installation detected.
            echo The system Python alias redirects to Microsoft Store, and .venv is missing.
            echo Please install Python 3.10+ and PySide6, or run OpenComp via run_desktop.bat.
            pause
            exit /b 1
        )
    )
)

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Application exited with error.
    pause
)
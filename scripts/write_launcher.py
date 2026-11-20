import os

desktop_content = """@echo off
setlocal enabledelayedexpansion
title OpenComp - Standalone Desktop VFX Workstation
cd /d "%~dp0"

echo ==============================================================================
echo    OpenComp - Standalone Desktop VFX Workstation
echo    Initializing Local HTTP Runtime and Hardware Acceleration...
echo ==============================================================================
echo.

set DEFAULT_PORT=8080
if not "%OPENCOMP_PORT%"=="" set DEFAULT_PORT=%OPENCOMP_PORT%

set SERVER_URL=http://127.0.0.1:%DEFAULT_PORT%/
set HEALTH_URL=http://127.0.0.1:%DEFAULT_PORT%/health

:: Step 1: Check if an OpenComp server is already running and healthy
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-RestMethod -Uri '%HEALTH_URL%' -TimeoutSec 1; if ($r.app -eq 'OpenComp') { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo [INFO] Existing OpenComp local server detected and healthy on %SERVER_URL%
    goto :find_browser
)

:: Step 2: Launch local HTTP server (Node.js preferred, Python fallback)
echo [INFO] Starting local HTTP server on 127.0.0.1:%DEFAULT_PORT%...

where node >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo [INFO] Runtime: Node.js (server.js)
    start /b "" node server.js --port %DEFAULT_PORT%
    goto :wait_server
)

if exist ".venv\\Scripts\\python.exe" (
    echo [INFO] Runtime: Python venv (server.py)
    start /b "" ".venv\\Scripts\\python.exe" server.py %DEFAULT_PORT%
    goto :wait_server
)

where python >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo [INFO] Runtime: System Python (server.py)
    start /b "" python server.py %DEFAULT_PORT%
    goto :wait_server
)

echo.
echo [FATAL ERROR] Neither Node.js nor Python is available on this system.
echo OpenComp requires Node.js or Python to run its local 127.0.0.1 HTTP server.
echo Browser security blocks ES module loading when index.html is opened directly via file://.
echo.
pause
exit /b 1

:wait_server
echo [INFO] Waiting for local server to become ready...
set READY=0
for /l %%i in (1,1,30) do (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-RestMethod -Uri '%HEALTH_URL%' -TimeoutSec 1; if ($r.app -eq 'OpenComp') { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>nul
    if !ERRORLEVEL! EQU 0 (
        set READY=1
        goto :server_ready
    )
    if exist ".server_info.json" (
        for /f "tokens=*" %%a in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $c = Get-Content '.server_info.json' | ConvertFrom-Json; Write-Output $c.url } catch {}"') do (
            set SERVER_URL=%%a
            set READY=1
            goto :server_ready
        )
    )
    timeout /t 1 /nobreak >nul
)

if %READY% EQU 0 (
    echo.
    echo [ERROR] Local HTTP server failed to respond at %HEALTH_URL% within 30 seconds.
    echo Please check if port %DEFAULT_PORT% is blocked or in use by another application.
    echo You can specify a different port using: set OPENCOMP_PORT=8090
    echo.
    pause
    exit /b 1
)

:server_ready
echo [INFO] Local HTTP server is active and verified at %SERVER_URL%
echo.

:find_browser
set BROWSER_EXE=

:: Check known Microsoft Edge locations (Preferred for Windows Desktop App Mode)
if exist "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" (
    set "BROWSER_EXE=C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
    set BROWSER_NAME=Microsoft Edge
    goto :launch_app
)
if exist "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe" (
    set "BROWSER_EXE=C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
    set BROWSER_NAME=Microsoft Edge
    goto :launch_app
)
if exist "%LOCALAPPDATA%\\Microsoft\\Edge\\Application\\msedge.exe" (
    set "BROWSER_EXE=%LOCALAPPDATA%\\Microsoft\\Edge\\Application\\msedge.exe"
    set BROWSER_NAME=Microsoft Edge
    goto :launch_app
)

:: Check known Google Chrome locations
if exist "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" (
    set "BROWSER_EXE=C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    set BROWSER_NAME=Google Chrome
    goto :launch_app
)
if exist "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe" (
    set "BROWSER_EXE=C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
    set BROWSER_NAME=Google Chrome
    goto :launch_app
)
if exist "%LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe" (
    set "BROWSER_EXE=%LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe"
    set BROWSER_NAME=Google Chrome
    goto :launch_app
)

:: Check PATH for msedge or chrome
where msedge.exe >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    set "BROWSER_EXE=msedge.exe"
    set BROWSER_NAME=Microsoft Edge
    goto :launch_app
)

where chrome.exe >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    set "BROWSER_EXE=chrome.exe"
    set BROWSER_NAME=Google Chrome
    goto :launch_app
)

:launch_app
if not "%BROWSER_EXE%"=="" (
    echo [INFO] Launching OpenComp in Native Desktop App Mode (%BROWSER_NAME%)...
    start "" "%BROWSER_EXE%" --app="%SERVER_URL%" --window-size=1600,1000 --enable-gpu-rasterization --enable-zero-copy
    exit /b 0
)

echo [INFO] Launching OpenComp in default web browser...
start "" "%SERVER_URL%"
exit /b 0
"""

python_content = """@echo off
title OpenComp - Desktop Workstation (PySide6)
cd /d "%~dp0"

echo ================================================================
echo    OpenComp - Node-Based VFX Compositing Workstation
echo    (Desktop Workstation in Python / PySide6)
echo ================================================================
echo.

if exist ".venv\\Scripts\\python.exe" (
    echo [INFO] Starting OpenComp with virtual environment Python...
    ".venv\\Scripts\\python.exe" -m src.main
) else (
    echo [INFO] Starting OpenComp with system Python...
    python -m src.main
)

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Application exited with error.
    pause
)
"""

with open('run_desktop.bat', 'wb') as f:
    f.write(desktop_content.strip().replace('\r\n', '\n').replace('\n', '\r\n').encode('ascii'))

with open('run_python.bat', 'wb') as f:
    f.write(python_content.strip().replace('\r\n', '\n').replace('\n', '\r\n').encode('ascii'))

print("Successfully wrote run_desktop.bat and run_python.bat with CRLF ASCII.")

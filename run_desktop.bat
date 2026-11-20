@echo off
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

:: Resolve PowerShell path explicitly to prevent local powershell.bat interception
set "PS_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS_EXE%" set "PS_EXE=powershell.exe"

:: Step 1: Check if an OpenComp server is already running and healthy
set SERVER_ACTIVE=0
where curl >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    curl -s -f "%HEALTH_URL%" >nul 2>nul
    if !ERRORLEVEL% EQU 0 set SERVER_ACTIVE=1
)
if !SERVER_ACTIVE! EQU 0 (
    where node >nul 2>nul
    if !ERRORLEVEL% EQU 0 (
        node -e "require('http').get('%HEALTH_URL%',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))" >nul 2>nul
        if !ERRORLEVEL! EQU 0 set SERVER_ACTIVE=1
    )
)
if !SERVER_ACTIVE! EQU 0 (
    "%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-RestMethod -Uri '%HEALTH_URL%' -TimeoutSec 1; if ($r.app -eq 'OpenComp') { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>nul
    if !ERRORLEVEL! EQU 0 set SERVER_ACTIVE=1
)

if !SERVER_ACTIVE! EQU 1 (
    echo [INFO] Existing OpenComp local server detected and healthy on %SERVER_URL%
    goto :find_browser
)

:: Step 2: Launch local HTTP server (Node.js preferred, Python fallback)
echo [INFO] Starting local HTTP server on 127.0.0.1:%DEFAULT_PORT%...

where node >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo [INFO] Runtime: Node.js (server.js)
    start "OpenComp Server" /min node server.js --port %DEFAULT_PORT%
    goto :wait_server
)

if exist ".venv\Scripts\python.exe" (
    echo [INFO] Runtime: Python venv (server.py)
    start "OpenComp Server" /min ".venv\Scripts\python.exe" server.py %DEFAULT_PORT%
    goto :wait_server
)

where python >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo [INFO] Runtime: System Python (server.py)
    start "OpenComp Server" /min python server.py %DEFAULT_PORT%
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
    where curl >nul 2>nul
    if !ERRORLEVEL% EQU 0 (
        curl -s -f "%HEALTH_URL%" >nul 2>nul
        if !ERRORLEVEL! EQU 0 (
            set READY=1
            goto :server_ready
        )
    )
    where node >nul 2>nul
    if !ERRORLEVEL! EQU 0 (
        node -e "require('http').get('%HEALTH_URL%',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))" >nul 2>nul
        if !ERRORLEVEL! EQU 0 (
            set READY=1
            goto :server_ready
        )
    )
    "%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-RestMethod -Uri '%HEALTH_URL%' -TimeoutSec 1; if ($r.app -eq 'OpenComp') { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>nul
    if !ERRORLEVEL! EQU 0 (
        set READY=1
        goto :server_ready
    )
    if exist ".server_info.json" (
        where node >nul 2>nul
        if !ERRORLEVEL! EQU 0 (
            for /f "tokens=*" %%a in ('node -e "try{console.log(JSON.parse(require('fs').readFileSync('.server_info.json')).url)}catch{}"') do (
                set SERVER_URL=%%a
                set READY=1
                goto :server_ready
            )
        )
        for /f "tokens=*" %%a in ('"%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -Command "try { $c = Get-Content '.server_info.json' | ConvertFrom-Json; Write-Output $c.url } catch {}"') do (
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
if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" (
    set "BROWSER_EXE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
    set BROWSER_NAME=Microsoft Edge
    goto :launch_app
)
if exist "C:\Program Files\Microsoft\Edge\Application\msedge.exe" (
    set "BROWSER_EXE=C:\Program Files\Microsoft\Edge\Application\msedge.exe"
    set BROWSER_NAME=Microsoft Edge
    goto :launch_app
)
if exist "%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe" (
    set "BROWSER_EXE=%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe"
    set BROWSER_NAME=Microsoft Edge
    goto :launch_app
)

:: Check known Google Chrome locations
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    set "BROWSER_EXE=C:\Program Files\Google\Chrome\Application\chrome.exe"
    set BROWSER_NAME=Google Chrome
    goto :launch_app
)
if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    set "BROWSER_EXE=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
    set BROWSER_NAME=Google Chrome
    goto :launch_app
)
if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" (
    set "BROWSER_EXE=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
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
set PROJECT_PARAM=
if not "%OPENCOMP_PROJECT%"=="" (
    set "PROJECT_PARAM=?project=%OPENCOMP_PROJECT%&play=1"
) else (
    if not "%~1"=="" (
        set "PROJECT_PARAM=?project=%~1&play=1"
    ) else (
        if exist "demo\vfx_showcase\cinematic_vfx_shot.opencomp" (
            set "PROJECT_PARAM=?project=/demo/vfx_showcase/cinematic_vfx_shot.opencomp&play=1"
        )
    )
)

if not "%BROWSER_EXE%"=="" (
    echo [INFO] Launching OpenComp in Native Desktop App Mode [%BROWSER_NAME%]...
    start "" "%BROWSER_EXE%" --app="%SERVER_URL%%PROJECT_PARAM%" --window-size=1600,1000 --enable-gpu-rasterization --enable-zero-copy
    exit /b 0
)

echo [INFO] Launching OpenComp in default web browser...
start "" "%SERVER_URL%%PROJECT_PARAM%"
exit /b 0
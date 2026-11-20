@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js is required to run opencomp-render. Please install Node.js or ensure it is in your PATH.
    exit /b 1
)

node "%~dp0bin\opencomp-render.mjs" %*
exit /b %ERRORLEVEL%


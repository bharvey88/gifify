@echo off
rem Double-click launcher for gifify (Windows).
rem Installs dependencies on first run, then starts the server.
rem Close this window to stop gifify.

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js was not found. Install it from https://nodejs.org/ and run this again.
    pause
    exit /b 1
)

if not exist node_modules (
    echo First run: installing dependencies, this takes a minute...
    call npm install
    if errorlevel 1 (
        echo.
        echo npm install failed - see the errors above.
        pause
        exit /b 1
    )
)

title gifify - close this window to stop
echo Starting gifify... your browser will open shortly.
echo Keep this window open while you use it; close it to stop gifify.
call npm start
pause

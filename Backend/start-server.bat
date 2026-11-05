@echo off
chcp 65001 >nul
echo ClarityMeet Bot Server - Quick Start
echo.

REM Check if node_modules exists
if not exist "node_modules" (
    echo Installing dependencies...
    npm install
    if errorlevel 1 (
        echo Failed to install dependencies
        pause
        exit /b 1
    )
    echo Dependencies installed
    echo.
)

REM Check if .env exists
if not exist ".env" (
    echo Warning: .env file not found!
    echo Please create a .env file with your credentials.
    pause
    exit /b 1
)

echo Starting ClarityMeet Bot Server...
echo.
echo Your Cloudflare Tunnel URL:
echo    https://sur-immigrants-bizrate-picnic.trycloudflare.com
echo.
echo Make sure to:
echo    1. Start Cloudflare Tunnel in another terminal:
echo       cloudflared tunnel --url http://localhost:3000
echo.
echo    2. Update your Vercel frontend with the new tunnel URL
echo.
echo.

node server.js

if errorlevel 1 (
    echo.
    echo Server crashed with error
    pause
)

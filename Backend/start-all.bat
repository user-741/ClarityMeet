@echo off
echo =========================================
echo  ClarityMeet - Starting Backend + Tunnel
echo =========================================
echo.

REM Check if .env exists
if not exist ".env" (
    echo ERROR: .env file not found!
    echo Copy .env.example to .env and fill in your keys:
    echo   SUPABASE_SERVICE_ROLE_KEY=...
    echo   GEMINI_API_KEY=...
    pause
    exit /b 1
)

echo [1/2] Starting bot server on port 3000...
start "ClarityMeet Server" cmd /k "node server.js"

REM Wait a moment for the server to boot
timeout /t 2 /nobreak >nul

echo [2/2] Starting Cloudflare tunnel (HTTP/2 mode)...
echo.
echo  ==> When the tunnel URL appears below, copy it to Vercel:
echo      Settings ^> Environment Variables ^> BACKEND_URL
echo.
cloudflared tunnel --protocol http2 --url http://localhost:3000

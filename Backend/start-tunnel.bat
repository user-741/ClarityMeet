@echo off
echo =========================================
echo  ClarityMeet - Starting Cloudflare Tunnel
echo =========================================
echo.
echo  Using HTTP/2 protocol (fixes QUIC timeout errors on Windows)
echo  When the tunnel URL appears, copy it to Vercel:
echo  Vercel Dashboard ^> uni project ^> Settings ^> Environment Variables
echo  Set: BACKEND_URL = https://xxxx.trycloudflare.com
echo.
echo.
cloudflared tunnel --protocol http2 --url http://localhost:3000
pause

# ClarityMeet - Local Bot Server Startup Script
# Run this on your laptop. A browser window will open for each meeting.
# You click Join once per session, then the bot records automatically.
#
# PREREQUISITES (one-time setup):
#   1. Node.js 20+: https://nodejs.org
#   2. ffmpeg: https://ffmpeg.org/download.html (add to PATH)
#   3. In this folder: npm install
#   4. Set your secrets in a .env file (copy .env.example)
#
# USAGE:
#   .\start-local.ps1
#   Then run the tunnel in a second terminal:
#   npx cloudflared tunnel --url http://localhost:3000
#   Copy the tunnel URL and set it as BACKEND_URL in Vercel env vars.

Write-Host "Starting ClarityMeet bot server on port 3000..." -ForegroundColor Cyan
Write-Host ""
Write-Host "When a customer pastes a Zoom link, a Chrome window will open." -ForegroundColor Yellow
Write-Host "Click the Join button once - the bot takes it from there." -ForegroundColor Yellow
Write-Host ""

# Start the server
node server.js

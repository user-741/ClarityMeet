# Runs the ClarityMeet backend in the background so the live site keeps working
# while you use the laptop for other things. No windows to keep open.
#   .\run-server.ps1          start (or restart) in the background
#   .\run-server.ps1 -Stop    stop it
#   .\run-server.ps1 -Status  check it is running
param([switch]$Stop, [switch]$Status)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidFile = Join-Path $root '.server.pid'
$logDir = Join-Path $root '.logs'

function Stop-Server {
  if (Test-Path $pidFile) {
    $id = Get-Content $pidFile -ErrorAction SilentlyContinue
    if ($id) { taskkill /PID $id /T /F 2>$null | Out-Null }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  }
}

if ($Stop) { Stop-Server; Write-Host 'ClarityMeet backend stopped.'; exit 0 }

if ($Status) {
  try {
    $h = Invoke-RestMethod -Uri 'http://localhost:3001/health' -TimeoutSec 5
    Write-Host "Backend running. AI ready: $($h.ai_enabled)  Bots: $($h.bots)" -ForegroundColor Green
  } catch { Write-Host 'Backend is not responding.' -ForegroundColor Yellow }
  $last = Get-Content (Join-Path $logDir 'keep-alive.log') -Tail 5 -ErrorAction SilentlyContinue
  if ($last) { Write-Host ''; $last }
  exit 0
}

Stop-Server
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$p = Start-Process -FilePath 'powershell' -WindowStyle Hidden -PassThru -ArgumentList @(
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $root 'Backend\keep-alive.ps1')
)
Set-Content -Path $pidFile -Value $p.Id
Write-Host 'ClarityMeet backend is starting in the background.' -ForegroundColor Green
Write-Host 'It keeps running when you switch desktops or close this window.'
Write-Host 'Check it:  .\run-server.ps1 -Status     Stop it:  .\run-server.ps1 -Stop'
Write-Host "Logs: $logDir"

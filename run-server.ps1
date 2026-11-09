# Starts the backend in the background.
#   .\run-server.ps1 / -Status / -Stop
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

if ($Stop) { Stop-Server; Write-Host 'Stopped.'; exit 0 }

if ($Status) {
  try {
    Invoke-RestMethod -Uri 'http://localhost:3001/health' -TimeoutSec 5 | Out-Null
    Write-Host 'Running.' -ForegroundColor Green
  } catch { Write-Host 'Not running.' -ForegroundColor Yellow }
  exit 0
}

Stop-Server
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$p = Start-Process -FilePath 'powershell' -WindowStyle Hidden -PassThru -ArgumentList @(
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $root 'Backend\keep-alive.ps1')
)
Set-Content -Path $pidFile -Value $p.Id
Write-Host 'Started.' -ForegroundColor Green

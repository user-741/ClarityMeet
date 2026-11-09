# Started hidden by run-server.ps1. Keeps the backend and its tunnel running,
# restarts either if it stops, and stops the laptop sleeping while it runs.
$ErrorActionPreference = 'Continue'
$backend = $PSScriptRoot
$root = Split-Path -Parent $backend
$logDir = Join-Path $root '.logs'
$log = Join-Path $logDir 'keep-alive.log'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Say($msg) { Add-Content -Path $log -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg" }

Add-Type -Namespace Cm -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);'
# ES_CONTINUOUS | ES_SYSTEM_REQUIRED: no sleep while this runs (the screen can still turn off).
[Cm.Power]::SetThreadExecutionState([uint32]2147483649) | Out-Null

$cloudflared = (Get-Command 'cloudflared' -ErrorAction SilentlyContinue).Source
if (-not $cloudflared) { Say 'cloudflared not found on PATH'; exit 1 }
$nodemon = Join-Path $backend 'node_modules\.bin\nodemon.cmd'

$server = $null; $tunnel = $null; $fails = 0

function Start-Backend {
  $out = Join-Path $logDir 'backend.log'
  if (Test-Path $nodemon) {
    $script:server = Start-Process -FilePath $nodemon -ArgumentList 'server.js' -WorkingDirectory $backend -WindowStyle Hidden -PassThru -RedirectStandardOutput $out -RedirectStandardError (Join-Path $logDir 'backend.err.log')
  } else {
    $script:server = Start-Process -FilePath 'node' -ArgumentList 'server.js' -WorkingDirectory $backend -WindowStyle Hidden -PassThru -RedirectStandardOutput $out -RedirectStandardError (Join-Path $logDir 'backend.err.log')
  }
  Say "backend started (pid $($script:server.Id))"
}

function Start-Tunnel {
  $tlog = Join-Path $logDir 'tunnel.log'
  Remove-Item $tlog -Force -ErrorAction SilentlyContinue
  $script:tunnel = Start-Process -FilePath $cloudflared -ArgumentList @('tunnel', '--protocol', 'http2', '--url', 'http://localhost:3001') -WindowStyle Hidden -PassThru -RedirectStandardError $tlog -RedirectStandardOutput (Join-Path $logDir 'tunnel.out.log')
  $url = $null
  for ($i = 0; $i -lt 45 -and -not $url; $i++) {
    Start-Sleep -Seconds 1
    $text = Get-Content $tlog -Raw -ErrorAction SilentlyContinue
    if ($text -match 'https://[a-z0-9-]+\.trycloudflare\.com') { $url = $Matches[0] }
  }
  if ($url) {
    Push-Location $backend
    $msg = node register-url.js $url 2>&1
    Pop-Location
    Say "tunnel up: $url ($msg)"
  } else {
    Say 'tunnel started but no address yet, will retry'
  }
}

Say 'keep-alive starting'
Start-Backend
Start-Sleep -Seconds 6
Start-Tunnel

while ($true) {
  Start-Sleep -Seconds 30
  if (-not $server -or $server.HasExited) { Say 'backend stopped, restarting'; Start-Backend; Start-Sleep -Seconds 6 }
  if (-not $tunnel -or $tunnel.HasExited) { Say 'tunnel stopped, restarting'; Start-Tunnel; continue }
  try {
    Invoke-RestMethod -Uri 'http://localhost:3001/health' -TimeoutSec 8 | Out-Null
    $fails = 0
  } catch {
    $fails++
    if ($fails -ge 3) {
      Say 'backend not answering, restarting'
      if ($server -and -not $server.HasExited) { taskkill /PID $server.Id /T /F 2>$null | Out-Null }
      Start-Backend; $fails = 0
    }
  }
}

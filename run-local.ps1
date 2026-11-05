param(
  # Use -Dev for hot reload while editing code. Without it the site runs as an
  # optimised production build, which is far faster to click around (dev mode
  # compiles every page the first time you open it).
  [switch]$Dev
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Stop-ManagedProcess {
  param([int]$ProcessId)
  if ($ProcessId -gt 0) {
    try { Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue } catch {}
  }
}

$frontendPid = $null
$backendPid = $null
$tunnelPid = $null
$backendTunnelPid = $null

try {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js is not installed or not on PATH.'
  }

  $cloudflaredCmd = Get-Command 'cloudflared.cmd' -ErrorAction SilentlyContinue
  if (-not $cloudflaredCmd) {
    throw 'cloudflared is not installed or not on PATH.'
  }

  if (-not (Test-Path (Join-Path $root 'node_modules'))) {
    Write-Host 'Installing frontend dependencies...'
    npm install
  }

  if (-not (Test-Path (Join-Path $root 'Backend/node_modules'))) {
    Write-Host 'Installing backend dependencies...'
    Set-Location (Join-Path $root 'Backend')
    npm install
    Set-Location $root
  }

  $frontendPort = if ($env:PORT_FRONTEND) { $env:PORT_FRONTEND } else { '3000' }
  $backendPort = if ($env:PORT_BACKEND) { $env:PORT_BACKEND } else { '3001' }

  Write-Host "Starting backend on port $backendPort..."
  $backendProcess = Start-Process -FilePath 'powershell' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-Command',"Set-Location '$($root)\Backend'; Set-Item -Path Env:PORT -Value '$backendPort'; npm run dev") -PassThru
  $backendPid = $backendProcess.Id

  Start-Sleep -Seconds 5

  $frontendCmd = 'npm run dev'
  if (-not $Dev) {
    # Rebuild only when the code changed since the last build.
    $buildId = Join-Path $root '.next/BUILD_ID'
    $needsBuild = -not (Test-Path $buildId)
    if (-not $needsBuild) {
      $builtAt = (Get-Item $buildId).LastWriteTime
      $newest = Get-ChildItem -Path (Join-Path $root 'app'), (Join-Path $root 'lib'), (Join-Path $root 'types') -Recurse -File |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
      $configChanged = @('package.json','next.config.js','.env.local') |
        ForEach-Object { Join-Path $root $_ } | Where-Object { Test-Path $_ } |
        Where-Object { (Get-Item $_).LastWriteTime -gt $builtAt }
      $needsBuild = ($newest -and $newest.LastWriteTime -gt $builtAt) -or $configChanged
    }
    if ($needsBuild) {
      Write-Host 'Building the site (only needed after code changes, ~1-2 min)...'
      npm run build
      if ($LASTEXITCODE -ne 0) {
        Write-Host 'Build failed - falling back to dev mode so you can still use the site.' -ForegroundColor Yellow
      } else {
        $frontendCmd = 'npm run start'
      }
    } else {
      $frontendCmd = 'npm run start'
    }
  }

  Write-Host "Starting frontend on port $frontendPort ($frontendCmd)..."
  $frontendProcess = Start-Process -FilePath 'powershell' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-Command',"Set-Location '$root'; $frontendCmd") -PassThru
  $frontendPid = $frontendProcess.Id

  Start-Sleep -Seconds 8

  # Tunnel for the bot backend, so the live site (Vercel) can reach this laptop.
  # The address changes every run, so it is saved to Supabase automatically.
  Write-Host 'Connecting this laptop to the live site...'
  $beLog = Join-Path $root '.tunnel-backend.log'
  if (Test-Path $beLog) { Remove-Item $beLog -Force -ErrorAction SilentlyContinue }
  $backendTunnel = Start-Process -FilePath $cloudflaredCmd.Source -ArgumentList @('tunnel','--protocol','http2','--url',"http://localhost:$backendPort") -RedirectStandardError $beLog -RedirectStandardOutput (Join-Path $root '.tunnel-backend.out.log') -PassThru
  $backendTunnelPid = $backendTunnel.Id
  $backendPublic = $null
  for ($i = 0; $i -lt 40 -and -not $backendPublic; $i++) {
    Start-Sleep -Seconds 1
    $log = Get-Content $beLog -Raw -ErrorAction SilentlyContinue
    if ($log -match 'https://[a-z0-9-]+\.trycloudflare\.com') { $backendPublic = $Matches[0] }
  }
  if ($backendPublic) {
    Push-Location (Join-Path $root 'Backend')
    node register-url.js $backendPublic
    Pop-Location
  } else {
    Write-Host 'Could not get a backend tunnel address - the live site will not reach the bot until you restart.' -ForegroundColor Yellow
  }

  Write-Host 'Starting public cloudflared tunnel...'
  Write-Host ''
  Write-Host 'ClarityMeet local stack is starting...'
  Write-Host "Frontend: http://localhost:$frontendPort"
  Write-Host "Backend: http://localhost:$backendPort/health"
  Write-Host 'Press Ctrl+C to stop everything.'
  Write-Host ''

  $tunnelLog = Join-Path $root '.tunnel.log'
  $tunnelErrLog = Join-Path $root '.tunnel.err.log'
  if (Test-Path $tunnelLog) {
    Remove-Item $tunnelLog -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path $tunnelErrLog) {
    Remove-Item $tunnelErrLog -Force -ErrorAction SilentlyContinue
  }

  $tunnelProcess = Start-Process -FilePath $cloudflaredCmd.Source -ArgumentList @('tunnel','--url',"http://localhost:$frontendPort") -RedirectStandardOutput $tunnelLog -RedirectStandardError $tunnelErrLog -PassThru
  $tunnelPid = $tunnelProcess.Id

  $publicUrl = $null
  for ($i = 0; $i -lt 30 -and -not $publicUrl; $i++) {
    Start-Sleep -Seconds 1
    $combinedLog = ''
    if (Test-Path $tunnelLog) {
      $combinedLog += Get-Content $tunnelLog -Raw -ErrorAction SilentlyContinue
    }
    if (Test-Path $tunnelErrLog) {
      $combinedLog += "`n"
      $combinedLog += Get-Content $tunnelErrLog -Raw -ErrorAction SilentlyContinue
    }
    if ($combinedLog -match 'https://[a-z0-9-]+\.trycloudflare\.com') {
      $publicUrl = $Matches[0]
    }
  }

  if ($publicUrl) {
    Write-Host 'You can test the site now using:'
    Write-Host $publicUrl
    Write-Host ''
  } else {
    Write-Host 'Cloudflared started, but the public URL has not been detected yet.'
    Write-Host "Check the tunnel logs at $tunnelLog and $tunnelErrLog"
    Write-Host ''
  }

  Wait-Process -Id $tunnelPid
}
finally {
  Stop-ManagedProcess -ProcessId $tunnelPid
  Stop-ManagedProcess -ProcessId $backendTunnelPid
  Stop-ManagedProcess -ProcessId $frontendPid
  Stop-ManagedProcess -ProcessId $backendPid
}

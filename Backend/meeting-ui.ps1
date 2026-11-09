# Reads and clicks Zoom / Teams meeting controls through Windows UI Automation.
#   -Action join    clicks "Join now" (Teams) or "Join with Computer Audio" (Zoom)
#   -Action incall  prints yes if a Leave / End button is showing, otherwise no
param([string]$Action, [string]$App, [int]$Timeout = 90)

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$AE = [System.Windows.Automation.AutomationElement]
$CT = [System.Windows.Automation.ControlType]
$Scope = [System.Windows.Automation.TreeScope]
$names = if ($App -eq 'teams') { @('ms-teams', 'Teams') } else { @('Zoom') }

function Get-AppWindows {
  $ids = @(Get-Process -Name $names -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
  if (-not $ids) { return @() }
  $cond = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, $CT::Window)
  return @($AE::RootElement.FindAll($Scope::Children, $cond) | Where-Object { $ids -contains $_.Current.ProcessId })
}

function Find-Button($win, $pattern) {
  $cond = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, $CT::Button)
  foreach ($b in $win.FindAll($Scope::Descendants, $cond)) {
    if ($b.Current.Name -match $pattern -and $b.Current.IsEnabled) { return $b }
  }
  return $null
}

if ($Action -eq 'join') {
  $pattern = if ($App -eq 'teams') { '^Join now$' } else { 'Join with Computer Audio|Join Audio by Computer' }
  $end = (Get-Date).AddSeconds($Timeout)
  while ((Get-Date) -lt $end) {
    foreach ($w in Get-AppWindows) {
      $b = Find-Button $w $pattern
      if ($b) {
        try {
          $b.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
          Write-Output 'joined'; exit 0
        } catch {}
      }
    }
    Start-Sleep -Seconds 2
  }
  Write-Output 'timeout'; exit 0
}

if ($Action -eq 'incall') {
  foreach ($w in Get-AppWindows) {
    if (Find-Button $w '^(Leave|End)\b|^Leave call|Hang up') { Write-Output 'yes'; exit 0 }
  }
  Write-Output 'no'; exit 0
}

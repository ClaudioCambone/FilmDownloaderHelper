$ErrorActionPreference = "Stop"

$projectDir = "C:\Users\terra\Documents\Test\telegram-download-assistant"
$logFile = Join-Path $projectDir "bot.log"
$pidFile = Join-Path $projectDir "bot.pid"
$entryPath = Join-Path $projectDir "index.js"

$targets = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match [regex]::Escape($entryPath) }

if (-not $targets) {
  Write-Host "Nessun bot locale attivo trovato."
  if (Test-Path $pidFile) {
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  }
  exit 0
}

$stopped = @()
foreach ($p in $targets) {
  try {
    Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop
    $stopped += $p.ProcessId
  } catch {
    Write-Warning "Impossibile fermare PID $($p.ProcessId): $($_.Exception.Message)"
  }
}

if ($stopped.Count -gt 0) {
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  "[$timestamp] Manual stop requested - stopped PID: $($stopped -join ', ')" | Add-Content -Path $logFile -Encoding utf8
  Write-Host "Bot fermato. PID: $($stopped -join ', ')"
}

if (Test-Path $pidFile) {
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

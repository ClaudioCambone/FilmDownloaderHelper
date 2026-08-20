$ErrorActionPreference = "Stop"

$projectDir = "C:\Users\terra\Documents\Test\telegram-download-assistant"
$logFile = Join-Path $projectDir "bot.log"
$pidFile = Join-Path $projectDir "bot.pid"
$runnerScript = Join-Path $projectDir "start-local-bot.ps1"
$entryPath = Join-Path $projectDir "index.js"

if (-not (Test-Path $runnerScript)) {
  Write-Error "Script runner non trovato: $runnerScript"
}

$existing = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match [regex]::Escape($entryPath) }

if ($existing) {
  $ids = ($existing | Select-Object -ExpandProperty ProcessId) -join ", "
  Write-Host "Bot gia avviato (PID: $ids)."
  exit 0
}

$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
"[$timestamp] Manual start requested" | Add-Content -Path $logFile -Encoding utf8

$args = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runnerScript`""
$proc = Start-Process -FilePath "powershell.exe" -ArgumentList $args -WorkingDirectory $projectDir -WindowStyle Hidden -PassThru
Set-Content -Path $pidFile -Value $proc.Id -Encoding ascii

Write-Host "Richiesta avvio inviata. Launcher PID: $($proc.Id)"
Write-Host "Log: $logFile"

$ErrorActionPreference = "Stop"

$projectDir = "C:\Users\terra\Documents\Test\telegram-download-assistant"
$nodeExe = "C:\Program Files\nodejs\node.exe"
$qbitExe = "C:\Program Files\qBittorrent\qbittorrent.exe"
$qbitUrl = "http://127.0.0.1:8080"
$entry = "index.js"
$entryPath = Join-Path $projectDir $entry
$logFile = Join-Path $projectDir "bot.log"
$errorLogFile = Join-Path $projectDir "bot-error.log"
$startupLogFile = Join-Path $projectDir "startup.log"

function Write-StartupLog($message) {
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  "[$timestamp] $message" | Add-Content -Path $startupLogFile -Encoding utf8
}

Write-StartupLog "start-local-bot.ps1 started"

if (-not (Test-Path $nodeExe)) {
  Write-StartupLog "ERROR: Node executable not found: $nodeExe"
  throw "Node executable not found: $nodeExe"
}

if (-not (Get-Process -Name qbittorrent -ErrorAction SilentlyContinue)) {
  if (Test-Path $qbitExe) {
    Write-StartupLog "qBittorrent is not running. Starting: $qbitExe"
    Start-Process -FilePath $qbitExe -WindowStyle Minimized
  } else {
    Write-StartupLog "WARNING: qBittorrent executable not found: $qbitExe"
  }
} else {
  Write-StartupLog "qBittorrent process already running"
}

$qbitReady = $false
for ($attempt = 1; $attempt -le 30; $attempt += 1) {
  try {
    $response = Invoke-WebRequest -Uri "$qbitUrl/api/v2/app/version" -UseBasicParsing -TimeoutSec 2
    if ($response.StatusCode -eq 200) {
      $qbitReady = $true
      Write-StartupLog "qBittorrent WebUI ready on attempt $attempt"
      break
    }
  } catch {
    Write-StartupLog "Waiting for qBittorrent WebUI attempt $attempt/30: $($_.Exception.Message)"
    Start-Sleep -Seconds 2
  }
}

if (-not $qbitReady) {
  Write-StartupLog "WARNING: qBittorrent WebUI did not become ready before bot start"
}

# Prevent Telegram 409 conflicts by ensuring only one local polling instance.
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match [regex]::Escape($entryPath) } |
  ForEach-Object {
    try {
      Write-StartupLog "Stopping existing bot process PID $($_.ProcessId)"
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    } catch {
      # Ignore race conditions if process exits meanwhile.
    }
  }

Set-Location $projectDir

$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
"[$timestamp] Starting local polling bot" | Add-Content -Path $logFile -Encoding utf8
Write-StartupLog "Starting Node bot: $nodeExe $entryPath"

try {
  $nodeProc = Start-Process `
    -FilePath $nodeExe `
    -ArgumentList "`"$entryPath`"" `
    -WorkingDirectory $projectDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $logFile `
    -RedirectStandardError $errorLogFile `
    -PassThru
  Write-StartupLog "Node bot launched. PID: $($nodeProc.Id)"
} catch {
  $timestampErr = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  "[$timestampErr] Startup runner error: $($_.Exception.Message)" | Add-Content -Path $logFile -Encoding utf8
  Write-StartupLog "ERROR: Node bot failed: $($_.Exception.Message)"
  throw
}

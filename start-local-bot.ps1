$ErrorActionPreference = "Stop"

$projectDir = "C:\Users\terra\Documents\Test\telegram-download-assistant"
$nodeExe = "C:\Program Files\nodejs\node.exe"
$entry = "index.js"
$entryPath = Join-Path $projectDir $entry
$logFile = Join-Path $projectDir "bot.log"

# Prevent Telegram 409 conflicts by ensuring only one local polling instance.
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match [regex]::Escape($entryPath) } |
  ForEach-Object {
    try {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    } catch {
      # Ignore race conditions if process exits meanwhile.
    }
  }

Set-Location $projectDir

$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
"[$timestamp] Starting local polling bot" | Add-Content -Path $logFile -Encoding utf8

& $nodeExe $entryPath *> $logFile

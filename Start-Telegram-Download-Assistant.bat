@echo off
set "PROJECT=C:\Users\terra\Documents\Test\telegram-download-assistant"
set "POWERSHELL=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
set "STARTUP_LOG=%PROJECT%\startup.log"

cd /d "%PROJECT%"
echo [%date% %time%] Startup launcher started>>"%STARTUP_LOG%"

start "Telegram Download Assistant" /min "%POWERSHELL%" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%PROJECT%\start-manual.ps1" >>"%STARTUP_LOG%" 2>&1

if errorlevel 1 echo [%date% %time%] Failed to launch PowerShell>>"%STARTUP_LOG%"

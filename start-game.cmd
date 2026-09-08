@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Требуется Node.js 22.13 или новее: https://nodejs.org/
  pause
  exit /b 1
)
if not exist node_modules (
  call npm.cmd ci
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
node scripts\ensure-build.mjs server
if errorlevel 1 (
  pause
  exit /b 1
)
echo Street Racer: откройте http://localhost:3000 в браузере.
echo Оставьте это окно открытым. Для остановки сервера нажмите Ctrl+C.
call npm.cmd start -- --ip 127.0.0.1 --port 3000 --log-level warn
pause

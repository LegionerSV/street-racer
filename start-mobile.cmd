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
if not exist out\index.html (
  echo Подготавливаем игру для телефона.
  call npm.cmd run build:pages
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
echo Подключите телефон и компьютер к одной домашней сети Wi-Fi.
echo Откройте на телефоне адрес из строки Network ниже, включая /street-racer/.
echo На компьютере: http://localhost:3001/street-racer/
echo Оставьте это окно открытым. Для остановки нажмите Ctrl+C.
call npm.cmd run preview:pages -- --host 0.0.0.0 --port 3001
pause

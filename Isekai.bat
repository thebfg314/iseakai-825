@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed, or it is not on your PATH.
  echo Install it from https://nodejs.org then double-click Isekai.vbs again.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo First launch: installing game files. This can take a minute...
  call npm install
  if errorlevel 1 (
    echo Install failed. Check the messages above.
    pause
    exit /b 1
  )
)

call npm run dev

@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo Starting dostoori (Next.js) dev server...
start "dostoori-dev-server" cmd /k "npm run dev"

echo Waiting for server to start...
timeout /t 5 /nobreak >nul

echo Opening in Chrome...
start chrome http://localhost:3000

exit

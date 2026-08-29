@echo off
title AI Legal - Dev Server
cd /d "%~dp0"

echo Starting the Next.js dev server on port 4000 (3000 is used by the dastory platform; Dostoori's AI_LEGAL_SERVICE_URL points here)...
start "AI Legal Dev Server" cmd /k npm run dev -- -p 4000

echo Waiting for the server to boot...
timeout /t 5 /nobreak >nul

start "" http://localhost:4000

echo.
echo Done. The server is running in its own window titled "AI Legal Dev Server".
echo Close that window (or press Ctrl+C inside it) to stop the server.
echo This window can be closed now.
pause >nul

@echo off
title Dow - Local Edition Server
echo ====================================================
echo  Starting Dow Local Edition Server (yt-dlp Engine)
echo ====================================================
echo.
echo Launching web browser at http://localhost:8085 ...
timeout /t 2 /nobreak >nul
start http://localhost:8085
echo.
node server.js
pause

@echo off
REM Starts the ClassPulse school server on this Windows PC. Needs Node.js 22 or newer (nodejs.org).
cd /d "%~dp0\.."
node server\server.cjs --port 8787
pause

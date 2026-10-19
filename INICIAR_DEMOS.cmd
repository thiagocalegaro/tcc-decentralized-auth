@echo off
setlocal
cd /d "%~dp0"
call npm ci
if errorlevel 1 goto :error
call npm run build
if errorlevel 1 goto :error
call npm run dev:demos
if errorlevel 1 goto :error
exit /b 0
:error
echo Nao foi possivel iniciar as demos locais.
pause
exit /b 1

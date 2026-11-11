@echo off
setlocal
cd /d "%~dp0"
call :dependencies
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

:dependencies
if exist "node_modules\.package-lock.json" if exist "node_modules\.bin\tsc.cmd" if exist "node_modules\.bin\tsx.cmd" if exist "node_modules\.bin\esbuild.cmd" exit /b 0
call npm ci
if errorlevel 1 exit /b 1
if not exist "node_modules\.bin\tsc.cmd" exit /b 1
if not exist "node_modules\.bin\tsx.cmd" exit /b 1
if not exist "node_modules\.bin\esbuild.cmd" exit /b 1
exit /b 0

@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Instale Node.js 22.13 ou superior.
  pause
  exit /b 1
)
call :dependencies
if errorlevel 1 goto :error
call npm run setup
if errorlevel 1 goto :error
call npm run build
if errorlevel 1 goto :error
echo Abra http://localhost:4200/portal
call npm start
if errorlevel 1 goto :error
exit /b 0
:error
echo Nao foi possivel iniciar. Confira a mensagem acima.
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

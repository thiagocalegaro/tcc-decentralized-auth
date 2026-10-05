@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Instale o Node.js 22.13 ou superior antes de continuar.
  pause
  exit /b 1
)
if not exist node_modules (
  call npm ci
  if errorlevel 1 goto :error
)
call npm run setup
if errorlevel 1 goto :error
call npm run build
if errorlevel 1 goto :error
echo Abra http://localhost:4201 e http://localhost:4202 no navegador.
call npm start
if errorlevel 1 goto :error
exit /b 0
:error
echo Nao foi possivel iniciar. Confira a mensagem acima.
pause
exit /b 1

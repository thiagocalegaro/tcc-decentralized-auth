@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Instale Node.js 22.12 ou superior antes de continuar.
  pause
  exit /b 1
)
if not exist node_modules\tsx\package.json (
  call npm.cmd ci
  if errorlevel 1 goto failed
)
call npm.cmd run setup
if errorlevel 1 goto failed
echo.
echo Abra http://localhost:5173 no navegador com sua carteira.
echo Use Ctrl+C para encerrar os servicos.
call npm.cmd run dev
if errorlevel 1 goto failed
exit /b 0
:failed
echo Nao foi possivel iniciar. Confira a mensagem acima e o README.md.
pause
exit /b 1

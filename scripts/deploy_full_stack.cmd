@echo off
setlocal

cd /d "%~dp0.."

docker compose up -d --build
if errorlevel 1 exit /b %errorlevel%

if "%DEPLOY_DIFY%"=="1" (
  if exist "%~dp0deploy_dify_official.cmd" (
    call "%~dp0deploy_dify_official.cmd"
  ) else if exist "%~dp0deploy_dify_official.sh" (
    bash "%~dp0deploy_dify_official.sh"
  )
)

endlocal

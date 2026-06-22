@echo off
chcp 936 >nul
cd /d "%~dp0"
title 视频号爆款 启动/重启

echo ============================================
echo    视频号爆款  一键启动 (后端8001 + 前端5173)
echo ============================================
echo.
echo [1/3] 关闭旧后端 (确保加载最新 .env / 代码)...
taskkill /F /FI "WINDOWTITLE eq backend-8001*" /T >nul 2>&1
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8001 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"
timeout /t 1 >nul

echo [2/3] 启动后端 uvicorn:8001 ...
start "backend-8001" cmd /k ""D:\图片\爱马仕\hermes-agent\venv\Scripts\python.exe" -m uvicorn backend.main:app --host 0.0.0.0 --port 8001"

echo [3/3] 启动前端 vite:5173 (已在运行则跳过)...
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }"
if errorlevel 1 (
  echo       前端 5173 已在运行, 跳过.
) else (
  start "frontend-5173" cmd /k npm --prefix frontend run dev
)

echo.
echo 等待服务就绪, 即将打开浏览器...
timeout /t 6 >nul
start "" http://localhost:5173

echo.
echo 完成! 后端日志在 [backend-8001] 窗口, 前端日志在 [frontend-5173] 窗口.
echo 改了 .env 或后端代码后, 重新双击本文件即可干净重启后端.
timeout /t 4 >nul

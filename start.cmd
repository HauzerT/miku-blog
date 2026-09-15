@echo off
chcp 65001 >nul
title CV01 · 上传服务
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   没找到 node。先装一个 Node.js ^(18 以上^)，再回来双击这个文件。
  echo   https://nodejs.org/
  echo.
  pause
  exit /b 1
)

echo.
echo   正在启动上传服务…… 终端里会打印一串上传口令。
echo   关掉这个窗口就是停止服务。
echo.

node server/server.mjs %*

echo.
echo   服务已经停了。
pause

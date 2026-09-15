@echo off
chcp 65001 >nul
title CV01 · 云村服务（网易云扫码登录）
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
echo   正在启动云村小服务……
echo   它会替你保管网易云的登录凭证（.ncm-session.json，只在本机）。
echo.
echo   开着这个窗口，然后打开博客里的「云村」页：
echo     http://127.0.0.1:4321/kumura.html
echo.
echo   关掉这个窗口就是停止服务（登录状态还在，下次开窗口自动续上）。
echo.

node "%~dp0tools\ncm-server.mjs" %*

echo.
echo   云村服务已经停了。
pause

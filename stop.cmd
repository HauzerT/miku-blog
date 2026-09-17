@echo off
chcp 65001 >nul
title CV01 - stop services
cd /d "%~dp0"

rem Double-click this file to stop the Nuxt app and the kumura helper.
rem   list only:            stop.cmd -List
rem   stop by port:         stop.cmd -Port 8080
rem
rem All messages live in stop.ps1. This file stays pure ASCII on purpose:
rem cmd.exe mis-reads a UTF-8 batch file containing non-ASCII bytes and then
rem drops bytes from the following lines, which breaks the commands themselves.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop.ps1" %*
if errorlevel 1 (
  echo.
  echo   Not everything stopped - see the output above.
)

echo.
pause

@echo off
chcp 65001 >nul
title CV01 - kumura helper (NetEase Cloud Music)
cd /d "%~dp0"

rem Double-click this file to run ONLY the kumura helper (the Nuxt app's
rem /kumura page needs it for QR login). start.cmd already brings it up
rem together with the app; use this one when the app is already running.
rem
rem This file is pure ASCII on purpose: cmd.exe mis-reads a UTF-8 batch file
rem containing non-ASCII bytes and then drops bytes from the following lines,
rem which used to break the very line that launched node. All messages live
rem in the terminal output of tools\ncm-server.mjs (and in start.ps1).

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   node not found. Install Node.js 18 or newer, then run this again.
  echo   https://nodejs.org/
  echo.
  pause
  exit /b 1
)

echo.
echo   Starting the kumura helper...
echo   It keeps your NetEase Cloud Music login state in .ncm-session.json,
echo   on this machine only.
echo.
echo   Keep this window open, then open the kumura page of the blog:
echo     http://127.0.0.1:4321/kumura
echo.
echo   Closing this window stops the helper (the login state is kept).
echo.

node "%~dp0tools\ncm-server.mjs" %*

echo.
echo   The kumura helper has stopped.
pause

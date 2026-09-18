@echo off
chcp 65001 >nul
title CV01 - start Nuxt app
cd /d "%~dp0"

rem Double-click this file to start the Nuxt app AND the kumura helper
rem (both at once, so the kumura page works right away).
rem   change the port:         start.cmd 3000
rem   Nuxt app only:           start.cmd -NoKumura
rem   do not auto-build:       start.cmd -NoBuild
rem   open the entry:          start.cmd -Open
rem   stop both:               stop.cmd
rem
rem It prints the ENTRY URL, the lobby state and the passphrase, then runs the
rem BUILD OUTPUT: .output\server\index.mjs (from the repo root).
rem Opening the entry lands on the lobby first (/login) - that is the gate.
rem If the build output is missing, start.ps1 installs deps and builds the site
rem once (about a minute); with -NoBuild it prints the two commands and exits
rem non-zero instead of pretending a server came up.
rem
rem All messages live in start.ps1. This file stays pure ASCII on purpose:
rem cmd.exe mis-reads a UTF-8 batch file containing non-ASCII bytes and then
rem drops bytes from the following lines - which used to break the very line
rem that launched node.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
if errorlevel 1 (
  echo.
  echo   Start failed - see the message above.
)

echo.
pause

@echo off
chcp 65001 >nul
title CV01 - start upload service
cd /d "%~dp0"

rem Double-click this file to start the upload service AND the kumura helper
rem (both at once, so kumura.html works right away).
rem   change the upload port:   start.cmd 8080
rem   upload service only:      start.cmd -NoKumura
rem   stop both:                stop.cmd
rem
rem All messages live in start.ps1. This file stays pure ASCII on purpose:
rem cmd.exe mis-reads a UTF-8 batch file containing non-ASCII bytes and then
rem drops bytes from the following lines - which used to break the very line
rem that launched node.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*

echo.
pause

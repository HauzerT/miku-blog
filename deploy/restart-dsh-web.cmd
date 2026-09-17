@echo off
REM ===========================================================================
REM  CV01 : restart DSH web with --trusted-host (double-click me)
REM  ---------------------------------------------------------------------------
REM  Restarting mints a new launch token: every logged-in browser (this PC and
REM  your phone) is logged out and must reopen the new URL. The two fresh
REM  token URLs are written to deploy\dsh-web-url.txt.
REM ===========================================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-dsh-web.ps1" -Restart
echo.
pause

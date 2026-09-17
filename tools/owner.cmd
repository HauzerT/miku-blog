@echo off
REM ===========================================================================
REM  CV01 : one double-click for the owner to get in (bare ASCII on purpose)
REM  ---------------------------------------------------------------------------
REM  1. starts the origin server in the background if it is not running
REM     (idempotent - reuses deploy\start-blog-background.cmd)
REM  2. puts the upload passphrase on the clipboard (nothing shown on screen)
REM  3. opens the login gate in the default browser (login.html#owner)
REM
REM  At the gate: Ctrl+V into the passphrase field, then click "enter".
REM  If the browser offers to save the password, say yes - after that the
REM  browser fills it in for you (or unlocks it with Windows Hello).
REM
REM  Chinese lives in owner.ps1 only (saved as UTF-8 WITH BOM). cmd.exe misreads
REM  non-ASCII bytes in a UTF-8 batch file, so this file stays pure ASCII.
REM ===========================================================================
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0owner.ps1" %*
exit /b %ERRORLEVEL%

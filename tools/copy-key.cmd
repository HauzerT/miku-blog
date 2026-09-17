@echo off
REM ===========================================================================
REM  CV01 : copy the upload passphrase to the clipboard (bare ASCII on purpose)
REM  ---------------------------------------------------------------------------
REM  The passphrase is a 32-character random string now, so nobody types it.
REM  Run this, then press Ctrl+V in the login page's passphrase field.
REM
REM    tools\copy-key.cmd           copy it, do not print it
REM    tools\copy-key.cmd -Show     copy it and also print it
REM
REM  Why the cmd wrapper: PowerShell's default execution policy is Restricted on
REM  this machine, so double-clicking the .ps1 does nothing. This passes
REM  -ExecutionPolicy Bypass for this one invocation only.
REM
REM  Chinese lives in the .ps1 only (UTF-8 with BOM). cmd.exe misreads non-ASCII
REM  bytes in a UTF-8 batch file, so this file stays pure ASCII.
REM ===========================================================================
setlocal
set "PS1=%~dp0copy-key.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
exit /b %ERRORLEVEL%

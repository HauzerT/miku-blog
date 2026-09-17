@echo off
REM ===========================================================================
REM  CV01 : scan the repo for secrets before you push (double-click me)
REM  ---------------------------------------------------------------------------
REM  Same thing as:   node tools\secret-scan.mjs
REM  This wrapper just cd's to the repo root and pauses so a double-click
REM  can actually show you the report.
REM
REM  Exit code 0 = clean, 1 = something was found (the report says what).
REM  The pre-commit hook runs the --staged half of this automatically.
REM
REM  Bare ASCII on purpose - see README "why there is no Chinese in .cmd".
REM ===========================================================================
setlocal
cd /d "%~dp0.."
node "tools\secret-scan.mjs" %*
echo.
pause

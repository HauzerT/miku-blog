@echo off
REM ===========================================================================
REM  CV01 : start the blog origin server in the background (bare ASCII on purpose)
REM  ---------------------------------------------------------------------------
REM  Used by Windows Task Scheduler for the Cloudflare Tunnel deployment.
REM  It calls deploy\start-blog-background.ps1, which is idempotent: if something
REM  is already listening on 127.0.0.1:4321 it does nothing and exits 0.
REM
REM  It starts the Nuxt build output (.output\server\index.mjs, via start.ps1),
REM  so this machine must have run "pnpm install && pnpm build" at least once.
REM
REM  Usage:
REM    deploy\start-blog-background.cmd                 local use (as start.cmd)
REM    deploy\start-blog-background.cmd -PublicDeploy   public deploy, see below
REM    deploy\start-blog-background.cmd -Port 8080      other port
REM
REM  -PublicDeploy does two things you only want behind a tunnel:
REM    * does NOT start the kumura helper on 3170 (its neighbour file
REM      .ncm-session.json is your NetEase Cloud Music login state);
REM    * sets CV01_TRUST_PROXY=1 so /api/auth rate limiting counts the real
REM      visitor (CF-Connecting-IP) instead of lumping everyone under 127.0.0.1.
REM
REM  Logs :  deploy\blog-server.log  /  deploy\blog-server.err.log
REM
REM  Chinese lives in the .ps1 only (saved as UTF-8 WITH BOM). cmd.exe misreads
REM  non-ASCII bytes in a UTF-8 batch file and eats the following lines, so this
REM  file stays pure ASCII. See README("why no Chinese in the .cmd files").
REM ===========================================================================
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-blog-background.ps1" %*
exit /b %ERRORLEVEL%

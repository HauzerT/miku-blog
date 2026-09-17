# ============================================================================
#  CV01 · 确保 Cloudflare Tunnel 在跑（幂等）
#  ---------------------------------------------------------------------------
#  给 keepalive / 登录自启反复调用：已经有带着 miku-blog 配置在跑的
#  cloudflared 就直接退出（退出码 0），一个都没有才拉起一个隐藏实例。
#
#  配置在 %USERPROFILE%\.cloudflared\config.yml（两条 ingress + 404 兜底）：
#    n1ngzhu0.dpdns.org      -> 127.0.0.1:4321（博客源站）
#    dsh.n1ngzhu0.dpdns.org  -> 127.0.0.1:3080（DSH web 远控）
#
#  日志：deploy\tunnel.log / deploy\tunnel.err.log（都在 .gitignore 里）
# ============================================================================

$ErrorActionPreference = 'Stop'

$deployDir   = $PSScriptRoot
$cloudflared = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
$config      = Join-Path $env:USERPROFILE '.cloudflared\config.yml'

if (-not (Test-Path -LiteralPath $cloudflared)) {
    Write-Output "  找不到 cloudflared：$cloudflared"
    exit 1
}
if (-not (Test-Path -LiteralPath $config)) {
    Write-Output "  找不到隧道配置：$config（先按 deploy/CLOUDFLARE-TUNNEL.md 第 3 节建隧道）"
    exit 1
}

$running = @()
foreach ($p in @(Get-CimInstance Win32_Process -Filter "Name = 'cloudflared.exe'" -ErrorAction SilentlyContinue)) {
    if ($p.CommandLine -and $p.CommandLine -match 'miku-blog') { $running += $p }
}
if ($running.Count -gt 0) {
    Write-Output ('  tunnel 已在跑（PID ' + (@($running | ForEach-Object ProcessId) -join ', ') + '），不重复启动。')
    exit 0
}

$outLog = Join-Path $deployDir 'tunnel.log'
$errLog = Join-Path $deployDir 'tunnel.err.log'

Start-Process -FilePath $cloudflared `
    -ArgumentList @('--config', $config, 'tunnel', 'run', 'miku-blog') `
    -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $outLog -RedirectStandardError $errLog | Out-Null

# 给它几秒钟，确认真的连上了边缘
# 注意：cloudflared 的 INF 日志走 stderr（tunnel.err.log），stdout 基本是空的
$deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 800
    $tail = ''
    try { $tail = ((Get-Content $outLog -Tail 40 -ErrorAction SilentlyContinue) + (Get-Content $errLog -Tail 40 -ErrorAction SilentlyContinue)) -join "`n" } catch {}
    if ($tail -match 'Registered tunnel connection') {
        Write-Output '  tunnel 已启动并注册到 Cloudflare 边缘。'
        exit 0
    }
}
Write-Output '  tunnel 进程已拉起，30 秒内没看到注册成功，过会儿再看 deploy\tunnel.log。'
exit 1

# ============================================================================
#  CV01 · 确保 Cloudflare Tunnel 在跑（幂等）
#  ---------------------------------------------------------------------------
#  给 keepalive / 登录自启反复调用：已经有带着本隧道在跑的 cloudflared
#  就直接退出（退出码 0），一个都没有才拉起一个隐藏实例。
#
#  隧道名从 deploy\local.config.ps1 读——那份不进仓库（模板见同目录
#  local.config.example.ps1）。理由见 CLOUDFLARE-TUNNEL.md 第 11 节。
#
#  隧道配置在 %USERPROFILE%\.cloudflared\config.yml（两条 ingress + 404 兜底），
#  里面写的是这台机器自己的域名，同样不进仓库。
#
#  日志：deploy\tunnel.log / deploy\tunnel.err.log（都在 .gitignore 里）
# ============================================================================

$ErrorActionPreference = 'Stop'

$deployDir   = $PSScriptRoot
$cloudflared = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
$config      = Join-Path $env:USERPROFILE '.cloudflared\config.yml'

# ---------------------------------------------------------------- 本机实况
$localConfig = Join-Path $deployDir 'local.config.ps1'
if (-not (Test-Path -LiteralPath $localConfig)) {
    Write-Output "  缺少本机配置：$localConfig"
    Write-Output "  先复制模板再填：Copy-Item deploy\local.config.example.ps1 deploy\local.config.ps1"
    exit 1
}
. $localConfig

$tunnelName = $CV01_TUNNEL_NAME
if (-not $tunnelName) {
    Write-Output '  local.config.ps1 里没填隧道名（CV01_TUNNEL_NAME），不知道怎么起。'
    exit 1
}

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
    if ($p.CommandLine -and $p.CommandLine -match [regex]::Escape($tunnelName)) { $running += $p }
}
if ($running.Count -gt 0) {
    Write-Output ('  tunnel 已在跑（PID ' + (@($running | ForEach-Object ProcessId) -join ', ') + '），不重复启动。')
    exit 0
}

$outLog = Join-Path $deployDir 'tunnel.log'
$errLog = Join-Path $deployDir 'tunnel.err.log'

Start-Process -FilePath $cloudflared `
    -ArgumentList @('--config', $config, 'tunnel', 'run', $tunnelName) `
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

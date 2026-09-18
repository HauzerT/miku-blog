# ============================================================================
#  CV01 · 后台启动源站（给任务计划程序用）
#  ---------------------------------------------------------------------------
#  只做一件事：确认 127.0.0.1:4321 没人听，就把 start.ps1 在后台拉起来。
#  已经在跑就直接退出（退出码 0），所以可以被任务计划程序反复调用
#  ——「登录时」+「每 5 分钟」两个触发器上都挂一份，当看门狗用。
#
#    .\start-blog-background.ps1                 本机用：跟双击 start.cmd 一样
#    .\start-blog-background.ps1 -PublicDeploy   公网部署用，见下
#    .\start-blog-background.ps1 -Port 8080      换端口
#
#  -PublicDeploy 打开两件**只该在挂了 tunnel 时**做的事：
#
#    1. 不启动云村小服务（start.ps1 -NoKumura）。
#       它的端口 3170 旁边就是 .ncm-session.json——你的网易云登录态。
#       公网部署时它没有任何理由在跑，最省事的保证就是根本不起来。
#       （README 与 deploy/CLOUDFLARE-TUNNEL.md 第 9 节都写了这条。）
#
#    2. 给上传服务设 CV01_TRUST_PROXY=1：/api/auth 的试错限速按**真实来客**
#       （CF-Connecting-IP）计数，而不是全站共用一个 127.0.0.1 的桶。
#       这条只在「除了 cloudflared 没有别的路能连上这台服务」时才成立，
#       而服务只听 127.0.0.1 —— start.ps1 里写死了 NITRO_HOST=127.0.0.1
#       （Nitro 的默认值是所有网卡，公网部署不能用那个默认值），
#       这就是那条保证。
#
#  起的是 Nuxt 的构建产物 .output\server\index.mjs（由 start.ps1 负责），
#  所以这台机器必须先 pnpm install && pnpm build；没构建过 start.ps1 会明确报错。
#
#  日志：deploy\blog-server.log（标准输出；start.ps1 的口令横幅也在开头）
#        deploy\blog-server.err.log（标准错误）
#  中文只写在 .ps1 里并存成带 BOM 的 UTF-8；.cmd 保持纯 ASCII。
# ============================================================================

[CmdletBinding()]
param(
  [int]$Port = 4321,
  [switch]$Force,
  [switch]$PublicDeploy
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$deployDir = $PSScriptRoot
$outLog = Join-Path $deployDir 'blog-server.log'
$errLog = Join-Path $deployDir 'blog-server.err.log'
$startPs1 = Join-Path $root 'start.ps1'

function Test-Port([int]$p) {
  try { return @(Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue).Count -gt 0 }
  catch { return $false }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host '  没找到 node。先装一个 Node.js（18 以上）。' -ForegroundColor Yellow
  exit 1
}

if (Test-Port $Port) {
  if (-not $Force) {
    Write-Host "  Nuxt 应用已经在跑（端口 $Port），这次不重复启动。" -ForegroundColor DarkGray
    if ($PublicDeploy -and (Test-Port 3170)) {
      Write-Host '  -PublicDeploy：但云村小服务（3170）也在跑。公网部署时不该让它起来，' -ForegroundColor Yellow
      Write-Host '  它旁边就是 .ncm-session.json。用完记得 stop.cmd。' -ForegroundColor Yellow
    }
    exit 0
  }
  Write-Host "  -Force：端口 $Port 有人在听，仍然再起一个（大概率会因端口被占而失败）。" -ForegroundColor Yellow
}

if (-not (Test-Path -LiteralPath $startPs1)) {
  Write-Host "  找不到 $startPs1" -ForegroundColor Yellow
  exit 1
}

# 走 start.ps1，但**不用 cmd.exe /c 包一层**：那样收进程得靠 taskkill /T，
# 直接 powershell -File 更干净。
# -NoBuild：开机自启 / 守候进程只负责「把已有的产物跑起来」，缺产物要立刻失败
# 并留一行日志，而不是在后台悄悄跑一次一分钟的构建（那会把日志搅乱、把开机拖长）。
$psArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $startPs1, "$Port", '-NoBuild')
if ($PublicDeploy) { $psArgs += '-NoKumura' }

$env:CV01_TRUST_PROXY = if ($PublicDeploy) { '1' } else { '0' }

"[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] 后台启动 Nuxt 应用 · 端口 $Port · PublicDeploy=$([bool]$PublicDeploy) · TRUST_PROXY=$($env:CV01_TRUST_PROXY)" |
  Out-File -FilePath $outLog -Append -Encoding utf8

$proc = Start-Process -FilePath 'powershell.exe' `
  -ArgumentList $psArgs `
  -WorkingDirectory $root `
  -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput $outLog -RedirectStandardError $errLog

# 给它几秒钟，然后回头确认端口真的起来了
$deadline = (Get-Date).AddSeconds(20)
while ((Get-Date) -lt $deadline) {
  if (Test-Port $Port) {
    Write-Host "  Nuxt 应用已启动（PID $($proc.Id)），监听 127.0.0.1:$Port" -ForegroundColor Cyan
    if ($PublicDeploy) {
      Write-Host '  公网部署模式：云村小服务没有启动；限速按真实来客计数。' -ForegroundColor Cyan
    }
    Write-Host "  口令在上面的日志开头：$outLog" -ForegroundColor DarkGray
    exit 0
  }
  if ($proc.HasExited) {
    Write-Host "  启动失败：进程已退出（代码 $($proc.ExitCode)）。看 $errLog" -ForegroundColor Yellow
    exit 1
  }
  Start-Sleep -Milliseconds 500
}

Write-Host "  进程还在（PID $($proc.Id)），但 $Port 端口 20 秒内没起来。看 $outLog" -ForegroundColor Yellow
exit 1

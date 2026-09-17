# ============================================================================
#  CV01 · 启动（Nuxt 应用 + 云村小服务）
#  ---------------------------------------------------------------------------
#  双击 start.cmd 就会走到这里；也可以直接 .\start.ps1
#    .\start.ps1                起 Nuxt 应用，默认 4321，同时把云村小服务也拉起来
#    .\start.ps1 8080           换端口
#    .\start.ps1 -NoKumura      只要 Nuxt 应用，不碰云村
#  按 Ctrl+C 停止；窗口找不到了就双击 stop.cmd（两个服务它都会停）。
#
#  起的是**构建产物**：.output/server/index.mjs（在仓库根目录跑）。
#  它不在就说明这台机器还没构建过——脚本不会假装起了个服务，而是把该跑的两条
#  命令写清楚，然后以非零码退出（start.cmd 那边会看到 errorlevel）。
#
#  口令：Nuxt 那台服务自己不打印口令，所以由这里从 data/settings.json 读出来
#  打在横幅上（1.x 那台服务当年是自己打印的；换线不换习惯）。只读、不写，
#  也不会把口令落到任何新文件里。
#
#  云村小服务的端口看环境变量 NCM_PORT，默认 3170 —— 云村页
#  （assets/js/music.config.js）就是对着这个端口写的。端口已经在听就跳过，
#  不会去抢一个正在跑的实例；这次由本脚本拉起来的那个，会在退出时一并收掉。
#
#  中文只写在 .ps1 里（存成带 BOM 的 UTF-8，PowerShell 5.1 才读得对），
#  start.cmd / stop.cmd 保持纯 ASCII：cmd.exe 读含中文的 UTF-8 批处理
#  会读错字节偏移，把后面几行命令咬掉半截。
# ============================================================================

[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [int]$Port = 4321,
  [switch]$NoKumura
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$entry = Join-Path $PSScriptRoot '.output\server\index.mjs'
$settingsFile = Join-Path $PSScriptRoot 'data\settings.json'

function Test-Port([int]$p) {
  try { return @(Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue).Count -gt 0 }
  catch { return $false }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host ''
  Write-Host '  没找到 node。先装一个 Node.js（18 以上），再回来跑这个脚本。' -ForegroundColor Yellow
  Write-Host '  https://nodejs.org/'
  Write-Host ''
  exit 1
}

# 构建产物不在就**明确地失败**：宁可不启，也不要起一个空壳让人以为站点坏了。
if (-not (Test-Path -LiteralPath $entry)) {
  Write-Host ''
  Write-Host '  找不到构建产物：.output\server\index.mjs' -ForegroundColor Yellow
  Write-Host ''
  Write-Host '  Nuxt 那条线不是零构建的，成品要先构建一次（在仓库根目录跑）：' -ForegroundColor Yellow
  Write-Host ''
  Write-Host '    pnpm install' -ForegroundColor Cyan
  Write-Host '    pnpm build' -ForegroundColor Cyan
  Write-Host ''
  Write-Host '  构建完再双击一次 start.cmd 就行。' -ForegroundColor Yellow
  Write-Host ''
  exit 1
}

$ncmPort = 3170
if ($env:NCM_PORT) {
  try { $ncmPort = [int]$env:NCM_PORT } catch { $ncmPort = 3170 }
}

# ---------------------------------------------------------------- 口令横幅
# 服务端不打印口令（Nitro 那台没有这个习惯），所以这里补上——口令是本站唯一
# 的真权限，第一次上传 / 进门厅都要用它。只读 data/settings.json，不写任何东西。
$pass = ''
if (Test-Path -LiteralPath $settingsFile) {
  try {
    $settings = Get-Content -LiteralPath $settingsFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $pass = [string]$settings.passphrase
  } catch { $pass = '' }
}

# 后面 Node 那台服务要用同一个端口：PORT 是 Nuxt/Nitro 认的那个变量
$env:PORT = [string]$Port
# 只听本机。Nitro 的默认监听地址是**所有网卡**（0.0.0.0 / ::），那意味着同一个
# 局域网里的任何人都能直接访问这台服务——本机用不着，挂 tunnel 时更是个洞：
# Tunnel 与它是同一台机器上的邻居，127.0.0.1 就够，而且「除了 cloudflared
# 没有别的路能连上这台服务」这句话（限速按真实来客计数那一节）靠的就是它。
$env:NITRO_HOST = '127.0.0.1'

Write-Host ''
Write-Host '  正在启动 Nuxt 应用……' -ForegroundColor Cyan
Write-Host ("  地址        http://127.0.0.1:{0}/" -f $Port)
Write-Host '  按 Ctrl+C 停止；窗口找不到了就双击 stop.cmd（应用与云村小服务它都会停）。'
Write-Host '  ─────────────────────────────────────────────'
if ($pass) {
  Write-Host '  上传口令' -ForegroundColor Cyan
  Write-Host ("    {0}" -f $pass) -ForegroundColor Green
  Write-Host ("    长度 {0} 位 · 换一条：node tools\set-passphrase.mjs" -f $pass.Length) -ForegroundColor DarkGray
  Write-Host '    （不想手打：tools\copy-key.cmd 把它放进剪贴板，门厅里 Ctrl+V）' -ForegroundColor DarkGray
} else {
  Write-Host '  上传口令：还没有设置。' -ForegroundColor Yellow
  Write-Host '    node tools\set-passphrase.mjs 现在生成一条；设好之后重启本脚本就会打在上面。' -ForegroundColor Yellow
}
Write-Host ''

# ---------------------------------------------------------------- 云村小服务
# 云村页要它才能扫码登录网易云。跟 Nuxt 应用一起起来，省得多开一个窗口。
$ncmId = 0
if ($NoKumura) {
  Write-Host '  -NoKumura：这次不启动云村小服务。' -ForegroundColor DarkGray
  Write-Host ''
} elseif (Test-Port $ncmPort) {
  Write-Host "  云村小服务已经在跑（端口 $ncmPort），这次不重复启动。" -ForegroundColor DarkGray
  Write-Host ''
} else {
  try {
    $ncm = Start-Process -FilePath 'node' -ArgumentList 'tools/ncm-server.mjs' `
      -WorkingDirectory $PSScriptRoot -NoNewWindow -PassThru
    $ncmId = $ncm.Id
    Start-Sleep -Milliseconds 700
    if (Test-Port $ncmPort) {
      Write-Host "  云村小服务已启动（端口 $ncmPort）：云村页可以扫码登录了。" -ForegroundColor Cyan
    } else {
      Write-Host "  云村小服务没起来（端口 $ncmPort 没人在听）。Nuxt 应用不受影响，先继续。" -ForegroundColor Yellow
    }
  } catch {
    Write-Host "  云村小服务启动失败：$($_.Exception.Message)" -ForegroundColor Yellow
  }
  Write-Host ''
}

# ---------------------------------------------------------------- Nuxt 应用
# 额外参数原样往后传（$args 收的就是没被 param 认领的那些）。
$nodeArgs = @('.output/server/index.mjs')
if ($args.Count -gt 0) { $nodeArgs += [string[]]$args }
& node @nodeArgs

# 应用退出了：这次由本脚本拉起来的云村小服务也收掉
# （Ctrl+C 时它一般已经跟着退了，这里是兜底；别人跑着的那份不动）
if ($ncmId -and (Get-Process -Id $ncmId -ErrorAction SilentlyContinue)) {
  Stop-Process -Id $ncmId -Force -ErrorAction SilentlyContinue
  Write-Host '  云村小服务也停了。' -ForegroundColor Cyan
}

Write-Host ''
Write-Host '  服务已经停了。' -ForegroundColor Cyan
Write-Host ''

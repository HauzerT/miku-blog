# ============================================================================
#  CV01 · 启动（Nuxt 应用 + 云村小服务）
#  ---------------------------------------------------------------------------
#  双击 start.cmd 就会走到这里；也可以直接 .\start.ps1
#    .\start.ps1                起应用（默认 4321）并把云村小服务一起拉起来
#    .\start.ps1 3000           换端口（注意：隧道 origin 也要跟着改）
#    .\start.ps1 -NoKumura      只要应用，不碰云村
#    .\start.ps1 -NoBuild       缺构建产物时不要自动构建，直接报错退出
#    .\start.ps1 -Open          起好之后顺手把入口用默认浏览器打开
#  按 Ctrl+C 停止；窗口找不到了就双击 stop.cmd（两个服务它都会停）。
#
#  起的是**构建产物**：.output/server/index.mjs（在仓库根目录跑）。
#  第一次跑（或者改过 content/**、components/** 这些构建期的东西）需要先构建：
#  这个脚本会自己把依赖装好、把站构建出来，不用你记两条命令。想让它只起不建
#  （部署脚本、开机自启、守候进程都是这种场合）就加 -NoBuild——那时候缺产物
#  它会明确失败，而不是在后台偷偷跑一次一分钟的构建。
#
#  门厅：站点每一页都要先过门厅（服务端那一层，见 server/middleware/gate.ts）——
#  访客按一下就进、站长要口令；这份横幅是照着 data/settings.json 说的实话，
#  里面若写着 "gate": false，这里会当场把话说明白。
#
#  口令：Nuxt 那台服务自己不打印口令，所以由这里从 data/settings.json 读出来
#  打在横幅上（只读、不写，也不会把口令落到任何新文件里）。
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
  [switch]$NoKumura,
  [switch]$NoBuild,
  [switch]$Open
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$entry = Join-Path $PSScriptRoot '.output\server\index.mjs'
$settingsFile = Join-Path $PSScriptRoot 'data\settings.json'
$modulesDir = Join-Path $PSScriptRoot 'node_modules'

function Test-Port([int]$p) {
  try { return @(Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue).Count -gt 0 }
  catch { return $false }
}

# 用哪个包管理器：pnpm 优先（仓库自带 pnpm-lock.yaml），退回 npm。
function Get-PackageManager {
  if (Get-Command pnpm -ErrorAction SilentlyContinue) { return 'pnpm' }
  if (Get-Command npm -ErrorAction SilentlyContinue) { return 'npm' }
  return ''
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host ''
  Write-Host '  没找到 node。先装一个 Node.js（18 以上），再回来跑这个脚本。' -ForegroundColor Yellow
  Write-Host '  https://nodejs.org/'
  Write-Host ''
  exit 1
}

# ---------------------------------------------------------------- 构建产物
# 不在就自己构建一次（除非明确说 -NoBuild）。宁可不启，也不要起一个空壳。
if (-not (Test-Path -LiteralPath $entry)) {
  if ($NoBuild) {
    Write-Host ''
    Write-Host '  找不到构建产物：.output\server\index.mjs' -ForegroundColor Yellow
    Write-Host '  这一次带了 -NoBuild，那就得先自己构建一次（在仓库根目录跑）：' -ForegroundColor Yellow
    Write-Host ''
    Write-Host '    pnpm install' -ForegroundColor Cyan
    Write-Host '    pnpm build' -ForegroundColor Cyan
    Write-Host ''
    exit 1
  }

  $pm = Get-PackageManager
  if (-not $pm) {
    Write-Host ''
    Write-Host '  找不到构建产物，也没有 pnpm / npm 可以替你装依赖与构建。' -ForegroundColor Yellow
    Write-Host '  先装 Node.js（自带 npm），再双击一次 start.cmd。' -ForegroundColor Yellow
    Write-Host '  https://nodejs.org/'
    Write-Host ''
    exit 1
  }

  Write-Host ''
  Write-Host '  第一次跑：没找到构建产物，先装依赖再把站构建出来。' -ForegroundColor Cyan
  Write-Host '  （大概一两分钟；以后改过构建期的东西——content/**、components/** 这类——' -ForegroundColor DarkGray
  Write-Host '   也要重新构建一次；不想自动构建就加 -NoBuild。）' -ForegroundColor DarkGray
  Write-Host ''

  if (-not (Test-Path -LiteralPath $modulesDir)) {
    Write-Host ("  [{0}] 装依赖……" -f $pm) -ForegroundColor Cyan
    & $pm install
    if ($LASTEXITCODE -ne 0) {
      Write-Host ''
      Write-Host ("  {0} install 失败了（见上面的输出）。" -f $pm) -ForegroundColor Yellow
      Write-Host ''
      exit 1
    }
  }

  Write-Host ("  [{0}] 构建……" -f $pm) -ForegroundColor Cyan
  & $pm run build
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $entry)) {
    Write-Host ''
    Write-Host '  构建没有成功（见上面的输出）。' -ForegroundColor Yellow
    Write-Host ''
    exit 1
  }
  Write-Host ''
  Write-Host '  构建好了。' -ForegroundColor Green
  Write-Host ''
}

$ncmPort = 3170
if ($env:NCM_PORT) {
  try { $ncmPort = [int]$env:NCM_PORT } catch { $ncmPort = 3170 }
}

# ---------------------------------------------------------------- 口令 / 门厅
# 服务端不打印口令（Nitro 那台没有这个习惯），所以这里补上——口令是本站唯一的
# 真权限，第一次上传 / 进门厅都要用它。只读 data/settings.json，不写任何东西。
$pass = ''
$gateOff = $false
if (Test-Path -LiteralPath $settingsFile) {
  try {
    $settings = Get-Content -LiteralPath $settingsFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $pass = [string]$settings.passphrase
    # 门厅默认开着；只有显式写了 "gate": false 才关（旧服务端同一条规矩）
    if ($settings.PSObject.Properties.Name -contains 'gate' -and $settings.gate -eq $false) {
      $gateOff = $true
    }
  } catch { $pass = '' }
}

# 后面 Node 那台服务要用同一个端口：PORT 是 Nuxt/Nitro 认的那个变量
$env:PORT = [string]$Port
# 只听本机。Nitro 的默认监听地址是**所有网卡**（0.0.0.0 / ::），那意味着同一个
# 局域网里的任何人都能直接访问这台服务——本机用不着，挂 tunnel 时更是个洞：
# Tunnel 与它是同一台机器上的邻居，127.0.0.1 就够，而且「除了 cloudflared
# 没有别的路能连上这台服务」这句话（限速按真实来客计数那一节）靠的就是它。
$env:NITRO_HOST = '127.0.0.1'

$entryUrl = 'http://127.0.0.1:{0}/' -f $Port

# ---------------------------------------------------------------- 入口横幅
# 这段是给人看的：入口在哪、进去会先撞上什么、口令是什么。
Write-Host ''
Write-Host '  ─────────────────────────────────────────────'
Write-Host '   入口' -ForegroundColor Cyan
Write-Host ("     {0}" -f $entryUrl) -ForegroundColor Green
Write-Host ''
Write-Host '   门厅' -ForegroundColor Cyan
if ($gateOff) {
  Write-Host '     关着（data/settings.json 里写着 "gate": false）' -ForegroundColor Yellow
  Write-Host '     —— 谁打开入口都直接进站。要去掉这一行再重启本脚本。' -ForegroundColor Yellow
} else {
  Write-Host '     开着 —— 打开入口会先落在门厅：访客按一下就进，站长要口令' -ForegroundColor Green
}
Write-Host ''
Write-Host '   口令' -ForegroundColor Cyan
if ($pass) {
  Write-Host ("     {0}" -f $pass) -ForegroundColor Green
  Write-Host ("     长度 {0} 位 · 换一条：node tools\set-passphrase.mjs" -f $pass.Length) -ForegroundColor DarkGray
  Write-Host '     不想手打：tools\copy-key.cmd 把它放进剪贴板，门厅里 Ctrl+V' -ForegroundColor DarkGray
} else {
  Write-Host '     还没有设置：node tools\set-passphrase.mjs 生成一条，然后重启本脚本。' -ForegroundColor Yellow
}
Write-Host ''
if (-not $NoKumura) {
  Write-Host '   云村' -ForegroundColor Cyan
  Write-Host ("     {0}kumura   （小服务 127.0.0.1:{1}）" -f $entryUrl, $ncmPort) -ForegroundColor Green
  Write-Host ''
}
Write-Host '   按 Ctrl+C 停止；窗口找不到了就双击 stop.cmd（应用与云村小服务它都会停）。'
Write-Host '  ─────────────────────────────────────────────'
Write-Host ''

if ($Open) {
  Start-Process $entryUrl
  Write-Host '  已经用默认浏览器打开入口（会先落在门厅）。' -ForegroundColor DarkGray
  Write-Host ''
}

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
      Write-Host "  云村小服务没起来（端口 $ncmPort 没人在听）。应用不受影响，先继续。" -ForegroundColor Yellow
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

Write-Host ("  正在启动 Nuxt 应用……（{0}:{1}）" -f $env:NITRO_HOST, $Port) -ForegroundColor Cyan
Write-Host ''

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

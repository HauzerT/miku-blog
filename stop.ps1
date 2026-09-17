# ============================================================================
#  CV01 · 停止服务
#  ---------------------------------------------------------------------------
#  把本机上跑着的两个服务停掉：
#    · Nuxt 应用     node .output/server/index.mjs   （站点本体：页面、接口、门厅）
#    · 云村小服务    node tools/ncm-server.mjs       （扫码登录网易云要它）
#
#  用法：
#    .\stop.ps1                两个都停
#    .\stop.ps1 -List          只看在跑什么，不动手
#    .\stop.ps1 -Port 8080     只停监听这个端口的（换过端口、或进程认不出来时用）
#
#  为什么认「node 的第一个参数」而不是整条命令行：
#  有些进程（启动器的包装命令、日志重定向之类）的命令行里也会出现
#  .output/server/index.mjs 这几个字，拿整条命令行去匹配会误杀。脚本路径才是身份的凭据。
#
#  退出码：0 = 停干净了（或本来就没在跑）；1 = 有东西没停下来
# ============================================================================

param(
  [int]$Port = 0,
  [switch]$List
)

$ErrorActionPreference = 'Stop'

# 本项目会起的两个入口（相对于仓库根目录）
$ENTRIES = @(
  @{ kind = 'Nuxt 应用';  tail = '.output/server/index.mjs' },
  @{ kind = '云村小服务'; tail = 'tools/ncm-server.mjs' }
)

# 把命令行切成 token（照顾引号），跳过 node 自己的开关与 node 本身，
# 返回第一个非开关 token —— 也就是要跑的那个脚本。
function Get-ScriptArg([string]$cmd) {
  if (-not $cmd) { return '' }
  $tokens = [regex]::Matches($cmd, '"([^"]*)"|(\S+)') | ForEach-Object {
    if ($_.Groups[1].Success) { $_.Groups[1].Value } else { $_.Groups[2].Value }
  }
  foreach ($t in $tokens) {
    if ($t -like '-*') { continue }                     # node --inspect / -e …
    if ($t -match '(?i)node(\.exe)?$') { continue }     # node 自己
    return $t
  }
  return ''
}

# 脚本路径是不是本项目的入口：末尾要整段对上，`x.output/server/index.mjs` 不算
function Test-Entry([string]$script, [string]$tail) {
  $s = $script -replace '\\', '/'
  if ($s -eq $tail) { return $true }
  return $s.EndsWith('/' + $tail)
}

# 端口归属：一次问清楚，免得每个进程问一遍
$ports = @{}
try {
  Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
    $owner = [int]$_.OwningProcess
    if (-not $ports.ContainsKey($owner)) { $ports[$owner] = @() }
    $ports[$owner] += [int]$_.LocalPort
  }
} catch { /* 没有 NetTCPIP 模块就只按进程认 */ }

$found = @()
foreach ($proc in @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'")) {
  $id = [int]$proc.ProcessId
  $script = Get-ScriptArg $proc.CommandLine
  $entry = $null
  foreach ($e in $ENTRIES) { if (Test-Entry $script $e.tail) { $entry = $e; break } }

  $listening = @()
  if ($ports.ContainsKey($id)) { $listening = $ports[$id] | Sort-Object -Unique }

  if ($Port -gt 0) {
    if ($listening -notcontains $Port) { continue }      # 指定了端口就只认端口
  } elseif (-not $entry) {
    continue
  }

  $kind = 'node 服务'
  if ($entry) { $kind = $entry.kind }

  $found += [pscustomobject]@{
    id    = $id
    kind  = $kind
    what  = $(if ($script) { $script } else { '(读不到命令行)' })
    ports = ($listening -join ', ')
  }
}

Write-Output ''
Write-Output '  CV01 · 停止服务'
Write-Output '  ─────────────────────────────────────────────'

if ($found.Count -eq 0) {
  if ($Port -gt 0) {
    Write-Output ('  没有 node 进程在监听 ' + $Port + ' 端口。')
  } else {
    Write-Output '  Nuxt 应用和云村小服务都没在跑，不用停。'
  }
  Write-Output ''
  exit 0
}

Write-Output '  在跑的服务：'
foreach ($t in $found) {
  $line = '    · PID ' + $t.id + '  ·  ' + $t.kind + '  ·  ' + $t.what
  if ($t.ports) { $line += '  ·  监听 ' + $t.ports }
  Write-Output $line
}
Write-Output ''

if ($List) {
  Write-Output '  -List：只看不杀。上面这些就是会被停掉的进程。'
  Write-Output ''
  exit 0
}

$still = @()
foreach ($t in $found) {
  try {
    Stop-Process -Id $t.id -Force -ErrorAction Stop
    Write-Output ('  停了      ' + $t.kind + '（PID ' + $t.id + '）')
  } catch {
    $still += $t
    Write-Output ('  停不掉    ' + $t.kind + '（PID ' + $t.id + '）：' + $_.Exception.Message)
  }
}

Start-Sleep -Milliseconds 400
foreach ($t in $found) {
  if (Get-Process -Id $t.id -ErrorAction SilentlyContinue) {
    if ($still -notcontains $t) { $still += $t }
  }
}

Write-Output ''
if ($still.Count -eq 0) {
  Write-Output ('  一共停了 ' + $found.Count + ' 个。再启动：双击 start.cmd')
  Write-Output ''
  exit 0
}

Write-Output ('  还有 ' + $still.Count + ' 个没停下来。多半是权限问题：')
Write-Output '  用管理员身份开一个 PowerShell 再跑一次，或者 .\stop.ps1 -Port <端口> 只停那一个。'
Write-Output ''
exit 1

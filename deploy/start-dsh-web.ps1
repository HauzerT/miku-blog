# ============================================================================
#  CV01 · 启动 / 重启 DSH web（远控入口）
#  ---------------------------------------------------------------------------
#  DSH web 的 /api 有道「浏览器信任栅栏」：Host 不是 loopback 就必须在启动参数
#  --trusted-host 名单里。要手机走 dsh.n1ngzhu0.dpdns.org 访问，就必须带上它。
#
#    .\start-dsh-web.ps1            3080 没人听才启动（幂等）
#    .\start-dsh-web.ps1 -Restart   先停掉现在这个，再带参数重启
#
#  重启会换新的 launch token：所有已登录的浏览器（含手机）都会被登出，
#  要用新链接重新进门。两条带 token 的入口会写进 deploy\dsh-web-url.txt：
#    · 本机  http://127.0.0.1:3080/?token=...
#    · 手机  https://dsh.n1ngzhu0.dpdns.org/?token=...
#  token 就是这个进程的钥匙，别把那个文件提交进仓库（.gitignore 已挡）。
#
#  日志：deploy\dsh-web.log / deploy\dsh-web.err.log
# ============================================================================

param(
    [switch]$Restart
)

$ErrorActionPreference = 'Stop'

$deployDir = $PSScriptRoot
$nodeBin   = 'node'
$dshBin    = 'D:\npm-global\node_modules\@deepseek-ai\dsh\lib\bin.js'
$extHost   = 'dsh.n1ngzhu0.dpdns.org'
$port      = 3080

function Test-Port([int]$p) {
    try {
        return @(Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue).Count -gt 0
    } catch { return $false }
}

# ---------------------------------------------------------------- -Restart：先停旧的
if ($Restart -and (Test-Port $port)) {
    $conn = Get-NetTCPConnection -LocalPort $port -State Listen | Select-Object -First 1
    $oldPid = [int]$conn.OwningProcess
    $oldName = (Get-Process -Id $oldPid -ErrorAction SilentlyContinue).ProcessName
    if ($oldName -eq 'node') {
        Stop-Process -Id $oldPid -Force -ErrorAction Stop
        Write-Output "  已停掉旧的 DSH web（PID $oldPid）。"
        $deadline = (Get-Date).AddSeconds(15)
        while ((Test-Port $port) -and ((Get-Date) -lt $deadline)) { Start-Sleep -Milliseconds 400 }
    } else {
        Write-Output "  端口 $port 被 $oldName（PID $oldPid）占着，不是 node，不敢动。"
        exit 1
    }
}

if (Test-Port $port) {
    Write-Output "  DSH web 已经在跑（端口 $port），这次不重复启动。"
    exit 0
}

if (-not (Test-Path -LiteralPath $dshBin)) {
    Write-Output "  找不到 DSH：$dshBin"
    exit 1
}

# ---------------------------------------------------------------- 启动
$outLog = Join-Path $deployDir 'dsh-web.log'
$errLog = Join-Path $deployDir 'dsh-web.err.log'

Write-Output "  正在启动 DSH web（trusted-host: $extHost）……"
$proc = Start-Process -FilePath $nodeBin `
    -ArgumentList @($dshBin, 'web', '--trusted-host', $extHost) `
    -WorkingDirectory $env:USERPROFILE `
    -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $outLog -RedirectStandardError $errLog

# ---------------------------------------------------------------- 等 URL（dsh web 自己会打印带 token 的入口）
$deadline = (Get-Date).AddSeconds(60)
$localUrl = $null
while ((Get-Date) -lt $deadline) {
    if (Test-Port $port) {
        $txt = ''
        try { $txt = Get-Content $outLog -Raw -ErrorAction SilentlyContinue } catch {}
        if ($txt -match 'dsh web: (\S+)') { $localUrl = $Matches[1]; break }
    }
    if ($proc.HasExited) {
        Write-Output "  启动失败：进程已退出（代码 $($proc.ExitCode)）。看 $errLog"
        exit 1
    }
    Start-Sleep -Milliseconds 500
}

if (-not $localUrl) {
    Write-Output "  端口/URL 60 秒内没就绪。看 $outLog 与 $errLog"
    exit 1
}

# 手机走隧道的那条：同一个 launch token，换 base URL 就行
$phoneUrl = $localUrl.Replace("http://127.0.0.1:$port", "https://$extHost")
$urlFile = Join-Path $deployDir 'dsh-web-url.txt'
@(
    "生成时间：$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
    "本机：$localUrl",
    "手机：$phoneUrl",
    '（token 是这个进程的钥匙，只自己用，别外传、别提交）'
) | Set-Content -FilePath $urlFile -Encoding UTF8

Write-Output "  DSH web 已启动（PID $($proc.Id)），监听 127.0.0.1:$port。"
Write-Output "  两条带 token 的入口已写进：$urlFile"
Write-Output '  浏览器会自己弹开本机入口；手机用文件里「手机：」那条。'
exit 0

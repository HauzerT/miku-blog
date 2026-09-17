# ============================================================================
#  CV01 · 站长一键进门
#  ---------------------------------------------------------------------------
#  把「起服务 → 拿口令 → 开门厅」合成一次双击（入口是配对的 owner.cmd）：
#
#    1. 服务没在跑就后台拉起（deploy\start-blog-background.cmd 本身幂等）；
#    2. 口令放进剪贴板（以子进程调 copy-key.ps1，屏幕上不显示）；
#    3. 用默认浏览器打开门厅 —— #owner 直接停在口令那一行。
#
#  到了门厅：口令栏 Ctrl+V 然后「进入」。如果浏览器问「要保存口令吗」，
#  选保存——之后这个框会自己填好（或用 Windows Hello 解锁），连粘贴都省了。
#  门厅已经放开 autocomplete，浏览器存得住是标准行为，不是什么后门：
#  凭证加密存在浏览器自己的密码库里，只属于这台机器上的这个浏览器配置。
#
#  中文只写在 .ps1 里并存成带 BOM 的 UTF-8；.cmd 保持纯 ASCII。
# ============================================================================

[CmdletBinding()]
param(
  [int]$Port = 4321
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot

function Test-Port([int]$p) {
  try { return @(Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue).Count -gt 0 }
  catch { return $false }
}

Write-Host ''
Write-Host '  CV01 · 站长进门' -ForegroundColor Cyan
Write-Host '  ─────────────────────────────────────────────'

# 1) 服务：没跑就后台拉起（幂等脚本自己会判断）
if (Test-Port $Port) {
  Write-Host "  · 源站已经在跑（端口 $Port），跳过启动。" -ForegroundColor DarkGray
} else {
  Write-Host "  · 源站没在跑，后台拉起来……" -ForegroundColor DarkGray
  & (Join-Path (Join-Path $root 'deploy') 'start-blog-background.cmd') -Port $Port
}

# 2) 口令进剪贴板。copy-key.ps1 用子进程调：它对「没有口令」的处理与提示
#    原样复用，里面的 exit 也只收掉子进程，不会把这里带崩。
$copyKey = Join-Path $PSScriptRoot 'copy-key.ps1'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $copyKey

# 3) 开门厅（#owner：口令行直接展开）
Start-Process ("http://127.0.0.1:{0}/login.html#owner" -f $Port)

Write-Host '  · 门厅已在默认浏览器打开。' -ForegroundColor Gray
Write-Host ''
Write-Host '  下一步：口令栏 Ctrl+V（或点浏览器已保存的那条）→「进入」。' -ForegroundColor Cyan
Write-Host '  第一次登录后浏览器会问「要保存口令吗」——保存，以后连粘贴都省了。' -ForegroundColor Gray
Write-Host ''

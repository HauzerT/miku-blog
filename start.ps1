# CV01 上传服务 · 启动脚本（PowerShell 版）
# 用法：右键「使用 PowerShell 运行」，或者在终端里 ./start.ps1
# 想换端口：./start.ps1 8080

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host ''
  Write-Host '  没找到 node。先装一个 Node.js（18 以上），再回来跑这个脚本。' -ForegroundColor Yellow
  Write-Host '  https://nodejs.org/'
  Write-Host ''
  exit 1
}

Write-Host ''
Write-Host '  正在启动上传服务…… 终端里会打印一串上传口令。' -ForegroundColor Cyan
Write-Host '  按 Ctrl+C 停止服务。'
Write-Host ''

node server/server.mjs @args

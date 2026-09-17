param(
  [switch]$Show
)

# ============================================================================
#  copy-key.ps1 · 把上传口令放进剪贴板（默认**不显示**）
#  ---------------------------------------------------------------------------
#  口令换成 32 位随机串之后，手打是不现实的——但也不需要手打：
#  这个脚本把它读出来塞进剪贴板，你去门厅那一栏按 Ctrl+V 就行。
#
#    .\tools\copy-key.ps1             复制到剪贴板（屏幕上不显示口令）
#    .\tools\copy-key.ps1 -Show       顺便也打印出来（旁边没人的时候用）
#
#  记一次能管多久：
#    · 门厅那枚 cookie 是 30 天；
#    · 口令本身存在浏览器 localStorage 的 cv01-key 里，**没有到期时间**，
#      站长工具箱/右键/编辑页认的都是它。所以正常情况下是「进门一次，很久不用再进」。
#    · 换浏览器、清站点数据、按了「访客进入」（会主动忘掉口令）之后才需要再输一次。
#
#  安全说明（说清楚，不糊弄）：剪贴板是明文，同机器上的别的程序读得到；
#  Windows 的剪贴板历史（Win+V）也可能把它留下来。用完可以 Win+V 里删掉那条，
#  或者干脆用 -Show，照着念一次就好。别在共享/录屏的机器上跑这个。
# ============================================================================

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$file = Join-Path $root 'data\settings.json'

if (-not (Test-Path -LiteralPath $file)) {
  Write-Host ''
  Write-Host "  找不到 $file" -ForegroundColor Yellow
  Write-Host '  这说明这台机器上还没跑过服务：跑一次 start.cmd，它会自动生成一条口令。' -ForegroundColor Yellow
  Write-Host ''
  exit 1
}

$settings = Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json
$key = [string]$settings.passphrase

if (-not $key) {
  Write-Host ''
  Write-Host '  data\settings.json 里没有 passphrase。' -ForegroundColor Yellow
  Write-Host '  跑一次 start.cmd 会自动生成，或者 node tools\set-passphrase.mjs 现在换一条。' -ForegroundColor Yellow
  Write-Host ''
  exit 1
}

# 放进剪贴板：clip.exe 最省事（但要求文本以 CRLF 结尾，否则最后一个字符会丢）；
# 退一步用 Set-Clipboard（PS 5.1 有，且不挑换行）。
$copied = $false
try {
  $key | & clip.exe
  if ($LASTEXITCODE -eq 0) { $copied = $true }
} catch { $copied = $false }

if (-not $copied) {
  try {
    Set-Clipboard -Value $key
    $copied = $true
  } catch { $copied = $false }
}

Write-Host ''
Write-Host '  上传口令 · 初音ミク CV01' -ForegroundColor Cyan
Write-Host '  ─────────────────────────────────────────────'
Write-Host ("  长度 {0} 位" -f $key.Length)

if ($copied) {
  Write-Host '  已经放进剪贴板了 —— 去门厅那一栏按 Ctrl+V，然后点「进入」。' -ForegroundColor Green
} else {
  Write-Host '  剪贴板放不进去（clip.exe 和 Set-Clipboard 都没成）。' -ForegroundColor Yellow
  Write-Host '  那就用 -Show 把它打出来，照着抄一次。' -ForegroundColor Yellow
}

if ($Show) {
  Write-Host ''
  Write-Host "  $key" -ForegroundColor Green
  Write-Host ''
  Write-Host '  （这一行现在停在终端里了。旁边有人就别用 -Show。）' -ForegroundColor DarkGray
} else {
  Write-Host '  屏幕上不显示口令；要看一眼就加 -Show。' -ForegroundColor DarkGray
}

Write-Host ''
Write-Host '  提醒：跑完可以到 Win+V 的剪贴板历史里把这一条删掉。' -ForegroundColor DarkGray
Write-Host ''

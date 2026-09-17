# ============================================================================
#  CV01 · 常驻看门狗（登录自启后一直循环）
#  ---------------------------------------------------------------------------
#  由 Startup 文件夹里的 miku-blog-keepalive.cmd 以隐藏窗口拉起：
#    · 首跳：隧道、博客源站（PublicDeploy）、DSH web 三个都确保一遍
#    · 之后每 5 分钟：隧道 + 源站各确保一遍（都幂等，在跑就跳过）
#
#  DSH web 只在首跳确保、不进循环：重启它会换 token、把所有已登录的
#  设备登出，这是用户该知情的大动作，不该在后台悄悄做。它真崩了就
#  手动跑 deploy\restart-dsh-web.cmd（或 start-dsh-web.ps1）。
#
#  循环里的两个都是幂等脚本，随便多少个实例同时调都不会起重复进程。
# ============================================================================

$ErrorActionPreference = 'Continue'

$tunnel = Join-Path $PSScriptRoot 'start-tunnel-background.ps1'
$origin = Join-Path $PSScriptRoot 'start-blog-background.ps1'
$dsh    = Join-Path $PSScriptRoot 'start-dsh-web.ps1'

# ---- 首跳：开机 / 登录后把三件套都拉起来
try { & $tunnel } catch { Write-Output "  tunnel 确保失败：$($_.Exception.Message)" }
try { & $origin -PublicDeploy } catch { Write-Output "  源站确保失败：$($_.Exception.Message)" }
try { & $dsh } catch { Write-Output "  DSH web 确保失败：$($_.Exception.Message)" }

# ---- 循环：只看门隧道与源站
while ($true) {
    Start-Sleep -Seconds 300
    try { & $tunnel | Out-Null } catch {}
    try { & $origin -PublicDeploy | Out-Null } catch {}
}

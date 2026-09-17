# ============================================================================
#  CV01 · 本机部署实况（模板）
#  ---------------------------------------------------------------------------
#  复制成 deploy\local.config.ps1 再填自己的值。那个文件在 .gitignore 里，
#  永远不会进仓库；公开仓库只留这一份模板。
#
#  为什么要分开：域名、隧道 ID、本机绝对路径只对一台机器成立。把它们写进
#  公开仓库，等于顺手把「这台机器长什么样、从哪打」一起公开了——而本仓库
#  是公开的。流程写在 deploy\CLOUDFLARE-TUNNEL.md，实况写在这里。
#
#  复制（PowerShell，在仓库根目录）：
#    Copy-Item deploy\local.config.example.ps1 deploy\local.config.ps1
#
#  改完不用重启什么：start-dsh-web.ps1 与 start-tunnel-background.ps1
#  每次跑都会重新读这个文件。
# ============================================================================

# 博客对外域名（Cloudflare 上那条指向 127.0.0.1:4321 的 Public Hostname）
$CV01_SITE_HOST = 'blog.example.com'

# DSH web 远控的对外域名（指向 127.0.0.1:3080）。没有就留空字符串。
$CV01_DSH_HOST = 'dsh.example.com'

# cloudflared 隧道名（cloudflared tunnel create 时起的那个）
$CV01_TUNNEL_NAME = 'miku-blog'

# cloudflared 隧道 ID（cloudflared tunnel list 里那一列 UUID）。
# 注意：这不是凭据——真正的钥匙是 %USERPROFILE%\.cloudflared\<ID>.json 里的
# TunnelSecret。但它是「这台机器挂了哪条隧道」的指路牌，所以照样不进仓库。
$CV01_TUNNEL_ID = '00000000-0000-0000-0000-000000000000'

# DSH 的 bin.js 绝对路径（npm 全局装在哪，只有那台机器知道）。
# **留空就行**：脚本会自己问 npm（npm root -g）。真填的话也只填在本机那份
# local.config.ps1 里——这个模板是公开的，别把某台机器的路径写进来。
$CV01_DSH_BIN = ''

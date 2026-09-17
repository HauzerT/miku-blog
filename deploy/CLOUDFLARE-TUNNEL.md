# 用 Cloudflare Tunnel 长期部署本站

> 本文只写**流程**。按本文走完，站点的对外地址就真的能被别人打开了——
> 所以每一步都标了「这一步会不会已经上网」。**不按第 6、7 步启动，就一个字节都没有上线。**
>
> **已经做完的准备**（本机侧，全程没出网）：
>
> ```
> cloudflared 已装（winget · Cloudflare.cloudflared · 2026.9.1）
> 口令已换  32 位随机串（原来是 6 位数字）· node tools/set-passphrase.mjs
> 限速已加  /api/auth 试错退避 + Retry-After · server/lib/authlimit.mjs
> 比对已换  === → timingSafeEqual
> 漏洞已修  /.ncm-session.json 曾经能被直接 GET 走（网易云登录态，真的漏过）
> 闸门已加  /api/render 正文上限 256KB、同时最多渲 2 个
> 自检已加  node tools/preflight-check.mjs —— 上线前跑它，它会真的去敲每一页
> 脚本已加  deploy\start-blog-background.cmd -PublicDeploy（幂等 + 不启云村 + 按真实来客限速，实测通过）
> 登录已加  tools\copy-key.cmd —— 32 位口令不用手打，进剪贴板去门厅 Ctrl+V
> ```
>
> 还差的就是**你的域名**：下面第 3 步要填进去。

## 0. 先在脑子里把方向摆正

Tunnel 不是「把本机的端口开到公网」，而是**反向**的：

```
访客 ──► Cloudflare 边缘（你的域名）──► cloudflared 主动连出去的一条长连接 ──► 127.0.0.1:4321
```

- `cloudflared` 从本机**往外**拨号（出站 7844/QUIC 或 443/HTTP2），
  所以**路由器不用端口转发、不需要公网 IP、也没有入站端口被打开**。
- 本机的 `server/server.mjs` 仍然只监听 `127.0.0.1:4321`（`server/server.mjs` 里的 `HOST`），
  这一点**不用改**，也不该改。Tunnel 与它是同一台机器上的邻居。
- 键一拔（停掉 cloudflared），外网立刻访问不到，本机一切照旧。

## 1. 前置条件

| 需要 | 本站现状 |
|---|---|
| `cloudflared` | 已装（winget 包 `Cloudflare.cloudflared`，2026.9.1，在 `C:\Program Files (x86)\cloudflared\cloudflared.EXE`） |
| 一个 Cloudflare 账号 | 需要你自己注册 |
| 一个**托管在 Cloudflare 上的域名**（NS 已经指到 CF） | 需要你自己有；长期映射必须用它，`trycloudflare.com` 那种临时地址不能长期用 |
| 本机服务能跑起来 | `node server/server.mjs`，默认 `http://127.0.0.1:4321/` |

验证 cloudflared：

```powershell
& "C:\Program Files (x86)\cloudflared\cloudflared.EXE" --version
# 或者用 skill 自带的助手
python "$env:USERPROFILE\.dsh\skills\cloudflare-tunnel-skill\scripts\tunnel_helper.py" check
```

> **注意**：winget 刚装完，**已经在跑的那些终端窗口里 PATH 还是旧的**，
> 新开一个窗口才有 `cloudflared` 这个名字。写脚本时建议用全路径，别赌 PATH。

## 2. 先只在本机确认服务是好的  ← 不出网

```powershell
cd D:\Codings\miku-blog
.\start.cmd                 # 或 node server/server.mjs 4321
```

另一个窗口：

```powershell
curl.exe -I http://127.0.0.1:4321/
# 200 / 302 都算通（有门厅时是 302 → login.html）
```

**两件必须知道的事：**

1. **门厅默认是开的。** `data/settings.json` 里没有 `"gate": false`，所以站点页面会被 302 到
   `login.html`。这条门对公网同样生效——拿到地址的人会先看到门厅。
   访客按「访客进入」就能进（这是设计），站长按「站长登录」要口令。
2. **门厅只挡「是不是从门口进来的」，不是锁。** 真正的权限是口令，由每个写接口的
   `requireAuth` 现验。上线前请看第 9 节。

## 3. 在 Cloudflare 上建 tunnel（二选一）

### 路线 A：本机管理（locally-managed）

在本机做三件事，凭据落在 `%USERPROFILE%\.cloudflared\`：

```powershell
cloudflared tunnel login                       # 弹浏览器，选你的域名，生成 cert.pem
cloudflared tunnel create miku-blog            # 生成 <TUNNEL-ID>.json 凭据
cloudflared tunnel route dns miku-blog blog.example.com
```

第三条会在 CF 上建一条 CNAME 记录（`blog.example.com` → `<TUNNEL-ID>.cfargotunnel.com`）。
**这一步做完域名已经指向 tunnel，但 tunnel 还没跑，所以打不开——仍然没上线。**

然后写配置。可以用 skill 的助手生成到当前目录：

```powershell
python "$env:USERPROFILE\.dsh\skills\cloudflare-tunnel-skill\scripts\tunnel_helper.py" named-config `
  --name miku-blog --hostname blog.example.com --url http://127.0.0.1:4321
# 生成 .cloudflare-tunnel\miku-blog.yml
```

内容长这样（长期跑建议直接放 `%USERPROFILE%\.cloudflared\config.yml`）：

```yaml
tunnel: miku-blog
credentials-file: C:\Users\LENOVO\.cloudflared\<TUNNEL-ID>.json

ingress:
  - hostname: blog.example.com
    service: http://127.0.0.1:4321
    originRequest:
      connectTimeout: 30s
      # 本站上传上限 256MB（server/lib/multipart.js 的 DEFAULT_LIMIT）
      # tunnel 侧默认不限制 body，但 CF 免费版单请求 100MB，传大视频会撞墙
  - service: http_status:404       # 兜底，必须留，且必须是最后一条
```

临时跑一次、验完就停（**这一步才算出网**）：

```powershell
cloudflared tunnel --config .cloudflare-tunnel\miku-blog.yml run miku-blog
```

### 路线 B：控制台管理（remotely-managed，token 模式）

在 Zero Trust 控制台 → Networks → Tunnels 里建 tunnel，加一条 Public Hostname，
Service 填 `http://127.0.0.1:4321`。控制台会给你一条 `cloudflared service install <TOKEN>` 命令。

这条路**不用本机 `config.yml`、不用 `cert.pem`、不用凭据文件**，ingress 在网页上改，
换机器只要一条命令。**长期部署更省事，推荐这条。**

```powershell
# 管理员 PowerShell
cloudflared service install eyJhIjoi...          # ← token 只在这条命令里出现一次
```

**token 是这台机器的钥匙，等于把 tunnel 交出去。** 不要贴进聊天、不要写进仓库、
不要提交到 git；要落盘就落成环境变量或单独一个只有你能读的文件。

## 4. 让它长期活着（Windows 开机自启）

Tunnel 要一直活着，源站也要一直活着，**两个都要自启**，缺一个就是 502。

### 4.1 cloudflared

**路线 B（推荐）**：`cloudflared service install <TOKEN>` 已经顺手把 Windows 服务装好了，
开机自启。常用命令：

```powershell
Get-Service cloudflared
Restart-Service cloudflared     # 改了 ingress / 换了 token 之后
```

**路线 A**：服务是「本机管理」模式，要按官方那套做（管理员 CMD）：

```cmd
cloudflared.exe service install
mkdir C:\Windows\System32\config\systemprofile\.cloudflared
copy C:\Users\%USERNAME%\.cloudflared\<TUNNEL-ID>.json C:\Windows\System32\config\systemprofile\.cloudflared\
copy C:\Users\%USERNAME%\.cloudflared\cert.pem       C:\Windows\System32\config\systemprofile\.cloudflared\
cloudflared.exe tunnel ingress validate
```

然后到注册表 `HKLM\SYSTEM\CurrentControlSet\Services\Cloudflared` 把 `ImagePath` 指到
你的 config：

```
C:\Program Files (x86)\cloudflared\cloudflared.EXE --config=C:\Users\LENOVO\.cloudflared\config.yml tunnel run
```

> 服务是以 **LocalSystem** 身份跑的，它读的是 `C:\Windows\System32\config\systemprofile\.cloudflared\`，
> **不是**你的 `%USERPROFILE%\.cloudflared\`。凭据文件放错地方，服务就起不来——
> 这是这条路上最常见的坑。
>
> 嫌注册表麻烦：用「任务计划程序」建一个**登录时触发**的任务（勾上「不管用户是否登录都运行」
> 与「使用最高权限运行」），程序填 `cloudflared.exe`，参数填
> `tunnel --config <yml 全路径> run miku-blog`。效果一样，且不碰注册表。

### 4.2 源站（本站的 node 服务）

用仓库里带的 `deploy\start-blog-background.cmd`（纯 ASCII 的 .cmd，中文在 .ps1 里——
理由见 README「为什么 .cmd 里一个中文都没有」）。**公网部署要加 `-PublicDeploy`**：

```
deploy\start-blog-background.cmd -PublicDeploy
```

它做三件事：

1. 确认 `127.0.0.1:4321` 没人听，就把 `start.ps1` 在后台拉起来
   （日志与口令写在 `deploy\blog-server.log` / `deploy\blog-server.err.log`）。
   **已经在跑就不重复启动**，可以放心让任务计划程序反复调它。
2. `-PublicDeploy` 时不启动**云村小服务**（`start.ps1 -NoKumura`）。
   它的 3170 端口旁边就是 `.ncm-session.json`——你的网易云登录态。
   公网部署时它没有任何理由在跑，最省事的保证就是根本不起来。
   （不带这个开关时，它跟 `start.cmd` 一样会把云村也拉起来。）
3. `-PublicDeploy` 时给上传服务设 `CV01_TRUST_PROXY=1`：`/api/auth` 的试错限速
   按**真实来客**（`CF-Connecting-IP`）计数，而不是全站共用一个 127.0.0.1 的桶。
   这条只在你确实只让 cloudflared 连这台服务时成立，而 `server.mjs` 只监听
   127.0.0.1，这就是那条保证。

启动横幅会自己说明限速是按谁计数的，不用猜：

```
  口令限速    按真实来客（CF-Connecting-IP）· 免费 5 次      ← -PublicDeploy
  口令限速    全局（只认本机地址）· 免费 5 次 · 挂 tunnel 请设 CV01_TRUST_PROXY=1
```

任务计划程序里填：

| 项 | 值 |
|---|---|
| 触发器 | 登录时（或「计算机启动时」，需要勾「不管用户是否登录都运行」）+ 可选「每 5 分钟」当看门狗 |
| 操作 | 启动程序：`D:\Codings\miku-blog\deploy\start-blog-background.cmd` |
| 添加参数 | `-PublicDeploy` |
| 起始于 | `D:\Codings\miku-blog` |
| 条件 | 取消「只有在计算机使用交流电源时才启动」（笔记本电池下也要跑） |
| 设置 | 勾「如果任务失败，按以下频率重新启动：1 分钟 / 3 次」 |

口令在终端里打印，用后台方式起来就打印到日志里了——**别去日志里翻，用
`tools\copy-key.cmd` 把它放进剪贴板**（日志里那条明文只是个兜底）。

## 5. 验证

```powershell
# 本机
curl.exe -I http://127.0.0.1:4321/

# 公网（这一步之后就真在线了）
curl.exe -I https://blog.example.com/

# tunnel 自己的视角
cloudflared tunnel info miku-blog
```

用 skill 的助手也能验：

```powershell
python "$env:USERPROFILE\.dsh\skills\cloudflare-tunnel-skill\scripts\tunnel_helper.py" verify --url https://blog.example.com/
```

DNS 刚从控制台建好时可能要等一两分钟；**报 `Could not resolve host` 先别当坏掉**，
助手会自动走 DNS-over-HTTPS 重试（假 IP 代理的 DNS 很常见）。

## 6. 只想临时给人看一眼（Quick Tunnel）

不碰域名、不登录 Cloudflare，一条命令换一个 `https://xxxx.trycloudflare.com`：

```powershell
python "$env:USERPROFILE\.dsh\skills\cloudflare-tunnel-skill\scripts\tunnel_helper.py" quick --url http://127.0.0.1:4321
python "$env:USERPROFILE\.dsh\skills\cloudflare-tunnel-skill\scripts\tunnel_helper.py" status
python "$env:USERPROFILE\.dsh\skills\cloudflare-tunnel-skill\scripts\tunnel_helper.py" stop
```

地址是**临时的**：cloudflared 一退、电脑一睡、网一断就没了，重启还会换一个。
**别拿它当长期方案**，也别把它贴到会被搜索引擎抓到的地方。

## 7. 停下来 / 下线

```powershell
# 临时停：Ctrl+C，或
Stop-Service cloudflared          # 管理员

# 彻底不要了
cloudflared tunnel delete miku-blog     # 连带 DNS 记录一起删
cloudflared service uninstall
```

停掉 cloudflared 的瞬间，公网就访问不到了。

## 8. 先把 `deploy\` 里的运行时文件排除掉

`deploy\blog-server.err.log` 里可能有口令。`.gitignore` 里已经加了一行 `deploy/*.log`，
另外 `cloudflared` 的凭据（`%USERPROFILE%\.cloudflared\*.json`、`cert.pem`）
以及任何 `.cloudflare-tunnel/` 目录**永远不要进仓库**。

## 9. 上线前必须想清楚的安全问题（**这一节最重要**）

先跑一次预检——它真的去敲每一页，告诉你「挂出去之后别人能拿到什么」：

```powershell
node server/server.mjs 4399                     # 另开一个窗口
node tools/preflight-check.mjs http://127.0.0.1:4399
```

它读到的东西和已经处理掉的东西：

| 位置 | 现在是什么状态 |
|---|---|
| **`.ncm-session.json`（网易云登录态）** | **已经修好了。** 它躺在站点根目录下，而静态服务挡的是**目录名**白名单——所以公网上 `GET /.ncm-session.json` 曾经能整份拿走你的登录 cookie。预检抓到了这个；现在 `server.mjs` 多了一道「任何一段以 `.` 开头的路径都不发」，`deploy/` 也进了名单（那里有 `blog-server.log`，日志开头就印着口令）。 |
| 口令 `data/settings.json` | 已换成 32 位随机串（约 186 bit 熵）。轮换用 `node tools/set-passphrase.mjs`；换完每个浏览器里记着的旧口令都失效，门厅会重问一次。 |
| `POST /api/auth` 爆破 | 已加试错限速：同一来客错 5 次不罚，之后 2s → 4s → 8s…封顶 15 分钟，带 `Retry-After`。公网部署时设 `CV01_TRUST_PROXY=1` 才会按**真实来客**计数（默认只认 socket 地址 = 全局限速）。见 `server/lib/authlimit.mjs`。 |
| 口令比对 | 已从 `===` 换成 `timingSafeEqual`（定长比较，不再按第一个不同的字节短路）。 |
| `POST /api/render` | 不要口令是**设计如此**（编辑页右栏靠它）。现在有闸：正文上限 256KB、同时最多渲 2 个，超了 429。它不落盘。 |
| `/api/health` `/api/sections` `/api/posts` `/api/articles` `/api/music` `/api/state` | **仍然公开可读**（板块树、文章元数据、曲库、音量设置）。这是当前的设计，不是疏漏——不想公开就上 Access。 |
| `/media/**` | **仍然公开可读**，按 URL 直取。你传的图片 / 视频 / 音乐公网可下。 |
| 门厅 cookie `cv01-enter` | 访客可自取（设计如此）。伪造它拿不到额外权限，**真正的权限仍是口令**。 |
| 写接口 | 每个都过 `requireAuth`，预检逐个确认过是 401。口令一泄 = 整站可写。 |
| 后台编辑（`editor.html`、全局编辑） | 要口令。 |
| **`tools/ncm-server.mjs`（3170）** | **绝对不要给它开 tunnel 或 Public Hostname**——它旁边就是 `.ncm-session.json`。`kumura.html` 那页同理（README 里也是这么说的）。 |

### 9.1 门厅留着，当「开屏过场」

门厅**不用关**，也不该关：`gate` 保持打开，访客进门先看到 `login.html`，按「访客进入」
（那是个普通链接，没有 JS 也进得去），然后回到本来要去的那一页。Access 在前、门厅在后，
两层并不打架——它们回答的是不同的问题：

```
访客 → Cloudflare 边缘（Access 先问：你是谁？）→ cloudflared → 门厅（再问：访客还是站长？）→ 站点
```

### 9.2 在 Cloudflare 上加 Access（把「谁都能到门厅」变成「只有你能到门厅」）

1. Zero Trust 控制台 → **Access → Applications → Add an application → Self-hosted**。
2. Application name 随便（`miku-blog`），Session Duration 按需要（比如 24 小时）。
3. Public hostname 填你要用的那个，例如 `blog.example.com`。
4. 加一条策略：Action = **Allow**，Include = **Emails**，填你自己的邮箱。
   （多个人就多填几个，或者用 Email domain。）
5. Identity provider 用 One-time PIN（邮箱验证码）就够了，不需要接 Google/GitHub。
6. 保存。**从这一刻起，没通过 CF 登录的人连 `login.html` 都看不到。**

代价说清楚：你自己访问也要过一次 CF 登录（浏览器会记着，直到 session 到期）；
手机上第一次也要过一遍。Cloudflare 免费额度够个人博客用。

> 想连自己都挡在外面（只当内网用）：Access 那边策略设成只放行你，Tunnel 这边不开 Public Hostname，
> 走 `cloudflared access` 或 WARP 客户端。那是另一套用法，本文不展开。

## 10. 一页速查

```powershell
# 装（已完成）
winget install --id Cloudflare.cloudflared --exact

# 上线前（本机，不出网）
node tools/preflight-check.mjs            # 读配置那一半
node server/server.mjs 4399               # 另开窗口
node tools/preflight-check.mjs http://127.0.0.1:4399   # 真的去敲
node tools/authlimit-check.mjs            # 限速规则（19 项）
node tools/set-passphrase.mjs             # 换口令（需要时）

# 建（路线 B 更省事）
cloudflared tunnel login
cloudflared tunnel create miku-blog
cloudflared tunnel route dns miku-blog blog.example.com

# 跑（公网按真实来客限速、不启云村小服务，都由 -PublicDeploy 一起搞定）
cloudflared tunnel --config %USERPROFILE%\.cloudflared\config.yml run miku-blog
deploy\start-blog-background.cmd -PublicDeploy

# 看
cloudflared tunnel info miku-blog
Get-Service cloudflared
curl.exe -I https://blog.example.com/

# 停
Stop-Service cloudflared
stop.cmd
```

### 环境变量

| 变量 | 默认 | 作用 |
|---|---|---|
| `CV01_TRUST_PROXY` | 关 | `1` 时按 `CF-Connecting-IP` 给限速计数。**只在「除了 cloudflared 没别的路能连上这台服务」时才开**——那个头谁都能自己填。 |
| `CV01_AUTH_FREE` | `5` | 头几次口令试错不罚。调小便于自检。 |
| `PORT` / 命令行参数 | `4321` | 上传服务端口。 |

## 11. 已部署现状（2026-09-17 实际落地）

本文前 10 节是「怎么走」；这一节是**本机真实跑着的东西**，改任何一环前先读它。

### 11.1 隧道与域名

| 项 | 值 |
|---|---|
| 隧道 | `miku-blog` · ID `9304e626-d788-4439-b50d-8ba51c6db7b5`（本机管理，路线 A） |
| 凭据 | `%USERPROFILE%\.cloudflared\cert.pem` 与 `9304e626-….json`（**不进仓库**） |
| 配置 | `%USERPROFILE%\.cloudflared\config.yml` |
| `n1ngzhu0.dpdns.org` | → `http://127.0.0.1:4321`（博客源站） |
| `dsh.n1ngzhu0.dpdns.org` | → `http://127.0.0.1:3080`（DSH web 远控，见 11.3） |
| 兜底 | 其余一切 → `http_status:404` |

云村小服务（3170）**没有**任何 Public Hostname，公网永远到不了它——这是有意的。

### 11.2 常驻化：任务计划程序（不是 Startup 文件夹，也不是服务）

| 任务 | 触发 | 动作 |
|---|---|---|
| `MikuBlog Keepalive Logon` | 用户登录 | 隐藏跑 `deploy\keepalive.ps1` |
| `MikuBlog Keepalive` | 手动 / 补跑 | 同上（一次性，用于当下补拉） |

`keepalive.ps1`：首跳把**隧道、源站（-PublicDeploy）、DSH web** 三个都确保一遍，
之后每 5 分钟循环确保隧道与源站。三个 ensure 脚本全部幂等，在跑就跳过。

- 源站：`deploy\start-blog-background.ps1 -PublicDeploy`（第 4.2 节那个）
- 隧道：`deploy\start-tunnel-background.ps1`（检测带 `miku-blog` 的 cloudflared）
- DSH：`deploy\start-dsh-web.ps1`（只在首跳确保，**不进循环**——重启它等于换钥匙，
  见 11.3）

**为什么必须走任务计划程序**：从 DSH 会话（本仓库的开发助手）里直接拉起的进程
都是 DSH 的子孙，随时可能被连带清掉——部署当天源站就这么悄悄死过一回。
任务计划程序拉起的进程挂在 svchost 下，谁也清不掉。

### 11.3 DSH web 远控（手机）

DSH web 的 `/api` 有道「浏览器信任栅栏」：Host 不是 loopback 就必须在启动参数
`--trusted-host` 里，否则一率 403。所以远控实例必须这样起（`start-dsh-web.ps1`
已经这么写死了）：

```
node D:\npm-global\node_modules\@deepseek-ai\dsh\lib\bin.js web --trusted-host dsh.n1ngzhu0.dpdns.org
```

鉴权是两层的：启动时生成的 launch token（URL 里 `?token=…`）换一枚**绑定域名的
签名 cookie**；没 token 也没 cookie 的请求一率 401。所以手机首次访问用带 token
的链接，之后 cookie 一直有效。

- 重启：双击 `deploy\restart-dsh-web.cmd`（或 `start-dsh-web.ps1 -Restart`）。
  **重启 = 换 token = 所有设备（本机 + 手机）全部登出**，要用新链接重新进门。
- 两条带 token 的入口每次启动后写在 `deploy\dsh-web-url.txt`
  （本机一条 + `https://dsh.n1ngzhu0.dpdns.org/?token=…` 一条）。
  **该文件在 .gitignore 里，token 就是进程的钥匙，别外传、别提交。**
- 想再上一道锁：Zero Trust 控制台 → Access → Applications → Self-hosted，
  域名填 `dsh.n1ngzhu0.dpdns.org`，策略 Allow / Emails 填自己邮箱，
  IdP 用 One-time PIN。邮箱验证码过了才看得到 DSH 的 401 页。

### 11.4 日常操作速查

```powershell
# 看谁在跑
Get-ScheduledTask -TaskName 'MikuBlog*' | Format-Table TaskName, State
Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" | Select ProcessId, CommandLine
.\stop.ps1 -List

# 公网验活
curl.exe -I https://n1ngzhu0.dpdns.org/          # 302 = 门厅正常
curl.exe -I https://dsh.n1ngzhu0.dpdns.org/      # 401 = 鉴权墙正常

# 隧道视角
cloudflared tunnel info miku-blog
Get-Content deploy\tunnel.err.log -Tail 30       # cloudflared 的日志走 stderr

# 彻底下线
Stop-ScheduledTask -TaskName 'MikuBlog Keepalive'   # 停看门狗（登录任务下次登录还会起）
Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" |
  Where-Object CommandLine -match miku-blog | ForEach-Object { Stop-Process -Id $_.ProcessId }
.\stop.ps1                                            # 停源站
# 不要了就：cloudflared tunnel delete miku-blog（连 DNS 一起删）
```

### 11.5 维护注意（踩过的坑）

1. **.ps1 里的中文必须带 BOM 的 UTF-8**。用编辑工具改完 `.ps1` 要重新确认 BOM
   还在（`[System.IO.File]::ReadAllBytes($p)[0] -eq 0xEF`），丢了就整个文件
   `ParserError`，任务计划程序里跑还看不到报错（stdout 被丢）。校验：
   `[System.Management.Automation.Language.Parser]::ParseFile($p, [ref]$null, [ref]$errs)`。
2. **cloudflared 的 INF 日志走 stderr**：看 `deploy\tunnel.err.log`，别盯着空的
   `tunnel.log` 疑神疑鬼。
3. **任务计划程序里的动作 stdout 会被丢**：调试时把动作包一层
   `cmd /c … > log 2>&1` 再看。
4. 云村小服务照旧只服务本机；公网部署期间（4321 挂了 tunnel）不要让它起来。

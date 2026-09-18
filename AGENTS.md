# AGENTS.md — miku-blog 工作区指令

## 版本管理（默认强制）

本仓库默认启用完整版本管理。除非用户当次明确说「不发布 / 跳过版本」，
凡产生代码或内容变更的会话，收尾前必须完成以下四步：

1. **规范提交**：Conventional Commits（`type(scope): 描述`），类型只用
   feat / fix / docs / refactor / perf / test / chore。可调用 `gitx` 技能做智能提交与逻辑拆分；
   提交正文写清动机，不写「update」「修改」这类空话。
2. **版本迭代**：调用 `release-skills` 技能流程，以 `git log v..HEAD`（或工作区变更）为据：
   feat → 次位 +1；fix / docs / refactor / perf → 末位 +1；含 `BREAKING CHANGE` → 主位 +1。
   结果写入根目录 `VERSION`（以该文件当前内容为唯一版本真源）。
   版本号严格按上述规则计算后落笔，不做临场裁量、无需用户确认。
3. **更新日志**：在 `CHANGELOG.md`（中文，单文件）头部导语之后、最新版本条目之上
   插入新版本段，按功能/模块分组，沿用现有小节风格（新功能 / 变更 / 修复…）；
   条目写「对访客可见的变化」，不复述提交流水；空小节省略。
4. **发布提交与标签**：`chore: release v{version}` 提交 VERSION 与 CHANGELOG.md，
   打 `v{version}` 标签。**默认不 push 到远端，推送由用户自己完成。**

发布前可用 `release-skills --dry-run` 自查分组与版本号；版本号与是否发布都按上述
默认规则直接执行，不再向用户求确认。

### 提交前（密钥钩子）

启用一次（`core.hooksPath` 是本机配置，不跟着仓库走）：

```powershell
git config core.hooksPath .githooks
```

之后每次 `git commit` 都会跑 `node tools/secret-scan.mjs --staged`，扫两件事：
通用凭据（GitHub 令牌、云厂商 key、私钥、JWT、写在赋值里的口令），以及
**本机实况有没有漏回公开仓库**。命中就拦下提交。

已经公开过的历史旧账记在 `.secret-scan-baseline.json` 里（只存哈希，不存值），
不再让构建变红；新命中才拦。`--strict` 连旧账一起看，`--update-baseline` 认下新命中。

**别把只属于一台机器的值写进公开文件**——域名、隧道 ID、Windows 用户名、本机
绝对路径。它们该待在 `deploy/local.config.ps1` 与 `deploy/LOCAL-DEPLOY.md`
（两个都在 `.gitignore` 里），公开文档只留占位值。提交正文里也别复述这些值。

### 模块 scope 对照

站点只有一条线：Nuxt 应用（仓库根就是 srcDir）。

| scope | 覆盖范围 |
| --- | --- |
| app | Nuxt 应用本体：`app.vue`、`pages/**`、`components/**`、`composables/**`、`layouts/**`、`plugins/**`、`nuxt.config.ts` |
| assets | assets/css、assets/js（palette.js / qr.js / music.config.js）、assets/fonts、assets/audio、assets/vendor、media |
| server | server/**：`api/**`、`utils/**`、`middleware/**`，以及被运行时直接 import 的 `lib/**`（markdown / emoji / htmltext / authlimit） |
| tools | tools/**、start/stop 脚本、`tools/nuxt-*-check.mjs` 自检 |
| content | content/**、data/** |
| deploy | deploy/**、design/** |
| release | VERSION、CHANGELOG.md、.releaserc.yml、AGENTS.md |
| repo | 仓库机制：.gitignore、.gitattributes、.gitleaks.toml、.githooks/**、.github/**、.secret-scan-baseline.json |

### 约定

- 破坏性变更必须在提交正文标注 `BREAKING CHANGE: 说明`。
- **1.x 那条零构建静态线已经删除**（生成出来的 `*.html`、`server/server.mjs`、`server/lib` 里的
  渲染层、`assets/js` 里那批页面脚本、`tools/build.mjs` 与它那批自检）。
  别再往那条线上加东西：老地址只剩 `server/middleware/legacy-urls.ts` 里的一张 301 跳转表。
- `data/*`、`media/*`、`.ncm-session.json` 不入库（见 .gitignore），不参与版本记录。
- `.ps1` 一律存成**带 BOM 的 UTF-8**，`.cmd` 保持纯 ASCII（cmd.exe 会读错字节偏移）。
- 发布机制配置在 `.releaserc.yml`；要改发布流程（版本文件、日志文件、小节标题、
  提交信息格式）时，同步更新该文件与上面第 2、3 条。

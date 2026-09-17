/* ==========================================================================
   tools/preflight-check.mjs · 公网部署前的自检
   ---------------------------------------------------------------------------
   回答一个问题：**把这些东西原样挂到 Cloudflare Tunnel 上，会发生什么？**

   它不猜、不吓唬人，只做三件事：

     A. 本机配置（读文件）：口令强度、门厅开关、敏感文件会不会被静态服务读出来。
     B. 真实响应（需要一个跑着的服务）：一页一页去敲，看谁能不盖章就被读到。
        这是唯一能确认「哪些东西真的在公网上」的办法——读源码容易看漏。
     C. 写接口（需要一个跑着的服务）：不带口令去敲每一个写接口，确认它们都 401。
        写接口漏一个，整站就是别人可以改的。

   用法：

     node tools/preflight-check.mjs                        # 只跑 A
     node tools/preflight-check.mjs http://127.0.0.1:4399  # A + B + C（先另开窗口起服务）

  退出码：有「挡不住」的问题时非零。**它是给人看的清单，不是自动修复器**——
   每条都说清楚「为什么」和「怎么办」，改不改由你决定。
   ========================================================================== */

import { existsSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadSettings } from '../server/lib/store.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 结果分三档：ok / warn（能上线但要知道） / bad（别上线） */
const results = [];
const add = (level, title, why, fix) => results.push({ level, title, why, fix });
const ok = (title, why = '') => add('ok', title, why);
const warn = (title, why, fix) => add('warn', title, why, fix);
const bad = (title, why, fix) => add('bad', title, why, fix);

/* ------------------------------------------------------------ A. 本机配置 */

console.log('');
console.log('  A. 本机配置');
console.log('  ─────────────────────────────────────────────');

const settings = loadSettings();
const pass = String(settings.passphrase || '');

if (!pass) {
  bad('口令还没设置', '服务第一次启动时会自动生成一条；现在还没有。', '跑一次 start.cmd。');
} else if (pass.length < 16) {
  bad(`口令太短（${pass.length} 位）`, '公网上可被穷举：/api/auth 是一个没有摩擦的比对入口。',
    'node tools/set-passphrase.mjs 换一条 32 位的。');
} else if (pass.length < 24) {
  warn(`口令偏短（${pass.length} 位）`, '够用但不宽裕。', '公网部署建议 32 位：node tools/set-passphrase.mjs。');
} else {
  ok(`口令长度 ${pass.length} 位 · 约 ${Math.round(pass.length * Math.log2(57))} bit 熵`);
}

if (/^\d+$/.test(pass)) {
  bad('口令是纯数字', '纯数字口令在公网上的爆破成本低得可怕。', 'node tools/set-passphrase.mjs');
} else {
  ok('口令不是纯数字');
}

if (settings.gate === false) {
  warn('门厅是关着的（"gate": false）', '站点页面不再先过 login.html；访客直接落到首页。',
    '想让门厅继续当「开屏过场」就删掉 data/settings.json 里那一行。');
} else {
  ok('门厅开着（站点页面先过 login.html）');
}

/* 这几个目录/文件是**绝对不该被公网读到**的。静态服务有 HIDDEN 白名单，
   但白名单是代码里的一个数组——这里独立地再列一遍，照着实际目录核。 */
const mustStayPrivate = [
  ['data', '上传记录：板块树 / 文章 / 曲库 / 设置（含口令）'],
  ['server', '服务端源码'],
  ['tools', '自检脚本与云村小服务'],
  ['content', '内容源（含未发布的草稿）'],
  ['deploy/blog-server.log', '后台源站日志：**开头就印着口令**'],
  ['.ncm-session.json', '网易云登录态'],
];
for (const [rel, why] of mustStayPrivate) {
  if (existsSync(join(ROOT, rel))) ok(`存在且必须挡住：${rel}`, why);
}

/* 凭据类文件：万一有人把 cloudflared 的凭据拷进仓库 */
const credentialPatterns = [/^cert\.pem$/i, /cfargotunnel\.json$/i, /\.pem$/i];
const strayCreds = [];
(function walk(dir, depth = 0) {
  if (depth > 2) return;
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name === '.git' || e.name === 'node_modules' || e.name === 'media' || e.name === '.check') continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, depth + 1);
    else if (credentialPatterns.some((re) => re.test(e.name))) strayCreds.push(relative(ROOT, full));
  }
})(ROOT);
if (strayCreds.length) {
  warn(`仓库里出现了证书/凭据类文件：${strayCreds.join(', ')}`,
    'cloudflared 的 cert.pem 与 <TUNNEL-ID>.json 等于这台机器的钥匙。',
    '确认它们没被 git 跟踪（git check-ignore），该删就删。');
} else {
  ok('仓库里没有 cloudflared 凭据文件');
}

/* ------------------------------------------------------ B/C. 真接口（可选） */

const base = (process.argv[2] || '').replace(/\/+$/, '');
if (!base) {
  console.log('');
  console.log('  B/C. 真接口：跳过（没给地址）。要跑就：');
  console.log('     node server/server.mjs 4399');
  console.log('     node tools/preflight-check.mjs http://127.0.0.1:4399');
} else {
  console.log('');
  console.log(`  B. 不盖章去敲每一页 · ${base}`);
  console.log('  ─────────────────────────────────────────────');

  /* 只发一次请求、不跟着 302 走：我们要看的正是「服务答的是什么」。 */
  async function probe(path, options = {}) {
    try {
      const res = await fetch(base + path, { redirect: 'manual', ...options });
      return { status: res.status, location: res.headers.get('location') || '', type: res.headers.get('content-type') || '' };
    } catch (err) {
      return { status: 0, error: err.message };
    }
  }

  /* 该被门厅挡住的：站点页面。
     旧站的地址带 .html（archive.html），Nuxt 这边是干净路由（/archive）——
     两种写法都探一遍，这样这个脚本对着新旧哪一台服务跑都成立。 */
  const gated = ['/', '/index.html', '/archive', '/archive.html', '/editor', '/editor.html', '/about', '/about.html'];
  for (const p of gated) {
    const r = await probe(p);
    if (r.status === 0) { bad(`连不上 ${p}`, r.error, '服务起来了吗？'); continue; }
    /* 门厅可能把人送回 /login 或旧站的 /login.html，两种都算挡住了 */
    if (r.status === 302 && /\/login(\.html)?(\?|$)/.test(r.location)) ok(`${p} → 302 门厅`);
    else bad(`${p} 没被门厅挡住（${r.status}）`, '任何拿到地址的人都能直接读到这一页。',
      '确认 data/settings.json 里没有 "gate": false。');
  }

  /* 门厅自己必须永远进得去 */
  for (const p of ['/login', '/login.html']) {
    const r = await probe(p);
    if (r.status === 200) ok(`${p} 不挡（门厅自己必须进得去）`);
    else if (r.status === 404 && p === '/login.html') warn(`${p} 返回 404`, '旧地址；Nuxt 这一侧的门厅在 /login。', '要对旧站跑这个脚本时才需要它。');
    else warn(`${p} 返回 ${r.status}`, '门厅自己应该永远可读。', '检查门厅在 gate 里的例外。');
  }

  /* 必须挡住的：服务端数据与源码 */
  console.log('');
  console.log('  服务端数据与源码');
  const forbidden = [
    '/data/settings.json', '/data/articles.json', '/data/sections.json', '/data/music.json',
    '/data/overrides.json',
    '/server/server.mjs', '/server/lib/store.mjs', '/tools/ncm-server.mjs', '/tools/set-passphrase.mjs',
    '/content/posts.mjs', '/content/palette.mjs',
    '/deploy/blog-server.log',   // 开头就印着口令
    '/deploy/start-blog-background.ps1',
    '/deploy/CLOUDFLARE-TUNNEL.md',
    '/.ncm-session.json',        // 网易云登录态（曾经真的漏过，见 server.mjs 的 HIDDEN）
    '/.env', '/.credentials.yaml', '/.gitignore',
    '/.git/config',
  ];
  for (const p of forbidden) {
    const r = await probe(p);
    if (r.status === 0) { bad(`连不上 ${p}`, r.error, '服务起来了吗？'); continue; }
    if (r.status === 200) {
      bad(`${p} 被读到了（200）`, '这个文件本来就不该离开这台机器。',
        '检查 server.mjs 顶部的 HIDDEN 与 serveStatic() 的白名单。');
    } else {
      ok(`${p} → ${r.status}`);
    }
  }

  /* 端口 3170 的云村小服务：绝对不能被 tunnel 出去 */
  console.log('');
  console.log('  云村小服务（3170）');
  const ncm = await probe('http://127.0.0.1:3170/api/health').catch(() => ({ status: 0 }));
  if (ncm.status === 0) {
    ok('云村小服务没在跑（公网部署时最好就是这样）',
      '它旁边存着 .ncm-session.json，开 tunnel 等于把网易云登录态送出去。');
  } else {
    warn('云村小服务正在跑', '它旁边存着 .ncm-session.json（你的网易云登录态）。',
      '**不要**给它建 tunnel 或 Public Hostname。用完 stop.cmd 收掉。');
  }

  /* C. 写接口：不带口令一律 401 */
  console.log('');
  console.log('  C. 写接口不带口令去敲');
  console.log('  ─────────────────────────────────────────────');
  const writes = [
    ['POST', '/api/sections', '{}'],
    ['POST', '/api/articles', '{}'],
    ['POST', '/api/music', '{}'],
    ['PATCH', '/api/music/settings', '{}'],
    ['POST', '/api/media', '{}'],
  ];
  for (const [method, p, body] of writes) {
    const r = await probe(p, {
      method,
      headers: { 'content-type': 'application/json' },
      body,
    });
    if (r.status === 0) { bad(`连不上 ${method} ${p}`, r.error, '服务起来了吗？'); continue; }
    if (r.status === 401 || r.status === 403) ok(`${method} ${p} → ${r.status}`);
    else bad(`${method} ${p} 没要求口令（${r.status}）`, '没有口令的人也能改站点。',
      '确认这条路由前面有 requireAuth()。');
  }

  /* /api/render 是**故意**不要口令的（写文章时右栏实时预览要用），
     但它不落盘、不泄数据，只白算 CPU。所以这里只确认它没有变成写入口。 */
  const render = await probe('/api/render', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source: '# 预检\n\n$E=mc^2$' }),
  });
  if (render.status === 200) {
    warn('/api/render 不需要口令（200）', '这是设计如此（编辑页的实时预览靠它），它不落盘。',
      '它只白算：正文上限 256KB、同时在渲染最多 2 个，超了 429。不想暴露就上 Cloudflare Access。');
  } else if (render.status === 429) {
    ok('/api/render 在忙时返回 429（闸门生效）');
  } else {
    ok(`/api/render → ${render.status}`);
  }

  /* 读接口：现在是不挡的——列出来，让人做一次有意识的决定 */
  console.log('');
  console.log('  读接口（当前设计就是不挡，上线前请确认你知道）');
  for (const p of ['/api/health', '/api/sections', '/api/posts', '/api/articles', '/api/music', '/api/state']) {
    const r = await probe(p);
    if (r.status === 200) warn(`${p} 公开可读（200）`, '板块树 / 文章元数据 / 曲库会被任何拿到地址的人读到。',
      '不想公开就上 Cloudflare Access，或给读接口也加门厅。');
    else ok(`${p} → ${r.status}`);
  }
}

/* ------------------------------------------------------------------ 汇总 */

const bads = results.filter((r) => r.level === 'bad');
const warns = results.filter((r) => r.level === 'warn');
const oks = results.filter((r) => r.level === 'ok');

console.log('');
console.log('  ─────────────────────────────────────────────');
console.log(`  别上线：${bads.length} · 要知道：${warns.length} · 通过：${oks.length}`);
console.log('');

const show = (list, mark) => {
  for (const r of list) {
    console.log(`  ${mark} ${r.title}`);
    if (r.why) console.log(`      ${r.why}`);
    if (r.fix) console.log(`      → ${r.fix}`);
  }
};
if (bads.length) { console.log('  必须处理：'); show(bads, '✗'); console.log(''); }
if (warns.length) { console.log('  建议处理：'); show(warns, '!'); console.log(''); }
if (!bads.length && !warns.length) console.log('  没有要处理的。可以按 deploy/CLOUDFLARE-TUNNEL.md 往下走了。');
console.log('');

process.exit(bads.length ? 1 : 0);

/* ==========================================================================
   tools/dom-check.mjs · 用 Chrome DevTools 协议做一次真实的页面自检
   ---------------------------------------------------------------------------
   零依赖：自己拼 WebSocket 帧跟无头 Chrome 说话，不装 puppeteer。
   做四件事：
     1) 打开每一类页面，收集 console 报错 / 未捕获异常 / 加载失败的资源
     2) 模拟真人操作：登录口令 → 开音乐盒面板 → 开新建板块面板
     3) 站内跳转走局部刷新，逐页量「音乐有没有被从头再放」（同一根 <audio>、currentTime 只增不减）
     4) 建一个临时板块 + 子板块：不刷新页面，量它们有没有立刻出现在轨道栏 / 首页索引 /
        大卷帘 / 板块页的子板块列表里，然后删掉、量有没有立刻消失（跑完自己清理干净）
     5) 截图存到 .check/ 里，用眼睛再过一遍

   用法（服务要先跑起来）：
     node server/server.mjs 4321
     node tools/dom-check.mjs            # 默认 http://127.0.0.1:4321
   ========================================================================== */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = process.argv[2] || 'http://127.0.0.1:4321';
const PORT = 9333 + Math.floor(Math.random() * 200);
const SHOTS = join(ROOT, '.check');

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));

if (!CHROME) {
  console.error('没找到 Chrome 或 Edge，跳过页面自检');
  process.exit(0);
}

/* ------------------------------------------------------------------ 口令 */
function passphrase() {
  const file = join(ROOT, 'data', 'settings.json');
  if (!existsSync(file)) return '';
  try { return JSON.parse(readFileSync(file, 'utf8')).passphrase || ''; } catch { return ''; }
}

/* ------------------------------------------------------------------ CDP */
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
    this.buf = Buffer.alloc(0);
  }

  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    const cdp = new Cdp(ws);
    ws.addEventListener('message', (e) => cdp.onMessage(e.data));
    return cdp;
  }

  onMessage(data) {
    try {
      this.handle(data);
    } catch (err) {
      console.log('[cdp] 解析入站消息出错：', err.message, '原始：', String(data).slice(0, 200));
    }
  }

  handle(data) {
    /* Node 的 WebSocket 交出来的已经是解好帧的文本/二进制，不用自己解；
       只有拿到原始 Buffer 时才走下面的解帧分支。 */
    if (typeof data === 'string') return this.dispatch(data);
    const buf = Buffer.from(data);
    if (buf.length && buf[0] === 0x7b) return this.dispatch(buf.toString('utf8'));

    this.buf = Buffer.concat([this.buf, buf]);
    for (;;) {
      const frame = this.readFrame();
      if (!frame) break;
      if (frame.opcode === 0x8) return;
      if (frame.opcode === 0x9) continue; // ping：Node 的 WebSocket 自己会回 pong
      if (frame.opcode !== 0x1 && frame.opcode !== 0x0) continue;
      /* 大消息（比如截图）会拆成 1 + 0x0 续帧 */
      if (frame.opcode === 0x1) this.fragments = [frame.payload];
      else if (this.fragments) this.fragments.push(frame.payload);
      if (!frame.fin) continue;
      const payload = this.fragments && this.fragments.length > 1
        ? Buffer.concat(this.fragments)
        : frame.payload;
      this.fragments = null;
      this.dispatch(payload.toString('utf8'));
    }
  }

  dispatch(text) {
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method) {
      this.listeners.forEach((fn) => fn(msg));
    }
  }

  readFrame() {
    const b = this.buf;
    if (b.length < 2) return null;
    const fin = (b[0] & 0x80) !== 0;
    const opcode = b[0] & 0x0f;
    const masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f;
    let offset = 2;
    if (len === 126) {
      if (b.length < 4) return null;
      len = b.readUInt16BE(2);
      offset = 4;
    } else if (len === 127) {
      if (b.length < 10) return null;
      len = Number(b.readBigUInt64BE(2));
      offset = 10;
    }
    if (masked) offset += 4;
    if (b.length < offset + len) return null;
    const payload = b.subarray(offset, offset + len);
    this.buf = b.subarray(offset + len);
    return { fin, opcode, payload: Buffer.from(payload) };
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    this.ws.send(JSON.stringify(msg));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`${method} 超时`));
        }
      }, 30000);
    });
  }

  close() { try { this.ws.close(); } catch { /* 已经关了 */ } }
}

async function waitForChrome() {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return (await res.json()).webSocketDebuggerUrl;
    } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error('Chrome 没有在 15 秒内起来');
}

/* ------------------------------------------------------------------ 主流程 */
const profile = join(tmpdir(), `cv01-cdp-${randomBytes(4).toString('hex')}`);
mkdirSync(SHOTS, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--hide-scrollbars',
  '--mute-audio',
  /* 自动播放策略：无头浏览器默认说「没有用户手势」，
     不放开的话「音乐在跳转时有没有被切断」这条就永远量不到 */
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--window-size=1280,1000',
  'about:blank',
], { stdio: 'ignore', detached: false });

let cdp;
const problems = [];
const results = [];
/* 自检过程中临时建出来的板块 / 子板块，收尾时按这两个 id 删掉 */
const tempMade = { section: '', sub: '' };

try {
  const browserWs = await waitForChrome();
  cdp = await Cdp.connect(browserWs);

  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

  const send = (method, params) => cdp.send(method, params, sessionId);

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Network.enable');

  let consoleErrors = [];
  cdp.listeners.push((msg) => {
    if (msg.sessionId && msg.sessionId !== sessionId) return;
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      consoleErrors.push(d.exception?.description || d.text || '未捕获异常');
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      const text = msg.params.entry.text || '';
      const url = msg.params.entry.url || '';
      /* assets/audio/ 里的采样是可选的：没放文件时「按音高找采样」这一步必然 404，
         然后退回现场合成——那不是错，别记进来（不然一开音效就一片红） */
      if (!/\/assets\/audio\//.test(text) && !/\/assets\/audio\//.test(url)) {
        consoleErrors.push(`${text} ${url}`);
      }
    }
    if (msg.method === 'Network.loadingFailed' && !/net::ERR_ABORTED/.test(msg.params.errorText)) {
      consoleErrors.push(`资源加载失败：${msg.params.errorText}`);
    }
  });

  async function evaluate(expression) {
    const res = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || '求值失败');
    return res.result.value;
  }

  async function goto(url) {
    consoleErrors = [];
    const loaded = new Promise((resolve) => {
      const fn = (msg) => {
        if (msg.method === 'Page.loadEventFired') {
          cdp.listeners = cdp.listeners.filter((x) => x !== fn);
          resolve();
        }
      };
      cdp.listeners.push(fn);
    });
    await send('Page.navigate', { url });
    await loaded;
    /* 让 fetch / 定时器跑完 */
    await evaluate('new Promise(r => setTimeout(r, 900))');
  }

  async function shot(name) {
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const file = join(SHOTS, `${name}.png`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    return file;
  }

  function check(name, ok, detail = '') {
    results.push({ name, ok, detail });
    if (!ok) problems.push(`${name} ${detail}`);
  }

  /* --- 1. 每一类页面：能不能打开、有没有报错 --- */
  /* 先过门厅：站点页面现在要先盖章（?enter=1 由服务回应一枚三十天的 cookie），
     不盖的话下面每一条都会被 302 送回 login.html */
  await goto(SITE + '/index.html?enter=1');
  const pages = [
    ['首页', '/index.html'],
    ['归档', '/archive.html'],
    ['板块页', '/sections/suiyu.html'],
    ['文章页', '/posts/rainy-day.html'],
    ['关于', '/about.html'],
  ];
  for (const [name, path] of pages) {
    await goto(SITE + path);
    const title = await evaluate('document.title');
    check(`${name}打开`, Boolean(title), title);
    check(`${name}控制台干净`, consoleErrors.length === 0, consoleErrors.join(' | '));
    const hasStudio = await evaluate('Boolean(document.querySelector("[data-studio]"))');
    check(`${name}有工作台挂载点`, hasStudio);
  }

  /* --- 2. 登录 + 音乐盒面板 --- */
  await goto(SITE + '/index.html');
  const key = passphrase();
  await evaluate(`localStorage.setItem('cv01-key', ${JSON.stringify(key)})`);
  const online = await evaluate('new Promise(r => setTimeout(() => r(Boolean(window.cv01 && window.cv01.isOnline())), 1200))');
  check('工作台连上服务', online);
  const ballCount = await evaluate('document.querySelectorAll("[data-ball]").length');
  check('悬浮球有两颗', ballCount === 2, `实际 ${ballCount}`);

  await evaluate('document.querySelector(\'[data-ball="music"]\').click()');
  await evaluate('new Promise(r => setTimeout(r, 700))');
  const music = await evaluate(`JSON.stringify({
    panel: !!document.querySelector('.mp'),
    items: document.querySelectorAll('.mp-item').length,
    now: (document.querySelector('[data-now]')||{}).textContent || '',
    hasDrop: !!document.querySelector('.mp__drop'),
    hasMode: !!document.querySelector('[data-mode]'),
    hasVol: !!document.querySelector('[data-vol]')
  })`);
  const m = JSON.parse(music);
  check('音乐盒面板打开', m.panel);
  check('曲目列表非空', m.items > 0, `items=${m.items}`);
  check('音乐盒面板：有循环 / 音量，上传区已搬去站长球', !m.hasDrop && m.hasMode && m.hasVol,
    `drop=${m.hasDrop} mode=${m.hasMode} vol=${m.hasVol}`);
  await shot('panel-music');

  /* --- 2b. 音乐盒是公开的：没口令也开得开，站长那几颗按钮不显示 --- */
  await evaluate('window.cv01.closePanel()');
  await evaluate('localStorage.removeItem("cv01-key")');
  await evaluate('document.querySelector(\'[data-ball="music"]\').click()');
  await evaluate('new Promise(r => setTimeout(r, 800))');
  const anon = JSON.parse(await evaluate(`JSON.stringify({
    open: !!document.querySelector('.mp'),
    gate: !!document.querySelector('.keygate'),
    ownerBtns: document.querySelectorAll('.mp-item [data-swap]:not([hidden]), .mp-item [data-del]:not([hidden]), .mp-item [data-rename]:not([hidden])').length,
    pinBtns: document.querySelectorAll('.mp-item [data-pin]:not([hidden])').length
  })`));
  check('音乐盒不需要口令就能开', anon.open && !anon.gate, `open=${anon.open} gate=${anon.gate}`);
  check('没口令看不到「换 / 改名 / 删」', anon.ownerBtns === 0, `ownerBtns=${anon.ownerBtns}`);
  check('「设默认」对所有人都在', anon.pinBtns > 0, `pin=${anon.pinBtns}`);

  await evaluate(`localStorage.setItem('cv01-key', ${JSON.stringify(key)})`);
  await evaluate('window.cv01.closePanel()');
  await evaluate('document.querySelector(\'[data-ball="music"]\').click()');
  await evaluate('new Promise(r => setTimeout(r, 800))');
  const asOwner = JSON.parse(await evaluate(`JSON.stringify({
    ownerBtns: document.querySelectorAll('.mp-item [data-swap]:not([hidden])').length
  })`));
  check('有口令时「换」这类按钮才出现', asOwner.ownerBtns > 0, `swap=${asOwner.ownerBtns}`);
  await evaluate('window.cv01.closePanel()');

  /* --- 2c. 站长球要口令：没口令时先弹口令条，不放行菜单 --- */
  await evaluate('localStorage.removeItem("cv01-key")');
  await evaluate('document.querySelector(\'[data-ball="owner"]\').click()');
  await evaluate('new Promise(r => setTimeout(r, 900))');
  const gated = JSON.parse(await evaluate(`JSON.stringify({
    gate: !!document.querySelector('.keygate'),
    menu: !!document.querySelector('.ow'),
    panel: !!document.querySelector('.studio__panel') && !document.querySelector('.studio__panel').hidden
  })`));
  check('站长球没口令时会问口令，不放行菜单', gated.gate && !gated.menu && !gated.panel,
    `gate=${gated.gate} menu=${gated.menu} panel=${gated.panel}`);
  /* 取消口令条，把口令放回去，后面接着用 */
  await evaluate('(function(){ var c = document.querySelector(".keygate__cancel"); if (c) c.click(); })()');
  await evaluate(`localStorage.setItem('cv01-key', ${JSON.stringify(key)})`);
  await evaluate('new Promise(r => setTimeout(r, 400))');

  /* --- 3. 站长工具箱：三选一 → 新建板块 / 上传音乐 --- */
  await evaluate('document.querySelector(\'[data-ball="owner"]\').click()');
  await evaluate('new Promise(r => setTimeout(r, 900))');
  const box = JSON.parse(await evaluate(`JSON.stringify({
    menu: !!document.querySelector('.ow'),
    items: document.querySelectorAll('.ow__item').length,
    hasEditor: !!document.querySelector('.ow__item[href$="editor.html"]')
  })`));
  check('站长球打开的是三选一的工具箱', box.menu && box.items === 3, `menu=${box.menu} items=${box.items}`);
  check('工具箱里有去编辑页的入口', box.hasEditor);

  await evaluate('document.querySelector(\'[data-go="section"]\').click()');
  await evaluate('new Promise(r => setTimeout(r, 900))');
  const sect = await evaluate(`JSON.stringify({
    panel: !!document.querySelector('.sc'),
    back: !!document.querySelector('.ow__back'),
    pitches: document.querySelectorAll('[data-pitch] option').length,
    subs: document.querySelectorAll('[data-sublist] li').length,
    parents: document.querySelectorAll('[data-parent] option').length
  })`);
  const s = JSON.parse(sect);
  check('工具箱里能进「新建板块」', s.panel && s.back);
  check('音高下拉有选项', s.pitches > 40, `pitches=${s.pitches}`);
  check('子板块列表有内容', s.subs > 0, `subs=${s.subs}`);

  await evaluate('document.querySelector(\'.ow__back\').click()');
  await evaluate('new Promise(r => setTimeout(r, 400))');
  await evaluate('document.querySelector(\'[data-go="music"]\').click()');
  await evaluate('new Promise(r => setTimeout(r, 600))');
  const up = JSON.parse(await evaluate(`JSON.stringify({
    drop: !!document.querySelector('.mp__drop'),
    pick: !!document.querySelector('.mp__pick'),
    file: !!document.querySelector('[data-file]')
  })`));
  check('工具箱里能进「上传音乐盒的音乐」', up.drop && up.pick && up.file,
    `drop=${up.drop} pick=${up.pick} file=${up.file}`);
  await shot('panel-owner');

  /* --- 4. 夜间调声下再看一眼工作台 --- */
  await goto(SITE + '/index.html?open=music');
  await evaluate(`localStorage.setItem('cv01-key', ${JSON.stringify(key)}); localStorage.setItem('cv01-theme','dark'); location.reload();`);
  await new Promise((r) => setTimeout(r, 1500));
  const dark = await evaluate(`JSON.stringify({
    theme: document.documentElement.getAttribute('data-theme'),
    panel: !!document.querySelector('.mp')
  })`);
  const d = JSON.parse(dark);
  check('夜间主题生效', d.theme === 'dark', d.theme);
  check('深链 ?open=music 展开面板', d.panel);
  await shot('dark-music');

  /* --- 5. 局部刷新：切板块、翻文章，音乐一秒都不该断 --- */
  consoleErrors = [];
  await goto(SITE + '/index.html');
  await evaluate(`localStorage.setItem('cv01-key', ${JSON.stringify(key)})`);
  await evaluate('new Promise(r => setTimeout(r, 1600))');

  const boot = await evaluate(`(function(){
    var a = document.querySelector('[data-bgm]');
    window.__cv01Audio = a;                      // 认准这一根元素
    return JSON.stringify({
      src: decodeURIComponent(a.currentSrc || ''),
      t: a.currentTime,
      paused: a.paused,
      api: window.cv01.api,
      path: location.pathname
    });
  })()`);
  const b = JSON.parse(boot);
  check('首页音乐真的放起来了', !b.paused && b.t > 0, `paused=${b.paused} t=${b.t.toFixed(2)}`);
  check('首页的接口基址是 api/', b.api === 'api/', b.api);

  /* 首页 → 板块页。
     挑一条「不是运行时补进来的」：运行时新建的板块可能一篇文章都还没有
     （data-live 就是下面那段板块树合并补上去的标记）。 */
  await evaluate('document.querySelectorAll(".entry-list .entry:not([data-live]) .entry__name a")[0].click()');
  await evaluate('new Promise(r => setTimeout(r, 1400))');
  const sec = JSON.parse(await evaluate(`JSON.stringify({
    path: location.pathname,
    same: document.querySelector('[data-bgm]') === window.__cv01Audio,
    t: window.__cv01Audio.currentTime,
    paused: window.__cv01Audio.paused,
    api: window.cv01.api,
    title: document.title,
    rail: (document.querySelector('.rail a[aria-current="page"]') || {}).getAttribute
      ? document.querySelector('.rail a[aria-current="page"]').getAttribute('data-pitch') : '',
    nav: (document.querySelector('.bar__nav a[aria-current="page"]') || {}).textContent || '',
    h1: (document.querySelector('main#main h1') || {}).textContent || '',
    rows: document.querySelectorAll('.post-row').length
  })`));
  check('切板块：地址变成 /sections/', /^\/sections\//.test(sec.path), sec.path);
  check('切板块：还是同一根 <audio>', sec.same);
  check('切板块：音乐接着放（没有从头）', !sec.paused && sec.t > b.t, `${b.t.toFixed(2)} → ${sec.t.toFixed(2)}`);
  check('切板块：接口基址跟着变成 ../api/', sec.api === '../api/', sec.api);
  check('切板块：正文真的换了', Boolean(sec.h1) && sec.h1 !== '初音ミク', sec.h1);
  check('切板块：轨道栏高亮跟着走', Boolean(sec.rail), sec.rail);
  check('切板块：文章列表也换过来了', sec.rows > 0, `rows=${sec.rows}`);

  /* 板块页 → 文章页 */
  await evaluate('document.querySelector(".post-row__link").click()');
  await evaluate('new Promise(r => setTimeout(r, 1400))');
  const post = JSON.parse(await evaluate(`JSON.stringify({
    path: location.pathname,
    same: document.querySelector('[data-bgm]') === window.__cv01Audio,
    t: window.__cv01Audio.currentTime,
    paused: window.__cv01Audio.paused,
    api: window.cv01.api,
    h1: (document.querySelector('main#main h1') || {}).textContent || ''
  })`));
  check('进文章：地址变成 /posts/', /^\/posts\//.test(post.path), post.path);
  check('进文章：还是同一根 <audio>', post.same);
  check('进文章：音乐接着放（没有从头）', !post.paused && post.t > sec.t, `${sec.t.toFixed(2)} → ${post.t.toFixed(2)}`);
  check('进文章：正文是真的那篇文章', Boolean(post.h1), post.h1);

  /* 文章页的 ../api/ 还能不能真的取到东西（基址算错的话这里就是 404） */
  const postApi = JSON.parse(await evaluate(`
    window.cv01.fetchJSON(window.cv01.api + 'music').then(function (d) {
      return JSON.stringify({ api: window.cv01.api, tracks: (d.tracks || []).length });
    })`));
  check('进文章：../api/ 真的能取到数据', postApi.tracks > 0, `${postApi.api} → ${postApi.tracks} 首`);
  await shot('spa-post');

  /* 后退：整页不刷，音乐照样不停 */
  await evaluate('history.back()');
  await evaluate('new Promise(r => setTimeout(r, 1400))');
  const back = JSON.parse(await evaluate(`JSON.stringify({
    path: location.pathname,
    same: document.querySelector('[data-bgm]') === window.__cv01Audio,
    t: window.__cv01Audio.currentTime,
    paused: window.__cv01Audio.paused
  })`));
  check('后退回到板块页（没有整页跳转）', /^\/sections\//.test(back.path), back.path);
  check('后退：还是同一根 <audio>', back.same);
  check('后退：音乐接着放', !back.paused && back.t > post.t, `${post.t.toFixed(2)} → ${back.t.toFixed(2)}`);

  /* 从命令栏回首页：大卷帘要重新点亮（说明 site.js 的每页初始化真的重跑了一遍） */
  await evaluate('document.querySelector(".bar__nav a[href$=\'index.html\']").click()');
  await evaluate('new Promise(r => setTimeout(r, 2600))');
  const home = JSON.parse(await evaluate(`JSON.stringify({
    path: location.pathname,
    same: document.querySelector('[data-bgm]') === window.__cv01Audio,
    t: window.__cv01Audio.currentTime,
    paused: window.__cv01Audio.paused,
    notes: document.querySelectorAll('[data-roll] .note').length,
    lit: document.querySelectorAll('[data-roll] .note.is-lit').length,
    api: window.cv01.api
  })`));
  check('回首页：地址与基址都对', /\/index\.html$/.test(home.path) && home.api === 'api/', `${home.path} ${home.api}`);
  check('回首页：大卷帘重新点亮', home.notes > 0 && home.lit > 0, `${home.lit}/${home.notes} 个音符已点亮`);
  check('回首页：音乐仍旧不断', home.same && !home.paused && home.t > back.t,
    `${back.t.toFixed(2)} → ${home.t.toFixed(2)}`);

  /* 滚动位置：从首页滚下去再进文章，返回时应该回到原来的位置 */
  await evaluate('window.scrollTo(0, 1200)');
  await evaluate('new Promise(r => setTimeout(r, 250))');
  await evaluate('document.querySelectorAll(".entry__name a")[3].click()');
  await evaluate('new Promise(r => setTimeout(r, 1300))');
  await evaluate('history.back()');
  await evaluate('new Promise(r => setTimeout(r, 1400))');
  const restored = JSON.parse(await evaluate(`JSON.stringify({
    path: location.pathname,
    y: Math.round(window.scrollY)
  })`));
  check('返回时滚动位置还原', /\/index\.html$/.test(restored.path) && restored.y > 900, `${restored.path} y=${restored.y}`);

  check('局部刷新期间控制台干净', consoleErrors.length === 0, consoleErrors.join(' | '));

  /* 开着音效时，点轨道名要「先响一声，再切模块」——这条也得走局部刷新。
     顺便把「声音到底出没出」量出来：数一次 OscillatorNode（assets/audio/ 空着时，
     合成音就是靠它发声）。运行时新建的板块音高（B5 这种）以前不在频率表里，点了是哑的。 */
  await evaluate(`localStorage.setItem('cv01-sound', 'on')`);
  await goto(SITE + '/index.html');
  await evaluate('new Promise(r => setTimeout(r, 1200))');
  await evaluate('window.__cv01Audio = document.querySelector("[data-bgm]")');
  const spy = await evaluate(`(function(){
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return 'no-webaudio';
    window.__osc = 0;
    var proto = AC.prototype;
    var orig = proto.createOscillator;
    if (!orig.__cv01Spy) {
      proto.createOscillator = function () { window.__osc++; return orig.apply(this, arguments); };
      proto.createOscillator.__cv01Spy = true;
    }
    return 'ok';
  })()`);
  const railPitches = await evaluate('Array.prototype.map.call(document.querySelectorAll(".rail .key"), function (k) { return k.getAttribute("data-pitch"); })');
  await evaluate('document.querySelector(".rail .key").click()');
  await evaluate('new Promise(r => setTimeout(r, 1700))');
  const bySound = JSON.parse(await evaluate(`JSON.stringify({
    path: location.pathname,
    same: document.querySelector('[data-bgm]') === window.__cv01Audio,
    h1: (document.querySelector('main#main h1') || {}).textContent || '',
    osc: window.__osc || 0
  })`));
  check('开着音效点轨道名：还是局部刷新', /^\/sections\//.test(bySound.path) && bySound.same,
    `${bySound.path} ${bySound.h1}`);
  check('点轨道名真的出声了（最高的那个音高）', spy === 'ok' && bySound.osc > 0,
    `pitch=${railPitches[0]} oscillators=${bySound.osc}`);

  /* 再点一个原生音高当对照：新公式不能把老的那九个弄哑 */
  await evaluate('window.__osc = 0');
  await evaluate('(document.querySelector(\'.rail a[data-pitch="A5"]\') || document.querySelector(".rail .key")).click()');
  await evaluate('new Promise(r => setTimeout(r, 1700))');
  const seedOsc = await evaluate('window.__osc || 0');
  check('原生音高（A5）也照样出声', seedOsc > 0, `oscillators=${seedOsc}`);
  await evaluate(`localStorage.removeItem('cv01-sound')`);

  /* 云村页有自己的脚本与定时器：它必须整页走（换掉整份文档） */
  await goto(SITE + '/index.html');
  await evaluate('new Promise(r => setTimeout(r, 900))');
  await evaluate('document.querySelector(".bar__nav a[href$=\'kumura.html\']").click()');
  await evaluate('new Promise(r => setTimeout(r, 1600))');
  const km = JSON.parse(await evaluate(`JSON.stringify({
    path: location.pathname,
    title: document.title,
    musicBox: !!document.querySelector('[data-music]')
  })`));
  check('云村页照旧整页跳转', /kumura\.html$/.test(km.path) && km.musicBox, `${km.path} ${km.title}`);

  check('局部刷新期间控制台干净', consoleErrors.length === 0, consoleErrors.join(' | '));

  /* --- 6. 运行时新建的板块 / 子板块要立刻出现在静态页上 --- */
  consoleErrors = [];
  const formPost = (path, fields) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    return fetch(SITE + path, { method: 'POST', headers: { 'x-cv01-key': key }, body: fd }).then((r) => r.json());
  };
  const formDelete = (path) =>
    fetch(SITE + path, { method: 'DELETE', headers: { 'x-cv01-key': key } }).then((r) => r.json());
  const tree = () => evaluate(`JSON.stringify({
    rail: document.querySelectorAll('.rail a.key').length,
    entries: document.querySelectorAll('.entry-list .entry').length,
    heads: document.querySelectorAll('.roll__heads .head').length,
    caps: document.querySelectorAll('.roll__keys .keycap').length,
    lanes: document.querySelectorAll('.roll__lanes .lane').length,
    hasNew: !!document.querySelector('.rail a.key[data-pitch="C6"]'),
    label: (document.querySelector('.rail__label') || {}).textContent || '',
    subnav: Array.prototype.map.call(document.querySelectorAll('main .subnav .subnav__name'),
      function (n) { return n.textContent; }).join('、')
  })`).then(JSON.parse);

  await goto(SITE + '/index.html');
  await evaluate(`localStorage.setItem('cv01-key', ${JSON.stringify(key)})`);
  await evaluate('new Promise(r => setTimeout(r, 1400))');
  const before = await tree();

  const made = await formPost('/api/sections', { name: '自检临时板块', pitch: 'C6', def: '一会儿就删' });
  tempMade.section = made.section ? made.section.id : '';
  const madeSub = await formPost('/api/sections/suiyu/subs', { name: '自检临时子板块' });
  tempMade.sub = madeSub.sub ? madeSub.sub.id : '';
  check('临时板块/子板块建得出来', Boolean(tempMade.section) && Boolean(tempMade.sub),
    `${tempMade.section} / ${tempMade.sub}`);

  /* 界面建完就是派这个事件；这里不刷新页面，只派事件 */
  await evaluate(`document.dispatchEvent(new CustomEvent('cv01:sections-changed'))`);
  await evaluate('new Promise(r => setTimeout(r, 1200))');
  const after = await tree();
  check('建完不刷新：轨道栏多一条（高音在上）', after.rail === before.rail + 1 && after.hasNew,
    `${before.rail} → ${after.rail}，B5/C6 在最上面=${after.hasNew}`);
  check('建完不刷新：首页索引跟着多一项', after.entries === before.entries + 1, `${before.entries} → ${after.entries}`);
  check('建完不刷新：大卷帘三列一起多一条',
    after.heads === before.heads + 1 && after.caps === before.caps + 1 && after.lanes === before.lanes + 1,
    `${after.heads}/${after.caps}/${after.lanes}`);
  check('建完不刷新：轨道栏标签也跟着改', /十一个音/.test(after.label), after.label);

  /* 刚建的板块要能当场点、当场出声：点顶栏「开启音效」（页面不刷新，走的就是真人的路），
     再点那条新轨道 —— 它挑的音高（C6）不在原来那张九音表里，以前点了是哑的。 */
  await evaluate(`(function(){
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    window.__osc = 0;
    var proto = AC.prototype;
    var orig = proto.createOscillator;
    if (!orig.__cv01Spy) {
      proto.createOscillator = function () { window.__osc++; return orig.apply(this, arguments); };
      proto.createOscillator.__cv01Spy = true;
    }
  })()`);
  /* 开启音效那一下本身会「应一声」，把那个计数抹掉再点轨道 */
  const soundOn = await evaluate(`(function(){
    var b = document.querySelector('[data-sound-toggle]');
    if (!b) return 'no-button';
    if (b.getAttribute('aria-pressed') !== 'true') b.click();
    window.__osc = 0;
    return b.getAttribute('aria-pressed');
  })()`);
  await evaluate('document.querySelector(\'.rail a.key[data-pitch="C6"]\').click()');
  await evaluate('new Promise(r => setTimeout(r, 1700))');
  const freshCut = JSON.parse(await evaluate(`JSON.stringify({
    path: location.pathname,
    h1: (document.querySelector('main#main h1') || {}).textContent || '',
    osc: window.__osc || 0
  })`));
  check('刚建的板块：不刷新就切得进去', /^\/sections\//.test(freshCut.path) && freshCut.h1 === '自检临时板块',
    `${freshCut.path} ${freshCut.h1}`);
  check('刚建的板块：当场就有声音（C6 也算得出来）', soundOn === 'true' && freshCut.osc > 0,
    `音效=${soundOn} oscillators=${freshCut.osc}`);
  /* 把音效关回去，别影响后面的段落 */
  await evaluate(`(function(){ var b = document.querySelector('[data-sound-toggle]'); if (b && b.getAttribute('aria-pressed') === 'true') b.click(); })()`);
  await evaluate(`localStorage.removeItem('cv01-sound')`);

  await evaluate(`window.cv01.go('/sections/suiyu.html')`);
  await evaluate('new Promise(r => setTimeout(r, 1500))');
  const onSection = await tree();
  check('建完不刷新：板块页的子板块列表里也有它', /自检临时子板块/.test(onSection.subnav), onSection.subnav);

  await formDelete(`/api/sections/suiyu/subs/${tempMade.sub}`);
  await formDelete(`/api/sections/${tempMade.section}`);
  tempMade.section = '';
  tempMade.sub = '';
  await evaluate(`document.dispatchEvent(new CustomEvent('cv01:sections-changed'))`);
  await evaluate('new Promise(r => setTimeout(r, 1200))');
  const goneSub = await tree();
  check('删完立刻消失：子板块列表空了', goneSub.subnav === '', goneSub.subnav);

  await evaluate(`window.cv01.go('/index.html')`);
  await evaluate('new Promise(r => setTimeout(r, 1500))');
  const back2 = await tree();
  check('删完立刻消失：轨道栏 / 索引 / 卷帘都回到原样',
    back2.rail === before.rail && back2.entries === before.entries && back2.heads === before.heads && !back2.hasNew,
    `${back2.rail} / ${back2.entries} / ${back2.heads}`);
  check('板块树这一段控制台干净', consoleErrors.length === 0, consoleErrors.join(' | '));

  /* --- 7. 移动端宽度 --- */
  await send('Emulation.setDeviceMetricsOverride', { width: 420, height: 860, deviceScaleFactor: 2, mobile: true });
  await goto(SITE + '/sections/suiyu.html');
  await shot('mobile-section');

  /* 音乐盒在窄屏上最容易挤：曲目行带四个小按钮，量一下有没有横着溢出 */
  await evaluate(`localStorage.setItem('cv01-key', ${JSON.stringify(key)})`);
  await evaluate('document.querySelector(\'[data-ball="music"]\').click()');
  await evaluate('new Promise(r => setTimeout(r, 900))');
  const mobileMusic = await evaluate(`(function(){
    var mp = document.querySelector('.mp');
    if (!mp) return JSON.stringify({ open: false });
    var panel = document.querySelector('.studio__panel');
    var row = document.querySelector('.mp-item');
    var acts = document.querySelector('.mp-item__acts');
    return JSON.stringify({
      open: true,
      panelWidth: Math.round(panel.getBoundingClientRect().width),
      panelScrollsX: panel.scrollWidth > panel.clientWidth + 1,
      rowOverflow: row ? Math.round(row.scrollWidth - row.clientWidth) : -1,
      actsWidth: acts ? Math.round(acts.getBoundingClientRect().width) : -1,
      pinVisible: !!document.querySelector('[data-pin]'),
      docOverflow: document.documentElement.scrollWidth > window.innerWidth + 1
    });
  })()`);
  const mm = JSON.parse(mobileMusic);
  check('手机上音乐盒能打开', mm.open);
  check('手机上曲目行不横向溢出', mm.open && !mm.panelScrollsX && mm.rowOverflow <= 0,
    `panelScroll=${mm.panelScrollsX} row溢出=${mm.rowOverflow}px`);
  check('手机上「设默认」按钮还在', mm.pinVisible);
  await shot('mobile-music');

  /* --- 8. 回到浅色，清掉刚才设的键 --- */
  await send('Emulation.clearDeviceMetricsOverride');
  await evaluate('localStorage.clear()');
} catch (err) {
  problems.push(`自检脚本本身出错：${err.message}`);
} finally {
  /* 自检造的那个临时板块 / 子板块，不管上面走到哪一步都要清掉 */
  try {
    const headers = { 'x-cv01-key': passphrase() };
    if (tempMade.sub) await fetch(`${SITE}/api/sections/suiyu/subs/${tempMade.sub}`, { method: 'DELETE', headers });
    if (tempMade.section) await fetch(`${SITE}/api/sections/${tempMade.section}`, { method: 'DELETE', headers });
  } catch { /* 服务可能已经关了 */ }
  if (cdp) cdp.close();
  try { chrome.kill(); } catch { /* 已经退了 */ }
  await new Promise((r) => setTimeout(r, 400));
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* Windows 有时候还锁着 */ }
}

/* ------------------------------------------------------------------ 报告 */
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? '  ok  ' : '  XX  '} ${r.name}${r.detail ? '  — ' + r.detail : ''}`);
}
for (const p of problems) console.log(`  !!  ${p}`);
console.log('');
console.log(`  ${results.length - failed}/${results.length} 项通过，截图在 .check/`);
process.exit(failed ? 1 : 0);

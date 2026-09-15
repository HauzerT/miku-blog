/* ==========================================================================
   tools/check-kumura.mjs · 云村页的浏览器自检
   ---------------------------------------------------------------------------
   零依赖：自己用 Node 自带的 WebSocket 跟无头 Chrome 的 CDP 说话，
   不装 puppeteer（和 tools/dom-check.mjs 一个路数）。

   为什么分几种状态测：
     只测"扫码之后的样子"不现实——那要真人扫一次码。所以：
       1) 真实模式：小服务真的在跑 → 二维码真的被画出来、控制台干净
       2) 离线模式：把小服务指到一个死端口 → 它给的是人话，不是白屏
       3) 已登录模式：把 /api/* 的响应换掉 → 账号、红心歌单、播放器都验一遍
       4) 作废模式：把二维码有效期压到 3 秒 → 验证过期后会自动换新
     第 3、4 种靠注入脚本 + 替换 fetch 实现，不碰真账号，不写任何凭证。

   用法：
     node tools/check-kumura.mjs              # 用仓库目录 + 临时静态服务
     node tools/check-kumura.mjs <站点地址>    # 用已经跑起来的站点
     （真实模式需要小服务在 http://127.0.0.1:3170；没起就只跑后三种）
   ========================================================================== */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = join(ROOT, '.check');
const SIDECAR = 'http://127.0.0.1:3170';
const DEAD_PORT = 'http://127.0.0.1:3199';
const MOCK_HOST = 'http://mock.invalid';

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));

if (!CHROME) {
  console.error('没找到 Chrome 或 Edge，跳过浏览器自检');
  process.exit(0);
}

/* ------------------------------------------------------------ 注入脚本
   music.config.js 会把 window.CV01_MUSIC 整份覆盖掉，
   所以不能直接赋值——先用 setter 接住它那一次赋值，再改写其中几项。 */
function prelude(service, extra = '') {
  return `
Object.defineProperty(window, 'CV01_MUSIC', {
  configurable: true,
  set: function (v) {
    this.__music = Object.assign({}, v, { service: ${JSON.stringify(service)}${extra} });
  },
  get: function () { return this.__music; }
});
`;
}

/* ------------------------------------------------------------ 静态服务 */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ttf': 'font/ttf',
  '.json': 'application/json; charset=utf-8',
};

let siteUrl = process.argv[2] || '';
let staticServer = null;

if (!siteUrl) {
  staticServer = createServer((req, res) => {
    const raw = decodeURIComponent((req.url || '/').split('?')[0]);
    const rel = normalize(raw).replace(/^([/\\])+/, '');
    const file = join(ROOT, rel === '' ? 'index.html' : rel);
    if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('not found');
    }
    const body = readFileSync(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
    });
    res.end(body);
  });
  const port = 4500 + Math.floor(Math.random() * 300);
  await new Promise((r) => staticServer.listen(port, '127.0.0.1', r));
  siteUrl = `http://127.0.0.1:${port}`;
}

/* ------------------------------------------------------------------ CDP
   注意：Node 自带的 WebSocket 已经把帧解好了，e.data 就是完整的文本。
   不要再自己拆帧——把 JSON 的第一个字节当帧头读，opcode 会读成 11，
   然后就永远等不齐"长度"，命令全部超时。 */
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
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
    const text = typeof data === 'string' ? data : Buffer.from(data).toString('utf8');
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method) {
      this.listeners.forEach((fn) => fn(msg));
    }
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
          reject(new Error(method + ' timeout'));
        }
      }, 30000);
    });
  }

  close() { try { this.ws.close(); } catch { /* already closed */ } }
}

/* ------------------------------------------------------------------ 主流程 */

const PORT = 9333 + Math.floor(Math.random() * 200);
const profile = join(tmpdir(), 'cv01-kumura-' + randomBytes(4).toString('hex'));
mkdirSync(SHOTS, { recursive: true });
mkdirSync(profile, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', '--mute-audio', '--window-size=1280,1100',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, 'about:blank',
], { stdio: 'ignore' });

const results = [];
const problems = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) problems.push(name + (detail ? ' -- ' + detail : ''));
}

let cdp;
try {
  let browserWs = null;
  for (let i = 0; i < 100 && !browserWs; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/version');
      if (r.ok) browserWs = (await r.json()).webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    if (!browserWs) await new Promise((r) => setTimeout(r, 120));
  }
  if (!browserWs) throw new Error('Chrome did not start');
  cdp = await Cdp.connect(browserWs);

  const created = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const attached = await cdp.send('Target.attachToTarget', { targetId: created.targetId, flatten: true });
  const sessionId = attached.sessionId;
  if (!sessionId) throw new Error('attachToTarget gave no sessionId');
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
      const where = d.url || '';
      if (!/kumura|qr\.js|music\.config/.test(where)) return;
      consoleErrors.push(d.exception?.description || d.text || 'uncaught exception');
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      /* 只认云村页自己的错：站点上还有别的东西会去请求 /api/music 之类，
         那些 404 不是这一页的问题。 */
      const url = msg.params.entry.url || '';
      if (!/kumura|qr\.js|music\.config/.test(url)) return;
      consoleErrors.push(msg.params.entry.text + ' ' + url);
    }
  });

  async function evaluate(expression) {
    const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || 'evaluate failed');
    return res.result.value;
  }

  async function goto(path, { preScript = null, settle = 1400 } = {}) {
    consoleErrors = [];
    let injected = null;
    if (preScript) {
      const res = await send('Page.addScriptToEvaluateOnNewDocument', { source: preScript });
      injected = res.identifier;
    }
    const loaded = new Promise((resolve) => {
      const fn = (msg) => {
        if (msg.method === 'Page.loadEventFired') {
          cdp.listeners = cdp.listeners.filter((x) => x !== fn);
          resolve();
        }
      };
      cdp.listeners.push(fn);
    });
    await send('Page.navigate', { url: siteUrl + path });
    await loaded;
    await evaluate('new Promise(r => setTimeout(r, ' + settle + '))');
    if (injected) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injected });
  }

  async function shot(name) {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(SHOTS, name + '.png'), Buffer.from(data, 'base64'));
  }

  /* ------------------------------------------------ 1. 真实模式（服务在线） */
  const sidecarUp = await fetch(SIDECAR + '/api/health').then(() => true).catch(() => false);
  if (!sidecarUp) {
    console.log('  !!  小服务没在跑（' + SIDECAR + '），跳过"真实模式"这一组');
  } else {
    await goto('/kumura.html');
    const live = JSON.parse(await evaluate(`JSON.stringify({
      title: document.title,
      navCurrent: (document.querySelector('.bar__nav a[aria-current="page"]')||{}).textContent || '',
      state: document.querySelector('[data-music]').getAttribute('data-music-state'),
      svgs: document.querySelectorAll('.km-login__code svg').length,
      status: (document.querySelector('[data-qr-status]')||{}).textContent || '',
      timer: (document.querySelector('[data-qr-timer]')||{}).textContent || '',
      visiblePanes: Array.from(document.querySelectorAll('[data-pane]'))
        .filter(n => getComputedStyle(n).display !== 'none')
        .map(n => n.getAttribute('data-pane'))
    })`));
    check('云村页打开', live.title.includes('云村'), live.title);
    check('导航标出了当前页', live.navCurrent.trim() === '云村', live.navCurrent);
    check('未登录时进入扫码状态', live.state === 'login', 'state=' + live.state);
    check('二维码被真的画出来了', live.svgs === 1, 'svg=' + live.svgs);
    check('给了扫码提示', /扫一扫|App/.test(live.status), live.status);
    check('带过期倒计时', /秒后过期/.test(live.timer), live.timer);
    check('真实模式控制台干净', consoleErrors.length === 0, consoleErrors.join(' | '));
    check('同一时刻只显示一段', live.visiblePanes.length === 1 && live.visiblePanes[0] === 'login',
      '可见=' + live.visiblePanes.join(','));
    await shot('kumura-login');
  }

  /* --------------------------------------------- 2. 离线模式（服务不在） */
  await goto('/kumura.html', { preScript: prelude(DEAD_PORT) });
  const offlineStart = Date.now();
  let offlineState = 'loading';
  for (let i = 0; i < 30 && offlineState === 'loading'; i++) {
    await evaluate('new Promise(r => setTimeout(r, 500))');
    offlineState = await evaluate(`document.querySelector('[data-music]').getAttribute('data-music-state')`);
  }
  const offlineMs = Date.now() - offlineStart;
  const offline = JSON.parse(await evaluate(`JSON.stringify({
    state: document.querySelector('[data-music]').getAttribute('data-music-state'),
    text: (document.querySelector('[data-pane="offline"]')||{}).textContent || ''
  })`));
  check('服务没在跑时进入离线状态', offline.state === 'offline', 'state=' + offline.state);
  check('离线判定不拖泥带水', offlineMs < 9000, (offlineMs / 1000).toFixed(1) + 's');
  check('离线提示里给出了启动命令', /ncm-server\.mjs/.test(offline.text), offline.text.slice(0, 60));

  /* ------------------------------------- 3. 二维码作废后自动换新（会翻车的那条） */
  await goto('/kumura.html', {
    preScript: prelude(SIDECAR, ', qrTtl: 3'),
    settle: 1200,
  });
  const beforeExpire = await evaluate(`document.querySelector('[data-music]').getAttribute('data-music-state')`);
  /* 等它作废（3s）+ 自动换新（1s）+ 重新取 key */
  await evaluate('new Promise(r => setTimeout(r, 7000))');
  const afterExpire = JSON.parse(await evaluate(`JSON.stringify({
    state: document.querySelector('[data-music]').getAttribute('data-music-state'),
    svgs: document.querySelectorAll('.km-login__code svg').length,
    timer: (document.querySelector('[data-qr-timer]')||{}).textContent || ''
  })`));
  check('作废后不卡死', beforeExpire === 'login' || beforeExpire === 'login-expired', 'state=' + beforeExpire);
  check('作废后能自动换回新二维码', afterExpire.state === 'login' && afterExpire.svgs === 1,
    'state=' + afterExpire.state + ' svg=' + afterExpire.svgs);
  check('换新后重新开始倒计时', /秒后过期/.test(afterExpire.timer), afterExpire.timer);

  /* ------------------------------ 4. 已登录模式（替换 /api/* 的响应） */
  const PROFILE = {
    uid: 12345678, nickname: '云村测试帐号', avatar: '', background: '',
    signature: '把想法写成句子，句子自己会去找它的邻居。',
    follows: 51, followers: 128, playlists: 7, level: 9, listenSongs: 12345,
    vipType: 11, vip: { type: 11, label: '黑胶 VIP' }, createDays: 2600,
  };
  const mock = {
    '/api/health': { ok: true, loggedIn: true, profile: PROFILE },
    '/api/account': {
      ok: true, loggedIn: true, profile: PROFILE,
      liked: { id: 999, name: '我喜欢的音乐', trackCount: 3, cover: '', updateTime: 1757692800000 },
    },
    '/api/liked': {
      ok: true, total: 3, offset: 0, limit: 50, hasMore: false,
      songs: [
        { id: 1, name: '夜に駆ける', artist: 'YOASOBI', artists: ['YOASOBI'], album: 'THE BOOK', cover: '', duration: 261000, url: 'https://music.163.com/song?id=1' },
        { id: 2, name: '千本桜', artist: '初音ミク', artists: ['初音ミク'], album: '千本桜', cover: '', duration: 244000, mvId: 12345, url: 'https://music.163.com/song?id=2' },
        { id: 3, name: '（已下架或不可用）', missing: true, id: 3, url: 'https://music.163.com/song?id=3' },
      ],
    },
    /* 播放地址给一条连不上的直链：测的是"服务返回的地址有没有被挂上去"，
       而不是"某个公网 CDN 此刻通不通"。 */
    '/api/song/url': { ok: true, id: 1, url: 'http://127.0.0.1:3199/mock.mp3', level: 'exhigh', br: 320000, type: 'mp3', fee: 0, trial: false },
  };

  const stub = prelude(MOCK_HOST) + `
(function () {
  var MOCK = ${JSON.stringify(mock)};
  var real = window.fetch;
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf(${JSON.stringify(MOCK_HOST)}) !== 0) return real(input, init);
    var path = url.slice(${JSON.stringify(MOCK_HOST)}.length).split('?')[0];
    var body = MOCK[path];
    var status = body ? 200 : 404;
    if (path === '/api/song/url') {
      var sid = (url.match(/[?&]id=(\\d+)/) || [])[1];
      body = sid === '2'
        ? { ok: true, id: 2, ok: false, url: null, reason: 'UNPLAYABLE', message: '这首歌拿不到播放地址（测试用）。' }
        : MOCK[path];
    }
    if (!body) body = { ok: false, error: 'NOT_MOCKED' };
    return Promise.resolve(new Response(JSON.stringify(body), {
      status: status, headers: { 'Content-Type': 'application/json' }
    }));
  };
})();
`;

  await goto('/kumura.html', { preScript: stub, settle: 2000 });
  const ready = JSON.parse(await evaluate(`JSON.stringify({
    state: document.querySelector('[data-music]').getAttribute('data-music-state'),
    nickname: (document.querySelector('[data-nickname]')||{}).textContent || '',
    uid: (document.querySelector('[data-uid]')||{}).textContent || '',
    vip: (document.querySelector('[data-vip]')||{}).textContent || '',
    vipShown: !(document.querySelector('[data-vip]')||{}).hidden,
    signature: (document.querySelector('[data-signature]')||{}).textContent || '',
    facts: Array.from(document.querySelectorAll('.km-facts__row')).map(r => r.textContent),
    likedName: (document.querySelector('.km-liked__name')||{}).textContent || '',
    likedCount: (document.querySelector('.km-liked__count')||{}).textContent || '',
    tracks: Array.from(document.querySelectorAll('.km-track')).map(t => ({
      no: (t.querySelector('.km-track__no')||{}).textContent,
      name: (t.querySelector('.km-track__name')||{}).textContent,
      artist: (t.querySelector('.km-track__artist')||{}).textContent,
      time: (t.querySelector('.km-track__time')||{}).textContent,
      href: (t.querySelector('.km-track__link')||{}).href,
      mv: Boolean(t.querySelector('.km-track__mv'))
    })),
    moreHidden: (document.querySelector('[data-more]')||{}).hidden,
    visiblePanes: Array.from(document.querySelectorAll('[data-pane]'))
      .filter(n => getComputedStyle(n).display !== 'none').map(n => n.getAttribute('data-pane'))
  })`));

  check('登录态进入 ready', ready.state === 'ready', 'state=' + ready.state);
  check('显示昵称', ready.nickname === '云村测试帐号', ready.nickname);
  check('显示 UID', /12345678/.test(ready.uid), ready.uid);
  check('显示 VIP 标记', ready.vipShown && ready.vip === '黑胶 VIP', ready.vip);
  check('显示签名', ready.signature.length > 4, ready.signature);
  check('数据条有值', ready.facts.length >= 5, JSON.stringify(ready.facts));
  check('数据条含等级与听歌数',
    ready.facts.some((f) => /Lv\.9/.test(f)) && ready.facts.some((f) => /万|12345/.test(f)),
    JSON.stringify(ready.facts));
  check('红心歌单有名字与数量',
    ready.likedName === '我喜欢的音乐' && /3/.test(ready.likedCount),
    ready.likedName + ' / ' + ready.likedCount);
  check('渲染出 3 首红心歌', ready.tracks.length === 3, 'tracks=' + ready.tracks.length);
  check('第一首曲名正确', ready.tracks[0] && ready.tracks[0].name === '夜に駆ける',
    ready.tracks[0] && ready.tracks[0].name);
  check('第一首时长格式正确', ready.tracks[0] && ready.tracks[0].time === '4:21',
    ready.tracks[0] && ready.tracks[0].time);
  check('MV 有标记', ready.tracks[1] && ready.tracks[1].mv === true);
  check('下架歌曲有说法',
    ready.tracks[2] && /下架|不可用/.test(ready.tracks[2].name + ready.tracks[2].artist),
    ready.tracks[2] && ready.tracks[2].name);
  check('每行都有网易云外链',
    ready.tracks.every((t) => /music\.163\.com\/song\?id=/.test(t.href || '')));
  check('到底时不再显示"再多读"', ready.moreHidden === true);
  check('ready 时只剩 profile/liked 两段可见',
    ready.visiblePanes.length === 2 && ready.visiblePanes.every((p) => p === 'ready'),
    ready.visiblePanes.join(','));
  check('已登录模式控制台干净', consoleErrors.length === 0, consoleErrors.join(' | '));
  await shot('kumura-ready');

  /* ------------------------------------------------ 5. 播放（页面内直接播） */
  const playUi = JSON.parse(await evaluate(`JSON.stringify({
    playBtns: document.querySelectorAll('[data-km-play]').length,
    noplay: document.querySelectorAll('.km-track__noplay').length,
    playerHidden: document.querySelector('[data-player]').hidden
  })`));
  check('可播的歌都有播放键', playUi.playBtns === 2, 'play=' + playUi.playBtns);
  check('下架的歌不给播放键', playUi.noplay === 1, 'noplay=' + playUi.noplay);
  check('播放条初始收起', playUi.playerHidden === true);

  await evaluate(`document.querySelector('[data-km-play]').click()`);
  await evaluate('new Promise(r => setTimeout(r, 1500))');
  const playing = JSON.parse(await evaluate(`JSON.stringify({
    playerHidden: document.querySelector('[data-player]').hidden,
    name: (document.querySelector('[data-player-name]')||{}).textContent || '',
    sub: (document.querySelector('[data-player-sub]')||{}).textContent || '',
    audioSrc: (document.querySelector('[data-km-audio]')||{}).src || '',
    highlighted: !!document.querySelector('.km-track.is-playing'),
    bodyPadded: getComputedStyle(document.body).paddingBottom
  })`));
  check('点歌后播放条升起', playing.playerHidden === false);
  /* 曲名是稳定的；艺人那句会被"地址播不了"的兜底说明覆盖
     （桩里的地址故意连不上），所以分开断言。 */
  check('播放条显示正确的曲名', playing.name === '夜に駆ける', playing.name);
  /* 最后一句话必须是"有信息量的那一种"。桩里的地址故意连不上，
     而且无头浏览器还会拦自动播放，所以这里接受两种真实结局之一：
     地址播不了 / 需要用户点一下。只要不是停在"正在取播放地址…"就算通过。 */
  check('播放条给出的是有信息量的状态',
    !/正在取播放地址/.test(playing.sub), playing.sub);
  check('把小服务返回的地址挂到了播放器的 audio 上',
    /mock\.mp3$/.test(playing.audioSrc), playing.audioSrc || '(空)');
  check('正在播的那一行被高亮', playing.highlighted === true);
  check('播放时页面让出底部空间', parseFloat(playing.bodyPadded) > 10, playing.bodyPadded);
  await shot('kumura-playing');

  /* 不可播的那一首：要给说法，而不是无声无息 */
  await evaluate(`document.querySelectorAll('[data-km-play]')[1].click()`);
  await evaluate('new Promise(r => setTimeout(r, 1200))');
  const unplayable = await evaluate(`(document.querySelector('[data-player-sub]')||{}).textContent || ''`);
  check('不可播的歌给出说明', /拿不到播放地址|不可播/.test(unplayable), unplayable);

  /* 收起播放条 */
  await evaluate(`document.querySelector('[data-player-close]').click()`);
  await evaluate('new Promise(r => setTimeout(r, 400))');
  const closed = JSON.parse(await evaluate(`JSON.stringify({
    hidden: document.querySelector('[data-player]').hidden,
    padded: getComputedStyle(document.body).paddingBottom
  })`));
  check('能收起播放条并还原底部空间',
    closed.hidden === true && parseFloat(closed.padded) < 10, JSON.stringify(closed));

  /* --------------------------------- 6. 夜间调声（暗窗是另配的一套配色） */
  await evaluate(`document.documentElement.setAttribute('data-theme','dark')`);
  await evaluate('new Promise(r => setTimeout(r, 400))');
  const darkBg = await evaluate('getComputedStyle(document.body).backgroundColor');
  check('夜间调声下仍能渲染', Boolean(darkBg), darkBg);
  await shot('kumura-dark');
} catch (err) {
  problems.push('自检脚本本身出错：' + err.message);
} finally {
  if (cdp) cdp.close();
  try { chrome.kill(); } catch { /* already gone */ }
  if (staticServer) try { staticServer.close(); } catch { /* already closed */ }
  await new Promise((r) => setTimeout(r, 400));
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* Windows may still lock it */ }
}

/* ------------------------------------------------------------------ 报告 */
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log((r.ok ? '  ok  ' : '  XX  ') + ' ' + r.name + (r.detail ? '  -- ' + r.detail : ''));
}
console.log('');
console.log('  ' + (results.length - failed) + '/' + results.length + ' 项通过，截图在 .check/');
process.exit(failed ? 1 : 0);

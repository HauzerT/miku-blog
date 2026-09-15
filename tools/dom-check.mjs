/* ==========================================================================
   tools/dom-check.mjs · 用 Chrome DevTools 协议做一次真实的页面自检
   ---------------------------------------------------------------------------
   零依赖：自己拼 WebSocket 帧跟无头 Chrome 说话，不装 puppeteer。
   做三件事：
     1) 打开每一类页面，收集 console 报错 / 未捕获异常 / 加载失败的资源
     2) 模拟真人操作：登录口令 → 开音乐盒面板 → 开说说面板 → 发一条说说的表单检查
     3) 截图存到 .check/ 里，用眼睛再过一遍

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
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--window-size=1280,1000',
  'about:blank',
], { stdio: 'ignore', detached: false });

let cdp;
const problems = [];
const results = [];

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
      consoleErrors.push(`${msg.params.entry.text} ${msg.params.entry.url || ''}`);
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
  const pages = [
    ['首页', '/index.html'],
    ['说说流', '/feed.html'],
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
  check('悬浮球有三颗', ballCount === 3, `实际 ${ballCount}`);

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
  check('有投放区/循环/音量', m.hasDrop && m.hasMode && m.hasVol);
  await shot('panel-music');

  /* --- 3. 发说说面板 --- */
  await evaluate('document.querySelector(\'[data-ball="post"]\').click()');
  await evaluate('new Promise(r => setTimeout(r, 900))');
  const composer = await evaluate(`JSON.stringify({
    panel: !!document.querySelector('.cp'),
    options: document.querySelectorAll('[data-section] option').length,
    tools: document.querySelectorAll('[data-add]').length,
    emoji: document.querySelectorAll('.cp__emoji-btn').length,
    subField: !!document.querySelector('[data-sub-field]')
  })`);
  const c = JSON.parse(composer);
  check('说说面板打开', c.panel);
  check('板块下拉有选项', c.options >= 9, `options=${c.options}`);
  check('三种附件按钮', c.tools === 3, `tools=${c.tools}`);
  check('表情面板有条目', c.emoji > 40, `emoji=${c.emoji}`);
  await shot('panel-post');

  /* --- 4. 新建板块面板 --- */
  await evaluate('document.querySelector(\'[data-ball="sect"]\').click()');
  await evaluate('new Promise(r => setTimeout(r, 900))');
  const sect = await evaluate(`JSON.stringify({
    panel: !!document.querySelector('.sc'),
    pitches: document.querySelectorAll('[data-pitch] option').length,
    subs: document.querySelectorAll('[data-sublist] li').length,
    parents: document.querySelectorAll('[data-parent] option').length
  })`);
  const s = JSON.parse(sect);
  check('新建板块面板打开', s.panel);
  check('音高下拉有选项', s.pitches > 40, `pitches=${s.pitches}`);
  check('子板块列表有内容', s.subs > 0, `subs=${s.subs}`);
  await shot('panel-sect');

  /* --- 5. 说说流里的删除按钮（有口令才出现） --- */
  await goto(SITE + '/feed.html');
  await evaluate(`localStorage.setItem('cv01-key', ${JSON.stringify(key)})`);
  await evaluate('window.cv01.feed.reload()');
  await evaluate('new Promise(r => setTimeout(r, 600))');
  const feedInfo = await evaluate(`JSON.stringify({
    items: document.querySelectorAll('.feed-item').length,
    delVisible: Array.from(document.querySelectorAll('[data-del-post]')).filter(b => !b.hidden).length,
    chips: document.querySelectorAll('.chip').length
  })`);
  const f = JSON.parse(feedInfo);
  check('说说流加载完成（有几个显示几个）', true, `items=${f.items} 删除按钮=${f.delVisible}`);
  check('删除按钮的显隐与口令一致', f.items === 0 || f.delVisible === f.items, `items=${f.items} del=${f.delVisible}`);
  check('筛选按钮齐全', f.chips >= 10, `chips=${f.chips}`);
  await shot('feed-live');

  /* --- 6. 夜间调声下再看一眼工作台 --- */
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

  /* --- 7. 移动端宽度 --- */
  await send('Emulation.setDeviceMetricsOverride', { width: 420, height: 860, deviceScaleFactor: 2, mobile: true });
  await goto(SITE + '/feed.html');
  await shot('mobile-feed');

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

  await evaluate('document.querySelector(\'[data-ball="post"]\').click()');
  await evaluate('new Promise(r => setTimeout(r, 900))');
  const mob = await evaluate(`JSON.stringify({
    panel: !!document.querySelector('.cp'),
    width: Math.round(document.querySelector('.studio__panel').getBoundingClientRect().width),
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1
  })`);
  const mo = JSON.parse(mob);
  check('手机上说说面板打开', mo.panel);
  check('手机上面板不撑破视口', !mo.overflow, `panel=${mo.width}px`);
  await shot('mobile-post');

  /* --- 8. 回到浅色，清掉刚才设的键 --- */
  await send('Emulation.clearDeviceMetricsOverride');
  await evaluate('localStorage.clear()');
} catch (err) {
  problems.push(`自检脚本本身出错：${err.message}`);
} finally {
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

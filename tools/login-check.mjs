/* ==========================================================================
   tools/login-check.mjs · 门厅（login.html）的浏览器自检
   ---------------------------------------------------------------------------
   零依赖：自己拼 WebSocket 帧跟无头 Chrome 说话，和 dom-check.mjs 一样。
   走一遍真人会走的路，量的是「门是不是真的开」：

     1) 打开门厅：无控制台报错、口令那一行初始收着
     2) 量颜色：青地来自 --miku、访客键来自 --cuer、站长键来自 --key-black
        （不是写死在 CSS 里的色值——写死的会在 tokens.mjs 那关就挂掉，
          这里再确认一次浏览器里真的是那三个 token）
     3) 空口令 / 错口令：出现黑板提示，人还留在门厅，钥匙没被记下
     4) 对话正确口令：进到首页，localStorage['cv01-key'] 就是那串口令
     5) 回来：状态行出现；点「忘掉口令」再消失
     6) 访客键：直接进首页，且不写任何钥匙
     7) #owner：地址栏写了就直接停在口令那一行
     8) 360×640 上截图看一眼（门厅是首屏页面，手机上的样子就是它的样子）

   用法（服务要先跑起来）：
     node server/server.mjs 4321
     node tools/login-check.mjs            # 默认 http://127.0.0.1:4321
   ========================================================================== */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = process.argv[2] || 'http://127.0.0.1:4321';
const PORT = 9533 + Math.floor(Math.random() * 200);
const SHOTS = join(ROOT, '.check');

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));

if (!CHROME) {
  console.error('没找到 Chrome 或 Edge，跳过门厅自检');
  process.exit(0);
}

/* ------------------------------------------------------------------ 口令 */
function passphrase() {
  const file = join(ROOT, 'data', 'settings.json');
  if (!existsSync(file)) return '';
  try { return JSON.parse(readFileSync(file, 'utf8')).passphrase || ''; } catch { return ''; }
}

if (!existsSync(join(ROOT, 'login.html'))) {
  console.error('找不到 login.html');
  process.exit(1);
}

try {
  const health = await fetch(`${SITE}/api/health`);
  if (!health.ok) throw new Error(String(health.status));
} catch {
  console.error(`上传服务没在 ${SITE} 上跑。先另开一个窗口：node server/server.mjs 4321`);
  process.exit(1);
}

const key = passphrase();
if (!key) {
  console.error('data/settings.json 里还没有口令。先跑一次 node server/server.mjs，它会生成一串。');
  process.exit(1);
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
      if (typeof data === 'string') return this.dispatch(data);
      const buf = Buffer.from(data);
      if (buf.length && buf[0] === 0x7b) return this.dispatch(buf.toString('utf8'));

      this.buf = Buffer.concat([this.buf, buf]);
      for (;;) {
        const frame = this.readFrame();
        if (!frame) break;
        if (frame.opcode === 0x8) return;
        if (frame.opcode === 0x9) continue;
        if (frame.opcode !== 0x1 && frame.opcode !== 0x0) continue;
        if (frame.opcode === 0x1) this.fragments = [frame.payload];
        else if (this.fragments) this.fragments.push(frame.payload);
        if (!frame.fin) continue;
        const payload = this.fragments && this.fragments.length > 1
          ? Buffer.concat(this.fragments)
          : frame.payload;
        this.fragments = null;
        this.dispatch(payload.toString('utf8'));
      }
    } catch (err) {
      console.log('[cdp] 解析入站消息出错：', err.message);
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
const profile = join(tmpdir(), `cv01-login-${randomBytes(4).toString('hex')}`);
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
  '--window-size=1280,900',
  'about:blank',
], { stdio: 'ignore', detached: false });

let cdp;
const results = [];
const problems = [];

try {
  const browserWs = await waitForChrome();
  cdp = await Cdp.connect(browserWs);

  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => cdp.send(method, params, sessionId);

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');

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
      if (!/favicon/.test(text)) consoleErrors.push(`${text} ${msg.params.entry.url || ''}`);
    }
  });

  async function evaluate(expression) {
    const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
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
    await evaluate('new Promise(r => setTimeout(r, 500))');
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

  const url = (path) => `${SITE}/${path}`;

  /* 页面自己在跳转（location.href = …）的那一瞬间，执行上下文会被销毁，
     这一刻的 Runtime.evaluate 会抛「navigated or closed」——不是错，是还没落稳。 */
  async function waitPath(re) {
    for (let i = 0; i < 50; i++) {
      try {
        const path = await evaluate('location.pathname');
        if (re.test(path)) return path;
      } catch { /* 正在跳转 */ }
      await new Promise((r) => setTimeout(r, 150));
    }
    try { return await evaluate('location.pathname'); } catch { return ''; }
  }

  /* 门厅里的样子：一次量齐，后面几步复用 */
  const SHAPE = `(function () {
    var probe = function (name) {
      var d = document.createElement('div');
      d.style.background = 'var(' + name + ')';
      document.body.appendChild(d);
      var value = getComputedStyle(d).backgroundColor;
      d.remove();
      return value;
    };
    var visitor = document.querySelector('.gate-key--visitor');
    var owner = document.querySelector('.gate-key--owner');
    var pass = document.querySelector('[data-pass]');
    var status = document.querySelector('[data-status]');
    return JSON.stringify({
      title: document.title,
      ground: getComputedStyle(document.body).backgroundColor,
      miku: probe('--miku'),
      curtain: probe('--display'),
      visitorBg: getComputedStyle(visitor).backgroundColor,
      visitorInk: getComputedStyle(visitor).color,
      cuer: probe('--cuer'),
      ownerBg: getComputedStyle(owner).backgroundColor,
      ownerInk: getComputedStyle(owner).color,
      keyBlack: probe('--key-black'),
      onDisplay: probe('--on-display'),
      ownerLabel: owner.textContent.trim(),
      ownerExpanded: owner.getAttribute('aria-expanded'),
      passHidden: pass.hidden,
      statusHidden: status ? status.hidden : true,
      key: (function () { try { return localStorage.getItem('cv01-key') || ''; } catch (e) { return ''; } })(),
      path: location.pathname,
      clue: (document.querySelector('.gate__msg') || {}).textContent || ''
    });
  })()`;

  const shape = async () => JSON.parse(await evaluate(SHAPE));

  /* --- 1. 打开门厅 --- */
  await goto(url('login.html'));
  let s = await shape();
  check('门厅能打开且没有报错', consoleErrors.length === 0 && /进门/.test(s.title),
    consoleErrors.join(' | ') || s.title);
  check('口令那一行初始收着', s.passHidden === true && s.ownerExpanded === 'false');
  check('两颗键的措辞', s.ownerLabel === '站长登录', s.ownerLabel);
  await shot('login-default');

  /* --- 2. 量颜色：青地 / 粉键 / 黑键都是 token 给出来的 --- */
  check('地是青（--miku）', s.ground === s.miku, `${s.ground} vs ${s.miku}`);
  check('字是墨（--display）', s.visitorInk === s.curtain, `${s.visitorInk} vs ${s.curtain}`);
  check('访客键是粉（--cuer）', s.visitorBg === s.cuer, `${s.visitorBg} vs ${s.cuer}`);
  check('站长键是黑（--key-black）', s.ownerBg === s.keyBlack, `${s.ownerBg} vs ${s.keyBlack}`);
  check('站长键上的字是浅色（--on-display）', s.ownerInk === s.onDisplay, `${s.ownerInk} vs ${s.onDisplay}`);

  /* --- 3. 空口令 --- */
  await evaluate('document.querySelector(\'[data-owner]\').click()');
  await evaluate('new Promise(r => setTimeout(r, 260))');
  s = await shape();
  check('按下站长登录，口令行展开', s.passHidden === false && s.ownerExpanded === 'true');
  check('焦点落在口令输入框里', await evaluate('document.activeElement === document.querySelector(\'[data-pass-input]\')'));
  await shot('login-owner');

  await evaluate('document.querySelector(\'[data-pass]\').requestSubmit()');
  await evaluate('new Promise(r => setTimeout(r, 200))');
  s = await shape();
  check('空口令：黑板说「先填口令」', /先填口令/.test(s.clue), s.clue);
  check('空口令：人还在门厅', /login\.html$/.test(s.path), s.path);

  /* --- 4. 错口令 --- */
  await evaluate(`(function () {
    var input = document.querySelector('[data-pass-input]');
    input.value = 'not-the-passphrase';
    document.querySelector('[data-pass]').requestSubmit();
  })()`);
  await evaluate('new Promise(r => setTimeout(r, 900))');
  s = await shape();
  check('错口令：黑板说「口令不对」', /口令不对/.test(s.clue), s.clue);
  check('错口令：人还留在门厅', /login\.html$/.test(s.path), s.path);
  check('错口令：钥匙没被记下', s.key === '', s.key ? '记下了' : '干净');
  await shot('login-wrong');

  /* --- 5. 对话 --- */
  await evaluate(`(function () {
    var input = document.querySelector('[data-pass-input]');
    input.value = ${JSON.stringify(key)};
    document.querySelector('[data-pass]').requestSubmit();
  })()`);
  const landed = await waitPath(/index\.html$/);
  const after = await evaluate(`JSON.stringify({
    path: location.pathname,
    key: (function () { try { return localStorage.getItem('cv01-key') || ''; } catch (e) { return ''; } })()
  })`);
  const ok = JSON.parse(after);
  check('对话：进到了首页', /index\.html$/.test(ok.path), ok.path || landed);
  check('对话：钥匙记在 cv01-key 里（站长工具箱不用再问）', ok.key === key, ok.key ? '已记下' : '没记下');
  await shot('login-home');

  /* --- 6. 回来：状态行 + 忘掉口令 --- */
  await goto(url('login.html'));
  s = await shape();
  check('回来时状态行说「记着口令」', s.statusHidden === false);
  await evaluate('document.querySelector(\'[data-forget]\').click()');
  await evaluate('new Promise(r => setTimeout(r, 200))');
  s = await shape();
  check('忘掉口令：状态行收起，钥匙清空', s.statusHidden === true && s.key === '', s.key ? '钥匙还在' : '已清');

  /* --- 7. 访客键：不写钥匙，直接进 --- */
  await evaluate('document.querySelector(\'.gate-key--visitor\').click()');
  await waitPath(/index\.html$/);
  const guest = JSON.parse(await evaluate(`JSON.stringify({
    path: location.pathname,
    key: (function () { try { return localStorage.getItem('cv01-key') || ''; } catch (e) { return ''; } })()
  })`));
  check('访客：直接进首页', /index\.html$/.test(guest.path), guest.path);
  check('访客：什么钥匙都不写', guest.key === '', guest.key ? '写进去了' : '干净');

  /* --- 8. #owner 直接停在口令那一行 --- */
  await goto(url('login.html#owner'));
  s = await shape();
  check('#owner：口令行直接展开', s.passHidden === false);

  /* --- 9. 手机上：两颗键并排，页脚那把尺不横向溢出 --- */
  await send('Emulation.setDeviceMetricsOverride', {
    width: 360, height: 640, deviceScaleFactor: 2, mobile: true,
  });
  await goto(url('login.html'));
  await evaluate('document.querySelector(\'[data-owner]\').click()');
  await evaluate('new Promise(r => setTimeout(r, 300))');
  const phone = JSON.parse(await evaluate(`(function () {
    var keys = document.querySelectorAll('.gate-key');
    var a = keys[0].getBoundingClientRect();
    var b = keys[1].getBoundingClientRect();
    return JSON.stringify({
      sideBySide: Math.abs(a.top - b.top) < 2 && b.left > a.left,
      overshoot: document.documentElement.scrollWidth - window.innerWidth,
      keysVisible: a.left >= 0 && b.right <= window.innerWidth + 1,
      footWraps: (function () {
        var foot = document.querySelector('.gate__foot');
        return foot.getBoundingClientRect().height;
      })()
    });
  })()`));
  check('360px：两颗键并排且都在屏内', phone.sideBySide && phone.keysVisible,
    `并排=${phone.sideBySide} 屏内=${phone.keysVisible}`);
  check('360px：不横向溢出', phone.overshoot <= 1, `溢出 ${phone.overshoot}px`);
  check('360px：没有控制台报错', consoleErrors.length === 0, consoleErrors.join(' | '));
  await shot('login-mobile');
  await send('Emulation.clearDeviceMetricsOverride');
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

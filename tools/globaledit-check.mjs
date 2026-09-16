/* ==========================================================================
   tools/globaledit-check.mjs · 全局编辑模式（顶栏按钮 / 点字即改 / 空位新建）自检
   ---------------------------------------------------------------------------
   零依赖：自己拼 WebSocket 帧跟无头 Chrome 说话，和 edit-check.mjs 同一套底子。
   量的是「不用右键」的那条路：按钮 → 模式 → 点字 → 工具条 → 服务里真的变了 →
   空简介 / 空导语能就地新建 → 换页模式还在。

     1) 访客（浏览器里没有口令）：顶栏按钮根本不出现
     2) 站长：按钮出现；一按进入编辑模式（html[data-editmode]、按钮反白、
        轨道栏的板块名描上虚线）
     3) 空板块（临时建的，def / lede 都空）：首页索引里那行简介摆着「＋ 新建简介」，
        点它就地开工，存进去的就是从零新建的一句话
     4) 同一个空板块的动态页：导语整段缺失——<p class="lede"> 都没有——
        编辑模式把它造出来，点「＋ 新建导语」写第一句；页头简介的
        「新建板块」占位也算空，同样能新建
     5) 板块页已有内容的简介：点一下直接改（全程没有右键）
     6) 文章页：标题内联改（大标题、标签页、服务里三处都变）；
        正文点一下直接改，存进覆盖层，源文件不动
     7) Esc：没有正在改的段落时，一次 Esc 退出模式，虚线全部摘掉
     8) 局部刷新换页：模式开着从首页点去板块页，新页面的位置重新描好
     9) 全程控制台没有报错

   用法（服务要先跑起来，而且要是改过之后的那份）：
     node server/server.mjs 4399
     node tools/globaledit-check.mjs                     # 默认 http://127.0.0.1:4399
     node tools/globaledit-check.mjs http://127.0.0.1:4321
   ========================================================================== */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = process.argv[2] || 'http://127.0.0.1:4399';
const PORT = 9733 + Math.floor(Math.random() * 200);
const SHOTS = join(ROOT, '.check');
const OVERRIDES = join(ROOT, 'data', 'overrides.json');

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));

if (!CHROME) {
  console.error('没找到 Chrome 或 Edge，跳过全局编辑模式自检');
  process.exit(0);
}

const key = (() => {
  try { return JSON.parse(readFileSync(join(ROOT, 'data', 'settings.json'), 'utf8')).passphrase || ''; } catch { return ''; }
})();
if (!key) {
  console.error('data/settings.json 里还没有口令。先跑一次 node server/server.mjs。');
  process.exit(1);
}

const api = async (path, method = 'GET', body) => {
  const res = await fetch(SITE + path, {
    method,
    headers: { 'x-cv01-key': key, 'content-type': 'application/json', cookie: 'cv01-enter=1' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
};

/* 覆盖层在自检前后的条数要一样：量出来的改动都得自己收干净 */
const overridesCount = () => {
  try {
    const o = JSON.parse(readFileSync(OVERRIDES, 'utf8'));
    return Object.keys(o.sections || {}).length + Object.keys(o.posts || {}).length;
  } catch { return 0; }
};
const overridesBefore = overridesCount();

try {
  const health = await fetch(SITE + '/api/health');
  if (!health.ok) throw new Error(String(health.status));
} catch {
  console.error(`上传服务没在 ${SITE} 上跑。先另开一个窗口：node server/server.mjs 4399`);
  process.exit(1);
}

/* ------------------------------------------------------------------ CDP（与 edit-check.mjs 同一套） */
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
        const payload = this.fragments && this.fragments.length > 1 ? Buffer.concat(this.fragments) : frame.payload;
        this.fragments = null;
        this.dispatch(payload.toString('utf8'));
      }
    } catch (err) {
      console.log('[cdp] 解析入站消息出错：', err.message);
    }
  }

  dispatch(text) {
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
const profile = join(tmpdir(), `cv01-gedit-${randomBytes(4).toString('hex')}`);
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
const restore = [];
const made = { section: '' };

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
      if (!/favicon/.test(text) && !/410/.test(text)) consoleErrors.push(`${text} ${msg.params.entry.url || ''}`);
    }
  });

  async function evaluate(expression) {
    const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || '求值失败');
    return res.result.value;
  }

  async function wait(ms) { await evaluate(`new Promise(r => setTimeout(r, ${ms}))`); }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    await wait(700);
  }

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

  async function shot(name) {
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(data, 'base64'));
  }

  function check(name, ok, detail = '') {
    results.push({ name, ok, detail });
    if (!ok) problems.push(`${name} ${detail}`);
  }

  /* 左键点一个选择器命中的元素（真点击：坐标落在元素中央） */
  async function clickAt(selector, nth = 0) {
    const box = JSON.parse(await evaluate(`(function () {
      var el = document.querySelectorAll(${JSON.stringify(selector)})[${nth}];
      if (!el) return 'null';
      var r = el.getBoundingClientRect();
      return JSON.stringify({ x: Math.round(r.left + Math.min(40, r.width / 2)), y: Math.round(r.top + r.height / 2) });
    })()`));
    if (!box) throw new Error(`点不到 ${selector}[${nth}]`);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', {
        type, x: box.x, y: box.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1,
      });
    }
    await wait(350);
  }

  /* 工具条上按文字找那颗按钮（保存 / 取消） */
  const clickBtn = (text) => evaluate(`Array.prototype.filter.call(document.querySelectorAll('.rte__btn'), function (b) { return b.textContent === ${JSON.stringify(text)}; })[0].click()`);

  /* 往正在编辑的那段里塞一段话并喊一声 input（和真人打字等价的最短路径） */
  const typeInto = (selector, html, nth = 0) => evaluate(`(function () {
    var el = document.querySelectorAll(${JSON.stringify(selector)})[${nth}];
    if (!el) throw new Error('typeInto 找不到 ' + ${JSON.stringify(selector)});
    el.innerHTML = ${JSON.stringify(html)};
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);

  const keyInPage = `localStorage.setItem('cv01-key', ${JSON.stringify(key)})`;
  const dropKeyInPage = `localStorage.removeItem('cv01-key')`;

  /* 整页加载之后模式是关的：进页面 → 按按钮 → 等模式就位 */
  async function enterMode() {
    await evaluate(`document.querySelector('[data-edit-toggle]').click()`);
    await wait(300);
    if ((await evaluate(`document.documentElement.getAttribute('data-editmode')`)) !== 'on') {
      throw new Error('编辑模式没进来');
    }
  }

  /* --- 准备：临时空板块（def / lede 都是空） --- */
  const form = new FormData();
  form.set('name', '自检空板块');
  const created = await fetch(`${SITE}/api/sections`, { method: 'POST', headers: { 'x-cv01-key': key }, body: form }).then((r) => r.json());
  made.section = created.section ? created.section.id : '';
  restore.push(async () => { if (made.section) await api(`/api/sections/${made.section}`, 'DELETE'); });
  check('临时空板块建出来了（def / lede 都是空）', Boolean(made.section) && created.section.def === '' && created.section.lede === '');
  const TMP = made.section;

  /* 原有内容的底账：量完要原样放回去 */
  const sectionsNow = (await api('/api/sections')).data.sections || [];
  const suiyuBefore = sectionsNow.find((s) => s.id === 'suiyu') || {};
  restore.push(async () => { await api('/api/sections/suiyu', 'PATCH', { def: suiyuBefore.def || '', lede: suiyuBefore.lede || '' }); });
  const cloudBefore = sectionsNow.find((s) => s.id === 'cloud') || {};
  restore.push(async () => { await api('/api/sections/cloud', 'PATCH', { lede: cloudBefore.lede || '' }); });

  /* --- 1. 访客：顶栏按钮根本不出现 --- */
  await goto(`${SITE}/index.html?enter=1`);
  await evaluate(dropKeyInPage);
  await goto(`${SITE}/index.html`);
  check('访客：顶栏按钮是 hidden 的', await evaluate(`document.querySelector('[data-edit-toggle]').hidden === true`));
  check('访客：页面没进编辑模式', await evaluate(`!document.documentElement.hasAttribute('data-editmode')`));

  /* --- 2. 站长：按钮出现，一按进入编辑模式 --- */
  await evaluate(keyInPage);
  await goto(`${SITE}/index.html`);
  check('站长：顶栏按钮出现了', await evaluate(`document.querySelector('[data-edit-toggle]').hidden === false`));
  await enterMode();
  check('一按就进入编辑模式', await evaluate(`document.documentElement.getAttribute('data-editmode') === 'on'`));
  check('按钮换成「退出编辑」并按下', await evaluate(`document.querySelector('[data-edit-toggle]').textContent === '退出编辑' && document.querySelector('[data-edit-toggle]').getAttribute('aria-pressed') === 'true'`));
  check('轨道栏的板块名描上了虚线', await evaluate(`document.querySelector('.rail a.key .key__name').hasAttribute('data-gm')`));
  check('首页索引的简介也在名单里', await evaluate(`document.querySelectorAll('.entry__blurb[data-gm]').length > 0`));
  const tmpEntryAt = Number(await evaluate(`(function () {
    var blurbs = Array.prototype.slice.call(document.querySelectorAll('.entry__blurb'));
    for (var i = 0; i < blurbs.length; i++) {
      var a = blurbs[i].closest('.entry').querySelector('.entry__name a');
      if (a && a.getAttribute('href').indexOf(${JSON.stringify(TMP)}) > -1) return String(i);
    }
    return '-1';
  })()`));
  check('空板块在首页索引里也有一行', tmpEntryAt !== '-1');
  check('空板块那行简介摆着「＋ 新建简介」',
    await evaluate(`(document.querySelectorAll('.entry__blurb')[${tmpEntryAt}] || {}).textContent.indexOf('＋ 新建简介') > -1`));
  await shot('gedit-index-on');

  /* --- 3. 空板块：点「＋ 新建简介」就地新建 --- */
  const blurbAt = `.entry__blurb`;
  await evaluate(`document.querySelectorAll('.entry__blurb')[${tmpEntryAt}].querySelector('.gm-chip').click()`);
  await wait(320);
  check('点「＋ 新建」：那一行当场变成可编辑的',
    await evaluate(`document.querySelectorAll('.entry__blurb')[${tmpEntryAt}].getAttribute('contenteditable') === 'true'`));
  check('工具条挂上来了', await evaluate(`!!document.querySelector('.rte')`));

  /* 什么都没打就 Esc：不算「放弃」，chip 要原地补回来，随时可以再来 */
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await wait(400);
  check('一次空新建取消之后：「＋ 新建」补了回来',
    await evaluate(`document.querySelectorAll('.entry__blurb')[${tmpEntryAt}].querySelector('.gm-chip') !== null`));

  /* 这回真的写 */
  await evaluate(`document.querySelectorAll('.entry__blurb')[${tmpEntryAt}].querySelector('.gm-chip').click()`);
  await wait(320);
  await typeInto(blurbAt, '从零新建的一句话简介', tmpEntryAt);
  await clickBtn('保存');
  await wait(900);
  const tmpDef = ((await api('/api/sections')).data.sections.find((s) => s.id === TMP) || {}).def;
  check('服务里存下了新建的简介', tmpDef === '从零新建的一句话简介', tmpDef);
  check('保存后退出编辑态、「＋ 新建」收走',
    await evaluate(`document.querySelectorAll('.entry__blurb')[${tmpEntryAt}].getAttribute('contenteditable') !== 'true' && document.querySelectorAll('.entry__blurb')[${tmpEntryAt}].querySelector('.gm-chip') === null`));

  /* --- 4. 另一个空板块的动态页：导语整段缺失也能新建；「新建板块」占位算空
     （上面那个临时板块的简介刚在首页新建过了，得用一支还没动过笔的） --- */
  const form2 = new FormData();
  form2.set('name', '自检空板块二号');
  const created2 = await fetch(`${SITE}/api/sections`, { method: 'POST', headers: { 'x-cv01-key': key }, body: form2 }).then((r) => r.json());
  const TMP2 = created2.section ? created2.section.id : '';
  restore.push(async () => { if (TMP2) await api(`/api/sections/${TMP2}`, 'DELETE'); });
  check('临时空板块二号建出来了（这一支留给动态页量）', Boolean(TMP2));

  await goto(`${SITE}/sections/${TMP2}.html`);
  check('动态页页头的简介是空（同步把「新建板块」占位收掉了）',
    ['新建板块', ''].indexOf((await evaluate(`document.querySelector('.sect-head__def').textContent.trim()`))) > -1);
  await enterMode();
  check('空简介摆着「＋ 新建简介」',
    await evaluate(`document.querySelector('.sect-head__def .gm-chip') !== null && document.querySelector('.sect-head__def .gm-chip').textContent.indexOf('新建简介') > -1`));
  check('导语整段缺失：<p class="lede"> 被编辑模式造了出来，也摆着「＋ 新建导语」',
    await evaluate(`(function () {
      var lede = document.querySelector('main .lede');
      return Boolean(lede) && lede.hasAttribute('data-gm-ghost') && lede.querySelector('.gm-chip') !== null &&
             lede.querySelector('.gm-chip').textContent.indexOf('新建导语') > -1;
    })()`));
  await shot('gedit-empty-section');

  await clickAt('.sect-head__def');
  await wait(320);
  check('点占位框：直接开工（没有右键什么事）',
    await evaluate(`document.querySelector('.sect-head__def').getAttribute('contenteditable') === 'true'`));
  await typeInto('.sect-head__def', '新建的第一句定义');
  await clickBtn('保存');
  await wait(900);
  check('服务里存下了新建的定义',
    ((await api('/api/sections')).data.sections.find((s) => s.id === TMP2) || {}).def === '新建的第一句定义');

  await clickAt('main .lede');
  await wait(320);
  await typeInto('main .lede', '新建板块的导语也可以从零写。');
  await clickBtn('保存');
  await wait(900);
  check('服务里存下了新建的导语',
    ((await api('/api/sections')).data.sections.find((s) => s.id === TMP2) || {}).lede === '新建板块的导语也可以从零写。');
  await shot('gedit-empty-saved');

  /* --- 5. 板块页已有内容的简介：点一下直接改 --- */
  await goto(`${SITE}/sections/suiyu.html`);
  const defNow = await evaluate(`document.querySelector('.sect-head__def').textContent.trim()`);
  check('板块页简介原文在', defNow.length > 0, defNow);
  await enterMode();
  await clickAt('.sect-head__def');
  await wait(320);
  check('点一下简介：可编辑 + 工具条（全程没有右键）',
    await evaluate(`document.querySelector('.sect-head__def').getAttribute('contenteditable') === 'true' && !!document.querySelector('.rte')`));
  await typeInto('.sect-head__def', '改过的简介：全局编辑模式下的产物。<br>第二行还在。');
  await clickBtn('保存');
  await wait(900);
  const suiyuDef = ((await api('/api/sections')).data.sections.find((s) => s.id === 'suiyu') || {}).def;
  check('服务里存下了改过的简介（<br> 留着）', suiyuDef === '改过的简介：全局编辑模式下的产物。<br>第二行还在。', suiyuDef);
  await shot('gedit-def-saved');

  /* --- 6. 文章页：标题内联改；正文点一下直接改 --- */
  const RTE_SLUG = 'rainy-day';
  restore.push(async () => { await api(`/api/articles/${RTE_SLUG}`, 'PATCH', { reset: true, body: false }); });
  await goto(`${SITE}/posts/${RTE_SLUG}.html`);
  await enterMode();
  await clickAt('.article__title');
  await wait(320);
  check('标题点一下就可编辑',
    await evaluate(`document.querySelector('.article__title').getAttribute('contenteditable') === 'true'`));
  await typeInto('.article__title', '雨天不适合做决定（改过）');
  await clickBtn('保存');
  await wait(900);
  check('服务里存下了新标题（覆盖层，源文件没动）',
    ((await api('/api/posts')).data.posts.find((p) => p.slug === RTE_SLUG) || {}).title === '雨天不适合做决定（改过）');
  check('文章页大标题当场换了', (await evaluate(`document.querySelector('.article__title').textContent`)) === '雨天不适合做决定（改过）');
  check('标签页也换了', (await evaluate('document.title.indexOf("雨天不适合做决定（改过）") === 0')), await evaluate('document.title'));

  await clickAt('.prose');
  await wait(320);
  check('正文点一下也可编辑',
    await evaluate(`document.querySelector('.prose').getAttribute('contenteditable') === 'true'`));
  await typeInto('.prose', '<p>全局编辑模式改的正文。</p>');
  await clickBtn('保存');
  await wait(900);
  check('正文也存进了覆盖层',
    /全局编辑模式改的正文/.test(((await api('/api/posts')).data.posts.find((p) => p.slug === RTE_SLUG) || {}).body || ''));
  await shot('gedit-post-saved');

  /* --- 7. Esc 退出模式 --- */
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await wait(300);
  check('Esc 一次就退出编辑模式', await evaluate(`!document.documentElement.hasAttribute('data-editmode')`));
  check('退出之后：虚线全部摘掉、按钮文案还原',
    await evaluate(`document.querySelector('[data-gm]') === null && document.querySelector('[data-edit-toggle]').textContent === '全局编辑'`));

  /* --- 8. 局部刷新换页：模式开着跨页还在 --- */
  await goto(`${SITE}/index.html`);
  await enterMode();
  /* 轨道栏的板块名在编辑模式里是字不是门：从每日一句的板块链接走（它不在名单里） */
  await evaluate(`document.querySelector('.epigraph__label').click()`);
  await waitPath(/sections\/suiyu\.html$/);
  await wait(500);
  check('换页之后模式还开着', await evaluate(`document.documentElement.getAttribute('data-editmode') === 'on'`));
  check('新页面的位置重新描好了',
    await evaluate(`document.querySelector('.sect-head__def').hasAttribute('data-gm') && document.querySelector('main .lede').hasAttribute('data-gm')`));
  await shot('gedit-cross-page');

  /* --- 9. 收尾：控制台干净 --- */
  await goto(`${SITE}/index.html`);
  check('全程没有控制台报错', consoleErrors.length === 0, consoleErrors.join(' | '));
} catch (err) {
  problems.push(`自检脚本本身出错：${err.message}`);
} finally {
  /* 自检动过的每一处都要放回去：临时板块删掉、简介 / 导语 / 标题 / 正文还原 */
  for (const undo of restore) {
    try { await undo(); } catch { /* 服务可能已经关了 */ }
  }
  const overridesAfter = overridesCount();
  if (overridesAfter !== overridesBefore) {
    problems.push(`覆盖层条数变了（${overridesBefore} → ${overridesAfter}），自检痕迹没收干净，请看一眼 data/overrides.json`);
  }
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

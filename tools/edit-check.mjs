/* ==========================================================================
   tools/edit-check.mjs · 站长右键菜单（改名 / 撤下 / 页面上直接改字）的浏览器自检
   ---------------------------------------------------------------------------
   零依赖：自己拼 WebSocket 帧跟无头 Chrome 说话，和 dom-check.mjs 一样。
   量的是一条完整的路：右键 → 菜单 → 对话 → 服务里真的变了 → 页面当场跟上 →
   刷新之后仍然是对的。还要量「访客看不到这东西」。

     1) 访客（浏览器里没有口令）：右键 = 浏览器自己那一套，一个菜单都不该冒出来
     2) 站长：右键轨道栏的板块 → 菜单（Esc 收起、焦点还回去）
     3) 改名：临时建的板块 → 当场改名 → 服务里也变了 → 删掉（跑完清干净）
     4) 撤下：原生板块与原生文章 → 站点上没了、那一页 410、覆盖层记了一笔 →
        恢复 → 又回来了
     5) 改原生文章的标题 → 当场换字；**重新加载之后仍然是新标题**（静态页由
        sections.js 对齐，不用重新生成）
     6) 页面上直接改字：右键正文 → 可编辑 + 工具条 → 加粗 / 青下划线 / 划掉 /
        一级 / 注释 → 保存 → 服务里存下了这一段 HTML → 刷新之后静态页显示的
        就是改过的那一版 → 「恢复成源文件里的正文」还能回去
     7) 板块页那两行（简介 / 导语）：同样能直接改，<br> 要留住
     8) 右键正文之外的空白 / 页脚：不弹（那是浏览器自己的地盘）
     9) 手机：长按也算

   用法（服务要先跑起来，而且要是改过之后的那份）：
     node server/server.mjs 4399
     node tools/edit-check.mjs                     # 默认 http://127.0.0.1:4399
     node tools/edit-check.mjs http://127.0.0.1:4321
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
  console.error('没找到 Chrome 或 Edge，跳过右键菜单自检');
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
    /* 门厅那枚章：从浏览器里出来的人都有它。没有它，页面请求会先被送回门厅，
       而这一条量的是「进了门之后，被撤下的那一页回 410」 */
    headers: { 'x-cv01-key': key, 'content-type': 'application/json', cookie: 'cv01-enter=1' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
};

try {
  const health = await fetch(SITE + '/api/health');
  if (!health.ok) throw new Error(String(health.status));
  const sections = (await api('/api/sections')).data.sections || [];
  if (!sections.some((s) => s.id === 'suiyu') || !sections.some((s) => s.id === 'tongxue')) {
    console.error('这个服务上的板块不对（少了 suiyu / tongxue）。先用最新的 server/server.mjs 起来。');
    process.exit(1);
  }
} catch {
  console.error(`上传服务没在 ${SITE} 上跑。先另开一个窗口：node server/server.mjs 4399`);
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
const profile = join(tmpdir(), `cv01-edit-${randomBytes(4).toString('hex')}`);
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
const made = { section: '' };
const restore = [];

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

  /* 页面自己要刷新的时候（保存完那次 reload）不能靠在页面里等：
     求值会撞上导航，抛「navigated or closed」。这种时候在 Node 这边睡。 */
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
    await wait(700);   /* 让 sections.js 那次对齐跑完 */
  }

  /* 页面自己在跳转的那一瞬间，执行上下文会被销毁，这一刻的求值会抛
     「navigated or closed」——不是错，是还没落稳 */
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

  /* 真右键：CDP 的鼠标事件，浏览器会照规矩派发 contextmenu */
  async function rightClick(selector, nth = 0) {
    const box = JSON.parse(await evaluate(`(function () {
      var el = document.querySelectorAll(${JSON.stringify(selector)})[${nth}];
      if (!el) return 'null';
      var r = el.getBoundingClientRect();
      return JSON.stringify({ x: Math.round(r.left + Math.min(24, r.width / 2)), y: Math.round(r.top + r.height / 2) });
    })()`));
    if (!box) throw new Error(`右键找不到 ${selector}[${nth}]`);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', {
        type, x: box.x, y: box.y, button: 'right', buttons: type === 'mousePressed' ? 2 : 0, clickCount: 1,
      });
    }
    await wait(450);      /* 验口令 + 取两层名单 */
  }

  async function menuLabels() {
    return JSON.parse(await evaluate(`JSON.stringify(
      Array.prototype.map.call(document.querySelectorAll('.ctx .ctx__item'), function (b) { return b.textContent; })
    )`));
  }

  /* 工具条上按文字找那颗按钮（B / 一级 / 注释 / 保存…） */
  const clickBtn = (text) => evaluate(`Array.prototype.filter.call(document.querySelectorAll('.rte__btn'), function (b) { return b.textContent === ${JSON.stringify(text)}; })[0].click()`);

  const keyInPage = `localStorage.setItem('cv01-key', ${JSON.stringify(key)})`;
  const dropKeyInPage = `localStorage.removeItem('cv01-key')`;

  /* --- 1. 访客：右键不该冒出任何菜单 --- */
  /* 先进门厅盖个章：站点页面现在要先过门厅（?enter=1 由服务回应一枚三十天的 cookie），
     不盖的话下面每一次 goto 都会被 302 送回 login.html */
  await goto(`${SITE}/index.html?enter=1`);
  await evaluate(dropKeyInPage);
  await goto(`${SITE}/index.html`);
  await rightClick('.rail a.key');
  check('访客右键：一个菜单都不冒出来', (await menuLabels()).length === 0);
  check('访客右键：控制台没有报错', consoleErrors.length === 0, consoleErrors.join(' | '));

  /* --- 1b. 输过口令的浏览器走「访客进入」，必须降级成访客（这是一个真出现过的洞：
         身份只看浏览器里有没有那把口令，而访客那颗键从前不会把它忘掉） --- */
  await evaluate(keyInPage);
  await goto(`${SITE}/login.html`);
  check('门厅会说明这台浏览器现在是站长身份',
    (await evaluate(`(document.querySelector('[data-status]') || {}).hidden === false`)) &&
    (await evaluate(`/[站长]{2}/.test((document.querySelector('[data-status]') || {}).textContent || '')`)));
  await evaluate(`document.querySelector('.gate-key--visitor').click()`);
  await waitPath(/index\.html$/);
  check('按「访客进入」之后：口令被忘掉了',
    (await evaluate(`(function () { try { return localStorage.getItem('cv01-key') || ''; } catch (e) { return ''; } })()`)) === '');
  await rightClick('.rail a.key');
  check('降级成访客之后：右键不再冒出菜单', (await menuLabels()).length === 0);
  await goto(`${SITE}/posts/rainy-day.html`);
  await rightClick('.prose');
  check('降级成访客之后：文章正文也右键不出菜单（改字这条路堵死了）', (await menuLabels()).length === 0);
  check('降级成访客之后：页面上也没进编辑态',
    (await evaluate(`!document.querySelector('[contenteditable="true"]') && !document.querySelector('.rte')`)));

  /* --- 2. 站长：菜单出来，Esc 关掉 --- */
  await evaluate(keyInPage);
  await goto(`${SITE}/index.html`);
  await rightClick('.rail a.key', 3);
  const labels = await menuLabels();
  check('站长右键：菜单出来了', labels.length === 2, labels.join(' / '));
  check('菜单第一项是重命名', /^重命名板块/.test(labels[0] || ''), labels[0] || '');
  check('原生板块那一项说的是「撤下」', /^撤下这个板块/.test(labels[1] || ''), labels[1] || '');
  check('菜单拿到焦点了', await evaluate('document.activeElement.classList.contains("ctx__item")'));
  await shot('edit-menu');
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await wait(150);
  check('Esc 收起菜单', (await menuLabels()).length === 0);
  check('收起之后焦点还在原来那一项上', await evaluate('document.activeElement.classList.contains("key")'));

  /* --- 3. 改名：临时板块（菜单 → 对话 → 服务 → 页面） --- */
  const form = new FormData();
  form.set('name', '自检临时板块');
  const created = await fetch(`${SITE}/api/sections`, { method: 'POST', headers: { 'x-cv01-key': key }, body: form }).then((r) => r.json());
  made.section = created.section ? created.section.id : '';
  restore.push(async () => { if (made.section) await api(`/api/sections/${made.section}`, 'DELETE'); });
  check('临时板块建出来了', Boolean(made.section), JSON.stringify(created).slice(0, 100));

  await goto(`${SITE}/index.html`);
  const at = JSON.parse(await evaluate(`(function () {
    var keys = Array.prototype.slice.call(document.querySelectorAll('.rail a.key'));
    for (var i = 0; i < keys.length; i++) if (keys[i].getAttribute('href').indexOf(${JSON.stringify(made.section)}) > -1) return String(i);
    return '-1';
  })()`));
  check('临时板块出现在轨道栏里', at !== '-1', `下标 ${at}`);
  if (at !== '-1') {
    await rightClick('.rail a.key', Number(at));
    const l2 = await menuLabels();
    check('界面建的板块：那一项说的是「删除」', /^删除这个板块/.test(l2[1] || ''), l2[1] || '');
    await evaluate(`document.querySelectorAll('.ctx .ctx__item')[0].click()`);
    await wait(300);
    check('点「重命名」弹出输入框', await evaluate('!!document.querySelector(".keygate input")'));
    await evaluate(`(function () {
      var input = document.querySelector('.keygate input');
      input.value = '自检改过名的板块';
      document.querySelector('.keygate form').requestSubmit();
    })()`);
    await wait(700);
    const railName = await evaluate(`(function () {
      var keys = Array.prototype.slice.call(document.querySelectorAll('.rail a.key'));
      for (var i = 0; i < keys.length; i++) {
        if (keys[i].getAttribute('href').indexOf(${JSON.stringify(made.section)}) > -1) {
          return keys[i].querySelector('.key__name').textContent;
        }
      }
      return '';
    })()`);
    check('改名当场落到轨道栏上', railName === '自检改过名的板块', railName);
    const inService = ((await api('/api/sections')).data.sections || []).find((s) => s.id === made.section);
    check('服务里的名字也变了', inService && inService.name === '自检改过名的板块', inService ? inService.name : '找不到');
    await shot('edit-renamed');

    /* 删掉它（界面建的：真删） */
    await rightClick('.rail a.key', Number(at));
    await evaluate(`document.querySelectorAll('.ctx .ctx__item')[1].click()`);
    await wait(300);
    check('删除前先问一句', await evaluate('!!document.querySelector(".keygate")'));
    await evaluate(`document.querySelector('.keygate form').requestSubmit()`);
    await wait(800);
    check('删除之后轨道栏里没有了', await evaluate(`document.querySelector('.rail a.key[href*="${made.section}"]') === null`));
    check('删除之后服务里也没有了', !((await api('/api/sections')).data.sections || []).some((s) => s.id === made.section));
    made.section = '';
  }

  /* --- 4. 撤下原生板块（suiyu）：站点上没了、那一页 410、能放回来 --- */
  await goto(`${SITE}/index.html`);
  const hasSuiyu = async () => await evaluate(`document.querySelector('.rail a.key[href$="sections/suiyu.html"]') !== null`);
  check('撤下之前：轨道栏里有「胡盐乱雨集」', await hasSuiyu());
  const suiAt = Number(await evaluate(`(function () {
    var keys = Array.prototype.slice.call(document.querySelectorAll('.rail a.key'));
    for (var i = 0; i < keys.length; i++) if (keys[i].getAttribute('href').indexOf('suiyu') > -1) return String(i);
    return '-1';
  })()`));
  await rightClick('.rail a.key', suiAt);
  await evaluate(`document.querySelectorAll('.ctx .ctx__item')[1].click()`);
  await wait(300);
  await shot('edit-confirm');
  await evaluate(`document.querySelector('.keygate form').requestSubmit()`);
  await wait(700);
  restore.push(async () => { await api('/api/sections/suiyu', 'PATCH', { hidden: false }); });
  check('撤下之后：轨道栏里当场没了', !(await hasSuiyu()));
  check('撤下之后：服务里也没了', !((await api('/api/sections')).data.sections || []).some((s) => s.id === 'suiyu'));
  check('撤下之后：那一页回 410', (await api('/sections/suiyu.html')).status === 410);
  check('撤下之后：提示条上有「撤销」', await evaluate('!!document.querySelector(".studio__toast-act")'));
  await shot('edit-hidden');

  /* 刷新一次：静态页里烤着的那个板块也不该回来（sections.js 对齐） */
  await goto(`${SITE}/index.html`);
  check('刷新之后：它还是不在了', !(await hasSuiyu()));
  check('/api/sections 里有 hidden 名单', Array.isArray((await api('/api/sections')).data.hidden.sections));

  /* 放回来 */
  check('放回来', (await api('/api/sections/suiyu', 'PATCH', { hidden: false })).status === 200);
  await goto(`${SITE}/index.html`);
  check('放回来之后：轨道栏里又有了', await hasSuiyu());
  restore.length = 0;   /* 已经手工恢复了，别再重复 */

  /* --- 5. 原生文章：改标题 → 当场变 → 刷新后仍是新标题；撤下 → 410 → 恢复 --- */
  await goto(`${SITE}/sections/tongxue.html`);
  const rowTitle = `(function () {
    var a = document.querySelector('.post-row__link[href$="posts/back-row-three.html"]');
    return a ? a.querySelector('.post-row__title').textContent : '';
  })()`;
  const before = await evaluate(rowTitle);
  const rowAt = Number(await evaluate(`(function () {
    var rows = Array.prototype.slice.call(document.querySelectorAll('.post-row'));
    for (var i = 0; i < rows.length; i++) {
      var a = rows[i].querySelector('.post-row__link');
      if (a && a.getAttribute('href').indexOf('back-row-three') > -1) return String(i);
    }
    return '-1';
  })()`));
  check('板块页里找得到那篇文章', rowAt !== '-1' && Boolean(before), before);

  await rightClick('.post-row', rowAt);
  const rowMenu = await menuLabels();
  check('文章菜单：重命名 + 撤下', /^重命名文章/.test(rowMenu[0] || '') && /^撤下这篇文章/.test(rowMenu[1] || ''), rowMenu.join(' / '));
  await evaluate(`document.querySelectorAll('.ctx .ctx__item')[0].click()`);
  await wait(300);
  await evaluate(`(function () {
    document.querySelector('.keygate input').value = '自检改过的标题';
    document.querySelector('.keygate form').requestSubmit();
  })()`);
  await wait(700);
  restore.push(async () => { await api('/api/articles/back-row-three', 'PATCH', { reset: true }); });
  check('改标题当场落到那一行上', (await evaluate(rowTitle)) === '自检改过的标题', await evaluate(rowTitle));
  await shot('edit-post-renamed');

  await goto(`${SITE}/sections/tongxue.html`);
  check('刷新之后：静态页里的标题也跟上了', (await evaluate(rowTitle)) === '自检改过的标题', await evaluate(rowTitle));
  check('标题也进了 /api/posts', ((await api('/api/posts')).data.posts.find((p) => p.slug === 'back-row-three') || {}).title === '自检改过的标题');

  /* 撤下这一篇 */
  const rowAt2 = Number(await evaluate(`(function () {
    var rows = Array.prototype.slice.call(document.querySelectorAll('.post-row'));
    for (var i = 0; i < rows.length; i++) {
      var a = rows[i].querySelector('.post-row__link');
      if (a && a.getAttribute('href').indexOf('back-row-three') > -1) return String(i);
    }
    return '-1';
  })()`));
  await rightClick('.post-row', rowAt2);
  await evaluate(`document.querySelectorAll('.ctx .ctx__item')[1].click()`);
  await wait(300);
  await evaluate(`document.querySelector('.keygate form').requestSubmit()`);
  await wait(700);
  check('撤下之后：那一行当场没了', (await evaluate(`document.querySelector('.post-row__link[href$="posts/back-row-three.html"]') === null`)));
  check('撤下之后：那一页回 410', (await api('/posts/back-row-three.html')).status === 410);
  check('撤下之后：归档里也没有它', !((await api('/api/posts')).data.posts || []).some((p) => p.slug === 'back-row-three'));

  await goto(`${SITE}/archive.html`);
  check('归档页刷新后也没有它了', (await evaluate(`document.querySelector('.post-row__link[href$="posts/back-row-three.html"]') === null`)));
  await goto(`${SITE}/index.html`);
  check('首页卷帘上的那个音符也没了', (await evaluate(`document.querySelector('.roll a.note[href$="posts/back-row-three.html"]') === null`)));
  await shot('edit-hidden-post');

  /* 恢复：先撤下、再放回来，量两次 */
  await api('/api/articles/back-row-three', 'PATCH', { hidden: false });
  restore.length = 0;
  await goto(`${SITE}/sections/tongxue.html`);
  check('放回来之后：那一行回来了', await evaluate(`document.querySelector('.post-row__link[href$="posts/back-row-three.html"]') !== null`));

  /* 标题还原（reset 会把覆盖层里那一条整个抹掉） */
  check('标题还原', (await api('/api/articles/back-row-three', 'PATCH', { reset: true })).status === 200);
  await goto(`${SITE}/sections/tongxue.html`);
  check('还原之后标题回到 content/posts.mjs 里的原名', (await evaluate(rowTitle)) === '高三教室后排的三个人', await evaluate(rowTitle));

  /* --- 6. 页面上直接改字：文章正文（富文本那一层） ---
     挑一篇正文真有段落的（rainy-day 有七段）；骨架里好几篇还是「这篇还没写」的占位。 */
  const RTE_SLUG = 'rainy-day';
  restore.push(async () => { await api(`/api/articles/${RTE_SLUG}`, 'PATCH', { body: false }); });
  await goto(`${SITE}/posts/${RTE_SLUG}.html`);
  const proseHtml = `document.querySelector('.prose').innerHTML`;
  const beforeHtml = await evaluate(proseHtml);
  const paraCount = await evaluate(`document.querySelectorAll('.prose p').length`);
  check('这一篇有好几段正文（够试那几档）', paraCount >= 2, `p=${paraCount}`);

  await rightClick('.prose');
  const bodyMenu = await menuLabels();
  check('正文右键：菜单里有「编辑正文…」', /^编辑正文/.test(bodyMenu[0] || ''), bodyMenu.join(' / '));
  await evaluate(`document.querySelectorAll('.ctx .ctx__item')[0].click()`);
  await wait(320);
  check('正文当场变成可编辑的（点哪儿改哪儿）',
    await evaluate(`document.querySelector('.prose').getAttribute('contenteditable') === 'true'`));
  check('工具条挂上来了', await evaluate(`!!document.querySelector('.rte')`));
  check('四档字号都在',
    await evaluate(`Array.prototype.map.call(document.querySelectorAll('.rte__group'), function (g) { return g.textContent; }).join('|').indexOf('一级二级正文注释') > -1`));
  check('下划线有青、粉两颗',
    await evaluate(`document.querySelectorAll('.rte__btn--cyan, .rte__btn--pink').length === 2`));
  await shot('edit-rte');

  /* Esc：改过之后要问一句，放弃就回到原样 */
  await evaluate(`(function () {
    var el = document.querySelector('.prose');
    el.innerHTML = '<p>临时乱改的一句</p>';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await wait(300);
  check('Esc：先问一句「放弃这次修改？」', await evaluate(`!!document.querySelector('.keygate')`));
  await evaluate(`document.querySelector('.keygate form').requestSubmit()`);
  await wait(300);
  check('放弃之后回到原样、也不再是可编辑的',
    (await evaluate(proseHtml)) === beforeHtml &&
    (await evaluate(`!document.querySelector('.prose').hasAttribute('contenteditable')`)));

  /* 再来一次，这回真的改：两段各管各的 —— 第一段 加粗/青下划线/划掉/一级，第二段 注释 */
  await rightClick('.prose');
  await evaluate(`document.querySelectorAll('.ctx .ctx__item')[0].click()`);
  await wait(320);
  const pick = (which) => evaluate(`(function () {
    var r = document.createRange();
    r.selectNodeContents(window.__t.${which});
    var s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
  })()`);
  await evaluate(`(function () {
    var el = document.querySelector('.prose');
    var paras = el.querySelectorAll('p');
    window.__t = { a: paras[0] || el, b: paras[1] || paras[0] || el };
    var r = document.createRange();
    r.selectNodeContents(window.__t.a);
    var s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
  })()`);
  await clickBtn('B');
  check('加粗：落成 <b> / <strong>', await evaluate(`/<(b|strong)>/i.test(document.querySelector('.prose').innerHTML)`));
  await evaluate(`document.querySelector('.rte__btn--cyan').click()`);
  check('下划线（青）：带上了 var(--miku)',
    await evaluate(`/text-decoration-color:\\s*var\\(--miku\\)/.test(document.querySelector('.prose').innerHTML)`));
  await evaluate(`document.querySelector('.rte__btn--s').click()`);
  check('划掉：落成 <strike>', await evaluate(`/<strike>/i.test(document.querySelector('.prose').innerHTML)`));
  await pick('b');
  await clickBtn('注释');
  check('注释档：加上了 .prose-note', await evaluate(`!!document.querySelector('.prose .prose-note')`));
  await pick('a');
  await clickBtn('一级');
  check('一级档：落成 <h2>', await evaluate(`!!document.querySelector('.prose h2')`));
  check('两档各管各的段：注释还在', await evaluate(`!!document.querySelector('.prose .prose-note')`));
  await clickBtn('保存');
  await wait(900);
  check('保存之后退出编辑态',
    await evaluate(`!document.querySelector('.prose').hasAttribute('contenteditable') && !document.querySelector('.rte')`));
  const savedBody = ((await api('/api/posts')).data.posts.find((p) => p.slug === RTE_SLUG) || {}).body || '';
  check('服务里存下了这段正文（源文件没动）',
    /<(b|strong|h2)>/i.test(savedBody) && /prose-note/.test(savedBody) && /var\(--miku\)/.test(savedBody),
    savedBody.slice(0, 80));

  await goto(`${SITE}/posts/${RTE_SLUG}.html`);
  check('刷新之后：静态页显示的是改过的那一版',
    await evaluate(`/prose-note/.test(document.querySelector('.prose').innerHTML)`));
  await shot('edit-rte-saved');

  await rightClick('.prose');
  const bodyMenu2 = await menuLabels();
  check('改过之后菜单里多一条「恢复成源文件里的正文…」',
    bodyMenu2.join(' / ').indexOf('恢复成源文件') > -1, bodyMenu2.join(' / '));
  await evaluate(`Array.prototype.filter.call(document.querySelectorAll('.ctx .ctx__item'), function (b) { return /恢复成源文件/.test(b.textContent); })[0].click()`);
  await wait(320);
  await evaluate(`document.querySelector('.keygate form').requestSubmit()`);
  /* 恢复之后页面自己会刷新一次（正文回到源渲染那份）：在 Node 这边等它刷完再走 */
  await sleep(2400);
  await goto(`${SITE}/posts/${RTE_SLUG}.html`);
  check('恢复之后：覆盖层里没有它了',
    ((await api('/api/posts')).data.posts.find((p) => p.slug === RTE_SLUG) || {}).body === undefined);
  check('恢复之后：页面上也回到源文件里的正文',
    !/prose-note/.test(await evaluate(`document.querySelector('.prose').innerHTML`)));

  /* --- 7. 页面上直接改字：板块页的两段文字 --- */
  const origLede = '长短不一的随笔。有些是想法，有些只是天气。<br>此集不删稿——写坏了也留着，那是当时真实的水位。';
  restore.push(async () => { await api('/api/sections/suiyu', 'PATCH', { lede: origLede }); });
  await goto(`${SITE}/sections/suiyu.html`);
  await rightClick('.lede');
  const ledeMenu = await menuLabels();
  check('导语右键：菜单里是「编辑这段导语…」', /^编辑这段导语/.test(ledeMenu[0] || ''), ledeMenu.join(' / '));
  await evaluate(`document.querySelectorAll('.ctx .ctx__item')[0].click()`);
  await wait(320);
  check('导语可编辑，工具条只给文字效果（板块那两行不给改字号）',
    await evaluate(`document.querySelector('.lede').getAttribute('contenteditable') === 'true' && document.querySelectorAll('.rte .rte__group').length === 2`));
  await evaluate(`(function () {
    var el = document.querySelector('.lede');
    el.innerHTML = '改过的导语。<br>第二行。';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await clickBtn('保存');
  await wait(900);
  const ledeNow = ((await api('/api/sections')).data.sections.find((s) => s.id === 'suiyu') || {}).lede;
  check('服务里存下了改过的导语（<br> 留着）', ledeNow === '改过的导语。<br>第二行。', ledeNow);
  await goto(`${SITE}/sections/suiyu.html`);
  check('刷新之后：静态页显示改过的导语',
    /改过的导语/.test(await evaluate(`document.querySelector('.lede').innerHTML`)));
  await shot('edit-rte-text');
  check('导语还原', (await api('/api/sections/suiyu', 'PATCH', { lede: origLede })).status === 200);
  await goto(`${SITE}/sections/suiyu.html`);
  check('还原之后导语回到原样',
    (await evaluate(`document.querySelector('.lede').innerHTML`)).indexOf('此集不删稿') > -1);

  /* --- 8. 右键正文之外的空白 / 页脚：不弹 --- */
  await goto(`${SITE}/about.html`);
  await rightClick('main .lede');
  check('右键正文：不弹菜单（about 页那一段不是板块的）', (await menuLabels()).length === 0);
  await rightClick('.foot__line');
  check('右键页脚：不弹菜单', (await menuLabels()).length === 0);

  /* --- 9. 收尾：控制台干净 --- */
  await goto(`${SITE}/index.html`);
  check('全程没有控制台报错', consoleErrors.length === 0, consoleErrors.join(' | '));

  /* --- 10. 手机：长按也算（触摸屏没有右键） --- */
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 780, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await evaluate(keyInPage);
  await goto(`${SITE}/index.html`);
  const box = JSON.parse(await evaluate(`(function () {
    var el = document.querySelector('.rail a.key');
    var r = el.getBoundingClientRect();
    return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
  })()`));
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x, y: box.y }] });
  await wait(900);
  const touchMenu = await menuLabels();
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  check('手机上长按也弹菜单', touchMenu.length === 2, touchMenu.join(' / '));
  await shot('edit-mobile');

  /* 手机上那条工具条最容易挤：折行之后不许横向溢出 */
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await goto(`${SITE}/posts/${RTE_SLUG}.html`);
  /* 手机上正文在首屏之外，而且命令栏是 sticky 的：先把它滚到眼前，
     再在它可见的那一段里找一个「点下去真落在正文上」的位置 */
  await evaluate(`document.querySelector('.prose').scrollIntoView({ block: 'center' })`);
  await wait(300);
  const proseBox = JSON.parse(await evaluate(`(function () {
    var el = document.querySelector('.prose');
    var r = el.getBoundingClientRect();
    var x = Math.round(r.left + 20);
    var top = Math.max(8, r.top + 10);
    var bottom = Math.min(window.innerHeight - 10, r.bottom - 10);
    for (var y = top; y <= bottom; y += 40) {
      var hit = document.elementFromPoint(x, y);
      if (hit && hit.closest && hit.closest('.prose')) return JSON.stringify({ x: x, y: Math.round(y), ok: true });
    }
    return JSON.stringify({ x: x, y: Math.round(top), ok: false });
  })()`));
  check('手机：找得到正文上的一点（不被命令栏挡着）', proseBox.ok, JSON.stringify(proseBox));
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: proseBox.x, y: proseBox.y }] });
  await wait(900);
  /* 手指还按着的时候就先读：抬手之后浏览器会补一次 click，而那次 click 是被
     studio.js 吃掉的——量的是「长按弹不弹菜单」，不是抬手之后还在不在 */
  const opened = await evaluate(`document.querySelectorAll('.ctx .ctx__item').length`);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await wait(150);
  check('手机：长按正文弹出「编辑正文…」', opened > 0, `菜单项=${opened}`);
  if (!opened) throw new Error('手机上长按正文没出菜单，后面的量不了');
  check('手机：抬手之后菜单还在（那次补出来的 click 被吃掉了）',
    (await evaluate(`document.querySelectorAll('.ctx .ctx__item').length`)) > 0);
  await evaluate(`Array.prototype.filter.call(document.querySelectorAll('.ctx .ctx__item'), function (b) { return /编辑正文/.test(b.textContent); })[0].click()`);
  await wait(320);
  const phoneBar = JSON.parse(await evaluate(`(function () {
    var bar = document.querySelector('.rte');
    if (!bar) return JSON.stringify({ ok: false });
    var r = bar.getBoundingClientRect();
    return JSON.stringify({
      ok: true,
      fits: r.left >= 0 && r.right <= window.innerWidth + 1,
      aboveFold: r.bottom < window.innerHeight,
      overshoot: document.documentElement.scrollWidth - window.innerWidth
    });
  })()`));
  check('手机：工具条折行后不出屏', phoneBar.ok && phoneBar.fits && phoneBar.aboveFold, JSON.stringify(phoneBar));
  check('手机：编辑时页面不横向溢出', phoneBar.overshoot <= 1, `溢出 ${phoneBar.overshoot}px`);
  await shot('edit-rte-mobile');
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await wait(250);
  /* 这一回一个字都没改，Esc 直接退出、不该弹「放弃这次修改？」——有就顺手点掉 */
  await evaluate(`(function () {
    var b = Array.prototype.filter.call(document.querySelectorAll('.keygate form button'), function (x) { return /放弃/.test(x.textContent); })[0];
    if (b) b.click();
  })()`);
  await wait(200);

  await send('Emulation.clearDeviceMetricsOverride');
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
} catch (err) {
  problems.push(`自检脚本本身出错：${err.message}`);
} finally {
  /* 自检动过的每一处都要放回去：撤下的恢复、改名的 reset、正文覆盖清掉、临时板块删掉 */
  for (const undo of restore) {
    try { await undo(); } catch { /* 服务可能已经关了 */ }
  }
  try {
    const left = JSON.parse(readFileSync(OVERRIDES, 'utf8'));
    const n = Object.keys(left.sections || {}).length + Object.keys(left.posts || {}).length;
    if (n) problems.push(`覆盖层里还留着 ${n} 条自检痕迹，请看一眼 data/overrides.json`);
  } catch { /* 没有这个文件 = 干净 */ }
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

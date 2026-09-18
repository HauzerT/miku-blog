/* ==========================================================================
   tools/nuxt-edit-check.mjs · Nuxt 应用的「站长那两只手」浏览器验收
   ---------------------------------------------------------------------------
   旧站那批自检（edit-check / globaledit-check / md-check / login-check）盯的是
   「生成出来的 HTML + 挂在上面的一堆 IIFE」，那套页面已经随 1.x 静态线一起删掉了。
   这一份是它们的接任者：对着**真浏览器 + 真服务 + 真文件**量编辑这条工作流（94 项断言）。

   它覆盖什么（全部对着真服务，全程控制台 0 报错）：
     1) 访客：没有 [data-edit-toggle]，右键轨道栏一个菜单都不冒出来
     2) 站长：按钮出现 → 点一下 html[data-editmode] + 虚线框 →
        点板块名 / 文章标题 → 光标落在点的那个字附近 → 打字保存 →
        发出的请求与 rail / 首页索引 / 文章行看到的新字都对得上 → 改回来
     3) 右键菜单：轨道栏板块两条（重命名 / 撤下）→ 撤下原生板块 →
        data/overrides.json 里落一笔 → 那一页 410 → 提示条上的「撤销」放回来
     4) 发布过的文章：三条（整篇重编辑 / 重命名 / 删除）→ 点「整篇重编辑…」整页进
        /editor?id=…、稿子回填、「去看这一篇」指着刚发出去的那一页；原生文章不摆这一条
     5) 原生文章正文的富文本：改一段、加粗、下划线（青）→ 保存 →
        data/overrides.json 里 posts.<slug>.body → 页面上看得到 →
        「恢复成源文件里的正文」把覆盖层那一条拿掉（源文件不动）
     6) Esc 语义与「一段一次」：改着的时候 Esc 先问一句；点别处的链接不跳、先问一句
     7) 全程控制台 0 报错

   怎么跑（先构建再起成品服务）：
     pnpm install && pnpm build
     $env:PORT='3987'; node .output/server/index.mjs      # 另开一个窗口，仓库根目录
     node tools/nuxt-edit-check.mjs http://127.0.0.1:3987

   口令从环境变量 CV01_KEY 里读，**绝不打印、绝不写进任何文件**（AGENTS.md 与
   任务书的数据安全一节）。取一条现成的而不把它打到屏幕上：
     $lines = (node tools/set-passphrase.mjs --print) -split "`r?`n"
     $env:CV01_KEY = (($lines | Where-Object { $_ -match '^口令' }) -replace '^口令\s*','').Trim()

   它会写 data/overrides.json（撤下与改字都要落那一笔），收尾自己改回来；
   全程只读 / 只写 data/ 下的内容，数据安全由跑之前之后的 SHA-256 比对背书。

   零依赖：用 Node 自带的 WebSocket 跟 Chrome 的调试端口说话（CDP），与
   tools/nuxt-check.mjs 是同一套做法。截图落在 .check/（已在 .gitignore 里）。
   ========================================================================== */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.argv[2] || 'http://127.0.0.1:3987').replace(/\/+$/, '');
const CHECK = join(ROOT, '.check');
const KEY = process.env.CV01_KEY || '';
const OVERRIDES = join(ROOT, 'data', 'overrides.json');
const POSTS_SRC = join(ROOT, 'content', 'posts.mjs');

if (!KEY) {
  console.error('没有 CV01_KEY。先跑：$env:CV01_KEY = (…) 再运行。');
  process.exit(1);
}

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));
if (!CHROME) {
  console.error('找不到 Chrome 或 Edge');
  process.exit(1);
}

/* ------------------------------------------------------------------ 小工具 */
const sha = (file) => (existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 16) : 'missing');
const readOverrides = () => {
  try {
    return JSON.parse(readFileSync(OVERRIDES, 'utf8'));
  } catch {
    return {};
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const problems = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  if (!pass) problems.push(`${name}  ${detail}`);
  console.log(`${pass ? '  ok  ' : '  XX  '} ${name}${detail ? `  — ${detail}` : ''}`);
};

const api = async (path, method = 'GET', body) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'x-cv01-key': KEY, 'content-type': 'application/json', cookie: 'cv01-enter=1' },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text.slice(0, 200);
  }
  return { status: res.status, data };
};

/* ------------------------------------------------------------------ CDP */
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.listeners = [];
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners) fn(msg);
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.seq;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP 超时：${method}`));
        }
      }, 30000);
    });
  }

  on(fn) {
    this.listeners.push(fn);
  }
}

async function openBrowser() {
  const port = 9700 + Math.floor(Math.random() * 200);
  const profile = join(tmpdir(), `cv01-editprobe-${randomBytes(4).toString('hex')}`);
  const proc = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--mute-audio',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      `--remote-debugging-port=${port}`,
      '--remote-allow-origins=*',
      `--user-data-dir=${profile}`,
      '--window-size=1280,900',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  let version = null;
  for (let i = 0; i < 60 && !version; i++) {
    try {
      version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    } catch {
      await sleep(250);
    }
  }
  if (!version) throw new Error('Chrome 的调试端口没有起来');

  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('连不上 Chrome 的调试端口')), { once: true });
  });

  const cdp = new Cdp(ws);
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  return {
    cdp,
    sessionId,
    close() {
      try {
        ws.close();
      } catch {
        /* 收尾而已 */
      }
      try {
        proc.kill();
      } catch {
        /* 同上 */
      }
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch {
        /* Windows 上偶尔还占着 */
      }
    },
  };
}

/* ------------------------------------------------------------------ 一页 */
const consoleErrors = [];
let shotCount = 0;

async function main() {
  mkdirSync(CHECK, { recursive: true });
  console.log(`\n源文件哈希（跑之前）：content/posts.mjs = ${sha(POSTS_SRC)}`);
  const postsSrcBefore = sha(POSTS_SRC);
  const overridesBefore = JSON.stringify(readOverrides());

  const { cdp, sessionId, close } = await openBrowser();
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);

  cdp.on((msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      consoleErrors.push(`未捕获异常：${d.exception?.description || d.text}`);
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      const text = msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ');
      /* 撤下之后那一页回 410，浏览器自己会在控制台抱怨一句——那不是我们的错 */
      if (/410|favicon/.test(text)) return;
      consoleErrors.push(`console.error：${text}`);
    }
  });

  /* 页面自己会刷新的那几步（「撤销」放回来 / 恢复成源文件）之后，CDP 的会话会
     短暂地「navigated or closed」。这几下重试一下就好——探针不该因为页面照
     自己的规矩刷新而挂掉。 */
  const evaluate = async (expression, tries = 14) => {
    let last = null;
    for (let i = 0; i < tries; i++) {
      try {
        const res = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
        if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || '页面里抛了异常');
        return res.result.value;
      } catch (err) {
        last = err;
        if (!/navigated or closed|超时/.test(err.message)) throw err;
        await sleep(400);
      }
    }
    throw last;
  };
  const wait = (ms) => sleep(ms);
  /* 等一个条件成立。页面正在自己刷新的那几秒里，CDP 会短暂地报
     「navigated or closed」——那不是失败，从头再等一次。 */
  const waitFor = async (expr, ms = 10000) => {
    let deadline = Date.now() + ms;
    for (let i = 0; i < 120; i++) {
      try {
        if (await evaluate(expr, 2)) return true;
      } catch {
        /* 正在刷：把表往后拨一格再等 */
        deadline = Date.now() + ms;
      }
      if (Date.now() > deadline) return false;
      await sleep(200);
    }
    return false;
  };
  const shot = async (name) => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    const file = join(CHECK, `${name}.png`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    shotCount++;
    return file;
  };
  const goto = async (url) => {
    await cdp.send('Page.navigate', { url }, sessionId);
    await wait(1100);
  };
  const url = (path) => `${BASE}${path}${path.includes('?') ? '&' : '?'}enter=1`;

  const boxOf = (selector, nth = 0, at = 0.5) =>
    evaluate(`(function () {
      var el = document.querySelectorAll(${JSON.stringify(selector)})[${nth}];
      if (!el) return null;
      var r = el.getBoundingClientRect();
      var x = Math.round(r.left + Math.max(4, r.width * ${at}));
      var y = Math.round(r.top + r.height / 2);
      return JSON.stringify({ x: Math.max(2, Math.min(x, window.innerWidth - 3)), y: Math.max(2, Math.min(y, window.innerHeight - 3)), left: r.left, width: r.width, right: r.right });
    })()`).then((v) => (v ? JSON.parse(v) : null));

  /* 光标落在点的那个字上吗？点之前先量**文字本身**的横范围
     （块级元素撑满一行，按元素宽度取样会点进右边的空白里），
     点完再读 window.getSelection() 的偏移。 */
  const caretProbe = async (selector, nth = 0, at = 0.4) => {
    const info = JSON.parse(await evaluate(`(function () {
      var el = document.querySelectorAll(${JSON.stringify(selector)})[${nth}];
      if (!el) throw new Error('caretProbe 找不到 ' + ${JSON.stringify(selector)});
      var node = el.firstChild;
      if (!node || node.nodeType !== 3) throw new Error('这一段不是一段纯文字');
      var r = document.createRange();
      r.selectNodeContents(el);
      var box = r.getBoundingClientRect();
      var y = box.top + box.height / 2;
      var x = box.left + box.width * ${at};
      /* 参照系：每个字自己的盒，找离 x 最近的那一格 */
      var nearest = 0;
      var best = Infinity;
      for (var i = 0; i <= node.length; i++) {
        var cr = document.createRange();
        cr.setStart(node, i); cr.setEnd(node, i);
        var cb = cr.getBoundingClientRect();
        var d = Math.abs(cb.left - x);
        if (d < best) { best = d; nearest = i; }
      }
      return JSON.stringify({ x: Math.round(x), y: Math.round(y), nearest: nearest, len: node.length, text: node.textContent });
    })()`));
    for (const type of ['mousePressed', 'mouseReleased']) {
      await cdp.send('Input.dispatchMouseEvent', { type, x: info.x, y: info.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 }, sessionId);
    }
    await wait(280);
    const caretAt = await evaluate(`(function () {
      var sel = window.getSelection();
      return sel && sel.rangeCount ? sel.getRangeAt(0).startOffset : -1;
    })()`);
    return { ...info, caretAt };
  };

  /* 菜单里那一条「撤下」，按板块 id 找轨道栏里对应的那一格 */
  const railIndexById = async (id) => {
    const at = await evaluate(`(function () {
      var keys = document.querySelectorAll('.rail a.key');
      for (var i = 0; i < keys.length; i++) if ((keys[i].getAttribute('href') || '').indexOf(${JSON.stringify(id)}) > -1) return String(i);
      return '-1';
    })()`);
    return Number(at);
  };

  /* 真右键：CDP 的鼠标事件，浏览器会照规矩派发 contextmenu。
     真事件偶尔会因为坐标落在视口外/刚换过页而没派发出去（那不是我这条
     工作流的毛病），所以补一条兜底：直接派发一次 contextmenu，
     走的是同一个监听器、同一套认身份的逻辑。 */
  const rightClick = async (selector, nth = 0, at = 0.5) => {
    const box = await boxOf(selector, nth, at);
    if (!box) throw new Error(`右键找不到 ${selector}[${nth}]`);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await cdp.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'right', buttons: type === 'mousePressed' ? 2 : 0, clickCount: 1 }, sessionId);
    }
    for (let i = 0; i < 12; i++) {
      if ((await evaluate(`document.querySelectorAll('.ctx .ctx__item').length`)) > 0) return box;
      await sleep(150);
    }
    await evaluate(`(function () {
      var el = document.elementFromPoint(${box.x}, ${box.y}) || document.querySelectorAll(${JSON.stringify(selector)})[${nth}];
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: ${box.x}, clientY: ${box.y}, button: 2 }));
    })()`);
    for (let i = 0; i < 20; i++) {
      if ((await evaluate(`document.querySelectorAll('.ctx .ctx__item').length`)) > 0) return box;
      await sleep(200);
    }
    return box;
  };

  /* 真左键：坐标落在元素上（光标就落在那个字旁边） */
  const clickAt = async (selector, nth = 0, at = 0.5) => {
    const box = await boxOf(selector, nth, at);
    if (!box) throw new Error(`点不到 ${selector}[${nth}]`);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await cdp.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 }, sessionId);
    }
    await wait(260);
    return box;
  };

  const menuLabels = () =>
    evaluate(`JSON.stringify(Array.prototype.map.call(document.querySelectorAll('.ctx .ctx__item'), function (b) { return b.textContent; }))`).then(JSON.parse);
  const clickMenu = (re) =>
    evaluate(`(function () {
      var items = Array.prototype.filter.call(document.querySelectorAll('.ctx .ctx__item'), function (b) { return ${re}.test(b.textContent); });
      if (!items.length) throw new Error('菜单里没有匹配 ${re}');
      items[0].click();
    })()`);
  /* 点工具条上那颗键。**先等它出现**，别一找不到就抛：
     工具条是异步挂上来的（有时还要等上一句提示先收走），抢在前面就会抛，
     而这一抛会把整个探针带崩——崩在中途还会把临时板块留在盘上，
     下一次跑就被多出来的那一格绊倒。这里等不到才抛，抛出去的话就是真的没有。 */
  const clickBtn = async (text) => {
    const there = await waitFor(
      `Array.prototype.some.call(document.querySelectorAll('.rte__btn'), function (x) { return x.textContent === ${JSON.stringify(text)}; })`,
      8000
    );
    if (!there) throw new Error('工具条上没有「' + text + '」');
    await evaluate(`(function () {
      var b = Array.prototype.filter.call(document.querySelectorAll('.rte__btn'), function (x) { return x.textContent === ${JSON.stringify(text)}; })[0];
      b.click();
    })()`);
  };
  const typeInto = async (selector, html, nth = 0) => {
    await evaluate(`(function () {
      var el = document.querySelectorAll(${JSON.stringify(selector)})[${nth}];
      if (!el) throw new Error('typeInto 找不到 ' + ${JSON.stringify(selector)});
      el.innerHTML = ${JSON.stringify(html)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await wait(120);
  };
  const submitAsk = async (value) => {
    if (value !== undefined) {
      await evaluate(`(function () {
        var input = document.querySelector('.keygate input');
        if (!input) throw new Error('「问一句」浮层没有输入框');
        input.value = ${JSON.stringify(value)};
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
    }
    await wait(80);
    await evaluate(`document.querySelector('.keygate form').requestSubmit()`);
    await wait(420);
  };
  const setKey = () => evaluate(`localStorage.setItem('cv01-key', ${JSON.stringify(KEY)})`);
  const dropKey = () => evaluate(`localStorage.removeItem('cv01-key')`);

  /* 自检自己建的那一支板块与那一篇文章。放在 try 外面是为了崩溃时还够得着：
     崩在中途会把它们留在盘上，下一次跑就被绊倒（轨道栏多一格、列表多一条）。 */
  let tmpSection = '';
  let tmpArticle = '';

  try {
    /* ================================================================ 1. 访客 */
    console.log('\n— 1. 访客 —');
    await goto(url('/'));
    await dropKey();
    await goto(url('/'));
    check('访客：没有 [data-edit-toggle] 这颗按钮', (await evaluate(`document.querySelector('[data-edit-toggle]').hidden === true`)));
    check('访客：页面没进编辑模式', (await evaluate(`!document.documentElement.hasAttribute('data-editmode')`)));
    check('访客：轨道栏上一个 [data-gm] 都没有', (await evaluate(`document.querySelectorAll('[data-gm]').length === 0`)));
    await rightClick('.rail a.key', 0);
    check('访客：右键轨道栏一个菜单都不冒出来', (await menuLabels()).length === 0);
    await shot('probe-1-guest');
    check('访客：控制台干净', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));

    /* ================================================================ 2. 站长进来 */
    console.log('\n— 2. 站长：按钮 / 编辑模式 / 点字即改 —');
    consoleErrors.length = 0;
    await setKey();
    await goto(url('/'));
    check('站长：按钮出现了', (await evaluate(`document.querySelector('[data-edit-toggle]').hidden === false`)));
    await evaluate(`document.querySelector('[data-edit-toggle]').click()`);
    await wait(350);
    check('一按就进入编辑模式（html[data-editmode]）', (await evaluate(`document.documentElement.getAttribute('data-editmode') === 'on'`)));
    check('按钮变成「退出编辑」并按下', (await evaluate(`document.querySelector('[data-edit-toggle]').textContent === '退出编辑' && document.querySelector('[data-edit-toggle]').getAttribute('aria-pressed') === 'true'`)));
    const marked = await evaluate(`JSON.stringify({
      rail: document.querySelectorAll('.rail a.key .key__name[data-gm]').length,
      entryName: document.querySelectorAll('.entry__name a[data-gm]').length,
      blurb: document.querySelectorAll('.entry__blurb[data-gm]').length,
      rollHead: document.querySelectorAll('.roll--hero .head .head__name[data-gm]').length,
    })`);
    check('虚线框描到了轨道栏 / 首页索引 / 卷帘轨道头', JSON.parse(marked).rail > 0 && JSON.parse(marked).entryName > 0 && JSON.parse(marked).blurb > 0 && JSON.parse(marked).rollHead > 0, marked);
    /* 空简介 / 空导语那一条要用一支**真正空**的板块来量：
       现有一批板块的 def 都填过，所以临时建一个（收尾时删掉）。
       这也是旧站 globaledit-check 的做法（「自检空板块」）。 */
    const created = await (await fetch(`${BASE}/api/sections`, {
      method: 'POST',
      headers: { 'x-cv01-key': KEY, cookie: 'cv01-enter=1' },
      body: (() => {
        const f = new FormData();
        f.set('name', '自检空板块');
        return f;
      })(),
    })).json();
    const TMP = (tmpSection = created?.section?.id || '');
    check('临时空板块建出来了（def / lede 都是空）', Boolean(TMP) && created.section.def === '' && created.section.lede === '', JSON.stringify(created.section || {}).slice(0, 90));
    /* 建完之后要重取一次页面：首页那份内容在 SSR 时就装配好了 */
    await goto(url('/'));
    await evaluate(`document.querySelector('[data-edit-toggle]').click()`);
    await wait(350);
    check('空板块那一行摆着「＋ 新建简介」', await evaluate(`(function () {
      var b = document.querySelectorAll('.entry__blurb');
      for (var i = 0; i < b.length; i++) {
        var a = b[i].closest('.entry').querySelector('.entry__name a');
        if (a && a.getAttribute('href').indexOf(${JSON.stringify(TMP)}) > -1) return b[i].textContent.indexOf('＋ 新建简介') > -1;
      }
      return false;
    })()`));
    await shot('probe-2-editmode-on');

    /* --- 2a. 点轨道栏的板块名：光标落在点的那个字上 --- */
    const suiyuAt = await railIndexById('suiyu');
    const railCaret = await caretProbe('.rail a.key .key__name', suiyuAt, 0.4);
    check('点轨道栏的板块名：光标落在点的那个字上',
      railCaret.caretAt >= 0 && Math.abs(railCaret.caretAt - railCaret.nearest) <= 1,
      `点在「${railCaret.text}」第 ${railCaret.nearest} 个字，光标在 ${railCaret.caretAt}（共 ${railCaret.len} 字）`);
    check('那一段成了可编辑的，工具条也挂上来了',
      (await evaluate(`document.querySelectorAll('.rail a.key .key__name')[${suiyuAt}].getAttribute('contenteditable') === 'true' && !!document.querySelector('.rte')`)));
    check('板块名这一档不给改字号（那两行字是版式的一部分）',
      (await evaluate(`Array.prototype.filter.call(document.querySelectorAll('.rte__btn'), function (b) { return ['一级','二级','正文','注释'].indexOf(b.textContent) > -1; }).length === 0`)));

    /* 改着的时候点别处的链接：不跳，先问一句（「一段一次」） */
    const beforePath = await evaluate('location.pathname');
    await clickAt('.rail a.key', 0, 0.5);
    await wait(250);
    check('改着这一段时点链接不跳、先问一句', (await evaluate('location.pathname')) === beforePath && /先保存或取消这一段/.test(await evaluate(`(document.querySelector('.studio__toast') || {}).textContent || ''`)), await evaluate('location.pathname'));

    await typeInto('.rail a.key .key__name', '自检改名的板块', suiyuAt);
    await clickBtn('保存');
    await wait(1200);
    const renamed = await evaluate(`document.querySelectorAll('.rail a.key .key__name')[${suiyuAt}].textContent`);
    check('保存之后这一段退出编辑态', (await evaluate(`document.querySelectorAll('.rail a.key .key__name')[${suiyuAt}].getAttribute('contenteditable') !== 'true' && !document.querySelector('.rte')`)));
    const inService = (await api('/api/sections')).data.sections.find((s) => s.name === '自检改名的板块');
    check('服务里存下了新名字（data/sections.json）', inService?.id === 'suiyu', renamed);
    const home = await evaluate(`JSON.stringify({
      index: Array.prototype.filter.call(document.querySelectorAll('.entry__name a'), function (a) { return a.textContent === '自检改名的板块'; }).length,
      rail: Array.prototype.filter.call(document.querySelectorAll('.rail a.key .key__name'), function (n) { return n.textContent === '自检改名的板块'; }).length,
    })`);
    check('首页索引 + 轨道栏都当场跟上了（refreshSite 干旧 sections.js 的活）', JSON.parse(home).index === 1 && JSON.parse(home).rail === 1, home);
    await shot('probe-3-renamed-section');
    const back = await api('/api/sections/suiyu', 'PATCH', { name: '胡盐乱雨集' });
    /* 改回来之后页面上那一格要跟着变：整页重取一次共享内容（refreshSite） */
    await goto(url('/'));
    check('改回来（suiyu → 胡盐乱雨集）',
      back.status === 200 &&
        (await evaluate(`Array.prototype.filter.call(document.querySelectorAll('.rail a.key .key__name'), function (n) { return n.textContent === '胡盐乱雨集'; }).length === 1`)),
      JSON.stringify(back.data).slice(0, 60));

    /* --- 2b. 板块页：点简介改一段 --- */
    await goto(url('/sections/niji'));
    await evaluate(`document.querySelector('[data-edit-toggle]').click()`);
    await wait(350);
    check('板块页：页头板块名 / 简介 / 导语都在名单里',
      (await evaluate(`!!document.querySelector('.sect-head__name[data-gm]') && !!document.querySelector('.sect-head__def[data-gm]') && !!document.querySelector('main .lede[data-gm]')`)));
    await clickAt('.sect-head__def', 0, 0.4);
    await typeInto('.sect-head__def', '自检改过的简介。<br>第二行还在。');
    await clickBtn('保存');
    await wait(1200);
    const defNow = ((await api('/api/sections')).data.sections.find((s) => s.id === 'niji') || {}).def;
    check('简介存进了 data/sections.json（<br> 留着）', defNow === '自检改过的简介。<br>第二行还在。', defNow);
    await api('/api/sections/niji', 'PATCH', { def: '在别人的故事里，过第二遍人生。' });

    /* --- 2b2. 空板块的动态页：导语整段缺失也能新建 --- */
    await goto(url(`/sections/${TMP}`));
    await evaluate(`document.querySelector('[data-edit-toggle]').click()`);
    await wait(350);
    check('空简介摆着「＋ 新建简介」', await evaluate(`(function () {
      var el = document.querySelector('.sect-head__def');
      var chip = el && el.querySelector('.gm-chip');
      return Boolean(chip) && chip.textContent.indexOf('新建简介') > -1;
    })()`));
    check('导语整段缺失：<p class="lede"> 被编辑模式造了出来，也摆着「＋ 新建导语」', await evaluate(`(function () {
      var lede = document.querySelector('main .lede');
      return Boolean(lede) && lede.hasAttribute('data-gm-ghost') && lede.querySelector('.gm-chip') !== null &&
             lede.querySelector('.gm-chip').textContent.indexOf('新建导语') > -1;
    })()`));
    await shot('probe-4-empty-section');
    /* 点「＋ 新建导语」→ 什么都没打就 Esc：chip 要原地补回来 */
    await evaluate(`document.querySelector('main .lede .gm-chip').click()`);
    await wait(320);
    check('点「＋ 新建」：那一行当场变成可编辑的', (await evaluate(`document.querySelector('main .lede').getAttribute('contenteditable') === 'true'`)));
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await wait(500);
    check('一次空新建取消之后：「＋ 新建导语」补了回来',
      (await evaluate(`document.querySelector('main .lede .gm-chip') !== null`)));
    /* 这回真的写 */
    await evaluate(`document.querySelector('main .lede .gm-chip').click()`);
    await wait(300);
    await typeInto('main .lede', '从零新建的一句导语。');
    await clickBtn('保存');
    await wait(1200);
    check('服务里存下了新建的导语',
      ((await api('/api/sections')).data.sections.find((s) => s.id === TMP) || {}).lede === '从零新建的一句导语。',
      ((await api('/api/sections')).data.sections.find((s) => s.id === TMP) || {}).lede);

    /* --- 2c. 文章页：标题内联改（光标落在点的那个字） --- */
    consoleErrors.length = 0;
    await goto(url('/posts/back-row-three'));
    await evaluate(`document.querySelector('[data-edit-toggle]').click()`);
    await wait(350);
    const titleCaret = await caretProbe('.article__title', 0, 0.35);
    check('文章标题点一下就可编辑，光标落在点的那个字附近',
      titleCaret.caretAt >= 0 && Math.abs(titleCaret.caretAt - titleCaret.nearest) <= 1,
      `点在「${titleCaret.text}」第 ${titleCaret.nearest} 个字，光标在 ${titleCaret.caretAt}（共 ${titleCaret.len} 字）`);
    await typeInto('.article__title', '高三教室后排的三个人（自检改过）');
    await clickBtn('保存');
    await wait(1300);
    const postNow = (await api('/api/posts')).data.posts.find((p) => p.slug === 'back-row-three') || {};
    check('文章标题落进了覆盖层（源文件不动）', postNow.title === '高三教室后排的三个人（自检改过）', postNow.title);
    check('文章页大标题 + 标签页当场跟上',
      (await evaluate(`document.querySelector('.article__title').textContent === '高三教室后排的三个人（自检改过）' && document.title.indexOf('高三教室后排的三个人（自检改过）') === 0`)), await evaluate('document.title'));
    await api('/api/articles/back-row-three', 'PATCH', { reset: true });

    /* --- 2d. Esc 退出模式 --- */
    await goto(url('/'));
    await evaluate(`document.querySelector('[data-edit-toggle]').click()`);
    await wait(300);
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await wait(300);
    check('Esc 一次退出模式，虚线全部摘掉、按钮文案还原',
      (await evaluate(`!document.documentElement.hasAttribute('data-editmode') && document.querySelector('[data-gm]') === null && document.querySelector('[data-edit-toggle]').textContent === '全局编辑'`)));

    /* ================================================================ 3. 右键菜单 */
    console.log('\n— 3. 右键菜单：重编辑 / 重命名 / 撤下 / 撤销 —');
    const overridesPre = JSON.stringify(readOverrides());
    const srcPre = sha(POSTS_SRC);
    const railAt = await railIndexById('suiyu');
    await rightClick('.rail a.key', railAt);
    const labels = await menuLabels();
    check('轨道栏右键：两条（重命名 / 撤下）', labels.length === 2, labels.join(' / '));
    check('第一条是「重命名板块…」', /^重命名板块/.test(labels[0] || ''), labels[0] || '');
    check('原生板块那一条说的是「撤下这个板块…」', /^撤下这个板块/.test(labels[1] || ''), labels[1] || '');
    check('菜单拿到焦点了', (await evaluate(`document.activeElement.classList.contains('ctx__item')`)));
    await shot('probe-5-ctx-menu');
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await wait(200);
    check('Esc 收起菜单，焦点回到原来那一项上', (await menuLabels()).length === 0 && (await evaluate(`document.activeElement.classList.contains('key')`)));

    /* --- 3a. 撤下原生板块：覆盖层记一笔 + 那一页 410 + 撤销放回来 --- */
    await rightClick('.rail a.key', railAt);
    await clickMenu('/^撤下这个板块/');
    await wait(300);
    check('撤下前先问一句', (await evaluate(`!!document.querySelector('.keygate') && /撤下板块/.test(document.querySelector('.keygate__title').textContent)`)));
    await submitAsk();
    await wait(1400);
    const ovAfterHide = readOverrides();
    check('data/overrides.json 里落了 sections.suiyu.hidden = true', ovAfterHide?.sections?.suiyu?.hidden === true, JSON.stringify(ovAfterHide.sections || {}));
    check('轨道栏里当场没了', (await evaluate(`Array.prototype.filter.call(document.querySelectorAll('.rail a.key .key__name'), function (n) { return n.textContent === '胡盐乱雨集'; }).length === 0`)));
    const gone = await api('/sections/suiyu');
    check('撤下之后那一页回 410', gone.status === 410, String(gone.status));
    check('轨道栏计数跟着变了（原本 11 格：10 板块 + 1 临时空板块）',
      await waitFor(`document.querySelectorAll('.rail a.key').length === 10`, 4000),
      `${await evaluate(`document.querySelectorAll('.rail a.key').length`)} 格`);
    check('首页索引里那一行也撤走了', (await evaluate(`Array.prototype.filter.call(document.querySelectorAll('.entry__name a'), function (a) { return a.textContent === '胡盐乱雨集'; }).length === 0`)));
    check('提示条上挂着「撤销」', (await evaluate(`!!document.querySelector('.studio__toast-act')`)));
    await shot('probe-6-section-hidden');
    await evaluate(`document.querySelector('.studio__toast-act').click()`);
    /* 「撤销」放回来之后页面自己会刷一次（旧站同一条），等它刷完 */
    check('撤销之后：放回来了（那一页 200、轨道栏里又有它）',
      (await api('/sections/suiyu')).status === 200 &&
        (await waitFor(`Array.prototype.filter.call(document.querySelectorAll('.rail a.key .key__name'), function (n) { return n.textContent === '胡盐乱雨集'; }).length === 1`)));
    check('源文件一个字节没动', sha(POSTS_SRC) === srcPre, sha(POSTS_SRC));
    check('覆盖层回到了撤下之前的样子', JSON.stringify(readOverrides()) === overridesPre, JSON.stringify(readOverrides()).slice(0, 100));

    /* --- 3b. 文章行重命名（归档页） --- */
    await goto(url('/archive'));
    await evaluate(`document.querySelector('[data-edit-toggle]').click()`);
    await wait(300);
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await wait(200);
    await rightClick('.post-row .post-row__title', 2);
    const postMenu = await menuLabels();
    check('文章行右键：重命名 + 撤下', postMenu.length === 2 && /^重命名文章/.test(postMenu[0] || '') && /^撤下这篇文章/.test(postMenu[1] || ''), postMenu.join(' / '));
    const firstSlug = await evaluate(`(function () {
      var a = document.querySelectorAll('.post-row__link')[2];
      return a ? a.getAttribute('href').replace('/posts/', '') : '';
    })()`);
    const beforeTitle = await evaluate(`(function () {
      var links = document.querySelectorAll('.post-row__link');
      var t = links[2] ? links[2].querySelector('.post-row__title') : null;
      return t ? t.textContent : '';
    })()`);
    await clickMenu('/^重命名文章/');
    await wait(300);
    await submitAsk('自检改过的行标题');
    await wait(1400);
    check('改名当场落到那一行上', (await evaluate(`document.querySelectorAll('.post-row__link')[2].querySelector('.post-row__title').textContent === '自检改过的行标题'`)), await evaluate(`document.querySelectorAll('.post-row__link')[2].querySelector('.post-row__title').textContent`));
    const renamedPost = ((await api('/api/posts')).data.posts.find((p) => p.slug === firstSlug) || {}).title;
    check('服务里也是新标题（覆盖层）', renamedPost === '自检改过的行标题', `${firstSlug} → ${renamedPost}`);
    await api(`/api/articles/${firstSlug}`, 'PATCH', { reset: true });
    check('还原：标题回到源文件里的原名', ((await api('/api/posts')).data.posts.find((p) => p.slug === firstSlug) || {}).title === beforeTitle, beforeTitle);

    /* --- 3c. 撤下原生文章：覆盖层记一笔 + 那一页 410 + 撤销放回来 --- */
    const HIDE_SLUG = 'back-row-three';
    await rightClick(`.post-row__link[href$="/posts/${HIDE_SLUG}"] .post-row__title`);
    await clickMenu('/^撤下这篇文章/');
    await wait(300);
    check('撤下文章前先问一句', (await evaluate(`!!document.querySelector('.keygate') && /撤下文章/.test(document.querySelector('.keygate__title').textContent)`)));
    await submitAsk();
    await wait(1500);
    check('data/overrides.json 里落了 posts.back-row-three.hidden = true', readOverrides()?.posts?.[HIDE_SLUG]?.hidden === true, JSON.stringify(readOverrides().posts?.[HIDE_SLUG] || {}));
    check('归档里那一行当场没了', (await evaluate(`document.querySelector('.post-row__link[href$="/posts/${HIDE_SLUG}"]') === null`)));
    check('撤下之后那一页回 410', (await api(`/posts/${HIDE_SLUG}`)).status === 410);
    check('提示条上挂着「撤销」', (await evaluate(`!!document.querySelector('.studio__toast-act')`)));
    await shot('probe-7-post-hidden');
    await evaluate(`document.querySelector('.studio__toast-act').click()`);
    /* 「撤销」放回来之后页面自己会刷一次（旧站同一条），刷完回归档页再看那一行 */
    await wait(2000);
    await goto(url('/archive'));
    check('撤销之后：那一行回来了、那一页也回 200',
      (await api(`/posts/${HIDE_SLUG}`)).status === 200 &&
        (await waitFor(`document.querySelector('.post-row__link[href$="/posts/${HIDE_SLUG}"]') !== null`)));
    check('这一路也没碰源文件', sha(POSTS_SRC) === srcPre, sha(POSTS_SRC));
    check('覆盖层还是自检开跑之前那一份', JSON.stringify(readOverrides()) === overridesPre, JSON.stringify(readOverrides()).slice(0, 100));

    /* --- 3d. 发布过的文章：右键第一条「整篇重编辑…」→ 独立编辑页 ---
       原生文章不摆这一条（它住在 content/posts.mjs 里，整篇重编辑没有落点），
       所以拿一篇真用编辑页写的文章来量：临时建一篇、量完就删。 */
    const made = await api('/api/articles', 'POST', {
      title: '自检：待重编辑的一篇',
      section: 'tongxue',
      date: '2099.01.01',
      blurb: '自检临时建的，量完就删。',
      /* 第二、三行之间只有一个换行，是**软换行**——编辑页预览里它必须变成
         真的断行（breaks: true，见 server/lib/markdown.mjs）。这一篇顺带量这件事。 */
      source: '## 自检正文\n这一篇是临时建的，用来量「整篇重编辑」。\n第二行紧挨着上一行，量的是预览里的换行。\n',
    });
    const TMP_POST = (tmpArticle = made.data?.article?.id || '');
    const TMP_SLUG = made.data?.article?.slug || '';
    check('临时文章建出来了（编辑页写的那种）', made.status === 201 && Boolean(TMP_POST) && Boolean(TMP_SLUG), JSON.stringify(made.data).slice(0, 90));

    await goto(url('/archive'));
    await rightClick(`.post-row__link[href$="/posts/${TMP_SLUG}"] .post-row__title`);
    const runtimeMenu = await menuLabels();
    check('发布过的文章：三条（重编辑 / 重命名 / 删除）', runtimeMenu.length === 3, runtimeMenu.join(' / '));
    check('第一条是「整篇重编辑…」', /^整篇重编辑/.test(runtimeMenu[0] || ''), runtimeMenu[0] || '');
    check('破坏性的那一条仍然在最后', /^删除这篇文章/.test(runtimeMenu[2] || ''), runtimeMenu[2] || '');
    await shot('probe-7b-ctx-reedit');

    await rightClick(`.post-row__link[href$="/posts/${HIDE_SLUG}"] .post-row__title`);
    const nativeMenu = await menuLabels();
    check('原生文章：还是两条（重命名 / 撤下），没有「整篇重编辑…」',
      nativeMenu.length === 2 && nativeMenu.join(' / ').indexOf('重编辑') === -1, nativeMenu.join(' / '));

    await rightClick(`.post-row__link[href$="/posts/${TMP_SLUG}"] .post-row__title`);
    await clickMenu('/^整篇重编辑/');
    check('点下去进了独立编辑页（/editor?id=…）',
      await waitFor(`location.pathname === '/editor' && location.search.indexOf(${JSON.stringify(TMP_SLUG)}) > -1`, 8000),
      await evaluate('location.href'));
    check('稿子整份回填了（标题 / 正文都在）',
      await waitFor(`(function () {
        var t = document.querySelector('[data-title]');
        var s = document.querySelector('[data-source]');
        return Boolean(t && s) && t.value === '自检：待重编辑的一篇' && s.value.indexOf('自检正文') > -1;
      })()`, 8000));
    check('编辑页认得出「正在改这一篇」，也摆着「写新的一篇」',
      (await evaluate(`!!document.querySelector('[data-new]')`)) &&
        /正在改这一篇/.test(await evaluate(`document.querySelector('[data-state]').textContent`)));
    check('「去看这一篇」的链接指着刚发出去的那一页',
      (await evaluate(`(function () { var a = document.querySelector('[data-state] a'); return a ? a.getAttribute('href') : ''; })()`)) === `/posts/${TMP_SLUG}`);

    /* 右栏预览：正文里的单个换行要在预览里断行。
       预览走 POST /api/render，与文章页是同一个渲染器——所以预览里看得见的换行，
       发出去之后页面上也一定看得见；反过来，折成空格的话站长写下的与看到的就对不上了。 */
    const previewBreak = await waitFor(`(function () {
      var box = document.querySelector('[data-previewbox]');
      return !!box && box.innerHTML.indexOf('量「整篇重编辑」。<br>第二行紧挨着上一行') > -1;
    })()`, 8000);
    check('编辑页预览里换行看得见（单个回车就断行）', previewBreak,
      (await evaluate(`(document.querySelector('[data-previewbox]') || {}).innerHTML || ''`)).replace(/\n/g, '\\n').slice(0, 130));
    check('预览里的段落还是段落（没有把两段并成一段）',
      await evaluate(`document.querySelectorAll('[data-previewbox] p').length === 1 &&
        document.querySelectorAll('[data-previewbox] h2').length === 1`));
    await shot('probe-7c2-editor-preview-breaks');
    await shot('probe-7c-editor-from-menu');
    await evaluate(`document.querySelector('[data-new]').click()`);
    check('「写新的一篇」把地址里的 ?id= 摘掉了（不然刷新又回到那一篇）',
      await waitFor(`location.pathname === '/editor' && location.search.indexOf('id=') === -1`, 4000),
      await evaluate('location.search'));

    const delTmp = await api(`/api/articles/${TMP_POST}`, 'DELETE');
    check('临时文章删掉了（收尾）', delTmp.status === 200 && (await api(`/api/articles/${TMP_SLUG}`)).status === 404, String(delTmp.status));

    /* ================================================================ 4. 原生文章正文的富文本 */
    console.log('\n— 4. 正文：富文本 / 覆盖层 / 恢复成源文件 —');
    consoleErrors.length = 0;
    const SLUG = 'back-row-three';
    const srcHashBeforeBody = sha(POSTS_SRC);
    await goto(url(`/posts/${SLUG}`));
    await rightClick('.prose');
    const bodyMenu = await menuLabels();
    check('正文右键：第一条是「编辑正文…」', /^编辑正文/.test(bodyMenu[0] || ''), bodyMenu.join(' / '));
    await clickMenu('/^编辑正文/');
    await wait(400);
    check('正文当场变成可编辑的（点哪儿改哪儿）', (await evaluate(`document.querySelector('.prose').getAttribute('contenteditable') === 'true'`)));
    const groups = await evaluate(`Array.prototype.map.call(document.querySelectorAll('.rte__group'), function (g) { return g.textContent; }).join('|')`);
    check('四档字号都在（一级二级正文注释）', groups.indexOf('一级二级正文注释') > -1, groups);
    check('下划线有青、粉两颗', (await evaluate(`document.querySelectorAll('.rte__btn--cyan, .rte__btn--pink').length === 2`)));
    check('emoji 那一格在', (await evaluate(`!!document.querySelector('.rte__btn--emoji')`)));
    await evaluate(`document.querySelector('.rte__btn--emoji').click()`);
    await wait(250);
    check('点 ☺ 开 emoji 面板（一格常用的）', (await evaluate(`document.querySelectorAll('.rte__emoji .rte__emoji-btn').length`)) === 72, `${await evaluate(`document.querySelectorAll('.rte__emoji .rte__emoji-btn').length`)} 个`);
    await evaluate(`document.querySelector('.rte__btn--emoji').click()`);
    await wait(150);
    check('再点 ☺ 收起来', (await evaluate(`!document.querySelector('.rte__emoji')`)));
    await shot('probe-6-rte');

    /* 第一段：加粗 + 青下划线 + 正文档；顺带确认「一段一次」的选区走向 */
    await evaluate(`(function () {
      var el = document.querySelector('.prose');
      window.__t = el.querySelector('p') || el;
      var r = document.createRange();
      r.selectNodeContents(window.__t);
      var s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
    })()`);
    await clickBtn('B');
    await wait(120);
    check('加粗：落成 <b> / <strong>', await evaluate(`/<(b|strong)>/i.test(document.querySelector('.prose').innerHTML)`));
    await evaluate(`document.querySelector('.rte__btn--cyan').click()`);
    await wait(120);
    check('下划线（青）：带上了 var(--miku)', await evaluate(`/text-decoration-color:\\s*var\\(--miku\\)/.test(document.querySelector('.prose').innerHTML)`));
    await clickBtn('正文');
    await wait(120);
    await clickBtn('保存');
    await wait(1400);
    check('保存之后退出编辑态、工具条收走',
      (await evaluate(`!document.querySelector('.prose').hasAttribute('contenteditable') && !document.querySelector('.rte')`)));
    const ovBody = (readOverrides().posts || {})[SLUG] || {};
    check('data/overrides.json 里 posts.back-row-three.body 带着刚改的那段',
      typeof ovBody.body === 'string' && /<(b|strong)>/i.test(ovBody.body) && /var\(--miku\)/.test(ovBody.body),
      String(ovBody.body || '').slice(0, 90));
    check('正文存的是覆盖层，content/posts.mjs 一个字节没动', sha(POSTS_SRC) === srcHashBeforeBody, sha(POSTS_SRC));
    await goto(url(`/posts/${SLUG}`));
    check('刷新之后页面上看得到那一版（加粗 + 青下划线）',
      await evaluate(`/<(b|strong)>/i.test(document.querySelector('.prose').innerHTML) && /var\\(--miku\\)/.test(document.querySelector('.prose').innerHTML)`));
    await shot('probe-7-body-saved');

    /* --- 4a. 恢复成源文件里的正文 --- */
    await rightClick('.prose');
    const bodyMenu2 = await menuLabels();
    check('改过之后菜单里多一条「恢复成源文件里的正文…」', bodyMenu2.join(' / ').indexOf('恢复成源文件') > -1, bodyMenu2.join(' / '));
    await clickMenu('/恢复成源文件/');
    await wait(300);
    await submitAsk();
    await wait(2400);
    check('恢复之后：覆盖层里没有它了', !((readOverrides().posts || {})[SLUG] || {}).body, JSON.stringify((readOverrides().posts || {})[SLUG] || {}));
    await goto(url(`/posts/${SLUG}`));
    const restoredHtml = await evaluate(`document.querySelector('.prose').innerHTML`);
    check('恢复之后：页面上回到源文件里的正文（没有刚加的粗体）', !/<b>/i.test(restoredHtml), restoredHtml.slice(0, 70));
    check('恢复这一路也没碰源文件', sha(POSTS_SRC) === srcHashBeforeBody, sha(POSTS_SRC));

    /* ================================================================ 5. Esc 语义 */
    console.log('\n— 5. Esc：改过先问一句 —');
    await goto(url(`/posts/${SLUG}`));
    await evaluate(`document.querySelector('[data-edit-toggle]').click()`);
    await wait(350);
    const beforeHtml = await evaluate(`document.querySelector('.prose').innerHTML`);
    await rightClick('.prose');
    await clickMenu('/^编辑正文/');
    await wait(400);
    await evaluate(`(function () {
      var el = document.querySelector('.prose');
      el.innerHTML = '<p>临时乱改的一句</p>';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
    await wait(350);
    check('改过之后 Esc：先问一句「放弃这次修改？」', (await evaluate(`!!document.querySelector('.keygate') && /放弃这次修改/.test(document.querySelector('.keygate__title').textContent)`)));
    const escState = await evaluate(`JSON.stringify({
      editmode: document.documentElement.getAttribute('data-editmode'),
      keygate: !!document.querySelector('.keygate'),
      title: document.querySelector('.keygate__title') ? document.querySelector('.keygate__title').textContent : '-',
      editable: document.querySelector('.prose').getAttribute('contenteditable'),
      toolbar: !!document.querySelector('.rte'),
    })`);
    check('问这一句的时候编辑模式没被顺手关掉（Esc 被浮层吃掉了）',
      JSON.parse(escState).editmode === 'on', escState);
    await evaluate(`document.querySelector('.keygate form').requestSubmit()`);
    await wait(500);
    check('放弃之后回到原样、也不再是可编辑的',
      (await evaluate(`document.querySelector('.prose').innerHTML`)) === beforeHtml && (await evaluate(`!document.querySelector('.prose').hasAttribute('contenteditable')`)));

    /* 一次「一段一次」：改着 A 的时候点 B 不换手 */
    await rightClick('.prose');
    await clickMenu('/^编辑正文/');
    await wait(400);
    await evaluate(`(function () {
      var el = document.querySelector('.prose');
      el.innerHTML = '<p>第二段被改过</p>';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await evaluate(`document.querySelector('.article__title').click()`);
    await wait(300);
    check('一段一次：改着正文时点标题，正文还归自己（标题没变成可编辑的）',
      (await evaluate(`document.querySelector('.prose').getAttribute('contenteditable') === 'true' && !document.querySelector('.article__title').hasAttribute('contenteditable')`)));
    await evaluate(`document.querySelectorAll('.rte__btn')[document.querySelectorAll('.rte__btn').length - 1].click()`);
    await wait(300);
    await evaluate(`document.querySelector('.keygate form').requestSubmit()`);
    await wait(400);
    check('取消掉之后页面回到原样、编辑模式还开着',
      (await evaluate(`!document.querySelector('.rte') && document.documentElement.getAttribute('data-editmode') === 'on'`)));

    /* ================================================================ 6. 收尾 */
    console.log('\n— 6. 收尾 —');
    await goto(url('/'));
    check('全程控制台 0 报错', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
    check('源文件 content/posts.mjs 从头到尾没动', sha(POSTS_SRC) === postsSrcBefore, `${postsSrcBefore} → ${sha(POSTS_SRC)}`);
    const ovNow = JSON.stringify(readOverrides());
    check('覆盖层回到了自检开跑之前', ovNow === overridesBefore, ovNow.slice(0, 120));
    const del = await api(`/api/sections/${TMP}`, 'DELETE');
    check('临时空板块删掉了（收尾）', del.status === 200 && !((await api('/api/sections')).data.sections || []).some((s) => s.id === TMP), JSON.stringify(del.data || {}).slice(0, 60));
    await goto(url('/'));
    await shot('probe-8-final');

    close();
  } catch (err) {
    problems.push(`探针自己挂了：${err.message}`);
    console.error(`\n探针自己挂了：${err.stack || err.message}`);
    /* 崩在中途时，自检建的那一支板块与那一篇文章还在盘上。尽最大努力删掉——
       留着的话下一次跑会量到多出来的一格，报出一个与本次改动无关的假失败。
       删不掉也不该盖住真正的错，所以这里只出声、不抛。 */
    for (const [what, path] of [
      ['临时板块', tmpSection && `/api/sections/${tmpSection}`],
      ['临时文章', tmpArticle && `/api/articles/${tmpArticle}`],
    ]) {
      if (!path) continue;
      try {
        const res = await api(path, 'DELETE');
        console.error(`  （收尾）${what}删掉了：HTTP ${res.status}`);
      } catch {
        console.error(`  （收尾）${what}没删掉，下次跑之前手动清一下：${path}`);
      }
    }
    close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n截图 ${shotCount} 张在 .check/`);
  console.log(`${results.length - failed.length}/${results.length} 项通过`);
  if (problems.length) {
    console.log('\n没过的：');
    for (const p of problems) console.log(`  !! ${p}`);
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(`探针自己挂了：${err.stack || err.message}`);
  process.exit(2);
});

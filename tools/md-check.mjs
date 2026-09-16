/* ==========================================================================
   tools/md-check.mjs · Markdown / 公式 / emoji 的自检
   ---------------------------------------------------------------------------
   两块：

   一、接口这一层（不改任何数据，全走 /api/render）
     · marked 的 GFM：六档标题、表格、任务列表、删除线、嵌套列表、围栏代码（带语言）、
       自动链接、图片、引用、分隔线、行内 HTML
     · 公式：$…$、$$…$$、\(…\)、\[…\] 都变成 KaTeX 的 HTML；写坏的公式是红字不是崩
     · 代码块里的 :smile: 与 $x$ **不许**被换掉（那是代码，不是正文）
     · emoji 短代码：:smile: → 😄，认不出来的原样留着
     · 本地库与许可证在位（marked / katex / 字体），tokens.css 里有 emoji 字体栈

   二、浏览器这一层
     · 建一篇带公式与表格的运行时文章 → 打开那一页：KaTeX 真渲染了、样式表挂上了、
       控制台干净 → 删掉（跑完不留痕）
     · 页面上直接改字时，工具条里那个 emoji 面板点得开、点一下能插进正文，
       取消之后正文一个字没变

   用法（服务要先跑起来）：
     node server/server.mjs 4399
     node tools/md-check.mjs            # 默认 http://127.0.0.1:4399
   ========================================================================== */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = process.argv[2] || 'http://127.0.0.1:4399';
const PORT = 9933 + Math.floor(Math.random() * 200);
const SHOTS = join(ROOT, '.check');

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));

if (!CHROME) {
  console.error('没找到 Chrome 或 Edge，跳过浏览器那一段');
  process.exit(0);
}

const key = (() => {
  try { return JSON.parse(readFileSync(join(ROOT, 'data', 'settings.json'), 'utf8')).passphrase || ''; } catch { return ''; }
})();
if (!key) {
  console.error('data/settings.json 里还没有口令。先跑一次 node server/server.mjs。');
  process.exit(1);
}

const results = [];
const problems = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) problems.push(`${name} ${detail}`);
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

/* ---------------------------------------------------------- 一、接口那一层 */

const SRC = [
  '# 一级标题',
  '## 二级标题',
  '### 三级标题',
  '#### 四级标题',
  '##### 五级标题',
  '###### 六级标题',
  '',
  '段落里有 **粗体**、*斜体*、***又粗又斜***、`行内代码`、~~划掉~~，还有 emoji：:smile: :tada: :nope:',
  '',
  '行内代码里的 $x^2$ 与 :smile: 也不该被动：`$x^2$ 与 :smile:`',
  '',
  '链接：[文字](https://example.com/a "带标题")，自动链接：https://example.com/b，后面这句不该被吞掉。',
  '',
  '尖括号链接：<https://example.com/c>',
  '',
  '![一张图](/media/images/x.png "图")',
  '',
  '> 引用一行',
  '>',
  '> > 套一层引用',
  '',
  '- 第一项',
  '  - 嵌套一项',
  '    - 再嵌一层',
  '- [x] 做完的事',
  '- [ ] 没做的事',
  '',
  '3. 从三开始',
  '4. 第四',
  '',
  '| 左 | 中 | 右 |',
  '|:---|:--:|---:|',
  '| a | b | c |',
  '',
  '```js',
  'const s = ":smile: 与 $x^2$ 在代码里应当原样";',
  '```',
  '',
  '    $indented$ code',
  '',
  '---',
  '',
  '行内公式 $E = mc^2$，下标不被 Markdown 吃掉：$x_1 + x_2$，独立公式：',
  '',
  '$$',
  '\\int_0^1 x^2 \\, dx = \\frac{1}{3}',
  '$$',
  '',
  '另一种写法 \\(a^2 + b^2 = c^2\\) 与 \\[\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}\\]',
  '',
  '写坏的公式 $\\frac{a}{$ 也不该把这一页弄崩。',
  '',
  '<video src="/media/videos/x.mp4" controls></video>',
].join('\n');

const rendered = await api('/api/render', 'POST', { source: SRC });
if (rendered.status !== 200) {
  console.error('调 /api/render 失败：', rendered.status, JSON.stringify(rendered.data).slice(0, 200));
  process.exit(1);
}
const html = String(rendered.data.html || '');
const has = (needle) => html.includes(needle);
const re = (rx) => rx.test(html);

check('六档标题都在', ['<h1>一级标题</h1>', '<h2>二级标题</h2>', '<h3>三级标题</h3>', '<h4>四级标题</h4>', '<h5>五级标题</h5>', '<h6>六级标题</h6>'].every(has));
check('强调：粗 / 斜 / 又粗又斜 / 行内代码', has('<strong>粗体</strong>') && has('<em>斜体</em>') && re(/<em><strong>又粗又斜<\/strong><\/em>|<strong><em>又粗又斜<\/em><\/strong>/) && has('<code>行内代码</code>'));
check('删除线', has('<del>划掉</del>'));
check('链接（带标题）/ 裸链接 / 尖括号链接', has('href="https://example.com/a" title="带标题"') && has('href="https://example.com/b"') && has('href="https://example.com/c"'));
check('裸链接后面跟着的中文不该被吞进地址里',
  has('<a href="https://example.com/b">https://example.com/b</a>，后面这句不该被吞掉。'),
  (html.match(/<a href="https:\/\/example\.com\/b"[^>]*>[^<]*<\/a>[^<]{0,12}/) || [''])[0]);
check('图片（带 alt 与标题）', re(/<img[^>]+alt="一张图"[^>]*>/) && has('x.png'));
check('引用（含嵌套）', re(/<blockquote>[\s\S]*<blockquote>[\s\S]*<\/blockquote>[\s\S]*<\/blockquote>/));
check('列表：嵌套两层', re(/<ul>\s*<li>第一项\s*<ul>\s*<li>嵌套一项\s*<ul>/));
check('任务列表：勾与未勾', has('type="checkbox"') && has('checked') && re(/<li><input checked="?"[^>]*type="checkbox"[^>]*> 做完的事/));
check('有序列表：从 3 开始', has('<ol start="3">'));
check('表格：表头 + 对齐', has('<table>') && has('<thead>') && has('<th') && re(/align="center"|style="text-align: ?center"/));
check('围栏代码：带语言类名', has('<code class="language-js">'));
check('缩进代码块', re(/<pre><code>\$indented\$ code\s*<\/code><\/pre>/));
check('分隔线', has('<hr>'));
check('行内 HTML 原样放行（视频）', has('<video src="/media/videos/x.mp4" controls></video>'));

check('行内公式渲染成 KaTeX', has('class="katex"') && !has('$E = mc^2$'));
check('独立公式渲染成 KaTeX 的 display 模式', has('katex-display'));
check('\\(…\\) 与 \\[…\\] 也认', re(/class="katex"/) && !has('\\(') && !has('\\['));
check('写坏的公式给红字而不是崩掉', has('katex-error'));
check('公式里的分式真的排出来了（<span class="mfrac">）', has('mfrac'));
check('行内代码里的 $x^2$ 与 :smile: 原样不动', has('<code>$x^2$ 与 :smile:</code>'));
check('代码块里的 :smile: 与 $x^2$ 原样不动', has(':smile: 与 $x^2$ 在代码里应当原样'));
check('公式里的下标没被 Markdown 吃掉', has('x_1 + x_2') && !re(/x<em>1|1<\/em>/));

check('emoji 短代码：:smile: → 😄', has('😄') && !has(':smile: :tada:'));
check('emoji 短代码：:tada: → 🎉', has('🎉'));
check('认不出来的短代码原样留着', has(':nope:'));

/* 本地库与许可证 */
const V = join(ROOT, 'assets', 'vendor');
check('marked 在位（本地）', existsSync(join(V, 'marked', 'marked.esm.js')));
check('katex 在位（本地）', existsSync(join(V, 'katex', 'katex.mjs')) && existsSync(join(V, 'katex', 'katex.min.css')));
const fontCount = existsSync(join(V, 'katex', 'fonts')) ? readdirSync(join(V, 'katex', 'fonts')).filter((f) => f.endsWith('.woff2')).length : 0;
check('katex 字体在本地（woff2）', fontCount >= 20, `${fontCount} 个`);
check('两个许可证都在', existsSync(join(V, 'marked', 'LICENSE')) && existsSync(join(V, 'katex', 'LICENSE')));
const tokens = readFileSync(join(ROOT, 'assets', 'css', 'tokens.css'), 'utf8');
check('字体栈里有 emoji 字体', /Segoe UI Emoji/.test(tokens) && /Apple Color Emoji/.test(tokens));

/* ---------------------------------------------------------- 二、浏览器那一层 */

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
    } catch { /* 忽略 */ }
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

const profile = join(tmpdir(), `cv01-md-${randomBytes(4).toString('hex')}`);
mkdirSync(SHOTS, { recursive: true });
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', '--mute-audio',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1280,900', 'about:blank',
], { stdio: 'ignore', detached: false });

let cdp;
let madeArticleId = '';

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
      const url = msg.params.entry.url || '';
      /* 正文里那张图与那段视频是自检故意写的假地址，404 是预期的 */
      if (/favicon|410|\/media\/(images|videos)\/x\./.test(text + url)) return;
      consoleErrors.push(`${text} ${url}`);
    }
  });

  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || '求值失败');
    return res.result.value;
  };
  const wait = (ms) => evaluate(`new Promise(r => setTimeout(r, ${ms}))`);
  const goto = async (url) => {
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
  };
  const shot = async (name) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(data, 'base64'));
  };
  async function rightClick(selector) {
    const box = JSON.parse(await evaluate(`(function () {
      var el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'null';
      var r = el.getBoundingClientRect();
      return JSON.stringify({ x: Math.round(r.left + Math.min(24, r.width / 2)), y: Math.round(r.top + r.height / 2) });
    })()`));
    if (!box) throw new Error(`右键找不到 ${selector}`);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', {
        type, x: box.x, y: box.y, button: 'right', buttons: type === 'mousePressed' ? 2 : 0, clickCount: 1,
      });
    }
    await wait(450);
  }

  /* 建一篇带公式与表格的运行时文章，量真实页面 */
  const created = await api('/api/articles', 'POST', {
    title: '自检：公式与表格',
    section: 'suiyu',
    date: '2026.01.02',
    min: 3,
    short: '公式',
    blurb: '自检用，跑完就删。',
    source: SRC,
  });
  madeArticleId = created.data && created.data.article ? created.data.article.id : '';
  const slug = created.data && created.data.article ? created.data.article.slug : '';
  check('临时文章建出来了', Boolean(madeArticleId && slug), JSON.stringify(created.data).slice(0, 120));

  await goto(`${SITE}/index.html?enter=1`);
  await evaluate(`localStorage.setItem('cv01-key', ${JSON.stringify(key)})`);
  await goto(`${SITE}/posts/${slug}.html`);
  check('文章页真渲染了公式', await evaluate(`document.querySelectorAll('.prose .katex').length >= 4`),
    `katex=${await evaluate(`document.querySelectorAll('.prose .katex').length`)}`);
  check('独立公式是 display 模式（两块）', await evaluate(`document.querySelectorAll('.prose .katex-display').length === 2`),
    `display=${await evaluate(`document.querySelectorAll('.prose .katex-display').length`)}`);
  check('带了 KaTeX 的样式表', await evaluate(`!!document.querySelector('link[href$="katex.min.css"]')`));
  check('KaTeX 的 CSS 真的生效了（有 .katex 的规则）',
    await evaluate(`Array.prototype.some.call(document.styleSheets, function (s) { try { return /katex/.test(s.href || ''); } catch (e) { return false; } })`));
  check('表格 / 任务列表 / emoji 都在页面上',
    (await evaluate(`!!document.querySelector('.prose table')`)) &&
    (await evaluate(`!!document.querySelector('.prose input[type="checkbox"]')`)) &&
    (await evaluate(`/😄|🎉/.test(document.querySelector('.prose').textContent)`)));
  check('文章页控制台干净', consoleErrors.length === 0, consoleErrors.join(' | '));
  await shot('md-article');

  /* 页面上直接改字：emoji 面板点得开、点一下插进去、取消之后一个字没变 */
  await goto(`${SITE}/posts/rainy-day.html`);
  const before = await evaluate(`document.querySelector('.prose').innerHTML`);
  await rightClick('.prose');
  await evaluate(`document.querySelectorAll('.ctx .ctx__item')[0].click()`);
  await wait(320);
  check('工具条里有 emoji 那颗', await evaluate(`!!document.querySelector('.rte__btn--emoji')`));
  await evaluate(`document.querySelector('.rte__btn--emoji').click()`);
  await wait(200);
  const pickerCount = await evaluate(`document.querySelectorAll('.rte__emoji .rte__emoji-btn').length`);
  check('emoji 面板打开了（64 个上下）', pickerCount >= 60, `${pickerCount} 个`);
  await shot('md-emoji-picker');
  /* 把光标放到正文里，再点一个 emoji */
  await evaluate(`(function () {
    var el = document.querySelector('.prose');
    el.focus();
    var range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    var sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  })()`);
  const firstEmoji = await evaluate(`document.querySelector('.rte__emoji .rte__emoji-btn').textContent`);
  await evaluate(`document.querySelector('.rte__emoji .rte__emoji-btn').click()`);
  await wait(150);
  check('点一下就插进正文了',
    await evaluate(`document.querySelector('.prose').textContent.indexOf(${JSON.stringify(firstEmoji)}) > -1`),
    firstEmoji);
  check('插进去之后正文确实变了', (await evaluate(`document.querySelector('.prose').innerHTML`)) !== before);
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await wait(300);
  await evaluate(`(function () {
    var b = Array.prototype.filter.call(document.querySelectorAll('.keygate form button'), function (x) { return /放弃/.test(x.textContent); })[0];
    if (b) b.click();
  })()`);
  await wait(300);
  check('取消之后正文一个字没变', (await evaluate(`document.querySelector('.prose').innerHTML`)) === before);
  check('全程控制台干净', consoleErrors.length === 0, consoleErrors.join(' | '));
} catch (err) {
  problems.push(`自检脚本本身出错：${err.message}`);
} finally {
  if (madeArticleId) {
    try { await api(`/api/articles/${madeArticleId}`, 'DELETE'); } catch { /* 服务可能已经关了 */ }
  }
  if (cdp) cdp.close();
  try { chrome.kill(); } catch { /* 已经退了 */ }
  await new Promise((r) => setTimeout(r, 400));
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* Windows 有时候还锁着 */ }
}

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? '  ok  ' : '  XX  '} ${r.name}${r.detail ? '  — ' + r.detail : ''}`);
}
for (const p of problems) console.log(`  !!  ${p}`);
console.log('');
console.log(`  ${results.length - failed}/${results.length} 项通过，截图在 .check/`);
process.exit(failed ? 1 : 0);

/* ==========================================================================
   tools/nuxt-check.mjs · Nuxt 应用的浏览器自检
   ---------------------------------------------------------------------------
   旧站那一批自检（dom-check / edit-check / globaledit-check…）都盯着「生成出来的
   HTML + 挂在它上面的一堆 IIFE」，换了 Vue 之后那些选择器与页面地址都不成立了。
   这一份是给新应用用的：真的开一个无头 Chrome，一页一页走，看控制台有没有报错，
   再点几下确认交互还活着。

   不装 puppeteer：直接用 Node 自带的 WebSocket 跟 Chrome 的调试端口说话
   （CDP）。仍然零依赖，与仓库里那批老自检同一条底线。

   用法：
     pnpm exec nuxt build                       # 或 nuxt dev
     $env:PORT=3987; node .output/server/index.mjs
     node tools/nuxt-check.mjs http://127.0.0.1:3987
   截图落在 .check/（已在 .gitignore 里）。
   ========================================================================== */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = join(ROOT, '.check');
const BASE = (process.argv[2] || 'http://127.0.0.1:3987').replace(/\/+$/, '');
const SHOT = process.argv.includes('--shot');

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fetchJson = async (url, init) => {
  const res = await fetch(url, init);
  return await res.json();
};

/* ------------------------------------------------------------------ 浏览器 */
async function openBrowser() {
  const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!chrome) throw new Error('找不到 Chrome 或 Edge');
  const port = 9500 + Math.floor(Math.random() * 400);
  const profile = join(tmpdir(), `cv01-nuxt-check-${randomBytes(4).toString('hex')}`);
  const proc = spawn(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      `--remote-debugging-port=${port}`,
      '--remote-allow-origins=*',
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  let version = null;
  for (let i = 0; i < 60 && !version; i++) {
    try {
      version = await fetchJson(`http://127.0.0.1:${port}/json/version`);
    } catch {
      await sleep(250);
    }
  }
  if (!version) {
    proc.kill();
    throw new Error('Chrome 的调试端口没有起来');
  }

  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('连不上 Chrome 的调试端口')), { once: true });
  });

  const cdp = new Cdp(ws);
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

  const close = () => {
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
      /* Windows 上偶尔还占着，留着也无妨（在 tmp 里） */
    }
  };

  return { cdp, sessionId, close };
}

/* 开一页、等它停下来，把控制台报错与未捕获异常收在一起 */
async function visit(cdp, sessionId, url) {
  const errors = [];
  const onEvent = (msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      errors.push(`未捕获异常：${d.exception?.description || d.text}`);
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push(`console.error：${msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ')}`);
    }
  };
  cdp.on(onEvent);

  await cdp.send('Page.navigate', { url }, sessionId);
  /* 页面停下 + 一点余量：SSR 之后还有挂载与首屏定时器（扫光最多 2.2s） */
  await sleep(2600);

  const evaluate = async (expression) => {
    const res = await cdp.send(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true },
      sessionId
    );
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || '页面里抛了异常');
    return res.result.value;
  };

  const screenshot = async (name) => {
    if (!SHOT) return;
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    writeFileSync(join(CHECK, `${name}.png`), Buffer.from(data, 'base64'));
  };

  return { errors, evaluate, screenshot };
}

/* ------------------------------------------------------------------ 用例 */
const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✓' : '✗'}  ${name}${detail ? `  —— ${detail}` : ''}`);
};

async function main() {
  mkdirSync(CHECK, { recursive: true });
  const { cdp, sessionId, close } = await openBrowser();
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);

  try {
    /* 先盖一枚门厅的章（?enter=1 由服务盖章再送回干净地址）：跑自检的这个浏览器
       要是没有章，后面每一页都会被送回门厅。门厅关着的时候这一步什么也不做。 */
    await cdp.send('Page.navigate', { url: `${BASE}/?enter=1` }, sessionId);
    await sleep(1200);

    /* 每一页都开一遍：控制台干净、该有的东西都在 */
    const routes = [
      ['/', ['aside.epigraph', 'header.bar', 'nav.rail', '.roll--hero', 'ol.entry-list', 'div.studio']],
      ['/archive', ['.sect-head__name', '.year', '.post-row']],
      ['/sections/niji', ['.roll--strip', '.sect-head__name', '.post-list']],
      ['/posts/lru', ['.roll--strip', 'article.article', '.prose', 'nav.pager']],
      ['/about', ['.spec__row', '.swatch']],
      ['/login', ['main.gate', '.gate-key--visitor', '.gate-key--owner']],
    ];

    for (const [path, selectors] of routes) {
      const { errors, evaluate, screenshot } = await visit(cdp, sessionId, BASE + path);
      const slug = path === '/' ? 'home' : path.replace(/\//g, '-').replace(/^-/, '');
      await screenshot(`nuxt${slug === 'home' ? '-home' : `-${slug}`}`);
      const missing = await evaluate(
        `${JSON.stringify(selectors)}.filter((s) => !document.querySelector(s))`
      );
      ok(`${path} 控制台干净`, errors.length === 0, errors.slice(0, 2).join(' | '));
      ok(`${path} 该有的都在`, missing.length === 0, missing.join(' '));
    }

    /* 主题按钮：点一下要真的切过去，并记住 */
    {
      const { errors, evaluate } = await visit(cdp, sessionId, BASE + '/');
      const before = await evaluate(`document.documentElement.getAttribute('data-theme')`);
      await evaluate(`document.querySelector('[data-theme-toggle]').click()`);
      await sleep(400);
      const after = await evaluate(`document.documentElement.getAttribute('data-theme')`);
      const saved = await evaluate(`localStorage.getItem('cv01-theme')`);
      ok('主题按钮切换并记住', before !== after && saved === after, `${before} → ${after} / 记住 ${saved}`);
      ok('主题这一页没有报错', errors.length === 0, errors.slice(0, 2).join(' | '));
    }

    /* 卷帘扫光：挂载之后音符该陆续点亮 */
    {
      const { evaluate } = await visit(cdp, sessionId, BASE + '/');
      const lit = await evaluate(`document.querySelectorAll('.roll--hero .note.is-lit').length`);
      const all = await evaluate(`document.querySelectorAll('.roll--hero .note').length`);
      ok('卷帘音符点亮', lit > 0, `${lit}/${all}`);
      const month = await evaluate(`document.querySelectorAll('.roll__month').length`);
      ok('卷帘月份刻度在', month > 0, `${month} 块`);
    }

    /* 每日一句：挂载之后换成今天那一句（title 里带着日期种子） */
    {
      const { evaluate } = await visit(cdp, sessionId, BASE + '/');
      const text = await evaluate(`document.querySelector('[data-excerpt]').textContent.trim()`);
      const title = await evaluate(`document.querySelector('[data-excerpt]').getAttribute('title')`);
      ok('每日一句换成了今天那句', /本地日期 \d{8}/.test(title || '') && text.length > 0, title || '(没有 title)');
    }

    /* 门厅：点「站长登录」要展开口令那一行（Vue 改 DOM 是异步的，点完等一拍再读） */
    {
      const { errors, evaluate, screenshot } = await visit(cdp, sessionId, BASE + '/login');
      await screenshot('nuxt-login-gate');
      const before = await evaluate(`document.querySelector('[data-pass]').hidden`);
      await evaluate(`document.querySelector('[data-owner]').click()`);
      await sleep(300);
      const after = await evaluate(`({
        hidden: document.querySelector('[data-pass]').hidden,
        expanded: document.querySelector('[data-owner]').getAttribute('aria-expanded'),
        focused: document.activeElement === document.querySelector('[data-pass-input]'),
      })`);
      ok(
        '门厅：站长键展开口令行',
        before === true && after.hidden === false && after.expanded === 'true',
        JSON.stringify({ before, ...after })
      );
      ok('门厅这一页没有报错', errors.length === 0, errors.slice(0, 2).join(' | '));
    }
  } finally {
    close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
  if (SHOT) console.log(`截图在 .check/`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(`自检自己挂了：${err.message}`);
  process.exit(2);
});

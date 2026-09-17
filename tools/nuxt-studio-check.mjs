/* ==========================================================================
   tools/nuxt-studio-check.mjs · Nuxt 应用的「悬浮球工作流」浏览器验收
   ---------------------------------------------------------------------------
   旧站那一批自检（dom-check / upload-check / editor-check…）盯的是「生成出来的
   HTML + 挂在上面的一堆 IIFE」，那套页面已经随 1.x 静态线一起删掉了。这一份是
   它们的接任者：对着**真浏览器 + 真服务 + 真文件**量悬浮球这条工作流（42 项断言）。

   它覆盖什么（每一段都断言并截图）：
     1) 服务在 → 两颗球出现；?open=music 面板打开；曲库 6 首列出来
     2) 自动播放被拦 → 粉灯亮；第一个手势之后接着放
     3) 播放/暂停真的动
     4) 没有口令：站长球不摆任何写操作按钮，点它弹口令框
     5) 口令到手（走口令框那条路）→ 站长工具箱三选一菜单出现；音乐盒多出 换/改名/删
     6) 新建板块真的建出来（随后由脚本删掉）
     7) 传一个小音频 → 落进 media/music 并进曲库；换歌 → 改名 → 删歌（文件也走）
   全程控制台 0 报错，收尾把新建的板块与上传的文件都清掉。

   怎么跑（先构建再起成品服务）：
     pnpm install && pnpm build
     $env:PORT='3987'; node .output/server/index.mjs      # 另开一个窗口，仓库根目录
     $env:CV01_KEY = (…)                                  # 见下
     node tools/nuxt-studio-check.mjs http://127.0.0.1:3987

   口令从环境变量 CV01_KEY 里读，**绝不打印、绝不写进任何文件**（AGENTS.md 与
   任务书的数据安全一节）。取一条现成的而不把它打到屏幕上：
     $lines = (node tools/set-passphrase.mjs --print) -split "`r?`n"
     $env:CV01_KEY = (($lines | Where-Object { $_ -match '^口令' }) -replace '^口令\s*','').Trim()

   零依赖：用 Node 自带的 WebSocket 跟 Chrome 的调试端口说话（CDP），与
   tools/nuxt-check.mjs 是同一套做法。截图落在 .check/（已在 .gitignore 里）。
   ========================================================================== */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = join(ROOT, '.check');
const BASE = (process.argv[2] || 'http://127.0.0.1:3987').replace(/\/+$/, '');
const KEY = String(process.env.CV01_KEY || '');
const MUSIC_DIR = join(ROOT, 'media', 'music');

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];

/* ------------------------------------------------------------------ CDP 助手 */
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
      }, 60000);
    });
  }

  on(fn) {
    this.listeners.push(fn);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openBrowser() {
  const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!chrome) throw new Error('找不到 Chrome 或 Edge');
  const port = 9600 + Math.floor(Math.random() * 300);
  const profile = join(tmpdir(), `cv01-studio-probe-${randomBytes(4).toString('hex')}`);
  const proc = spawn(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--autoplay-policy=document-user-activation-required',
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
      version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
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
    try { ws.close(); } catch { /* 收尾 */ }
    try { proc.kill(); } catch { /* 同上 */ }
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* Windows 上偶尔还占着 */ }
  };

  return { cdp, sessionId, close };
}

/* ------------------------------------------------------------------ 断言 */
const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✓' : '✗'}  ${name}${detail ? `  —— ${detail}` : ''}`);
};

/* ------------------------------------------------------------------ 小音频
   真的能放的 8kHz 单声道 8bit PCM WAV（几百毫秒）。服务端按后缀认音频，
   浏览器也解得开——所以不会触发「这首放不出来」那条错误路径。 */
function writeTone(path, freq, seconds) {
  const rate = 8000;
  const n = Math.floor(rate * seconds);
  const data = Buffer.alloc(n);
  for (let i = 0; i < n; i++) {
    const v = Math.sin((2 * Math.PI * freq * i) / rate);
    data[i] = Math.max(0, Math.min(255, Math.round(128 + v * 100)));
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + n, 4);
  head.write('WAVE', 8);
  head.write('fmt ', 12);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate, 28);
  head.writeUInt16LE(1, 32);
  head.writeUInt16LE(8, 34);
  head.write('data', 36);
  head.writeUInt32LE(n, 40);
  writeFileSync(path, Buffer.concat([head, data]));
}

const api = async (path, options = {}) => {
  const res = await fetch(BASE + path, options);
  let body = null;
  try { body = await res.json(); } catch { /* 不是 JSON */ }
  return { status: res.status, body };
};
const musicFiles = () => readdirSync(MUSIC_DIR);
const musicLibrary = async () => (await api('/api/music')).body?.tracks || [];
const sectionList = async () => (await api('/api/sections')).body?.sections || [];

/* ------------------------------------------------------------------ 主流程 */
async function main() {
  if (!KEY) throw new Error('没有口令：$env:CV01_KEY = (node tools/set-passphrase.mjs --print)');
  mkdirSync(CHECK, { recursive: true });

  const toneA = join(CHECK, 'studio-tone-a.wav');
  const toneB = join(CHECK, 'studio-tone-b.wav');
  writeTone(toneA, 440, 0.4);
  writeTone(toneB, 660, 0.4);

  const beforeFiles = musicFiles();
  const beforeTracks = await musicLibrary();
  console.log(`\n起点：media/music 里 ${beforeFiles.length} 个文件 · 曲库 ${beforeTracks.length} 首\n`);
  ok('起点曲库 6 首', beforeTracks.length === 6, `${beforeTracks.length} 首`);

  const { cdp, sessionId, close } = await openBrowser();
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Log.enable', {}, sessionId);
  await cdp.send('DOM.enable', {}, sessionId);
  await cdp.send(
    'Emulation.setDeviceMetricsOverride',
    { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false },
    sessionId
  );

  /* 控制台错误（Runtime）与浏览器日志（Log）分开收：
     没有口令时那几次 401 是**预期的边界**，会以 network error 的形式出现在 Log 里，
     它不是代码错误——所以「控制台干净」按 nuxt-check 的口径只算 Runtime。 */
  const consoleErrors = [];
  const netLogs = [];
  cdp.on((msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      consoleErrors.push(`未捕获异常：${d.exception?.description || d.text}`);
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(`console.error：${msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ')}`);
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      netLogs.push(`${msg.params.entry.source}: ${msg.params.entry.text}`);
    }
  });

  let phase = '';
  const errorsSince = () => consoleErrors.length;

  const evaluate = async (expression, userGesture = false) => {
    const res = await cdp.send(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true, userGesture },
      sessionId
    );
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || '页面里抛了异常');
    return res.result.value;
  };

  const screenshot = async (name) => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    writeFileSync(join(CHECK, `${name}.png`), Buffer.from(data, 'base64'));
  };

  const clickPoint = async (x, y) => {
    const base = { x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 };
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...base }, sessionId);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base }, sessionId);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base }, sessionId);
  };

  const rectOf = async (selector, what = '') => {
    const box = await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
    })()`);
    if (!box || !box.w) throw new Error(`找不到可点的 ${selector}${what ? `（${what}）` : ''}`);
    return box;
  };

  const clickSelector = async (selector, what = '') => {
    const box = await rectOf(selector, what);
    await clickPoint(box.x, box.y);
    await sleep(320);
    return box;
  };

  const setValue = async (selector, value) => {
    await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('没有 ' + ${JSON.stringify(selector)});
      el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return el.value;
    })()`);
  };

  const navigate = async (path, wait = 2600) => {
    await cdp.send('Page.navigate', { url: BASE + path }, sessionId);
    await sleep(wait);
  };

  try {
    /* 门厅盖章（新 profile 没有那枚 cookie），随后才看得到站内页面 */
    await navigate('/?enter=1', 1200);

    /* ---------------------------------------------------------- 1. 球与面板 */
    phase = '1 球与面板';
    let errors = errorsSince();
    await navigate('/?open=music', 3200);

    const home = await evaluate(`(() => {
      const studio = document.querySelector('.studio');
      const panel = document.querySelector('.studio__panel');
      const ball = document.querySelector('[data-ball="music"]');
      const audio = document.querySelector('[data-bgm]');
      const dot = document.querySelector('.ball--music .ball__dot');
      return {
        studioHidden: studio.hidden,
        studioDisplay: getComputedStyle(studio).display,
        ballVisible: ball.getBoundingClientRect().width > 0,
        panelHidden: panel.hidden,
        panelText: panel.textContent.replace(/\\s+/g, ' ').slice(0, 60),
        items: document.querySelectorAll('.mp-item').length,
        count: ball.getAttribute('data-count'),
        title: ball.getAttribute('data-title'),
        eyebrow: (document.querySelector('.mp__eyebrow') || {}).textContent,
        dotOpacity: dot ? getComputedStyle(dot).opacity : '',
        blockedClass: ball.classList.contains('is-blocked'),
        playingClass: ball.classList.contains('is-playing'),
        paused: audio.paused,
        src: audio.getAttribute('src'),
        currentTime: audio.currentTime,
        hasAudio: Boolean(audio),
      };
    })()`);
    ok('服务在：工作台不再 hidden', home.studioHidden === false && home.studioDisplay !== 'none', JSON.stringify({ hidden: home.studioHidden, display: home.studioDisplay }));
    ok('音乐球摆出来了', home.ballVisible, `data-count=${home.count} data-title=${home.title}`);
    ok('?open=music 深链把面板打开了', home.panelHidden === false && home.items === 6, `items=${home.items} · ${home.panelText}`);
    ok('曲库 6 首列了出来', home.items === 6 && home.eyebrow === '音乐盒 · 6 首', `${home.eyebrow}`);
    ok('球上的数字与曲库一致', home.count === '6', `data-count=${home.count}`);
    ok('<audio data-bgm> 在，且 src 已经落在第一首上', home.hasAudio && Boolean(home.src), home.src);
    await screenshot('studio-1-music-open');
    ok('这一段控制台干净', consoleErrors.length === errors, consoleErrors.slice(errors).join(' | '));

    /* ---------------------------------------------------------- 2. 粉灯与手势 */
    phase = '2 自动播放被拦';
    errors = errorsSince();
    const blockedNow = await evaluate(`(() => {
      const ball = document.querySelector('.ball--music');
      const dot = ball.querySelector('.ball__dot');
      return {
        blocked: ball.classList.contains('is-blocked'),
        playing: ball.classList.contains('is-playing'),
        dotOpacity: getComputedStyle(dot).opacity,
        dotAnimation: getComputedStyle(dot).animationName,
        paused: document.querySelector('[data-bgm]').paused,
      };
    })()`);
    ok(
      '自动播放被浏览器拦下 → 粉灯亮',
      blockedNow.blocked === true && blockedNow.paused === true && Number(blockedNow.dotOpacity) > 0.2 && blockedNow.dotAnimation === 'cv01-blink',
      JSON.stringify(blockedNow)
    );
    await screenshot('studio-2-blocked-dot');

    /* 第一个手势（点面板里那段说明文字，什么都不触发）→ 接着放 */
    await clickSelector('.mp__note', '面板里的一段说明文字');
    await sleep(1500);
    const afterGesture = await evaluate(`(() => {
      const ball = document.querySelector('.ball--music');
      const audio = document.querySelector('[data-bgm]');
      return {
        paused: audio.paused,
        blocked: ball.classList.contains('is-blocked'),
        playing: ball.classList.contains('is-playing'),
        dotOpacity: getComputedStyle(ball.querySelector('.ball__dot')).opacity,
        currentTime: Number(audio.currentTime.toFixed(2)),
      };
    })()`);
    ok(
      '第一个手势之后接着放（粉灯灭）',
      afterGesture.paused === false && afterGesture.blocked === false && afterGesture.playing === true,
      JSON.stringify(afterGesture)
    );
    await screenshot('studio-3-music-playing');
    ok('这一段控制台干净', consoleErrors.length === errors, consoleErrors.slice(errors).join(' | '));

    /* ---------------------------------------------------------- 3. 播放 / 暂停 */
    phase = '3 播放暂停';
    errors = errorsSince();
    await clickSelector('.mp__btn--main', '播放/暂停');
    await sleep(500);
    const paused = await evaluate(`({ paused: document.querySelector('[data-bgm]').paused, label: document.querySelector('[data-toggle]').textContent.trim(), playing: document.querySelector('.ball--music').classList.contains('is-playing') })`);
    ok('按一下：停了', paused.paused === true && paused.label === '▶' && paused.playing === false, JSON.stringify(paused));

    await clickSelector('.mp__btn--main', '播放/暂停');
    await sleep(900);
    const resumed = await evaluate(`({ paused: document.querySelector('[data-bgm]').paused, label: document.querySelector('[data-toggle]').textContent.trim(), playing: document.querySelector('.ball--music').classList.contains('is-playing'), title: document.querySelector('.mp__now').textContent.trim() })`);
    ok('再按一下：又放起来了', resumed.paused === false && resumed.playing === true, JSON.stringify(resumed));
    ok('这一段控制台干净', consoleErrors.length === errors, consoleErrors.slice(errors).join(' | '));

    /* ---------------------------------------------------------- 3b. 换页不停
       <audio> 住在 layouts/default.vue 的 StudioDock 里、<NuxtPage> 之外，
       站内跳转时它不该被重造，也不该停。给节点打一个记号，跳一页再看它还在不在。 */
    phase = '3b 换页不停';
    errors = errorsSince();
    const beforeNav = await evaluate(`(() => {
      const a = document.querySelector('[data-bgm]');
      a.__cv01mark = '同一根';
      return { t: a.currentTime, src: a.getAttribute('src') };
    })()`);
    await clickSelector('header.bar nav a[href="/archive"]', '命令栏里的「归档」');
    await sleep(2600);
    const afterNav = await evaluate(`(() => {
      const a = document.querySelector('[data-bgm]');
      return {
        path: location.pathname,
        sameNode: a.__cv01mark === '同一根',
        sameSrc: a.getAttribute('src'),
        paused: a.paused,
        currentTime: Number(a.currentTime.toFixed(2)),
        playing: document.querySelector('.ball--music').classList.contains('is-playing'),
        studioHidden: document.querySelector('.studio').hidden,
        panelOpen: !document.querySelector('.studio__panel').hidden,
      };
    })()`);
    ok(
      '换页之后歌没停：还是那一根 <audio>，还在放',
      afterNav.path === '/archive' &&
        afterNav.sameNode === true &&
        afterNav.paused === false &&
        afterNav.currentTime > beforeNav.t &&
        afterNav.playing === true,
      JSON.stringify(afterNav) + `（跳页前 currentTime=${beforeNav.t.toFixed(2)}）`
    );
    /* 点站内链接 = 点面板外面，面板照旧收起（旧站同一条）；再点球要看得到曲库还在放 */
    await clickSelector('[data-ball="music"]', '音乐球（换页之后再开）');
    await sleep(600);
    const reopened = await evaluate(`(() => ({
      items: document.querySelectorAll('.mp-item').length,
      current: document.querySelectorAll('.mp-item.is-current').length,
      toggle: document.querySelector('[data-toggle]').textContent.trim(),
      paused: document.querySelector('[data-bgm]').paused,
    }))()`);
    ok(
      '换页之后再开面板：曲库、播放头、播放键都还是刚才那副样子',
      reopened.items === 6 && reopened.current === 1 && reopened.toggle === '❚❚' && reopened.paused === false,
      JSON.stringify(reopened)
    );
    ok('这一段控制台干净', consoleErrors.length === errors, consoleErrors.slice(errors).join(' | '));

    /* ---------------------------------------------------------- 4. 没有口令 */
    phase = '4 没有口令';
    errors = errorsSince();
    const noKey = await evaluate(`(() => ({
      stored: localStorage.getItem('cv01-key'),
      swap: document.querySelectorAll('.mp-item__act[data-swap]').length,
      rename: document.querySelectorAll('.mp-item__act[data-rename]').length,
      del: document.querySelectorAll('.mp-item__act--del').length,
      pins: document.querySelectorAll('.mp-item__act[data-pin]').length,
    }))()`);
    ok(
      '没有口令：音乐盒不摆出 换 / 改名 / 删（公开的 设为默认 还在）',
      noKey.stored === null && noKey.swap === 0 && noKey.rename === 0 && noKey.del === 0 && noKey.pins === 6,
      JSON.stringify(noKey)
    );

    await clickSelector('[data-ball="owner"]', '站长球');
    await sleep(600);
    const gate = await evaluate(`(() => {
      const box = document.querySelector('.keygate');
      return {
        on: Boolean(box),
        title: box ? box.querySelector('.keygate__title').textContent.trim() : '',
        hint: box ? box.querySelector('.keygate__hint').textContent.trim() : '',
        focused: box ? document.activeElement === box.querySelector('.keygate__input') : false,
        ownerPanel: Boolean(document.querySelector('.ow')),
      };
    })()`);
    ok(
      '点站长球（没有口令）→ 口令框弹出来，面板没开',
      gate.on === true && gate.ownerPanel === false && gate.title === '上传口令',
      JSON.stringify(gate)
    );
    ok('口令框把焦点收在输入框上', gate.focused === true, `hint=${gate.hint}`);
    await screenshot('studio-4-keygate');

    /* 401 是预期的那道边界：它出现在浏览器日志里，不是页面错误 */
    ok(
      '这一段控制台没有页面错误（401 只出现在浏览器网络日志里）',
      consoleErrors.length === errors,
      consoleErrors.slice(errors).join(' | ') || `网络日志 ${netLogs.length} 条`
    );

    /* ---------------------------------------------------------- 5. 口令到手 */
    phase = '5 口令';
    await setValue('.keygate__input', KEY);
    await clickSelector('.keygate__go', '口令框的确认');
    await sleep(900);
    const opened = await evaluate(`(() => {
      const ow = document.querySelector('.ow');
      return {
        gate: Boolean(document.querySelector('.keygate')),
        owner: Boolean(ow),
        items: ow ? Array.from(ow.querySelectorAll('.ow__item b')).map((b) => b.textContent.trim()) : [],
        stored: localStorage.getItem('cv01-key') === ${JSON.stringify(KEY)},
        expanded: document.querySelector('[data-ball="owner"]').getAttribute('aria-expanded'),
      };
    })()`);
    ok(
      '口令对了：口令框收起，站长工具箱的三选一菜单开出来',
      opened.gate === false && opened.owner === true && opened.expanded === 'true',
      opened.items.join(' / ')
    );
    ok(
      '口令写进了 localStorage 的 cv01-key',
      opened.stored === true,
      `三件事：${opened.items.length} 个入口`
    );
    await screenshot('studio-5-owner-menu');

    /* 换页重新进来一次：口令还记着，音乐盒的站长按钮该自己长出来 */
    errors = errorsSince();
    await navigate('/?open=music', 3200);
    const withKey = await evaluate(`(() => ({
      store: localStorage.getItem('cv01-key') === ${JSON.stringify(KEY)},
      swap: document.querySelectorAll('.mp-item__act[data-swap]').length,
      rename: document.querySelectorAll('.mp-item__act[data-rename]').length,
      del: document.querySelectorAll('.mp-item__act--del').length,
      items: document.querySelectorAll('.mp-item').length,
      gate: Boolean(document.querySelector('.keygate')),
    }))()`);
    ok(
      '重新进页面：有口令的那台浏览器看得见 换 / 改名 / 删',
      withKey.store === true && withKey.swap === 6 && withKey.rename === 6 && withKey.del === 6 && withKey.gate === false,
      JSON.stringify(withKey)
    );
    ok('这一段控制台干净', consoleErrors.length === errors, consoleErrors.slice(errors).join(' | '));

    /* ---------------------------------------------------------- 6. 新建板块 */
    phase = '6 新建板块';
    errors = errorsSince();
    await clickSelector('[data-ball="owner"]', '站长球（有口令）');
    await sleep(600);
    await clickSelector('[data-go="section"]', '新建板块 / 子板块');
    await sleep(900);
    const form = await evaluate(`(() => {
      const panel = document.querySelector('.studio__panel');
      const sel = panel.querySelector('[data-pitch]');
      return {
        form: Boolean(panel.querySelector('.sc')),
        eyebrow: (panel.querySelector('.sc__eyebrow') || {}).textContent,
        pitch: sel ? sel.value : '',
        options: sel ? sel.options.length : 0,
        warn: (panel.querySelector('[data-warn]') || {}).textContent,
        parents: panel.querySelectorAll('[data-parent] option').length,
      };
    })()`);
    ok(
      '站长工具箱 → 新建板块：表单出来了，音高默认落在推荐的空音上',
      form.form === true && form.options === 60 && Boolean(form.pitch) && form.parents > 0,
      JSON.stringify(form)
    );

    const testName = '验收测试板块';
    await setValue('.studio__panel [data-name]', testName);
    await setValue('.studio__panel [data-def]', '这一条是自检建的，跑完就删。');
    await clickSelector('.studio__panel [data-create]', '建这个板块');
    await sleep(1400);
    const created = await evaluate(`(() => {
      const toast = document.querySelector('.studio__toast');
      return { toast: toast ? toast.textContent.trim() : '', pitch: document.querySelector('.studio__panel [data-pitch]').value };
    })()`);
    const afterCreate = await sectionList();
    const made = afterCreate.find((s) => s.name === testName);
    ok(
      '建板块：服务真的建出来了',
      Boolean(made) && created.toast.includes('建好了'),
      `toast=${created.toast} · id=${made ? made.id : '(没有)'} pitch=${made ? made.pitch : ''}`
    );
    await screenshot('studio-6-section-created');

    /* 提示条与面板的层叠：旧站那条提示挂在 .studio 里面，永远盖着面板；
       在这里它是兄弟，得确认真能看见（面板一开，「删掉了 / 换好了」都要看得见） */
    const toastTop = await evaluate(`(() => {
      const toast = document.querySelector('.studio__toast');
      const panel = document.querySelector('.studio__panel');
      const pe = getComputedStyle(toast).pointerEvents;
      /* 提示条平时是 pointer-events: none（旧站也这样：它不该挡住底下的按钮），
         那样 elementFromPoint 会跳过它、报出底下的元素，测不出层叠先后。
         所以把命中测试打开一瞬，量完立刻还原。 */
      toast.style.pointerEvents = 'auto';
      const r = toast.getBoundingClientRect();
      const p = panel.getBoundingClientRect();
      const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
      toast.style.pointerEvents = '';
      return {
        on: toast.classList.contains('is-on'),
        opacity: getComputedStyle(toast).opacity,
        z: getComputedStyle(toast).zIndex,
        pointerEvents: pe,
        topmost: hit ? toast.contains(hit) : false,
        hit: hit ? (typeof hit.className === 'string' ? hit.className : hit.tagName) : null,
        overlapsPanel: !(r.top > p.bottom || r.bottom < p.top || r.left > p.right || r.right < p.left),
      };
    })()`);
    ok(
      '面板开着的时候，提示条照样看得见（压在面板上面）',
      toastTop.on === true && Number(toastTop.opacity) > 0.5 && toastTop.topmost === true &&
        toastTop.overlapsPanel === true && toastTop.pointerEvents === 'none',
      JSON.stringify(toastTop)
    );

    /* 删掉它：站长工具箱这张表里没有板块删除（那是右键菜单那条工作流），
       所以直接走服务端接口，用同一把口令。 */
    if (made) {
      const gone = await api(`/api/sections/${encodeURIComponent(made.id)}`, {
        method: 'DELETE',
        headers: { 'x-cv01-key': KEY },
      });
      await sleep(300);
      const rest = await sectionList();
      ok(
        '删板块：建出来的那一条又没了（别的板块一个没动）',
        gone.status === 200 && gone.body?.ok === true && !rest.some((s) => s.id === made.id) && rest.length === afterCreate.length - 1,
        `DELETE ${gone.status} · ${afterCreate.length} → ${rest.length} 个板块`
      );
    }
    ok('这一段控制台干净', consoleErrors.length === errors, consoleErrors.slice(errors).join(' | '));

    /* ---------------------------------------------------------- 7. 传歌 */
    phase = '7 上传';
    errors = errorsSince();
    /* 刚才停在「新建板块」那个子面板里：先按「← 工具箱」回到三选一 */
    await clickSelector('.ow__back', '← 工具箱');
    await sleep(500);
    await clickSelector('[data-go="music"]', '上传音乐盒的音乐');
    await sleep(700);
    const uploadPanel = await evaluate(`(() => ({
      drop: Boolean(document.querySelector('.mp__drop')),
      title: (document.querySelector('.mp__drop-title') || {}).textContent,
      note: (document.querySelector('.mp__note') || {}).textContent.trim().slice(0, 24),
    }))()`);
    ok('站长工具箱 → 上传音乐：投放区在', uploadPanel.drop === true && uploadPanel.title === '上传 BGM', JSON.stringify(uploadPanel));

    /* 真文件塞进 <input type=file>（CDP 的正路），change 事件自己会走完整条上传流程 */
    const doc = await cdp.send('DOM.getDocument', { depth: -1 }, sessionId);
    const inputNode = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[data-file]' }, sessionId);
    ok('上传用的隐藏文件框在', Boolean(inputNode.nodeId), `nodeId=${inputNode.nodeId}`);
    await cdp.send('DOM.setFileInputFiles', { files: [toneA], nodeId: inputNode.nodeId }, sessionId);
    await sleep(3200);

    const afterUpload = await evaluate(`(() => {
      const toast = document.querySelector('.studio__toast');
      const done = document.querySelector('[data-done]');
      return {
        toast: toast ? toast.textContent.trim() : '',
        doneHidden: done.hidden,
        done: done.textContent.trim(),
        upHidden: document.querySelector('[data-up]').hidden,
        upText: document.querySelector('[data-up-text]').textContent.trim(),
      };
    })()`);
    const tracksAfterUpload = await musicLibrary();
    const filesAfterUpload = musicFiles();
    const addedTrack = tracksAfterUpload.find((t) => t.title === 'studio-tone-a');
    const newFiles = filesAfterUpload.filter((f) => !beforeFiles.includes(f));
    ok(
      '传歌：进度条跑完，服务回话「刚传进来」',
      afterUpload.doneHidden === false && afterUpload.done.includes('刚传进来') && afterUpload.toast.includes('已加入音乐盒'),
      JSON.stringify(afterUpload)
    );
    ok(
      '传歌：真落进 media/music，并且进了曲库',
      Boolean(addedTrack) && newFiles.length === 1 && addedTrack.file === newFiles[0],
      `曲库 ${beforeTracks.length} → ${tracksAfterUpload.length} · 新文件 ${newFiles.join(', ')}`
    );
    await screenshot('studio-7-upload-done');

    /* 音乐盒那边要跟着看见它 */
    await clickSelector('[data-ball="music"]', '音乐球');
    await sleep(700);
    const boxAfterUpload = await evaluate(`(() => ({
      items: document.querySelectorAll('.mp-item').length,
      eyebrow: (document.querySelector('.mp__eyebrow') || {}).textContent,
      titles: Array.from(document.querySelectorAll('.mp-item__title')).map((n) => n.textContent.trim()),
    }))()`);
    ok(
      '音乐盒里也多出这一首（7 首）',
      boxAfterUpload.items === 7 && boxAfterUpload.titles.some((t) => t.includes('studio-tone-a')),
      `${boxAfterUpload.eyebrow}`
    );
    await screenshot('studio-8-uploaded-in-box');

    /* ---------------------------------------------------------- 8. 换歌 */
    phase = '8 换歌';
    const swapAt = tracksAfterUpload.findIndex((t) => t.title === 'studio-tone-a');
    await clickSelector(`.mp-item:nth-child(${swapAt + 1}) [data-swap]`, '第 ' + (swapAt + 1) + ' 行的「换」');
    await sleep(400);
    const swapNode = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[data-swap-file]' }, sessionId);
    const afterUploadFiles = musicFiles();
    await cdp.send('DOM.setFileInputFiles', { files: [toneB], nodeId: swapNode.nodeId }, sessionId);
    await sleep(3200);
    const swapped = await evaluate(`(() => ({
      toast: document.querySelector('.studio__toast').textContent.trim(),
      upText: document.querySelector('[data-up-text]').textContent.trim(),
      titles: Array.from(document.querySelectorAll('.mp-item__title')).map((n) => n.textContent.trim()),
    }))()`);
    const tracksAfterSwap = await musicLibrary();
    const filesAfterSwap = musicFiles();
    /* 服务端给新曲目起的名字来自新文件名（那一首的「曲名」跟着新文件走，
       位置上还是原来那一行）——旧站也是这个样子：换完想改名再按「改名」。 */
    const swappedTrack = tracksAfterSwap.find((t) => t.title === 'studio-tone-b');
    ok(
      '换歌：那一行原地换了血（旧记录走、新记录顶上，曲库还是 7 首）',
      tracksAfterSwap.length === 7 &&
        !tracksAfterSwap.some((t) => t.id === addedTrack.id) &&
        Boolean(swappedTrack) &&
        swapped.toast.includes('换成了新文件'),
      `toast=${swapped.toast} · 新记录 ${swappedTrack ? swappedTrack.id + ' ' + swappedTrack.file : '(没有)'}`
    );
    ok(
      '换歌：旧文件从 media/music 里走了，新文件进来了（文件数不变）',
      !filesAfterSwap.includes(addedTrack.file) && filesAfterSwap.length === afterUploadFiles.length,
      `旧 ${addedTrack.file} → 新 ${swappedTrack ? swappedTrack.file : '(没有)'}`
    );
    await screenshot('studio-9-after-swap');

    /* ---------------------------------------------------------- 9. 改名 */
    phase = '9 改名';
    await evaluate(`window.prompt = () => '验收测试曲目'`);
    await clickSelector(`.mp-item:nth-child(${swapAt + 1}) [data-rename]`, '第 ' + (swapAt + 1) + ' 行的「改名」');
    await sleep(1200);
    const renamed = await evaluate(`Array.from(document.querySelectorAll('.mp-item__title')).map((n) => n.textContent.trim())`);
    const tracksAfterRename = await musicLibrary();
    ok(
      '改名：列表与服务端都换成了新名字',
      renamed.some((t) => t.includes('验收测试曲目')) && tracksAfterRename.some((t) => t.title === '验收测试曲目'),
      renamed.filter((t) => t.includes('验收')).join(' ') || renamed.join(' | ')
    );
    await screenshot('studio-10-renamed');

    /* ---------------------------------------------------------- 10. 删歌 */
    phase = '10 删歌';
    await evaluate(`window.confirm = () => true`);
    const delAt = tracksAfterRename.findIndex((t) => t.title === '验收测试曲目');
    await clickSelector(`.mp-item:nth-child(${delAt + 1}) [data-del]`, '第 ' + (delAt + 1) + ' 行的「删」');
    await sleep(1600);
    const afterDelete = await evaluate(`(() => ({
      items: document.querySelectorAll('.mp-item').length,
      titles: Array.from(document.querySelectorAll('.mp-item__title')).map((n) => n.textContent.trim()),
      toast: document.querySelector('.studio__toast').textContent.trim(),
    }))()`);
    const tracksAfterDelete = await musicLibrary();
    const filesAfterDelete = musicFiles();
    ok(
      '删歌：列表回到 6 首，服务端也没了',
      afterDelete.items === 6 && !tracksAfterDelete.some((t) => t.title === '验收测试曲目') && afterDelete.toast.includes('删掉了'),
      `items=${afterDelete.items} · toast=${afterDelete.toast}`
    );
    ok(
      '删歌：上传的文件也从 media/music 里走了',
      filesAfterDelete.length === beforeFiles.length && filesAfterDelete.every((f) => beforeFiles.includes(f)),
      `现在 ${filesAfterDelete.length} 个文件：${filesAfterDelete.filter((f) => !beforeFiles.includes(f)).join(', ') || '没有多余的'}`
    );
    await screenshot('studio-11-after-delete');

    ok('这一段控制台干净', consoleErrors.length === errors, consoleErrors.slice(errors).join(' | '));

    /* ---------------------------------------------------------- 收尾 */
    ok('全程控制台 0 个页面错误（Runtime）', consoleErrors.length === 0, consoleErrors.slice(0, 4).join(' | '));
    console.log(`\n浏览器网络日志里的 error 条目（预期：没有口令时那几次 401）：${netLogs.length} 条`);
    for (const line of netLogs.slice(0, 4)) console.log(`   · ${line}`);
  } catch (err) {
    ok(`第 ${phase} 段抛了：${err.message}`, false);
  } finally {
    close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
  if (failed.length) console.log(`失败：${failed.map((f) => f.name).join(' · ')}`);
  console.log('截图在 .check/studio-*.png');
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(`自检自己挂了：${err.message}`);
  process.exit(2);
});

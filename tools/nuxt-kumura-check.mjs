/* ==========================================================================
   tools/nuxt-kumura-check.mjs · 云村「访客那一版」的浏览器验收
   ---------------------------------------------------------------------------
   验的是「访客打开 /kumura 会看到什么」，所以**跑之前必须把小服务停掉**：
   访客的浏览器连不上站长那台机器的 127.0.0.1:3170，页面正是靠这一点判断
   「我不是站长，去看已发布的快照」。小服务在跑的话，这一页会走站长那一版，
   这里量的东西就全对不上了。

   它量什么（对着真浏览器 + 真快照 + 真站上曲库）：
     1) 状态是 public —— 访客那一版真的摆出来了
     2) 账号卡 / 歌单架 / 红心列表的条数与 data/kumura.json 对得上
     3) 封面全是站内 /media/kumura/，页面上不出现网易图床、更不出现播放地址
     4) 红心每一行都带「网易云」外链（快照里唯一的出口）
     5) 「在这里听」列的是站上自己的曲库，点一下真的开始放（audio.src 落上）
     6) 访客看不到「发布到公网」那颗键
     7) 全程控制台 0 报错

   怎么跑（先构建再起成品服务）：
     pnpm install && pnpm build
     $env:PORT='3987'; node .output/server/index.mjs     # 另开一个窗口，仓库根
     # 确认小服务**没在跑**（停掉 tools/ncm-server.mjs）
     node tools/nuxt-kumura-check.mjs http://127.0.0.1:3987

   零依赖：用 Node 自带的 WebSocket 跟 Chrome 的调试端口说话（CDP），
   与 tools/nuxt-edit-check.mjs 是同一套做法。截图落在 .check/（已 gitignore）。
   ========================================================================== */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { readSessionSid, readSnapshot, snapshotSummary } from '../server/lib/kumura-snapshot.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.argv[2] || 'http://127.0.0.1:3987').replace(/\/+$/, '');
/* --owner：验站长那一侧（小服务要在跑、这台机器要登录着）。
   默认那一遍验的是访客那一侧（小服务必须停着）——两边的前置条件正好相反。 */
const OWNER = process.argv.includes('--owner');
const CHECK = join(ROOT, '.check');
const SNAPSHOT_FILE = join(ROOT, 'data', 'kumura.json');
const SESSION_FILE = join(ROOT, '.ncm-session.json');
const SETTINGS_FILE = join(ROOT, 'data', 'settings.json');
const SERVICE = process.env.NCM_SERVICE || `http://127.0.0.1:${process.env.NCM_PORT || 3170}`;

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const problems = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  if (!pass) problems.push(`${name}  ${detail}`);
  console.log(`${pass ? '  ok  ' : '  XX  '} ${name}${detail ? `  — ${detail}` : ''}`);
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
  const port = 9900 + Math.floor(Math.random() * 90);
  const profile = join(tmpdir(), `cv01-kmprobe-${randomBytes(4).toString('hex')}`);
  const proc = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--mute-audio',
      /* 访客点一下播放键就该出声：headless 里没有"用户手势"，得把这条策略关掉 */
      '--autoplay-policy=no-user-gesture-required',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      `--remote-debugging-port=${port}`,
      '--remote-allow-origins=*',
      `--user-data-dir=${profile}`,
      '--window-size=1280,1000',
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

/* ------------------------------------------------------------------ 主流程 */
const consoleErrors = [];
let shotCount = 0;

async function main() {
  console.log(`\n云村访客版验收  ·  站点 ${BASE}  ·  小服务 ${SERVICE}`);

  /* ---------------------------------------------------------- 前置条件 */
  if (!CHROME) {
    console.error('找不到 Chrome 或 Edge');
    process.exit(2);
  }

  const readJsonFile = (file) => {
    try {
      return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
  };

  const sid = readSessionSid(SESSION_FILE);
  let serviceUp = false;
  let serviceLoggedIn = false;
  try {
    const res = await fetch(`${SERVICE}/api/health`, {
      headers: sid ? { cookie: `ncm_sid=${sid}` } : {},
      signal: AbortSignal.timeout(2500),
    });
    if (res.ok) {
      const data = await res.json().catch(() => null);
      serviceUp = true;
      serviceLoggedIn = Boolean(data && data.loggedIn);
    }
  } catch {
    serviceUp = false;
  }

  if (OWNER) {
    /* 站长那一侧：小服务要在跑、这台机器要登录着、口令要有（发布要口令） */
    if (!serviceUp) {
      console.log(`\n  !! 站长这一遍要小服务在跑（${SERVICE}），现在连不上。`);
      console.log('     另开一个窗口：node tools/ncm-server.mjs\n');
      process.exit(2);
    }
    if (!serviceLoggedIn) {
      console.log('\n  !! 小服务在跑，但这台机器没登录网易云。先在 /kumura 扫码登录一次。\n');
      process.exit(2);
    }
    console.log('  小服务在跑、这台机器登录着（站长那一遍要的就是这个）\n');
  } else {
    if (serviceUp) {
      console.log(`\n  !! 小服务正在跑（${SERVICE}）。`);
      console.log('     这一条验的是「访客那一侧」：访客连不上站长的 127.0.0.1，页面才会去读快照。');
      console.log('     先把 tools/ncm-server.mjs 停掉再跑这个（要验站长那一侧就加 --owner）。\n');
      process.exit(2);
    }
    console.log('  小服务没在跑（这一条要的就是这个）\n');
  }

  const snapshot = readSnapshot(SNAPSHOT_FILE);
  if (!snapshot) {
    console.log('  !! 还没有发布过快照（data/kumura.json 不在）。');
    console.log('     先跑一次：node tools/kumura-publish.mjs\n');
    process.exit(2);
  }
  const s = snapshotSummary(snapshot);
  console.log(`  快照：${s.nickname} · 歌单 ${s.playlists} 张 · 红心 ${s.tracks}/${s.trackCount} 首\n`);

  mkdirSync(CHECK, { recursive: true });
  const { cdp, sessionId, close } = await openBrowser();
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send(
    'Emulation.setDeviceMetricsOverride',
    { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false },
    sessionId
  );

  cdp.on((msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      consoleErrors.push(`未捕获异常：${d.exception?.description || d.text}`);
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      const text = msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ');
      if (/favicon|410/.test(text)) return;
      consoleErrors.push(`console.error：${text}`);
    }
  });

  const evaluate = async (expression, tries = 14) => {
    let last = null;
    for (let i = 0; i < tries; i++) {
      try {
        const res = await cdp.send(
          'Runtime.evaluate',
          { expression, awaitPromise: true, returnByValue: true },
          sessionId
        );
        if (res.exceptionDetails) {
          throw new Error(res.exceptionDetails.exception?.description || '页面里抛了异常');
        }
        return res.result.value;
      } catch (err) {
        last = err;
        if (!/navigated or closed|超时/.test(err.message)) throw err;
        await sleep(400);
      }
    }
    throw last;
  };

  const waitFor = async (expr, ms = 12000) => {
    const deadline = Date.now() + ms;
    for (let i = 0; i < 120; i++) {
      try {
        if (await evaluate(expr, 2)) return true;
      } catch {
        /* 页面还在自己刷，接着等 */
      }
      if (Date.now() > deadline) return false;
      await sleep(200);
    }
    return false;
  };

  const shot = async (name) => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    writeFileSync(join(CHECK, `${name}.png`), Buffer.from(data, 'base64'));
    shotCount++;
  };

  const finish = () => {
    const failed = results.filter((r) => !r.pass);
    console.log(`\n截图 ${shotCount} 张在 .check/`);
    console.log(`${results.length - failed.length}/${results.length} 项通过`);
    if (problems.length) {
      console.log('\n没过的：');
      for (const p of problems) console.log(`  !! ${p}`);
    }
    process.exit(failed.length ? 1 : 0);
  };

  /* ==================================================== 站长那一遍（--owner）
     验的是站长自己那台机器上会看到什么、按下去会发生什么：实时那一版要出来、
     「发布到公网」那颗键要在、按一下要真的落盘（data/kumura.json 的 at 要变新）。
     口令与 sid 都只在本机用，不打印。 */
  if (OWNER) {
    console.log('  — 站长那一侧：实时版 + 「发布到公网」 —\n');
    const settings = readJsonFile(SETTINGS_FILE);
    const key = String((settings && settings.passphrase) || '');
    if (!key) {
      console.log('  !! data/settings.json 里没有口令，发布这一条跑不了。\n');
      process.exit(2);
    }

    try {
      /* 让这个浏览器带上「站长那台机器的登录态」：cookie 是按主机算的，
         端口不参与，所以给 127.0.0.1 设的 ncm_sid 一样会发给 127.0.0.1:3170。 */
      await cdp.send('Network.enable', {}, sessionId);
      await cdp.send(
        'Network.setCookie',
        { name: 'ncm_sid', value: sid, url: BASE, path: '/', sameSite: 'Lax' },
        sessionId
      );
      await cdp.send('Page.navigate', { url: `${BASE}/kumura?enter=1` }, sessionId);
      await waitFor(`!!document.querySelector('[data-music]')`);
      /* 口令写进 localStorage：那颗键走 useStudio 的 withKey（没有就问一次再重放） */
      await evaluate(`localStorage.setItem('cv01-key', ${JSON.stringify(key)})`);
      await cdp.send('Page.navigate', { url: `${BASE}/kumura` }, sessionId);

      const ready = await waitFor(
        `document.querySelector('[data-music]') && document.querySelector('[data-music]').getAttribute('data-music-state') === 'ready'`,
        20000
      );
      check('站长打开 /kumura 落到实时那一版（ready）', ready);
      if (ready) {
        const btn = JSON.parse(
          await evaluate(`(function () {
            var b = document.querySelector('[data-publish]');
            if (!b) return JSON.stringify({ ok: false });
            var r = b.getBoundingClientRect();
            return JSON.stringify({ ok: true, visible: !!b.offsetParent, w: Math.round(r.width), label: b.textContent.trim() });
          })()`)
        );
        check(
          '「发布到公网」那颗键在站长这一版上看得见',
          btn.ok && btn.visible && btn.w > 0,
          btn.label || ''
        );
        await shot('kumura-owner');

        await evaluate(`document.querySelector('[data-publish]').click()`);
        const noted = await waitFor(
          `/^(已发布|发布失败)/.test((document.querySelector('[data-publish-note]') || {}).textContent || '')`,
          90000
        );
        const note = await evaluate(
          `((document.querySelector('[data-publish-note]') || {}).textContent || '')`
        );
        check('按一下真的发布了（页面把结果念出来）', noted && /^已发布/.test(note), note);
        const after = readSnapshot(SNAPSHOT_FILE);
        check(
          '发布之后 data/kumura.json 换成了新的一份',
          Boolean(after) && after.at !== snapshot.at,
          `${snapshot.at} → ${(after && after.at) || '（没读到）'}`
        );
        await shot('kumura-owner-published');
        check('站长这一路控制台 0 报错', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));
      }
    } catch (err) {
      problems.push(`站长那一遍自己挂了：${err.message}`);
      console.error(`\n站长那一遍自己挂了：${err.stack || err.message}`);
    }
    close();
    finish();
    return;
  }

  try {
    /* 访客就是这么来的：没有门厅那枚章，也没有 ?enter=1。
       发布过快照之后这一页应当自己开门——本站只有一个口令，而它同时就是写权限，
       不能发给访客（见 server/middleware/gate.ts 里那一段）。 */
    await cdp.send('Page.navigate', { url: `${BASE}/kumura` }, sessionId);
    await waitFor(`location.pathname !== '/login'`, 10000);
    const landed = await evaluate(`location.pathname`);
    check('访客没带门厅的章也能进这一页（发布过快照就开门）', landed === '/kumura', landed);

    const gotPublic = await waitFor(
      `document.querySelector('[data-music]') && document.querySelector('[data-music]').getAttribute('data-music-state') === 'public'`
    );
    check('访客打开 /kumura 落到「公开快照」那一版', gotPublic);
    if (!gotPublic) {
      const state = await evaluate(
        `(document.querySelector('[data-music]') || {}).getAttribute ? document.querySelector('[data-music]').getAttribute('data-music-state') : '（没有容器）'`
      ).catch(() => '（读不到）');
      check('（诊断）当时的页面状态', false, String(state));
      await shot('kumura-public-fail');
      close();
      throw new Error('页面没有落到 public 状态，后面的量法没意义');
    }

    /* 等数据铺上去（快照是异步取回来的） */
    await waitFor(`document.querySelectorAll('[data-pub-playlists] .km-shelf__item').length > 0`);
    await shot('kumura-public');

    /* ---------------------------------------------------------- 内容对得上 */
    const shown = JSON.parse(
      await evaluate(`JSON.stringify({
        name: (document.querySelector('[data-pub-name]') || {}).textContent || '',
        at: (document.querySelector('[data-pub-at]') || {}).textContent || '',
        playlists: document.querySelectorAll('[data-pub-playlists] .km-shelf__item').length,
        tracks: document.querySelectorAll('[data-pub-tracks] .km-track').length,
        facts: document.querySelectorAll('[data-pub-facts] .km-facts__row').length,
        boxRows: document.querySelectorAll('[data-pub-box] .km-track').length,
        boxPlays: document.querySelectorAll('[data-pub-box] [data-pub-play]').length,
        links: document.querySelectorAll('[data-pub-tracks] .km-track__link').length,
        covers: Array.from(document.querySelectorAll('[data-pub-playlists] img, [data-pub-avatar] img, [data-pub-liked-cover] img')).map(function (i) { return i.getAttribute('src') || ''; }),
        html: document.querySelector('[data-pane="public"]').innerHTML,
        publishVisible: !!(document.querySelector('[data-publish]') && document.querySelector('[data-publish]').offsetParent)
      })`)
    );

    check(`账号卡显示快照里的昵称（${s.nickname}）`, shown.name === s.nickname, shown.name);
    check('账号卡带「发布于 …」那一行', /发布于\s*\d{4}\.\d{2}\.\d{2}/.test(shown.at), shown.at);
    check('账号卡有事实行（等级/听歌/关注…）', shown.facts > 0, String(shown.facts));
    check(`歌单架摆出 ${s.playlists} 张`, shown.playlists === s.playlists, String(shown.playlists));
    check(`红心列表摆出 ${s.tracks} 首`, shown.tracks === s.tracks, String(shown.tracks));
    check('红心每一行都有「网易云」外链', shown.links === shown.tracks, `${shown.links}/${shown.tracks}`);

    /* ---------------------------------------------------------- 边界 */
    const coversLocal = shown.covers.filter(Boolean);
    check(
      '封面全是站内地址（/media/kumura/）',
      coversLocal.length > 0 && coversLocal.every((u) => u.indexOf('/media/kumura/') === 0),
      coversLocal.slice(0, 2).join(' ')
    );
    check(
      '页面上不出现网易图床地址',
      !/music\.126\.net/.test(shown.html),
      (shown.html.match(/[a-z0-9-]+\.music\.126\.net/g) || []).slice(0, 2).join(' ')
    );
    check(
      '页面上不出现任何音频直链（快照里就没有）',
      !/m7\d\d\.music\.126\.net|authSecret|\.mp3\?/i.test(shown.html)
    );
    check('访客看不到「发布到公网」那颗键', shown.publishVisible === false);

    /* ---------------------------------------------------------- 在这里听 */
    check('「在这里听」列出了站上曲库', shown.boxRows > 0, `${shown.boxRows} 行`);
    check('每一行都有一颗播放键', shown.boxPlays === shown.boxRows, `${shown.boxPlays}/${shown.boxRows}`);

    const played = JSON.parse(
      await evaluate(`(function () {
        var btn = document.querySelector('[data-pub-box] [data-pub-play]');
        if (!btn) return JSON.stringify({ ok: false, why: '没有播放键' });
        var want = btn.getAttribute('data-pub-play');
        btn.click();
        var a = document.querySelector('[data-pub-audio]');
        return JSON.stringify({ ok: true, want: want, src: a ? a.getAttribute('src') || a.src || '' : '', pressed: btn.getAttribute('aria-pressed') });
      })()`)
    );
    check('点一下播放键：audio 拿到了那条地址', Boolean(played.ok) && played.src.endsWith(played.want), played.src);
    const playing = await waitFor(
      `(function () { var a = document.querySelector('[data-pub-audio]'); return !!a && a.src !== '' && !a.paused; })()`,
      6000
    );
    check('那一下真的开始放了（不是只挂了个地址）', playing);
    const boxNote = await evaluate(
      `((document.querySelector('[data-pub-box-note]') || {}).textContent || '')`
    );
    if (boxNote) console.log(`  ··  曲库那一行的提示：${boxNote}`);
    await shot('kumura-public-playing');

    /* ---------------------------------------------------------- 布局体检
       截图只能靠眼睛看，这几条是机器能咬死的：图有没有真的解码出来、
       有没有横向溢出、几个小节是不是依次排下来而没有叠在一起。 */
    const layout = JSON.parse(
      await evaluate(`(function () {
        var pane = document.querySelector('[data-pane="public"]');
        var imgs = Array.from(pane.querySelectorAll('img'));
        var cards = Array.from(pane.querySelectorAll('[data-pub-playlists] .km-shelf__item'));
        var rows = Array.from(pane.querySelectorAll('[data-pub-tracks] .km-track'));
        var secs = Array.from(pane.children).map(function (el) {
          var r = el.getBoundingClientRect();
          return { tag: el.className || el.tagName, top: Math.round(r.top + window.scrollY), bottom: Math.round(r.bottom + window.scrollY), h: Math.round(r.height) };
        });
        var sizes = function (list) { return list.map(function (el) { var r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) }; }); };
        return JSON.stringify({
          broken: imgs.filter(function (i) { return i.complete && i.naturalWidth === 0; }).map(function (i) { return i.getAttribute('src'); }),
          pending: imgs.filter(function (i) { return !i.complete; }).length,
          imgCount: imgs.length,
          overflowX: document.documentElement.scrollWidth - window.innerWidth,
          cards: sizes(cards).filter(function (s) { return s.w < 40 || s.h < 40; }).length,
          cardCount: cards.length,
          rowHeights: Array.from(new Set(sizes(rows).map(function (s) { return s.h; }))),
          rowsOverlap: sizes(rows).some(function (s, i, all) { return i > 0 && s.top < all[i - 1].top; }),
          secs: secs
        });
      })()`)
    );

    check(
      `已加载的封面都解码成功（${layout.imgCount - layout.pending}/${layout.imgCount} 张；其余在视口外，懒加载还没去取）`,
      layout.broken.length === 0 && layout.imgCount - layout.pending > 0,
      layout.broken.slice(0, 3).join(' ')
    );

    /* 浏览器里那几张在视口外没去取，所以封面这一条不看浏览器：直接按 HTTP
       把快照引用的每一张都验一遍（文件在不在、是不是图片）。 */
    const coverUrls = [
      snapshot.profile.avatar,
      snapshot.liked.cover,
      ...snapshot.playlists.map((p) => p.cover),
    ].filter(Boolean);
    const badCovers = [];
    for (const u of coverUrls) {
      try {
        const res = await fetch(BASE + u, { signal: AbortSignal.timeout(8000) });
        const type = String(res.headers.get('content-type') || '');
        if (!res.ok || !/^image\//.test(type)) badCovers.push(`${u} → ${res.status} ${type}`);
      } catch (err) {
        badCovers.push(`${u} → ${err.message}`);
      }
    }
    check(
      `快照引用的 ${coverUrls.length} 张封面都能取到且是图片`,
      badCovers.length === 0,
      badCovers.slice(0, 2).join(' | ')
    );
    check('没有横向溢出', layout.overflowX <= 2, `多出 ${layout.overflowX}px`);
    check(
      `歌单卡都有实际尺寸（${layout.cardCount} 张）`,
      layout.cardCount > 0 && layout.cards === 0,
      `${layout.cards} 张过小`
    );
    check('红心行高一致、行与行不重叠', layout.rowHeights.length === 1 && !layout.rowsOverlap, JSON.stringify(layout.rowHeights));
    const secTops = layout.secs.map((x) => x.top);
    const ordered = secTops.every((t, i) => i === 0 || t >= secTops[i - 1]);
    check(
      '几个小节自上而下依次排列（账号卡 → 歌单 → 红心 → 在这里听）',
      ordered && layout.secs.length >= 4,
      layout.secs.map((x) => `${x.tag}@${x.top}`).join(' | ').slice(0, 120)
    );

    /* ---------------------------------------------------------- 控制台 */
    check('全程控制台 0 报错', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));

    /* 开了这一页，别的页不能跟着开——门里只留了这一个例外。
       这一条放在最后：它会把页面带走，前面那些量法就都做完了。 */
    await cdp.send('Page.navigate', { url: `${BASE}/` }, sessionId);
    await waitFor(`location.pathname === '/login'`, 10000);
    const other = await evaluate(`location.pathname`);
    check('别的页面照样拦在门厅外（只有云村那一页开门）', other === '/login', other);
  } catch (err) {
    problems.push(`探针自己挂了：${err.message}`);
    console.error(`\n探针自己挂了：${err.stack || err.message}`);
  } finally {
    close();
  }

  finish();
}

main().catch((err) => {
  console.error(`探针自己挂了：${err.stack || err.message}`);
  process.exit(2);
});

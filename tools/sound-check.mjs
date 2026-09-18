/* ==========================================================================
   tools/sound-check.mjs · 音效自检（浏览器里离线渲染，量的是波形）
   ---------------------------------------------------------------------------
   手机上那句「短促、还有电子噪声」是四件事凑出来的，这一份把它们一条条钉住：

     · 每个音现下现解（new Audio）——点下去到响出来几百毫秒，页面早切走了
     · 采样那一路上没经过总音量（iOS 不认 <audio>.volume）——小喇叭上破音
     · 起音 / 收尾没有斜坡，或者中途硬切——「啪」的一声
     · 触屏一次点按先 pointerover 再 click——同一个采样叠两份，梳状滤波

   量法：真的开一个无头 Chrome，真的点开「开启音效」，然后用页面里那台琴的
   OfflineAudioContext 渲染出波形，在波形上算峰值、起音跳变、响到几时、尾巴有没有
   淡到零；再用触摸事件点一下音符块，数这一下触发了几层声音。

   零依赖（Node 自带 WebSocket 直连 CDP）：
     $env:PORT=3987; node node_modules/nuxt/bin/nuxt.mjs dev
     node tools/sound-check.mjs http://127.0.0.1:3987
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

  on(fn) { this.listeners.push(fn); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fetchJson = async (url, init) => (await fetch(url, init)).json();

/* ------------------------------------------------------------------ 浏览器 */
async function openBrowser() {
  const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!chrome) throw new Error('找不到 Chrome 或 Edge');
  const port = 9900 + Math.floor(Math.random() * 90);
  const profile = join(tmpdir(), `cv01-sound-check-${randomBytes(4).toString('hex')}`);
  const proc = spawn(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      /* 无头 Chrome 没有真的声卡：这条只让 AudioContext 不必等手势就能跑，
         自检里那一下点击仍然是 CDP 派发的真事件 */
      '--autoplay-policy=no-user-gesture-required',
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
    try { ws.close(); } catch { /* 收尾而已 */ }
    try { proc.kill(); } catch { /* 同上 */ }
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* 偶尔还占着，留着无妨 */ }
  };

  return { cdp, sessionId, close };
}

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? '  ok  ' : '  XX  '} ${name}${detail ? `  —— ${detail}` : ''}`);
};

async function main() {
  mkdirSync(CHECK, { recursive: true });
  const { cdp, sessionId, close } = await openBrowser();

  const errors = [];
  cdp.on((msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(`未捕获异常：${msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text}`);
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push(`console.error：${msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ')}`);
    }
  });

  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Emulation.setDeviceMetricsOverride',
    { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);

  const evaluate = async (expression) => {
    const res = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || '页面里抛了异常');
    return res.result.value;
  };

  const navigate = async (url, wait = 2600) => {
    await cdp.send('Page.navigate', { url }, sessionId);
    await sleep(wait);
  };

  const shot = async (name) => {
    if (!SHOT) return;
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    writeFileSync(join(CHECK, `${name}.png`), Buffer.from(data, 'base64'));
  };

  const clickAt = async (x, y) => {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, sessionId);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, sessionId);
  };

  const waitFor = async (expression, timeout = 12000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      if (await evaluate(expression)) return true;
      await sleep(200);
    }
    return false;
  };

  try {
    console.log('\n音效自检（真浏览器 + 离线渲染）\n');

    /* 先盖门厅的章，再进首页 */
    await navigate(`${BASE}/?enter=1`, 1200);
    await navigate(`${BASE}/`, 2800);

    /* ---------------------------------------------------------- 素材 */
    const sampleServed = await evaluate(`fetch('/assets/audio/a3.mp3', { method: 'HEAD' }).then((r) => r.ok).catch(() => false)`);
    ok('站点上能取到采样文件', sampleServed === true);

    /* ---------------------------------------------------------- 开启音效 */
    const box = await evaluate(`(function () {
      var b = document.querySelector('[data-sound-toggle]');
      if (!b) return null;
      var r = b.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })()`);
    ok('顶栏有「开启音效」那一颗', Boolean(box));
    if (box) await clickAt(box.x, box.y);
    await sleep(500);

    const engineUp = await evaluate(`(function () {
      var e = window.__cv01Sound;
      return e ? { enabled: e.enabled, state: e.state, ready: e.ready } : null;
    })()`);
    ok('引擎在页面上（window.__cv01Sound）', Boolean(engineUp));
    ok('点一下真的把声音开了', Boolean(engineUp && engineUp.enabled), JSON.stringify(engineUp));
    ok('AudioContext 跑起来了', Boolean(engineUp && engineUp.state === 'running'), engineUp && engineUp.state);

    /* ---------------------------------------------------------- 预加载 */
    const loaded = await waitFor(`window.__cv01Sound.buffers.size >= 1`, 15000);
    const bufferInfo = await evaluate(`(function () {
      var e = window.__cv01Sound;
      var out = {};
      e.buffers.forEach(function (b, k) { out[k] = Math.round(b.duration * 100) / 100; });
      return { count: e.buffers.size, durations: out, misses: e.missing.size };
    })()`);
    ok('开启后把这一页的音先拉下来了', loaded === true && bufferInfo.count >= 1,
      `${bufferInfo.count} 个采样 · 时长 ${JSON.stringify(bufferInfo.durations).slice(0, 90)}`);

    /* 归一化：九个音应当一样响（峰值都贴着 SOUND.samplePeak） */
    const peaks = await evaluate(`(function () {
      var e = window.__cv01Sound;
      var want = e.SOUND.samplePeak, out = {};
      e.buffers.forEach(function (b, k) {
        var d = b.getChannelData(0), peak = 0;
        for (var i = 0; i < d.length; i++) { var v = d[i] < 0 ? -d[i] : d[i]; if (v > peak) peak = v; }
        out[k] = Math.round(peak * 1000) / 1000;
      });
      return { want: want, peaks: out };
    })()`);
    const peakValues = Object.values(peaks.peaks || {});
    const evenLoudness = peakValues.length > 0 && peakValues.every((v) => Math.abs(v - peaks.want) < 0.05);
    ok('每个采样都归一化到同一个峰值（九个音一样响）', evenLoudness,
      `目标 ${peaks.want} · 实测 ${JSON.stringify(peaks.peaks).slice(0, 90)}`);

    /* ---------------------------------------------------------- 波形 */
    /* 量法全在页面里算，别把几万个浮点搬回来 */
    const measureInPage = `
      (function (data, rate) {
        var peak = 0, startJump = 0, i;
        for (i = 0; i < data.length; i++) { var v = data[i] < 0 ? -data[i] : data[i]; if (v > peak) peak = v; }
        for (i = 1; i < Math.min(data.length, Math.round(rate * 0.003)); i++) {
          var d = Math.abs(data[i] - data[i - 1]);
          if (d > startJump) startJump = d;
        }
        var th = peak * 0.05, lastLoud = 0;
        for (i = 0; i < data.length; i++) { var w = data[i] < 0 ? -data[i] : data[i]; if (w > th) lastLoud = i; }
        var tailFrom = Math.max(0, data.length - Math.round(rate * 0.01)), tail = 0;
        for (i = tailFrom; i < data.length; i++) { var t = data[i] < 0 ? -data[i] : data[i]; if (t > tail) tail = t; }
        return { peak: peak, startJump: startJump, held: lastLoud / rate, tail: tail };
      })
    `;

    const waves = await evaluate(`(async function () {
      var e = window.__cv01Sound;
      var measure = ${measureInPage};
      var rate = 44100;
      var sample = await e.renderOffline('C4', { short: true, duration: 1.2, sampleRate: rate });
      var synth = await e.renderOffline('C6', { short: false, duration: 2.4, sampleRate: rate, useSample: false });
      var synthShort = await e.renderOffline('C6', { short: true, duration: 1.2, sampleRate: rate, useSample: false });
      return {
        hasSample: e.buffers.has('C4'),
        sample: measure(sample, rate),
        synth: measure(synth, rate),
        synthShort: measure(synthShort, rate)
      };
    })()`);

    ok('切模块那一声用的是真采样（不是合成音色顶替）', waves.hasSample === true);

    ok('电平进了总闸：不破音、也不至于听不见',
      waves.sample.peak > 0.02 && waves.sample.peak < 0.5,
      `峰值 ${waves.sample.peak.toFixed(3)}（旧写法在 iOS 上绕过总闸，是 1.0 那一档）`);

    ok('起音是软的（前 3ms 没有跳变，不会有「啪」）',
      waves.sample.startJump < 0.02,
      `起音最大跳变 ${waves.sample.startJump.toFixed(4)}`);

    ok('切模块那一声不是「短促」的半声',
      waves.sample.held > 0.3,
      `响到 ${waves.sample.held.toFixed(3)}s（旧合成音色只有 0.42s，采样那一路还常被截断）`);

    ok('收尾淡到静音（不是硬切）',
      waves.sample.tail < 0.02 && waves.synthShort.tail < 0.02,
      `尾部残留 ${waves.sample.tail.toFixed(4)} / ${waves.synthShort.tail.toFixed(4)}`);

    ok('合成音色也软起音、不出爆音',
      waves.synth.startJump < 0.02 && waves.synth.peak > 0.02 && waves.synth.peak < 0.5,
      `跳变 ${waves.synth.startJump.toFixed(4)} · 峰值 ${waves.synth.peak.toFixed(3)}`);

    ok('合成音色的尾巴不再「电子短促」',
      waves.synth.held > 0.55,
      `响到 ${waves.synth.held.toFixed(3)}s（旧版 0.42s 就没了）`);

    await shot('sound-wave-rendered');

    /* ---------------------------------------------------------- 同一个音不叠层 */
    const guard = await evaluate(`(function () {
      var e = window.__cv01Sound;
      var before = e.stats.plays;
      var a = e.play('G4', { short: true });
      var b = e.play('G4', { short: true });
      return { before: before, a: a, b: b, after: e.stats.plays, voices: e.stats.voices };
    })()`);
    ok('同一个音连着触发两次只响一层（防梳状滤波）',
      guard.a === true && guard.b === false && guard.after - guard.before === 1,
      `play 返回 ${guard.a}/${guard.b} · 层数 ${guard.voices}`);

    /* ---------------------------------------------------------- 鼠标掠过 */
    await sleep(500);
    const hoverBox = await evaluate(`(function () {
      var n = document.querySelector('.note[data-pitch]');
      if (!n) return null;
      n.scrollIntoView({ block: 'center' });
      var r = n.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), pitch: n.getAttribute('data-pitch') };
    })()`);
    ok('页面上有音符块可以掠过', Boolean(hoverBox));
    if (hoverBox) {
      const before = await evaluate(`window.__cv01Sound.stats.plays`);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hoverBox.x, y: hoverBox.y }, sessionId);
      await sleep(120);
      const after = await evaluate(`window.__cv01Sound.stats.plays`);
      ok('鼠标掠过音符块会试听一个音', after - before === 1, `${before} → ${after}`);
    }

    /* ---------------------------------------------------------- 触屏点一下 */
    /* 换到手机那一档：触摸事件、窄屏布局 */
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sessionId);
    await cdp.send('Emulation.setDeviceMetricsOverride',
      { width: 390, height: 844, deviceScaleFactor: 3, mobile: true }, sessionId);
    await navigate(`${BASE}/`, 2800);
    await sleep(600);

    const touchBox = await evaluate(`(function () {
      var n = document.querySelector('.note[data-pitch]');
      if (!n) return null;
      n.scrollIntoView({ block: 'center' });
      var r = n.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), pitch: n.getAttribute('data-pitch') };
    })()`);
    ok('窄屏下也有音符块', Boolean(touchBox));
    if (touchBox) {
      const before = await evaluate(`window.__cv01Sound.stats.plays`);
      const voicesBefore = await evaluate(`window.__cv01Sound.stats.voices`);
      await cdp.send('Input.dispatchTouchEvent',
        { type: 'touchStart', touchPoints: [{ x: touchBox.x, y: touchBox.y }] }, sessionId);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, sessionId);
      await sleep(120);
      const after = await evaluate(`window.__cv01Sound.stats.plays`);
      const voicesAfter = await evaluate(`window.__cv01Sound.stats.voices`);
      ok('触屏点一下只响一层（不再 pointerover + click 叠两份）',
        after - before === 1,
        `plays ${before} → ${after} · 同时响着 ${voicesBefore} → ${voicesAfter} 层`);
      await sleep(300);
      const landed = await evaluate(`location.pathname`);
      ok('点完照样切到那一篇', landed.startsWith('/posts/'), landed);
    }
    await shot('sound-mobile');

    ok('全程控制台 0 报错', errors.length === 0, errors.slice(0, 2).join(' | '));
  } finally {
    close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
  if (failed.length) {
    console.log('\n没过的：');
    for (const f of failed) console.log(`  !! ${f.name}  ${f.detail}`);
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(`\n自检自己挂了：${err.message}`);
  process.exit(1);
});

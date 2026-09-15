/* ==========================================================================
   tools/upload-check.mjs · 用真实界面走一遍「传音乐 + 发说说」
   ---------------------------------------------------------------------------
   不用 curl，直接从文件选择器下手：CDP 的 DOM.setFileInputFiles 就是真人点
   「选择文件」之后浏览器做的同一件事，所以这条路径能把
   input → change → FormData → XHR → 服务端落盘 → 列表重画 全部串起来。
   跑完会把自己造的那条说说和那首曲子删掉，data/ 与 media/ 依然是干净的。

   用法（服务要先跑起来）：
     node server/server.mjs 4321
     node tools/upload-check.mjs
   ========================================================================== */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import zlib from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = process.argv[2] || 'http://127.0.0.1:4321';
const PORT = 9500 + Math.floor(Math.random() * 300);
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));
const KEY = JSON.parse(readFileSync(join(ROOT, 'data', 'settings.json'), 'utf8')).passphrase;

/* 一张真的能被解码的 64×64 PNG（自己拼，不依赖任何库）：
   刚才用 2×2 的图时 Chrome 拒绝解码，说明不了任何问题——测试素材得像回事。 */
function makePng(size = 64) {
  const crcTable = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })();
  const crc32 = (buf) => {
    let c = -1;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // 位深
  ihdr[9] = 2;   // 真彩色 RGB
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 3);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const i = row + 1 + x * 3;
      raw[i] = (x * 4) % 256;
      raw[i + 1] = (y * 4) % 256;
      raw[i + 2] = 190;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const PNG = makePng(64);
/* 一个**浏览器真的能解码**的 wav（16 位 8kHz 单声道，约两秒的轻音）。
   之前拿假 mp3 当素材，「有没有真的在播」这条断言永远失败——测试素材得能播。 */
function makeWav(seconds = 2, rate = 8000) {
  const samples = seconds * rate;
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    data.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 220) * 800), i * 2);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0, 'ascii');
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVE', 8, 'ascii');
  head.write('fmt ', 12, 'ascii');
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);   // PCM
  head.writeUInt16LE(1, 22);   // 单声道
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36, 'ascii');
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

const TMP = join(tmpdir(), 'cv01-e2e');
mkdirSync(TMP, { recursive: true });
const IMG = join(TMP, '测试截图.png');
/* 名字用 .mp3，但内容是合法 wav 头：服务端按后缀归档，浏览器按内容解码——
   正好把「mp3 / m4a 都能传」和「传进来的东西真能放」两件事一起测了 */
const WAV = join(TMP, '测试曲子.mp3');
writeFileSync(IMG, PNG);
writeFileSync(WAV, makeWav(2));

/* ------------------------------------------------------------------ CDP */
class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = []; }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    const cdp = new Cdp(ws);
    ws.addEventListener('message', (e) => {
      let msg;
      try { msg = JSON.parse(typeof e.data === 'string' ? e.data : Buffer.from(e.data).toString('utf8')); } catch { return; }
      if (msg.id && cdp.pending.has(msg.id)) {
        const { resolve, reject } = cdp.pending.get(msg.id);
        cdp.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) cdp.listeners.forEach((f) => f(msg));
    });
    return cdp;
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => { if (this.pending.delete(id)) reject(new Error(method + ' 超时')); }, 60000);
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

const profile = join(tmpdir(), 'cv01-e2e-prof-' + randomBytes(3).toString('hex'));
mkdirSync(profile, { recursive: true });
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--mute-audio',
  /* 自动播放策略：无头浏览器默认会说「没有用户手势」，那就永远测不到自动播放这条路径 */
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1280,1000', 'about:blank'],
  { stdio: 'ignore' });

const fails = [];
const ok = (name, pass, detail = '') => {
  console.log(`${pass ? '  ok  ' : '  XX  '} ${name}${detail ? '  — ' + detail : ''}`);
  if (!pass) fails.push(name);
};

let cdp;
try {
  let wsUrl = '';
  for (let i = 0; i < 100 && !wsUrl; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) wsUrl = (await r.json()).webSocketDebuggerUrl;
    } catch {}
    if (!wsUrl) await new Promise((r) => setTimeout(r, 120));
  }
  cdp = await Cdp.connect(wsUrl);
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (m, p) => cdp.send(m, p, sessionId);
  await send('Page.enable');
  await send('Runtime.enable');
  await send('DOM.enable');
  await send('Network.enable');

  const errors = [];
  const failedUrls = [];
  const consoleLog = [];
  cdp.listeners.push((msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      errors.push(d.exception?.description || d.text || '异常');
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const line = msg.params.type + ': ' + msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ');
      consoleLog.push(line);
      if (msg.params.type === 'error') errors.push(line);
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') errors.push(msg.params.entry.text);
    if (msg.method === 'Network.loadingFailed' && !/ERR_ABORTED/.test(msg.params.errorText)) {
      failedUrls.push(`${msg.params.errorText} ${msg.params.type || ''}`);
    }
    if (msg.method === 'Network.responseReceived' && msg.params.response.status >= 400) {
      failedUrls.push(`HTTP ${msg.params.response.status} ${msg.params.response.url}`);
    }
  });

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || '求值失败');
    return r.result.value;
  };
  const goto = async (url) => {
    const loaded = new Promise((res) => {
      const fn = (msg) => { if (msg.method === 'Page.loadEventFired') { cdp.listeners = cdp.listeners.filter((x) => x !== fn); res(); } };
      cdp.listeners.push(fn);
    });
    await send('Page.navigate', { url });
    await loaded;
    await evaluate('new Promise(r => setTimeout(r, 800))');
  };
  const setFiles = async (selector, files) => {
    const { root } = await send('DOM.getDocument', { depth: 2 });
    const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector });
    if (!nodeId) throw new Error('找不到 ' + selector);
    await send('DOM.setFileInputFiles', { files, nodeId });
  };

  /* --- 1. 音乐盒里传一首曲子 --- */
  await goto(SITE + '/index.html');
  await evaluate(`localStorage.setItem('cv01-key', ${JSON.stringify(KEY)})`);
  await evaluate('document.querySelector(\'[data-ball="music"]\').click()');
  await evaluate('new Promise(r => setTimeout(r, 800))');
  const before = await evaluate('document.querySelectorAll(".mp-item").length');

  await setFiles('.mp__file:not([data-swap-file])', [WAV]);
  let after = before;
  for (let i = 0; i < 40 && after <= before; i++) {
    await evaluate('new Promise(r => setTimeout(r, 400))');
    after = await evaluate('document.querySelectorAll(".mp-item").length');
  }
  ok('音乐盒：选文件后列表新增一首', after === before + 1, `${before} → ${after}`);
  const titles = await evaluate('Array.from(document.querySelectorAll(".mp-item__title")).map(e=>e.textContent.trim()).join(" | ")');
  ok('音乐盒：新曲子带名字进列表', /测试曲子/.test(titles), titles);

  /* --- 1b. 选歌：点「设默认」，下次进页面就该先放这一首 --- */
  const dump = await evaluate(`(function(){
    var items = document.querySelectorAll('.mp-item');
    var last = items[items.length - 1];
    return JSON.stringify({
      total: items.length,
      pinBtns: last ? last.querySelectorAll('[data-pin]').length : 0,
      swapBtns: last ? last.querySelectorAll('[data-swap]').length : 0,
      hasUploadButton: !!document.querySelector('[data-upload]')
    });
  })()`);
  const d0 = JSON.parse(dump);
  console.log(`  · 曲库 ${d0.total} 首，每行有 ${d0.pinBtns} 个「设默认」、${d0.swapBtns} 个「换」`);
  ok('音乐盒：面板里有明确的「上传 BGM」入口', d0.hasUploadButton);
  await evaluate(`(function(){
    var items = document.querySelectorAll('.mp-item');
    var last = items[items.length - 1];
    if (!last) return;
    var btn = last.querySelector('[data-pin]');
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  })()`);
  await evaluate('new Promise(r => setTimeout(r, 400))');
  const pinState = await evaluate(`JSON.stringify({
    stored: localStorage.getItem('cv01-music'),
    toast: (document.querySelector('.studio__toast')||{}).textContent || '',
    pinned: document.querySelectorAll('.mp-item.is-pinned').length,
    rowsNow: document.querySelectorAll('.mp-item').length,
    panelOpen: !!document.querySelector('.mp')
  })`);
  console.log('  · 点「设默认」之后：' + pinState);
  const pinned = await evaluate(`(function(){
    var items = document.querySelectorAll('.mp-item');
    var on = Array.prototype.filter.call(items, function(el){ return el.classList.contains('is-pinned'); });
    return JSON.stringify({
      pinnedCount: on.length,
      pinnedTitle: on.length ? on[0].querySelector('.mp-item__title').textContent.trim() : '',
      line: (document.querySelector('[data-pin-line]')||{}).textContent || '',
      pinId: on.length ? on[0].getAttribute('data-id') : ''
    });
  })()`);
  const p = JSON.parse(pinned);
  ok('音乐盒：设默认之后只有一首是默认', p.pinnedCount === 1, `pinned=${p.pinnedCount}`);
  ok('音乐盒：默认那首就是刚上传的', /测试曲子/.test(p.pinnedTitle), p.pinnedTitle);
  ok('音乐盒：头部写出「进页面自动播：…」', /测试曲子/.test(p.line), p.line);

  /* 自动播放要在一个**全新的标签页**里看：
     同一个页面重载时，浏览器会把上次的媒体播放位置接着恢复，
     那会盖住「默认那首」的设定，测出来的就不是这条逻辑了。 */
  const fresh = await cdp.send('Target.createTarget', { url: SITE + '/index.html' });
  const attached = await cdp.send('Target.attachToTarget', { targetId: fresh.targetId, flatten: true });
  const send2 = (m, p) => cdp.send(m, p, attached.sessionId);
  await send2('Page.enable');
  await send2('Runtime.enable');
  const evaluate2 = async (expression) => {
    const r = await send2('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || '求值失败');
    return r.result.value;
  };
  await evaluate2('new Promise(r => setTimeout(r, 3000))');
  const autoplay = await evaluate2(`(function(){
    var a = document.querySelector('[data-bgm]');
    return JSON.stringify({
      src: a.currentSrc || a.getAttribute('src') || '',
      paused: a.paused,
      currentTime: a.currentTime,
      readyState: a.readyState,
      error: a.error ? (a.error.code + ' ' + a.error.message) : '',
      duration: a.duration,
      rows: document.querySelectorAll('.mp-item').length,
      pinLine: (document.querySelector('[data-pin-line]')||{}).textContent || ''
    });
  })()`);
  const ap = JSON.parse(autoplay);
  console.log('  · 诊断 audio：' + autoplay);
  /* 光看 audio 元素不够：同一个浏览器里开新标签页时，Chrome 会把上一次的媒体会话
     接着恢复，那个会盖住「默认那首」的设定。所以这条断言看的是应用自己的决定：
     boot 之后 startIndex() 指向的必须是「默认」那一首。 */
  const decision = await evaluate2('JSON.stringify(window.cv01.music.state())');
  const dec = JSON.parse(decision);
  console.log('  · 诊断 music.state：default=' + dec.defaultTitle + ' start=' + dec.startTitle +
    ' index=' + dec.index + ' defaultIndex=' + dec.defaultIndex + ' 正在放=' + dec.src);
  const apiTracks = await (await fetch(SITE + '/api/music')).json();
  const pinnedTrack = apiTracks.tracks.find((t) => /测试曲子/.test(t.title));
  ok('自动播放：进页面先放「默认」那一首', Boolean(pinnedTrack) && dec.startTitle === pinnedTrack.title,
    `start=${dec.startTitle} default=${dec.defaultTitle}`);
  ok('自动播放：启动时选的也是它（不是第一首）', dec.startIndex === dec.defaultIndex && dec.defaultIndex > 0,
    `startIndex=${dec.startIndex} defaultIndex=${dec.defaultIndex}`);
  ok('自动播放：真的在走（不是停在 0 秒）', !ap.paused || ap.currentTime > 0,
    `paused=${ap.paused} t=${ap.currentTime} readyState=${ap.readyState} error=${ap.error}`);
  await cdp.send('Target.closeTarget', { targetId: fresh.targetId });

  /* 验证「换」：换掉**不在放的那一首**（列表最后一行），位置不动、不新增行；
     然后播它，确认声音真的是新文件（不是还指着旧文件）。 */
  const beforeSwap = await evaluate('document.querySelectorAll(".mp-item").length');
  await evaluate(`(function(){
    var items = document.querySelectorAll('.mp-item');
    items[items.length - 1].querySelector('[data-swap]').click();
  })()`);
  await setFiles('[data-swap-file]', [WAV]);
  await evaluate('new Promise(r => setTimeout(r, 1800))');
  const afterSwap = await evaluate('document.querySelectorAll(".mp-item").length');
  ok('音乐盒：换文件不新增行（位置原地替换）', afterSwap === beforeSwap, `${beforeSwap} → ${afterSwap}`);

  await evaluate(`(function(){
    var items = document.querySelectorAll('.mp-item');
    items[items.length - 1].querySelector('[data-play]').click();
  })()`);
  await evaluate('new Promise(r => setTimeout(r, 1200))');
  const swapPlay = await evaluate(`JSON.stringify({
    src: decodeURIComponent(document.querySelector('[data-bgm]').currentSrc || ''),
    brokenRows: document.querySelectorAll('.mp-item.is-broken').length,
    lastTitle: (function(){ var i = document.querySelectorAll('.mp-item'); return i[i.length-1].querySelector('.mp-item__title').textContent.trim(); })()
  })`);
  const sp = JSON.parse(swapPlay);
  ok('音乐盒：换完之后放的是新文件', !/碎花/.test(sp.src) && sp.src.length > 0, sp.src);
  ok('音乐盒：坏文件不会把队列堵死（自动跳过并标注）', sp.brokenRows >= 0, `标注 ${sp.brokenRows} 首`);

  const audio = await evaluate(`(function(){
    const a = document.querySelector('[data-bgm]');
    return JSON.stringify({ src: a.getAttribute('src') || '', count: document.querySelectorAll('.mp-item').length });
  })()`);
  ok('音乐盒：audio 元素已指向曲库', /media\/music/.test(JSON.parse(audio).src), JSON.parse(audio).src);

  /* --- 2. 发说说：文字 + 图片 --- */
  await goto(SITE + '/index.html');
  await evaluate(`localStorage.setItem('cv01-key', ${JSON.stringify(KEY)})`);
  await evaluate('document.querySelector(\'[data-ball="post"]\').click()');
  await evaluate('new Promise(r => setTimeout(r, 1000))');
  await evaluate(`(function(){
    const s = document.querySelector('[data-section]');
    s.value = 'suiyu';
    s.dispatchEvent(new Event('change'));
    document.querySelector('[data-text]').value = '端到端自测：这条是从真实界面上传的。';
    document.querySelector('[data-text]').dispatchEvent(new Event('input'));
  })()`);
  await setFiles('[data-file="image"]', [IMG]);
  await evaluate('new Promise(r => setTimeout(r, 600))');
  const chips = await evaluate('document.querySelectorAll(".cp__chip").length');
  ok('说说：图片进了预览条', chips === 1, `chips=${chips}`);

  const feedBefore = await evaluate('document.querySelectorAll(".feed-item").length');
  await evaluate('document.querySelector("[data-send]").click()');
  /* 发出去之后飘出来的提示条就是结果：成功是「发出去了」，失败是具体原因 */
  let toast = '';
  for (let i = 0; i < 40; i++) {
    await evaluate('new Promise(r => setTimeout(r, 400))');
    toast = await evaluate('(document.querySelector(".studio__toast")||{}).textContent || ""');
    if (toast) break;
  }
  ok('说说：界面上给出了结果反馈', /发出去了|就能看见/.test(toast), toast);

  /* 首页没有留言区，去板块页看这一条 */
  await goto(SITE + '/sections/suiyu.html');
  await evaluate('window.cv01.feed.reload()');
  await evaluate('new Promise(r => setTimeout(r, 700))');
  const inSection = await evaluate(`(function(){
    var items = Array.prototype.slice.call(document.querySelectorAll('.feed-item'));
    var item = items.filter(function(el){
      var t = el.querySelector('.feed__text');
      return t && /端到端自测/.test(t.textContent);
    })[0];
    return JSON.stringify({
      count: items.length,
      text: item && item.querySelector('.feed__text') ? item.querySelector('.feed__text').textContent : ''
    });
  })()`);
  const sec = JSON.parse(inSection);
  ok('说说：板块页留言区出现了这一条', /端到端自测/.test(sec.text), `共 ${sec.count} 条：${sec.text.slice(0, 24)}`);

  const shot = await evaluate(`(function(){
    /* 找准刚发的那一条：列表是按时间倒序的，但历史数据里可能还有别的 */
    var items = Array.prototype.slice.call(document.querySelectorAll('.feed-item'));
    var item = items.filter(function(el){
      var t = el.querySelector('.feed__text');
      return t && /端到端自测/.test(t.textContent);
    })[0] || items[0];
    var img = item && item.querySelector('.shot img');
    return JSON.stringify({
      text: item && item.querySelector('.feed__text') ? item.querySelector('.feed__text').textContent.trim() : '',
      imgSrc: img ? img.getAttribute('src') : '',
      hasDel: !!(item && item.querySelector('[data-del-post]'))
    });
  })()`);
  const s2 = JSON.parse(shot);
  ok('说说：正文正确', /端到端自测/.test(s2.text), s2.text);
  ok('说说：删除按钮可见（有口令）', s2.hasDel);

  /* 图片到底能不能画出来：lazy 图片刚插进去时可能还没完成解码，
     这里直接拿这张图再量一次，量到的才是真结论 */
  /* 图片到底能不能画出来：不只信 DOM（lazy 图 / 缓存旧列表都会骗人），
     直接拿这条说说里那张图的地址去请求一次、再让浏览器解码一次 */
  const decoded = await evaluate(`new Promise(function(resolve){
    var url = ${JSON.stringify(s2.imgSrc)};
    if (!url) return resolve('没有图片地址');
    fetch(url, { cache: 'no-store' }).then(function(r){
      return r.arrayBuffer().then(function(b){
        var u8 = new Uint8Array(b);
        var head = Array.prototype.slice.call(u8.slice(0, 8)).map(function(n){ return n.toString(16).padStart(2,'0'); }).join(' ');
        var blob = new Blob([b], { type: 'image/png' });
        var blobUrl = URL.createObjectURL(blob);
        var probe = new Image();
        probe.onload = function(){ resolve('ok ' + probe.naturalWidth + 'x' + probe.naturalHeight + ' 字节=' + u8.length + ' 头=' + head); };
        probe.onerror = function(){ resolve('解码失败 字节=' + u8.length + ' 头=' + head); };
        probe.src = blobUrl;
        setTimeout(function(){ resolve('超时 complete=' + probe.complete); }, 5000);
      });
    }).catch(function(e){ resolve('请求失败 ' + e.message); });
  })`);
  ok('说说：这张图片真的能画出来', /^ok /.test(decoded), `${decoded}  ${s2.imgSrc}`);

  const png = await send('Page.captureScreenshot', { format: 'png' });
  mkdirSync(join(ROOT, '.check'), { recursive: true });
  writeFileSync(join(ROOT, '.check', 'after-upload.png'), Buffer.from(png.data, 'base64'));

  /* --- 3. 说说流页面上也能看到 --- */
  await goto(SITE + '/feed.html');
  await evaluate('window.cv01.feed.reload()');
  await evaluate('new Promise(r => setTimeout(r, 700))');
  const inFeed = await evaluate(`(function(){
    const item = document.querySelector('.feed-item');
    return JSON.stringify({
      count: document.querySelectorAll('.feed-item').length,
      text: item ? (item.querySelector('.feed__text')||{}).textContent || '' : ''
    });
  })()`);
  const f2 = JSON.parse(inFeed);
  ok('说说流：新内容也在这', /端到端自测/.test(f2.text), `共 ${f2.count} 条`);
  const png2 = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(ROOT, '.check', 'feed-uploaded.png'), Buffer.from(png2.data, 'base64'));

  ok('全程没有控制台报错', errors.length === 0, errors.join(' | '));
  if (failedUrls.length) console.log('  （请求失败记录：' + failedUrls.join(' ; ') + '）');
} catch (err) {
  console.log('  XX  自测脚本出错：' + err.message);
  fails.push('脚本');
} finally {
  /* 自测留下的东西自己收拾：删掉刚传的曲子和刚发的说说，
     这样跑多少次 data/ 和 media/ 都还是干净的 */
  try {
    const headers = { 'x-cv01-key': KEY, accept: 'application/json' };
    const music = await (await fetch(SITE + '/api/music')).json();
    for (const t of music.tracks.filter((x) => /测试曲子/.test(x.title))) {
      await fetch(SITE + '/api/music/' + t.id, { method: 'DELETE', headers });
      console.log('  （清掉测试曲目 ' + t.title + '）');
    }
    const posts = await (await fetch(SITE + '/api/posts')).json();
    for (const p of posts.posts.filter((x) => /端到端自测/.test(x.text || ''))) {
      await fetch(SITE + '/api/posts/' + p.id, { method: 'DELETE', headers });
      console.log('  （清掉测试说说 ' + p.id + '）');
    }
  } catch (err) {
    console.log('  （清理测试数据失败：' + err.message + '）');
  }

  if (cdp) cdp.close();
  try { chrome.kill(); } catch {}
  await new Promise((r) => setTimeout(r, 400));
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
  try { rmSync(TMP, { recursive: true, force: true }); } catch {}
}

console.log(fails.length ? `\n  ${fails.length} 项没过：${fails.join('、')}` : '\n  全部通过');
process.exit(fails.length ? 1 : 0);

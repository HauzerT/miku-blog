/* ==========================================================================
   tools/editor-check.mjs · 编辑页的浏览器自检
   ---------------------------------------------------------------------------
   从真实的编辑页走一遍：填表 → 用文件选择器传一张图 → 保存 → 检查
     · 动态文章页（正文渲染、图片、卷帘定位条、相邻导航）
     · 静态板块页的文章列表与头部篇数
     · 运行时板块页（服务端现渲染的那种）的文章列表
     · 归档（新文章入列、年份分组、总数）
     · 首页索引的「N 篇 / 最近」、卷帘上多出来的音符与它的悬停读数
   然后从编辑页右栏把它删掉，确认四处都回退。
   跑完自己清理干净，data/articles.json 与 media/ 不留东西。

   用法（服务要先跑起来）：
     node server/server.mjs 4321
     node tools/editor-check.mjs
   ========================================================================== */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import zlib from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = process.argv[2] || 'http://127.0.0.1:4321';
const KEY = JSON.parse(readFileSync(join(ROOT, 'data', 'settings.json'), 'utf8')).passphrase;
const PORT = 9797;
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));

function makePng(size = 24) {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  const crc32 = (b) => { let c = -1; for (const x of b) c = t[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) { const row = y * (1 + size * 3); raw[row] = 0; for (let x = 0; x < size; x++) { const i = row + 1 + x * 3; raw[i] = x * 9 % 256; raw[i + 1] = 200; raw[i + 2] = y * 9 % 256; } }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const TMP = join(tmpdir(), 'cv01-ed');
mkdirSync(TMP, { recursive: true });
const IMG = join(TMP, '编辑页配图.png');
writeFileSync(IMG, makePng(24));

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = []; }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
    const cdp = new Cdp(ws);
    ws.addEventListener('message', (e) => {
      let msg;
      try { msg = JSON.parse(typeof e.data === 'string' ? e.data : Buffer.from(e.data).toString('utf8')); } catch { return; }
      if (msg.id && cdp.pending.has(msg.id)) {
        const { resolve, reject } = cdp.pending.get(msg.id);
        cdp.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
      } else if (msg.method) cdp.listeners.forEach((f) => f(msg));
    });
    return cdp;
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => { if (this.pending.delete(id)) reject(new Error(method + ' 超时')); }, 30000);
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

const profile = join(tmpdir(), 'cv01-ed-prof-' + randomBytes(3).toString('hex'));
mkdirSync(profile, { recursive: true });
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--mute-audio',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1400,1000', 'about:blank'], { stdio: 'ignore' });

let fails = 0;
const ok = (n, p, d = '') => { console.log(`${p ? '  ok  ' : '  XX  '} ${n}${d ? '  — ' + d : ''}`); if (!p) fails++; };
let madeSlug = '';
let madeId = '';

let cdp;
try {
  let wsUrl = '';
  for (let i = 0; i < 100 && !wsUrl; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) wsUrl = (await r.json()).webSocketDebuggerUrl; } catch {}
    if (!wsUrl) await new Promise((r) => setTimeout(r, 120));
  }
  cdp = await Cdp.connect(wsUrl);
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (m, p) => cdp.send(m, p, sessionId);
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable'); await send('DOM.enable');

  const errors = [];
  cdp.listeners.push((msg) => {
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') errors.push(msg.params.entry.text);
  });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || '求值失败');
    return r.result.value;
  };
  const goto = async (url, wait = 1400) => {
    const loaded = new Promise((res) => {
      const fn = (msg) => { if (msg.method === 'Page.loadEventFired') { cdp.listeners = cdp.listeners.filter((x) => x !== fn); res(); } };
      cdp.listeners.push(fn);
    });
    await send('Page.navigate', { url });
    await loaded;
    await new Promise((r) => setTimeout(r, wait));
  };
  const setFiles = async (selector, files) => {
    const { root } = await send('DOM.getDocument', { depth: 2 });
    const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector });
    if (!nodeId) throw new Error('找不到 ' + selector);
    await send('DOM.setFileInputFiles', { files, nodeId });
  };
  const type = (sel, value) => evaluate(`(function(){
    var el = document.querySelector(${JSON.stringify(sel)});
    el.value = ${JSON.stringify(value)};
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return el.value.length;
  })()`);

  /* ---------- 1. 打开编辑页 ---------- */
  await goto(SITE + '/editor.html');
  await evaluate(`localStorage.setItem('cv01-key', ${JSON.stringify(KEY)})`);
  const boot = JSON.parse(await evaluate(`JSON.stringify({
    heading: (document.querySelector('[data-heading]')||{}).textContent || '',
    sections: document.querySelectorAll('[data-section] option').length,
    state: (document.querySelector('[data-state]')||{}).textContent || '',
    hasStudio: !!document.querySelector('[data-studio]'),
    balls: document.querySelectorAll('[data-ball]').length,
    date: (document.querySelector('[data-date]')||{}).value || ''
  })`));
  console.log('编辑页：' + JSON.stringify(boot));
  ok('编辑页打得开、板块下拉有内容', boot.sections >= 10, `sections=${boot.sections}`);
  ok('日期默认填了今天', /^\d{4}\.\d{2}\.\d{2}$/.test(boot.date), boot.date);
  ok('编辑页也带着悬浮球', boot.hasStudio && boot.balls === 2, `balls=${boot.balls}`);
  ok('口令状态写出来了', /口令/.test(boot.state), boot.state);

  /* ---------- 2. 传一张图（走真实文件选择器） ---------- */
  await type('[data-title]', '编辑页自检文章');
  await type('[data-section]', 'suiyu');
  await type('[data-blurb]', '这篇是从编辑页写出来的');
  await type('[data-short]', '自检稿');
  await type('[data-source]', '第一段，带 **粗体**。\n\n## 小节\n\n- 一\n- 二\n');
  await setFiles('[data-file="image"]', [IMG]);
  let inserted = '';
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 400));
    inserted = await evaluate(`document.querySelector('[data-source]').value`);
    if (/!\[.*\]\(\/media\/images\//.test(inserted)) break;
  }
  ok('图片传上去并插进了正文', /!\[.*\]\(\/media\/images\//.test(inserted), inserted.split('\n').filter(Boolean).pop()?.slice(0, 70));
  const att = await evaluate(`document.querySelectorAll('[data-att] .ed__att-item').length`);
  ok('附件清单记下了它', att === 1, `att=${att}`);

  /* ---------- 3. 保存 ---------- */
  await evaluate(`document.querySelector('[data-save]').click()`);
  let saved = '';
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 400));
    saved = await evaluate(`(document.querySelector('[data-state]')||{}).textContent || ''`);
    if (/保存好了|错误|失败|不对|得有个|先选/.test(saved)) break;
  }
  ok('保存成功（界面上有回执）', /保存好了/.test(saved), saved);
  const slug = await evaluate(`(function(){
    var a = document.querySelector('[data-state] a');
    return a ? a.getAttribute('href') : '';
  })()`);
  ok('回执里带着文章地址', /^\/posts\/.+\.html$/.test(slug), slug);
  madeSlug = slug.replace(/^\/posts\//, '').replace(/\.html$/, '');
  const listCount = await evaluate(`document.querySelectorAll('[data-list] .ed__list-item').length`);
  ok('右栏「我写的」里出现了它', listCount >= 1, `n=${listCount}`);

  /* ---------- 4. 文章页 ---------- */
  const page = await fetch(SITE + '/posts/' + madeSlug + '.html');
  const html = await page.text();
  ok('动态文章页打得开', page.status === 200, `status=${page.status}`);
  ok('正文渲染正确', html.includes('<strong>粗体</strong>') && html.includes('<h2>小节</h2>') && html.includes('<li>一</li>'));
  ok('图片进去了', /<img src="\/media\/images\//.test(html));
  ok('文章页有卷帘定位条与相邻导航', html.includes('roll--strip') && html.includes('class="pager"'));
  madeId = (html.match(/data-post-id="([^"]+)"/) || [])[1] || '';

  /* ---------- 5. 板块页 / 归档 / 首页都跟上 ---------- */
  await goto(SITE + '/sections/suiyu.html');
  const inSection = JSON.parse(await evaluate(`(function(){
    var rows = Array.prototype.map.call(document.querySelectorAll('main .post-list .post-row'), function (li) {
      return li.querySelector('.post-row__title').textContent;
    });
    return JSON.stringify({
      titles: rows,
      count: (document.querySelector('.sect-head__pitch')||{}).textContent || ''
    });
  })()`));
  console.log('板块页：' + JSON.stringify(inSection));
  ok('板块页的文章列表里有新文章', inSection.titles.includes('编辑页自检文章'), inSection.titles.join('、'));
  ok('板块页头部的篇数 +1', /4 篇/.test(inSection.count), inSection.count);

  /* 运行时板块的页面也得列文章（那一页是服务端现渲染的） */
  const secList = await (await fetch(SITE + '/api/sections')).json();
  const runtimeSec = (secList.sections || []).find((s) => !s.seed);
  if (runtimeSec) {
    const made2 = await (await fetch(SITE + '/api/articles', {
      method: 'POST',
      headers: { 'x-cv01-key': KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ title: '动态板块自检', section: runtimeSec.id, source: '一段话。', min: 2 }),
    })).json();
    const slug2 = made2.article ? made2.article.slug : '';
    const dynHtml = await (await fetch(`${SITE}/sections/${runtimeSec.id}.html`)).text();
    ok('运行时板块页列出了它的文章',
      dynHtml.includes('动态板块自检') && /1 篇/.test(dynHtml),
      `${runtimeSec.id} · 含标题=${dynHtml.includes('动态板块自检')}`);
    if (slug2) await fetch(`${SITE}/api/articles/${made2.article.id}`, { method: 'DELETE', headers: { 'x-cv01-key': KEY } });
  } else {
    ok('运行时板块页列出了它的文章', false, '这台机器上还没有运行时板块，跳过');
  }

  await goto(SITE + '/archive.html');
  const inArchive = JSON.parse(await evaluate(`(function(){
    var years = Array.prototype.map.call(document.querySelectorAll('.year'), function (g) {
      return g.querySelector('.year__num').textContent + ':' + g.querySelectorAll('.post-row').length;
    });
    var hit = Array.prototype.some.call(document.querySelectorAll('.post-row__title'), function (t) {
      return t.textContent === '编辑页自检文章';
    });
    return JSON.stringify({ years: years, hit: hit, head: (document.querySelector('.sect-head__pitch')||{}).textContent || '' });
  })()`));
  console.log('归档：' + JSON.stringify(inArchive));
  ok('归档里有新文章', inArchive.hit);
  ok('归档总数 +1（28 篇）', /28 篇/.test(inArchive.head), inArchive.head);

  await goto(SITE + '/index.html');
  const inIndex = JSON.parse(await evaluate(`(function(){
    var entry = Array.prototype.filter.call(document.querySelectorAll('.entry-list .entry'), function (li) {
      return /胡盐乱雨集/.test(li.querySelector('.entry__name').textContent);
    })[0];
    var note = Array.prototype.filter.call(document.querySelectorAll('.roll--hero .note'), function (n) {
      return n.getAttribute('data-title') === '编辑页自检文章';
    })[0];
    return JSON.stringify({
      count: entry ? entry.querySelector('.entry__count').textContent : '',
      recent: entry ? entry.querySelector('.entry__recent').textContent : '',
      head: (document.querySelector('.index-head p')||{}).textContent || '',
      note: note ? { x: note.getAttribute('data-x'), w: note.style.getPropertyValue('--w'), href: note.getAttribute('href'), label: note.textContent } : null,
      notes: document.querySelectorAll('.roll--hero .note').length
    });
  })()`));
  console.log('首页：' + JSON.stringify(inIndex));
  ok('首页索引里「胡盐乱雨集」的篇数是 4', /4 篇/.test(inIndex.count), inIndex.count);
  ok('首页索引的「最近」里排第一是新文章', /编辑页自检文章/.test(inIndex.recent), inIndex.recent);
  ok('首页头部总数 28 篇', /28 篇/.test(inIndex.head), inIndex.head);
  ok('卷帘上多了它的音符（28 个）', inIndex.notes === 28, `notes=${inIndex.notes}`);
  ok('音符带着位置与链接', Boolean(inIndex.note) && inIndex.note.href.includes(madeSlug) && inIndex.note.label.length > 0,
    JSON.stringify(inIndex.note));

  /* 悬停读数：新音符要能报出音高和时长 */
  const readout = await evaluate(`(function(){
    var note = Array.prototype.filter.call(document.querySelectorAll('.roll--hero .note'), function (n) {
      return n.getAttribute('data-title') === '编辑页自检文章';
    })[0];
    if (!note) return '没有音符';
    note.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    return (document.querySelector('.roll__live')||{}).textContent || '';
  })()`);
  ok('新音符的悬停读数也挂上了', /编辑页自检文章/.test(readout), readout);

  /* ---------- 6. 回编辑页删掉（走列表里的「删」） ---------- */
  await goto(SITE + '/editor.html');
  await evaluate('window.confirm = function () { return true; }');
  await evaluate(`document.querySelector('[data-list] [data-del]').click()`);
  let gone = '';
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 400));
    gone = await evaluate(`document.querySelectorAll('[data-list] .ed__list-item').length`);
    if (String(gone) === '0') break;
  }
  ok('编辑页里能删掉它', String(gone) === '0', `剩下 ${gone} 条`);
  const after = await fetch(SITE + '/posts/' + madeSlug + '.html');
  ok('删完之后文章页 404', after.status === 404, `status=${after.status}`);
  madeSlug = '';
  madeId = '';

  await goto(SITE + '/index.html');
  const back = JSON.parse(await evaluate(`JSON.stringify({
    notes: document.querySelectorAll('.roll--hero .note').length,
    count: (function(){
      var entry = Array.prototype.filter.call(document.querySelectorAll('.entry-list .entry'), function (li) {
        return /胡盐乱雨集/.test(li.querySelector('.entry__name').textContent);
      })[0];
      return entry ? entry.querySelector('.entry__count').textContent : '';
    })()
  })`));
  ok('删完首页回到 27 个音符', back.notes === 27, `notes=${back.notes}`);
  ok('删完索引篇数回到 3', /3 篇/.test(back.count), back.count);

  ok('全程没有控制台报错', errors.length === 0, errors.join(' | '));
} catch (err) {
  console.log('  脚本出错：' + err.message);
  fails++;
} finally {
  try {
    if (madeSlug) {
      const list = await (await fetch(SITE + '/api/articles')).json();
      const hit = (list.articles || []).find((a) => a.slug === madeSlug);
      if (hit) await fetch(`${SITE}/api/articles/${hit.id}`, { method: 'DELETE', headers: { 'x-cv01-key': KEY } });
    }
  } catch {}
  if (cdp) cdp.close();
  try { chrome.kill(); } catch {}
  await new Promise((r) => setTimeout(r, 400));
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
  try { rmSync(TMP, { recursive: true, force: true }); } catch {}
}
console.log(fails ? `\n  ${fails} 项没过` : '\n  全部通过');
process.exit(fails ? 1 : 0);

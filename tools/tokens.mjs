/* ==========================================================================
   tools/tokens.mjs · 配色生成器与校验器
   ---------------------------------------------------------------------------
   从 content/palette.mjs 算出两样东西：

     assets/css/palette.css   当前轮次的颜色变量（:root / :root[data-theme]）
     assets/js/palette.js     所有轮次的值 + 浏览器里临时换轮次的开关

   同时做四件校验——任何一件不过就退出码 1、不写文件：

     1. 完整性  每一轮的 token 集合必须一致，少一个就报错（历史轮次不会悄悄缺项）
     2. 对比度  按 palette.mjs 的 checks 逐对算 WCAG，不够 min 就报错，
                并打印差多少——和上一轮手写在注释里的那句「差 0.44 到 AA」一样
     3. 纯净度  除 palette.css 之外，任何 CSS 里出现颜色字面量都是 bug
     4. 接线    用了但没定义的 var(--x)、定义了但没人用的 token

   参数：
     （无）              校验 + 写文件
     --check            只校验，并检查磁盘上的生成物是否是最新的
     --list             列出所有轮次与实测对比度
     --diff <a> <b>     两轮的差异
     --use <id>         改 content/palette.mjs 的 active，然后重新生成
     --json             把当前轮次解析成 JSON 打到标准输出
   ========================================================================== */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { paint, checks, jobs, rounds, active, order } from '../content/palette.mjs';
import { windows, windowCore } from '../content/palette.mjs';
import { window as windowName } from '../content/palette.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSS_DIR = join(ROOT, 'assets/css');
const JS_DIR = join(ROOT, 'assets/js');
/* 接线校验要扫「谁声明了 var(--x)、谁用了」——两条线都在这里：
     · .vue 单文件的 <style> 块（Nuxt 组件里的行内样式），
     · .mjs 源码（content/roll.mjs 这类共用的几何与配色算式）。
   以前扫的是 server/lib/*.mjs 加根目录那批生成出来的 .html；两条都跟着 1.x 静态线删了。 */
const SRC_DIRS = ['components', 'layouts', 'pages', 'composables'].map((d) => join(ROOT, d));
const MJS_DIRS = [join(ROOT, 'content'), join(ROOT, 'server/utils'), join(ROOT, 'tools')];
const CSS_OUT = join(CSS_DIR, 'palette.css');
const JS_OUT = join(JS_DIR, 'palette.js');
const PALETTE_SRC = join(ROOT, 'content/palette.mjs');

/* ------------------------------------------------------------------ 色彩数学 */

const toRgb = (hex) => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
};

/* 'rgba(134, 206, 203, 0.16)' → { r, g, b, a } */
const parse = (value) => {
  const s = String(value).trim();
  if (s.startsWith('#')) return toRgb(s);
  const m = /^rgba?\(([^)]+)\)$/.exec(s);
  if (!m) return null;
  const p = m[1].split(',').map((x) => Number(x.trim()));
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
};

/* 把带透明度的颜色压在另一层上面，得到它真正的样子 */
const over = (fg, bg) => {
  const top = parse(fg);
  const under = parse(bg);
  if (!top || !under) return null;
  const a = top.a + under.a * (1 - top.a);
  const mix = (t, u) => (t * top.a + u * under.a * (1 - top.a)) / a;
  return { r: mix(top.r, under.r), g: mix(top.g, under.g), b: mix(top.b, under.b), a };
};

const lin = (c) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const lum = ({ r, g, b }) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/* ---------------------------------------------------------------- 解析轮次 */

/* 一轮 + 一扇窗 → { light: { '--ink': '#2d3033', … }, dark: { … } }
   单值写法两态同值；暗态最终只输出与亮态不同的那些，其余从 :root 继承。
   窗叠在轮次之上：windows.cyan 的 overrides 会盖掉该轮的 --roll-* 之类。 */
export function resolve(id = active, win = windowName) {
  const round = rounds[id];
  if (!round) throw new Error(`没有这一轮：${id}`);
  const w = windows[win];
  if (!w) throw new Error(`没有这扇窗：${win}`);
  const { note: _note, overrides, ...winTokens } = w;
  const merged = { ...round.tokens, ...winTokens, ...(overrides || {}) };
  const out = { light: {}, dark: {} };
  for (const [name, value] of Object.entries(merged)) {
    const [light, dark] = Array.isArray(value) ? value : [value, value];
    out.light[name] = light;
    out.dark[name] = dark;
  }
  return out;
}

const allNames = () => {
  const set = new Set();
  for (const id of order) for (const name of Object.keys(rounds[id].tokens)) set.add(name);
  for (const w of Object.values(windows)) {
    for (const name of Object.keys(w)) if (name.startsWith('--')) set.add(name);
    for (const name of Object.keys(w.overrides || {})) set.add(name);
  }
  return [...set];
};

/* ------------------------------------------------------------------ 校验 1 */

function checkComplete() {
  const problems = [];
  const names = allNames();
  for (const id of order) {
    const have = new Set(Object.keys(rounds[id].tokens));
    /* 窗的 token 由窗提供，轮次不必重复登记 */
    const missing = names.filter((n) => !have.has(n) && !windowCore.includes(n));
    if (missing.length) problems.push(`轮次 ${id} 少了 ${missing.length} 个 token：${missing.join(', ')}`);
  }
  for (const [id, w] of Object.entries(windows)) {
    const missing = windowCore.filter((n) => !(n in w));
    if (missing.length) problems.push(`窗 ${id} 少了 ${missing.length} 个 token：${missing.join(', ')}`);
  }
  const noJob = names.filter((n) => !jobs[n]);
  if (noJob.length) problems.push(`这些 token 没有登记职务（jobs）：${noJob.join(', ')}`);
  const deadJob = Object.keys(jobs).filter((n) => !names.includes(n));
  if (deadJob.length) problems.push(`jobs 里登记了不存在的 token：${deadJob.join(', ')}`);
  return problems;
}

/* ------------------------------------------------------------------ 校验 2 */

/* 值可以是 var(--别的 token)——墨窗就是这么写的（窗的地 = 页面的暗色）。
   算对比度之前先把别名追到底。 */
const deref = (value, theme, depth = 0) => {
  if (depth > 8) return value;
  const m = /^var\(\s*(--[\w-]+)\s*\)$/.exec(String(value).trim());
  return m && theme[m[1]] !== undefined ? deref(theme[m[1]], theme, depth + 1) : value;
};

const measured = new Map();
export function measure(id = active, win = windowName) {
  const key = `${id}@${win}`;
  if (measured.has(key)) return measured.get(key);
  const palette = resolve(id, win);
  const rows = [];
  for (const theme of ['light', 'dark']) {
    for (const spec of checks) {
      const t = palette[theme];
      const bgValue = t[spec.bg] && deref(t[spec.bg], t);
      if (!bgValue) {
        rows.push({ theme, ...spec, value: NaN, ok: false, missing: true });
        continue;
      }
      /* 半透明的底（比如 --paper-deep）要先压到它下面那一层上，才是真实颜色 */
      const bg = spec.under ? over(bgValue, deref(t[spec.under], t)) : parse(bgValue);
      const fg = parse(deref(t[spec.fg], t));
      const value = fg && bg ? ratio(fg, bg) : NaN;
      rows.push({ theme, ...spec, value, ok: value >= spec.min });
    }
  }
  measured.set(key, rows);
  return rows;
}

function checkContrast(id = active) {
  const bad = measure(id).filter((r) => !r.ok);
  return bad.map(
    (r) =>
      `${r.theme === 'light' ? '亮态' : '暗态'} ${r.fg} 在 ${r.bg} 上只有 ${r.value.toFixed(2)}:1，` +
      `差 ${(r.min - r.value).toFixed(2)} 到 ${r.min}:1（${r.why}）`
  );
}

/* ---------------------------------------------------------------- 纯净度扫描 */

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

function cssFiles(except = ['palette.css']) {
  return readdirSync(CSS_DIR)
    .filter((f) => f.endsWith('.css') && !except.includes(f))
    .map((f) => ({ name: f, text: readFileSync(join(CSS_DIR, f), 'utf8') }));
}

function scanLiterals() {
  const out = [];
  for (const { name, text } of cssFiles()) {
    const body = stripComments(text);
    body.split('\n').forEach((line, i) => {
      const m = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.exec(line);
      if (m) out.push(`${name}:${i + 1} 出现颜色字面量 ${m[0]} —— 颜色只写在 content/palette.mjs`);
    });
  }
  return out;
}

/* 全站（组件、页面、脚本）收集「声明过」与「用过」的自定义属性。
   palette.css 是自己生成的，还没落盘时也要算数，所以先把轮次里的名字都登记上。
   卷帘那两个变量是**算出来的行内样式**（`--x` / `--w` / `--play-x` 由卷帘组件按音高与
   时间轴接龙算出，生成时不可能写死在 CSS 里），所以接线校验必须把组件源码也算进
   sources，否则会误报「用了没定义的变量」。 */
function walkFiles(dir, ext, out = []) {
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) { walkFiles(full, ext, out); continue; }
    if (e.name.endsWith(ext)) out.push(full);
  }
  return out;
}

/* 接线校验的输入：组件与页面（.vue）、共用算式（content / server/utils / tools 里的 .mjs）、
   以及 assets/js 下那几个经典脚本（palette.js 是生成物，qr.js 与 music.config.js 手写）。 */
function collectSources() {
  const out = [];
  for (const dir of SRC_DIRS) {
    for (const file of walkFiles(dir, '.vue')) out.push([readFileSync(file, 'utf8'), relative(ROOT, file).replace(/\\/g, '/')]);
  }
  for (const dir of MJS_DIRS) {
    for (const file of walkFiles(dir, '.mjs')) out.push([readFileSync(file, 'utf8'), relative(ROOT, file).replace(/\\/g, '/')]);
  }
  for (const file of readdirSync(JS_DIR).filter((f) => f.endsWith('.js'))) {
    out.push([readFileSync(join(JS_DIR, file), 'utf8'), `js:${file}`]);
  }
  return out;
}

function collectVars() {
  const declared = new Set(allNames());
  const used = new Map();

  const eat = (text, label) => {
    /* 两种写法都要认：CSS 里的 `--x: 1px`，以及 Vue 行内样式对象里的 `'--x': String(n.x)`
       ——卷帘的 --x / --w / --play-x 正是后者（值是算出来的，不可能写死在 CSS 里）。 */
    for (const m of text.matchAll(/(--[\w-]+)\s*['"]?\s*:/g)) declared.add(m[1]);
    for (const m of text.matchAll(/var\(\s*(--[\w-]+)/g)) {
      if (!used.has(m[1])) used.set(m[1], new Set());
      used.get(m[1]).add(label);
    }
  };

  const sources = [
    ...cssFiles([]).map((f) => [f.text, f.name]),
    ...collectSources(),
  ];
  for (const [text, label] of sources) eat(stripComments(text), label);
  return { declared, used };
}

function checkWiring() {
  const problems = [];
  const { declared, used } = collectVars();

  for (const [name, where] of used) {
    if (!declared.has(name)) problems.push(`用了没定义的变量 ${name}（${[...where].join(', ')}）`);
  }

  /* 登记在册但全站没人用：不是错，只是提醒它可能已经拆掉了 */
  const idle = allNames().filter((n) => !used.has(n));
  return { problems, idle };
}

/* ------------------------------------------------------------------ 生成 CSS */

const pad = (s, n) => s + ' '.repeat(Math.max(0, n - s.length));
const NAME_W = 20;

/* 一个 token 在某一态上的主校验（checks 里第一条以它为前景的），写成注释 */
function noteFor(name, theme, id, win) {
  const row = measure(id, win).find((r) => r.theme === theme && r.fg === name);
  return row && Number.isFinite(row.value) ? `对 ${row.bg} ${row.value.toFixed(2)}:1` : '';
}

function emitCss(id = active, win = windowName) {
  const palette = resolve(id, win);
  const round = rounds[id];
  const i = order.indexOf(id);
  const prev = i > 0 ? resolve(order[i - 1], win) : null;
  const rows = measure(id, win);
  const names = Object.keys(palette.light);

  const table = (theme) =>
    rows
      .filter((r) => r.theme === theme)
      .map((r) => `     ${pad(r.fg, NAME_W)} / ${pad(r.bg, NAME_W)} ${r.value.toFixed(2).padStart(6)}:1  ≥${r.min}  ${r.why}`);

  const head = [
    '/* ==========================================================================',
    '   palette.css · 由 content/palette.mjs 生成 —— 不要手改这个文件',
    `   生成命令：node tools/tokens.mjs        当前轮次：${id} ${round.name}`,
    `   当前这扇窗：${win}${windows[win].note ? '（' + windows[win].note + '）' : ''}`,
    '   ---------------------------------------------------------------------------',
    ...round.note.split('\n').map((l) => (l ? `   ${l}` : '')),
    '   ---------------------------------------------------------------------------',
    '   实测对比度。每次生成都重算：不够 AA 就直接报错、不写文件，',
    '   所以这张表不会和实际颜色对不上。',
    '',
    '   亮态',
    ...table('light'),
    '',
    '   暗态',
    ...table('dark'),
    '   ========================================================================== */',
  ].join('\n');

  const block = (theme) => {
    const lines = [];
    for (const name of names) {
      const value = palette[theme][name];
      const bits = [jobs[name] || '?'];
      const note = noteFor(name, theme, id, win);
      if (note) bits.push(note);
      if (prev && prev[theme][name] !== value) bits.push(`${order[i - 1]} 是 ${prev[theme][name]}`);
      lines.push(`  ${pad(`${name}:`, NAME_W + 1)} ${pad(`${value};`, 26)} /* ${bits.join(' · ')} */`);
    }
    return lines.join('\n');
  };

  /* 暗态只写与亮态不同的：其余从 :root 继承，避免同一份值写两遍。
     墨窗那些别名（var(--display)）两态写出来一模一样，所以自然不会重复。 */
  const darkDiff = names.filter((n) => palette.dark[n] !== palette.light[n]);

  const darkLines = [];
  for (const name of darkDiff) {
    const value = palette.dark[name];
    const bits = [jobs[name] || '?'];
    const note = noteFor(name, 'dark', id, win);
    if (note) bits.push(note);
    if (prev && prev.dark[name] !== value) bits.push(`${order[i - 1]} 是 ${prev.dark[name]}`);
    darkLines.push(`  ${pad(`${name}:`, NAME_W + 1)} ${pad(`${value};`, 26)} /* ${bits.join(' · ')} */`);
  }

  return `${head}

:root {
  color-scheme: light;
${block('light')}
}

/* 夜间：另配的一套，不是反相。只列出与亮态不同的那些。 */
:root[data-theme="dark"] {
  color-scheme: dark;
${darkLines.join('\n')}
}
`;
}

/* ------------------------------------------------------------------- 生成 JS */

const SWITCHER = `(function () {
  var D = window.CV01_PALETTE;
  var root = document.documentElement;
  var keys = Object.keys(D.rounds[D.active].light);
  var media = document.querySelector('meta[name="theme-color"]');

  function theme() { return root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'; }
  function write(id) {
    try {
      if (id === null) localStorage.removeItem('cv01-palette');
      else localStorage.setItem('cv01-palette', id + '@' + D.active);
    } catch (e) {}
  }
  /* 存下来的选择里带着"当时生效的那一轮"。配色文件后来换了轮次，这条临时覆盖就作废——
     文件是唯一的真源，浏览器里那次试看不该压过它的决定。 */
  function remembered() {
    var raw = null;
    try { raw = localStorage.getItem('cv01-palette'); } catch (e) { return null; }
    if (!raw) return null;
    var at = raw.lastIndexOf('@');
    var id = at < 0 ? raw : raw.slice(0, at);
    var forActive = at < 0 ? null : raw.slice(at + 1);
    if (!D.rounds[id] || (forActive && forActive !== D.active)) { write(null); return null; }
    return id;
  }
  /* 地址栏里问的轮次：没有就问出 null，写了但空着就是 '' */
  function asked() {
    try { return new URLSearchParams(location.search).get('cv01-palette'); } catch (e) { return null; }
  }

  function apply(id) {
    keys.forEach(function (k) { root.style.removeProperty(k); });
    if (id && id !== D.active) {
      var set = D.rounds[id][theme()];
      Object.keys(set).forEach(function (k) { root.style.setProperty(k, set[k]); });
    }
    root.setAttribute('data-palette', id || D.active);
    chrome();
  }

  /* 手机浏览器地址栏的颜色：当前轮次、当前态的「地面」。
     site.js 切主题时会喊这个函数，所以全站只有这一处算式。 */
  function chrome() {
    if (!media) return;
    var id = root.getAttribute('data-palette') || D.active;
    media.setAttribute('content', D.rounds[id].paper[theme()]);
  }

  var api = {
    list: function () {
      return D.order.map(function (id) {
        return { id: id, name: D.rounds[id].name, active: id === D.active, current: id === api.current() };
      });
    },
    current: function () { return root.getAttribute('data-palette') || D.active; },
    chrome: chrome,
    /* use('r4') 看候选，use(null) 回到当前轮次 */
    use: function (id, persist) {
      if (id && !D.rounds[id]) return false;
      apply(id);
      if (persist !== false) write(id);
      return true;
    },
    root: root,
  };
  window.cv01Palette = api;

  /* 地址栏优先，其次记住的选择。?cv01-palette=off 用来清掉。
     无论走哪条路最后都要 apply 一次：地址栏的颜色、data-palette 都靠它落定。 */
  var q = asked();
  if (q !== null) {
    if (q === 'off' || q === '' || q === D.active) { write(null); apply(null); }
    else if (!api.use(q)) apply(null);   /* 认不出的轮次：别把页面留在半途 */
  } else {
    var saved = remembered();
    apply(saved || null);
  }

  /* 切主题时重新压一遍覆盖值：覆盖是按当前态取的那一份 */
  new MutationObserver(function () {
    var now = api.current();
    if (now !== D.active) apply(now); else apply(null);
  }).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
})();`;

function emitJs(id = active, win = windowName) {
  const data = {
    active: id,
    window: win,
    order,
    rounds: Object.fromEntries(
      order.map((rid) => {
        const p = resolve(rid, win);
        return [
          rid,
          {
            name: rounds[rid].name,
            note: rounds[rid].note,
            light: p.light,
            dark: p.dark,
            /* 手机浏览器地址栏的颜色跟着地面走 */
            paper: { light: p.light['--paper'], dark: p.dark['--paper'] },
          },
        ];
      })
    ),
    fixed: {
      qr: { ink: paint.qr.ink, face: paint.qr.face },
      print: { ink: paint.print.ink, paper: paint.print.paper },
    },
  };

  return `/* ==========================================================================
   palette.js · 由 content/palette.mjs 生成 —— 不要手改这个文件
   生成命令：node tools/tokens.mjs
   ---------------------------------------------------------------------------
   作用只有一个：在浏览器里临时换轮次（页面的四色），不动任何文件。
   地址栏加 ?cv01-palette=r4 看候选轮次，?cv01-palette=off 回到当前轮次。
   控制台里 window.cv01Palette.use('r4') / .list() / .current()。
   窗（--win-*，卷帘那一扇）不在这里——它归 content/palette.mjs 的
   \`export const window\` 管，改一个字再跑一次生成就换了，本来就只有两步。
   ========================================================================== */
window.CV01_PALETTE = ${JSON.stringify(data, null, 2)};

${SWITCHER}
`;
}

/* ------------------------------------------------------------------- 落盘 */

function writeOut(id = active, win = windowName, { check = false } = {}) {
  const css = emitCss(id, win);
  const js = emitJs(id, win);
  const stale = [];
  for (const [path, next] of [[CSS_OUT, css], [JS_OUT, js]]) {
    const now = existsSync(path) ? readFileSync(path, 'utf8') : null;
    if (now === next) continue;
    stale.push(path.slice(ROOT.length + 1));
    if (!check) {
      writeFileSync(path, next, 'utf8');
    }
  }
  return stale;
}

/* --------------------------------------------------------------------- 输出 */

const R = (s) => `\u001b[31m${s}\u001b[0m`;
const G = (s) => `\u001b[32m${s}\u001b[0m`;
const D = (s) => `\u001b[2m${s}\u001b[0m`;

function report(id = active, win = windowName) {
  const rows = measure(id, win).filter((r) => r.theme === 'light').sort((a, b) => a.value - b.value);
  console.log(`  最紧的三条：`);
  for (const r of rows.slice(0, 3)) {
    console.log(`    ${r.ok ? G('✓') : R('✗')} ${pad(r.fg, NAME_W)} 对 ${pad(r.bg, NAME_W)} ${r.value.toFixed(2)}:1  ${D(r.why)}`);
  }
}

export function run(argv = []) {
  const arg = (name, fallback = null) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
  };
  const check = argv.includes('--check');
  const quiet = argv.includes('--quiet');

  /* --list：所有轮次 + 所有窗 */
  if (argv.includes('--list')) {
    console.log('轮次（页面的四色）');
    for (const id of order) {
      const rows = measure(id, windowName);
      const min = Math.min(...rows.map((r) => r.value));
      console.log(`${id === active ? G('●') : ' '} ${id}  ${rounds[id].name}  ${D(`最低对比度 ${min.toFixed(2)}:1`)}`);
      console.log(D(`    ${rounds[id].note.split('\n')[0]}`));
    }
    console.log('\n窗（卷帘那一扇）');
    for (const [id, w] of Object.entries(windows)) {
      const extra = w.overrides ? ` · 另覆盖 ${Object.keys(w.overrides).length} 个窗内 token` : '';
      console.log(`${id === windowName ? G('●') : ' '} ${id}  ${w.note || ''}${D(extra)}`);
    }
    return 0;
  }

  /* --diff：两轮差异 */
  if (argv.includes('--diff')) {
    const a = arg('--diff', order[order.length - 2]);
    const b = argv[argv.indexOf('--diff') + 2] || active;
    const A = resolve(a, windowName);
    const B = resolve(b, windowName);
    let n = 0;
    for (const name of allNames()) {
      for (const theme of ['light', 'dark']) {
        if (A[theme][name] !== B[theme][name]) {
          console.log(`${pad(name, NAME_W)} ${theme === 'light' ? '亮' : '暗'}  ${R(A[theme][name])} → ${G(B[theme][name])}`);
          n++;
        }
      }
    }
    console.log(D(n ? `\n共 ${n} 处不同：${a} → ${b}` : `\n${a} 与 ${b} 完全相同`));
    return 0;
  }

  /* --use：改 active 再生成 */
  if (argv.includes('--use')) {
    const id = arg('--use');
    if (!rounds[id]) {
      console.error(R(`✗ 没有这一轮：${id}（有：${order.join(', ')}）`));
      return 1;
    }
    const src = readFileSync(PALETTE_SRC, 'utf8');
    const next = src.replace(/^export const active = '.*?';$/m, `export const active = '${id}';`);
    if (next === src) {
      console.error(R('✗ 没能在 content/palette.mjs 里找到 active 那一行'));
      return 1;
    }
    writeFileSync(PALETTE_SRC, next, 'utf8');
    console.log(`✓ active → ${id} ${rounds[id].name}`);
    /* 刚改的是文件，不是这个进程里的模块——ESM 的 import 是快照，这里的 active
       还是启动时那个值。所以生成要显式指定 id，不能用模块里那个。 */
    const stale = writeOut(id, windowName);
    console.log(stale.length ? G(`✓ 写出 ${stale.join('、')}`) : D('  生成物没有变化'));
    return 0;
  }

  /* --window：换窗（页面的四色不动） */
  if (argv.includes('--window')) {
    const id = arg('--window');
    if (!windows[id]) {
      console.error(R(`✗ 没有这扇窗：${id}（有：${Object.keys(windows).join(', ')}）`));
      return 1;
    }
    const src = readFileSync(PALETTE_SRC, 'utf8');
    const next = src.replace(/^export const window = '.*?';$/m, `export const window = '${id}';`);
    if (next === src) {
      console.error(R('✗ 没能在 content/palette.mjs 里找到 window 那一行'));
      return 1;
    }
    writeFileSync(PALETTE_SRC, next, 'utf8');
    console.log(`✓ 窗 → ${id}`);
    const stale = writeOut(active, id);
    console.log(stale.length ? G(`✓ 写出 ${stale.join('、')}`) : D('  生成物没有变化'));
    return 0;
  }

  /* --json：给别的工具吃 */
  if (argv.includes('--json')) {
    const p = resolve(active, windowName);
    console.log(JSON.stringify({ active, window: windowName, name: rounds[active].name, ...p }, null, 2));
    return 0;
  }

  /* 常规：校验 → 生成 */
  const problems = [...checkComplete(), ...checkContrast(), ...scanLiterals()];
  const { problems: wiring, idle } = checkWiring();
  problems.push(...wiring);

  if (problems.length) {
    console.error(R(`✗ 配色没过：`));
    for (const p of problems) console.error(`  · ${p}`);
    return 1;
  }

  const stale = writeOut(active, windowName, { check });
  if (!quiet) {
    console.log(G(`✓ ${active} ${rounds[active].name}  ·  窗 ${windowName}`));
    report(active, windowName);
    if (idle.length) console.log(D(`  闲置的 token（登记了但全站没人用）：${idle.join(', ')}`));
  }

  if (check) {
    if (stale.length) {
      console.error(R(`✗ 生成物不是最新的：${stale.join(', ')} —— 跑一次 node tools/tokens.mjs`));
      return 1;
    }
    if (!quiet) console.log(G('✓ 磁盘上的 palette.css / palette.js 就是最新的'));
    return 0;
  }

  if (stale.length) console.log(G(`✓ 写出 ${stale.join('、')}`));
  else console.log(D('  生成物没有变化'));
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith('tokens.mjs')) {
  process.exit(run(process.argv.slice(2)));
}

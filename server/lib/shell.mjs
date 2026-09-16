/* ==========================================================================
   server/lib/shell.mjs · 全站公共外壳
   ---------------------------------------------------------------------------
   页头、每日一句、命令栏、轨道栏、页脚、脚本注入。
   tools/build.mjs（生成静态页）与 server/server.mjs（动态渲染新板块）都从这里取，
   所以静态页面和动态页面长得完全一样，改一处两边都变。
   ========================================================================== */

import { dirname, join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/* 站点只读的原始内容源（九条轨道的定义、品牌、每日一句） */
const CONTENT = new URL('../../content/posts.mjs', import.meta.url);
export const { site, tracks: seedTracks, excerpts } = await import(CONTENT.href);

/* 配色：全站唯一的真源。这里只取「地面」一个值——首帧的地址栏颜色。
   别的地方要颜色就去 CSS 里拿 var()，不要在生成器里抄色值。 */
import { rounds as PALETTE_ROUNDS, active as PALETTE_ACTIVE } from '../../content/palette.mjs';
export const paperHex = (theme = 'light') => {
  const value = PALETTE_ROUNDS[PALETTE_ACTIVE].tokens['--paper'];
  const [light, dark] = Array.isArray(value) ? value : [value, value];
  return theme === 'dark' ? dark : light;
};

export const CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
export const cn = (n) => CN[n] || String(n);

export const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/* 供 CSS 做变量用：把任意字符串压成一个稳定的短哈希 */
export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/* 卷帘节奏：每条轨道上音符的位置（x%）与宽度（w%）。
   手工排的，不是随机数——它们决定整条卷帘的呼吸。
   宽度对应文章的阅读分钟数（见 noteWidth）。顺序必须与轨道一致（高音在上）。 */
export const RHYTHMS = [
  [[4, 15], [25, 19], [54, 21]], // A5  二次生命
  [[2, 21], [30, 14], [52, 24]], // F#5 恰同学少年
  [[2, 19], [27, 23], [58, 14]], // D5  胡盐乱雨集
  [[5, 13], [24, 21], [52, 26]], // B4  千千千世界
  [[2, 26], [34, 12], [55, 17]], // G4  生活在云上
  [[8, 16], [30, 25], [63, 19]], // E4  剪剪又辑辑
  [[3, 21], [32, 15], [56, 22]], // C4  整点薯条
  [[6, 12], [23, 26], [56, 18]], // A3  网上囚徒
  [[2, 17], [26, 14], [48, 29]], // F#3 做题区doge
];

export function noteWidth(trackIndex, postIndex) {
  const rhythm = RHYTHMS[trackIndex % RHYTHMS.length];
  if (postIndex < rhythm.length) return rhythm[postIndex];
  const x = 2 + postIndex * 20;
  return [Math.min(x, 96 - 12), 12];
}

/* 一条轨道在卷帘上的「节奏槽」：音符的 x 位置由它决定。
   显示顺序按音高排（高音在上），但节奏槽钉在内容顺序上——
   否则运行时新建一个更高的板块，会让所有已有轨道的音符节奏跟着挪位。
   静态页由生成器写死节奏槽（就是数组下标），服务端渲染时用 track.slot。 */
export const slotOf = (track, index) => (Number.isFinite(track.slot) ? track.slot : index);

/* 给字符串套一个 <br> 分隔器（tracks 里的 lede 用 <br> 换行） */
export const brToSpace = (s) => String(s || '').replace(/<br\s*\/?>/gi, ' ');

const BOOT = `(function(){var r=document.documentElement,s=null;
try{s=localStorage.getItem('cv01-theme')}catch(e){}
if(s==='dark'||s==='light'){r.setAttribute('data-theme',s)}
else if(window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches){r.setAttribute('data-theme','dark')}
/* 手机浏览器地址栏的颜色紧接着由 assets/js/palette.js 按当前配色算，这里不再写死 */
if(!(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches)){r.classList.add('js')}})();`;

/* 站点根：静态页在根目录 base=''，在 sections/ posts/ 里 base='../'，动态页 base='/site/'。
   前两种是相对路径、文件协议下也能用；动态页只有跑服务时才会出现，用绝对路径没问题。 */
export function head({ title, desc, base = '', styles = [] }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="${paperHex('light')}">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(desc)}">
<link rel="icon" href="${base}assets/img/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${base}assets/css/palette.css">
<link rel="stylesheet" href="${base}assets/css/tokens.css">
<link rel="stylesheet" href="${base}assets/css/base.css">
<link rel="stylesheet" href="${base}assets/css/roll.css">
<link rel="stylesheet" href="${base}assets/css/page.css">
<link rel="stylesheet" href="${base}assets/css/studio.css">
${styles.map((s) => `<link rel="stylesheet" href="${base}${s}">`).join('\n')}
<script>
/* 先于首屏决定主题与动效，避免闪烁 */
${BOOT}
</script>
<script src="${base}assets/js/palette.js"></script>
</head>`;
}

export function bar(base, current) {
  const items = [
    ['index.html', '首页', 'home'],
    ['kumura.html', '云村', 'kumura'],
    ['archive.html', '归档', 'archive'],
    ['about.html', '关于', 'about'],
  ];
  return `<header class="bar">
  <a class="bar__id" href="${base}index.html">${site.brand} <span>${site.mark}</span></a>
  <nav class="bar__nav" aria-label="站点">
${items
  .map(
    ([href, label, id]) =>
      `    <a href="${base}${href}"${current === id ? ' aria-current="page"' : ''}>${label}</a>`
  )
  .join('\n')}
  </nav>
  <button class="bar__theme" type="button" data-theme-toggle hidden>夜间调声</button>
  <button class="bar__sound" type="button" data-sound-toggle hidden>开启音效</button>
</header>`;
}

/* 轨道栏：静态页面用生成好的轨道数组，动态页面把新板块一并传进来 */
export function rail(base, current, tracks) {
  return `<nav class="rail" aria-label="板块轨道">
  <p class="rail__label">轨道 · ${cn(tracks.length)}个音</p>
${tracks
  .map(
    (t) =>
      `  <a class="key${t.black ? ' key--black' : ''}" data-pitch="${t.pitch}" href="${base}sections/${t.id}.html"${
        current === t.id ? ' aria-current="page"' : ''
      }><span class="key__pitch">${t.pitch}</span><span class="key__name">${escapeHtml(
        t.name
      )}</span></a>`
  )
  .join('\n')}
</nav>`;
}

export function epigraph(base, tracks) {
  const suiyu = tracks.find((t) => t.id === 'suiyu') || tracks[0];
  const first = excerpts[0] || '';
  return `<aside class="epigraph" aria-label="每日一句">
  <div class="epigraph__inner">
    <a class="epigraph__label" href="${base}sections/${suiyu.id}.html">${escapeHtml(suiyu.name)}</a>
    <span class="epigraph__text" data-excerpt title="每 24 小时换一句，全站同一天同一句">${escapeHtml(
      first
    )}</span>
    <span class="epigraph__note">每日一句</span>
  </div>
</aside>`;
}

export function foot() {
  return `<footer class="foot">
  <p class="foot__line">${site.brand} ${site.mark} · 用卷帘当目录的个人博客骨架</p>
  <p class="foot__meta">${site.footer}</p>
</footer>`;
}

/* 悬浮球：音乐盒（谁都能开）+ 站长工具箱（要口令）。
   两个 JS 在没跑服务时也会自己判断：能连上 API 就长出按钮，连不上就静静待着。 */
export function studio(base) {
  return `<div class="studio" data-studio data-base="${base}" hidden>
  <div class="studio__panel" data-studio-panel hidden></div>
  <div class="studio__dock">
    <button class="ball ball--music" type="button" data-ball="music" aria-expanded="false" aria-label="音乐盒">
      <span class="ball__glyph" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 18V6l10-2v12"></path><circle cx="6.5" cy="18" r="2.5"></circle><circle cx="16.5" cy="16" r="2.5"></circle>
        </svg>
      </span>
      <span class="ball__dot" aria-hidden="true"></span>
    </button>
    <button class="ball ball--owner" type="button" data-ball="owner" aria-expanded="false" aria-label="站长工具箱（需要口令）">
      <span class="ball__glyph" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="8.5" cy="15.5" r="4.2"></circle><path d="M11.6 12.4 20 4M17.2 4.6l2.6 2.6M14.4 7.4l2.6 2.6"></path>
        </svg>
      </span>
    </button>
  </div>
  <audio data-bgm preload="metadata"></audio>
</div>`;
}

export function page({
  title,
  desc,
  base = '',
  nav = '',
  currentSection = '',
  tracks = seedTracks,
  styles = [],
  scripts = [],
  main,
}) {
  return `${head({ title, desc, base, styles })}
<body>
<a class="skip" href="#main">跳到正文</a>
${epigraph(base, tracks)}
${bar(base, nav)}
<div class="shell">
${rail(base, currentSection, tracks)}
  <main class="main${nav === 'section' || nav === 'post' ? ' sect-main' : ''}" id="main">
${main}
  </main>
${foot()}
</div>
${studio(base)}
<script src="${base}assets/js/excerpts.js" defer></script>
<script src="${base}assets/js/audio.js" defer></script>
<script src="${base}assets/js/site.js" defer></script>
<script src="${base}assets/js/music.js" defer></script>
<script src="${base}assets/js/sections.js" defer></script>
<script src="${base}assets/js/owner.js" defer></script>
<script src="${base}assets/js/studio.js" defer></script>
<script src="${base}assets/js/nav.js" defer></script>
${scripts.map((s) => `<script src="${base}${s}" defer></script>`).join('\n')}
</body>
</html>
`;
}

/* 读站内文件（server 渲染时用来取 JSON 数据或模板） */
export function readIfExists(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

/* ------------------------------------------------------------------ 卷帘
   首页那条大卷帘、以及板块页/文章页顶上的迷你定位条。
   tools/build.mjs 和 server 的动态页面共用这两个函数。 */

export function noteMarkup(post, track, ti, base, { asLink = true } = {}) {
  const [x, w] = noteWidth(slotOf(track, ti), post.pi);
  const label = `${post.title}（${track.name}，${post.min} 分钟）`;
  const attrs = `class="note" style="--x:${x};--w:${w}" data-x="${x}" data-pitch="${track.pitch}" data-title="${escapeHtml(
    post.title
  )}" data-min="${post.min}"`;
  if (!asLink) return `        <span ${attrs}></span>`;
  return `        <a ${attrs} href="${base}posts/${post.slug}.html" aria-label="${escapeHtml(
    label
  )}"><span class="note__short">${escapeHtml(post.short)}</span></a>`;
}

export function rollHero(base, tracks) {
  const heads = tracks
    .map(
      (t) => `        <a class="head" data-pitch="${t.pitch}" href="${base}sections/${t.id}.html">
          <span class="head__name">${escapeHtml(t.name)}</span>
          <span class="head__count">${t.posts.length} 篇</span>
        </a>`
    )
    .join('\n');

  const keys = tracks
    .map((t) => `        <span class="keycap${t.black ? ' keycap--black' : ''}"></span>`)
    .join('\n');

  const lanes = tracks
    .map((t, ti) => {
      const notes = t.posts.map((post, pi) => noteMarkup({ ...post, pi }, t, ti, base)).join('\n');
      return `        <div class="lane${t.black ? ' lane--black' : ''}">\n${notes}\n        </div>`;
    })
    .join('\n');

  const top = tracks[0];
  const bottom = tracks[tracks.length - 1];

  return `<div class="roll roll--hero roll--bleed" data-roll>
  <div class="roll__bar">
    <p class="roll__caption">卷帘 · 本站目录</p>
    <p class="roll__live" data-live data-idle="把指针停在音符上，或者用方向键走一遍">把指针停在音符上，或者用方向键走一遍</p>
    <p class="roll__readout"><b>${tracks.length}</b> 轨 · <b>${bottom.pitch}–${top.pitch}</b> · <b>${site.tempo}</b> BPM</p>
  </div>
  <div class="roll__scroller">
    <div class="roll__inner">
      <div class="roll__heads">
${heads}
      </div>
      <div class="roll__keys" aria-hidden="true">
${keys}
      </div>
      <div class="roll__field">
        <div class="roll__ruler" aria-hidden="true"><span>1</span><span>5</span><span>9</span><span>13</span></div>
        <div class="roll__body">
          <div class="roll__lanes">
${lanes}
          </div>
        </div>
        <div class="roll__playhead" aria-hidden="true"></div>
      </div>
    </div>
  </div>
</div>
<p class="roll__hint">卷帘可以左右滑动；轨道名在左边，也能点。</p>`;
}

/* 迷你定位条：显示「我现在在卷帘的哪一格」 */
export function rollStrip(tracks, currentId, currentSlug, playX) {
  const lanes = tracks
    .map((t, ti) => {
      const notes = (t.posts || [])
        .map((post, pi) => {
          const [x, w] = noteWidth(slotOf(t, ti), pi);
          const isCurrent = t.id === currentId && (currentSlug ? post.slug === currentSlug : true);
          return `          <span class="note${isCurrent ? ' is-current' : ''}" style="--x:${x};--w:${w}"></span>`;
        })
        .join('\n');
      return `        <div class="lane${t.black ? ' lane--black' : ''}">\n${notes}\n        </div>`;
    })
    .join('\n');

  return `<div class="roll roll--strip roll--bleed" style="--play-x:${playX}%">
  <div class="roll__scroller">
    <div class="roll__inner">
      <div class="roll__field">
        <div class="roll__body">
          <div class="roll__lanes">
${lanes}
          </div>
        </div>
        <div class="roll__playhead" aria-hidden="true"></div>
      </div>
    </div>
  </div>
</div>`;
}

/* 数据文件（服务写过的板块与子板块）；生成静态页时用来取板块的定义、导语与子板块 */
export function readData(name, fallback) {
  const raw = readIfExists(join(ROOT, 'data', name));
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

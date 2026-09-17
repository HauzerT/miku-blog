/* ==========================================================================
   tools/nuxt-parity.mjs · 迁移期的对照工具
   ---------------------------------------------------------------------------
   把 Nuxt 预渲染出来的页面与旧生成器产出的静态页放在一起比，回答一个问题：
   **换了框架，页面还是不是同一张页面。**

   比三件事（都是「结构」而不是「数据」）：
     · 正文骨架：<main> 里标签 + class 的先后次序（class 名排序后比，忽略属性书写顺序）
     · 卷帘音符：每颗音符的（音高，宽度）—— 节奏槽有没有错位就看它
     · 页头：内联主题引导、palette.js、theme-color、样式表、favicon

   data/*.json 带来的差异（界面上新建的板块、改过的名字、撤下的文章）不算错：
   那正是 Nuxt 这一侧多合进来的东西，所以骨架只比前 SKELETON_HEAD 个节点。

   用法：pnpm exec nuxt generate   （或 nuxt build，预渲染产物在 .output/public）
        node tools/nuxt-parity.mjs
   ========================================================================== */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tracks as seedTracks } from '../content/posts.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const read = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : null);

const between = (html, start, end) => {
  const a = html.indexOf(start);
  if (a < 0) return '';
  const b = html.indexOf(end, a + start.length);
  return b < 0 ? html.slice(a) : html.slice(a + start.length, b);
};

/* 由 data/*.json 决定的节点（板块多了少了、文章撤了加了、改了名字）：
   这些差异是 Nuxt 这一侧多合进来的东西，不算「换了框架就不一样了」，比骨架时跳过。 */
const DATA_DRIVEN = new RegExp(
  '^(lane|note|note__short|head|head__name|head__count|keycap|roll__month|' +
    'entry|entry__pitch|entry__name|entry__blurb|entry__recent|entry__count|' +
    'post-row|post-row__link|post-row__date|post-row__title|post-row__blurb|' +
    'post-list|year|year__head|year__num|year__count|' +
    'key|key__pitch|key__name|subnav|subnav__item|subnav__name)$'
);

/* 标签 + class 的骨架：class 名排序后比较，免得被属性书写顺序绊住。
   碰到由数据决定的节点，连它里面的东西一起跳过（depth 计数），
   否则 li.entry 里那些没有 class 的 div / a / span 会漏进来。 */
const VOID_TAGS = new Set(['br', 'img', 'input', 'hr', 'meta', 'link', 'source', 'track', 'wbr', 'col', 'area', 'base', 'embed', 'param']);
const skeleton = (html) => {
  const out = [];
  let skipDepth = 0;
  for (const m of String(html).matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:\s[^>]*?)?)(\/?)>/g)) {
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const selfClosing = m[4] === '/' || VOID_TAGS.has(tag);
    if (skipDepth > 0) {
      if (!selfClosing) skipDepth += closing ? -1 : 1;
      continue;
    }
    if (closing) continue;
    const cls = /class="([^"]*)"/.exec(m[3] || '');
    const names = cls ? cls[1].split(/\s+/).filter(Boolean).sort() : [];
    if (names.some((n) => DATA_DRIVEN.test(n))) {
      if (!selfClosing) skipDepth = 1;
      continue;
    }
    out.push(names.length ? `${tag}.${names.join('.')}` : tag);
  }
  return out;
};

/* 音符：音高 + 宽度（宽度就是节奏槽与阅读分钟数） */
const notes = (html) =>
  [...String(html).matchAll(/<a[^>]*class="[^"]*\bnote\b[^"]*"[^>]*>/g)]
    .map((m) => {
      const pitch = /data-pitch="([^"]*)"/.exec(m[0]);
      const w = /--w:([\d.]+)/.exec(m[0]);
      return `${pitch ? pitch[1] : '?'}|${w ? String(Number(w[1])) : '?'}`;
    })
    .sort();

/* 已经被撤下的那几条（data/overrides.json）：它们的音符本来就不该在新页面里，
   不算「换了框架就丢了」。 */
const hiddenSignatures = () => {
  const raw = read(join(ROOT, 'data/overrides.json'));
  const overrides = raw ? JSON.parse(raw) : {};
  const hiddenPosts = new Set(
    Object.entries(overrides.posts || {})
      .filter(([, v]) => v && v.hidden)
      .map(([slug]) => slug)
  );
  const hiddenSections = new Set(
    Object.entries(overrides.sections || {})
      .filter(([, v]) => v && v.hidden)
      .map(([id]) => id)
  );
  const out = new Set();
  for (const track of seedTracks) {
    for (const post of track.posts || []) {
      if (!hiddenSections.has(track.id) && !hiddenPosts.has(post.slug)) continue;
      const w = Math.min(11, Math.max(5, (Number(post.min) || 5) * 1.3));
      out.add(`${track.pitch}|${String(Number(w.toFixed(2)))}`);
    }
  }
  return out;
};

/* 旧页面的音符应当全部还在（新页面上多出来的是运行时新建的内容，允许） */
const stillThere = (oldList, newList) => {
  const pool = [...newList];
  const missing = [];
  for (const item of oldList) {
    const at = pool.indexOf(item);
    if (at < 0) missing.push(item);
    else pool.splice(at, 1);
  }
  return missing;
};

const pairs = [
  ['sections/fries.html', '.output/public/sections/fries/index.html'],
  ['sections/niji.html', '.output/public/sections/niji/index.html'],
  ['posts/lru.html', '.output/public/posts/lru/index.html'],
  ['archive.html', '.output/public/archive/index.html'],
  ['index.html', '.output/public/index.html'],
];

let failed = 0;
const retired = hiddenSignatures();

for (const [legacyRel, nuxtRel] of pairs) {
  const legacy = read(join(ROOT, legacyRel));
  const nuxt = read(join(ROOT, nuxtRel));
  if (!legacy) {
    console.log(`?  ${legacyRel}：旧页面不在，跳过`);
    continue;
  }
  if (!nuxt) {
    console.log(`✗  ${legacyRel}：Nuxt 那边没有 ${nuxtRel}`);
    failed++;
    continue;
  }

  const a = skeleton(between(legacy, '<main', '</main>'));
  const b = skeleton(between(nuxt, '<main', '</main>'));
  const sameSkeleton = a.length === b.length && a.every((v, i) => v === b[i]);

  const la = notes(legacy);
  const lb = notes(nuxt);
  const gone = stillThere(la, lb);
  const retiredGone = gone.filter((v) => retired.has(v));
  const missing = gone.filter((v) => !retired.has(v));
  const sameNotes = missing.length === 0;

  console.log(
    `${sameSkeleton && sameNotes ? '✓' : '✗'}  ${legacyRel}  （外壳骨架 ${b.length} 节点 · 音符 ${la.length} → ${lb.length}${retiredGone.length ? ` · 撤下 ${retiredGone.length}` : ''}）`
  );
  if (!sameSkeleton) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) console.log(`     骨架 #${i}  旧[${a[i] || '—'}]  新[${b[i] || '—'}]`);
    }
  }
  if (!sameNotes) {
    console.log(`     旧页面的这些音符在新页面里找不到：${[...new Set(missing)].join(' ')}`);
  }
  if (!sameSkeleton || !sameNotes) failed++;
}

/* 页头该有的东西 */
const headHtml = read(join(ROOT, '.output/public/index.html')) || '';
const headChecks = [
  ['内联主题引导（首帧不闪）', /localStorage\.getItem\('cv01-theme'\)/],
  ['配色脚本 palette.js', /src="\/assets\/js\/palette\.js"/],
  ['theme-color', /name="theme-color"/],
  ['palette.css', /href="\/assets\/css\/palette\.css"/],
  ['studio.css', /href="\/assets\/css\/studio\.css"/],
  ['favicon', /rel="icon"/],
];
for (const [name, re] of headChecks) {
  const ok = re.test(headHtml);
  console.log(`${ok ? '✓' : '✗'}  head · ${name}`);
  if (!ok) failed++;
}

console.log(failed ? `\n${failed} 处需要看` : '\n结构与卷帘一致');
process.exit(failed ? 1 : 0);

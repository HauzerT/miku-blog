/* ==========================================================================
   server/lib/articles.mjs · 编辑页写出来的那些文章
   ---------------------------------------------------------------------------
   和 content/posts.mjs 那批不是一回事：那批是「源头」，由 tools/build.mjs
   生成静态页；这批只在服务里活着（data/articles.json），页面由服务运行时渲染。

   这里负责四件事：
     · renderBody()   正文：Markdown（marked，见 ./markdown.mjs）+ 公式 + emoji
     · mergeTracks()  把运行时文章接进九条轨道（卷帘的音符位置、相邻文章都靠它）
     · articlePage()  文章页，版式与生成出来的文章页一模一样
     · articleBrief() 给前端合并用的瘦身版（含卷帘上的 x/w）
   ========================================================================== */

import { site, page, escapeHtml, noteWidth, slotOf, rollStrip, timelineChain } from './shell.mjs';
import { sortByPitch, hiddenIn } from './store.mjs';
import { renderMarkdown, needsMath } from './markdown.mjs';

/* ------------------------------------------------------------------ 正文
   以前这里是一个手写的 Markdown 子集（标题两档、列表、引用、代码块）。
   现在交给 marked（GFM 全量）＋ KaTeX：见 server/lib/markdown.mjs。
   名字保持不变，调用方（/api/render 预览、文章页）不用动。 */
export const renderBody = renderMarkdown;

/* ------------------------------------------------------------------ 轨道 */

/* 文章 → 卷帘上那个音符（以及板块页列表里的一行）认得的形状。
   `edited` 是「站长在页面上直接改过的那一版正文」——
   原生文章的 `body` 是 content/posts.mjs 里的源，两者不能混。 */
export function articleAsPost(a) {
  return {
    id: a.id,
    slug: a.slug,
    title: a.title,
    short: a.short || a.title.slice(0, 4),
    min: a.min || 3,
    blurb: a.blurb || '',
    date: a.date,
    runtime: true,
    section: a.section,
    sub: a.sub || '',
    edited: a.body || '',
  };
}
/* 九条原生轨道 + 运行时新建的板块 + 运行时文章，合成一份 tracks。
   返回的顺序按音高（高音在上，轨道栏与卷帘都照它排），
   但每条的 slot 钉在「内容顺序」上——节奏槽不能因为新板块插到上面而挪位。 */
export function mergeTracks(seedTracks, sections, articles) {
  const byId = new Map(sections.map((s) => [s.id, s]));
  const tracks = seedTracks.map((t, i) => {
    const s = byId.get(t.id);
    return {
      ...t,
      ...(s ? { name: s.name, pitch: s.pitch, black: Boolean(s.black), def: s.def ?? t.def, lede: s.lede ?? t.lede } : {}),
      subs: (s && s.subs) || [],
      posts: (t.posts || []).slice(),
      slot: i,
    };
  });

  let nextSlot = tracks.length;
  for (const s of sections) {
    if (tracks.some((t) => t.id === s.id)) continue;
    tracks.push({
      id: s.id, name: s.name, pitch: s.pitch, black: Boolean(s.black),
      def: s.def || '', lede: s.lede || '', subs: s.subs || [], posts: [], slot: nextSlot++,
    });
  }

  /* 运行时文章接在自己轨道已有文章的后面，按日期从旧到新 —— 卷帘上依次往右排 */
  for (const a of articles.slice().sort((x, y) => (x.date < y.date ? -1 : 1))) {
    const track = tracks.find((t) => t.id === a.section);
    if (!track) continue;
    track.posts.push(articleAsPost(a));
  }

  return sortByPitch(tracks);
}

export function trackOf(tracks, sectionId) {
  return tracks.find((t) => t.id === sectionId) || null;
}

/* 运行时文章在卷帘上的位置（前端补音符时要用同一套数字）。
   横轴是接龙：把整份 tracks 的全部文章排一条链，认出这篇在链上的那格；
   认不出日期的（不会发生，挡一手）退回节奏槽。 */
export function articleNote(tracks, article) {
  const ti = tracks.findIndex((t) => t.id === article.section);
  if (ti === -1) return null;
  const track = tracks[ti];
  const pi = track.posts.findIndex((p) => p.runtime && p.id === article.id);
  if (pi === -1) return null;
  const chain = timelineChain(tracks.flatMap((t) => t.posts || []));
  const note = chain ? chain.notes.find((n) => n.post === track.posts[pi]) : null;
  const [x, w] = note
    ? [Number(((note.x / chain.span) * 100).toFixed(2)), Number(note.w.toFixed(2))]
    : noteWidth(slotOf(track, ti), pi);
  return { x, w, pi, pitch: track.pitch, slot: slotOf(track, ti) };
}

/* 给前端合并用的瘦身版 */
export function articleBrief(tracks, a) {
  const note = articleNote(tracks, a);
  const track = tracks.find((t) => t.id === a.section);
  return {
    id: a.id,
    slug: a.slug,
    title: a.title,
    short: a.short || a.title.slice(0, 4),
    blurb: a.blurb || '',
    section: a.section,
    sectionName: track ? track.name : a.section,
    sub: a.sub || '',
    date: a.date,
    min: a.min || 3,
    url: `/posts/${encodeURIComponent(a.slug)}.html`,
    x: note ? note.x : 0,
    w: note ? note.w : 12,
    pitch: note ? note.pitch : '·',
  };
}

/* 轨道里的一条文章记录（原生的那批没有 runtime 标记）→ 前端用的瘦身版。
   字段与 articleBrief 对齐，sections.js 才能用同一套代码处理两种文章。
   正文被「页面上直接改」过的那种（post.body）也捎上——静态页靠它回填。 */
export function postBrief(track, post) {
  const brief = {
    id: post.id || post.slug,
    slug: post.slug,
    title: post.title,
    short: post.short || String(post.title || '').slice(0, 4),
    blurb: post.blurb || '',
    date: post.date,
    min: post.min || 3,
    sub: post.sub || '',
    section: track.id,
    sectionName: track.name,
    runtime: Boolean(post.runtime),
    url: `/posts/${encodeURIComponent(post.slug)}.html`,
  };
  if (post.edited) brief.body = post.edited;
  return brief;
}

/* ------------------------------------------------------------- 富文本清洗
   正文可以在页面上直接改（右键 → 编辑正文），存下来的是 HTML。
   这里做一遍**轻**清洗，它不假装是一道安全边界——写的人手上本来就有口令；
   它挡的是「手滑」和「粘贴带进来的东西」：脚本、事件、外链协议一律去掉，
   行内样式只留 text-decoration-color（下划线可选青或粉，就靠它）。 */
const KEEP_STYLE = /^text-decoration-color\s*:/i;

export function sanitizeHtml(input) {
  let html = String(input == null ? '' : input).slice(0, 400000);
  html = html.replace(/<\s*(script|style|iframe|object|embed|link|meta)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  html = html.replace(/<\s*(script|style|iframe|object|embed|link|meta)\b[^>]*>/gi, '');
  html = html.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  html = html.replace(/(href|src)\s*=\s*("|')?\s*javascript:[^"'>\s]*("|')?/gi, '$1="#"');
  html = html.replace(/\s(contenteditable|spellcheck|data-editing)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  html = html.replace(/\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi, (whole, dq, sq) => {
    const kept = String(dq != null ? dq : sq || '')
      .split(';')
      .map((bit) => bit.trim())
      .filter((bit) => KEEP_STYLE.test(bit))
      .join('; ');
    return kept ? ` style="${kept}"` : '';
  });
  return html;
}

/* ------------------------------------------------------------------ 覆盖层
   把 data/overrides.json 压到合成好的 tracks 上：
   撤下的板块 / 文章整条拿掉，改过名的换成新名字，正文被改过的换成那一份。
   源文件与 data/ 都不动。服务端所有对外的地方（接口、动态页、文章页）都从
   这里过一道，所以「撤下」在服务跑着的时候是真的不见了，而不是只藏了个 DOM。 */
export function applyOverrides(tracks, overrides) {
  const os = (overrides && overrides.sections) || {};
  const op = (overrides && overrides.posts) || {};
  return tracks
    .filter((t) => !hiddenIn(os, t.id))
    .map((t) => {
      const posts = (t.posts || [])
        .filter((p) => !hiddenIn(op, p.slug))
        .map((p) => {
          const o = op[p.slug];
          if (!o) return p;
          const next = { ...p };
          if (o.title) next.title = o.title;
          /* 页面上直接改的那一版：放 `edited`，别盖掉原生文章自己的 `body`（那是源） */
          if (o.body) next.edited = o.body;
          return next;
        });
      return { ...t, posts };
    });
}

/* 每条轨道「一共几篇」（原生 + 运行时）、最近两篇的标题（首页索引那行） */
export function sectionStats(tracks) {
  const map = new Map();
  for (const t of tracks) {
    const posts = (t.posts || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    map.set(t.id, {
      count: posts.length,
      recent: posts.slice(0, 2).map((p) => ({ title: p.title, url: `/posts/${encodeURIComponent(p.slug)}.html` })),
    });
  }
  return map;
}

/* ------------------------------------------------------------------ 页面 */

/* 文章页：版式跟 tools/build.mjs 生成的那些逐字对齐，
   所以运行时写出来的文章和手写的文章长得一模一样。 */
export function articlePage({ article, tracks, base = '../' }) {
  const ti = tracks.findIndex((t) => t.id === article.section);
  const track = tracks[ti] || { name: article.section, pitch: '·', posts: [] };
  const pi = track.posts.findIndex((p) => p.runtime && p.id === article.id);
  const playX = noteWidth(slotOf(track, ti), pi < 0 ? 0 : pi)[0];

  const prev = pi > 0 ? track.posts[pi - 1] : null;
  const next = pi >= 0 && pi + 1 < track.posts.length ? track.posts[pi + 1] : null;
  const href = (p) => `${base}posts/${encodeURIComponent(p.slug)}.html`;

  const pager = `<nav class="pager" aria-label="同轨道的相邻文章">
      <div class="pager__item">
${prev ? `        <a href="${href(prev)}"><span class="pager__label">上一首 · ${escapeHtml(track.pitch)}</span><span class="pager__title">${escapeHtml(prev.title)}</span></a>` : ''}
      </div>
      <div class="pager__item pager__item--next">
${next ? `        <a href="${href(next)}"><span class="pager__label">下一首 · ${escapeHtml(track.pitch)}</span><span class="pager__title">${escapeHtml(next.title)}</span></a>` : ''}
      </div>
    </nav>`;

  /* 正文：页面上直接改过的那种（body）优先，否则用 Markdown 源现渲染 */
  const body = article.body || renderBody(article.source) ||
    '<p class="empty">这篇还没写。回到编辑页把正文填上就能看见。</p>';

  const main = `${rollStrip(tracks, track.id, article.slug, playX)}
    <article class="article">
      <header>
        <h1 class="article__title">${escapeHtml(article.title)}</h1>
        <p class="article__meta">
          <time datetime="${escapeHtml(String(article.date).replace(/\./g, '-'))}">${escapeHtml(article.date)}</time>
          <span aria-hidden="true">·</span>
          <a href="${base}sections/${encodeURIComponent(track.id)}.html">${escapeHtml(track.name)}</a>
          <span aria-hidden="true">·</span>
          <span>${Number(article.min) || 3} 分钟</span>
        </p>
      </header>
      <div class="prose">
${body}
      </div>
${pager}
    </article>`;

  return page({
    title: `${article.title} · ${site.brand} ${site.mark}`,
    desc: article.blurb || `${article.title}`,
    base,
    nav: 'post',
    currentSection: track.id,
    tracks,
    /* 只有真出现公式的页面才带上 KaTeX 的样式表（字体是懒加载的，只在用到时下载） */
    styles: needsMath(body) ? ['assets/vendor/katex/katex.min.css'] : [],
    main,
  });
}

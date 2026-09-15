/* ==========================================================================
   server/lib/articles.mjs · 编辑页写出来的那些文章
   ---------------------------------------------------------------------------
   和 content/posts.mjs 那批不是一回事：那批是「源头」，由 tools/build.mjs
   生成静态页；这批只在服务里活着（data/articles.json），页面由服务运行时渲染。

   这里负责四件事：
     · renderBody()   正文：Markdown 子集 → HTML（整块以 < 开头的照样原样放行）
     · mergeTracks()  把运行时文章接进九条轨道（卷帘的音符位置、相邻文章都靠它）
     · articlePage()  文章页，版式与生成出来的文章页一模一样
     · articleBrief() 给前端合并用的瘦身版（含卷帘上的 x/w）
   ========================================================================== */

import { site, page, escapeHtml, noteWidth, slotOf, rollStrip } from './shell.mjs';
import { sortByPitch } from './store.mjs';

/* ------------------------------------------------------------------ 正文 */

const escapeHtmlSoft = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* 行内：先转义再套标记，所以正文里的裸 HTML 只会原样显示（想放 HTML 就整块写） */
function inline(text) {
  return escapeHtmlSoft(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1" loading="lazy">')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
}

const isBlockStart = (line) =>
  /^\s*</.test(line) || /^```/.test(line) || /^#{2,4}\s+/.test(line) || /^\s*>\s?/.test(line) ||
  /^\s*[-*+]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line) || /^\s*(-{3,}|\*{3,})\s*$/.test(line);

export function renderBody(source) {
  const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i++; continue; }

    /* 围栏代码块 */
    if (/^```/.test(line)) {
      const code = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { code.push(lines[i]); i++; }
      i++;                                          // 收尾那行 ```
      out.push(`<pre><code>${escapeHtmlSoft(code.join('\n'))}</code></pre>`);
      continue;
    }

    /* 整块 HTML：一行以 < 开头就一直吃到空行，原样放行（视频、音频、图表都靠它） */
    if (/^\s*</.test(line)) {
      const block = [];
      while (i < lines.length && lines[i].trim()) { block.push(lines[i]); i++; }
      out.push(block.join('\n'));
      continue;
    }

    const h = /^(#{2,4})\s+(.*)$/.exec(line);
    if (h) {
      const lv = h[1].length;
      out.push(`<h${lv}>${inline(h[2])}</h${lv}>`);
      i++;
      continue;
    }

    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

    if (/^\s*>\s?/.test(line)) {
      const quote = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { quote.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      out.push(`<blockquote><p>${inline(quote.join(' '))}</p></blockquote>`);
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*+]\s+/, '')); i++; }
      out.push(`<ul>\n${items.map((x) => `  <li>${inline(x)}</li>`).join('\n')}\n</ul>`);
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+[.)]\s+/, '')); i++; }
      out.push(`<ol>\n${items.map((x) => `  <li>${inline(x)}</li>`).join('\n')}\n</ol>`);
      continue;
    }

    /* 段落：连着吃到空行或者下一个块级开头 */
    const para = [];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) { para.push(lines[i]); i++; }
    out.push(`<p>${inline(para.join('\n')).replace(/\n/g, '<br>')}</p>`);
  }

  return out.join('\n');
}

/* ------------------------------------------------------------------ 轨道 */

/* 文章 → 卷帘上那个音符（以及板块页列表里的一行）认得的形状 */
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

/* 运行时文章在卷帘上的位置（前端补音符时要用同一套数字） */
export function articleNote(tracks, article) {
  const ti = tracks.findIndex((t) => t.id === article.section);
  if (ti === -1) return null;
  const track = tracks[ti];
  const pi = track.posts.findIndex((p) => p.runtime && p.id === article.id);
  if (pi === -1) return null;
  const [x, w] = noteWidth(slotOf(track, ti), pi);
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

  const body = renderBody(article.source) ||
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
    main,
  });
}

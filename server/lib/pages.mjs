/* ==========================================================================
   server/lib/pages.mjs · 公开页面（板块页 / 子板块页）
   ---------------------------------------------------------------------------
   静态页由 tools/build.mjs 生成；用户新加的板块没有静态文件，
   运行时由这里现场渲染——用的是同一套 shell.mjs，所以长得一模一样。
   ========================================================================== */

import { page, escapeHtml } from './shell.mjs';
import { site } from './shell.mjs';

/* 文章列表：静态板块页由 build.mjs 写死，运行时板块页在这里现排
   （动态渲染的好处是它永远不会和 data/articles.json 脱节） */
function postRows(posts, base) {
  if (!posts.length) {
    return `    <p class="empty">这个板块还没有文章。点右下角的站长球，用「快速写一篇博客」写第一篇。</p>`;
  }
  return `    <ol class="post-list">
${posts
  .slice()
  .sort((a, b) => (a.date < b.date ? 1 : -1))
  .map(
    (p) => `      <li class="post-row">
        <a class="post-row__link" href="${base}posts/${encodeURIComponent(p.slug)}.html">
          <time class="post-row__date">${escapeHtml(p.date)}</time>
          <span class="post-row__title">${escapeHtml(p.title)}</span>
          <span class="post-row__blurb">${escapeHtml(p.blurb || '')}</span>
        </a>
      </li>`
  )
  .join('\n')}
    </ol>`;
}

/* 运行时渲染的板块页（用户新加的那种） */
export function dynamicSectionPage({ track, sections, base = '../' }) {
  const subs = track.subs || [];
  const posts = track.posts || [];
  const subNav = subs.length
    ? `    <nav class="subnav" aria-label="${escapeHtml(track.name)}的子板块">
${subs
      .map(
        (s) =>
          `      <a class="subnav__item" href="${base}sections/${encodeURIComponent(
            track.id
          )}/${encodeURIComponent(s.id)}.html"><span class="subnav__name">${escapeHtml(s.name)}</span></a>`
      )
      .join('\n')}
    </nav>`
    : '';

  const main = `    <header class="sect-head">
      <p class="sect-head__pitch">${escapeHtml(track.pitch)}${track.black ? ' · 黑键' : ''} · ${posts.length} 篇</p>
      <h1 class="sect-head__name">${escapeHtml(track.name)}</h1>
      <p class="sect-head__def">${escapeHtml(track.def || '新建板块')}</p>
    </header>
${track.lede ? `    <p class="lede">${track.lede}</p>\n` : ''}${subNav}
${postRows(posts.filter((p) => !p.sub), base)}`;

  return page({
    title: `${track.name} · ${site.brand} ${site.mark}`,
    desc: `${track.name}：${track.def || ''}`,
    base,
    nav: 'section',
    currentSection: track.id,
    tracks: sections,
    main,
  });
}

/* 运行时渲染的子板块页 */
export function dynamicSubPage({ track, sub, sections, base = '../../' }) {
  const posts = (track.posts || []).filter((p) => p.sub === sub.id);
  const main = `    <header class="sect-head">
      <p class="sect-head__pitch"><a href="${base}sections/${encodeURIComponent(track.id)}.html">${escapeHtml(
    track.pitch
  )} ${escapeHtml(track.name)}</a> · 子板块 · ${posts.length} 篇</p>
      <h1 class="sect-head__name">${escapeHtml(sub.name)}</h1>
${sub.def ? `      <p class="sect-head__def">${escapeHtml(sub.def)}</p>\n` : ''}    </header>
${postRows(posts, base)}`;

  return page({
    title: `${sub.name} · ${track.name} · ${site.brand} ${site.mark}`,
    desc: sub.def || `${track.name} 的子板块：${sub.name}`,
    base,
    nav: 'section',
    currentSection: track.id,
    tracks: sections,
    main,
  });
}

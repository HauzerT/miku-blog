/* ==========================================================================
   server/lib/pages.mjs · 公开页面（板块页 / 子板块页 / 说说流）
   ---------------------------------------------------------------------------
   静态页由 tools/build.mjs 生成；用户新加的板块没有静态文件，
   运行时由这里现场渲染——用的是同一套 shell.mjs，所以长得一模一样。
   说说流（feed）则是全站的：任何页面上传的说说都会出现在这里。
   ========================================================================== */

import { page, escapeHtml, cn } from './shell.mjs';
import { site } from './shell.mjs';

/* 说说卡片：和 QQ 空间那种「一条一条」的感觉一致，
   但排版语言仍然是本站的：细线分隔、音高标签、测量体数字。 */
export function postCard(post, { href = true, base = '' } = {}) {
  const section = post.sectionName || post.section || '';
  const sub = post.subName ? `<span class="feed__sep" aria-hidden="true">/</span><span class="feed__sub">${escapeHtml(post.subName)}</span>` : '';
  const link = href && post.section
    ? `<a class="feed__sect" href="${base}sections/${encodeURIComponent(post.section)}.html">${escapeHtml(section)}</a>`
    : `<span class="feed__sect">${escapeHtml(section)}</span>`;

  const media = renderMedia(post, base);
  const mood = post.mood ? `<span class="feed__mood">${escapeHtml(post.mood)}</span>` : '';
  const body = post.text ? `<div class="feed__text">${escapeHtml(post.text).replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>')}</div>` : '';

  return `<article class="feed-item" data-post-id="${escapeHtml(post.id)}">
  <header class="feed-item__head">
    <span class="feed-item__pitch" aria-hidden="true">${escapeHtml(post.pitch || '·')}</span>
    ${link}${sub}
    <time class="feed-item__time" datetime="${escapeHtml(post.date)}">${escapeHtml(post.date)} ${escapeHtml(
    post.time || ''
  )}</time>
    ${mood}
  </header>
  <div class="feed-item__body">
${body}
${media}
  </div>
  <footer class="feed-item__foot">
    <span class="feed-item__meta">${escapeHtml(post.kindLabel || '说说')}${
    post.assets && post.assets.length ? ` · ${post.assets.length} 个附件` : ''
  }</span>
    <button class="feed-item__del" type="button" data-del-post="${escapeHtml(post.id)}" hidden>删除</button>
  </footer>
</article>`;
}

function renderMedia(post, base) {
  const assets = Array.isArray(post.assets) ? post.assets : [];
  if (!assets.length) return '';
  const images = assets.filter((a) => a.kind === 'image' || a.kind === 'sticker');
  const videos = assets.filter((a) => a.kind === 'video');
  const audios = assets.filter((a) => a.kind === 'audio');

  const out = [];
  if (images.length) {
    const cls = images.length === 1 ? 'shots shots--one' : 'shots';
    out.push(`    <div class="${cls}">
${images
      .map(
        (a) =>
        `      <a class="shot" href="${a.url}" target="_blank" rel="noopener"><img src="${a.url}" alt="${escapeHtml(
          a.alt || a.original || ''
        )}" loading="lazy"${a.w && a.h ? ` width="${a.w}" height="${a.h}"` : ''}></a>`
      )
      .join('\n')}
    </div>`);
  }
  for (const v of videos) {
    out.push(`    <figure class="clip">
      <video src="${v.url}" controls preload="metadata" playsinline${
      v.poster ? ` poster="${v.poster}"` : ''
    }></video>
    </figure>`);
  }
  for (const a of audios) {
    out.push(`    <p class="clip clip--audio"><audio src="${a.url}" controls preload="metadata"></audio></p>`);
  }
  return out.join('\n');
}

export function feedTitle(count) {
  return `${count} 条说说`;
}

/* 全站说说流：一个独立页面 feed.html 的内容 */
export function feedPage({ posts, sections, base = '' }) {
  const grouped = sections.map((t) => ({
    track: t,
    items: posts.filter((p) => p.section === t.id),
  }));

  const filters = sections
    .map((t) => {
      const n = posts.filter((p) => p.section === t.id).length;
      return `    <button class="chip" type="button" data-feed-filter="${escapeHtml(t.id)}">${escapeHtml(
        t.pitch
      )} ${escapeHtml(t.name)}<b>${n}</b></button>`;
    })
    .join('\n');

  const list = posts.length
    ? posts.map((p) => postCard(p, { base })).join('\n')
    : `<p class="empty">还没有说说。点右下角的悬浮球，写下第一条。</p>`;

  const main = `    <header class="sect-head">
      <p class="sect-head__pitch">${feedTitle(posts.length)} · ${cn(grouped.filter((g) => g.items.length).length)} 个板块有内容</p>
      <h1 class="sect-head__name">说说</h1>
      <p class="sect-head__def">这里按时间倒序收着所有板块上传的内容：文字、图片、视频、表情包。点右下角的悬浮球发一条。</p>
    </header>
    <div class="feed-filter" role="group" aria-label="按板块筛选">
      <button class="chip is-on" type="button" data-feed-filter="">全部<b>${posts.length}</b></button>
${filters}
    </div>
    <div class="feed" data-feed data-section="">
${list}
    </div>`;

  return page({
    title: `说说 · ${site.brand} ${site.mark}`,
    desc: '所有板块上传的说说，按时间倒序。',
    base,
    nav: 'feed',
    tracks: sections,
    main,
  });
}

/* 板块页里的说说区块（静态板块页由 build.mjs 内联一份，这里给动态板块页用） */
export function feedBlock(posts, sectionId, subId = '') {
  const list = posts.length
    ? posts.map((p) => postCard(p)).join('\n')
    : `<p class="empty" data-feed-empty>这个板块还没有说说。</p>`;
  return `    <div class="feed" data-feed data-section="${escapeHtml(sectionId)}" data-sub="${escapeHtml(
    subId
  )}">
${list}
    </div>`;
}

/* 运行时渲染的板块页（用户新加的那种） */
export function dynamicSectionPage({ track, posts, sections, base = '../' }) {
  const subs = track.subs || [];
  const subNav = subs.length
    ? `    <nav class="subnav" aria-label="${escapeHtml(track.name)}的子板块">
${subs
      .map(
        (s) =>
          `      <a class="subnav__item" href="${base}sections/${encodeURIComponent(
            track.id
          )}/${encodeURIComponent(s.id)}.html"><span class="subnav__name">${escapeHtml(
            s.name
          )}</span><span class="subnav__count">${posts.filter((p) => p.sub === s.id).length} 条</span></a>`
      )
      .join('\n')}
    </nav>`
    : '';

  const main = `    <header class="sect-head">
      <p class="sect-head__pitch">${escapeHtml(track.pitch)}${track.black ? ' · 黑键' : ''} · ${posts.length} 条说说</p>
      <h1 class="sect-head__name">${escapeHtml(track.name)}</h1>
      <p class="sect-head__def">${escapeHtml(track.def || '新建板块')}</p>
    </header>
${track.lede ? `    <p class="lede">${track.lede}</p>\n` : ''}${subNav}
${feedBlock(posts, track.id)}`;

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
export function dynamicSubPage({ track, sub, posts, sections, base = '../../' }) {
  const main = `    <header class="sect-head">
      <p class="sect-head__pitch"><a href="${base}sections/${encodeURIComponent(track.id)}.html">${escapeHtml(
    track.pitch
  )} ${escapeHtml(track.name)}</a> · 子板块</p>
      <h1 class="sect-head__name">${escapeHtml(sub.name)}</h1>
      <p class="sect-head__def">${escapeHtml(sub.def || '')} · ${posts.length} 条说说</p>
    </header>
${feedBlock(posts, track.id, sub.id)}`;

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

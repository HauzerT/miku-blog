/* ==========================================================================
   tools/build.mjs · 把 content/posts.mjs 编译成静态 HTML
   生成：index.html / archive.html / kumura.html / sections/*.html / posts/*.html
   用法：node tools/build.mjs
   不跑这个脚本也能维护站点——生成出来的 HTML 就是普通文件，直接手改即可。

   页头、命令栏、轨道栏、页脚、卷帘都来自 server/lib/shell.mjs，
   和上传服务渲染的动态页面共用同一套——两边永远不会长得不一样。
   ========================================================================== */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { site, tracks, excerpts } from '../content/posts.mjs';
import {
  page,
  noteWidth,
  rollHero,
  rollStrip,
  readData,
  cn,
  escapeHtml,
} from '../server/lib/shell.mjs';
import { dynamicSubPage } from '../server/lib/pages.mjs';
import { decorateBody, needsMath } from '../server/lib/markdown.mjs';
import { run as runTokens } from './tokens.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VOICE_CN = cn(tracks.length);
const allPosts = tracks.flatMap((track, ti) => track.posts.map((post, pi) => ({ ...post, track, ti, pi })));

/* 先把配色对齐：色值只写在 content/palette.mjs，这一步会重算对比度并重新生成
   assets/css/palette.css 与 assets/js/palette.js。配色不过 AA 就整站不生成。 */
if (runTokens(['--quiet']) !== 0) process.exit(1);

/* 服务里新建的板块与子板块写在 data/sections.json：定义、导语、子板块以那份为准 */
const dataSections = readData('sections.json', []);
const sectionMeta = new Map((Array.isArray(dataSections) ? dataSections : []).map((s) => [s.id, s]));

const postHref = (base, post) => `${base}posts/${post.slug}.html`;
const trackHref = (base, track) => `${base}sections/${track.id}.html`;

/* ------------------------------------------------------------------ 页面 */

function buildIndex() {
  const entries = tracks
    .map((t) => {
      const recent = t.posts
        .slice(0, 2)
        .map((p) => `<a href="${postHref('', { slug: p.slug })}">${p.title}</a>`)
        .join('<span aria-hidden="true">·</span>');
      const meta = sectionMeta.get(t.id);
      return `      <li class="entry">
        <p class="entry__pitch">${t.pitch}</p>
        <div>
          <h3 class="entry__name"><a href="${trackHref('', t)}">${t.name}</a></h3>
          <p class="entry__blurb">${(meta?.def || t.lede).replace(/<br>/g, ' ')}</p>
          <p class="entry__recent">最近：${recent}</p>
        </div>
        <p class="entry__count">${t.posts.length} 篇</p>
      </li>`;
    })
    .join('\n');

  const main = `    <section class="hero">
      <h1 class="hero__name">${site.brand}</h1>
      <p class="hero__latin">${site.latin}</p>
      <p class="hero__note">${site.hero || `${VOICE_CN}个板块是一个和弦的${VOICE_CN}个音，<em>越往上越轻</em>。下面这条时间轴就是本站的目录：音符按写作顺序一篇紧挨一篇往右接——隔了多久都一样，中间没发博的日子不留空白；越往右越新，越宽读得越久；同一个月的几篇一篇挨一篇排在一起，顶部月份牌子后面带着篇数。点音符进文章，点左边的轨道名进板块；指针停在音符上会报出日期与时长。`}</p>
    </section>

${rollHero('', tracks)}

    <div class="index-head">
      <h2>${VOICE_CN}板块索引</h2>
      <p>${allPosts.length} 篇 · ${tracks.length} 轨</p>
    </div>
    <ol class="entry-list">
${entries}
    </ol>`;

  return page({ title: `${site.brand} ${site.mark} · 个人博客`, desc: site.desc, nav: 'home', tracks, main });
}

function buildArchive() {
  const years = [...new Set(allPosts.map((p) => p.date.slice(0, 4)))].sort((a, b) => b - a);
  const groups = years
    .map((year) => {
      const list = allPosts
        .filter((p) => p.date.startsWith(year))
        .sort((a, b) => (a.date < b.date ? 1 : -1));
      const rows = list
        .map(
          (p) => `        <li class="post-row">
          <a class="post-row__link" href="${postHref('', p)}">
            <time class="post-row__date">${p.date}</time>
            <span class="post-row__title">${p.title}</span>
            <span class="post-row__blurb">${p.track.name} · ${p.blurb}</span>
          </a>
        </li>`
        )
        .join('\n');
      return `      <section class="year">
        <div class="year__head">
          <span class="year__num">${year}</span>
          <span class="year__count">${list.length} 篇</span>
        </div>
        <ol class="post-list">
${rows}
        </ol>
      </section>`;
    })
    .join('\n');

  const main = `    <header class="sect-head">
      <p class="sect-head__pitch">${allPosts.length} 篇 · ${tracks.length} 轨</p>
      <h1 class="sect-head__name">归档</h1>
      <p class="sect-head__def">按年份倒序。每条前面是日期，后面是它所属的板块。</p>
    </header>
${groups}`;

  return page({
    title: `归档 · ${site.brand} ${site.mark}`,
    desc: '全部文章，按年份倒序。',
    nav: 'archive',
    tracks,
    main,
  });
}

function buildSection(track, ti) {
  const rows = track.posts
    .map(
      (p) => `      <li class="post-row">
        <a class="post-row__link" href="${postHref('../', p)}">
          <time class="post-row__date">${p.date}</time>
          <span class="post-row__title">${p.title}</span>
          <span class="post-row__blurb">${p.blurb}</span>
        </a>
      </li>`
    )
    .join('\n');

  const meta = sectionMeta.get(track.id);
  const subs = meta?.subs || [];
  const subNav = subs.length
    ? `    <nav class="subnav" aria-label="${escapeHtml(track.name)}的子板块">
${subs
      .map(
        (s) =>
          /* 这一页就在 sections/ 里，所以是「板块 id/子板块 id.html」——
             带上 sections/ 前缀会解析成 /sections/sections/…，404 */
          `      <a class="subnav__item" href="${track.id}/${s.id}.html"><span class="subnav__name">${escapeHtml(
            s.name
          )}</span></a>`
      )
      .join('\n')}
    </nav>`
    : '';

  const main = `${rollStrip(tracks, track.id, null, noteWidth(ti, 0)[0])}
    <header class="sect-head">
      <p class="sect-head__pitch">${track.pitch}${track.black ? ' · 黑键' : ''} · ${track.posts.length} 篇</p>
      <h1 class="sect-head__name">${track.name}</h1>
      <p class="sect-head__def">${meta?.def || track.def}</p>
    </header>
    <p class="lede">${meta?.lede || track.lede}</p>
${subNav}
    <ol class="post-list">
${rows}
    </ol>`;

  return page({
    title: `${track.name} · ${site.brand} ${site.mark}`,
    desc: `${track.name}：${meta?.def || track.def}`,
    base: '../',
    nav: 'section',
    currentSection: track.id,
    tracks,
    main,
  });
}

function buildPost(post) {
  const siblings = post.track.posts;
  const prev = siblings[post.pi - 1];
  const next = siblings[post.pi + 1];
  const playX = noteWidth(post.ti, post.pi)[0];

  /* 静态正文是手写的 HTML；过一遍 emoji 与公式，让 :smile: 与 $…$ 也在这儿成立
     （生成出来的就是排好版的 HTML，静态托管、file:// 打开都一样） */
  const body = post.body
    ? decorateBody(post.body.trim())
    : `<p class="empty">这篇还没写。骨架先留在这里：打开 <code>content/posts.mjs</code>，把这条记录的 <code>body</code> 填上，再运行 <code>node tools/build.mjs</code>——或者直接编辑这个 HTML 文件。</p>`;

  const pager = `<nav class="pager" aria-label="同轨道的相邻文章">
      <div class="pager__item">
${prev ? `        <a href="${postHref('../', prev)}"><span class="pager__label">上一首 · ${post.track.pitch}</span><span class="pager__title">${prev.title}</span></a>` : ''}
      </div>
      <div class="pager__item pager__item--next">
${next ? `        <a href="${postHref('../', next)}"><span class="pager__label">下一首 · ${post.track.pitch}</span><span class="pager__title">${next.title}</span></a>` : ''}
      </div>
    </nav>`;

  const main = `${rollStrip(tracks, post.track.id, post.slug, playX)}
    <article class="article">
      <header>
        <h1 class="article__title">${post.title}</h1>
        <p class="article__meta">
          <time datetime="${post.date.replace(/\./g, '-')}">${post.date}</time>
          <span aria-hidden="true">·</span>
          <a href="${trackHref('../', post.track)}">${post.track.name}</a>
          <span aria-hidden="true">·</span>
          <span>${post.min} 分钟</span>
        </p>
      </header>
      <div class="prose">
${body}
      </div>
${pager}
    </article>`;

  return page({
    title: `${post.title} · ${site.brand} ${site.mark}`,
    desc: post.blurb,
    base: '../',
    nav: 'post',
    currentSection: post.track.id,
    tracks,
    /* 只有真出现公式的那几篇才带上 KaTeX 的样式表 */
    styles: needsMath(body) ? ['assets/vendor/katex/katex.min.css'] : [],
    main,
  });
}

/* 手写文章用的模板：结构和生成的文章完全一致，复制一份改内容即可 */
function buildTemplate() {
  const main = `${rollStrip(tracks, 'suiyu', null, 2)}
    <article class="article">
      <header>
        <h1 class="article__title">文章标题写在这里</h1>
        <p class="article__meta">
          <time datetime="2025-01-01">2025.01.01</time>
          <span aria-hidden="true">·</span>
          <a href="../sections/suiyu.html">胡盐乱雨集</a>
          <span aria-hidden="true">·</span>
          <span>5 分钟</span>
        </p>
      </header>
      <div class="prose">
        <p>正文段落。把这份文件复制到 <code>posts/</code> 下改名，然后删掉这里的占位内容。</p>
        <h2>小节标题</h2>
        <p>小节正文。顶部的迷你卷帘标出了这篇文章属于哪条轨道——改上面那个 <code>--play-x</code> 和高亮的轨道即可。</p>
        <ul>
          <li>列表项一</li>
          <li>列表项二</li>
        </ul>
        <blockquote><p>引用一段话。</p></blockquote>
        <pre><code>// 代码块用的是暗窗底色
const hello = 'world';</code></pre>
      </div>
      <nav class="pager" aria-label="同轨道的相邻文章">
        <div class="pager__item">
          <a href="#"><span class="pager__label">上一首 · D5</span><span class="pager__title">上一篇的标题</span></a>
        </div>
        <div class="pager__item pager__item--next">
          <a href="#"><span class="pager__label">下一首 · D5</span><span class="pager__title">下一篇的标题</span></a>
        </div>
      </nav>
    </article>`;

  return page({
    title: `文章模板 · ${site.brand} ${site.mark}`,
    desc: '手写文章时复制这一份。',
    base: '../',
    nav: 'post',
    currentSection: 'suiyu',
    tracks,
    main,
  });
}

/* -------------------------------------------------------------- 云村
   扫码登录网易云，看账号信息、我创建的歌单、每日推荐与红心歌单。
   这一页的取数不靠静态生成——没登录时它本来就是空的。页面只放挂载点和文案，
   assets/js/kumura.js 起服务后自己取数（tools/ncm-server.mjs）。
   四段内容由 [data-pane] 标记，显示哪一段交给 kumura.css 按状态机控制。 */
function buildKumura() {
  const main = `    <header class="sect-head">
      <p class="sect-head__pitch">G4 · 生活在云上</p>
      <h1 class="sect-head__name">云村</h1>
      <p class="sect-head__def">用网易云扫码登录，在这里看自己创建的歌单、每日推荐与红心歌单。登录凭证只存在本机。</p>
    </header>

    <div class="km" data-music data-music-state="loading">

      <section class="km-note" data-pane="loading">
        <span class="km-spinner" aria-hidden="true"></span>正在连接本机的云村小服务…
      </section>

      <section class="km-note" data-pane="offline">
        <b>小服务没在跑。</b><br>
        在博客根目录执行 <code>node tools/ncm-server.mjs</code>，然后刷新这一页。
        <span data-service-hint hidden></span>
      </section>

      <section class="km-login" data-pane="login">
        <div class="km-login__frame">
          <div class="km-login__code" data-qr></div>
        </div>
        <div class="km-login__side">
          <p class="km-login__title">扫码登录网易云音乐</p>
          <ol class="km-login__steps">
            <li>打开手机上的网易云音乐 App</li>
            <li>点左上角的「扫一扫」</li>
            <li>对准左边的二维码，然后在手机上确认</li>
          </ol>
          <p class="km-login__status">
            <span data-qr-status>正在准备二维码…</span>
            <span class="km-login__timer" data-qr-timer></span>
          </p>
          <div class="km-profile__act">
            <button class="km-btn" type="button" data-qr-refresh>换一张</button>
          </div>
          <p class="km-login__status">二维码由本站自己画，不经过任何第三方图片服务。<br>登录凭证只写进本机的 <code>.ncm-session.json</code>，浏览器这边不存。</p>
        </div>
      </section>

      <section class="km-profile" data-pane="ready">
        <div class="km-profile__bg" data-profile-bg hidden></div>
        <div class="km-profile__avatar" data-avatar></div>
        <div class="km-profile__body">
          <div class="km-profile__top">
            <h2 class="km-profile__name" data-nickname></h2>
            <span class="km-profile__uid" data-uid></span>
            <span class="km-profile__vip" data-vip hidden></span>
          </div>
          <p class="km-profile__sign" data-signature></p>
          <ul class="km-facts" data-facts></ul>
          <div class="km-profile__act">
            <button class="km-btn" type="button" data-logout>退出登录</button>
          </div>
        </div>
      </section>

      <section class="km-sec km-shelf" data-pane="ready">
        <div class="km-sec__head">
          <h3 class="km-sec__title">我创建的歌单</h3>
          <p class="km-sec__note" data-playlists-note></p>
        </div>
        <ul class="km-shelf__grid" data-playlists></ul>
      </section>

      <section class="km-sec km-daily" data-pane="ready">
        <div class="km-sec__head">
          <h3 class="km-sec__title">每日推荐</h3>
          <p class="km-sec__note" data-daily-note></p>
        </div>
        <ol class="km-tracks" data-daily-list></ol>
      </section>

      <section class="km-liked" data-pane="ready">
        <div class="km-liked__head">
          <div class="km-liked__cover" data-liked-cover hidden></div>
          <div>
            <div class="km-liked__meta" data-liked-meta></div>
            <p class="km-liked__note" data-list-note></p>
          </div>
        </div>
        <ol class="km-tracks" data-list></ol>
        <p class="km-more"><button class="km-btn km-btn--main" type="button" data-more hidden>再读 50 首</button></p>
      </section>

      <!-- 播放条：平时藏着，点任意一首歌才升起来。
           音频走网易 CDN 的直链（那边发 CORS 头），不经小服务中转。 -->
      <div class="km-player" data-player hidden>
        <div class="km-player__art" data-player-art></div>
        <div class="km-player__meta">
          <p class="km-player__name" data-player-name>—</p>
          <p class="km-player__sub" data-player-sub></p>
        </div>
        <div class="km-player__ctrl">
          <button class="km-player__btn" type="button" data-player-prev aria-label="上一首">◀◀</button>
          <button class="km-player__btn km-player__btn--main" type="button" data-player-toggle aria-label="播放 / 暂停">▶</button>
          <button class="km-player__btn" type="button" data-player-next aria-label="下一首">▶▶</button>
        </div>
        <div class="km-player__scrub">
          <input class="km-player__seek" type="range" min="0" max="1000" value="0" step="1"
                 aria-label="播放进度" data-player-seek>
          <span class="km-player__clock" data-player-clock>0:00 / 0:00</span>
        </div>
        <div class="km-player__vol">
          <span class="km-player__vol-label" aria-hidden="true">音量</span>
          <input class="km-player__vol-range" type="range" min="0" max="100" value="80" step="1"
                 aria-label="音量" data-player-vol>
        </div>
        <button class="km-player__btn km-player__btn--close" type="button" data-player-close aria-label="收起播放条">✕</button>
      </div>

    </div>`;

  return page({
    title: `云村 · ${site.brand} ${site.mark}`,
    desc: '扫码登录网易云音乐，查看自己创建的歌单、每日推荐与红心歌单。',
    nav: 'kumura',
    tracks,
    styles: ['assets/css/kumura.css'],
    scripts: ['assets/js/music.config.js', 'assets/js/qr.js', 'assets/js/kumura.js'],
    main,
  });
}

/* ------------------------------------------------------------------ 输出 */

/* 子板块页：板块页上那条子板块导航指着它。子板块本身是运行时的数据
   （只有 data/sections.json 里有），所以这份静态产物是给静态托管兜底的；
   跑着服务时服务端会现场重渲染，好把运行时新写的文章一起列出来。 */
const subPages = tracks.flatMap((t) =>
  (((sectionMeta.get(t.id) || {}).subs) || []).map((sub) => [
    `sections/${t.id}/${sub.id}.html`,
    dynamicSubPage({ track: t, sub, sections: tracks, base: '../../' }),
  ])
);

const outputs = [
  ['index.html', buildIndex()],
  ['kumura.html', buildKumura()],
  ['archive.html', buildArchive()],
  ...tracks.map((t, ti) => [`sections/${t.id}.html`, buildSection(t, ti)]),
  ...subPages,
  ...allPosts.map((p) => [`posts/${p.slug}.html`, buildPost(p)]),
  ['posts/_template.html', buildTemplate()],
];

for (const [file, html] of outputs) {
  const full = join(ROOT, file);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, html, 'utf8');
}

/* 每日一句的词库：生成成一个小 JS 文件，避免在几十个页面里重复内联 */
const excerptsPath = join(ROOT, 'assets/js/excerpts.js');
mkdirSync(dirname(excerptsPath), { recursive: true });
writeFileSync(
  excerptsPath,
  `/* 由 tools/build.mjs 从 content/posts.mjs 的 excerpts 生成 —— 不要手改这个文件 */\n` +
    `window.CV01_EXCERPTS = ${JSON.stringify(excerpts)};\n`,
  'utf8'
);

console.log(`✓ 生成 ${outputs.length} 个页面`);
console.log(
  `  ${allPosts.length} 篇文章 · ${tracks.length} 个板块 · ${excerpts.length} 条每日一句`
);
const unwritten = allPosts.filter((p) => !p.body);
if (unwritten.length) {
  console.log(`  其中 ${unwritten.length} 篇是空状态页（content/posts.mjs 里还没有 body）：`);
  console.log('  ' + unwritten.map((p) => p.slug).join(', '));
}

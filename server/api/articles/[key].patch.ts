/* PATCH /api/articles/:key · 改一篇文章
   ---------------------------------------------------------------------------
   要口令。两条完全不同的路，按 key 落在哪边分：

     · 编辑页写的文章（data/articles.json）：就地改，回复 mode: 'rewritten'
     · 原生文章（content/posts.mjs 那批）：源文件不许动，改名 / 换正文 / 撤下
       / 恢复都落到 data/overrides.json，回复 mode: 'overridden'

   正文有两个来源，优先级是「页面上直接改的 HTML」压过「Markdown 源」：
   一旦编辑页把 Markdown 重写了一遍，富文本那一版就得让位——不然两边会各说各话。
   droppedBody 就是告诉前端「刚才那一下把富文本装修丢掉了」。 */
import { requireAuth } from '../../utils/auth';
import { findPost, findPostNow, postBrief, tracksNow } from '../../utils/briefs';
import { defineApiHandler, httpError, readJsonBody } from '../../utils/http';
import { segmentKey } from '../../utils/api-fallback';
import { cleanAssets } from '../../utils/media-store';
import { decoratedBody, normalizeDate } from '../../utils/text';
import { findSection, findSub, getArticles, getSections, saveArticles, writeOverride } from '../../utils/store';

export default defineApiHandler(async (event) => {
  requireAuth(event);

  const key = segmentKey(event, 'key');
  const body = await readJsonBody(event, 1 << 20);
  const articles = getArticles();
  const article = articles.find((a) => a.id === key || a.slug === key);
  let droppedBody = false;

  /* ---------------------------------------------------------- 原生文章 */
  if (!article) {
    const native = findPost(key);
    if (!native) throw httpError(404, '没有这篇文章');
    const slug = native.post.slug;
    if (typeof body.title === 'string' && body.title.trim()) {
      writeOverride('posts', slug, { title: body.title.trim().slice(0, 120) });
    }
    /* 页面上直接改的正文：存 HTML，源文件一个字节不动 */
    if (typeof body.body === 'string') writeOverride('posts', slug, { body: decoratedBody(body.body) });
    if (body.hidden === false) writeOverride('posts', slug, { hidden: false });
    if (body.body === false) writeOverride('posts', slug, { body: false });
    if (body.title === false) writeOverride('posts', slug, { title: false });
    /* reset：把这一条覆盖整个抹掉（标题与正文都回到 content/posts.mjs 里的原样） */
    if (body.reset === true) writeOverride('posts', slug, { title: false, body: false, hidden: false });

    const after = findPostNow(slug) || native;
    return { ok: true, mode: 'overridden', post: postBrief(after.track, after.post) };
  }

  /* ---------------------------------------------------------- 运行时文章 */
  const sections = getSections();
  if (typeof body.title === 'string' && body.title.trim()) article.title = body.title.trim().slice(0, 120);
  if (typeof body.section === 'string' && body.section.trim()) {
    const section = findSection(sections, body.section.trim());
    if (!section) throw httpError(400, '没有这个板块');
    article.section = section.id;
    if (article.sub && !findSub(section, article.sub)) article.sub = '';
  }
  if ('sub' in body) {
    const section = findSection(sections, article.section);
    const sub = body.sub ? findSub(section, String(body.sub)) : null;
    if (body.sub && !sub) throw httpError(400, '这个子板块不存在了');
    article.sub = sub ? sub.id : '';
  }
  if ('date' in body) article.date = normalizeDate(body.date);
  if ('min' in body) article.min = Math.min(120, Math.max(1, Number(body.min) || 3));
  if (typeof body.short === 'string') article.short = body.short.trim().slice(0, 6) || article.title.slice(0, 4);
  if (typeof body.blurb === 'string') article.blurb = body.blurb.trim().slice(0, 140);
  if (typeof body.source === 'string') {
    article.source = body.source.slice(0, 200000);
    /* 编辑页把 Markdown 重写了一遍：正文的真相回到 source，
       页面上那次富文本装修（body）就此让位 */
    droppedBody = Boolean(article.body);
    delete article.body;
  }
  /* 页面上直接改的正文（富文本）：存 HTML，与 Markdown 源并存但优先 */
  if (typeof body.body === 'string') article.body = decoratedBody(body.body);
  if (body.body === false) delete article.body;
  if ('assets' in body) article.assets = cleanAssets(body.assets);

  saveArticles(articles);
  return { ok: true, mode: 'rewritten', droppedBody, article: articleDetail(tracksNow() as any[], article) };
});

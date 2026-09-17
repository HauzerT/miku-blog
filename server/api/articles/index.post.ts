/* POST /api/articles · 新建一篇文章
   要口令。存 data/articles.json，页面由 Nuxt 那侧的 pages/posts/[slug].vue 现渲染。
   地址片段要唯一（uniqueSlug）：它同时也不能撞上生成器写出来的 posts/<slug>.html，
   否则静态文件会盖住动态页。 */
import { setResponseStatus } from 'h3';
import { requireAuth } from '../../utils/auth';
import { articleDetail, tracksNow } from '../../utils/briefs';
import { defineApiHandler, httpError, readJsonBody } from '../../utils/http';
import { cleanAssets } from '../../utils/media-store';
import { normalizeDate } from '../../utils/text';
import { findSection, findSub, getArticles, getSections, id as newId, saveArticles, uniqueSlug } from '../../utils/store';

export default defineApiHandler(async (event) => {
  requireAuth(event);

  const body = await readJsonBody(event, 1 << 20);
  const title = String(body.title || '').trim();
  if (!title) throw httpError(400, '文章得有个标题');

  const sections = getSections();
  const section = findSection(sections, String(body.section || '').trim());
  if (!section) throw httpError(400, '先选一个板块');
  const sub = body.sub ? findSub(section, String(body.sub)) : null;
  if (body.sub && !sub) throw httpError(400, '这个子板块不存在了');

  const article = {
    id: newId('a_'),
    slug: uniqueSlug(String(body.slug || '').trim() || title),
    title: title.slice(0, 120),
    section: section.id,
    sub: sub ? sub.id : '',
    date: normalizeDate(body.date),
    min: Math.min(120, Math.max(1, Number(body.min) || 3)),
    short: String(body.short || '').trim().slice(0, 6) || title.slice(0, 4),
    blurb: String(body.blurb || '').trim().slice(0, 140),
    source: String(body.source || '').slice(0, 200000),
    assets: cleanAssets(body.assets),
    at: new Date().toISOString(),
  };

  const articles = getArticles();
  articles.push(article);
  saveArticles(articles);

  setResponseStatus(event, 201);
  return { ok: true, article: articleDetail(tracksNow() as any[], article) };
});

/* GET /api/articles/:key · 一篇文章的完整形状（正文源 + 附件清单）
   公开读取。key 可以是 id 或 slug。 */
import { articleDetail, tracksNow } from '../../utils/briefs';
import { defineApiHandler, httpError } from '../../utils/http';
import { segmentKey } from '../../utils/api-fallback';
import { getArticles } from '../../utils/store';

export default defineApiHandler((event) => {
  const key = segmentKey(event, 'key');
  const article = getArticles().find((a) => a.id === key || a.slug === key);
  if (!article) throw httpError(404, '没有这篇文章');
  return { article: articleDetail(tracksNow() as any[], article) };
});

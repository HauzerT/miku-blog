/* DELETE /api/articles/:key · 删掉或撤下一篇文章
   要口令。原生文章只**撤下**（写进 data/overrides.json，源文件不动）；
   运行时文章真删，连它带的图片 / 视频 / 音频一起清掉。 */
import { requireAuth } from '../../utils/auth';
import { findPost, postBrief } from '../../utils/briefs';
import { defineApiHandler, httpError } from '../../utils/http';
import { segmentKey } from '../../utils/api-fallback';
import { removeMedia } from '../../utils/media-store';
import { getArticles, saveArticles, writeOverride } from '../../utils/store';

export default defineApiHandler((event) => {
  requireAuth(event);

  const key = segmentKey(event, 'key');
  const articles = getArticles();
  const i = articles.findIndex((a) => a.id === key || a.slug === key);

  if (i === -1) {
    const native = findPost(key);
    if (!native) throw httpError(404, '没有这篇文章');
    writeOverride('posts', native.post.slug, { hidden: true });
    return { ok: true, mode: 'hidden', post: postBrief(native.track, native.post) };
  }

  const [gone] = articles.splice(i, 1);
  for (const a of gone.assets || []) removeMedia(a.bucket, a.file);
  saveArticles(articles);
  return { ok: true, mode: 'removed', removed: gone.id };
});

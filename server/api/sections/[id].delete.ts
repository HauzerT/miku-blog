/* DELETE /api/sections/:id · 撤下或删掉一个板块
   要口令。原生板块（content/posts.mjs 里的九个）只**撤下**：记录写进
   data/overrides.json，源文件一个字节不动，随时能放回来。
   运行时新建的才真删——它名下的文章（连带图片/视频/音频）也跟着走。 */
import { requireAuth } from '../../utils/auth';
import { defineApiHandler, httpError } from '../../utils/http';
import { segmentKey } from '../../utils/api-fallback';
import { removeMedia } from '../../utils/media-store';
import { getArticles, getSections, saveArticles, saveSections, setArticles, writeOverride } from '../../utils/store';

export default defineApiHandler((event) => {
  requireAuth(event);

  const id = segmentKey(event, 'id');
  const sections = getSections();
  const i = sections.findIndex((s) => s.id === id);
  if (i === -1) throw httpError(404, '没有这个板块');

  if (sections[i].seed) {
    writeOverride('sections', sections[i].id, { hidden: true });
    return { ok: true, mode: 'hidden', section: sections[i] };
  }

  const [gone] = sections.splice(i, 1);
  const orphans = getArticles().filter((a) => a.section === gone.id);
  for (const a of orphans) for (const x of a.assets || []) removeMedia(x.bucket, x.file);
  if (orphans.length) {
    const kept = getArticles().filter((a) => a.section !== gone.id);
    setArticles(kept);
    saveArticles(kept);
  }
  saveSections(sections);

  return { ok: true, mode: 'removed', removed: gone.id, removedArticles: orphans.length };
});

/* DELETE /api/sections/:id/subs/:subId · 删掉一个子板块
   要口令。子板块是运行时数据（data/sections.json），没有「原生」这一说，
   所以是真删——它名下的文章（连带附件）跟着走。 */
import { requireAuth } from '../../../../utils/auth';
import { defineApiHandler, httpError } from '../../../../utils/http';
import { segmentKey } from '../../../../utils/api-fallback';
import { removeMedia } from '../../../../utils/media-store';
import { findSection, findSub, getArticles, getSections, saveArticles, saveSections, setArticles } from '../../../../utils/store';

export default defineApiHandler((event) => {
  requireAuth(event);

  const id = segmentKey(event, 'id');
  const subId = segmentKey(event, 'subId');
  const sections = getSections();
  const section = findSection(sections, id);
  const sub = findSub(section, subId);
  if (!sub) throw httpError(404, '没有这个子板块');

  section.subs = section.subs.filter((s: any) => s.id !== sub.id);

  const orphans = getArticles().filter((a) => a.section === section.id && a.sub === sub.id);
  for (const a of orphans) for (const x of a.assets || []) removeMedia(x.bucket, x.file);
  if (orphans.length) {
    const kept = getArticles().filter((a) => !(a.section === section.id && a.sub === sub.id));
    setArticles(kept);
    saveArticles(kept);
  }
  saveSections(sections);

  return { ok: true, removedArticles: orphans.length };
});

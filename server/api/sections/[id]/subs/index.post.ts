/* POST /api/sections/:id/subs · 新建子板块（multipart 表单）
   要口令。字段：name（必填）、id、def。 */
import { randomBytes } from 'node:crypto';
import { setResponseStatus } from 'h3';
import { requireAuth } from '../../../../utils/auth';
import { urlFor } from '../../../../utils/briefs';
import { defineApiHandler, httpError } from '../../../../utils/http';
import { segmentKey } from '../../../../utils/api-fallback';
import { readForm } from '../../../../utils/media-store';
import { findSection, getSections, saveSections, slugify } from '../../../../utils/store';

export default defineApiHandler(async (event) => {
  requireAuth(event);

  const id = segmentKey(event, 'id');
  const sections = getSections();
  const section = findSection(sections, id);
  if (!section) throw httpError(404, '没有这个板块');

  const { fields } = await readForm(event);
  const name = (fields.name || '').trim();
  if (!name) throw httpError(400, '子板块要有个名字');

  let subId = (fields.id || '').trim() || slugify(name);
  if ((section.subs || []).some((s: any) => s.id === subId)) subId = `${subId}-${randomBytes(2).toString('hex')}`;

  const sub = { id: subId, name: name.slice(0, 40), def: (fields.def || '').slice(0, 120), at: new Date().toISOString() };
  section.subs = section.subs || [];
  section.subs.push(sub);
  saveSections(sections);

  setResponseStatus(event, 201);
  return { ok: true, sub, url: urlFor('sub', section.id, sub.id) };
});

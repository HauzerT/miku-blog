/* POST /api/sections · 新建板块（multipart 表单）
   要口令。字段：name（必填）、id、pitch、def、lede、force。
   音高撞车给 409，除非表单里带了 force——「就要这个音」是个有意识的决定。 */
import { randomBytes } from 'node:crypto';
import { setResponseStatus } from 'h3';
import { requireAuth } from '../../utils/auth';
import { urlFor } from '../../utils/briefs';
import { defineApiHandler, httpError } from '../../utils/http';
import { readForm } from '../../utils/media-store';
import { cleanLine } from '../../utils/text';
import { findSection, getSections, saveSections, slugify, suggestPitch } from '../../utils/store';

export default defineApiHandler(async (event) => {
  requireAuth(event);

  const { fields } = await readForm(event);
  const name = (fields.name || '').trim();
  if (!name) throw httpError(400, '板块要有个名字');

  const sections = getSections();
  let sectionId = (fields.id || '').trim() || slugify(name);
  if (findSection(sections, sectionId)) sectionId = `${sectionId}-${randomBytes(2).toString('hex')}`;

  const pitch = (fields.pitch || '').trim() || suggestPitch(sections);
  if (sections.some((s) => s.pitch === pitch) && !fields.force) {
    throw httpError(409, `${pitch} 这个音已经被占用了，换一个，或者勾选「就要这个音」`);
  }

  const created = {
    id: sectionId,
    name: name.slice(0, 40),
    pitch,
    black: /#/.test(pitch),
    def: cleanLine(fields.def || '').slice(0, 120),
    lede: cleanLine(fields.lede || '').slice(0, 400),
    order: sections.length,
    seed: false,
    at: new Date().toISOString(),
    subs: [],
  };
  sections.push(created);
  saveSections(sections);

  setResponseStatus(event, 201);
  return { ok: true, section: created, url: urlFor('section', sectionId) };
});

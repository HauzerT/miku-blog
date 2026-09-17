/* PATCH /api/sections/:id · 改板块的名字 / 定义 / 导语 / 音高
   要口令。name/def/lede 是**纯文本**（页面上直接改字时取的是文字），
   但 `<br>` 得留着——原生那几条导语就是用它分段落的；其余尖括号一律摘掉，
   否则静态板块页把 lede 原样插进 HTML 就是个洞。 */
import { requireAuth } from '../../utils/auth';
import { defineApiHandler, httpError, readJsonBody } from '../../utils/http';
import { segmentKey } from '../../utils/api-fallback';
import { cleanLine } from '../../utils/text';
import { findSection, getSections, saveSections, writeOverride } from '../../utils/store';

export default defineApiHandler(async (event) => {
  requireAuth(event);

  const id = segmentKey(event, 'id');
  const sections = getSections();
  const section = findSection(sections, id);
  if (!section) throw httpError(404, '没有这个板块');

  const body = await readJsonBody(event, 65536);
  for (const key of ['name', 'def', 'lede'] as const) {
    if (typeof body[key] !== 'string') continue;
    const text = key === 'name' ? body[key] : cleanLine(body[key]);
    section[key] = text.slice(0, 400);
  }
  if (typeof body.pitch === 'string' && body.pitch.trim()) section.pitch = body.pitch.trim();
  /* hidden: false = 把撤下的原生板块放回来（撤下走 DELETE） */
  if (body.hidden === false) writeOverride('sections', section.id, { hidden: false });

  saveSections(sections);
  return { ok: true, mode: 'rewritten', section };
});

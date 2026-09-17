/* PATCH /api/music/:id · 改曲名 / 歌手
   要口令。只认 title 与 artist 两个字符串字段，其余一律忽略。 */
import { requireAuth } from '../../utils/auth';
import { defineApiHandler, httpError, readJsonBody } from '../../utils/http';
import { segmentKey } from '../../utils/api-fallback';
import { getMusic, saveMusic } from '../../utils/store';

export default defineApiHandler(async (event) => {
  requireAuth(event);

  const id = segmentKey(event, 'id');
  const music = getMusic();
  const entry = music.tracks.find((t: any) => t.id === id);
  if (!entry) throw httpError(404, '没有这首曲子');

  const body = await readJsonBody(event, 65536);
  if (typeof body.title === 'string') entry.title = body.title.slice(0, 120);
  if (typeof body.artist === 'string') entry.artist = body.artist.slice(0, 60);
  saveMusic(music);
  return { ok: true, track: entry };
});

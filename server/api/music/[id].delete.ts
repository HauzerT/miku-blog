/* DELETE /api/music/:id · 删掉一首曲子
   要口令。记录从 data/music.json 里去掉，media/music/ 下那个文件也抹掉
   （抹不掉就留着——数据不能因为一个被占用的文件而写不进去）。 */
import { requireAuth } from '../../utils/auth';
import { defineApiHandler, httpError } from '../../utils/http';
import { segmentKey } from '../../utils/api-fallback';
import { removeMedia } from '../../utils/media-store';
import { getMusic, saveMusic } from '../../utils/store';

export default defineApiHandler((event) => {
  requireAuth(event);

  const id = segmentKey(event, 'id');
  const music = getMusic();
  const i = music.tracks.findIndex((t: any) => t.id === id);
  if (i === -1) throw httpError(404, '没有这首曲子');

  const [entry] = music.tracks.splice(i, 1);
  removeMedia('music', entry.file);
  saveMusic(music);
  return { ok: true };
});

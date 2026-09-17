/* PATCH /api/music/settings · 音乐盒的播放设置
   ---------------------------------------------------------------------------
   要口令。**这条路由在旧服务里是够不着的**：旧的分发器拿
   /^\/api\/music\/([\w-]+)$/ 去匹配，`settings` 先被那条抓住、当成一首曲子的 id，
   于是永远回「没有这首曲子」（404）。Nitro 的路由表里静态段优先于 [id]，
   所以这里写成一个独立文件就是修好了这个 bug——行为（收哪些字段、怎么夹取）
   与旧代码里那段一字不差。 */
import { requireAuth } from '../../utils/auth';
import { defineApiHandler, readJsonBody } from '../../utils/http';
import { getMusic, saveMusic } from '../../utils/store';

export default defineApiHandler(async (event) => {
  requireAuth(event);

  const body = await readJsonBody(event, 65536);
  const music = getMusic();
  music.settings = {
    volume: typeof body.volume === 'number' ? Math.min(1, Math.max(0, body.volume)) : music.settings?.volume ?? 0.6,
    loop: typeof body.loop === 'boolean' ? body.loop : music.settings?.loop !== false,
    autoplay: typeof body.autoplay === 'boolean' ? body.autoplay : music.settings?.autoplay !== false,
  };
  saveMusic(music);
  return { ok: true, settings: music.settings };
});

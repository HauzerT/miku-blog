/* GET /api/music · 曲库 + 播放设置
   公开读取：音乐盒是访客也能开的。 */
import { defineApiHandler } from '../../utils/http';
import { getMusic } from '../../utils/store';

export default defineApiHandler(() => {
  const music = getMusic();
  return {
    tracks: music.tracks.map((t: any) => ({
      id: t.id,
      title: t.title,
      artist: t.artist || '',
      url: t.url,
      file: t.file,
      size: t.size || 0,
      at: t.at || '',
    })),
    settings: {
      volume: typeof music.settings?.volume === 'number' ? music.settings.volume : 0.6,
      loop: music.settings?.loop !== false,
      autoplay: music.settings?.autoplay !== false,
    },
  };
});

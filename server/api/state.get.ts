/* GET /api/state · 原始状态（板块全量、曲库、音乐设置）
   要口令：这是给站长看的调试口，不是页面要的东西。 */
import { requireAuth } from '../utils/auth';
import { defineApiHandler } from '../utils/http';
import { getMusic, getSections } from '../utils/store';

export default defineApiHandler((event) => {
  requireAuth(event);
  return { sections: getSections(), music: getMusic().tracks, settings: getMusic().settings };
});

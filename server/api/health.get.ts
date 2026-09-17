/* GET /api/health · 活着没有、有没有口令、装了多少东西
   公开读取：自检脚本与前端第一次连服务时先敲这一下。 */
import { defineApiHandler } from '../utils/http';
import { getMusic, getSections, getSettings } from '../utils/store';

export default defineApiHandler(() => ({
  ok: true,
  hasPassphrase: Boolean(getSettings().passphrase),
  sections: getSections().length,
  music: getMusic().tracks.length,
  version: 1,
}));

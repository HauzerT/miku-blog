/* GET /api/content · 站点内容的装配结果（外壳、轨道、文章与每日一句）
   公开读取，不需要口令：它给出的是页面上本来就看得见的东西。 */
import { loadSiteContent } from '../utils/content';

export default defineEventHandler(() => loadSiteContent());

/* GET /api/articles · 编辑页写出来的文章列表
   公开读取：只给元信息与附件数量，不给正文（正文走 /api/articles/:key）。 */
import { articleBrief, tracksNow } from '../../utils/briefs';
import { defineApiHandler } from '../../utils/http';
import { getArticles } from '../../utils/store';

export default defineApiHandler(() => {
  const tracks = tracksNow() as any[];
  return {
    articles: getArticles()
      .slice()
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .map((a) => ({ ...articleBrief(tracks, a), at: a.at, assets: (a.assets || []).length })),
  };
});

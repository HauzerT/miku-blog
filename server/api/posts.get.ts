/* GET /api/posts · 站点上的全部文章（两层都算，撤下的不在里面）
   公开读取：归档页用它对齐。 */
import { hiddenList, postBrief, tracksNow } from '../utils/briefs';
import { defineApiHandler } from '../utils/http';

export default defineApiHandler(() => {
  const posts: any[] = [];
  for (const t of tracksNow() as any[]) for (const p of t.posts || []) posts.push(postBrief(t, p));
  /* 新的在前 */
  posts.sort((a, b) => (a.date < b.date ? 1 : -1));
  return { posts, hidden: hiddenList() };
});

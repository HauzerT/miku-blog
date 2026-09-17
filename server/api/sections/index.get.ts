/* GET /api/sections · 板块树（含运行时文章与撤下名单）
   公开读取。前端拿它对静态页：改过名的换字、撤下的按名字撤行。 */
import { articleBrief, hiddenList, liveSections, postBrief, sectionStats, tracksNow } from '../../utils/briefs';
import { defineApiHandler } from '../../utils/http';
import { getArticles, getSections, sortByPitch, suggestPitch } from '../../utils/store';

export default defineApiHandler(() => {
  const tracks = tracksNow() as any[];
  const stats = sectionStats(tracks);
  const briefs = getArticles().map((a) => articleBrief(tracks, a));

  return {
    sections: sortByPitch(liveSections() as any[]).map((s: any) => {
      const st = stats.get(s.id) || { count: 0, recent: [] };
      const track = tracks.find((t) => t.id === s.id) || { id: s.id, name: s.name, posts: [] };
      return {
        id: s.id,
        name: s.name,
        pitch: s.pitch,
        black: Boolean(s.black),
        seed: Boolean(s.seed),
        def: s.def || '',
        lede: s.lede || '',
        subs: (s.subs || []).map((x: any) => ({ id: x.id, name: x.name, def: x.def || '' })),
        articles: st.count,
        recent: st.recent,
        runtime: briefs.filter((b) => b.section === s.id),
        /* 这个板块上的文章（两层的都算）。前端拿它对静态页：改过名的换字。
           撤下的不在这里——撤下的名单单列在 hidden 里（前端按名字撤行，
           而不是「不在这个数组里就撤」：静态页与动态页对子板块文章的处理本来
           就不一样，拿「缺了」当「撤了」会误删）。 */
        posts: (track.posts || []).map((p: any) => postBrief(track, p)),
      };
    }),
    articles: {
      total: tracks.reduce((n, t) => n + (t.posts || []).length, 0),
      runtime: getArticles().length,
    },
    hidden: hiddenList(),
    /* 建议音高看的是**全量**名单：撤下的板块还占着它的音，不然新建的会跟它对撞 */
    suggestPitch: suggestPitch(getSections()),
  };
});

/* ==========================================================================
   composables/useSite.ts · 站点内容的那一份共享状态
   ---------------------------------------------------------------------------
   content/posts.mjs（手写的一半）+ data/*.json（界面写的一半）由服务端
   server/utils/content.ts 装配好，再经 plugins/site-data.server.ts 灌进
   这个 useState —— 于是页面与组件拿到的都是同一份，SSR 与客户端不会打架。

   种子里先摆 content/posts.mjs：万一服务端那份没装上（比如纯前端预览），
   站点也不会白屏，只是看不到界面上改过的板块名。

   规矩：useState 只在 setup 期取一次，绝不放进取值的回调里。
   unhead 求值 <head> 时已经不在 Nuxt 实例里了，那时再 useSite() 会炸
   （"[nuxt] instance unavailable"）—— 所以下面每个导出都先抓住 state。
   ========================================================================== */
import { site as seedSite, tracks as seedTracks, excerpts as seedExcerpts } from '../content/posts.mjs';

export const useSite = () =>
  useState('cv01-site', () => ({
    site: seedSite,
    excerpts: seedExcerpts,
    tracks: seedTracks,
    hidden: { sections: [], posts: [] },
  }));

export const useTracks = () => {
  const site = useSite();
  return computed(() => site.value.tracks || []);
};

export const useSiteMeta = () => {
  const site = useSite();
  return computed(() => site.value.site || seedSite);
};

export const useExcerptPool = () => {
  const site = useSite();
  return computed(() => site.value.excerpts || seedExcerpts);
};

/* 按 slug 找一篇（认得出它属于哪条轨道），文章页与「上一篇 / 下一篇」都用它 */
export const useFindPost = (slug) => {
  const site = useSite();
  return computed(() => {
    const want = String(toValue(slug) || '');
    for (const track of site.value.tracks || []) {
      for (const post of track.posts || []) {
        if (post.slug === want) return { ...post, track };
      }
    }
    return null;
  });
};

/* 按 id 找一条轨道（板块页用） */
export const useFindTrack = (id) => {
  const site = useSite();
  return computed(() => {
    const want = String(toValue(id) || '');
    return (site.value.tracks || []).find((t) => t.id === want) || null;
  });
};

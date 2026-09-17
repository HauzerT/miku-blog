/* ==========================================================================
   composables/useArticleLayers.ts · 两层的名单：谁住在哪一边
   ---------------------------------------------------------------------------
   与旧 studio.js 的 loadLayers() / forgetLayers() 是同一件事：右手边那份菜单
   要按「这一条是界面写的还是 content/posts.mjs 里的原生内容」说不同的话——

     界面写的（data/*.json）  → 菜单说「删除」，删了就是真删；
     原生内容（源文件里那批）→ 菜单说「撤下」，记录落进 data/overrides.json，
                                源文件一个字节不动（post.hidden / section.hidden）。

   懒取一次，缓存住；改过东西之后 forget() 一下，下次右键重新问服务。
   与旧站一样是模块级缓存：菜单住在组件之外，缓存也该住在组件之外。
   ========================================================================== */
export type SectionLayer = { seed: boolean; name: string; pitch: string };
export type PostLayer = {
  runtime: boolean;
  title: string;
  section: string;
  sectionName: string;
  /* 正文被页面上改过的那一版（没有就是空串）：菜单靠它决定要不要摆「恢复成源文件」 */
  body: string;
};

export type LayerMap = {
  sections: Record<string, SectionLayer>;
  posts: Record<string, PostLayer>;
};

let layers: LayerMap | null = null;
let inflight: Promise<LayerMap> | null = null;

export const forgetLayers = () => {
  layers = null;
  inflight = null;
};

export const loadLayers = (): Promise<LayerMap> => {
  if (layers) return Promise.resolve(layers);
  if (inflight) return inflight;

  inflight = Promise.all([
    $fetch('/api/sections').catch(() => ({ sections: [] })),
    $fetch('/api/posts').catch(() => ({ posts: [] })),
  ])
    .then(([outSections, outPosts]: any[]) => {
      const sections: Record<string, SectionLayer> = {};
      for (const s of outSections?.sections || []) {
        sections[s.id] = { seed: Boolean(s.seed), name: s.name, pitch: s.pitch };
      }
      const posts: Record<string, PostLayer> = {};
      for (const p of outPosts?.posts || []) {
        posts[p.slug] = {
          runtime: Boolean(p.runtime),
          title: p.title,
          section: p.section,
          sectionName: p.sectionName,
          /* 正文被页面上改过的那种也捎上 */
          body: p.body || '',
        };
      }
      layers = { sections, posts };
      inflight = null;
      return layers;
    })
    .catch((err) => {
      inflight = null;
      throw err;
    });

  return inflight;
};

/* 某一条是不是真在名单里。认不出（刚建的板块、刚写的文章、刚在别处改过的）
   就作废重问一次——与旧 menuFor() 里那两段一模一样。 */
export const layersFor = async (want: { section?: string; post?: string }): Promise<LayerMap> => {
  let map = await loadLayers();
  const known = want.section ? map.sections[want.section] : want.post ? map.posts[want.post] : true;
  if (!known) {
    forgetLayers();
    map = await loadLayers();
  }
  return map;
};

/* 这个浏览器里的口令对不对（旧站的 verified：一次会话验一次就够）。
   走 withOwnerKey：它读的是 localStorage 里那把钥匙，服务自己验。
   口令没了 / 过期了就由调用方（useStudio 的 withKey）把人请进口令框。 */
let verified = false;
export const verifyOnce = async () => {
  if (verified) return;
  await withOwnerKey('/api/auth', { method: 'POST', body: {} });
  verified = true;
};
export const forgetVerified = () => {
  verified = false;
};

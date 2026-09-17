/* ==========================================================================
   composables/usePageRoutes.ts · 地址里的身份（板块 id / 文章 slug）
   ---------------------------------------------------------------------------
   正身是干净路由（/sections/niji、/posts/lru）。老地址（sections/niji.html、
   posts/lru.html）也照认——那些链接会被 `server/middleware/legacy-urls.ts` 301 过来，
   但页面里、书签里、别人抄走的地址里还可能留着带 `.html` 的那种写法。
   这两个小正则两代都认，所以这些地址不会解析错。

   单独开一个文件是因为「右键菜单」与「全局编辑模式」都要它——两边各写一份
   会漂（Nuxt 的自动导入还会因为重名把其中一份丢掉）。
   ========================================================================== */

/* 板块 id：/sections/<id>、/sections/<id>/<sub>、sections/<id>.html 都认。
   子板块那一截不在这里取——子板块的简介 / 导语在页面上没有接口。 */
export const sectionIdOf = (href: string): string => {
  const m = /(?:^|\/)sections\/([^/]+?)(?:\/([^/]+?))?(?:\.html)?(?:[?#]|$)/.exec(String(href || ''));
  return m ? decodeURIComponent(m[1]) : '';
};

/* 文章 slug：/posts/<slug> 与 posts/<slug>.html 都认 */
export const slugOf = (href: string): string => {
  const m = /(?:^|\/)posts\/([^/]+?)(?:\.html)?(?:[?#]|$)/.exec(String(href || ''));
  return m ? decodeURIComponent(m[1]) : '';
};

/* 当前这一页的身份：板块页给 id，文章页给 slug（右键菜单用） */
export const pageSectionId = () => (typeof location === 'undefined' ? '' : sectionIdOf(location.pathname));
export const pageSlug = () => (typeof location === 'undefined' ? '' : slugOf(location.pathname));

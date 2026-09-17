/* ==========================================================================
   server/middleware/legacy-urls.ts · 旧地址还认得路
   ---------------------------------------------------------------------------
   这一站原来是生成出来的静态页，地址都带 .html：index.html、archive.html、
   sections/niji.html、posts/lru.html …。换成 Nuxt 之后是干净路由（/、/archive、
   /sections/niji、/posts/lru），但**已经发出去的链接不该断**——README 里写过、
   别人收藏过、外面引用过的那些地址，301 到新地址就是了。

   与门厅的先后：middleware 按文件名排序，gate 在 legacy-urls 前面，所以
   没有盖章的人请求 /archive.html 会先被送回门厅（与旧服务端一致——它当年
   也是先过门厅再看文件），进了门才会拿到 301。

   映射规则：去掉末尾的 .html；/index.html 归到 /。查不到的（比如
   posts/_template.html）就交给路由自己 404。
   ========================================================================== */
export default defineEventHandler((event) => {
  const url = getRequestURL(event);
  if (!/\.html?$/i.test(url.pathname)) return;

  let to = url.pathname.replace(/\.html?$/i, '');
  if (to === '/index') to = '/';
  if (to === '') to = '/';

  /* 查询串留着（?enter=1 之类已经由门厅处理掉了，剩下的照带） */
  return sendRedirect(event, to + url.search, 301);
});

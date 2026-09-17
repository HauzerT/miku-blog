/* ==========================================================================
   plugins/site-data.server.ts · 把装配好的内容灌进 useState
   ---------------------------------------------------------------------------
   只在服务端跑一次（客户端那份从 payload 里来），所以页面与组件拿到的
   是同一份、SSR 与 hydration 不会打架。拿不到就留着种子内容，站点照样能看。
   ========================================================================== */
export default defineNuxtPlugin(async () => {
  const state = useSite();
  try {
    state.value = await $fetch('/api/content');
  } catch {
    /* 内容服务不可用：继续用 content/posts.mjs 那一份 */
  }
});

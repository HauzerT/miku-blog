/* ==========================================================================
   composables/useExcerpt.ts · 页顶「每日一句」
   ---------------------------------------------------------------------------
   以本地日期为种子选句：全站同一天、所有刷新都是同一句，过了零点自动换。
   与 assets/js/site.js 的 initExcerpt() 是同一个散列（改要一起改）。
   首帧先摆句库第一条，挂载后才换成今天那一句——SSR 出来的 HTML 与静态页一致。
   ========================================================================== */
export const useExcerpt = () => {
  const pool = useExcerptPool();
  const text = ref((pool.value && pool.value[0]) || '');
  const title = ref('每 24 小时换一句，全站同一天同一句');

  onMounted(() => {
    const list = pool.value;
    if (!list || !list.length) return;
    const now = new Date();
    const day = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
    /* 整数散列：相邻的日期必须跳到句库里互不相邻的位置 */
    let h = day;
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    h ^= h >>> 16;
    text.value = list[Math.abs(h) % list.length];
    title.value = `每日一句 · 本地日期 ${day} · 每 24 小时换一次`;
  });

  return { text, title };
};

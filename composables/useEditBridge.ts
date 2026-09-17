/* ==========================================================================
   composables/useEditBridge.ts · 「编辑这套东西」跟 Vue 世界之间的两座桥
   ---------------------------------------------------------------------------
   旧站的编辑机器（studio.js 的右键菜单 + 页面上直接改字，editmode.js 的全局
   编辑模式）全是**模块级 IIFE**：它们只跟 document 打交道，想提示一句就喊
   cv01.toast，想把改过的名字铺回轨道栏就自己改 DOM。

   搬到 Nuxt 之后有两件事不能再自己做：

     toast()      —— 提示条是 ToastBar.vue，状态住在 useToast 的 useState 里；
     refreshSite()—— 改完名字 / 撤下一条之后，轨道栏、首页索引、卷帘、文章行
                     读的是同一份共享状态，重取一次（composables/useSite.ts）
                     就够，不用再像 sections.js 那样就地改 DOM。

   这两个都要在组件 setup 的上下文里才取得出来（useState / $fetch），而
   真正喊它们的人住在模块级的监听器里（document 上的 click / contextmenu）。
   所以这里登记一次，那边随时可喊——与旧站 cv01.toast 是同一个用法。
   ========================================================================== */
type ToastFn = (text: string, bad?: boolean, action?: { label: string; run: () => void } | null, hold?: boolean) => void;

let toastFn: ToastFn | null = null;
let refreshFn: (() => Promise<unknown>) | null = null;
let withKeyFn: ((run: () => Promise<any>) => Promise<any>) | null = null;

/* 给测试探针与调试用：外面想知道「上一次是往哪一层存的」时可以看这个 */
export const editReport = (() => {
  const log: any[] = [];
  return {
    push(entry: any) {
      log.push(entry);
    },
    list() {
      return log.slice();
    },
    clear() {
      log.length = 0;
    },
  };
})();

export const useEditBridge = () => {
  const { toast } = useToast();
  const { withKey } = useStudio();

  toastFn = (text, bad = false, action = null, hold = false) => {
    toast(text, bad, action, hold);
  };
  refreshFn = () => refreshSite();
  withKeyFn = withKey;
};

/* 提示一句。桥还没搭上（组件没挂）就直接扔掉——总比抛异常好 */
export const bridgeToast: ToastFn = (text, bad = false, action = null, hold = false) => {
  if (toastFn) toastFn(text, bad, action, hold);
};

/* 重新取一份站点内容：改完名字 / 撤下一条之后，让整站跟着变 */
export const bridgeRefresh = async (): Promise<unknown> => {
  if (!refreshFn) return null;
  return await refreshFn();
};

/* 要口令的写操作统一从这里走（旧站的 cv01.withKey）：
   服务回 401 / 403 时先把口令框叫出来，再把这同一个请求重放一次。
   没有口令的人本来就看不到任何入口，这里是第二道，服务端的 requireAuth 才是边界。 */
export const bridgeWithKey = async <T>(run: () => Promise<T>): Promise<T> => {
  if (!withKeyFn) throw new Error('这台浏览器里没有口令，先去门厅输一次');
  return await withKeyFn(run);
};

/* 服务端的话原样说出来（与旧站 cv01.error 同一个用法） */
export const bridgeError = (err: unknown): string => {
  const text = apiError(err);
  bridgeToast(text, true);
  return text;
};

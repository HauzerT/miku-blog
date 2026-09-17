/* ==========================================================================
   composables/useAsk.ts · 「问一句」那个小浮层（旧站 studio.js 的 ask()）
   ---------------------------------------------------------------------------
   与口令框（.keygate，见 components/KeyDialog.vue）同一套壳，同一套 class：
   给了 value 就是「改名字」，没给就是「确认」。

   它回答三件事，返回值与旧站一个字不差：
     · 提交        → 输入框里的那段文字（纯确认那一档是空串 ''）
     · 取消 / Esc  → null
   调用方一律按 `if (yes === null) return;` 处理——「取消」与「确认」分得开。

   状态为什么放在模块级：喊它的人全在模块级的监听器里（document 上的
   contextmenu / click / keydown），与组件树没有关系。这个浮层住在
   components/EditOverlay.vue 里，那个组件在全站每页都在，所以模块级这份
   状态活得跟页面一样久——与旧站把 .keygate appendChild 到 body 是同一个寿命。
   ========================================================================== */
export type AskState = {
  on: boolean;
  title: string;
  hint: string;
  ok: string;
  /* 给了就是输入框（改名）；null 就是纯确认 */
  value: string | null;
  maxlength: number;
};

const ASK_OFF: AskState = { on: false, title: '', hint: '', ok: '确认', value: null, maxlength: 120 };

export const askState = ref<AskState>({ ...ASK_OFF });

let waiting: ((value: string | null) => void) | null = null;

/* 问一句。返回 Promise<string | null> */
export const askDialog = (opts: { title: string; hint?: string; value?: string; ok?: string; maxlength?: number }): Promise<string | null> =>
  new Promise((resolve) => {
    /* 上一次还没兑现的询问：先当取消掉，别把它永久挂在那里 */
    if (waiting) {
      const previous = waiting;
      waiting = null;
      previous(null);
    }
    waiting = resolve;
    askState.value = {
      on: true,
      title: opts.title,
      hint: opts.hint || '',
      ok: opts.ok || '确认',
      value: typeof opts.value === 'string' ? opts.value : null,
      maxlength: opts.maxlength || 120,
    };
  });

/* 兑现这次询问（AskDialog.vue 的提交 / 取消 / Esc 都走这里） */
export const askAnswer = (value: string | null) => {
  const resolve = waiting;
  waiting = null;
  askState.value = { ...ASK_OFF };
  if (resolve) resolve(value);
};

export const useAsk = () => ({ askState, askAnswer });

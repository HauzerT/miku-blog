/* ==========================================================================
   composables/useToast.ts · 右下角那条提示
   ---------------------------------------------------------------------------
   与旧 assets/js/studio.js 的 toast(text, bad, action, hold) 同一条：
   停留时长按「有没有撤销按钮 / 是不是坏消息 / 要不要多停一会儿」分四档。
   「撤下」之后那句「撤销」就挂在 action 上（{ label, run }）。

   注意：action 里是函数，不能塞进 useState（payload 要序列化），
   所以它单独放在模块级的变量里——只有看得见的那几个字段才进 state。
   ========================================================================== */
let action = null;
let timer = null;

export const useToast = () => {
  const state = useState('cv01-toast', () => ({
    text: '',
    bad: false,
    on: false,
    actionLabel: '',
  }));

  const toast = (text, bad = false, act = null, hold = false) => {
    action = act || null;
    state.value = {
      text: String(text == null ? '' : text),
      bad: Boolean(bad),
      on: true,
      actionLabel: action?.label || '',
    };
    if (timer) clearTimeout(timer);
    timer = setTimeout(
      () => {
        state.value = { ...state.value, on: false, actionLabel: '' };
        action = null;
      },
      action ? 9000 : bad ? 5200 : hold ? 7600 : 2600
    );
  };

  const runAction = () => {
    const act = action;
    state.value = { ...state.value, on: false, actionLabel: '' };
    action = null;
    if (timer) clearTimeout(timer);
    if (act && typeof act.run === 'function') act.run();
  };

  return { toastState: state, toast, runAction };
};

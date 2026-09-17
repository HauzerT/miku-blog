/* ==========================================================================
   composables/useStudio.ts · 悬浮工作台：探服务 / 口令 / 面板开合
   ---------------------------------------------------------------------------
   悬浮工作台这条工作流用得着的就这几段：

     1) 探一探服务在不在（/api/health，不在就整体隐身）
     2) 口令的存取与询问框
     3) 带着口令重放一次请求（401/403 时先把口令问来）
     4) 面板的开合（同一时刻只开一个，Esc 关，点外面关）

   右键菜单与全局编辑模式是另一条工作流（useContextMenu / useEditMode），不在这里。

   状态为什么放在模块级：两颗球住在 layouts/default.vue 的 StudioDock 里，
   换页时它不重建，而面板里的组件会挂上挂下——「服务在不在」「开着哪个面板」
   「这台浏览器有没有口令」必须活在组件之外。它们只在浏览器里被写
   （挂载与点击），服务端渲染时永远是初值，所以不存在跨请求串味。
   ========================================================================== */
import { apiError, fetchJson } from './useApi';
import { useToast } from './useToast';

const KEY_STORE = 'cv01-key';

const online = ref(false);
const openName = ref('');
const keyValue = ref('');

/* 口令提示框。等着这次询问的那两个回调不能进 ref（Promise 不能序列化），
   所以像 useToast 的 action 一样放在模块级——进 state 的只有看得见的几个字段。 */
const keyDialog = ref({ on: false, message: '', error: '', busy: false });
let waiting = null;

/* 面板换过内容之后把焦点收回第一个能按的东西上：
   怎么找那个元素由 StudioDock 挂载时登记进来，面板里的「← 工具箱」再喊一声。 */
let focusHook = null;

export const setPanelFocus = (fn) => {
  focusHook = fn;
};

export const focusPanel = () => {
  if (focusHook) focusHook();
};

export const useStudio = () => {
  const { toast } = useToast();

  const readKey = () => {
    try {
      return localStorage.getItem(KEY_STORE) || '';
    } catch {
      return '';
    }
  };

  /* 把 localStorage 里的口令读进来。挂载时读一次，窗口重新拿到焦点时再读一次——
     在门厅（另一个布局）里登录完回到站内页，工作台不该还当你没有口令。 */
  const adoptKey = () => {
    keyValue.value = readKey();
  };

  const setKey = (value) => {
    keyValue.value = String(value || '');
    try {
      localStorage.setItem(KEY_STORE, keyValue.value);
    } catch {
      /* 隐私模式：本次会话有效 */
    }
  };

  /* 带着口令去敲一个写接口。口令没有就不带——服务会用 401 说话，
     那才是真正的边界（withKey 接着把它变成一次口令询问）。 */
  const authed = (path, options = {}) => {
    const headers = { ...(options.headers || {}) };
    if (keyValue.value) headers['x-cv01-key'] = keyValue.value;
    return fetchJson(path, { ...options, headers });
  };

  /* ------------------------------------------------------------ 探服务 */
  /* 连不上就什么都不做：工作台隐身，站点照常（构建产物没起、静态托管也一样）。 */
  const probe = async () => {
    try {
      const res = await fetch('/api/health', { headers: { accept: 'application/json' } });
      if (!res.ok) return false;
      const data = await res.json().catch(() => null);
      if (!data || !data.ok) return false;
      online.value = true;
      return true;
    } catch {
      return false;
    }
  };

  /* ------------------------------------------------------------ 口令询问 */
  /* 口令不对或没填时弹一个小条，输完把这次请求重放一遍 */
  const askKey = (message) =>
    new Promise((resolve, reject) => {
      waiting = { resolve, reject };
      keyDialog.value = {
        on: true,
        message: message || '第一次上传需要口令。它印在启动服务的那个终端窗口里。',
        error: '',
        busy: false,
      };
    });

  const cancelKey = () => {
    const w = waiting;
    waiting = null;
    keyDialog.value = { ...keyDialog.value, on: false, error: '', busy: false };
    if (w) w.reject(new Error('没有口令，先不传了'));
  };

  /* 验一次口令。对了就记在这个浏览器里，并把这次询问兑现。 */
  const submitKey = async (value) => {
    const candidate = String(value || '').trim();
    if (!candidate) return false;
    keyDialog.value = { ...keyDialog.value, busy: true, error: '' };
    try {
      await $fetch('/api/auth', {
        method: 'POST',
        headers: { 'x-cv01-key': candidate },
        body: {},
      });
    } catch (err) {
      keyDialog.value = {
        ...keyDialog.value,
        busy: false,
        error: err?.data?.error || err?.message || '口令不对',
      };
      return false;
    }

    setKey(candidate);

    /* 口令顺手交给浏览器的密码库（如果它愿意收）——与门厅 login.js 同一套：
       存上之后，下次这个框一弹出来浏览器就替你填好了。存不上就静默算了。 */
    try {
      if (window.PasswordCredential && navigator.credentials && navigator.credentials.store) {
        navigator.credentials
          .store(new window.PasswordCredential({ id: 'cv01-owner', name: 'CV01 站长', password: candidate }))
          .catch(() => {});
      }
    } catch {
      /* 浏览器不给存就不存 */
    }

    const w = waiting;
    waiting = null;
    keyDialog.value = { on: false, message: '', error: '', busy: false };
    if (w) w.resolve(candidate);
    return true;
  };

  /* 需要口令的操作统一从这里走：401/403 时问一次再重放。
     （服务端的 401 是权限的真边界，这里只负责不让人卡在死胡同里。） */
  const withKey = async (run) => {
    try {
      return await run();
    } catch (err) {
      const status = err?.statusCode || err?.status;
      if (status === 401 || status === 403) {
        await askKey(apiError(err));
        return await run();
      }
      throw err;
    }
  };

  /* 站长工具箱那颗球：开之前先验一次口令。验过才开面板。 */
  const verifyOwner = () => withKey(() => authed('auth', { method: 'POST', json: {} }));

  /* ------------------------------------------------------------ 面板开合 */
  const closePanel = () => {
    openName.value = '';
  };

  /* 同一个球再点一次就是收起 */
  const togglePanel = (name) => {
    openName.value = openName.value === name ? '' : name;
  };

  return {
    online,
    openName,
    keyValue,
    keyDialog,
    hasKey: computed(() => Boolean(keyValue.value)),
    probe,
    adoptKey,
    setKey,
    authed,
    askKey,
    cancelKey,
    submitKey,
    withKey,
    verifyOwner,
    closePanel,
    togglePanel,
    /* 面板换内容之后收焦点那两下也一并交出去：写面板的人只跟 useStudio() 打交道，
       不用记得去 import 那两个模块级的函数（写了也不会错，只是别混着用） */
    setPanelFocus,
    focusPanel,
    toast,
  };
};

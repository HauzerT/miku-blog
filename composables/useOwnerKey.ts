/* ==========================================================================
   composables/useOwnerKey.ts · 站长那把钥匙
   ---------------------------------------------------------------------------
   身份就是「这台浏览器里有没有口令」：门厅（站长登录）、站长工具箱、右键菜单、
   编辑页看的都是同一件事——localStorage 里的 cv01-key。
   键名从 1.x 起就没变过（`cv01-key`），所以老浏览器里记着的那条口令不用重输。
   ========================================================================== */
const KEY_STORE = 'cv01-key';

export const useOwnerKey = () => {
  const key = ref('');

  const read = () => {
    try {
      return localStorage.getItem(KEY_STORE) || '';
    } catch {
      return '';
    }
  };

  const write = (value) => {
    key.value = String(value || '');
    try {
      if (key.value) localStorage.setItem(KEY_STORE, key.value);
      else localStorage.removeItem(KEY_STORE);
    } catch {
      /* 隐私模式：这次照样进得去，只是没记住 */
    }
  };

  const forget = () => write('');

  onMounted(() => {
    key.value = read();
  });

  return { key, read, write, forget };
};

/* 带口令去敲一个写接口。没有口令就抛一句人话，调用方负责把人请回门厅。 */
export const withOwnerKey = async (url, options = {}) => {
  const stored = (() => {
    try {
      return localStorage.getItem(KEY_STORE) || '';
    } catch {
      return '';
    }
  })();
  if (!stored) throw new Error('这台浏览器里没有口令，先去门厅输一次');
  return await $fetch(url, { ...options, headers: { ...(options.headers || {}), 'x-cv01-key': stored } });
};

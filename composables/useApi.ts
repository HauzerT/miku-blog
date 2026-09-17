/* ==========================================================================
   composables/useApi.ts · 跟本机服务说话的那几个动作
   ---------------------------------------------------------------------------
   取数与上传都走本机服务的 `/api/**`，错误一律翻成人话再往上抛。
   写操作要口令：那一条在 composables/useOwnerKey.ts 的 withOwnerKey 里
   （带上 `x-cv01-key`，服务自己验）。
   ========================================================================== */
const API_BASE = '/api/';

const url = (path) => (path.startsWith('/') ? path : API_BASE + path);

/* 把服务的话原样说出来。服务端的错误体是 {ok:false,error:'人话'}；
   没状态码的两种情形要分开：我们自己抛的那几句人话照用，
   fetch 的网络错误换成能照着做的一句（「双击 start.cmd」）。 */
export const apiError = (err) => {
  const fromServer = typeof err?.data?.error === 'string' ? err.data.error : '';
  if (fromServer) return fromServer;
  const status = err?.statusCode || err?.status;
  if (status) return err?.message || `HTTP ${status}`;
  const message = String(err?.message || '');
  if (message && !/fetch|network|load failed|abort/i.test(message)) return message;
  return '连不上服务：先双击 start.cmd 把它跑起来。';
};

export const fetchJson = (path, options = {}) => {
  const { json, ...rest } = options;
  return $fetch(url(path), json === undefined ? rest : { ...rest, method: rest.method || 'POST', body: json });
};

/* 上传：要进度条，所以用 XHR（fetch 拿不到上传进度） */
export const upload = (path, form, onProgress) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url(path));
    let key = '';
    try {
      key = localStorage.getItem('cv01-key') || '';
    } catch {
      key = '';
    }
    if (key) xhr.setRequestHeader('x-cv01-key', key);

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
    });
    xhr.addEventListener('load', () => {
      let data = {};
      try {
        data = JSON.parse(xhr.responseText || '{}');
      } catch {
        data = {};
      }
      if (xhr.status >= 200 && xhr.status < 300 && data.ok !== false) {
        resolve(data);
        return;
      }
      const err = new Error(data.error || `HTTP ${xhr.status}`);
      err.status = xhr.status;
      err.data = data;
      reject(err);
    });
    xhr.addEventListener('error', () => reject(new Error('上传没有回应：服务还跑着吗？')));
    xhr.send(form);
  });

/* 今天是几号：编辑页的日期栏默认它，格式与 content/posts.mjs 里的日期一致 */
export const todayStamp = () => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}`;
};

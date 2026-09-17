/* ==========================================================================
   server/utils/static-assets.ts · Nitro 静态资源表上的两处运行时修补
   ---------------------------------------------------------------------------
   两条都是「Nitro 在构建时把 public/ 烘成了一张表」的直接后果：

    1. 页面。prerender 出来的 .output/public/<路由>/index.html 会被静态中间件抢先
       发出去，而那个中间件排在**所有** server/middleware 前面（nitropack 的
       server-handlers 模板里它是 unshift 到第一位的）。于是门厅只管得住没有
       预渲染文件的地址：/、/archive、/posts/<slug> 全都能绕过门厅。
       启动时把表里的 .html 条目摘掉，页面请求就回到 SSR 渲染器上，门厅重新说话。

    2. 上传物。表是构建时 glob 出来的，磁盘上**后来**才出现的文件不在里面，
       而 /media/ 属于公开前缀——静态中间件对「前缀对但没有条目」的地址直接 404。
       于是刚上传的图片 / 音频要等下一次构建才取得到，而 nuxt.config 里那句
       「上传的新文件也不用重新构建」说的正是不要这样。写盘之后把新文件补进表里。

   两处都碰到了 Nitro 的内部结构（#nitro-internal-virtual/public-assets-data），
   所以写得尽量窄、尽量怂：拿不到那张表就什么都不做，最坏退回原样，
   绝不让服务起不来。
   ========================================================================== */
import { existsSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import publicAssets from '#nitro-internal-virtual/public-assets-data';

const table = (publicAssets || {}) as Record<string, any>;

/* readAsset() 量的是 `globalThis._importMeta_.url` 所在的目录（打包后就是
   .output/server），表里的 path 全是相对它的。这里必须用同一把尺子，
   否则读不到文件——所以先量一遍、再验证一遍，对不上就干脆不注册。 */
function serverDir(): string {
  try {
    const url = (globalThis as any)._importMeta_?.url || import.meta.url;
    return dirname(fileURLToPath(url));
  } catch {
    return process.cwd();
  }
}

/* 摘掉预渲染出来的页面（返回摘了几条，方便启动日志里交代一句） */
export function hidePrerenderedPagesFromStatic(): number {
  if (!table || typeof table !== 'object') return 0;
  let hidden = 0;
  for (const id of Object.keys(table)) {
    if (/\.html?$/i.test(id)) {
      delete table[id];
      hidden += 1;
    }
  }
  return hidden;
}

/* 上传物要用的那几个后缀。saveUpload 只放行图片 / 视频 / 音频，
   所以这里不需要一份完整的 MIME 表。 */
const TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.bmp': 'image/bmp', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.ogv': 'video/ogg', '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.wav': 'audio/wav',
  '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/opus', '.flac': 'audio/flac',
};

const typeOf = (id: string) => {
  const dot = id.lastIndexOf('.');
  return TYPES[id.slice(dot).toLowerCase()] || 'application/octet-stream';
};

/* 把一个刚写进 media/ 的文件补进静态资源表，让 /media/… 立刻可取 */
export function registerPublicAsset(id: string, fullPath: string): boolean {
  try {
    if (!table || !existsSync(fullPath)) return false;
    const rel = relative(serverDir(), fullPath).replace(/\\/g, '/');
    /* 对不上（比如 nuxt dev 里模块位置和产物不一样）就别注册：
       宁可退回「要重新构建」，也不要写一条读不到文件的记录——那会变成 500。 */
    if (!rel || !existsSync(resolve(serverDir(), rel))) return false;
    const st = statSync(fullPath);
    table[id] = {
      type: typeOf(id),
      encoding: undefined,
      etag: `"${st.size.toString(16)}-${Math.trunc(st.mtimeMs).toString(36)}"`,
      mtime: st.mtime.toJSON(),
      size: st.size,
      path: rel,
    };
    return true;
  } catch {
    return false;
  }
}

/* 文件被删掉之后把条目也去掉：留着它，请求会走到 readAsset 上炸成 500 */
export function unregisterPublicAsset(id: string): void {
  try {
    if (table && table[id]) delete table[id];
  } catch { /* 拿不到表就算了 */ }
}

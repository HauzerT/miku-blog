/* ==========================================================================
   server/utils/paths.ts · 仓库里的几个固定目录
   ---------------------------------------------------------------------------
   旧服务是从 store.mjs 的 import.meta.url 推仓库根的。Nitro 会把服务端代码打包进
   .output/server/chunks/，到那时 import.meta.url 指的是产物目录，往上两级已经不是
   仓库——所以那条路在 Nuxt 这边不能走（预渲染时更明显：连相对路径的深度都变了）。

   这里改成「跑起来的那个工作目录」：nuxt dev 与 node .output/server/index.mjs 都是
   站在仓库根起，data/ 与 media/ 就在眼前；换了地方就用 CV01_ROOT 指一下。
   与 server/utils/content.ts 用的是同一套规矩，两边不能各说各话。
   ========================================================================== */
import { join, normalize, sep } from 'node:path';

export const ROOT = process.env.CV01_ROOT || process.cwd();
export const DATA = join(ROOT, 'data');
export const MEDIA = join(ROOT, 'media');

/* 三个桶。旧 store.mjs 里这句是跟着它自己的 ROOT 走的，这里跟着上面这个 ROOT */
export const MEDIA_DIRS: Record<string, string> = {
  images: join(MEDIA, 'images'),
  videos: join(MEDIA, 'videos'),
  music: join(MEDIA, 'music'),
};

/* 一次上传请求的上限（沿用旧 multipart.js 的 DEFAULT_LIMIT）。
   一次请求里所有文件加起来算：手机上拍一段一分钟的视频大概 100–200MB，
   卡在 64MB 会让人以为坏了。 */
export const MAX_BODY = 256 * 1024 * 1024;

/* 路径安全：解析出来的路径必须还在白名单目录里。
   注意调用方给的是**已经解码过一次**的路径，这里不能再 decode 一遍——
   否则中文文件名（%E6%B5%8B…）会被解成乱码，文件明明在却取不到。 */
export function safePath(rootDir: string, relative: string): string | null {
  const clean = String(relative).replace(/\\/g, '/').replace(/^\/+/, '');
  const full = normalize(join(rootDir, clean));
  if (!full.startsWith(normalize(rootDir) + sep) && full !== normalize(rootDir)) return null;
  return full;
}

/* 任何一段以 `.` 开头的路径都不该被当成页面（.env、.gitignore、.ncm-session.json…）。
   旧服务里这是一条 404 规则；在这里它只是「别去过门厅，交给 Nitro 去 404」。 */
export function hasDotSegment(pathname: string): boolean {
  return String(pathname).split('/').some((seg) => seg.length > 1 && seg.charCodeAt(0) === 46);
}

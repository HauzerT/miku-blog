/* ==========================================================================
   server/utils/api-fallback.ts · 旧分发器的「最后一句」
   ---------------------------------------------------------------------------
   旧服务是一整条 if 链，两条出口很能说明它的性格：

     · 路径不合它的正则（/api/articles/not.a.key 里的 `.`）→ 不匹配 → 往下走
     · 一路走到底 → `throw new HttpError(404, '没有这个接口：' + path)`

   而 `requireAuth` 排在写接口那一段的**前面**。于是「没有这个接口」的两种走法
   都先验口令：没带口令是 401「口令不对」，带了才对 404「没有这个接口：…」。

   这在今天看当然不如「不存在就直接 404」漂亮，但它是旧服务对外的行为，
   浏览器脚本与自检脚本都按这套写；这里照抄，不为好看改状态码。
   （Nitro 自己那份 404 长的是 {statusCode,statusMessage,data…}，形状也不对。）
   ========================================================================== */
import type { H3Event } from 'h3';
import { getRouterParam } from 'h3';
import { requireAuth } from './auth';
import { apiPath, httpError } from './http';

/* 口令先验，然后一律「没有这个接口」——旧分发器的尾巴 */
export function noSuchApi(event: H3Event): never {
  requireAuth(event);
  throw httpError(404, `没有这个接口：${apiPath(event)}`);
}

/* Nitro 的 [key] / [id] 什么都能吞，旧服务的正则只允许 \w 与横线。
   不合规的键就按「这一条路径不存在」处理——也就是走上面那条尾巴，
   所以这里也要先 requireAuth。 */
export function segmentKey(event: H3Event, name: string): string {
  const raw = getRouterParam(event, name) || '';
  if (!/^[\w-]+$/.test(raw)) noSuchApi(event);
  return raw;
}

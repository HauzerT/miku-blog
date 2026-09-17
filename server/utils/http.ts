/* ==========================================================================
   server/utils/http.ts · 接口那层的一点点收口
   ---------------------------------------------------------------------------
   旧服务把**所有**出错的接口都回成 `{ ok:false, error:"一句人话" }`（状态码另说），
   浏览器那几个脚本与自检脚本读的就是 body.error —— 这个形状一个字节都不能变。
   Nitro 自己抛出来的 HTTPError 会变成 {statusCode,statusMessage,stack…}，形状不对。

   于是这里做一个薄壳：路由里只管 return 数据、或者 throw httpError(状态码, 人话)，
   「异常 → {ok:false,error}」这件事只在这一个地方发生。宁可有这一个壳，
   也不要在二十个路由里各写一遍 try/catch——那种写法迟早会漏一个。
   ========================================================================== */
import type { H3Event } from 'h3';
import {
  defineEventHandler,
  getRequestHeader,
  getRequestURL,
  readRawBody,
  setResponseHeader,
  setResponseStatus,
} from 'h3';
import { MAX_BODY } from './paths';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const httpError = (status: number, message: string) => new HttpError(status, message);

/* 请求体超限那句中文，与旧 readBody 逐字一致——包括 256KB 的预览上限会显示成
   「超过 0MB」这件小事：文案改了，check 脚本按字符串比对的地方就会红。 */
export const tooBigMessage = (limit: number) =>
  `上传内容超过 ${Math.round(limit / 1048576)}MB，先在本地压一下再传`;

/* 上限之内的原始请求体。旧 readBody 是「先看 content-length，再边读边数」，
   这里照做：声明超了就直接 413，不再把几十 MB 读进内存。 */
export async function readBodyLimited(event: H3Event, limit = MAX_BODY): Promise<Buffer> {
  const declared = Number(getRequestHeader(event, 'content-length') || 0);
  if (declared && declared > limit) throw new HttpError(413, tooBigMessage(limit));
  const raw = (await readRawBody(event, false)) as Buffer | undefined;
  const body = raw || Buffer.alloc(0);
  if (body.length > limit) throw new HttpError(413, tooBigMessage(limit));
  return body;
}

/* 旧代码到处是 `JSON.parse((await readBody(...)).toString('utf8') || '{}')`：
   空体重当 `{}`，写坏了就是一次 500。这里保持一致。 */
export async function readJsonBody(event: H3Event, limit: number): Promise<any> {
  const raw = await readBodyLimited(event, limit);
  return JSON.parse(raw.toString('utf8') || '{}');
}

/* 路由的壳。返回值为 undefined 时不发响应（不会有路由这么干），其余照常。 */
export function defineApiHandler<T>(handler: (event: H3Event) => T | Promise<T>) {
  return defineEventHandler(async (event) => {
    /* 接口一律不缓存：旧 sendJson 每次都带 no-store */
    setResponseHeader(event, 'cache-control', 'no-store');
    try {
      return await handler(event);
    } catch (err: any) {
      const status = Number(err?.status || err?.statusCode) || 500;
      if (status >= 500) console.error('[服务出错]', err);
      setResponseStatus(event, status);
      return { ok: false, error: err?.message || '服务器内部错误' };
    }
  });
}

/* 报错信息里的路径：与旧服务一样去掉结尾的斜杠（pathname.replace(/\/+$/,'') || '/api'） */
export function apiPath(event: H3Event): string {
  const pathname = getRequestURL(event).pathname.replace(/\/+$/, '');
  return pathname || '/api';
}

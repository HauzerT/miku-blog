/* 兜底：/api/** 上没有这一条接口，或者方法不对
   ---------------------------------------------------------------------------
   旧服务是一个大 if 链，最后一句是 `throw new HttpError(404, '没有这个接口：' + path)`，
   而 requireAuth 排在写接口那一段的前面——所以「压根没有的接口」与「方法不对」
   在旧服务里是「没口令 401、有口令 404」，不是直接 404。
   Nitro 自己那份 404 长的是 {statusCode,statusMessage,data…}，形状也对不上，
   于是这里补一个通配路由，把旧服务的两种回答原样接回来（见 utils/api-fallback.ts）。
   具体的路由（包括 /api/music/settings 这条静态段）都比这个 ** 更具体，先匹配。 */
import { noSuchApi } from '../utils/api-fallback';
import { defineApiHandler } from '../utils/http';

export default defineApiHandler((event) => noSuchApi(event));

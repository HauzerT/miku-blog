/* ==========================================================================
   server/utils/auth.ts · 口令
   ---------------------------------------------------------------------------
   口令是本站**唯一**的真权限。门厅那枚 cv01-enter 的章不是：访客本来就是公开的，
   谁都能从门口走一趟；真正的边界在这里，而且每一次都由 requireAuth 现验。

   三件事：

     keyOf       口令从哪来：头 x-cv01-key → Authorization: Bearer → ?key=
                 （这个先后次序是旧的，浏览器几个脚本按它写，不能改）
     keyMatches  定长比较。字符串 === 会在第一个不同的字节上短路，理论上能把口令
                 一位一位试出来；timingSafeEqual 两边长度不同时直接抛，所以先用
                 长度挡一下——长度本身不是秘密（口令是定长的）。
                 比的是 UTF-8 字节，所以中文口令也算数。
     requireAuth 每个写接口的第一句。

   限速（authlimit.mjs）也在这里装配：它是纯逻辑、没有 import，
   可以原样复用。来客默认只认 socket 地址，挂 tunnel 的人用 CV01_TRUST_PROXY=1
   才采信 CF-Connecting-IP——x-forwarded-for 一律不看（谁都能自己填）。
   ========================================================================== */
import { timingSafeEqual } from 'node:crypto';
import type { H3Event } from 'h3';
import { getRequestHeader, getRequestURL } from 'h3';
import { AUTH_LIMIT_DEFAULTS, clientKey, createAuthLimit } from '../lib/authlimit.mjs';
import { httpError } from './http';
import { getSettings } from './store';

/* 公网部署时的两个开关。两个都默认关着——默认值必须是「本机跑」的那一套。 */
export const TRUST_PROXY = /^(1|true|yes)$/i.test(String(process.env.CV01_TRUST_PROXY || ''));
export const AUTH_FREE_ATTEMPTS = Number(process.env.CV01_AUTH_FREE || AUTH_LIMIT_DEFAULTS.freeAttempts);

/* 试错记录只在内存里。重启服务即清空——重启是我们自己的动作，不是攻击者的手段；
   把它落盘反而多出一个可以被撑爆的文件。 */
export const authLimit = createAuthLimit({ freeAttempts: AUTH_FREE_ATTEMPTS });

export const authKey = (event: H3Event): string =>
  clientKey(event.node.req, { trustProxy: TRUST_PROXY });

/* ------------------------------------------------------------------ 门厅那枚章
   进主界面之前先过门厅，门厅在这台浏览器上盖一枚 cv01-enter 的章（三十天）。
   /api/auth 口令验过之后顺手也盖一枚——登录页就是靠它把人送进站点的。
   属性与旧服务逐字对齐：Path=/; Max-Age=…; SameSite=Lax（没有 HttpOnly：
   站点脚本要看它在不在，决定显不显示「锁上门」）。 */
export const ENTER_COOKIE = 'cv01-enter';
export const ENTER_MAX_AGE = 30 * 24 * 60 * 60;

export const enterCookieOptions = (maxAge = ENTER_MAX_AGE) => ({
  path: '/',
  maxAge,
  sameSite: 'lax' as const,
});

/* ------------------------------------------------------------------ 口令比对 */

export function keyOf(event: H3Event): string {
  const header = getRequestHeader(event, 'x-cv01-key');
  if (header) return String(header);
  const auth = getRequestHeader(event, 'authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (m) return m[1];
  /* ?key= 用的是 URLSearchParams 的取法（重复的 key 取第一个），与旧服务一致 */
  return getRequestURL(event).searchParams.get('key') || '';
}

export function keyMatches(candidate: unknown, expected: unknown): boolean {
  const a = Buffer.from(String(candidate || ''), 'utf8');
  const b = Buffer.from(String(expected || ''), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function requireAuth(event: H3Event): void {
  const settings = getSettings();
  if (!settings.passphrase) throw httpError(403, '这台机器上还没有口令，请看启动服务的那个终端窗口');
  if (!keyMatches(keyOf(event), settings.passphrase)) throw httpError(401, '口令不对');
}

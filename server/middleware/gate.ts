/* ==========================================================================
   server/middleware/gate.ts · 门厅
   ---------------------------------------------------------------------------
   进主界面之前先过门厅。门厅会在这台浏览器上盖一枚 `cv01-enter` 的章（三十天），
   之后就不再拦；`?leave=1` 把那枚章抹掉（门厅里的「锁上门」）。

   说清楚它是什么：**这是门厅，不是锁。** 访客本来就是公开的，谁都能从门口走一趟；
   真正的权限仍然是口令，而且每一次都由 API 那一层的 requireAuth 现验——
   所以「访客」档里拿不到任何写操作。这道门管的是「你从门口进来」，不是「你进不来」。
   不想要它就往 data/settings.json 里加一行 "gate": false。

   与旧 server.mjs 的差别只有两处，都是网址换了：

     · 旧的 HIDDEN 目录黑名单不再需要——那些目录已经不在文档根里，Nitro 根本不服务
       它们（/data/settings.json 这类带后缀的地址连门厅都不过，直接 404）。
     · 旧的门厅只认 `.html`，新路由没有后缀，所以「是不是页面」改判**有没有后缀**：
       带后缀的一律当静态资源放走，`/` 与 `/archive` 这种就当页面拦下来。

   而 410 那件事照旧：被撤下的原生内容静态文件还在磁盘上，但服务不再认它。
   不给原页、也不假装 404——明说「这一条撤下了」以及怎么放回来。
   ========================================================================== */
import { getCookie, getRequestURL, sendRedirect, setCookie, setResponseHeader, setResponseStatus } from 'h3';
import { ENTER_COOKIE, ENTER_MAX_AGE, enterCookieOptions } from '../utils/auth';
import { hiddenList } from '../utils/briefs';
import { hasDotSegment } from '../utils/paths';
import { hidePrerenderedPagesFromStatic } from '../utils/static-assets';
import { getOverrides, getSettings, hiddenIn } from '../utils/store';

/* 这个模块**不是懒加载的**（中间件在服务起来时就要挂上），所以下面这一句
   就是「启动时」：把预渲染出来的页面从静态资源表里摘掉，否则静态中间件排在
   门厅前面，页面会绕过门厅直接发出去。为什么必须这样，见那个文件的开头。 */
const released = hidePrerenderedPagesFromStatic();
if (released) console.log(`[门厅] 让 ${released} 个预渲染页面改走运行时渲染（否则它们会绕过门厅）`);

/* 接口、资源、构建产物：门厅一概不碰。它们要么有自己的权限（/api），
   要么本来就该公开（/assets、/_nuxt）。 */
const NOT_PAGES = new Set(['api', 'assets', 'media', 'design', '_nuxt', '_ipx']);

/* 要过门厅的：站点页面。判据是「没有后缀」——旧路由是 .html，新路由是 /archive、
   /posts/<slug> 这种干净地址；带后缀的（.css/.json/.mjs/…）都当静态资源放走，
   于是 /data/settings.json、/server/server.mjs 这些连门厅都不过，Nitro 直接 404。 */
function isPagePath(pathname: string): boolean {
  if (hasDotSegment(pathname)) return false;
  const segments = pathname.split('/').filter(Boolean);
  const top = segments[0] || '';
  if (top && (NOT_PAGES.has(top) || top.charCodeAt(0) === 95 /* _ */)) return false;
  const last = segments[segments.length - 1] || '';
  if (last.includes('.')) return /\.html?$/i.test(last);
  return true;
}

/* 302：把查询里的 enter / leave 摘掉，其余原样留着 */
function cleanQuery(url: URL, drop: string[]): string {
  const q = new URLSearchParams(url.search);
  for (const key of drop) q.delete(key);
  const rest = q.toString();
  return `${url.pathname}${rest ? '?' + rest : ''}`;
}

/* 百分号写坏了的地址（比如 /%zz）：旧服务在这里会把 decodeURIComponent 的异常
   抛穿成 500。解不出来就当它不是一页——一个干净的 404，比什么都好。 */
function decodePathOrNull(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

function sendPlain404(event: any) {
  setResponseStatus(event, 404);
  setResponseHeader(event, 'content-type', 'text/plain; charset=utf-8');
  return '404';
}

const esc = (s: unknown) =>
  String(s == null ? '' : s).replace(/[<>&"]/g, (c) => (({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }) as any)[c]);

/* 撤下的那一页：它在磁盘上还在（content/posts.mjs 生成的那份），但已经不在站点里了。
   410 而不是 404——它曾经在，是被主动撤下来的；页面照旧说清楚怎么放回来。 */
function gonePage(event: any, key: string, kind: 'post' | 'section') {
  const hidden = hiddenList();
  const found = kind === 'post'
    ? hidden.posts.find((p: any) => p.slug === key)
    : hidden.sections.find((s: any) => s.id === key);
  const name = found ? (found as any).title || (found as any).name : key;
  const from = kind === 'post' ? 'content/posts.mjs 里的原生文章' : 'content/posts.mjs 里的原生板块';
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>已撤下 · ${esc(name)}</title>
<link rel="stylesheet" href="/assets/css/palette.css">
<link rel="stylesheet" href="/assets/css/tokens.css">
<link rel="stylesheet" href="/assets/css/base.css">
</head><body><main class="main" style="max-width:34em;margin:12vh auto">
<p class="sect-head__pitch" style="font-family:var(--f-measure);color:var(--miku-deep)">已撤下</p>
<h1 class="sect-head__name" style="font-family:var(--f-read)">${esc(name)}</h1>
<p class="lede" style="font-family:var(--f-read)">这一条被站长从站点上撤下了。它是 ${from}，源文件没有动——想放回来，把 <code>data/overrides.json</code> 里对应的那一条删掉即可。</p>
<p><a href="/" style="border-bottom:1px solid var(--miku-deep);color:var(--miku-deep)">回首页</a></p>
</main></body></html>`;
  setResponseStatus(event, 410);
  setResponseHeader(event, 'content-type', 'text/html; charset=utf-8');
  return html;
}

const POST_PATH = /^\/posts\/([^/]+?)\/?$/;
const SECTION_PATH = /^\/sections\/([^/]+?)(?:\/([^/]+?))?\/?$/;

/* 命中撤下的记录就返回 410 那一页；没命中返回 undefined（让请求继续往下走） */
function goneResponse(event: any, pathname: string) {
  const overrides = getOverrides();

  const post = POST_PATH.exec(pathname);
  if (post) {
    const slug = decodePathOrNull(post[1]);
    if (slug && hiddenIn(overrides.posts, slug)) return gonePage(event, slug, 'post');
  }

  const section = SECTION_PATH.exec(pathname);
  if (section) {
    const id = decodePathOrNull(section[1]);
    if (id && hiddenIn(overrides.sections, id)) return gonePage(event, id, 'section');
  }

  return undefined;
}

export default defineEventHandler((event) => {
  /* 预渲染是构建期在本机自己取的页面，没有浏览器那枚 cookie；门厅是运行时的东西，
     静态产物本来也不带门（旧的 file:// / 静态托管同理）。不跳过的话，
     每一条预渲染出来的 HTML 都会变成登录页。 */
  if (import.meta.prerender) return;

  if (getSettings().gate === false) return;

  const method = String(event.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return;

  const url = getRequestURL(event);
  const rawPath = url.pathname;
  if (!isPagePath(rawPath)) return;

  /* `?leave=1` 在哪一页都认——门厅里那条「锁上门」就指着它 */
  if (url.searchParams.has('leave')) {
    setCookie(event, ENTER_COOKIE, '', enterCookieOptions(0));
    return sendRedirect(event, '/login', 302);
  }

  const pathname = decodePathOrNull(rawPath);
  if (pathname === null) return sendPlain404(event);

  /* /login 自己不过门（它就是门厅） */
  if (pathname === '/login' || pathname === '/login.html') return;

  if (url.searchParams.has('enter')) {
    const to = cleanQuery(url, ['enter', 'leave']) || '/';
    setCookie(event, ENTER_COOKIE, '1', enterCookieOptions(ENTER_MAX_AGE));
    return sendRedirect(event, to, 302);
  }

  if (!getCookie(event, ENTER_COOKIE)) {
    const next = pathname + (url.search || '');
    return sendRedirect(event, `/login?next=${encodeURIComponent(next)}`, 302);
  }

  return goneResponse(event, pathname);
});

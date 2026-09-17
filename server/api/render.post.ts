/* POST /api/render · 正文预览
   ---------------------------------------------------------------------------
   **不需要口令**（写文章时右栏实时预览要用它）。它不落盘，但白算：marked 与 KaTeX
   都在同一条管线里，一次塞进去几 MB 的公式就能把这一颗 CPU 占住。所以两道闸：

     · 正文上限 256KB —— 一篇博客用不到更多；
     · 同时最多 2 个在渲染 —— 超了就 429，等一会儿再来。

   这不是安全边界（本站真正的边界是口令），是别让一个来客把服务拖死。 */
import { setResponseHeader } from 'h3';
import { renderMarkdown } from '../lib/markdown.mjs';
import { defineApiHandler, httpError, readJsonBody } from '../utils/http';

const RENDER_LIMIT = 256 * 1024;
const RENDER_MAX = 2;

/* 模块级的计数：Nitro 里这个模块是单例，与旧服务的模块级变量是同一回事 */
let renderInFlight = 0;

export default defineApiHandler(async (event) => {
  /* 顺序与旧服务一致：先把正文读进来，再看有没有排队 */
  const body = await readJsonBody(event, RENDER_LIMIT);
  if (renderInFlight >= RENDER_MAX) {
    setResponseHeader(event, 'retry-after', '2');
    throw httpError(429, '预览排着队呢，过一两秒再敲一次');
  }
  renderInFlight += 1;
  try {
    return { ok: true, html: renderMarkdown(String(body.source || '')) };
  } finally {
    renderInFlight -= 1;
  }
});

/* ==========================================================================
   server/lib/htmltext.mjs · 只在「文本节点」上动手
   ---------------------------------------------------------------------------
   把一段 HTML 拆成标签与文本：标签原样留着，文本交给 fn 换一遍。
   code / pre / script / style / kbd / samp / textarea 里面一律不碰——
   写进代码块里的 :smile: 或 $x$ 就该是字符本身。
   emoji 短代码与数学公式都走这一个函数，省得各写一套 HTML 扫描。
   ========================================================================== */

const SKIP = new Set(['code', 'pre', 'script', 'style', 'kbd', 'samp', 'textarea']);
const VOID = new Set([
  'br', 'img', 'input', 'hr', 'meta', 'link', 'source', 'track', 'wbr',
  'col', 'area', 'base', 'embed', 'param',
]);
/* 一个有头有尾的标签。故意要求 tag 名以字母开头：
   公式里的 a < b 不该被当成标签（那一串后面通常也没有 '>'）。 */
const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/?)>/g;

export function mapText(html, fn) {
  const src = String(html == null ? '' : html);
  let out = '';
  let last = 0;
  let depth = 0;   /* > 0 = 正在 code / pre 这些「原样」标签里面 */

  for (const m of src.matchAll(TAG_RE)) {
    const text = src.slice(last, m.index);
    if (text) out += depth ? text : fn(text);
    out += m[0];
    const name = m[1].toLowerCase();
    const closing = m[0][1] === '/';
    const selfClosed = m[2] === '/' || VOID.has(name);
    if (SKIP.has(name) && !selfClosed) depth = Math.max(0, depth + (closing ? -1 : 1));
    last = m.index + m[0].length;
  }

  const tail = src.slice(last);
  if (tail) out += depth ? tail : fn(tail);
  return out;
}

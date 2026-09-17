/* ==========================================================================
   server/utils/text.ts · 写进 data/ 之前的那点清洗
   ---------------------------------------------------------------------------
   两个函数，一个纯字符串活儿：

     sanitizeHtml  页面上直接改字存下来的是 HTML，这里做一遍**轻**清洗。
                   它不假装是一道安全边界（写的人手上本来就有口令），挡的是
                   「手滑」和「粘贴带进来的东西」。
     cleanLine     板块的简介 / 导语是纯文本，但 `<br>` 是它的一部分——先把 br
                   换成占位符、摘掉所有尖括号、再把 br 换回来。

   为什么另开一个文件：这两个函数是纯的、无状态的，放进 store.ts 会让那个文件
   同时管着磁盘与字符串，职责糊在一起。
   ========================================================================== */
import { decorateBody } from '../lib/markdown.mjs';

/* 行内样式只留 text-decoration-color（下划线可选青或粉，就靠它） */
const KEEP_STYLE = /^text-decoration-color\s*:/i;

export function sanitizeHtml(input: unknown): string {
  let html = String(input == null ? '' : input).slice(0, 400000);
  html = html.replace(/<\s*(script|style|iframe|object|embed|link|meta)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  html = html.replace(/<\s*(script|style|iframe|object|embed|link|meta)\b[^>]*>/gi, '');
  html = html.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  html = html.replace(/(href|src)\s*=\s*("|')?\s*javascript:[^"'>\s]*("|')?/gi, '$1="#"');
  html = html.replace(/\s(contenteditable|spellcheck|data-editing)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  html = html.replace(/\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi, (_whole, dq, sq) => {
    const kept = String(dq != null ? dq : sq || '')
      .split(';')
      .map((bit) => bit.trim())
      .filter((bit) => KEEP_STYLE.test(bit))
      .join('; ');
    return kept ? ` style="${kept}"` : '';
  });
  return html;
}

/* 页面上直接改的正文：存 HTML，源文件一个字节不动。
   过了 sanitizeHtml 之后还要走一遍 emoji 与公式——不然页面上改出来的那段正文里
   :smile: 和 $…$ 就只是字符，而静态页里的同一段是渲染好的。 */
export const decoratedBody = (input: unknown): string => decorateBody(sanitizeHtml(input));

const MARK = '\u0000';

export function cleanLine(value: unknown): string {
  return String(value == null ? '' : value)
    .replace(/<\s*br\s*\/?\s*>/gi, MARK)
    .replace(/[<>]/g, '')
    .replace(new RegExp(MARK, 'g'), '<br>')
    .replace(/\s+/g, ' ')
    .trim();
}

/* 文章日期：`2025.3.1` / `2025-3-1` 都收，认不出就退回今天。
   旧服务是启动时算一次 today()，这里每次调用现算——跨零点时更对。 */
export function today(): string {
  const n = new Date();
  return `${n.getFullYear()}.${String(n.getMonth() + 1).padStart(2, '0')}.${String(n.getDate()).padStart(2, '0')}`;
}

export function normalizeDate(value: unknown): string {
  const s = String(value || '').trim();
  if (/^\d{4}\.\d{1,2}\.\d{1,2}$/.test(s)) {
    const [y, m, d] = s.split('.');
    return `${y}.${m.padStart(2, '0')}.${d.padStart(2, '0')}`;
  }
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) {
    const [y, m, d] = s.split('-');
    return `${y}.${m.padStart(2, '0')}.${d.padStart(2, '0')}`;
  }
  return today();
}

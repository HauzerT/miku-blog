/* ==========================================================================
   server/lib/markdown.mjs · 正文管线：Markdown → HTML，顺带公式与 emoji
   ---------------------------------------------------------------------------
   三件事，一条链：

     marked（assets/vendor/marked）   CommonMark + GFM：标题六档、表格、任务列表、
                                     删除线、自动链接、嵌套列表、围栏代码…
     decorateEmoji（./emoji.mjs）     `:smile:` → 😄（只在文本节点里，代码块不动）
     renderMath（本文件）             $…$ / $$…$$ / \(…\) / \[…\] → KaTeX（服务端渲染）

   为什么公式在服务端渲染：KaTeX 的 CSS 与字体是本地文件，渲染出来的 HTML 直接进
   页面，不闪一下、也不需要浏览器跑 JS——静态托管、file:// 打开都一样是排好版的。
   浏览器那侧因此一个数学脚本都不用加。
   KaTeX 自己那个 auto-render 是给 DOM 用的，这里是字符串版，逻辑简单得多。

   正文是**站长自己写的**（编辑页的 Markdown、posts.mjs 里的 HTML），
   所以 HTML 原样放行、公式原样编译，不做转义或白名单——那属于「页面上直接改字」
   那条路（那里有 sanitizeHtml）。
   ========================================================================== */

import { Marked } from '../../assets/vendor/marked/marked.esm.js';
import katex from '../../assets/vendor/katex/katex.mjs';
import { mapText } from './htmltext.mjs';
import { decorateEmoji } from './emoji.mjs';

const md = new Marked({ gfm: true, breaks: false });

/* 数学的四种写法。$$…$$ 与 \[…\] 是独立成行的公式，$…$ 与 \(…\) 在行内。
   行内那种不跨行、也不吃空内容——「花了 $5 到 $10」这种句子不会被当成公式。 */
const MATH_RE = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$([^$\n]+?)\$/g;

/* marked 会把文本里的 < > 转成 &lt; &gt;，公式里得还原回字符，KaTeX 才认得 */
const ENTITIES = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
const decodeForTex = (s) => s.replace(/&(?:lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m]);

function renderTex(tex, display) {
  try {
    return katex.renderToString(decodeForTex(String(tex).trim()), {
      displayMode: Boolean(display),
      throwOnError: false,     /* 写坏了就红字标出来，别把整篇正文吃掉 */
      strict: false,
      trust: false,
    });
  } catch (err) {
    return null;
  }
}

/* ---------------------------------------------------------------- Markdown 那条路
   公式必须在 marked **之前**就抠出来：不然
     · `\(` 会被 Markdown 当成转义，`\(x\)` 到 marked 手里已经变成 `(x)`；
     · `$a_1 + a_2$` 里的下划线会被当成强调，公式还没编译就被拆了。
   所以：先把公式换成占位符 → 交给 marked → 再把占位符换回 KaTeX 的 HTML。
   占位符不带 Markdown 元字符；独立公式单独占一行。
   代码块与行内代码先整块摘走（那里的 $ 是字符，不是公式），公式找完再放回来——
   $$…$$ 会跨行，所以不能一行一行地找。 */
const PH = (i) => `@@CV01MATH${i}@@`;
const PH_RE = /@@CV01MATH(\d+)@@/g;
const STASH_RE = /\u0000K(\d+)\u0000/g;

function protectMath(source) {
  const src = String(source == null ? '' : source).replace(/\r\n?/g, '\n');
  const stash = [];
  const items = [];
  const keep = (chunk) => { stash.push(chunk); return `\u0000K${stash.length - 1}\u0000`; };

  let text = src
    .replace(/^```[^\n]*\n[\s\S]*?^```[^\n]*$/gm, keep)   /* 围栏代码块（含语言那行） */
    .replace(/^(?: {4,}|\t)[^\n]*$/gm, keep)              /* 缩进代码块 */
    .replace(/`[^`\n]*`/g, keep);                         /* 行内代码 */

  text = text.replace(MATH_RE, (whole, d1, d2, i1, i2) => {
    const tex = d1 ?? d2 ?? i1 ?? i2;
    if (!tex || !tex.trim()) return whole;
    const display = d1 !== undefined || d2 !== undefined;
    items.push({ tex, display });
    return display ? `\n${PH(items.length - 1)}\n` : PH(items.length - 1);
  });

  return { text: text.replace(STASH_RE, (m, i) => stash[Number(i)]), items };
}

function restoreMath(html, items) {
  if (!items.length) return html;
  const withBlocks = html.replace(/<p>\s*@@CV01MATH(\d+)@@\s*<\/p>/g, (whole, i) => {
    const item = items[Number(i)];
    if (!item || !item.display) return whole;
    return renderTex(item.tex, true) || whole;
  });
  return withBlocks.replace(PH_RE, (whole, i) => {
    const item = items[Number(i)];
    if (!item) return whole;
    return renderTex(item.tex, item.display) || whole;
  });
}

/* 裸链接后面跟着中文标点时，GFM 会把标点连同后面的汉字一起吞进链接里
   （`https://a.b，然后` —— 那一串都成了链接文字）。这里在第一个中文标点处剪断，
   把剩下的还给正文；只有「链接文字就是地址本身」的自动链接才动，
   手写的 [文字](地址) 一律不碰。中文**汉字**不剪——维基那种 /wiki/中文 是真的地址。 */
const CJK_PUNCT = '，。、；：？！）》」』”’…·〉《「『【〔（';
const AUTOLINK_RE = /<a href="([^"]+)"([^>]*)>([^<]+)<\/a>/g;

function fixCjkAutolinks(html) {
  return html.replace(AUTOLINK_RE, (whole, href, attrs, text) => {
    let cut = -1;
    for (let i = 0; i < text.length; i++) {
      if (CJK_PUNCT.indexOf(text[i]) > -1) { cut = i; break; }
    }
    if (cut <= 0) return whole;

    let url = text.slice(0, cut);
    let rest = text.slice(cut);
    /* GFM 的规矩：结尾那串 , . ; : ! ? 不算地址的一部分 */
    const trimmed = url.replace(/[.,;:!?]+$/, '');
    if (trimmed !== url) { rest = url.slice(trimmed.length) + rest; url = trimmed; }
    if (!url || !rest) return whole;

    /* 文字与地址对得上才是自动链接（手写的链接文字不会以地址开头） */
    let decoded;
    try { decoded = decodeURIComponent(href); } catch { return whole; }
    if (!decoded.startsWith(url)) return whole;

    return `<a href="${encodeURI(url).replace(/"/g, '%22')}"${attrs}>${url}</a>${rest}`;
  });
}

/* 一段 HTML（posts.mjs 里的静态正文、页面上直接改字存下来的正文）过一遍 emoji 与公式。
   这条路上没有 Markdown，所以公式不用先抠出来——反斜杠还在。 */
export function decorateBody(html) {
  return renderMath(decorateEmoji(html));
}

export function renderMath(html) {
  return mapText(html, (text) => {
    if (text.indexOf('$') < 0 && text.indexOf('\\(') < 0 && text.indexOf('\\[') < 0) return text;
    return text.replace(MATH_RE, (whole, d1, d2, i1, i2) => {
      const tex = d1 ?? d2 ?? i1 ?? i2;
      if (!tex || !tex.trim()) return whole;
      return renderTex(tex, d1 !== undefined || d2 !== undefined) || whole;
    });
  });
}

/* 编辑页写的 Markdown 走这条 */
export function renderMarkdown(source) {
  const { text, items } = protectMath(source);
  const html = md.parse(text);
  return restoreMath(fixCjkAutolinks(decorateEmoji(html)), items);
}

/* 这一页要不要顺带带上 KaTeX 的样式表（只有真出现公式的页面才加载） */
export const needsMath = (html) => /class="katex/.test(String(html || ''));

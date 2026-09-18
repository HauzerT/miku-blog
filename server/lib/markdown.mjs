/* ==========================================================================
   server/lib/markdown.mjs · 正文管线：Markdown / LaTeX → HTML，顺带公式与 emoji
   ---------------------------------------------------------------------------
   两条正文，一条链：

     Markdown（编辑页写的）  marked（CommonMark + GFM）＋ 混在里面的 LaTeX 文字层
     整篇 LaTeX（贴进来的）  只走 LaTeX 文字层，不经过 marked
     两种里的数学            $…$ / $$…$$ / \(…\) / \[…\] / \begin{equation}… → KaTeX

   每一步，以及为什么是这个次序：

     stashCode       围栏代码、缩进代码、行内代码先摘走 → 占位符
                     （那里的 $ 与 \textbf 是字符，不是语法）
     LaTeX 文字层     server/lib/latex.mjs：章节、列表、图表、脚注、交叉引用、文献，
                     数学通过它喊回来的 math 回调换成占位符
     restoreCode     代码占位符装回去，marked 才好把围栏认成 <pre>
     marked          段落、强调、链接、表格这些 Markdown 结构
     decorateEmoji   `:smile:` → 😄（只在文本节点里，代码块不动）
     restoreMath     占位符换回 KaTeX 排好的 HTML + MathML
     fixCjkAutolinks 裸链接后面跟着中文标点时剪断（老规矩，见下）

   为什么整篇 LaTeX 不走 marked：LaTeX 的 `-`、`#`、`|`、`1.` 开头这些行
   在 Markdown 眼里全是结构，交给 marked 会被拆得面目全非。两边的段落规矩
   本来也一样（空行才分段），所以文字层自己包 <p> 就够了。

   为什么公式在服务端渲染：KaTeX 的 CSS 与字体是本地文件，渲染出来的 HTML 直接进
   页面，不闪一下、也不需要浏览器跑 JS——静态托管、file:// 打开都一样是排好版的。
   浏览器那侧因此一个数学脚本都不用加。

   正文是**站长自己写的**（编辑页的 Markdown、posts.mjs 里的 HTML），
   所以 HTML 原样放行、公式原样编译，不做转义或白名单——那属于「页面上直接改字」
   那条路（那里有 sanitizeHtml）。
   ========================================================================== */

import { Marked } from '../../assets/vendor/marked/marked.esm.js';
import katex from '../../assets/vendor/katex/katex.mjs';
import { mapText } from './htmltext.mjs';
import { decorateEmoji } from './emoji.mjs';
import {
  renderLatexBody,
  looksLikeLatexDocument,
  unwrapLatexFence,
  rewriteOptionalArgMacros,
  LATEX_MATH_MACROS,
} from './latex.mjs';

/* breaks: true —— **单个换行就是换行**（软换行落成 <br>）。
   这一条是照着编辑页的用法定的：正文框里敲一下回车，右栏预览就该跟着断行。
   折成空格的话（CommonMark 的软换行在 HTML 里就是一个空格），预览里两行会挤在
   同一行上，写下的和看到的对不上——「所见即所得」就断在这儿了。
   空一行仍然是新段落；CommonMark 那两种硬换行（行尾两个空格、行尾反斜杠）照旧认。
   代码块、缩进代码与表格里的换行是结构，不受这一条影响。 */
const md = new Marked({ gfm: true, breaks: true });

/* 数学的四种写法（这条正则只给「页面上直接改字」那条 HTML 用；
   Markdown / LaTeX 那条由 latex.mjs 的扫描器负责，两边是同一条规矩）。
   $$…$$ 与 \[…\] 是独立成行的公式，$…$ 与 \(…\) 在行内。
   行内那种不跨行、也不吃空内容，**而且美元号内侧不留空格才算公式**——
   这一条是 pandoc 与 KaTeX 自己那个 auto-render 的通行规矩，为的是让
   「花了 $5 到 $10」这种句子留在正文里：那两个 $ 里侧都挨着空格，
   所以不是公式；`$a+b$` 这种里侧紧挨内容的才算。
   （写 $ x $ 这种两边留空的，按这条规矩也是正文——想要公式就别留那个空格。） */
const MATH_RE = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$(?!\s)([^$\n]*?[^\s$])\$/g;

/* marked 会把文本里的 < > 转成 &lt; &gt;，公式里得还原回字符，KaTeX 才认得 */
const ENTITIES = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
const decodeForTex = (s) => s.replace(/&(?:lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m]);

/* 编号公式：KaTeX 的 \tag 认「紧贴在环境收尾之前」这个位置 */
function injectTag(tex, tag) {
  const tail = /\\end\s*\{[a-zA-Z*]+\}\s*$/.exec(tex);
  if (tail) return `${tex.slice(0, tail.index)}\\tag{${tag}}${tex.slice(tail.index)}`;
  return `${tex}\\tag{${tag}}`;
}

function renderTex(tex, display, opts = {}) {
  let source = rewriteOptionalArgMacros(decodeForTex(String(tex == null ? '' : tex).trim()));
  if (!source) return null;
  if (display && opts.tag) source = injectTag(source, opts.tag);
  try {
    return katex.renderToString(source, {
      displayMode: Boolean(display),
      throwOnError: false,     /* 写坏了就红字标出来，别把整篇正文吃掉 */
      strict: false,
      trust: false,
      macros: opts.macros || {},
    });
  } catch (err) {
    return null;
  }
}

/* ---------------------------------------------------------------- 代码暂存
   代码块与行内代码整块摘走，换成不带 Markdown 元字符的占位符；
   LaTeX 文字层过完、marked 之前再原样放回来。 */
const STASH_RE = /\u0000K(\d+)\u0000/g;

function stashCode(source) {
  const stash = [];
  const keep = (chunk) => { stash.push(chunk); return `\u0000K${stash.length - 1}\u0000`; };
  const text = String(source == null ? '' : source)
    .replace(/^```[^\n]*\n[\s\S]*?^```[^\n]*$/gm, keep)   /* 围栏代码块（含语言那行） */
    .replace(/^(?: {4,}|\t)[^\n]*$/gm, keep)              /* 缩进代码块 */
    .replace(/`[^`\n]*`/g, keep);                         /* 行内代码 */
  return { text, stash };
}

const restoreCode = (html, stash) => (stash.length ? html.replace(STASH_RE, (m, i) => stash[Number(i)]) : html);

/* ---------------------------------------------------------------- 数学占位符 */

function addMath(items) {
  return (tex, info = {}) => {
    items.push({
      tex: String(tex),
      display: Boolean(info.display),
      tag: info.number ? String(info.number) : '',
    });
    return `@@CV01MATH${items.length - 1}@@`;
  };
}

const PH_RE = /@@CV01MATH(\d+)@@/g;

function restoreMath(html, items, macros) {
  if (!items.length) return html;
  const withBlocks = html.replace(/<p>\s*@@CV01MATH(\d+)@@\s*<\/p>/g, (whole, i) => {
    const item = items[Number(i)];
    if (!item || !item.display) return whole;
    return renderTex(item.tex, true, { macros, tag: item.tag }) || whole;
  });
  return withBlocks.replace(PH_RE, (whole, i) => {
    const item = items[Number(i)];
    if (!item) return whole;
    return renderTex(item.tex, item.display, { macros, tag: item.tag }) || whole;
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
   这条路上没有 Markdown，所以公式不用先抠出来——反斜杠还在。
   那条路存下来的正文是 HTML（结构早散了），所以只认数学，不认整篇 LaTeX 文档。 */
export function decorateBody(html) {
  return renderMath(decorateEmoji(html));
}

export function renderMath(html, macros) {
  const table = macros || { ...LATEX_MATH_MACROS };
  return mapText(html, (text) => {
    if (text.indexOf('$') < 0 && text.indexOf('\\(') < 0 && text.indexOf('\\[') < 0) return text;
    return text.replace(MATH_RE, (whole, d1, d2, i1, i2) => {
      const tex = d1 ?? d2 ?? i1 ?? i2;
      if (!tex || !tex.trim()) return whole;
      return renderTex(tex, d1 !== undefined || d2 !== undefined, { macros: table }) || whole;
    });
  });
}

/* 整篇 LaTeX：```latex 包起来的，或者写了 \documentclass / \begin{document} 的 */
function renderLatexDocument(source) {
  const items = [];
  const ltx = renderLatexBody(source, { mode: 'document', math: addMath(items) });
  const macros = { ...LATEX_MATH_MACROS, ...ltx.macros };
  return fixCjkAutolinks(restoreMath(decorateEmoji(ltx.html), items, macros));
}

/* 编辑页写的 Markdown（可能混着 LaTeX）与整篇贴进来的 LaTeX 都走这条 */
export function renderMarkdown(source) {
  const src = String(source == null ? '' : source).replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '');

  const fenced = unwrapLatexFence(src);
  if (fenced != null) return renderLatexDocument(fenced);

  /* 代码先摘走再判断「是不是整篇 LaTeX」：不然正文里举一段
     ``` 里写着 \begin{document} 的例子，整篇文章都会被当成 .tex */
  const code = stashCode(src);
  if (looksLikeLatexDocument(code.text)) return renderLatexDocument(restoreCode(code.text, code.stash));

  const items = [];
  const ltx = renderLatexBody(code.text, { mode: 'inline', math: addMath(items) });
  const macros = { ...LATEX_MATH_MACROS, ...ltx.macros };
  const html = md.parse(restoreCode(ltx.html, code.stash));
  return restoreMath(fixCjkAutolinks(decorateEmoji(html)), items, macros);
}

/* 这一页要不要顺带带上 KaTeX 的样式表（只有真出现公式的页面才加载） */
export const needsMath = (html) => /class="katex/.test(String(html || ''));

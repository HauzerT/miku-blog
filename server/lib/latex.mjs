/* ==========================================================================
   server/lib/latex.mjs · LaTeX 文字层：一篇 LaTeX（片段或整篇文档）→ HTML
   ---------------------------------------------------------------------------
   这一层补的是「KaTeX 只认数学模式」留下的空档：

     $…$ / $$…$$ / \(…\) / \[…\]      数学，仍归 KaTeX（本文件只发占位符，不排公式）
     \section \textbf \begin{itemize} 文字层的命令、环境、章节、图表、脚注、交叉引用
     \begin{equation} \label \ref     公式编号与引用（号在这里定，公式在 KaTeX 里排）
     \maketitle \tableofcontents      标题块与目录
     \cite \bibitem                   文献表与引用号

   两条入口，共用同一台扫描器：

     mode: 'document'  整篇 .tex（有 \documentclass / \begin{document}，或整段被
                       ```latex 包起来的）——段落由本层自己包 <p>，% 是注释，
                       ~ -- --- 这些按 LaTeX 的规矩来
     mode: 'inline'    Markdown 正文里混排（编辑页默认那种）——段落交给 marked，
                       换行、~、--- 一律不碰，认不出的命令原样留着

   为什么不再写一遍正则：LaTeX 的花括号可以套（\textbf{图 \ref{fig:a} 里}），
   环境可以嵌（figure 里套 tabular），一行正则拆不开。所以这里老老实实写一台
   字符扫描器：读命令、读参数、读环境；块级的东西自己包标签，碰到数学就喊一声
   调用方（math 回调）换成占位符，好让 KaTeX 在管线后面统一排。

   有意留着的边界（不是漏了）：
     · 化学式 \ce{}（mhchem）、TikZ、\input 外部文件、PDF 专有的分页不认；
       \ce 这类没装的宏包只在数学里留红字，文字层照常；
     · 号是「一次扫描」定的：\ref 往前指也能解析，但 \caption 必须写在
       figure/table 里（LaTeX 两遍编译那套玩法不需要）。
   ========================================================================== */

/* ---------------------------------------------------------------- 常量表 */

/* 数学环境：这些 \begin{…} 整块交给 KaTeX。
   MATH_ENV_SUB 是 KaTeX 0.18.7 不认、但有等价写法的几个（实测过）。 */
const MATH_ENVS = new Set([
  'equation', 'equation*', 'align', 'align*', 'alignat', 'alignat*',
  'gather', 'gather*', 'multline', 'multline*', 'flalign', 'flalign*',
  'eqnarray', 'eqnarray*', 'displaymath', 'math', 'split',
  'array', 'matrix', 'pmatrix', 'bmatrix', 'Bmatrix', 'vmatrix', 'Vmatrix',
  'smallmatrix', 'subarray', 'cases', 'dcases', 'dcases*', 'rcases', 'drcases',
  'gathered', 'aligned', 'alignedat', 'dmath', 'dmath*', 'CD',
]);

const MATH_ENV_SUB = {
  multline: 'gathered',
  'multline*': 'gathered',
  flalign: 'align',
  'flalign*': 'align*',
  eqnarray: 'align',
  'eqnarray*': 'align*',
  dmath: 'gathered',
  'dmath*': 'gathered',
};

/* 会自动编号的数学环境（带星号的不编号） */
const NUMBERED_MATH_ENVS = new Set([
  'equation', 'align', 'alignat', 'gather', 'multline', 'flalign', 'eqnarray', 'dmath',
]);

/* 透明环境：壳子留着，内文继续走正常流程 */
const PASSTHROUGH_ENVS = new Set(['document', 'subequations', 'titlepage', 'sloppypar']);

/* 文本格式命令 → 包一层标签。值 = [标签, class] */
const FORMAT_CMDS = {
  textbf: ['strong'], bf: ['strong'],
  textit: ['em'], it: ['em'], emph: ['em'], em: ['em'],
  textsl: ['span', 'ltx-sl'], sl: ['span', 'ltx-sl'],
  textsc: ['span', 'ltx-sc'], sc: ['span', 'ltx-sc'],
  texttt: ['code', 'ltx-tt'], tt: ['code', 'ltx-tt'],
  textrm: ['span', 'ltx-rm'], rm: ['span', 'ltx-rm'],
  textsf: ['span', 'ltx-sf'], sf: ['span', 'ltx-sf'],
  textmd: ['span', 'ltx-md'], textup: ['span', 'ltx-up'], textnormal: ['span', 'ltx-normal'],
  underline: ['span', 'ltx-underline'], uline: ['span', 'ltx-underline'], uuline: ['span', 'ltx-underline'],
  sout: ['del'], st: ['del'], xout: ['del', 'ltx-xout'],
  textsuperscript: ['sup'], textsubscript: ['sub'],
  text: ['span'], mbox: ['span', 'ltx-nobreak'], hbox: ['span', 'ltx-nobreak'],
  fbox: ['span', 'ltx-fbox'], framebox: ['span', 'ltx-fbox'],
};

/* 声明式命令（{\small …}、{\bfseries …} 这种作用到「本组剩下的东西」上） */
const DECLS = {
  bfseries: { tag: 'strong' }, bf: { tag: 'strong' },
  itshape: { tag: 'em' }, it: { tag: 'em' }, em: { tag: 'em' },
  slshape: { tag: 'span', cls: 'ltx-sl' }, sl: { tag: 'span', cls: 'ltx-sl' },
  scshape: { tag: 'span', cls: 'ltx-sc' }, sc: { tag: 'span', cls: 'ltx-sc' },
  ttfamily: { tag: 'code', cls: 'ltx-tt' }, tt: { tag: 'code', cls: 'ltx-tt' },
  rmfamily: { tag: 'span', cls: 'ltx-rm' }, sffamily: { tag: 'span', cls: 'ltx-sf' },
  upshape: { tag: 'span', cls: 'ltx-up' }, mdseries: { tag: 'span', cls: 'ltx-md' },
  normalfont: { tag: 'span', cls: 'ltx-normal' },
  /* 字号：LaTeX 那十档，用 em 缩放表示 */
  tiny: { tag: 'span', cls: 'ltx-sz ltx-sz--tiny' },
  scriptsize: { tag: 'span', cls: 'ltx-sz ltx-sz--scriptsize' },
  footnotesize: { tag: 'span', cls: 'ltx-sz ltx-sz--footnotesize' },
  small: { tag: 'span', cls: 'ltx-sz ltx-sz--small' },
  normalsize: { tag: 'span', cls: 'ltx-sz ltx-sz--normal' },
  large: { tag: 'span', cls: 'ltx-sz ltx-sz--large' },
  Large: { tag: 'span', cls: 'ltx-sz ltx-sz--Large' },
  LARGE: { tag: 'span', cls: 'ltx-sz ltx-sz--LARGE' },
  huge: { tag: 'span', cls: 'ltx-sz ltx-sz--huge' },
  Huge: { tag: 'span', cls: 'ltx-sz ltx-sz--Huge' },
};

/* 一个字符的转义与空白命令 */
const SYMBOLS = {
  '%': '%', '$': '$', '&': '&amp;', '#': '#', '_': '_', '{': '{', '}': '}',
  ' ': ' ', ',': '\u2009', ';': '\u2005', ':': '\u2005', '!': '', '-': '\u00ad', '/': '\u200b',
};

/* 拼写出来的符号命令 */
const SYMBOL_CMDS = {
  textbackslash: '\\', textasciitilde: '~', textasciicircum: '^', textbar: '|',
  textless: '&lt;', textgreater: '&gt;', textquotesingle: "'", textquotedbl: '"',
  textemdash: '—', textendash: '–', textellipsis: '…', textperiodcentered: '·',
  ldots: '…', dots: '…', textbullet: '•', textdagger: '†', textdaggerdbl: '‡',
  S: '§', P: '¶', dag: '†', ddag: '‡', copyright: '©', pounds: '£', euro: '€',
  yen: '¥', cent: '¢', registered: '®', trademark: '™', degree: '°',
  qed: '∎', qedsymbol: '∎', square: '□', checkmark: '✓',
  LaTeX: 'LaTeX', LaTeXe: 'LaTeX2e', TeX: 'TeX', BibTeX: 'BibTeX',
  quad: '\u2003', qquad: '\u2003\u2003', enspace: '\u2002', thinspace: '\u2009',
  negthinspace: '', nbsp: '\u00a0', space: ' ', textvisiblespace: '␣',
  textregistered: '®', texttrademark: '™', slash: '/', textnumero: '№',
};

/* 重音：\'e 这种（组合字符直接叠在前一个字母上） */
const ACCENTS = {
  "'": '\u0301', '`': '\u0300', '^': '\u0302', '"': '\u0308', '~': '\u0303',
  '=': '\u0304', '.': '\u0307', u: '\u0306', v: '\u030c', H: '\u030b',
  c: '\u0327', k: '\u0328', r: '\u030a', b: '\u0331', d: '\u0323',
};

/* 定理类环境。\newtheorem 可以加新的、也可以覆盖 */
const DEFAULT_THEOREMS = {
  theorem: { title: '定理', numbered: true },
  lemma: { title: '引理', numbered: true },
  corollary: { title: '推论', numbered: true },
  proposition: { title: '命题', numbered: true },
  definition: { title: '定义', numbered: true },
  axiom: { title: '公理', numbered: true },
  claim: { title: '断言', numbered: true },
  conjecture: { title: '猜想', numbered: true },
  observation: { title: '观察', numbered: true },
  assumption: { title: '假设', numbered: true },
  property: { title: '性质', numbered: true },
  example: { title: '例', numbered: true },
  exercise: { title: '练习', numbered: true },
  problem: { title: '问题', numbered: true },
  algorithm: { title: '算法', numbered: true },
  remark: { title: '注', numbered: true },
  note: { title: '备注', numbered: true },
  solution: { title: '解答', numbered: false },
  proof: { title: '证明', numbered: false, qed: true },
};

/* 章节：层级号 + 标题标签 */
const SECTION_CMDS = {
  part: { level: 0, tag: 'h2', cls: 'ltx-part' },
  chapter: { level: 1, tag: 'h2', cls: 'ltx-chapter' },
  section: { level: 2, tag: 'h2', cls: 'ltx-section' },
  subsection: { level: 3, tag: 'h3', cls: 'ltx-subsection' },
  subsubsection: { level: 4, tag: 'h4', cls: 'ltx-subsubsection' },
  paragraph: { level: 5, tag: 'h5', cls: 'ltx-paragraph' },
  subparagraph: { level: 6, tag: 'h6', cls: 'ltx-subparagraph' },
};

const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII',
  'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'];

/* \autoref / \cref 的类型名：站点是中文的，就用中文 */
const REF_KINDS = {
  part: '部分', chapter: '章', section: '小节', subsection: '小节', subsubsection: '小节',
  figure: '图', table: '表', equation: '式', theorem: '定理',
};

/* 代码类环境 */
const CODE_ENVS = new Set(['verbatim', 'Verbatim', 'lstlisting', 'minted', 'alltt', 'lstlisting*']);

/* 引言区里「吃掉参数」的命令：没有 \begin{document} 时靠它们找正文起点 */
const PREAMBLE_CMDS = new Set([
  'documentclass', 'usepackage', 'RequirePackage', 'newcommand', 'renewcommand', 'providecommand',
  'def', 'gdef', 'edef', 'xdef', 'let', 'DeclareMathOperator', 'newtheorem',
  'title', 'author', 'date', 'thanks', 'setlength', 'addtolength', 'setcounter', 'addtocounter',
  'numberwithin', 'pagestyle', 'thispagestyle', 'geometry', 'hypersetup', 'graphicspath',
  'bibliographystyle', 'allowdisplaybreaks', 'linespread', 'captionsetup', 'inputenc', 'fontenc',
  'DeclareRobustCommand', 'newcolumntype', 'definecolor', 'crefname', 'Crefname', 'hyphenpenalty',
]);

/* 数学兼容包：KaTeX 没装 siunitx / physics 时，把这些常用宏补上。
   只补 0.18.7 实测不认识的（认识的半个都不覆盖，免得把 \bar 这种重音命令顶掉）。 */
export const LATEX_MATH_MACROS = {
  '\\bm': '\\boldsymbol{#1}',
  '\\mathbbm': '\\mathbb{#1}',
  '\\cancelto': '\\cancel{#2}^{#1}',
  '\\qed': '\\blacksquare', '\\qedsymbol': '\\blacksquare',
  /* siunitx：词头、单位、后面那几件 */
  '\\kilo': '\\mathrm{k}', '\\hecto': '\\mathrm{h}', '\\deca': '\\mathrm{da}',
  '\\deci': '\\mathrm{d}', '\\centi': '\\mathrm{c}', '\\milli': '\\mathrm{m}',
  '\\micro': '\\mathrm{\\mu}', '\\nano': '\\mathrm{n}', '\\pico': '\\mathrm{p}',
  '\\femto': '\\mathrm{f}', '\\atto': '\\mathrm{a}', '\\zepto': '\\mathrm{z}', '\\yocto': '\\mathrm{y}',
  '\\mega': '\\mathrm{M}', '\\giga': '\\mathrm{G}', '\\tera': '\\mathrm{T}', '\\peta': '\\mathrm{P}',
  '\\exa': '\\mathrm{E}', '\\zetta': '\\mathrm{Z}', '\\yotta': '\\mathrm{Y}',
  '\\kibi': '\\mathrm{Ki}', '\\mebi': '\\mathrm{Mi}', '\\gibi': '\\mathrm{Gi}',
  '\\metre': '\\mathrm{m}', '\\meter': '\\mathrm{m}', '\\second': '\\mathrm{s}',
  '\\gram': '\\mathrm{g}', '\\kilogram': '\\mathrm{kg}', '\\tonne': '\\mathrm{t}',
  '\\ampere': '\\mathrm{A}', '\\kelvin': '\\mathrm{K}', '\\mole': '\\mathrm{mol}',
  '\\candela': '\\mathrm{cd}', '\\litre': '\\mathrm{L}', '\\liter': '\\mathrm{L}',
  '\\newton': '\\mathrm{N}', '\\joule': '\\mathrm{J}', '\\watt': '\\mathrm{W}',
  '\\pascal': '\\mathrm{Pa}', '\\hertz': '\\mathrm{Hz}', '\\volt': '\\mathrm{V}',
  '\\ohm': '\\Omega', '\\coulomb': '\\mathrm{C}', '\\farad': '\\mathrm{F}',
  '\\tesla': '\\mathrm{T}', '\\weber': '\\mathrm{Wb}', '\\henry': '\\mathrm{H}',
  '\\lumen': '\\mathrm{lm}', '\\lux': '\\mathrm{lx}', '\\becquerel': '\\mathrm{Bq}',
  '\\sievert': '\\mathrm{Sv}', '\\katal': '\\mathrm{kat}', '\\electronvolt': '\\mathrm{eV}',
  '\\atomicmassunit': '\\mathrm{u}', '\\angstrom': '\\text{Å}',
  '\\astronomicalunit': '\\mathrm{au}', '\\parsec': '\\mathrm{pc}', '\\lightyear': '\\mathrm{ly}',
  '\\minute': '\\mathrm{min}', '\\hour': '\\mathrm{h}', '\\day': '\\mathrm{d}',
  '\\celsius': '{}^\\circ\\mathrm{C}', '\\percent': '\\%',
  '\\per': '/', '\\squared': '^{2}', '\\cubed': '^{3}', '\\tothe': '^{#1}',
  '\\num': '\\mathrm{#1}', '\\si': '\\mathrm{#1}', '\\unit': '\\mathrm{#1}',
  '\\SI': '#1\\,\\mathrm{#2}', '\\ang': '\\mathrm{#1}',
  '\\unitfrac': '\\frac{\\mathrm{#1}}{\\mathrm{#2}}',
  '\\SIlist': '\\mathrm{#1}', '\\SIrange': '#1\\text{–}#3\\,\\mathrm{#2}',
  /* physics：物理里顺手那几件 */
  '\\abs': '\\left|#1\\right|', '\\norm': '\\left\\|#1\\right\\|',
  '\\expval': '\\left\\langle #1\\right\\rangle', '\\ev': '\\left\\langle #1\\right\\rangle',
  '\\ketbra': '\\left|#1\\right\\rangle\\!\\left\\langle #2\\right|',
  '\\mel': '\\left\\langle #1\\right|#2\\left|#3\\right\\rangle',
  '\\ip': '\\left\\langle #1\\middle|#2\\right\\rangle',
  '\\dv': '\\frac{d#1}{d#2}', '\\pdv': '\\frac{\\partial #1}{\\partial #2}',
  '\\derivative': '\\frac{d#1}{d#2}',
  '\\grad': '\\nabla', '\\curl': '\\nabla\\times', '\\divergence': '\\nabla\\cdot',
  '\\laplacian': '\\nabla^{2}', '\\tr': '\\operatorname{tr}', '\\Tr': '\\operatorname{Tr}',
  '\\rank': '\\operatorname{rank}', '\\erf': '\\operatorname{erf}', '\\Res': '\\operatorname{Res}',
  '\\pv': '\\operatorname{p.v.}', '\\order': '\\mathcal{O}\\left(#1\\right)',
  '\\comm': '\\left[#1,#2\\right]', '\\acomm': '\\left\\{#1,#2\\right\\}',
  '\\poissonbracket': '\\left\\{#1,#2\\right\\}',
  '\\eval': '\\left.#1\\right|_{#2}',
  '\\complexity': '\\mathcal{O}\\left(#1\\right)',
};

/* ---------------------------------------------------------------- 小工具 */

const escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const escapeAttr = (s) => escapeHtml(s).replace(/"/g, '&quot;');

const normalizeMacroName = (key) => (key.startsWith('\\') ? key : `\\${key}`);

/* 是不是中日韩文字（含全角标点）：中文之间那个换行不补空格，靠它判断 */
const isCjk = (ch) => /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(ch || '');

const letterOf = (n) => String.fromCharCode(64 + ((n - 1) % 26) + 1);

/* 越过一个平衡的 {…}：返回内文与结束位置；pos 处不是 { 就给 null */
function readBracedAt(text, pos) {
  let i = pos;
  while (i < text.length && /\s/.test(text[i])) i++;
  if (text[i] !== '{') return null;
  const start = i + 1;
  let depth = 1;
  i++;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') { i += 2; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (!depth) return { value: text.slice(start, i), end: i + 1 }; }
    i++;
  }
  return { value: text.slice(start), end: text.length };
}

/* 越过一个 [ … ] */
function readBracketAt(text, pos) {
  let i = pos;
  while (i < text.length && /[ \t]/.test(text[i])) i++;
  if (text[i] !== '[') return null;
  const start = i + 1;
  let depth = 0;
  i++;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') { i += 2; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === ']' && depth <= 0) return { value: text.slice(start, i), end: i + 1 };
    i++;
  }
  return { value: text.slice(start), end: text.length };
}

/* ------------------------------------------------------------ 文档拆分 */

/* 一段 .tex 拆成「\begin{document} 之前 / 之间」 */
export function splitLatexDocument(source) {
  const text = String(source == null ? '' : source).replace(/\r\n?/g, '\n');
  const begin = /\\begin\s*\{\s*document\s*\}/.exec(text);
  if (begin) {
    const endRe = /\\end\s*\{\s*document\s*\}/g;
    endRe.lastIndex = begin.index + begin[0].length;
    const end = endRe.exec(text);
    return {
      preamble: text.slice(0, begin.index),
      body: text.slice(begin.index + begin[0].length, end ? end.index : text.length),
    };
  }
  if (/\\documentclass\b/.test(text)) {
    /* 没写 \begin{document}（很多人贴正文时只留这一段）：
       把开头那串只可能出现在引言里的命令吃掉，剩下的都算正文 */
    const cut = preambleEnd(text);
    return { preamble: text.slice(0, cut), body: text.slice(cut) };
  }
  return { preamble: '', body: text };
}

function preambleEnd(text) {
  let i = 0;
  for (;;) {
    let j = i;
    while (j < text.length && /\s/.test(text[j])) j++;
    if (j >= text.length) return i;
    if (text[j] === '%') { const nl = text.indexOf('\n', j); if (nl < 0) return i; i = nl + 1; continue; }
    if (text[j] !== '\\') return i;
    const m = /^\\([a-zA-Z]+)\*?/.exec(text.slice(j));
    if (!m || !PREAMBLE_CMDS.has(m[1])) return i;
    let k = j + m[0].length;
    for (;;) {
      const br = readBracketAt(text, k) || readBracedAt(text, k);
      if (!br) break;
      k = br.end;
    }
    i = k;
  }
}

/* 整段被 ```latex / ```tex 包起来 → 当整篇文档处理（% 注释、~ 这些才按 LaTeX 算） */
export function unwrapLatexFence(source) {
  const text = String(source == null ? '' : source).trim();
  const m = /^(?:```|~~~)[ \t]*(?:latex|tex|LaTeX|TeX)[ \t]*\n([\s\S]*?)\n?(?:```|~~~)[ \t]*$/.exec(text);
  return m ? m[1] : null;
}

export function looksLikeLatexDocument(source) {
  const text = String(source == null ? '' : source);
  if (unwrapLatexFence(text) != null) return true;
  return /\\begin\s*\{\s*document\s*\}|\\documentclass\b/.test(text);
}

/* ------------------------------------------------------------ 引言区解析 */

function parsePreamble(text) {
  const out = { title: null, author: null, date: null, macros: new Map(), theorems: new Map(), cls: '' };
  const src = String(text || '');
  let i = 0;
  while (i < src.length) {
    const at = src.indexOf('\\', i);
    if (at < 0) break;
    const m = /^\\([a-zA-Z]+)\*?/.exec(src.slice(at));
    if (!m) { i = at + 1; continue; }
    const name = m[1];
    let p = at + m[0].length;

    if (name === 'title' || name === 'author' || name === 'date') {
      const br = readBracedAt(src, p);
      if (br) { out[name] = br.value; p = br.end; }
      i = p;
      continue;
    }
    if (name === 'documentclass') {
      const opt = readBracketAt(src, p);
      if (opt) p = opt.end;
      const br = readBracedAt(src, p);
      if (br) { out.cls = br.value.trim(); p = br.end; }
      i = p;
      continue;
    }
    if (name === 'newcommand' || name === 'renewcommand' || name === 'providecommand') {
      const g = readBracedAt(src, p);
      let key = null;
      if (g) { key = g.value.trim(); p = g.end; }
      else {
        const t = /^\s*(\\)([a-zA-Z]+)/.exec(src.slice(p));
        if (t) { key = `${t[1]}${t[2]}`; p += t[0].length; }
      }
      const argc = readBracketAt(src, p);
      if (argc) p = argc.end;
      const def = readBracketAt(src, p);
      if (def) p = def.end;                 /* 带默认值的可选参数 KaTeX 宏表接不住，跳过 */
      const bd = readBracedAt(src, p);
      if (bd) p = bd.end;
      if (key && bd && !def) out.macros.set(normalizeMacroName(key), bd.value);
      i = p;
      continue;
    }
    if (name === 'def' || name === 'gdef' || name === 'edef' || name === 'xdef') {
      const t = /^\s*(\\)([a-zA-Z]+)/.exec(src.slice(p));
      if (!t) { i = p; continue; }
      const key = `${t[1]}${t[2]}`;
      p += t[0].length;
      const params = /^[^{]*/.exec(src.slice(p))[0];
      p += params.length;
      const bd = readBracedAt(src, p);
      if (bd) { out.macros.set(key, bd.value); p = bd.end; }
      i = p;
      continue;
    }
    if (name === 'DeclareMathOperator') {
      const star = src[at + 1 + name.length] === '*';
      if (star) p += 1;
      const g = readBracedAt(src, p);
      const bd = g ? readBracedAt(src, g.end) : null;
      if (g && bd) {
        out.macros.set(normalizeMacroName(g.value.trim()), `\\operatorname${star ? '*' : ''}{${bd.value}}`);
        p = bd.end;
      }
      i = p;
      continue;
    }
    if (name === 'newtheorem') {
      const star = src[at + 1 + name.length] === '*';
      if (star) p += 1;
      const g = readBracedAt(src, p);
      if (g) {
        let q = g.end;
        const opt = readBracketAt(src, q);
        const shared = opt ? opt.value.trim() : null;
        if (opt) q = opt.end;
        const titleArg = readBracedAt(src, q);
        if (titleArg) {
          q = titleArg.end;
          const w = readBracketAt(src, q);
          if (w) q = w.end;
          out.theorems.set(g.value.trim(), {
            title: titleArg.value.trim(), numbered: !star, shared, within: w ? w.value.trim() : null,
          });
        }
        p = q;
      }
      i = p;
      continue;
    }
    i = at + m[0].length;
  }
  return out;
}

/* 文字层里能就地展开的宏（\R 这种；带参数的按 #1 替换） */
function collectTextMacros(source) {
  const out = new Map();
  const src = String(source || '');
  const re = /\\(?:newcommand|renewcommand|providecommand)\*?\s*/g;
  let m;
  while ((m = re.exec(src))) {
    let p = m.index + m[0].length;
    const g = readBracedAt(src, p);
    if (!g) continue;
    const key = normalizeMacroName(g.value.trim());
    p = g.end;
    const argc = readBracketAt(src, p);
    if (argc) p = argc.end;
    const def = readBracketAt(src, p);
    if (def) continue;
    const bd = readBracedAt(src, p);
    if (bd) out.set(key, { body: bd.value, argc: argc ? parseInt(argc.value, 10) || 0 : 0 });
  }
  return out;
}

/* ------------------------------------------------------------ 章节编号 */

/* counts 是按「层级名」存的（counters.section 这种），这里把层级号翻成名字，
   没出现过的层级不进编号：只有 \section 时就是「1」，有 chapter 才长成「1.2」 */
function sectionNumber(counts, level, appendix) {
  const parts = [];
  for (let l = 1; l <= level; l++) {
    const c = counts[LEVEL_NAMES[l]] || 0;
    if (!parts.length && !c) continue;        /* 前面的层级没用过，不进编号 */
    parts.push(c);
  }
  if (!parts.length) return '';
  if (appendix) parts[0] = letterOf(parts[0]);
  return parts.join('.');
}

const LEVEL_NAMES = ['part', 'chapter', 'section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph'];

/* ------------------------------------------------------------ 表格解析 */

const TEX_UNITS = { pt: 'pt', pc: 'pc', in: 'in', cm: 'cm', mm: 'mm', em: 'em', ex: 'em', bp: 'pt', dd: 'pt', cc: 'pc' };

function texLengthToCss(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  if (/^\\(?:textwidth|linewidth|columnwidth|hsize)$/.test(s)) return '100%';
  const frac = /^([\d.]+)\s*\\(?:textwidth|linewidth|columnwidth)$/.exec(s);
  if (frac) return `${(Number(frac[1]) * 100).toFixed(2).replace(/\.?0+$/, '')}%`;
  const unit = /^([\d.]+)\s*([a-zA-Z]+)$/.exec(s);
  if (unit && TEX_UNITS[unit[2]]) return `${unit[1]}${TEX_UNITS[unit[2]]}`;
  return '';
}

function parseColspec(spec) {
  const cols = [];
  let vlines = false;
  const text = String(spec || '').replace(/\s+/g, '');
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '|') { vlines = true; i++; continue; }
    if (ch === '@' || ch === '!' || ch === '>' || ch === '<') {
      const b = readBracedAt(text, i + 1);
      i = b ? b.end : i + 1;
      continue;
    }
    if (ch === '*') {
      const n = readBracedAt(text, i + 1);
      const sub = n ? readBracedAt(text, n.end) : null;
      if (n && sub) {
        const inner = parseColspec(sub.value);
        const times = Math.min(24, Math.max(1, parseInt(n.value, 10) || 1));
        for (let k = 0; k < times; k++) cols.push(...inner.cols);
        vlines = vlines || inner.vlines;
        i = sub.end;
        continue;
      }
      i++;
      continue;
    }
    if (/^[lcrXJLR]$/.test(ch)) {
      const align = /^[cC]$/.test(ch) ? 'center' : /^[rR]$/.test(ch) ? 'right' : 'left';
      cols.push({ align, width: '' });
      i++;
      continue;
    }
    if (/^[pmb]$/.test(ch)) {
      const b = readBracedAt(text, i + 1);
      cols.push({ align: 'left', width: b ? texLengthToCss(b.value) : '' });
      i = b ? b.end : i + 1;
      continue;
    }
    i++;
  }
  return { cols, vlines };
}

/* tabular 的内文 → 行与格子（只有顶层的 \\ & \hline 才算） */
function splitTableRows(raw) {
  const rows = [];
  const text = String(raw || '');
  let cells = [''];
  let started = false;
  let pendingTop = false;
  let i = 0;

  const flush = (bottom) => {
    if (!started && !cells.some((c) => c.trim())) return false;
    rows.push({ cells: cells.map((c) => c.trim()), top: pendingTop, bottom: Boolean(bottom) });
    pendingTop = false;
    cells = [''];
    started = false;
    return true;
  };

  while (i < text.length) {
    const ch = text[i];
    if (ch === '%') { const nl = text.indexOf('\n', i); i = nl < 0 ? text.length : nl + 1; continue; }
    if (ch === '\\') {
      const env = /^\\(begin|end)\s*\{\s*[a-zA-Z*]+\s*\}/.exec(text.slice(i));
      if (env) { cells[cells.length - 1] += env[0]; started = true; i += env[0].length; continue; }
      const rule = /^\\(?:hline|toprule|midrule|bottomrule|hdashline|cline|cmidrule)\b/.exec(text.slice(i));
      if (rule) {
        let p = i + rule[0].length;
        for (;;) { const b = readBracedAt(text, p) || readBracketAt(text, p); if (!b) break; p = b.end; }
        if (started) { flush(true); pendingTop = true; } else pendingTop = true;
        i = p;
        continue;
      }
      const brk = /^\\\\(\s*\[[^\]]*\])?/.exec(text.slice(i)) || /^\\(?:tabularnewline|cr)\b/.exec(text.slice(i));
      if (brk) { i += brk[0].length; flush(false); continue; }
      cells[cells.length - 1] += text.slice(i, i + 2);
      started = true;
      i += 2;
      continue;
    }
    if (ch === '&') { cells.push(''); started = true; i++; continue; }
    if (!/\s/.test(ch)) started = true;
    cells[cells.length - 1] += ch;
    i++;
  }
  flush(false);
  if (pendingTop && rows.length) rows[rows.length - 1].bottom = true;
  return rows;
}

/* 列表环境的内文 → \item 列表 */
function splitItems(raw) {
  const items = [];
  const text = String(raw || '');
  let i = 0;
  let depth = 0;
  let envDepth = 0;
  let cur = null;
  let lead = '';

  const append = (s) => { if (cur) cur.body += s; else lead += s; };

  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') {
      const env = /^\\(begin|end)\s*\{\s*[a-zA-Z*]+\s*\}/.exec(text.slice(i));
      if (env) {
        envDepth += env[1] === 'begin' ? 1 : -1;
        append(text.slice(i, i + env[0].length));
        i += env[0].length;
        continue;
      }
      const item = /^\\item\b/.exec(text.slice(i));
      if (item && !depth && !envDepth) {
        let p = i + item[0].length;
        const lab = readBracketAt(text, p);
        if (lab) p = lab.end;
        items.push({ label: lab ? lab.value : null, body: '' });
        cur = items[items.length - 1];
        i = p;
        continue;
      }
      append(text.slice(i, i + 2));
      i += 2;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') depth = Math.max(0, depth - 1);
    append(ch);
    i++;
  }
  if (!items.length && lead.trim()) items.push({ label: null, body: lead });
  else if (items.length && lead.trim()) items[0].body = lead + items[0].body;
  return items;
}

/* 从环境内文里摘掉一个顶层命令（\caption / \label 用） */
function takeTopCommand(raw, name) {
  const text = String(raw || '');
  let i = 0;
  let depth = 0;
  let envDepth = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') {
      const env = /^\\(begin|end)\s*\{\s*[a-zA-Z*]+\s*\}/.exec(text.slice(i));
      if (env) { envDepth += env[1] === 'begin' ? 1 : -1; i += env[0].length; continue; }
      const m = new RegExp(`^\\\\${name}\\*?`).exec(text.slice(i));
      if (m && !depth && !envDepth) {
        let p = i + m[0].length;
        const opt = readBracketAt(text, p);
        if (opt) p = opt.end;
        const br = readBracedAt(text, p);
        const value = br ? br.value : (opt ? opt.value : null);
        const end = br ? br.end : p;
        return { value, rest: text.slice(0, i) + text.slice(end) };
      }
      i += 2;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') depth = Math.max(0, depth - 1);
    i++;
  }
  return { value: null, rest: text };
}

/* ------------------------------------------------------------ 主入口 */

/* 一次渲染里最多做多少步子渲染：正常的一篇（哪怕 200KB、两千个 \section）
   离这个数还远；写坏的自指宏会在到顶时停手，而不是把 CPU 占住 */
const STEP_BUDGET = 120000;

/* 宏展开最深几层：\x → \x\x 这种到第 8 层就停 */
const MACRO_DEPTH = 8;

export function renderLatexBody(source, options = {}) {
  const cfg = {
    blocks: options.mode === 'document',
    stripComments: options.mode === 'document',
    latexChars: options.mode === 'document',
    math: typeof options.math === 'function' ? options.math : null,
  };

  const state = {
    /* 输出是一叠缓冲：子渲染（环境内文、命令参数、图表题注）各占一层，
       段落状态跟缓冲一起进出，父层那个 <p> 不会被别人的 </p> 收掉 */
    frames: [{ buf: [], pOpen: false }],
    depth: 0,
    pDisabled: 0,
    nest: 0,
    /* 两道闸，防的是写坏（或者存心写坏）的正文把 CPU 占住：
       \newcommand{\x}{\x\x} 这种自指宏一层套一层是 2^n 的，只靠 depth 拦不住 */
    steps: 0,
    macroDepth: 0,
    truncated: false,
    macros: new Map(),
    textMacros: new Map(),
    theorems: new Map(Object.entries(DEFAULT_THEOREMS)),
    theoremCounters: new Map(),
    counters: {
      part: 0, chapter: 0, section: 0, subsection: 0, subsubsection: 0, paragraph: 0, subparagraph: 0,
      figure: 0, table: 0, equation: 0, footnote: 0,
    },
    labels: new Map(),
    refs: [],
    cites: [],
    footnotes: [],
    bibIndex: new Map(),
    headings: [],
    lastAnchor: null,
    appendix: false,
    title: null,
    author: null,
    date: null,
    used: {},
  };

  const frame = () => state.frames[state.frames.length - 1];
  const push = (s) => { if (s) frame().buf.push(s); };
  const openP = () => {
    if (!cfg.blocks || state.pDisabled || frame().pOpen) return;
    frame().buf.push('<p>');
    frame().pOpen = true;
  };
  const closeP = () => {
    const f = frame();
    if (f.pOpen) { f.buf.push('</p>'); f.pOpen = false; }
  };
  const text = (s) => { if (s == null || s === '') return; openP(); push(s); };
  const block = (html) => {
    if (!html) return;
    if (cfg.blocks) { closeP(); push(html); return; }
    if (state.nest > 0) { push(html); return; }
    push(`\n\n${html}\n\n`);
  };
  const mark = (name) => { state.used[name] = true; };

  const rt = {
    cfg,
    state,
    push,
    text,
    block,
    mark,
    openP,
    closeP,
    mathTo(tex, info) {
      const body = String(tex == null ? '' : tex).trim();
      if (!body || !cfg.math) return '';
      mark('math');
      return cfg.math(body, info);
    },
    refToken(kind, key) {
      state.refs.push({ kind, key: String(key || '').trim() });
      return `\u0000R${state.refs.length - 1}\u0000`;
    },
    citeToken(keys) {
      state.cites.push(keys);
      return `\u0000C${state.cites.length - 1}\u0000`;
    },
    anchor(id) {
      if (!id) return '';
      return `<span class="ltx-anchor" id="${escapeAttr(id)}"></span>`;
    },
    registerLabel(key) {
      const clean = String(key || '').trim();
      if (!clean) return '';
      const base = state.lastAnchor || { id: clean, number: '', kind: 'unknown' };
      if (!state.labels.has(clean)) {
        state.labels.set(clean, { id: base.id || clean, number: base.number || '', kind: base.kind || 'unknown' });
      }
      return this.anchor(clean);
    },
    /* 子渲染：新开一台扫描器、换一个缓冲，返回它排出来的 HTML */
    convert(sub, opts = {}) {
      if (state.depth > 32 || state.steps >= STEP_BUDGET) {
        state.truncated = true;
        return '';
      }
      state.steps++;
      state.frames.push({ buf: [], pOpen: false });
      state.depth++;
      if (opts.noP) state.pDisabled++;
      if (opts.nest) state.nest++;
      try {
        new Reader(String(sub == null ? '' : sub), rt).run();
        closeP();
        return frame().buf.join('');
      } finally {
        state.frames.pop();
        state.depth--;
        if (opts.noP) state.pDisabled--;
        if (opts.nest) state.nest--;
      }
    },
  };

  const { preamble, body } = splitLatexDocument(source);
  const pre = parsePreamble(preamble);
  state.title = pre.title;
  state.author = pre.author;
  state.date = pre.date;
  for (const [k, v] of pre.macros) state.macros.set(k, v);
  for (const [k, v] of pre.theorems) state.theorems.set(k, v);
  for (const [k, v] of collectTextMacros(preamble)) state.textMacros.set(k, v);

  let html = rt.convert(body);
  html += footnotesHtml(state, cfg);
  html = resolveTokens(html, state, cfg);
  return { html, macros: Object.fromEntries(state.macros), used: state.used, blocks: cfg.blocks, truncated: state.truncated };
}

/* ------------------------------------------------------------ 收口 */

function footnotesHtml(state, cfg) {
  if (!state.footnotes.length) return '';
  const items = state.footnotes.map((item, idx) => {
    const n = idx + 1;
    return `<li id="fn-${n}">${item || ''}<a class="ltx-fn__back" href="#fnref-${n}" aria-label="回到正文">↩</a></li>`;
  }).join('');
  const html = `<section class="ltx-footnotes"><h2 class="ltx-footnotes__head">脚注</h2><ol class="ltx-footnotes__list">${items}</ol></section>`;
  return cfg.blocks ? html : `\n\n${html}\n\n`;
}

/* \ref / \cite / 目录：一次扫描定不下来（引用可能往前指、文献在后面），这里收口 */
function resolveTokens(html, state, cfg) {
  let out = String(html);
  void cfg;

  out = out.replace(/@@CV01TOC@@/g, () => tocHtml(state));

  out = out.replace(/\u0000R(\d+)\u0000/g, (whole, idx) => {
    const ref = state.refs[Number(idx)];
    if (!ref) return whole;
    const target = state.labels.get(ref.key);
    if (!target) {
      return `<span class="ltx-ref ltx-ref--missing" title="没有这个标签：${escapeAttr(ref.key)}">??</span>`;
    }
    const number = target.number || '';
    const label = ref.kind === 'eqref' ? `(${number})`
      : ref.kind === 'autoref' ? `${REF_KINDS[target.kind] || ''}${number ? ` ${number}` : ''}`.trim()
        : number;
    const href = target.id ? ` href="#${escapeAttr(target.id)}"` : '';
    return `<a class="ltx-ref"${href}>${escapeHtml(label || '??')}</a>`;
  });

  out = out.replace(/\u0000C(\d+)\u0000/g, (whole, idx) => {
    const keys = state.cites[Number(idx)] || [];
    if (!keys.length) return whole;
    const parts = keys.map((key) => {
      const n = state.bibIndex.get(key);
      if (!n) return `<span class="ltx-cite ltx-cite--missing" title="没有这条文献：${escapeAttr(key)}">?</span>`;
      return `<a class="ltx-cite" href="#bib-${escapeAttr(key)}">${n}</a>`;
    });
    return `<span class="ltx-cites">[${parts.join(', ')}]</span>`;
  });

  return out;
}

function tocHtml(state) {
  if (!state.headings.length) return '';
  const items = state.headings.map((h) => {
    const num = h.number ? `<span class="ltx-toc__no">${escapeHtml(h.number)}</span> ` : '';
    return `<li class="ltx-toc__item ltx-toc__item--l${Math.max(1, h.level - 1)}"><a href="#${escapeAttr(h.id)}">${num}${h.text}</a></li>`;
  }).join('');
  return `<nav class="ltx-toc"><h2 class="ltx-toc__head">目录</h2><ol class="ltx-toc__list">${items}</ol></nav>`;
}

/* ==========================================================================
   Reader：一台字符扫描器
   ========================================================================== */

class Reader {
  constructor(source, rt) {
    this.src = String(source == null ? '' : source).replace(/\r\n?/g, '\n');
    this.i = 0;
    this.rt = rt;
    this.lastSpace = true;
  }

  get cfg() { return this.rt.cfg; }
  get state() { return this.rt.state; }

  eof() { return this.i >= this.src.length; }
  at(n = 0) { return this.src[this.i + n] || ''; }
  rest() { return this.src.slice(this.i); }
  take(n) { const s = this.src.slice(this.i, this.i + n); this.i += n; return s; }

  skipSpaces() { while (!this.eof() && /[ \t\n]/.test(this.src[this.i])) this.i++; }

  /* 普通字符：文档模式转义 + 折空白；Markdown 模式一个字符都不动 */
  putChar(ch) {
    const { cfg, rt } = this;
    if (!cfg.blocks) { rt.push(ch); return; }
    if (ch === ' ' || ch === '\t') {
      if (this.lastSpace) return;
      rt.text(' ');
      this.lastSpace = true;
      return;
    }
    rt.text(escapeHtml(ch));
    this.lastSpace = false;
  }

  skipComment() {
    const nl = this.src.indexOf('\n', this.i);
    this.i = nl < 0 ? this.src.length : nl;
  }

  /* 平衡地读一个 {…} */
  readGroupRaw() {
    this.skipSpaces();
    if (this.at() !== '{') return null;
    const start = this.i + 1;
    let depth = 1;
    this.i++;
    while (!this.eof()) {
      const ch = this.src[this.i];
      if (ch === '\\') { this.i += 2; continue; }
      if (ch === '%' && this.cfg.stripComments) { this.skipComment(); continue; }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (!depth) { const value = this.src.slice(start, this.i); this.i++; return value; }
      }
      this.i++;
    }
    return this.src.slice(start);
  }

  /* 命令参数：有 {} 吃 {}，没有就吃一个字符或一个命令 */
  readArgRaw() {
    this.skipSpaces();
    if (this.at() === '{') return this.readGroupRaw();
    if (this.at() === '\\') {
      const m = /^\\([a-zA-Z]+)/.exec(this.rest());
      if (m) { this.i += m[0].length; return m[0]; }
      return this.take(2);
    }
    return this.take(1);
  }

  readBracket() {
    this.skipSpaces();
    if (this.at() !== '[') return null;
    const start = this.i + 1;
    let depth = 0;
    this.i++;
    while (!this.eof()) {
      const ch = this.src[this.i];
      if (ch === '\\') { this.i += 2; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (ch === ']' && depth <= 0) { const value = this.src.slice(start, this.i); this.i++; return value; }
      this.i++;
    }
    return this.src.slice(start);
  }

  /* \begin{name} 的内文（同名环境可嵌套） */
  readEnvRaw(name) {
    const start = this.i;
    let depth = 1;
    while (!this.eof()) {
      const ch = this.src[this.i];
      if (ch === '\\') {
        const m = /^\\(begin|end)\s*\{\s*([a-zA-Z*]+)\s*\}/.exec(this.rest());
        if (m) {
          if (m[2] === name) {
            if (m[1] === 'begin') depth++;
            else {
              depth--;
              if (!depth) {
                const value = this.src.slice(start, this.i);
                this.i += m[0].length;
                return value;
              }
            }
          }
          this.i += m[0].length;
          continue;
        }
        this.i += 2;
        continue;
      }
      if (ch === '%' && this.cfg.stripComments) { this.skipComment(); continue; }
      this.i++;
    }
    return this.src.slice(start);
  }

  /* 代码环境的内文：% 与反斜杠都是普通字符 */
  readEnvRawVerbatim(name) {
    const start = this.i;
    const re = new RegExp(`\\\\end\\s*\\{\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\}`, 'g');
    re.lastIndex = this.i;
    const m = re.exec(this.src);
    if (!m) { const value = this.src.slice(start); this.i = this.src.length; return value; }
    const value = this.src.slice(start, m.index);
    this.i = m.index + m[0].length;
    return value;
  }

  /* ---------------------------------------------------------- 主循环 */

  run() { this.parse(); }

  parse() {
    while (!this.eof()) {
      const ch = this.src[this.i];
      if (ch === '\\') { this.command(); continue; }
      if (ch === '{') { this.braceGroup(); continue; }
      if (ch === '}') { if (!this.cfg.blocks) this.rt.push('}'); this.i++; continue; }
      if (ch === '$') { if (this.dollarMath()) continue; }
      if (ch === '%' && this.cfg.stripComments) { this.skipComment(); continue; }
      if (ch === '\n') { this.newline(); continue; }
      if (this.cfg.latexChars) {
        if (ch === '`' || ch === '~') { if (this.fence()) continue; }
        if (ch === '~') { this.rt.text('\u00a0'); this.i++; this.lastSpace = false; continue; }
        if (ch === '`') { if (this.quotes()) continue; }
        if (ch === '-' && this.dashes()) continue;
        if (ch === ' ' || ch === '\t') { this.i++; this.putChar(' '); continue; }
      }
      this.putChar(ch);
      this.i++;
    }
  }

  newline() {
    if (!this.cfg.blocks) { this.rt.push('\n'); this.i++; this.lastSpace = true; return; }
    /* 文档模式：单个换行 = 一个空格，空行 = 换段（LaTeX 的老规矩） */
    let j = this.i + 1;
    while (j < this.src.length && /[ \t]/.test(this.src[j])) j++;
    if (this.src[j] === '\n' || j >= this.src.length) {
      while (j < this.src.length && /\s/.test(this.src[j])) j++;
      this.i = j;
      this.rt.closeP();
      this.lastSpace = true;
      return;
    }
    /* 中文之间那个换行不留空格：LaTeX 里靠 xeCJK 干这件事，
       不补这一手，「中文换行\n中文」会排出一个多余的空隙 */
    const before = this.src[this.i - 1] || '';
    const after = this.src[j] || '';
    this.i = j;
    if (isCjk(before) && isCjk(after)) return;
    this.putChar(' ');
  }

  /* ```lang … ``` / ~~~ … ~~~：LaTeX 文档里也能放一块代码 */
  fence() {
    const m = /^(`{3,}|~{3,})[ \t]*([^\n`]*)\n([\s\S]*?)(?:\n\1[ \t]*(?=\n|$)|$)/.exec(this.rest());
    if (!m) return false;
    const lang = m[2].trim();
    const code = m[3].replace(/\n$/, '');
    this.i += m[0].length;
    const cls = lang ? ` class="language-${escapeAttr(lang.toLowerCase())}"` : '';
    this.rt.block(`<pre class="ltx-pre"><code${cls}>${escapeHtml(code)}</code></pre>`);
    return true;
  }

  /* ``引号'' 与 `单引号' */
  quotes() {
    if (this.at(1) === '`') {
      const close = this.src.indexOf("''", this.i + 2);
      const alt = this.src.indexOf('``', this.i + 2);
      if (close >= 0 && (alt < 0 || close < alt)) {
        const inner = this.src.slice(this.i + 2, close);
        this.rt.text(`“${this.rt.convert(inner, { noP: true })}”`);
        this.i = close + 2;
        return true;
      }
      return false;
    }
    const close = this.src.indexOf("'", this.i + 1);
    if (close > this.i + 1) {
      const inner = this.src.slice(this.i + 1, close);
      this.rt.text(`‘${this.rt.convert(inner, { noP: true })}’`);
      this.i = close + 1;
      return true;
    }
    return false;
  }

  dashes() {
    if (this.at(1) === '-' && this.at(2) === '-') { this.rt.text('—'); this.i += 3; return true; }
    if (this.at(1) === '-') { this.rt.text('–'); this.i += 2; return true; }
    return false;
  }

  /* ---------------------------------------------------------- 花括号组 */

  braceGroup() {
    /* 组开头是一串声明（{\bfseries …}）→ 整组套一层标签 */
    const decls = [];
    let p = this.i + 1;
    for (;;) {
      let q = p;
      while (q < this.src.length && /\s/.test(this.src[q])) q++;
      const m = /^\\([a-zA-Z]+)/.exec(this.src.slice(q));
      if (!m || !DECLS[m[1]]) break;
      decls.push(DECLS[m[1]]);
      p = q + m[0].length;
    }
    this.i++;                                   /* 吃掉 '{' */
    const innerStart = this.i;
    const inner = decls.length ? this.readRawUntilBrace() : this.readGroupBodyRaw();
    const html = this.rt.convert(inner, { noP: true });
    void innerStart;
    if (decls.length) this.rt.text(wrapDecls(html, decls));
    else if (this.cfg.blocks) this.rt.text(html);        /* 文档模式：光秃秃的 {} 只是分组 */
    else this.rt.push(`{${html}}`);                      /* Markdown 模式：花括号是普通字符 */
  }

  /* 从当前（'{' 之后 / 声明之后）读到匹配的 '}' */
  readRawUntilBrace() {
    const start = this.i;
    let depth = 1;
    while (!this.eof()) {
      const ch = this.src[this.i];
      if (ch === '\\') { this.i += 2; continue; }
      if (ch === '%' && this.cfg.stripComments) { this.skipComment(); continue; }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (!depth) { const value = this.src.slice(start, this.i); this.i++; return value; }
      }
      this.i++;
    }
    return this.src.slice(start);
  }

  /* '{' 已经吃掉：读到匹配的 '}' */
  readGroupBodyRaw() { return this.readRawUntilBrace(); }

  /* ---------------------------------------------------------- 数学 */

  dollarMath() {
    const { rt } = this;
    if (this.at(1) === '$') {
      const end = this.src.indexOf('$$', this.i + 2);
      if (end > 0) {
        const tex = this.src.slice(this.i + 2, end);
        this.i = end + 2;
        if (tex.trim()) {
          const ph = rt.mathTo(tex, { display: true, env: '$$' });
          if (ph) { rt.block(ph); return true; }
        }
        return true;
      }
    }
    /* 行内的 $：与 markdown.mjs 那条 MATH_RE 同一条规矩——不跨行、里侧不留空格
       （「花了 $5 到 $10」这种句子要留在正文里） */
    const line = /^\$(?!\s)([^$\n]*?[^\s$])\$/.exec(this.rest());
    if (line) {
      this.i += line[0].length;
      const ph = rt.mathTo(line[1], { display: false, env: '$' });
      if (ph) { rt.text(ph); return true; }
      rt.text(this.cfg.blocks ? line[0] : line[0].replace(/\$/g, '&#36;'));
      return true;
    }
    return false;
  }

  parenMath(display) {
    const open = display ? '\\[' : '\\(';
    const close = display ? '\\]' : '\\)';
    const start = this.i + open.length;
    const end = this.src.indexOf(close, start);
    if (end < 0) { this.i += open.length; return; }
    const tex = this.src.slice(start, end);
    this.i = end + close.length;
    const ph = this.rt.mathTo(tex, { display, env: open });
    if (!ph) { this.rt.text(`${open}${tex}${close}`); return; }
    if (display) this.rt.block(ph);
    else this.rt.text(ph);
  }

  /* ---------------------------------------------------------- 命令 */

  command() {
    const { rt, cfg } = this;
    const two = this.src.slice(this.i, this.i + 2);

    if (two === '\\(') return this.parenMath(false);
    if (two === '\\[') return this.parenMath(true);

    /* Markdown 模式里，行尾那个反斜杠是 Markdown 的硬换行（CommonMark），
       不能被当成 LaTeX 命令吃掉 */
    if (!cfg.blocks && this.at(1) === '\n') { rt.push('\\'); this.i++; return; }

    if (two === '\\\\') {
      this.i += 2;
      this.readBracket();
      /* 文档模式：\\ 是换行；Markdown 模式：让它退回 CommonMark 的「一个反斜杠」 */
      rt.text(cfg.blocks ? '<br>' : '\\');
      return;
    }
    if (/^\\['`^"~=.]$/.test(two)) return this.accent(two[1]);

    /* 标点类转义：文档模式按 LaTeX（\, 是细空白），Markdown 模式按 CommonMark
       （去掉反斜杠，逗号还是逗号） */
    if (two.length === 2 && /^\\[,;:!\-/ ]$/.test(two)) {
      this.i += 2;
      rt.text(cfg.blocks ? (SYMBOLS[two[1]] || two[1]) : two[1]);
      return;
    }
    if (two.length === 2 && two[1] in SYMBOLS) {
      this.i += 2;
      rt.text(SYMBOLS[two[1]]);
      return;
    }

    const m = /^\\([a-zA-Z]+)/.exec(this.rest());
    if (!m) { this.i += 1; return; }
    const name = m[1];
    const star = this.src[this.i + 1 + name.length] === '*';
    this.i += m[0].length + (star ? 1 : 0);
    this.dispatch(name, star);
  }

  accent(mark) {
    const spec = ACCENTS[mark];
    const arg = this.readArgRaw();
    const base = String(arg == null ? '' : arg).trim();
    if (!spec || !base) return;
    this.rt.text(escapeHtml(base[0]) + spec + escapeHtml(base.slice(1)));
  }

  /* ---------------------------------------------------------- 派发 */

  dispatch(name, star) {
    const { rt } = this;

    if (SECTION_CMDS[name]) return this.section(name, star);

    if (FORMAT_CMDS[name]) {
      const [tag, cls] = FORMAT_CMDS[name];
      const inner = rt.convert(this.readGroupRaw() ?? '', { noP: true });
      rt.text(`<${tag}${cls ? ` class="${cls}"` : ''}>${inner}</${tag}>`);
      return;
    }

    if (SYMBOL_CMDS[name] != null) { rt.text(SYMBOL_CMDS[name]); return; }

    /* 独立的声明命令（\bfseries 单写一个、后面跟一整段）：本层不给它开标签，
       免得标签收不了口；组里那种 {\bfseries …} 由 braceGroup 处理 */
    if (DECLS[name]) return;

    switch (name) {
      /* ---- 文档骨架 ---- */
      case 'documentclass': case 'usepackage': case 'RequirePackage': case 'inputenc': case 'fontenc':
      case 'geometry': case 'hypersetup': case 'graphicspath': case 'pagestyle': case 'thispagestyle':
      case 'bibliographystyle': case 'allowdisplaybreaks': case 'linespread': case 'captionsetup':
      case 'setlength': case 'addtolength': case 'setcounter': case 'addtocounter': case 'numberwithin':
      case 'definecolor': case 'newcolumntype': case 'crefname': case 'Crefname': case 'hyphenpenalty':
        this.skipArgs(3);
        return;
      case 'title': case 'author': case 'date':
        if (this.state[name] == null) this.state[name] = this.readGroupRaw() ?? '';
        return;
      case 'maketitle': return this.maketitle();
      case 'tableofcontents': rt.mark('toc'); rt.block('@@CV01TOC@@'); return;
      case 'appendix':
        this.state.appendix = true;
        for (const key of LEVEL_NAMES) this.state.counters[key] = 0;
        return;
      case 'keywords': case 'keyword': {
        const inner = rt.convert(this.readGroupRaw() ?? '', { noP: true });
        rt.block(`<p class="ltx-keywords"><b>关键词：</b>${inner}</p>`);
        return;
      }
      case 'begin': return this.beginEnv();
      case 'end': this.readGroupRaw(); return;

      /* ---- 定义与宏 ---- */
      case 'newcommand': case 'renewcommand': case 'providecommand': return this.defineMacro();
      case 'def': case 'gdef': case 'edef': case 'xdef': return this.defineDef();
      case 'DeclareMathOperator': return this.defineOperator(star);
      case 'newtheorem': return this.defineTheorem(star);
      case 'let': case 'relax': case 'protect': case 'ignorespaces': case 'unskip': return;

      /* ---- 引用与文献 ---- */
      case 'label': { const key = this.readGroupRaw() ?? ''; rt.text(rt.registerLabel(key)); return; }
      case 'ref': { const key = this.readGroupRaw() ?? ''; rt.text(rt.refToken('ref', key)); return; }
      case 'eqref': { const key = this.readGroupRaw() ?? ''; rt.text(rt.refToken('eqref', key)); return; }
      case 'pageref': case 'autoref': case 'cref': case 'Cref': case 'vref': case 'nameref': {
        const key = this.readGroupRaw() ?? '';
        rt.text(rt.refToken(name === 'pageref' || name === 'nameref' ? 'ref' : 'autoref', key));
        return;
      }
      case 'hyperref': {
        const lab = this.readBracket();
        const inner = rt.convert(this.readGroupRaw() ?? '', { noP: true });
        rt.text(lab ? `<a class="ltx-ref" href="#${escapeAttr(lab)}">${inner}</a>` : inner);
        return;
      }
      case 'cite': case 'citep': case 'citet': case 'citealp': case 'citeauthor': case 'citeyear': {
        this.readBracket();
        this.readBracket();
        const keys = String(this.readGroupRaw() ?? '').split(',').map((s) => s.trim()).filter(Boolean);
        rt.text(rt.citeToken(keys));
        return;
      }
      case 'nocite': this.readGroupRaw(); return;

      /* ---- 链接与图片 ---- */
      case 'href': {
        const url = String(this.readGroupRaw() ?? '').trim();
        const label = rt.convert(this.readArgRaw() ?? '', { noP: true });
        rt.text(`<a href="${escapeAttr(url)}" rel="noopener">${label || escapeHtml(url)}</a>`);
        return;
      }
      case 'url': case 'nolinkurl': {
        const url = String(this.readArgRaw() ?? '').trim();
        if (name === 'nolinkurl') { rt.text(`<code class="ltx-tt">${escapeHtml(url)}</code>`); return; }
        rt.text(`<a href="${escapeAttr(url)}" rel="noopener">${escapeHtml(url)}</a>`);
        return;
      }
      case 'includegraphics': return this.includegraphics();

      /* ---- 脚注与边注 ---- */
      case 'footnote': return this.footnote();
      case 'footnotemark': return this.footnotemark();
      case 'footnotetext': return this.footnotetext();
      case 'thanks': case 'marginpar': case 'todo': {
        const inner = rt.convert(this.readGroupRaw() ?? '', { noP: true });
        rt.text(`<span class="ltx-note">${inner}</span>`);
        return;
      }

      /* ---- 颜色与盒子 ---- */
      case 'textcolor': {
        const color = String(this.readGroupRaw() ?? '').trim();
        const inner = rt.convert(this.readGroupRaw() ?? '', { noP: true });
        rt.text(`<span style="color:${cssColor(color)}">${inner}</span>`);
        return;
      }
      case 'colorbox': {
        const color = String(this.readGroupRaw() ?? '').trim();
        const inner = rt.convert(this.readGroupRaw() ?? '', { noP: true });
        rt.text(`<span class="ltx-colorbox" style="background:${cssColor(color)}">${inner}</span>`);
        return;
      }
      case 'fcolorbox': {
        this.readGroupRaw();
        const color = String(this.readGroupRaw() ?? '').trim();
        const inner = rt.convert(this.readGroupRaw() ?? '', { noP: true });
        rt.text(`<span class="ltx-fbox" style="border-color:${cssColor(color)}">${inner}</span>`);
        return;
      }
      case 'parbox': {
        const width = texLengthToCss(this.readBracket() || this.readArgRaw());
        const inner = rt.convert(this.readGroupRaw() ?? '', {});
        rt.block(`<div class="ltx-parbox"${width ? ` style="width:${width}"` : ''}>${inner}</div>`);
        return;
      }
      case 'raisebox': {
        this.readGroupRaw();
        const inner = rt.convert(this.readGroupRaw() ?? '', { noP: true });
        rt.text(`<span class="ltx-raise">${inner}</span>`);
        return;
      }

      /* ---- 代码 ---- */
      case 'verb': case 'lstinline': case 'mintinline': return this.verbLike();

      /* ---- 段落与空白 ---- */
      case 'par': rt.closeP(); return;
      case 'newpage': case 'clearpage': case 'cleardoublepage':
        this.readBracket();
        rt.block('<hr class="ltx-pagebreak">');
        return;
      case 'newline': case 'linebreak': case 'pagebreak': case 'goodbreak': case 'nopagebreak':
        this.readBracket();
        rt.text('<br>');
        return;
      case 'bigskip': case 'medskip': case 'smallskip':
        rt.block(`<div class="ltx-skip ltx-skip--${name.replace('skip', '')}"></div>`);
        return;
      case 'vspace': {
        const h = texLengthToCss(this.readArgRaw());
        if (h) rt.block(`<div class="ltx-vspace" style="height:${h}"></div>`);
        return;
      }
      case 'hspace': {
        const h = texLengthToCss(this.readArgRaw());
        if (h) rt.text(`<span class="ltx-hspace" style="width:${h}"></span>`);
        return;
      }
      case 'rule': {
        this.readBracket();
        const w = texLengthToCss(this.readArgRaw());
        const h = texLengthToCss(this.readArgRaw());
        rt.text(`<span class="ltx-rule" style="width:${w || '1em'};height:${h || '0.4pt'}"></span>`);
        return;
      }
      case 'noindent': case 'indent': case 'centering': case 'raggedright': case 'raggedleft':
      case 'hfill': case 'vfill': case 'hfil': case 'hss': case 'sloppy': case 'fussy': case 'hrule':
      case 'hline': case 'toprule': case 'midrule': case 'bottomrule': case 'addlinespace':
      case 'itemsep': case 'parskip': case 'parindent': case 'baselineskip': case 'columnsep':
      case 'smallskipamount': case 'medskipamount': case 'bigskipamount':
        /* 这些本身就不吃参数。**不能顺手 skipArgs**——会把后面那个命令当成参数吞掉
           （\centering 后面紧跟 \includegraphics 是很常见的写法） */
        return;
      case 'cline': case 'cmidrule':
        this.readArgRaw();
        return;

      /* ---- 外部文件与图 ---- */
      case 'input': case 'include': case 'subfile': case 'import': {
        const file = String(this.readGroupRaw() ?? '').trim();
        rt.mark('unsupported');
        rt.text(`<span class="ltx-unsupported" title="渲染器不读外部文件">[未包含：${escapeHtml(file)}]</span>`);
        return;
      }
      case 'today': rt.text(new Date().toISOString().slice(0, 10)); return;
      case 'and': rt.text(' · '); return;

      /* ---- 杂项 ---- */
      case 'item': this.readBracket(); return;                 /* 列表外的 \item：丢掉 */
      case 'caption': {
        this.readBracket();
        const inner = rt.convert(this.readGroupRaw() ?? '', { noP: true });
        rt.block(`<p class="ltx-caption">${inner}</p>`);
        return;
      }
      case 'index': case 'glossary': case 'printindex': case 'makeindex': case 'bibliography':
        this.readGroupRaw();
        return;
      case 'phantom': case 'hphantom': case 'vphantom': this.readGroupRaw(); return;
      case 'smash': rt.text(rt.convert(this.readGroupRaw() ?? '', { noP: true })); return;
      case 'texorpdfstring': {
        const first = this.readGroupRaw() ?? '';
        this.readGroupRaw();
        rt.text(rt.convert(first, { noP: true }));
        return;
      }
      default: break;
    }

    /* 文本宏（\newcommand 定义过的）就地展开 */
    const textMacro = this.state.textMacros.get(`\\${name}`);
    if (textMacro) return this.expandTextMacro(textMacro);

    /* 认不出来的命令。
       Markdown 模式：原样留着（正文里的 C:\Users\me 这种路径不能被吃掉）；
       文档模式：命令行本身不出东西，但它的参数当内容排出来，正文不至于丢。 */
    if (!this.cfg.blocks) { rt.push(`\\${name}${star ? '*' : ''}`); return; }
    for (let k = 0; k < 6; k++) {
      this.skipSpaces();
      if (this.at() === '[') { this.readBracket(); continue; }
      if (this.at() === '{') {
        const html = rt.convert(this.readGroupRaw() ?? '', { noP: true });
        if (html) rt.text(html);
        continue;
      }
      break;
    }
  }

  /* 吃掉 n 组 [] / {} 参数（只吃这两种：反斜杠开头的下一个命令是「后一件东西」，
     不是参数——\centering\includegraphics 那种写法不能被这里吞掉） */
  skipArgs(n) {
    for (let k = 0; k < n; k++) {
      this.skipSpaces();
      if (this.at() === '[') { this.readBracket(); continue; }
      if (this.at() === '{') { this.readGroupRaw(); continue; }
      return;
    }
  }

  /* ---------------------------------------------------------- 章节 */

  section(name, star) {
    const spec = SECTION_CMDS[name];
    const shortTitle = this.readBracket();
    const title = this.readGroupRaw() ?? '';
    let number = '';
    if (!star) {
      this.state.counters[name] = (this.state.counters[name] || 0) + 1;
      for (const key of LEVEL_NAMES) {
        if (SECTION_CMDS[key] && SECTION_CMDS[key].level > spec.level) this.state.counters[key] = 0;
      }
      number = name === 'part'
        ? (ROMAN[this.state.counters.part] || String(this.state.counters.part))
        : sectionNumber(this.state.counters, spec.level, this.state.appendix);
    }
    const id = `sec-${(number || String(this.state.headings.length + 1)).replace(/[^\w-]+/g, '-')}`;
    const inner = this.rt.convert(title, { noP: true });
    const head = number ? `<span class="ltx-heading__no">${escapeHtml(number)}</span> ` : '';
    this.rt.block(`<${spec.tag} class="${spec.cls}" id="${id}">${head}${inner}</${spec.tag}>`);
    this.state.headings.push({
      level: spec.level,
      number,
      text: shortTitle != null ? this.rt.convert(shortTitle, { noP: true }) : inner,
      id,
    });
    this.state.lastAnchor = { id, number, kind: name };
  }

  /* ---------------------------------------------------------- 定义类 */

  defineMacro() {
    this.skipSpaces();
    let key = null;
    if (this.at() === '{') key = this.readGroupRaw();
    else {
      const m = /^\\([a-zA-Z]+)/.exec(this.rest());
      if (m) { key = m[0]; this.i += m[0].length; }
    }
    const argc = this.readBracket();
    const def = this.readBracket();
    const body = this.readGroupRaw();
    if (key == null || body == null) return;
    const clean = normalizeMacroName(String(key).trim());
    if (def == null) this.state.macros.set(clean, body);
    this.state.textMacros.set(clean, { body, argc: argc ? parseInt(argc, 10) || 0 : 0 });
  }

  defineDef() {
    const m = /^\s*\\([a-zA-Z]+)/.exec(this.rest());
    if (!m) { this.readGroupRaw(); return; }
    const key = `\\${m[1]}`;
    this.i += m[0].length;
    const params = /^[^{]*/.exec(this.rest())[0];
    this.i += params.length;
    const body = this.readGroupRaw();
    if (body == null) return;
    this.state.macros.set(key, body);
    this.state.textMacros.set(key, { body, argc: (params.match(/#[1-9]/g) || []).length });
  }

  defineOperator(star) {
    const key = this.readGroupRaw();
    const body = this.readGroupRaw();
    if (key == null || body == null) return;
    this.state.macros.set(normalizeMacroName(key.trim()), `\\operatorname${star ? '*' : ''}{${body}}`);
  }

  defineTheorem(star) {
    const env = this.readGroupRaw();
    if (env == null) return;
    const shared = this.readBracket();
    const title = this.readGroupRaw();
    const within = this.readBracket();
    if (title == null) return;
    this.state.theorems.set(env.trim(), {
      title: title.trim(),
      numbered: !star,
      shared: shared ? shared.trim() : null,
      within: within ? within.trim() : null,
    });
  }

  expandTextMacro(macro) {
    const argc = macro.argc || 0;
    if (argc > 4) return;
    if (this.state.macroDepth >= MACRO_DEPTH) { this.state.truncated = true; return; }
    this.state.macroDepth++;
    try {
      let body = macro.body;
      for (let k = 1; k <= argc; k++) {
        const arg = this.readArgRaw();
        body = body.split(new RegExp(`#${k}(?![0-9])`, 'g')).join(arg ?? '');
      }
      this.rt.text(this.rt.convert(body, { noP: true }));
    } finally {
      this.state.macroDepth--;
    }
  }

  /* ---------------------------------------------------------- 脚注 */

  footnote() {
    const n = ++this.state.counters.footnote;
    const inner = this.rt.convert(this.readGroupRaw() ?? '', { noP: true });
    this.state.footnotes[n - 1] = inner;
    this.rt.text(`<sup class="ltx-fn"><a id="fnref-${n}" href="#fn-${n}">${n}</a></sup>`);
  }

  footnotemark() {
    const opt = this.readBracket();
    const n = opt ? (parseInt(opt, 10) || 0) : this.state.counters.footnote + 1;
    this.state.counters.footnote = Math.max(this.state.counters.footnote, n);
    if (this.state.footnotes[n - 1] == null) this.state.footnotes[n - 1] = '';
    this.rt.text(`<sup class="ltx-fn"><a id="fnref-${n}" href="#fn-${n}">${n}</a></sup>`);
  }

  footnotetext() {
    const opt = this.readBracket();
    const n = opt ? (parseInt(opt, 10) || 0) : this.state.counters.footnote;
    if (n > 0) this.state.footnotes[n - 1] = this.rt.convert(this.readGroupRaw() ?? '', { noP: true });
    else this.readGroupRaw();
  }

  /* ---------------------------------------------------------- 图片 */

  includegraphics() {
    const opt = this.readBracket() || '';
    const path = String(this.readArgRaw() ?? '').trim();
    if (!path) return;
    const opts = {};
    for (const part of opt.split(',')) {
      const idx = part.indexOf('=');
      if (idx < 0) continue;
      opts[part.slice(0, idx).trim().toLowerCase()] = part.slice(idx + 1).trim();
    }
    const style = [];
    const width = texLengthToCss(opts.width || '');
    const height = texLengthToCss(opts.height || '');
    if (width) style.push(`width:${width}`);
    if (height) style.push(`height:${height}`);
    if (opts.angle) style.push(`transform:rotate(${parseFloat(opts.angle) || 0}deg)`);
    const attr = style.length ? ` style="${style.join(';')}"` : '';
    this.rt.text(`<img src="${escapeAttr(resolveImagePath(path))}" alt=""${attr} loading="lazy">`);
  }

  /* ---------------------------------------------------------- 代码 */

  verbLike() {
    if (this.at() === '*') this.i++;
    const delim = this.at();
    if (!delim || /[a-zA-Z]/.test(delim)) {
      const g = this.readGroupRaw();
      if (g == null) return;
      this.rt.text(`<code class="ltx-tt">${escapeHtml(g)}</code>`);
      return;
    }
    this.i++;
    const end = this.src.indexOf(delim, this.i);
    const code = end < 0 ? this.src.slice(this.i) : this.src.slice(this.i, end);
    this.i = end < 0 ? this.src.length : end + 1;
    this.rt.text(`<code class="ltx-tt ltx-verb">${escapeHtml(code)}</code>`);
  }

  /* ---------------------------------------------------------- 环境 */

  beginEnv() {
    const name = String(this.readGroupRaw() ?? '').trim();
    if (!name) return;
    const { rt } = this;

    if (MATH_ENVS.has(name)) return this.mathEnv(name);
    if (PASSTHROUGH_ENVS.has(name)) {
      rt.push(rt.convert(this.readEnvRaw(name), { nest: true }));
      return;
    }
    if (/^(?:itemize|enumerate|description|list|compactitem|compactenum)\*?$/.test(name)) return this.listEnv(name);
    if (CODE_ENVS.has(name)) return this.codeEnv(name);
    if (name === 'figure' || name === 'figure*' || name === 'wrapfigure' || name === 'subfigure') {
      return this.figureEnv(name);
    }
    if (name === 'table' || name === 'table*') return this.tableEnv(name);
    if (/^(?:tabular|tabular\*|tabularx|tabulary|longtable|supertabular|array)$/.test(name)) {
      return this.tabularEnv(name);
    }
    if (this.state.theorems.has(name)) return this.theoremEnv(name);

    if (name === 'quote' || name === 'quotation' || name === 'displayquote') {
      rt.block(`<blockquote>${rt.convert(this.readEnvRaw(name), { nest: true })}</blockquote>`);
      return;
    }
    if (name === 'verse') {
      rt.block(`<blockquote class="ltx-verse">${rt.convert(this.readEnvRaw(name), { nest: true })}</blockquote>`);
      return;
    }
    if (name === 'center' || name === 'flushleft' || name === 'flushright') {
      const cls = name === 'center' ? 'ltx-center' : name === 'flushleft' ? 'ltx-flushleft' : 'ltx-flushright';
      rt.block(`<div class="${cls}">${rt.convert(this.readEnvRaw(name), { nest: true })}</div>`);
      return;
    }
    if (name === 'abstract') {
      const inner = rt.convert(this.readEnvRaw(name), { nest: true });
      rt.block(`<section class="ltx-abstract"><h2 class="ltx-abstract__head">摘要</h2><div class="ltx-abstract__body">${inner}</div></section>`);
      return;
    }
    if (name === 'thebibliography') {
      this.readGroupRaw();
      return this.bibliography(this.readEnvRaw(name));
    }
    if (name === 'minipage') {
      this.readBracket();
      const w = texLengthToCss(this.readArgRaw());
      const inner = rt.convert(this.readEnvRaw(name), { nest: true });
      rt.block(`<div class="ltx-minipage"${w ? ` style="width:${w}"` : ''}>${inner}</div>`);
      return;
    }
    if (name === 'tikzpicture' || name === 'picture' || name === 'pspicture') {
      this.readEnvRaw(name);
      rt.mark('unsupported');
      rt.block(`<div class="ltx-unsupported" title="这个渲染器不画图">〔${escapeHtml(name)} 里的图排不出来〕</div>`);
      return;
    }

    /* 认不出来的环境：壳子留着，内文照排（总比整段消失好） */
    const inner = rt.convert(this.readEnvRaw(name), { nest: true });
    if (inner.trim()) rt.block(`<div class="ltx-env ltx-env--${escapeAttr(name.replace(/[^\w-]/g, ''))}">${inner}</div>`);
  }

  mathEnv(name) {
    const hasCountArg = name === 'alignat' || name === 'alignat*' || name === 'alignedat';
    const count = hasCountArg ? (this.readGroupRaw() ?? '1') : null;
    let tex = this.readEnvRaw(name);

    if (name === 'math') {
      const ph = this.rt.mathTo(tex, { display: false, env: name });
      if (ph) this.rt.text(ph);
      return;
    }

    const labelMatch = /\\label\s*\{([^}]*)\}/.exec(tex);
    const label = labelMatch ? labelMatch[1].trim() : '';
    if (label) tex = tex.replace(/\\label\s*\{[^}]*\}/g, '');

    /* \notag / \nonumber 的算法：多行环境（align 这些）里它只管自己那一行，
       得**每一行都写了**才整块不编号；单行环境写一个就够。 */
    const notagRe = /\\notag\b|\\nonumber\b/;
    const rows = tex.split(/\\\\/).filter((row) => row.trim());
    const unnumbered = name.endsWith('*')
      || (notagRe.test(tex) && rows.length > 0 && rows.every((row) => notagRe.test(row)));
    let number = '';
    if (NUMBERED_MATH_ENVS.has(name) && !unnumbered) number = String(++this.state.counters.equation);

    let body;
    const sub = MATH_ENV_SUB[name];
    if (sub) body = `\\begin{${sub}}${tex}\\end{${sub}}`;
    else if (name === 'equation' || name === 'equation*') body = tex;
    else if (hasCountArg) body = `\\begin{${name}}{${count}}${tex}\\end{${name}}`;
    else body = `\\begin{${name}}${tex}\\end{${name}}`;

    const id = `eq-${number || this.state.counters.equation + 1}`;
    if (label) {
      this.state.labels.set(label, { id, number, kind: 'equation' });
      this.state.lastAnchor = { id, number, kind: 'equation' };
    }
    const ph = this.rt.mathTo(body, { display: true, env: name, number, id });
    const anchor = label ? this.rt.anchor(label) : '';
    this.rt.block(`<div class="ltx-eq" id="${escapeAttr(id)}">${anchor}${ph || escapeHtml(tex)}</div>`);
  }

  listEnv(name) {
    const { rt } = this;
    const labelSpec = this.readBracket();
    const raw = this.readEnvRaw(name.replace('*', ''));
    const items = splitItems(raw);
    if (!items.length) return;
    const description = name.startsWith('description');
    const ordered = name.startsWith('enumerate') || name === 'compactenum';

    const body = items.map((item) => {
      const raw = String(item.body == null ? '' : item.body).trim();
      const inner = rt.convert(raw, { noP: true });
      if (description) {
        const term = item.label != null ? rt.convert(item.label, { noP: true }) : '';
        return `<dt>${term}</dt><dd>${inner}</dd>`;
      }
      const label = item.label != null ? `<span class="ltx-item-label">${rt.convert(item.label, { noP: true })}</span> ` : '';
      return `<li>${label}${inner}</li>`;
    }).join('');

    if (description) { rt.block(`<dl class="ltx-description">${body}</dl>`); return; }
    const type = ordered ? enumerateType(labelSpec) : '';
    rt.block(`<${ordered ? 'ol' : 'ul'}${type ? ` type="${type}"` : ''}>${body}</${ordered ? 'ol' : 'ul'}>`);
  }

  codeEnv(name) {
    let opt = this.readBracket() || '';
    let lang = '';
    if (name === 'minted') { lang = this.readGroupRaw() ?? ''; }
    const m = /language\s*=\s*([A-Za-z0-9+#-]+)/.exec(opt);
    if (m) lang = m[1];
    const raw = String(this.readEnvRawVerbatim(name)).replace(/^\n/, '').replace(/\n[ \t]*$/, '');
    if (this.cfg.blocks) {
      const cls = lang ? ` class="language-${escapeAttr(lang.toLowerCase())}"` : '';
      this.rt.block(`<pre class="ltx-pre"><code${cls}>${escapeHtml(raw)}</code></pre>`);
      return;
    }
    const fence = raw.includes('```') ? '````' : '```';
    this.rt.block(`${fence}${lang}\n${raw}\n${fence}`);
    void opt;
  }

  figureEnv(name) {
    const { rt } = this;
    this.readBracket();
    let raw = this.readEnvRaw(name);
    const cap = takeTopCommand(raw, 'caption');
    raw = cap.rest;
    const lab = takeTopCommand(raw, 'label');
    raw = lab.rest;
    const numbered = cap.value != null;
    const no = numbered ? ++this.state.counters.figure : this.state.counters.figure + 1;
    const id = `fig-${no}`;
    const inner = rt.convert(raw, { nest: true });
    const caption = numbered
      ? `<figcaption><span class="ltx-caption__no">图 ${no}</span>${rt.convert(cap.value, { noP: true })}</figcaption>`
      : '';
    const anchor = lab.value ? rt.anchor(lab.value.trim()) : '';
    rt.block(`<figure class="ltx-figure" id="${escapeAttr(id)}">${anchor}${inner}${caption}</figure>`);
    if (lab.value) {
      this.state.labels.set(lab.value.trim(), { id, number: String(no), kind: 'figure' });
    }
    if (numbered) this.state.lastAnchor = { id, number: String(no), kind: 'figure' };
  }

  tableEnv(name) {
    const { rt } = this;
    this.readBracket();
    let raw = this.readEnvRaw(name);
    const cap = takeTopCommand(raw, 'caption');
    raw = cap.rest;
    const lab = takeTopCommand(raw, 'label');
    raw = lab.rest;
    const numbered = cap.value != null;
    const no = numbered ? ++this.state.counters.table : this.state.counters.table + 1;
    const id = `tbl-${no}`;
    const inner = rt.convert(raw, { nest: true });
    const caption = numbered
      ? `<figcaption><span class="ltx-caption__no">表 ${no}</span>${rt.convert(cap.value, { noP: true })}</figcaption>`
      : '';
    const anchor = lab.value ? rt.anchor(lab.value.trim()) : '';
    rt.block(`<figure class="ltx-table" id="${escapeAttr(id)}">${anchor}${inner}${caption}</figure>`);
    if (lab.value) this.state.labels.set(lab.value.trim(), { id, number: String(no), kind: 'table' });
    if (numbered) this.state.lastAnchor = { id, number: String(no), kind: 'table' };
  }

  tabularEnv(name) {
    const { rt } = this;
    let spec = '';
    if (/^(?:tabular|tabular\*|array|longtable)$/.test(name)) spec = this.readGroupRaw() ?? '';
    else if (name === 'tabularx' || name === 'tabulary') { spec = this.readGroupRaw() ?? ''; this.readGroupRaw(); }
    else this.readBracket();
    const raw = this.readEnvRaw(name);
    const { cols, vlines } = parseColspec(spec);
    const rows = splitTableRows(raw);
    const html = rows.map((row) => {
      const cls = row.top && row.bottom ? ' class="ltx-rl ltx-rb"' : row.top ? ' class="ltx-rl"' : row.bottom ? ' class="ltx-rb"' : '';
      const tds = row.cells.map((cell, idx) => {
        const trimmed = cell.trim();
        const multi = /^\\multicolumn\s*\{(\d+)\}\s*(\{[^{}]*\})?/.exec(trimmed);
        let content = trimmed;
        let colspan = '';
        if (multi) {
          const span = Math.min(24, parseInt(multi[1], 10) || 1);
          colspan = span > 1 ? ` colspan="${span}"` : '';
          const g = readBracedAt(trimmed, multi[0].length - 1) || readBracedAt(trimmed, multi[0].length);
          content = g ? g.value : '';
        }
        const col = cols[idx] || { align: 'left', width: '' };
        const style = [];
        if (col.align && col.align !== 'left') style.push(`text-align:${col.align}`);
        if (col.width) style.push(`width:${col.width}`);
        return `<td${colspan}${style.length ? ` style="${style.join(';')}"` : ''}>${rt.convert(content, { noP: true })}</td>`;
      }).join('');
      return `<tr${cls}>${tds}</tr>`;
    }).join('');
    rt.block(`<table class="ltx-tabular${vlines ? ' ltx-vlines' : ''}"><tbody>${html}</tbody></table>`);
  }

  theoremEnv(name) {
    const { rt } = this;
    const def = this.state.theorems.get(name) || { title: name, numbered: true };
    const opt = this.readBracket();
    const lab = takeTopCommand(this.readEnvRaw(name), 'label');

    let number = '';
    if (def.numbered) {
      const key = def.shared || name;
      const n = (this.state.theoremCounters.get(key) || 0) + 1;
      this.state.theoremCounters.set(key, n);
      let prefix = '';
      if (def.within === 'section' && this.state.counters.section) {
        prefix = `${sectionNumber(this.state.counters, 2, this.state.appendix)}.`;
      } else if (def.within === 'chapter' && this.state.counters.chapter) {
        prefix = `${this.state.counters.chapter}.`;
      }
      number = `${prefix}${n}`;
    }
    const id = `thm-${name}-${number || this.state.headings.length + 1}`;
    const inner = rt.convert(lab.rest, { nest: true });
    const qed = def.qed ? '<span class="ltx-qed">∎</span>' : '';
    const head = `${escapeHtml(def.title)}${number ? ` ${number}` : ''}${opt ? `（${rt.convert(opt, { noP: true })}）` : ''}`;
    const anchor = lab.value ? rt.anchor(lab.value.trim()) : '';
    rt.block(`<div class="ltx-thm ltx-thm--${escapeAttr(name)}" id="${escapeAttr(id)}">`
      + `${anchor}<p class="ltx-thm__head">${head}</p><div class="ltx-thm__body">${inner}${qed}</div></div>`);
    if (lab.value) this.state.labels.set(lab.value.trim(), { id, number, kind: 'theorem' });
    this.state.lastAnchor = { id, number, kind: 'theorem' };
  }

  bibliography(raw) {
    const { rt } = this;
    const text = String(raw || '');
    const re = /\\bibitem\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/g;
    const spans = [];
    let m;
    while ((m = re.exec(text))) spans.push({ index: m.index, end: m.index + m[0].length, key: m[2].trim() });
    if (!spans.length) return;
    const entries = spans.map((span, idx) => {
      const body = text.slice(span.end, idx + 1 < spans.length ? spans[idx + 1].index : text.length);
      const number = idx + 1;
      this.state.bibIndex.set(span.key, number);
      return `<li id="bib-${escapeAttr(span.key)}"><span class="ltx-bib__no">[${number}]</span> ${rt.convert(body, { noP: true })}</li>`;
    });
    rt.block(`<section class="ltx-bib"><h2 class="ltx-bib__head">参考文献</h2><ol class="ltx-bib__list">${entries.join('')}</ol></section>`);
  }

  maketitle() {
    const { rt } = this;
    if (this.state.title == null) return;
    const parts = [];
    const author = String(this.state.author == null ? '' : this.state.author).trim();
    if (author) parts.push(`<p class="ltx-title__by">${rt.convert(author, { noP: true })}</p>`);
    const date = String(this.state.date == null ? '' : this.state.date).trim();
    if (date && date !== '\\today') parts.push(`<p class="ltx-title__date">${rt.convert(date, { noP: true })}</p>`);
    else if (date === '\\today') parts.push(`<p class="ltx-title__date">${new Date().toISOString().slice(0, 10)}</p>`);
    rt.block(`<header class="ltx-title"><p class="ltx-title__name">${rt.convert(this.state.title, { noP: true })}</p>${parts.join('')}</header>`);
  }
}

/* ---------------------------------------------------------------- 小函数 */

function wrapDecls(html, decls) {
  let out = html;
  for (const decl of decls) {
    out = `<${decl.tag}${decl.cls ? ` class="${decl.cls}"` : ''}>${out}</${decl.tag}>`;
  }
  return out;
}

function enumerateType(spec) {
  const s = String(spec || '').trim();
  if (!s) return '';
  if (/^[\[(]?\s*[a-z]\s*[)\].]/.test(s)) return 'a';
  if (/^[\[(]?\s*[A-Z]\s*[)\].]/.test(s)) return 'A';
  if (/\b(?:i|ii|iii|iv|v)\b/.test(s)) return 'i';
  if (/\b(?:I|II|III|IV|V)\b/.test(s)) return 'I';
  return '';
}

function cssColor(name) {
  const clean = String(name || '').trim();
  if (/^#[0-9a-f]{3,8}$/i.test(clean)) return clean;
  if (/^[a-z]+$/i.test(clean)) return clean;
  if (/^[\d.\s,]+$/.test(clean)) return `rgb(${clean})`;
  return 'inherit';
}

/* \includegraphics{demo.png}：裸文件名补 /media/images/，带协议或 / 的照原样 */
function resolveImagePath(path) {
  let p = String(path || '').trim()
    .replace(/\\_/g, '_').replace(/\\%/g, '%').replace(/\\&/g, '&').replace(/\\ /g, ' ');
  p = p.replace(/^\.\//, '');
  if (/^(?:[a-z]+:)?\/\//i.test(p) || p.startsWith('/') || p.startsWith('data:')) return p;
  if (/^(?:images|videos|music)\//.test(p)) return `/media/${p}`;
  if (p.includes('/')) return p.startsWith('media/') ? `/${p}` : p;
  return `/media/images/${p}`;
}

/* \dv[2]{f}{x} 那种带可选阶数的写法 KaTeX 的宏表接不住，渲染前先改写 */
export function rewriteOptionalArgMacros(tex) {
  return String(tex == null ? '' : tex)
    .replace(/\\dv\s*\[\s*(\d+)\s*\]\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g,
      (m, n, f, x) => `\\frac{d^{${n}}${f}}{d${x}^{${n}}}`)
    .replace(/\\pdv\s*\[\s*(\d+)\s*\]\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g,
      (m, n, f, x) => `\\frac{\\partial^{${n}}${f}}{\\partial ${x}^{${n}}}`);
}

/* ==========================================================================
   tools/latex-check.mjs · LaTeX 文字层的自检
   ---------------------------------------------------------------------------
   走的是**真的那条管线**（server/lib/markdown.mjs 的 renderMarkdown），
   量的是「一篇文章贴进来 / Markdown 里混着写」这两条路上该有的东西：

     · 整篇 .tex：\documentclass + \begin{document} 壳子、\maketitle、目录、摘要
     · 章节：编号、层级、\section* 不编号、\appendix 换字母
     · 文字：\textbf 这些、{\small …} 这些、引号、-- --- 、转义字符
     · 环境：itemize / enumerate / description（含嵌套）、quote、center、定理、证明
     · 图表：figure + \caption + \label、table + tabular（线、列对齐、\multicolumn）
     · 公式：$…$、$$…$$、equation/align 的编号、\notag、\eqref 指回来
     · 引用：\label/\ref 往前指也能解析、脚注、\cite + thebibliography
     · 宏：引言区 \newcommand 在正文与数学里都生效、\DeclareMathOperator
     · 兼容宏：KaTeX 没装的 siunitx / physics 那几件（\SI、\abs、\dv[2]）
     · Markdown 混排：LaTeX 命令与 Markdown 语法互不打扰；代码块里的
       \begin{document} 不会被当成整篇文档
     · 老规矩没坏：markdown-check.mjs 那套（换行、公式、emoji、裸链接）另跑一份

   零依赖，不用起服务：
     node tools/latex-check.mjs
   ========================================================================== */
import { renderMarkdown, needsMath } from '../server/lib/markdown.mjs';

const results = [];
const problems = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  if (!pass) problems.push(`${name}  ${detail}`);
  const shown = detail ? `  — ${String(detail).replace(/\s+/g, ' ').slice(0, 150)}` : '';
  console.log(`${pass ? '  ok  ' : '  XX  '} ${name}${shown}`);
};
const has = (html, needle) => String(html).includes(needle);
const count = (hay, needle) => String(hay).split(needle).length - 1;
const BQ = '`';

/* 一篇什么都用上的 .tex：从引言区到文献表 */
const PAPER = String.raw`\documentclass[11pt]{article}
\usepackage{amsmath,graphicx}
\newcommand{\R}{\mathbb{R}}
\newcommand{\norm}[1]{\left\|#1\right\|}
\newcommand{\proj}{投影}
\DeclareMathOperator{\argmax}{arg\,max}
\newtheorem{theorem}{定理}
\title{测试文档\thanks{鸣谢}}
\author{初音未来 \and 某人}
\date{2025-01-01}

\begin{document}
\maketitle
\tableofcontents

\begin{abstract}
摘要里有公式 $E=mc^2$，还有一句中文换行
接着写的中文。
\end{abstract}

\section{引言}\label{sec:intro}
一句话：\textbf{粗}、\emph{斜}、\texttt{码}、\underline{线}、\textsc{小型大写}，
引号 ${BQ}${BQ}双引号'' 与 ${BQ}单引号'，破折号 --- 与 --，转义 10\% 与 a\_b 与 \& 与 \$5。
宏 \proj 在文字里也展开。

空行之后是新段落：引用 \cite{knuth1984}，指回 \ref{sec:intro}、
公式 \eqref{eq:main}、图 \ref{fig:demo}、表 \ref{tab:demo}、定理 \ref{thm:main}。

{\small 小一号的一段}。{\bfseries 加粗的一段}。

\section{方法}
\subsection{一级}
\subsubsection{二级}
\paragraph{三级}

\begin{itemize}
  \item 甲，带 $\R$ 与 $\norm{x}$
  \item 乙
    \begin{enumerate}
      \item 嵌套一
      \item 嵌套二
    \end{enumerate}
\end{itemize}

\begin{enumerate}[(a)]
  \item 字母编号
\end{enumerate}

\begin{description}
  \item[术语] 解释。
\end{description}

\begin{quote}
  引一段：$a^2+b^2=c^2$。
\end{quote}

\begin{equation}\label{eq:main}
  \int_0^1 x^2\,dx = \frac{1}{3}
\end{equation}

\begin{align}
  a &= b + c \\
  d &= e \notag
\end{align}

\begin{theorem}\label{thm:main}
  偶数平方仍是偶数。
\end{theorem}
\begin{proof}
  直接验证。\qed
\end{proof}

\begin{figure}[htbp]
  \centering
  \includegraphics[width=0.5\textwidth]{demo.png}
  \caption{一张图}\label{fig:demo}
\end{figure}

\begin{table}[htbp]
  \centering
  \begin{tabular}{|l|c|r|}
    \hline
    名字 & 数量 & 价格 \\
    \hline
    甲 & 1 & 2.00 \\
    \multicolumn{2}{c}{合计} & 3.00 \\
    \hline
  \end{tabular}
  \caption{一张表}\label{tab:demo}
\end{table}

脚注\footnote{脚注里有 $\R$ 与 \textbf{粗体}。}与 \verb|\LaTeX 原样| 与代码：

\begin{verbatim}
100% 原样
\end{verbatim}

\section*{不编号的小节}
星号不编号。

\begin{thebibliography}{9}
\bibitem{knuth1984} D.~Knuth. \emph{The \TeX book}. 1984.
\end{thebibliography}

\end{document}
`;

const paper = renderMarkdown(PAPER);

console.log('\nLaTeX 文字层自检（renderMarkdown）\n');

/* ---------------------------------------------------------- 文档骨架 */
check('\\maketitle 排出了标题块', has(paper, 'ltx-title__name') && has(paper, '测试文档'));
check('\\author 里的 \\and 分成两个人', has(paper, '初音未来') && has(paper, '某人'));
check('\\date 排出来', has(paper, '2025-01-01'));
check('\\thanks 没有丢掉', has(paper, '鸣谢'));
check('\\tableofcontents 生成了目录', has(paper, 'ltx-toc') && has(paper, 'ltx-toc__list'));
check('目录项指向章节锚点', has(paper, 'href="#sec-1"') && has(paper, 'href="#sec-2-1"'));
check('目录里带章节号', has(paper, 'ltx-toc__no'));
check('\\begin{abstract} 排出摘要块', has(paper, 'ltx-abstract') && has(paper, '摘要里有公式'));
check('\\documentclass / \\usepackage 本身不出东西', !has(paper, 'documentclass') && !has(paper, 'usepackage'));
check('\\begin{document}/\end{document} 壳子被吃掉', !has(paper, 'begin{document}'));

/* ---------------------------------------------------------- 章节 */
check('\\section 排出 h2', /<h2 class="ltx-section" id="sec-1">/.test(paper), paper.slice(0, 60));
check('\\section 带编号 1', has(paper, '<span class="ltx-heading__no">1</span>'));
check('\\subsection 带编号 2.1', has(paper, '<span class="ltx-heading__no">2.1</span>'));
check('\\subsubsection 落到 h4', has(paper, '<h4 class="ltx-subsubsection"'));
check('\\paragraph 落到 h5', has(paper, '<h5 class="ltx-paragraph"'));
check('\\section* 不编号', /<h2 class="ltx-section" id="sec-\d+">不编号的小节<\/h2>/.test(paper));
check('\\label 放下锚点', has(paper, 'id="sec:intro"'));

/* ---------------------------------------------------------- 文字层 */
check('\\textbf → strong', has(paper, '<strong>粗</strong>'));
check('\\emph → em', has(paper, '<em>斜</em>'));
check('\\texttt → code', has(paper, '<code class="ltx-tt">码</code>'));
check('\\underline → 带下划线的 span', has(paper, '<span class="ltx-underline">线</span>'));
check('\\textsc → 小型大写', has(paper, '<span class="ltx-sc">小型大写</span>'));
check('``引号\'\' 排成中文引号', has(paper, '“双引号”') && has(paper, '‘单引号’'));
check('--- 与 -- 排成破折号与连接号', has(paper, '—') && has(paper, '–'));
check('\\% \\_ \\& \\$ 都按字面出来', has(paper, '10%') && has(paper, 'a_b') && has(paper, '&amp;') && has(paper, '$5'));
check('{\\small …} 组内生效', has(paper, 'ltx-sz--small') && has(paper, '小一号的一段'));
check('{\\bfseries …} 组内生效', has(paper, '<strong>加粗的一段</strong>'));
check('中文之间的换行不补空格', has(paper, '还有一句中文换行接着写的中文。'));
check('文字层的 \\newcommand 就地展开', has(paper, '投影在文字里也展开'));

/* ---------------------------------------------------------- 列表与环境 */
check('itemize → ul/li', has(paper, '<ul><li>甲，带') && count(paper, '<li>甲') === 1);
check('enumerate 嵌套进列表项', /<li>乙\s*<ol>/.test(paper));
check('enumerate[(a)] 变成字母编号', has(paper, '<ol type="a">'));
check('description → dl/dt/dd', has(paper, '<dl class="ltx-description"><dt>术语</dt><dd>解释。</dd></dl>'));
check('quote → blockquote', has(paper, '<blockquote><p>引一段：'));

/* ---------------------------------------------------------- 定理 */
check('theorem 有标题与编号', has(paper, 'ltx-thm--theorem') && has(paper, '定理 1'));
check('theorem 的 \\label 能指', has(paper, 'href="#thm-theorem-1"'));
check('proof 有自己的壳与 ∎', has(paper, 'ltx-thm--proof') && has(paper, 'ltx-qed'));
check('\\qed 在文字里排成方块', !has(paper, '\\qed'));

/* ---------------------------------------------------------- 图表 */
check('figure + caption + label 成一套', has(paper, '<figure class="ltx-figure" id="fig-1">')
  && has(paper, '图 1') && has(paper, '一张图') && has(paper, 'id="fig:demo"'));
check('\\includegraphics 的宽度按 \\textwidth 折算', has(paper, 'style="width:50%"'));
check('图片地址补成 /media/images/', has(paper, 'src="/media/images/demo.png"'));
check('table + tabular 排出表格', has(paper, '<table class="ltx-tabular ltx-vlines">'));
check('列对齐按 colspec 走', has(paper, '<td style="text-align:center">1</td>')
  && has(paper, '<td style="text-align:right">2.00</td>'));
check('\\hline 只画该画的那几条', has(paper, 'class="ltx-rl"') && has(paper, 'class="ltx-rb"'));
check('\\multicolumn 变成 colspan', has(paper, 'colspan="2"'));
check('表格题注带「表 N」', has(paper, '表 1') && has(paper, 'id="tab:demo"'));

/* ---------------------------------------------------------- 公式与引用 */
check('行内公式仍然是 KaTeX', has(paper, 'class="katex"'));
check('equation 有编号并带 \\tag', has(paper, '\\tag{1}') && has(paper, 'class="katex-tag"'));
check('align 整体一个号', has(paper, '\\tag{2}'));
check('\\notag 的那一行不单独编号', count(paper, '\\tag{') === 2);
check('公式的锚点用 \\label 的名字', has(paper, 'id="eq:main"'));
check('\\eqref 排成 (1) 并链过去', /<a class="ltx-ref" href="#eq-1">\(1\)<\/a>/.test(paper));
check('\\ref 往前指也能解析到章节号', /<a class="ltx-ref" href="#sec-1">1<\/a>/.test(paper));
check('\\ref 到图/表/定理都对', has(paper, 'href="#fig-1">1</a>') && has(paper, 'href="#tbl-1">1</a>')
  && has(paper, 'href="#thm-theorem-1">1</a>'));
check('指不到的 \\ref 给 ??，不炸', has(renderMarkdown(String.raw`见 \ref{nope}`), 'ltx-ref--missing'));

/* ---------------------------------------------------------- 脚注与文献 */
check('脚注在正文里留上标', has(paper, '<sup class="ltx-fn"><a id="fnref-1" href="#fn-1">1</a></sup>'));
check('脚注内容单独收在末尾', has(paper, 'ltx-footnotes__list') && has(paper, '脚注里有'));
check('脚注里也能排公式', count(paper, 'class="katex"') > 3);
check('\\cite 排成 [1] 并链到文献', /<span class="ltx-cites">\[<a class="ltx-cite" href="#bib-knuth1984">1<\/a>\]<\/span>/.test(paper));
check('thebibliography 排出文献表', has(paper, 'ltx-bib__list') && has(paper, 'id="bib-knuth1984"'));
check('指不到的 \\cite 给 ?，不炸', has(renderMarkdown(String.raw`\cite{nope}`), 'ltx-cite--missing'));

/* ---------------------------------------------------------- 宏与兼容包 */
check('引言区的 \\newcommand 在数学里生效', has(paper, 'mathvariant="double-struck">R'));
check('带参数的 \\norm 生效', has(paper, '∥'));
check('\\DeclareMathOperator 生效', has(paper, 'arg'));
check('siunitx 的 \\SI 补上了', has(renderMarkdown(String.raw`$\SI{5}{\metre}$`), 'class="katex"')
  && !has(renderMarkdown(String.raw`$\SI{5}{\metre}$`), '#cc0000'));
check('physics 的 \\abs / \\dv 补上了', !has(renderMarkdown(String.raw`$\abs{x}+\dv{f}{x}$`), '#cc0000'));
check('\\dv[2] 这种带可选阶数的写法也认', !has(renderMarkdown(String.raw`$\dv[2]{f}{x}$`), '#cc0000'));
check('没装的宏包只留红字，不影响文字层', has(renderMarkdown(String.raw`文字 $\ce{H2O}$ 还在`), '还在'));

/* ---------------------------------------------------------- 代码 */
check('\\verb 原样', has(paper, 'ltx-verb') && has(paper, '\\LaTeX 原样'));
check('verbatim 里的 % 不被当注释', has(paper, '<pre class="ltx-pre"><code>100% 原样</code></pre>'));

/* ---------------------------------------------------------- Markdown 混排 */
const mixed = renderMarkdown([
  '# 标题',
  '',
  '正文 **粗体** 与 \\textbf{LaTeX 粗} 还有 $a+b$。',
  '',
  '\\begin{itemize}',
  '\\item 甲',
  '\\item 乙',
  '\\end{itemize}',
  '',
  '| 甲 | 乙 |',
  '|---|---|',
  '| 1 | 2 |',
].join('\n'));
check('Markdown 的 # 标题还在', has(mixed, '<h1>标题</h1>'));
check('Markdown 的 ** 强调还在', has(mixed, '<strong>粗体</strong>'));
check('混排里的 \\textbf 也认', has(mixed, '<strong>LaTeX 粗</strong>'));
check('混排里的 $…$ 还是公式', has(mixed, 'class="katex"'));
check('混排里的 itemize 排成列表', has(mixed, '<ul><li>甲</li>') && count(mixed, '<li>') === 2);
check('Markdown 表格没被打扰', has(mixed, '<th>甲</th>') && count(mixed, '<td>') === 2);

const fencedDoc = renderMarkdown(['看这段：', '', '```tex', '\\begin{document}', '正文', '\\end{document}', '```', '', '完。'].join('\n'));
check('代码块里的 \\begin{document} 不会把整篇当 .tex', has(fencedDoc, '看这段：') && has(fencedDoc, 'language-tex') && !has(fencedDoc, 'ltx-title'));

const path = renderMarkdown('路径 C:\\Users\\me\\notes 与正则 \\d{2,3} 都该原样');
check('认不出的命令不吞正文（Windows 路径、正则）', has(path, 'C:\\Users\\me\\notes') && has(path, '\\d{2,3}'));

const whole = renderMarkdown(['```latex', '\\section{一}', '正文 $x$', '```'].join('\n'));
check('整段 ```latex 包起来 = 整篇文档', has(whole, 'ltx-section') && has(whole, 'id="sec-1"'));

/* ---------------------------------------------------------- 收尾 */
check('带公式的页面才要 KaTeX 样式', needsMath(paper) === true && needsMath(renderMarkdown('没有公式')) === false);
check('没有公式时不留占位符', !has(renderMarkdown('普通一段文字'), '@@CV01MATH'));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
if (problems.length) {
  console.log('\n没过的：');
  for (const p of problems) console.log(`  !! ${p}`);
}
process.exit(failed.length ? 1 : 0);

/* ==========================================================================
   tools/markdown-check.mjs · 正文管线的自检
   ---------------------------------------------------------------------------
   走的是**真的那条管线**（server/lib/markdown.mjs 的 renderMarkdown，
   编辑页右栏预览与文章页用的是同一个），量的是几件容易在改动里悄悄丢掉的事：

     · 单个换行就是换行（breaks: true）——正文框里敲一下回车，预览与页面都要断行
     · 空一行才是新段落
     · CommonMark 那两种硬换行（行尾两个空格、行尾反斜杠）照旧认
     · 代码块 / 缩进代码 / 表格里的换行是结构，不能被塞 <br>
     · 公式（行内、独立成行、跨行的 $$…$$）照旧由 KaTeX 渲染，且不被 breaks 动
     · emoji 短代码、中文标点后面的裸链接（fixCjkAutolinks）这两条老规矩没被碰坏

   零依赖，不用起服务：
     node tools/markdown-check.mjs
   ========================================================================== */
import { renderMarkdown, needsMath, decorateBody } from '../server/lib/markdown.mjs';

const results = [];
const problems = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  if (!pass) problems.push(`${name}  ${detail}`);
  console.log(`${pass ? '  ok  ' : '  XX  '} ${name}${detail ? `  — ${detail}` : ''}`);
};

const md = (s) => renderMarkdown(s);
const FENCE = '```';
const count = (hay, needle) => hay.split(needle).length - 1;

console.log('\n正文管线自检（renderMarkdown）\n');

/* ---------------------------------------------------------- 换行 */
const twoLines = md('第一行\n第二行');
check('单个换行落成 <br>', twoLines.includes('<p>第一行<br>第二行</p>'), twoLines.trim());

const twoParas = md('第一段\n\n第二段');
check(
  '空一行才是新段落（两个 <p>）',
  count(twoParas, '<p>') === 2 && !twoParas.includes('<br>'),
  twoParas.replace(/\n/g, '\\n').trim()
);

const threeLines = md('甲\n乙\n丙');
check('连着三行就是两个 <br>', count(threeLines, '<br>') === 2, threeLines.trim());

check('行尾两个空格仍然是硬换行', md('第一行  \n第二行').includes('第一行<br>第二行'));
check('行尾反斜杠仍然是硬换行', md('第一行\\\n第二行').includes('第一行<br>第二行'));

/* 这一条是这次改动的正题：预览与成品必须一致（同一个渲染器），
   所以「写下的换行」在两处都要看得见。 */
check(
  '换行不会退化成空格（预览里两行不挤在一行上）',
  !/<p>第一行\s+第二行<\/p>/.test(twoLines),
  twoLines.trim()
);

/* ---------------------------------------------------------- 结构不受影响 */
const fenced = md(`${FENCE}js\nconst a = 1\nconst b = 2\n${FENCE}`);
check(
  '围栏代码块里的换行原样留着、没有 <br>',
  fenced.includes('const a = 1\nconst b = 2') && !fenced.includes('<br>'),
  fenced.replace(/\n/g, '\\n').trim()
);
check('围栏代码块还带着语言名的 class', fenced.includes('language-js'));

const indented = md('    一行\n    两行');
check(
  '缩进代码块同理',
  indented.includes('<pre><code>一行\n两行') && !indented.includes('<br>'),
  indented.replace(/\n/g, '\\n').trim()
);

const table = md('| 甲 | 乙 |\n|---|---|\n| 1 | 2 |');
check(
  '表格里的换行是结构，没有 <br>',
  table.includes('<table>') && table.includes('<th>甲</th>') && !table.includes('<br>')
);
check('表格的列数与对齐没变', count(table, '<td>') === 2 && count(table, '<th>') === 2);

const list = md('- 第一项\n  接着写\n- 第二项');
check(
  '列表项里折行照样断行（在 <li> 里）',
  /<li>第一项<br>接着写<\/li>/.test(list),
  list.replace(/\n/g, '\\n').trim()
);
check('列表还是两个 <li>', count(list, '<li>') === 2);

const quote = md('> 第一行\n> 第二行');
check(
  '引用里折行照样断行（在 <blockquote> 里）',
  quote.includes('<blockquote>') && quote.includes('第一行<br>第二行'),
  quote.replace(/\n/g, '\\n').trim()
);

const headings = md('## 标题\n正文\n');
check(
  '标题与紧跟的正文各归各位（标题不吃换行）',
  headings.includes('<h2>标题</h2>') && headings.includes('<p>正文</p>') && !headings.includes('<br>')
);

/* ---------------------------------------------------------- 公式 */
const inlineMath = md('勾股：$a^2+b^2=c^2$ 完。');
check('行内公式仍然由 KaTeX 渲染', inlineMath.includes('class="katex"'), inlineMath.slice(0, 80));
check('行内公式让这一页认得自己要带 KaTeX 样式', needsMath(inlineMath) === true);

const displayMath = md('$$\n\\int_0^1 x\\,dx\n$$');
check('独立成行的公式仍然渲染', displayMath.includes('class="katex-display"'), displayMath.slice(0, 90));
check(
  '跨行的公式里没有被塞 <br>（公式在 marked 之前就抠出来了）',
  !displayMath.includes('<br>'),
  displayMath.replace(/\n/g, '\\n').slice(0, 120)
);

check('不是公式的美元号不会被吃掉', md('花了 $5 到 $10').includes('$5 到 $10'));
check('美元号里侧挨着空格就不算公式（pandoc 那条规矩）', md('两边 $ x $ 空').includes('$ x $'));
check('里侧紧挨内容的才算公式', md('$a+b$').includes('class="katex"'));

/* ---------------------------------------------------------- 老规矩没坏 */
const emoji = md('今天 :smile: 一下');
check('emoji 短代码照旧换掉', emoji.includes('😄') && !emoji.includes(':smile:'), emoji.trim());

const autolink = md('看 https://example.com/a，然后继续');
check(
  '裸链接后面的中文标点没有被吞进链接',
  autolink.includes('</a>，然后继续') && autolink.includes('href="https://example.com/a"'),
  autolink.trim()
);

const htmlBody = decorateBody('<p>一行<br>两行</p>');
check('HTML 那条路（decorateBody）不受影响', htmlBody.includes('<br>'), htmlBody);

/* ---------------------------------------------------------- 收尾 */
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
if (problems.length) {
  console.log('\n没过的：');
  for (const p of problems) console.log(`  !! ${p}`);
}
process.exit(failed.length ? 1 : 0);

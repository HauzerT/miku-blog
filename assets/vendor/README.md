# assets/vendor/ · 两个随站自带的第三方库

这个目录是**唯一**允许出现第三方代码的地方（其余全是手写的）。
两个库都是本地文件：页面与服务器直接从这里读，**不联网、不 CDN、`file://` 打开也照跑**。

```
marked/marked.esm.js     44 KB   Markdown → HTML（GFM 全量）
marked/LICENSE                   MIT
katex/katex.mjs         589 KB   公式 → HTML + MathML（服务端用它，Node 直接 import）
katex/katex.min.css      24 KB   页面上的公式样式
katex/fonts/*.woff2      20 个   公式用的字体（共 254 KB，浏览器按需懒加载）
katex/LICENSE                    MIT
```

| 库 | 版本 | 拿来干什么 | 出处 |
|---|---|---|---|
| [marked](https://github.com/markedjs/marked) | 18.0.13 | 正文的 Markdown（CommonMark + GFM：表格、任务列表、删除线、自动链接…） | npm 包 `marked`，取 `lib/marked.esm.js` |
| [KaTeX](https://katex.org/) | 0.18.7 | 数学公式排版（服务端渲染成 HTML + MathML，页面只加载 CSS 与字体） | npm 包 `katex`，取 `dist/katex.mjs`、`dist/katex.min.css`、`dist/fonts/*.woff2` |

## 几个刻意的取舍

- **只留 woff2 字体。** KaTeX 的发行包里每个字体有 ttf / woff / woff2 三份，
  现代浏览器（Chrome / Edge / Firefox / Safari 的近几年版本）都吃 woff2，
  所以另外两份没带——省下约 500 KB。真要照顾很老的浏览器，把 woff 一起拷进来即可。
- **不装 `katex.min.js`（浏览器版）。** 公式是在**服务端**编译好的（`server/lib/markdown.mjs`
  里的 `renderMath`），页面不需要再跑一遍 KaTeX，也就不需要那个 266 KB 的 UMD 包。
  代价：正文里的公式要在「写入时」编译——编辑页保存、页面上直接改字保存这两处都会走到，
  所以照旧不用手工做别的。
- **不装 `contrib/auto-render`。** 它是给浏览器 DOM 用的，我们是字符串管线，逻辑短得多。
- **marked 只用 ESM 那一份**（`marked.esm.js`），服务端 `import` 它；
  浏览器不需要 marked（Markdown 只在服务端渲染，预览也走 `/api/render`）。

## 怎么升级

```bash
npm view marked version && npm view katex version
# 取这两个 tgz，拷回上表列出的那几个文件，然后跑一遍自检：
node tools/nuxt-edit-check.mjs http://127.0.0.1:3987   # 它会把富文本正文存下来再看页面，公式与 emoji 都过一遍
```

升级完记得把这两个数字（版本号）在本文件与根 `README.md` 里一起改掉。

## 许可证

两个库都是 MIT。原文就在各自的 `LICENSE` 文件里，随文件一起分发。
本站在此之外的所有代码、样式、字体（Big Shoulders，OFL）、图形都是手写的。

/*
   nuxt.config.ts · miku-blog 的 Nuxt 3 全栈外壳

   目录约定（仓库根就是 srcDir）：
     pages/  components/  layouts/  composables/  plugins/   ← Vue 前端
     server/api/  server/middleware/  server/utils/          ← Nitro 服务端
     server/lib/                                             ← 被 server/utils 直接 import 的纯逻辑
                                                               （markdown / emoji / htmltext / authlimit），
                                                               Nitro 不把它当路由扫描，见下方说明）

   · content/posts.mjs 是唯一内容真源：应用直接 import 它，没有生成步骤。
   · assets/ 里的 CSS、字体、vendor 库一个字节都不搬家：用 nitro.publicAssets 原样挂到 /assets，
     Vue 组件只负责吐出一模一样的 class 名，所以视觉不会漂。
   · 不引任何 CDN：vue / marked / katex 全从 node_modules 打包进产物，离线可用。
*/
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tracks as seedTracks } from './content/posts.mjs';
import { rounds as PALETTE_ROUNDS, active as PALETTE_ACTIVE } from './content/palette.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));

/* data/ 里那几个文件：预渲染要按它们决定生成哪些页（data 不进仓库，缺了就退回空） */
const readJson = (name, fallback) => {
  const file = join(root, 'data', name);
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};

/* 首帧的地址栏颜色：色值只在 content/palette.mjs 里写一次 */
const paperHex = (theme = 'light') => {
  const value = PALETTE_ROUNDS[PALETTE_ACTIVE].tokens['--paper'];
  const [light, dark] = Array.isArray(value) ? value : [value, value];
  return theme === 'dark' ? dark : light;
};

/* 首帧之前决定主题与动效，避免闪烁。这段必须内联在 <head> 里，不能等 JS 包加载。 */
const BOOT = `(function(){var r=document.documentElement,s=null;
try{s=localStorage.getItem('cv01-theme')}catch(e){}
if(s==='dark'||s==='light'){r.setAttribute('data-theme',s)}
else if(window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches){r.setAttribute('data-theme','dark')}
/* 手机浏览器地址栏的颜色紧接着由 assets/js/palette.js 按当前配色算，这里不再写死 */
if(!(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches)){r.classList.add('js')}})();`;

/* 每一页都要的样式表。roll / page / studio 只在站内页面用得上，
   由 layouts/default.vue 自己带上；门厅（layouts/gate.vue）只借前三个。 */
const BASE_STYLES = ['/assets/css/palette.css', '/assets/css/tokens.css', '/assets/css/base.css'];

/* 需要预渲染（nuxt generate）的静态路由：内容真源里有什么就生成什么。
   隐藏掉的文章与板块不给（见 data/overrides.json），界面上新建的照给。 */
const hiddenPosts = new Set(
  Object.entries(readJson('overrides.json', {}).posts || {})
    .filter(([, v]) => v && v.hidden)
    .map(([slug]) => slug)
);
const hiddenSections = new Set(
  Object.entries(readJson('overrides.json', {}).sections || {})
    .filter(([, v]) => v && v.hidden)
    .map(([id]) => id)
);
const runtimeSections = readJson('sections.json', []).filter((s) => s && s.seed === false);
const runtimeArticles = readJson('articles.json', []);

const contentRoutes = [
  '/',
  '/archive',
  '/about',
  '/kumura',
  '/login',
  '/editor',
  ...seedTracks.filter((t) => !hiddenSections.has(t.id)).map((t) => `/sections/${t.id}`),
  ...runtimeSections.filter((s) => !hiddenSections.has(s.id)).map((s) => `/sections/${s.id}`),
  ...seedTracks.flatMap((t) => (t.posts || []).map((p) => `/posts/${p.slug}`)).filter((p) => !hiddenPosts.has(p.split('/').pop())),
  ...runtimeArticles.filter((a) => a && a.slug && !hiddenPosts.has(a.slug)).map((a) => `/posts/${a.slug}`),
].filter((route, i, all) => all.indexOf(route) === i);

export default defineNuxtConfig({
  compatibilityDate: '2026-01-01',
  devtools: { enabled: false },
  ssr: true,

  app: {
    head: {
      htmlAttrs: { lang: 'zh-CN' },
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'color-scheme', content: 'light dark' },
        /* 首帧的地址栏颜色。真正的那一份由 palette.js 按当前配色覆盖 */
        { name: 'theme-color', content: paperHex('light') },
      ],
      link: [
        { rel: 'icon', href: '/assets/img/favicon.svg', type: 'image/svg+xml' },
        ...BASE_STYLES.map((href) => ({ rel: 'stylesheet', href })),
      ],
      script: [
        { innerHTML: BOOT, tagPriority: 30 },
      ],
    },
  },

  css: [],

  nitro: {
    /* 仓库根目录下的 content/ 与 assets/vendor/ 在 Nuxt 的 srcDir 之外。
       相对导入在预渲染（.nuxt/prerender/）里会被算错深度，所以一律走别名：
       rollup 解析成绝对路径，在哪个深度都对。 */
    alias: {
      '#content': `${root}content`,
      '../../assets/vendor/marked/marked.esm.js': `${root}assets/vendor/marked/marked.esm.js`,
      '../../assets/vendor/katex/katex.mjs': `${root}assets/vendor/katex/katex.mjs`,
    },
    /* 静态资源原地服务：assets/（含字体、vendor）、media/（上传物）、design/（设计资产）。
       不复制、不搬家——改一处两边都变，上传的新文件也不用重新构建。 */
    publicAssets: [
      { dir: `${root}assets`, baseURL: '/assets', maxAge: 60 * 60 },
      { dir: `${root}media`, baseURL: '/media', maxAge: 60 * 60 },
      { dir: `${root}design`, baseURL: '/design', maxAge: 60 * 60 },
    ],
    prerender: {
      crawlLinks: true,
      routes: contentRoutes,
      failOnError: false,
    },
    /* 旧的 .html 地址由 server/middleware/legacy-urls.ts 301 到新路由，这里不做兜底 */
  },

  typescript: {
    strict: false,
    typeCheck: false,
  },
});

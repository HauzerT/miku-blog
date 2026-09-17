/* ==========================================================================
   server/utils/content.ts · Nuxt 这一侧的内容装配
   ---------------------------------------------------------------------------
   页面上的全部内容 = 两个源合起来，这一层只做合并，不新增规矩：

     content/posts.mjs   手写的一半：板块定义、原生文章、每日一句
     data/*.json         界面写的一半：新建的板块、编辑页写的文章、
                         改过的名字与正文（overrides）、撤下的记录

   合并规则是唯一的、只写在这里：data/sections.json 里的定义 / 导语 / 子板块盖过种子，
   overrides 里的 name / body 盖过正文，hidden 的整条撤掉。

   正文在这里就排好版（Markdown → marked → emoji → KaTeX），页面拿到的
   是成品 HTML —— 服务端渲染与客户端 hydration 看到的是同一份。
   整份结果按 data/ 那几个文件的 mtime 缓存，改完文件下次请求就重算。
   ========================================================================== */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { site as seedSite, tracks as seedTracks, excerpts } from '#content/posts.mjs';
import { renderMarkdown, decorateBody, needsMath } from '../lib/markdown.mjs';

/* 数据目录。默认是「跑起来的那个工作目录」——nuxt dev / node .output/server/index.mjs
   都是站在仓库根目录起，所以 data/ 就在眼前；换了地方就用 CV01_ROOT 指一下。 */
const ROOT = process.env.CV01_ROOT || process.cwd();
const DATA_FILES = ['sections.json', 'articles.json', 'overrides.json'];

const PITCH_STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/* 音高名 → MIDI 号：A5=81、F#3=54。认不出的排到最后（-1） */
const midiOf = (pitch) => {
  const m = /^([A-Ga-g])(#?)(-?\d+)$/.exec(String(pitch || '').trim());
  if (!m) return -1;
  return (Number(m[3]) + 1) * 12 + (PITCH_STEP[m[1].toUpperCase()] ?? 0) + (m[2] ? 1 : 0);
};

const readJson = (name, fallback) => {
  const file = join(ROOT, 'data', name);
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};

const hasText = (value) => typeof value === 'string' && value.trim() !== '';

/* 一篇文章的正文：界面改过的（overrides.body）优先，其次源文件 / 记录里的正文。
   原生文章与编辑页写的文章在这里走同一条管线（emoji + 公式），不像旧服务那样
   分两处——渲染器只有一个。 */
const bodyOf = (source, override) => {
  if (override && hasText(override.body)) return decorateBody(override.body);
  if (hasText(source?.body)) return decorateBody(source.body.trim());
  if (hasText(source?.source)) return renderMarkdown(source.source);
  return '';
};

/* 缓存。写接口落盘之后由 store.ts 叫一声 invalidateContent()——
   mtime 变了签名一般也就变了，但同一毫秒里连写两次（编辑页一次保存会写好几处）
   签名可能一模一样，那种时候只有显式作废才保险。 */
let cache: { key: string; value: any } = { key: '', value: null };

export function invalidateContent() {
  cache = { key: '', value: null };
}

const signature = () =>
  DATA_FILES.map((name) => {
    try {
      return `${name}:${statSync(join(ROOT, 'data', name)).mtimeMs}`;
    } catch {
      return `${name}:0`;
    }
  }).join('|');

export function loadSiteContent() {
  const key = signature();
  if (cache.value && cache.key === key) return cache.value;
  const sectionsRaw = readJson('sections.json', []);
  const articlesRaw = readJson('articles.json', []);
  const overrides = readJson('overrides.json', {});
  const sectionOverride = overrides.sections || {};
  const postOverride = overrides.posts || {};

  /* data/sections.json 是按 order 排的数组，这里按 id 建索引 */
  const sectionMeta = new Map();
  for (const item of Array.isArray(sectionsRaw) ? sectionsRaw : []) {
    if (item && item.id) sectionMeta.set(item.id, item);
  }

  /* 编辑页写的文章按板块分组 */
  const runtimeBySection = new Map();
  for (const article of Array.isArray(articlesRaw) ? articlesRaw : []) {
    if (!article || !article.section) continue;
    if (!runtimeBySection.has(article.section)) runtimeBySection.set(article.section, []);
    runtimeBySection.get(article.section).push(article);
  }

  const buildTrack = (seed, id, slot) => {
    const meta = sectionMeta.get(id) || {};
    const posts = [];

    for (const post of seed?.posts || []) {
      const override = postOverride[post.slug] || {};
      if (override.hidden) continue;
      const body = bodyOf(post, override);
      posts.push({
        slug: post.slug,
        date: post.date,
        title: hasText(override.title) ? override.title : post.title,
        short: post.short,
        min: post.min,
        blurb: post.blurb,
        sub: '',
        runtime: false,
        body,
        math: needsMath(body),
      });
    }

    for (const article of runtimeBySection.get(id) || []) {
      const override = postOverride[article.slug] || {};
      if (override.hidden || article.hidden) continue;
      const body = bodyOf(article, override);
      posts.push({
        slug: article.slug,
        date: article.date,
        title: hasText(override.title) ? override.title : article.title,
        short: article.short,
        min: article.min,
        blurb: article.blurb,
        sub: article.sub || '',
        runtime: true,
        body,
        math: needsMath(body),
      });
    }

    /* 同一轨里按日期倒序：卷帘与文章列表要的次序 */
    posts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    return {
      id,
      /* 节奏槽：卷帘上这一轨用哪一条手工排的节奏（content/roll.mjs 的 RHYTHMS）。
         钉在「它在内容里的次序」上，不跟着音高排序走——否则界面上新建一个
         更高的板块，会把所有已有轨道的音符节奏一起挪位（旧服务端同一条规矩）。 */
      slot,
      pitch: hasText(meta.pitch) ? meta.pitch : seed?.pitch || 'C4',
      black: typeof meta.black === 'boolean' ? meta.black : Boolean(seed?.black),
      name: hasText(meta.name) ? meta.name : seed?.name || id,
      def: hasText(meta.def) ? meta.def : seed?.def || '',
      lede: hasText(meta.lede) ? meta.lede : seed?.lede || '',
      /* 首页索引那行小字的老规矩：data 里写过 def 就用它，否则退回导语 */
      hasDefOverride: hasText(meta.def),
      seed: Boolean(seed),
      subs: Array.isArray(meta.subs)
        ? meta.subs.map((s) => ({ id: s.id, name: s.name, def: s.def || '' }))
        : [],
      posts,
    };
  };

  const tracks = [];
  const seen = new Set();

  for (const [seedIndex, seed] of seedTracks.entries()) {
    seen.add(seed.id);
    if (sectionOverride[seed.id]?.hidden) continue;
    tracks.push(buildTrack(seed, seed.id, seedIndex));
  }

  /* 界面上新建的板块（data/sections.json 里有、种子里没有）：
   节奏槽接在种子后面，不插队 */
  let extra = seedTracks.length;
  for (const id of sectionMeta.keys()) {
    if (seen.has(id) || sectionOverride[id]?.hidden) continue;
    seen.add(id);
    tracks.push(buildTrack(null, id, extra++));
  }

  /* 挡一手：有文章却没有板块记录的，也摆出来，别让文章凭空消失 */
  for (const id of runtimeBySection.keys()) {
    if (seen.has(id) || sectionOverride[id]?.hidden) continue;
    seen.add(id);
    tracks.push(buildTrack(null, id, extra++));
  }

  /* 高音在上：越往上越轻。种子本来就是这个次序，新板块按音高插进去 */
  tracks.sort((a, b) => midiOf(b.pitch) - midiOf(a.pitch));

  const hidden = {
    sections: Object.keys(sectionOverride)
      .filter((id) => sectionOverride[id]?.hidden)
      .map((id) => {
        const meta = sectionMeta.get(id) || {};
        return { id, name: meta.name || id, pitch: meta.pitch || '' };
      }),
    posts: Object.keys(postOverride).filter((slug) => postOverride[slug]?.hidden),
  };

  const value = { site: seedSite, excerpts, tracks, hidden };
  cache = { key, value };
  return value;
}

/* ==========================================================================
   server/utils/briefs.ts · 接口形状的那些投影
   ---------------------------------------------------------------------------
   页面上看到的「板块树 / 文章 / 归档 / 卷帘上的位置」都从这里出。它只读状态、
   不写盘，所以是纯的投影层（真正的落盘在 store.ts）。

   这一层只做投影：mergeTracks 那一套合并（板块树 + 覆盖层 + 撤下）、
   postBrief / articleBrief / sectionStats 这些形状，都从这里出。

   唯一与「网址」有关的一条：urlFor() 吐的是新路由（/posts/<slug>、
   /sections/<id>）。旧的 `.html` 地址由 server/middleware/legacy-urls.ts 301 过去。
   ========================================================================== */
import { noteWidth, slotOf, timelineChain } from '#content/roll.mjs';
import { tracks as seedTracks } from '#content/posts.mjs';
import { getArticles, getOverrides, getSections, hiddenIn, sortByPitch } from './store';

/* 新路由。旧的 .html 地址由 server/middleware/legacy-urls.ts 那边管，
   接口里给前端的一律是新地址（前端 pages/ 下的路由就是这些）。 */
export function urlFor(kind: 'post' | 'section' | 'sub', id: string, sub = ''): string {
  const enc = (v: unknown) => encodeURIComponent(String(v));
  if (kind === 'post') return `/posts/${enc(id)}`;
  if (kind === 'sub') return `/sections/${enc(id)}/${enc(sub)}`;
  return `/sections/${enc(id)}`;
}

/* ------------------------------------------------------------------ 轨道 */

/* 文章 → 卷帘上那个音符认得的形状。`edited` 是「站长在页面上直接改过的那一版正文」——
   原生文章的 `body` 是 content/posts.mjs 里的源，两者不能混。 */
export function articleAsPost(a: any) {
  return {
    id: a.id,
    slug: a.slug,
    title: a.title,
    short: a.short || a.title.slice(0, 4),
    min: a.min || 3,
    blurb: a.blurb || '',
    date: a.date,
    runtime: true,
    section: a.section,
    sub: a.sub || '',
    edited: a.body || '',
  };
}

/* 九条原生轨道 + 运行时新建的板块 + 运行时文章，合成一份 tracks。
   返回的顺序按音高（高音在上），但每条的 slot 钉在「内容顺序」上——
   节奏槽不能因为新板块插到上面而挪位。 */
export function mergeTracks(seeds: any[], sections: any[], articles: any[]): any[] {
  const byId = new Map(sections.map((s) => [s.id, s]));
  const tracks = seeds.map((t, i) => {
    const s: any = byId.get(t.id);
    return {
      ...t,
      ...(s ? { name: s.name, pitch: s.pitch, black: Boolean(s.black), def: s.def ?? t.def, lede: s.lede ?? t.lede } : {}),
      subs: (s && s.subs) || [],
      posts: (t.posts || []).slice(),
      slot: i,
    };
  });

  let nextSlot = tracks.length;
  for (const s of sections) {
    if (tracks.some((t) => t.id === s.id)) continue;
    tracks.push({
      id: s.id, name: s.name, pitch: s.pitch, black: Boolean(s.black),
      def: s.def || '', lede: s.lede || '', subs: s.subs || [], posts: [], slot: nextSlot++,
    });
  }

  /* 运行时文章接在自己轨道已有文章的后面，按日期从旧到新 —— 卷帘上依次往右排 */
  for (const a of articles.slice().sort((x, y) => (x.date < y.date ? -1 : 1))) {
    const track = tracks.find((t) => t.id === a.section);
    if (!track) continue;
    track.posts.push(articleAsPost(a));
  }

  return sortByPitch(tracks);
}

/* 把 data/overrides.json 压到合成好的 tracks 上：
   撤下的整条拿掉，改过名的换成新名字，正文被改过的换成那一份。源文件与 data/ 都不动。 */
export function applyOverrides(tracks: any[], overrides: any): any[] {
  const os = (overrides && overrides.sections) || {};
  const op = (overrides && overrides.posts) || {};
  return tracks
    .filter((t) => !hiddenIn(os, t.id))
    .map((t) => {
      const posts = (t.posts || [])
        .filter((p: any) => !hiddenIn(op, p.slug))
        .map((p: any) => {
          const o = op[p.slug];
          if (!o) return p;
          const next = { ...p };
          if (o.title) next.title = o.title;
          /* 页面上直接改的那一版：放 `edited`，别盖掉原生文章自己的 `body`（那是源） */
          if (o.body) next.edited = o.body;
          return next;
        });
      return { ...t, posts };
    });
}

/* allPosts() 是不压覆盖层的那一份（找得到已经被撤下的东西，好恢复）；
   tracksNow() 是服务对外用的那一份：撤下的已经不在里面了。 */
export const allPosts = () => mergeTracks(seedTracks, getSections(), getArticles());
export const tracksNow = () => applyOverrides(allPosts(), getOverrides());

/* 没被撤下的板块（板块树、动态页、列表都看这一份） */
export const liveSections = () => getSections().filter((s) => !hiddenIn(getOverrides().sections, s.id));

/* 运行时文章在卷帘上的位置（前端补音符时要用同一套数字）。
   横轴是接龙：把整份 tracks 的全部文章排一条链，认出这篇在链上的那格；
   认不出日期的（不会发生，挡一手）退回节奏槽。 */
export function articleNote(tracks: any[], article: any) {
  const ti = tracks.findIndex((t) => t.id === article.section);
  if (ti === -1) return null;
  const track = tracks[ti];
  const pi = track.posts.findIndex((p: any) => p.runtime && p.id === article.id);
  if (pi === -1) return null;
  const chain = timelineChain(tracks.flatMap((t) => t.posts || []));
  const note = chain ? chain.notes.find((n: any) => n.post === track.posts[pi]) : null;
  const [x, w] = note
    ? [Number(((note.x / chain.span) * 100).toFixed(2)), Number(note.w.toFixed(2))]
    : noteWidth(slotOf(track, ti), pi);
  return { x, w, pi, pitch: track.pitch, slot: slotOf(track, ti) };
}

/* 给前端合并用的瘦身版（运行时文章） */
export function articleBrief(tracks: any[], a: any) {
  const note = articleNote(tracks, a);
  const track = tracks.find((t) => t.id === a.section);
  return {
    id: a.id,
    slug: a.slug,
    title: a.title,
    short: a.short || a.title.slice(0, 4),
    blurb: a.blurb || '',
    section: a.section,
    sectionName: track ? track.name : a.section,
    sub: a.sub || '',
    date: a.date,
    min: a.min || 3,
    url: urlFor('post', a.slug),
    x: note ? note.x : 0,
    w: note ? note.w : 12,
    pitch: note ? note.pitch : '·',
  };
}

/* 轨道里的一条文章记录（原生的那批没有 runtime 标记）→ 前端用的瘦身版。
   字段与 articleBrief 对齐，前端才能用同一套代码处理两种文章。 */
export function postBrief(track: any, post: any) {
  const brief: any = {
    id: post.id || post.slug,
    slug: post.slug,
    title: post.title,
    short: post.short || String(post.title || '').slice(0, 4),
    blurb: post.blurb || '',
    date: post.date,
    min: post.min || 3,
    sub: post.sub || '',
    section: track.id,
    sectionName: track.name,
    runtime: Boolean(post.runtime),
    url: urlFor('post', post.slug),
  };
  /* 正文被「页面上直接改」过的（post.edited）也捎上——静态页靠它回填 */
  if (post.edited) brief.body = post.edited;
  return brief;
}

/* 每条轨道「一共几篇」（原生 + 运行时）、最近两篇的标题（首页索引那行） */
export function sectionStats(tracks: any[]) {
  const map = new Map();
  for (const t of tracks) {
    const posts = (t.posts || []).slice().sort((a: any, b: any) => (a.date < b.date ? 1 : -1));
    map.set(t.id, {
      count: posts.length,
      recent: posts.slice(0, 2).map((p: any) => ({ title: p.title, url: urlFor('post', p.slug) })),
    });
  }
  return map;
}

/* 被撤下的东西，列出来给前端（也留着以后做「恢复」界面）。
   注意板块那半边读的是**全量** sections：撤下的记录本来就在里面。 */
export function hiddenList() {
  const goneSections = getSections()
    .filter((s) => hiddenIn(getOverrides().sections, s.id))
    .map((s) => ({ id: s.id, name: s.name, pitch: s.pitch }));
  const gonePosts: any[] = [];
  for (const t of allPosts()) {
    for (const p of t.posts || []) {
      if (hiddenIn(getOverrides().posts, p.slug)) {
        gonePosts.push({ slug: p.slug, title: p.title, section: t.id, sectionName: t.name });
      }
    }
  }
  return { sections: goneSections, posts: gonePosts };
}

/* 一条原生文章（按 slug 或 id 找）。撤下的也找得到——恢复要用 */
export function findPost(key: string) {
  for (const t of allPosts()) {
    for (const p of t.posts || []) {
      if (p.runtime) continue;
      if (p.slug === key || p.id === key) return { track: t, post: p };
    }
  }
  return null;
}

/* 覆盖层压过之后的样子——改完正文回去要回它 */
export function findPostNow(key: string) {
  for (const t of tracksNow()) {
    for (const p of t.posts || []) {
      if (p.runtime) continue;
      if (p.slug === key || p.id === key) return { track: t, post: p };
    }
  }
  return null;
}

/* 单篇文章的完整形状（比 brief 多出正文源与附件清单） */
export function articleDetail(tracks: any[], a: any) {
  return { ...articleBrief(tracks, a), source: a.source || '', assets: a.assets || [], at: a.at };
}

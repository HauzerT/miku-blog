/* ==========================================================================
   server/utils/store.ts · 数据层（Nuxt 这一侧）
   ---------------------------------------------------------------------------
   上传的内容全部落在 data/ 下的几个 JSON 里，媒体文件落在 media/ 下：
     data/sections.json  板块与子板块（第一次启动时从 content/posts.mjs 播种）
     data/articles.json  用编辑页写的文章（正文、元信息、附件清单）
     data/music.json     音乐盒曲目
     data/settings.json  口令、门厅开关、音量、循环
     data/overrides.json 站长对「原生内容」做的撤下与改名（源文件不动）

   与旧 store.mjs 的差别只有一处，但是关键的一处：**目录从哪来**。
   旧模块用 import.meta.url 推仓库根，打包之后那条路是错的（见 paths.ts），
   所以这里不 import 它，把那份逻辑照抄过来、ROOT 换成 paths.ts 的那个。

   状态模型照旧：五个文件在第一次用到时读一次，之后常驻内存；
   写的时候整份重写。写文件仍然走「临时文件 + rename」——
   中途断电不会留下半个 JSON。

   顺带：写盘之后要让 server/utils/content.ts 的页面装配结果作废，
   不然「新建一个板块」得等到下一次 mtime 变化才在页面上看得见。
   ========================================================================== */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { tracks as seedTracks } from '#content/posts.mjs';
import { DATA, MEDIA, MEDIA_DIRS, ROOT } from './paths';
import { invalidateContent } from './content';

/* ------------------------------------------------------------------ 读写 */

export function readJson(file: string, fallback: any): any {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err: any) {
    console.warn(`[store] ${file} 解析失败，用默认值顶上：${err.message}`);
    return fallback;
  }
}

export function writeJson(file: string, value: any): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  renameSync(tmp, file);
  invalidateContent();
}

export const id = (prefix = '') => prefix + randomBytes(6).toString('hex');

/* 新建板块 / 子板块的网址片段。
   名字里只有 ASCII 就顺手做成可读的（dark-kitchen），
   中文名做不出有意义的拼音，就用随机短码——反正真正的标识是音高。 */
export function slugify(name: unknown): string {
  const ascii = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return ascii && /[a-z]/.test(ascii) ? ascii : `s_${randomBytes(4).toString('hex')}`;
}

export const extOf = (name: unknown): string => {
  const i = String(name).lastIndexOf('.');
  return i === -1 ? '' : String(name).slice(i).toLowerCase();
};

/* ------------------------------------------------------------------ 音高
   新板块要从「还在空着的音」里挑一个，才接得上卷帘那套语法。
   优先用升降号之外的自然音；不够了就下沉到下一个八度。 */
const NATURAL = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const PITCH_RE = /^([A-G])(#?)(-?\d)$/;

export function pitchValue(pitch: unknown): number {
  const m = PITCH_RE.exec(String(pitch || ''));
  if (!m) return 0;
  const semitone = ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 } as Record<string, number>)[m[1]] + (m[2] ? 1 : 0);
  return (Number(m[3]) + 1) * 12 + semitone;
}

export function pitchName(value: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(value / 12) - 1;
  return names[((value % 12) + 12) % 12] + octave;
}

/* 高音在上：轨道栏、首页索引、卷帘都按这个顺序排 */
export function sortByPitch<T extends { pitch?: unknown }>(list: T[]): T[] {
  return list.slice().sort((a, b) => pitchValue(b.pitch) - pitchValue(a.pitch));
}

export function suggestPitch(sections: Array<{ pitch?: unknown }>): string {
  const taken = new Set(sections.map((s) => s.pitch));
  const values = sections.map((s) => pitchValue(s.pitch)).filter(Boolean);
  const top = values.length ? Math.max(...values) : 81; // A5
  const bottom = values.length ? Math.min(...values) : 54; // F#3

  /* 先往高处找一个没被占的音，让新板块落在「轻」的那一头 */
  for (let v = top + 1; v <= top + 24; v++) {
    const name = pitchName(v);
    if (!taken.has(name) && NATURAL.includes(name.replace(/-?\d$/, ''))) return name;
  }
  /* 再往下找 */
  for (let v = bottom - 1; v >= bottom - 24; v--) {
    const name = pitchName(v);
    if (!taken.has(name) && NATURAL.includes(name.replace(/-?\d$/, ''))) return name;
  }
  /* 真的满了：随便往高处顺延一个 */
  return `${NATURAL[sections.length % NATURAL.length]}${Math.floor(top / 12)}`;
}

/* ------------------------------------------------------------------ 文件位置 */

const SECTIONS_FILE = join(DATA, 'sections.json');
const ARTICLES_FILE = join(DATA, 'articles.json');
const MUSIC_FILE = join(DATA, 'music.json');
const SETTINGS_FILE = join(DATA, 'settings.json');
const OVERRIDES_FILE = join(DATA, 'overrides.json');

export const AUDIO_EXTS = new Set(['.mp3', '.m4a', '.mp4', '.aac', '.wav', '.ogg', '.oga', '.opus', '.flac', '.webm']);

/* 扫 media/music/ 目录：手工拖进去的文件也要能被音乐盒看见。
   不 import 旧 store.mjs，但这一条的规矩原样照抄（AUDIO_EXTS 也一样）。 */
export function scanMusicDir(): Array<{ file: string; title: string }> {
  if (!existsSync(MEDIA_DIRS.music)) return [];
  return readdirSync(MEDIA_DIRS.music)
    .filter((name) => AUDIO_EXTS.has(extOf(name)))
    .map((name) => ({ file: name, title: name.replace(/\.[^.]+$/, '') }));
}

/* ------------------------------------------------------------------ 板块 */

export function seedSections(seeds: any[]): any[] {
  return seeds.map((t, i) => ({
    id: t.id,
    pitch: t.pitch,
    black: Boolean(t.black),
    name: t.name,
    def: t.def,
    lede: t.lede,
    order: i,
    seed: true, // 来自 content/posts.mjs：那批文章只撤下、不删除，源文件不动
    subs: [],
  }));
}

export function loadSections(seeds: any[]): any[] {
  const raw = readJson(SECTIONS_FILE, null);
  if (!raw) {
    const seeded = seedSections(seeds);
    writeJson(SECTIONS_FILE, seeded);
    return seeded;
  }
  /* 允许用户删掉某一行；同时把 posts.mjs 里新增的轨道补进来 */
  const list = Array.isArray(raw) ? raw.slice() : [];
  for (const t of seedSections(seeds)) {
    if (!list.some((s) => s.id === t.id)) list.push(t);
  }
  return list
    .map((s, i) => ({ order: i, subs: [], black: false, ...s }))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/* ------------------------------------------------------------------ 覆盖层 */

export function loadOverrides(): any {
  const raw = readJson(OVERRIDES_FILE, null);
  const out: any = { sections: {}, posts: {} };
  if (raw && typeof raw === 'object') {
    if (raw.sections && typeof raw.sections === 'object') out.sections = raw.sections;
    if (raw.posts && typeof raw.posts === 'object') out.posts = raw.posts;
  }
  return out;
}

export function saveOverrides(value: any): void {
  writeJson(OVERRIDES_FILE, {
    sections: (value && value.sections) || {},
    posts: (value && value.posts) || {},
  });
}

/* 覆盖层里那个「撤下」位：没有记录 / 空记录都算没撤下 */
export const hiddenIn = (map: any, key: string): boolean => Boolean(map && map[key] && map[key].hidden);

/* ------------------------------------------------------------------ 口令生成
   口令是**首次启动随机生成**的。原来那版是 randomBytes(4).toString('hex')：8 位十六
   进制 = 32 bit 熵，本机跑够用，挂到公网上就不够了。这里是 32 个字符、约 186 bit。

   口令里不放 l/1/I/0/O 这种会看错的字符（它要被人从终端抄到另一个窗口里），
   字母数字混排，从随机字节里取模——下面的拒绝采样保证不会因为取模而偏向前面几个字符。 */
const PP_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PP_LENGTH = 32;

export function generatePassphrase(length = PP_LENGTH): string {
  const limit = 256 - (256 % PP_ALPHABET.length); // 拒绝采样：超出这条线的字节丢掉
  let out = '';
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte >= limit) continue;
      out += PP_ALPHABET[byte % PP_ALPHABET.length];
      if (out.length === length) break;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ 常驻状态
   旧服务是在 listen 之前一次性 load 完的（ensureStartup）。Nitro 这边没有那个
   「启动那一刻」——模块第一次被用到就是启动。于是做成懒的：第一个请求进来时
   做同一套事（建目录、没有口令就生成一条、播种 sections、认领 media/music/）。 */

export interface StoreState {
  settings: any;
  sections: any[];
  articles: any[];
  music: any;
  overrides: any;
}

let state: StoreState | null = null;

function boot(): StoreState {
  if (state) return state;

  for (const dir of [DATA, MEDIA, ...Object.values(MEDIA_DIRS)]) mkdirSync(dir, { recursive: true });

  const settings = { passphrase: '', createdAt: null, ...readJson(SETTINGS_FILE, {}) };
  if (!settings.passphrase) {
    settings.passphrase = generatePassphrase();
    settings.createdAt = new Date().toISOString();
    writeJson(SETTINGS_FILE, settings);
    /* 口令只打印一次在这里：与旧服务一样，它是从终端抄到浏览器里的 */
    console.log(`\n  上传口令  ${settings.passphrase}\n`);
  }

  const sections = loadSections(seedTracks);
  /* 把播种结果落盘，站长可以直接编辑 data/sections.json */
  writeJson(SECTIONS_FILE, sections);

  state = {
    settings,
    sections,
    articles: (() => {
      const raw = readJson(ARTICLES_FILE, []);
      return Array.isArray(raw) ? raw : [];
    })(),
    music: readJson(MUSIC_FILE, { tracks: [], settings: { volume: 0.6, loop: true, autoplay: true } }),
    overrides: loadOverrides(),
  };

  /* 这一步必须在 state 落定之后：syncMusicDir() 自己也要读状态 */
  const picked = syncMusicDir();
  if (picked) console.log(`[音乐] 从 media/music/ 认领了 ${picked} 个文件`);
  return state;
}

export const getSettings = () => boot().settings;
export const getSections = () => boot().sections;
export const getArticles = () => boot().articles;
export const getMusic = () => boot().music;
export const getOverrides = () => boot().overrides;

/* 删板块要连带着删它名下的文章，那是整份换掉，所以留一个 setter */
export function setArticles(list: any[]): void {
  boot().articles = list;
}

export const saveSections = (list: any[]) => writeJson(SECTIONS_FILE, list);
export const saveArticles = (list: any[]) => writeJson(ARTICLES_FILE, list);
export const saveMusic = (value: any) => writeJson(MUSIC_FILE, value);
export const saveSettings = (value: any) => writeJson(SETTINGS_FILE, value);

export const findSection = (list: any[], sectionId: string) =>
  (list || []).find((s) => s.id === sectionId) || null;

export const findSub = (section: any, subId: string) =>
  !section || !subId ? null : (section.subs || []).find((s: any) => s.id === subId) || null;

/* media/music/ 里手工丢进去的文件也要出现在列表里（启动时认领一次） */
export function syncMusicDir(): number {
  const st = boot();
  const known = new Set(st.music.tracks.map((t: any) => t.file));
  let added = 0;
  for (const found of scanMusicDir()) {
    if (known.has(found.file)) continue;
    st.music.tracks.push({
      id: id('m_'),
      title: found.title,
      file: found.file,
      url: `/media/music/${found.file}`,
      size: 0,
      at: new Date().toISOString(),
      source: 'dir',
    });
    added++;
  }
  if (added) saveMusic(st.music);
  return added;
}

/* 覆盖层里记一笔，然后落盘。空值（''/null/false）等于「把这一项删掉」——
   于是「恢复原样」和「根本没改过」在文件里是同一件事。 */
export function writeOverride(kind: 'sections' | 'posts', key: string, patch: any): void {
  const st = boot();
  const bag = st.overrides[kind] || (st.overrides[kind] = {});
  const next = { ...(bag[key] || {}), ...patch };
  const clean: any = {};
  for (const [k, v] of Object.entries(next)) {
    if (v === '' || v === null || v === undefined || v === false) continue;
    clean[k] = v;
  }
  if (Object.keys(clean).length) bag[key] = clean;
  else delete bag[key];
  saveOverrides(st.overrides);
}

/* 地址片段要唯一，也不能撞上生成器写出来的那些 posts/<slug>.html
   （静态文件会盖住动态页——新路由下这个坑还在，所以这条检查留着） */
export function uniqueSlug(want: string, selfId = ''): string {
  const list = getArticles();
  const base = slugify(want || '');
  let slug = base;
  let n = 2;
  while (
    list.some((a) => a.slug === slug && a.id !== selfId) ||
    existsSync(join(ROOT, 'posts', `${slug}.html`))
  ) {
    slug = `${base}-${n++}`;
  }
  return slug;
}

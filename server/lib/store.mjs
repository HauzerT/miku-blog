/* ==========================================================================
   server/lib/store.mjs · 数据层
   ---------------------------------------------------------------------------
   上传的内容全部落在 data/ 下的几个 JSON 里，媒体文件落在 media/ 下：
     data/sections.json  板块与子板块（第一次启动时从 content/posts.mjs 播种）
     data/articles.json  用编辑页写的文章（正文、元信息、附件清单）
     data/music.json     音乐盒曲目
     data/settings.json  音量、循环、是否新建板块时自动分配音高
   写文件用「临时文件 + rename」，中途断电不会写出半个 JSON。
   ========================================================================== */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DATA = join(ROOT, 'data');
export const MEDIA = join(ROOT, 'media');

export const MEDIA_DIRS = {
  images: join(MEDIA, 'images'),
  videos: join(MEDIA, 'videos'),
  music: join(MEDIA, 'music'),
};

export function ensureDirs() {
  for (const dir of [DATA, MEDIA, ...Object.values(MEDIA_DIRS)]) mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    console.warn(`[store] ${file} 解析失败，用默认值顶上：${err.message}`);
    return fallback;
  }
}

function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  renameSync(tmp, file);
}

export const id = (prefix = '') => prefix + randomBytes(6).toString('hex');

/* ------------------------------------------------------------------ 音高
   新板块要从「还在空着的音」里挑一个，才接得上卷帘那套语法。
   优先用升降号之外的自然音；不够了就下沉到下一个八度。 */
const NATURAL = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const PITCH_RE = /^([A-G])(#?)(-?\d)$/;

export function pitchValue(pitch) {
  const m = PITCH_RE.exec(String(pitch || ''));
  if (!m) return 0;
  const semitone = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] ? 1 : 0);
  return (Number(m[3]) + 1) * 12 + semitone;
}

export function pitchName(value) {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(value / 12) - 1;
  return names[((value % 12) + 12) % 12] + octave;
}

/* 高音在上：轨道栏、首页索引、卷帘都按这个顺序排 */
export function sortByPitch(list) {
  return list.slice().sort((a, b) => pitchValue(b.pitch) - pitchValue(a.pitch));
}

export function suggestPitch(sections) {
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

/* ------------------------------------------------------------------ 板块 */
const SEED_FILE = join(DATA, 'sections.json');

export function seedSections(seedTracks) {
  return seedTracks.map((t, i) => ({
    id: t.id,
    pitch: t.pitch,
    black: Boolean(t.black),
    name: t.name,
    def: t.def,
    lede: t.lede,
    order: i,
    seed: true, // 来自 content/posts.mjs：文章仍由 tools/build.mjs 管
    subs: [],
  }));
}

export function loadSections(seedTracks) {
  const raw = readJson(SEED_FILE, null);
  if (!raw) {
    const seeded = seedSections(seedTracks);
    writeJson(SEED_FILE, seeded);
    return seeded;
  }
  /* 允许用户删掉某一行；同时把 posts.mjs 里新增的轨道补进来 */
  const list = Array.isArray(raw) ? raw.slice() : [];
  for (const t of seedSections(seedTracks)) {
    if (!list.some((s) => s.id === t.id)) list.push(t);
  }
  return list
    .map((s, i) => ({ order: i, subs: [], black: false, ...s }))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function saveSections(sections) {
  writeJson(SEED_FILE, sections);
}

export function findSection(sections, sectionId) {
  return sections.find((s) => s.id === sectionId) || null;
}

export function findSub(section, subId) {
  if (!section || !subId) return null;
  return (section.subs || []).find((s) => s.id === subId) || null;
}

/* ------------------------------------------------------------------ 文章
   用编辑页写出来的文章。和 content/posts.mjs 那批不是一回事：
   那批是「源头」，由 tools/build.mjs 生成静态页；这批只在服务里活着，
   页面由服务运行时渲染，前端再把它并进板块页 / 归档 / 首页索引与卷帘。 */
const ARTICLES_FILE = join(DATA, 'articles.json');

export function loadArticles() {
  const raw = readJson(ARTICLES_FILE, []);
  return Array.isArray(raw) ? raw : [];
}

export function saveArticles(list) {
  writeJson(ARTICLES_FILE, list);
}

/* ------------------------------------------------------------------ 覆盖层
   原生内容（content/posts.mjs 里的九个板块与那批静态文章）由 tools/build.mjs
   生成 HTML，**服务不许改那个源文件**。所以站长的右键菜单对它们做的是「撤下」：
   记录落在这里，源文件一个字节不动，删掉其中一条就等于恢复。

     data/overrides.json
       { "sections": { "<板块 id>": { "hidden": true } },
         "posts":    { "<文章 slug>": { "title": "改过的标题", "hidden": true } } }

   板块改名不走这里（那是 data/sections.json 里的一行，PATCH 已经能改）；
   运行时的板块与文章也不走这里——它们是真正存在 data/ 里的东西，直接删真的删。 */
const OVERRIDES_FILE = join(DATA, 'overrides.json');

export function loadOverrides() {
  const raw = readJson(OVERRIDES_FILE, null);
  const out = { sections: {}, posts: {} };
  if (raw && typeof raw === 'object') {
    if (raw.sections && typeof raw.sections === 'object') out.sections = raw.sections;
    if (raw.posts && typeof raw.posts === 'object') out.posts = raw.posts;
  }
  return out;
}

export function saveOverrides(value) {
  writeJson(OVERRIDES_FILE, {
    sections: (value && value.sections) || {},
    posts: (value && value.posts) || {},
  });
}

/* 覆盖层里那个「撤下」位：没有记录 / 空记录都算没撤下 */
export function hiddenIn(map, key) {
  return Boolean(map && map[key] && map[key].hidden);
}

/* ------------------------------------------------------------------ 音乐 */
const MUSIC_FILE = join(DATA, 'music.json');

export function loadMusic() {
  return readJson(MUSIC_FILE, { tracks: [], settings: { volume: 0.6, loop: true, autoplay: true } });
}

export function saveMusic(value) {
  writeJson(MUSIC_FILE, value);
}

export const AUDIO_EXTS = new Set(['.mp3', '.m4a', '.mp4', '.aac', '.wav', '.ogg', '.oga', '.opus', '.flac', '.webm']);

/* 扫 media/music/ 目录：手工拖进去的文件也要能被音乐盒看见 */
export function scanMusicDir() {
  if (!existsSync(MEDIA_DIRS.music)) return [];
  return readdirSync(MEDIA_DIRS.music)
    .filter((name) => AUDIO_EXTS.has(extOf(name)))
    .map((name) => ({ file: name, title: name.replace(/\.[^.]+$/, '') }));
}

export function extOf(name) {
  const i = String(name).lastIndexOf('.');
  return i === -1 ? '' : String(name).slice(i).toLowerCase();
}

/* ------------------------------------------------------------------ 设置 */
const SETTINGS_FILE = join(DATA, 'settings.json');
const DEFAULT_SETTINGS = { passphrase: '', createdAt: null };

export function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...readJson(SETTINGS_FILE, {}) };
}

export function saveSettings(value) {
  writeJson(SETTINGS_FILE, value);
}

export { readJson, writeJson };

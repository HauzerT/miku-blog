/* ==========================================================================
   server/server.mjs · 上传服务
   ---------------------------------------------------------------------------
   零依赖：只用 node: 内置模块。跑起来之后：
     http://127.0.0.1:4321/            原来的静态博客（一字未改地服务出来）
     /media/music/…                    上传的音乐
     /api/…                            上传与新建板块用的接口

   口令：第一次启动会在终端打印一串口令，也写在 data/settings.json 里。
   前端第一次上传时要求输入，之后记在这个浏览器里（localStorage）。
   用法：node server/server.mjs [端口]
   ========================================================================== */

import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, extname, normalize, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { URL } from 'node:url';

import {
  ROOT,
  DATA,
  MEDIA_DIRS,
  loadSections,
  saveSections,
  findSection,
  findSub,
  loadArticles,
  saveArticles,
  loadMusic,
  saveMusic,
  scanMusicDir,
  loadSettings,
  saveSettings,
  suggestPitch,
  sortByPitch,
  extOf,
  id as newId,
} from './lib/store.mjs';
import { parseMultipart, DEFAULT_LIMIT } from './lib/multipart.js';
import { saveUpload, UploadError, kindOf, KIND_LABEL } from './lib/media.js';
import { seedTracks } from './lib/shell.mjs';
import { dynamicSectionPage, dynamicSubPage } from './lib/pages.mjs';
import { articlePage, articleBrief, mergeTracks, renderBody, sectionStats } from './lib/articles.mjs';

const PORT = Number(process.argv[2] || process.env.PORT || 4321);
const HOST = '127.0.0.1';
const MAX_BODY = DEFAULT_LIMIT;

/* 站点根目录下不允许被静态服务读出来的东西：服务端源码和原始数据 */
const HIDDEN = new Set(['server', 'data', '.git', 'node_modules', 'tools', 'content']);

/* ------------------------------------------------------------------ 小工具 */

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/opus',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

function sendJson(res, status, value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
  });
  res.end(body);
}

function sendText(res, status, text) {
  const body = Buffer.from(text, 'utf8');
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': body.length,
  });
  res.end(body);
}

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const tooBig = () => {
      const err = new HttpError(413, `上传内容超过 ${Math.round(limit / 1048576)}MB，先在本地压一下再传`);
      req.destroy();
      reject(err);
    };
    const declared = Number(req.headers['content-length'] || 0);
    if (declared && declared > limit) return tooBig();

    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) return tooBig();
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readForm(req) {
  const body = await readBody(req);
  if (!body.length) return { fields: {}, files: [] };
  const type = req.headers['content-type'] || '';
  if (!/multipart\/form-data/i.test(type)) throw new HttpError(400, '需要 multipart/form-data');
  return parseMultipart(body, type, { limit: MAX_BODY });
}

/* 路径安全：任何解析出来的路径都必须还在白名单目录里。
   注意调用方已经把 pathname 解码过一次了，这里不能再 decode 一遍——
   否则中文文件名（%E6%B5%8B...）会被解成乱码，文件明明在却取不到。 */
function safePath(rootDir, relative) {
  const clean = String(relative).replace(/\\/g, '/').replace(/^\/+/, '');
  const full = normalize(join(rootDir, clean));
  if (!full.startsWith(normalize(rootDir) + sep) && full !== normalize(rootDir)) return null;
  return full;
}

/* 新建板块 / 子板块的网址片段。
   名字里只有 ASCII 就顺手做成可读的（dark-kitchen），
   中文名做不出有意义的拼音，就用随机短码——反正真正的标识是音高。 */
function slugify(name) {
  const ascii = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return ascii && /[a-z]/.test(ascii) ? ascii : `s_${randomBytes(4).toString('hex')}`;
}

/* ------------------------------------------------------------------ 状态 */

const settings = loadSettings();
let sections = loadSections(seedTracks);
let articles = loadArticles();
let music = loadMusic();

/* 九条原生轨道 + 运行时新建的板块 + 运行时文章，合成一份（卷帘位置、相邻文章都靠它） */
function tracksNow() {
  return mergeTracks(seedTracks, sections, articles);
}

/* 文章：日期、地址片段、附件清单的归一化 */
function today() {
  const n = new Date();
  return `${n.getFullYear()}.${String(n.getMonth() + 1).padStart(2, '0')}.${String(n.getDate()).padStart(2, '0')}`;
}

function normalizeDate(value) {
  const s = String(value || '').trim();
  if (/^\d{4}\.\d{1,2}\.\d{1,2}$/.test(s)) {
    const [y, m, d] = s.split('.');
    return `${y}.${m.padStart(2, '0')}.${d.padStart(2, '0')}`;
  }
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) {
    const [y, m, d] = s.split('-');
    return `${y}.${m.padStart(2, '0')}.${d.padStart(2, '0')}`;
  }
  return today();
}

/* 地址片段要唯一，也不能撞上生成器写出来的那些 posts/<slug>.html（静态文件会盖住动态页） */
function uniqueSlug(want, selfId = '') {
  const base = slugify(want || '');
  let slug = base;
  let n = 2;
  while (
    articles.some((a) => a.slug === slug && a.id !== selfId) ||
    existsSync(join(ROOT, 'posts', `${slug}.html`))
  ) {
    slug = `${base}-${n++}`;
  }
  return slug;
}

function cleanAssets(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 80).map((a) => ({
    kind: ['image', 'video', 'audio'].includes(a && a.kind) ? a.kind : 'image',
    bucket: ['images', 'videos', 'music'].includes(a && a.bucket) ? a.bucket : 'images',
    file: String((a && a.file) || '').slice(0, 160),
    url: String((a && a.url) || '').slice(0, 300),
    original: String((a && a.original) || '').slice(0, 200),
    size: Number((a && a.size) || 0),
    type: String((a && a.type) || '').slice(0, 80),
  })).filter((a) => a.file && a.url);
}

function articleDetail(tracks, a) {
  return { ...articleBrief(tracks, a), source: a.source || '', assets: a.assets || [], at: a.at };
}

function removeMedia(bucket, file) {
  const dir = MEDIA_DIRS[bucket];
  if (!dir || !file) return;
  const full = safePath(dir, file);
  if (full && existsSync(full)) {
    try { rmSync(full); } catch { /* 文件被占用就留着，不影响数据 */ }
  }
}

/* ------------------------------------------------------------------ 口令 */

function keyOf(req, url) {
  const header = req.headers['x-cv01-key'];
  if (header) return String(header);
  const auth = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (m) return m[1];
  return url.searchParams.get('key') || '';
}

function requireAuth(req, url) {
  if (!settings.passphrase) throw new HttpError(403, '这台机器上还没有口令，请看启动服务的那个终端窗口');
  if (keyOf(req, url) !== settings.passphrase) throw new HttpError(401, '口令不对');
}

/* ------------------------------------------------------------------ 音乐 */

/* media/music/ 里手工丢进去的文件也要出现在列表里 */
function syncMusicDir() {
  const known = new Set(music.tracks.map((t) => t.file));
  let added = 0;
  for (const found of scanMusicDir()) {
    if (known.has(found.file)) continue;
    music.tracks.push({
      id: newId('m_'),
      title: found.title,
      file: found.file,
      url: `/media/music/${found.file}`,
      size: 0,
      at: new Date().toISOString(),
      source: 'dir',
    });
    added++;
  }
  if (added) saveMusic(music);
  return added;
}

/* ------------------------------------------------------------------ 接口 */

async function api(req, res, url) {
  const path = url.pathname.replace(/\/+$/, '') || '/api';
  const method = req.method.toUpperCase();

  /* --- 健康检查 / 口令状态（不需要口令） --- */
  if (path === '/api/health' && method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      hasPassphrase: Boolean(settings.passphrase),
      sections: sections.length,
      music: music.tracks.length,
      version: 1,
    });
  }
  if (path === '/api/auth' && method === 'POST') {
    const key = keyOf(req, url) || '';
    if (!settings.passphrase) throw new HttpError(403, '还没有设置口令：请重启一次服务，终端会打印口令');
    if (key !== settings.passphrase) throw new HttpError(401, '口令不对，再看一眼启动服务的终端');
    return sendJson(res, 200, { ok: true });
  }

  /* --- 公开读取：板块树（含运行时文章）/ 文章 / 音乐列表 --- */
  if (path === '/api/sections' && method === 'GET') {
    const tracks = tracksNow();
    const stats = sectionStats(tracks);
    const briefs = articles.map((a) => articleBrief(tracks, a));
    return sendJson(res, 200, {
      sections: sortByPitch(sections).map((s) => {
        const st = stats.get(s.id) || { count: 0, recent: [] };
        return {
          id: s.id,
          name: s.name,
          pitch: s.pitch,
          black: Boolean(s.black),
          seed: Boolean(s.seed),
          def: s.def || '',
          subs: (s.subs || []).map((x) => ({ id: x.id, name: x.name, def: x.def || '' })),
          articles: st.count,
          recent: st.recent,
          runtime: briefs.filter((b) => b.section === s.id),
        };
      }),
      articles: {
        total: tracks.reduce((n, t) => n + (t.posts || []).length, 0),
        runtime: articles.length,
      },
      suggestPitch: suggestPitch(sections),
    });
  }

  if (path === '/api/articles' && method === 'GET') {
    const tracks = tracksNow();
    return sendJson(res, 200, {
      articles: articles
        .slice()
        .sort((a, b) => (a.at < b.at ? 1 : -1))
        .map((a) => ({ ...articleBrief(tracks, a), at: a.at, assets: (a.assets || []).length })),
    });
  }

  const articleMatch = /^\/api\/articles\/([\w-]+)$/.exec(path);
  if (articleMatch && method === 'GET') {
    const article = articles.find((a) => a.id === articleMatch[1] || a.slug === articleMatch[1]);
    if (!article) throw new HttpError(404, '没有这篇文章');
    return sendJson(res, 200, { article: articleDetail(tracksNow(), article) });
  }

  /* 正文预览：编辑器要一边写一边看渲染结果，所以这一个不需要口令 */
  if (path === '/api/render' && method === 'POST') {
    const body = JSON.parse((await readBody(req, 1 << 20)).toString('utf8') || '{}');
    return sendJson(res, 200, { ok: true, html: renderBody(String(body.source || '')) });
  }

  if (path === '/api/music' && method === 'GET') {
    return sendJson(res, 200, {
      tracks: music.tracks.map((t) => ({
        id: t.id,
        title: t.title,
        artist: t.artist || '',
        url: t.url,
        file: t.file,
        size: t.size || 0,
        at: t.at || '',
      })),
      settings: {
        volume: typeof music.settings?.volume === 'number' ? music.settings.volume : 0.6,
        loop: music.settings?.loop !== false,
        autoplay: music.settings?.autoplay !== false,
      },
    });
  }

  /* --- 以下都要口令 --- */
  requireAuth(req, url);

  /* 音乐：上传、改名、删除 */
  if (path === '/api/music' && method === 'POST') {
    const form = await readForm(req);
    if (!form.files.length) throw new HttpError(400, '没有收到音频文件');
    const added = [];
    for (const file of form.files) {
      if (kindOf(file) !== 'audio') throw new UploadError(`${file.filename} 不是音频（支持 mp3 / m4a / wav / ogg / flac）`);
      const saved = saveUpload(file, 'audio');
      const entry = {
        id: newId('m_'),
        title: (form.fields.title || saved.original.replace(/\.[^.]+$/, '')).slice(0, 120),
        artist: (form.fields.artist || '').slice(0, 60),
        file: saved.file,
        url: saved.url,
        size: saved.size,
        type: saved.type,
        at: new Date().toISOString(),
        source: 'upload',
      };
      music.tracks.push(entry);
      added.push(entry);
    }
    saveMusic(music);
    return sendJson(res, 201, { ok: true, added: added.length, tracks: added });
  }

  const musicMatch = /^\/api\/music\/([\w-]+)$/.exec(path);
  if (musicMatch && method === 'PATCH') {
    const entry = music.tracks.find((t) => t.id === musicMatch[1]);
    if (!entry) throw new HttpError(404, '没有这首曲子');
    const body = JSON.parse((await readBody(req, 65536)).toString('utf8') || '{}');
    if (typeof body.title === 'string') entry.title = body.title.slice(0, 120);
    if (typeof body.artist === 'string') entry.artist = body.artist.slice(0, 60);
    saveMusic(music);
    return sendJson(res, 200, { ok: true, track: entry });
  }
  if (musicMatch && method === 'DELETE') {
    const i = music.tracks.findIndex((t) => t.id === musicMatch[1]);
    if (i === -1) throw new HttpError(404, '没有这首曲子');
    const [entry] = music.tracks.splice(i, 1);
    removeMedia('music', entry.file);
    saveMusic(music);
    return sendJson(res, 200, { ok: true });
  }

  if (path === '/api/music/settings' && method === 'PATCH') {
    const body = JSON.parse((await readBody(req, 65536)).toString('utf8') || '{}');
    music.settings = {
      volume: typeof body.volume === 'number' ? Math.min(1, Math.max(0, body.volume)) : music.settings?.volume ?? 0.6,
      loop: typeof body.loop === 'boolean' ? body.loop : music.settings?.loop !== false,
      autoplay: typeof body.autoplay === 'boolean' ? body.autoplay : music.settings?.autoplay !== false,
    };
    saveMusic(music);
    return sendJson(res, 200, { ok: true, settings: music.settings });
  }

  /* 媒体上传：编辑页插图片 / 视频 / 音乐都走这里 */
  if (path === '/api/media' && method === 'POST') {
    const form = await readForm(req);
    if (!form.files.length) throw new HttpError(400, '没有收到文件');
    const wanted = (form.fields.kind || '').trim();
    const files = form.files.map((file) => {
      const asset = saveUpload(file, wanted || undefined);
      return { ...asset, label: KIND_LABEL[asset.kind] || asset.kind };
    });
    return sendJson(res, 201, { ok: true, files });
  }

  /* 文章：新建 / 改 / 删。存 data/articles.json，页面由服务运行时渲染。 */
  if (path === '/api/articles' && method === 'POST') {
    const body = JSON.parse((await readBody(req, 1 << 20)).toString('utf8') || '{}');
    const title = String(body.title || '').trim();
    if (!title) throw new HttpError(400, '文章得有个标题');
    const section = findSection(sections, String(body.section || '').trim());
    if (!section) throw new HttpError(400, '先选一个板块');
    const sub = body.sub ? findSub(section, String(body.sub)) : null;
    if (body.sub && !sub) throw new HttpError(400, '这个子板块不存在了');

    const article = {
      id: newId('a_'),
      slug: uniqueSlug(String(body.slug || '').trim() || title),
      title: title.slice(0, 120),
      section: section.id,
      sub: sub ? sub.id : '',
      date: normalizeDate(body.date),
      min: Math.min(120, Math.max(1, Number(body.min) || 3)),
      short: String(body.short || '').trim().slice(0, 6) || title.slice(0, 4),
      blurb: String(body.blurb || '').trim().slice(0, 140),
      source: String(body.source || '').slice(0, 200000),
      assets: cleanAssets(body.assets),
      at: new Date().toISOString(),
    };
    articles.push(article);
    saveArticles(articles);
    return sendJson(res, 201, { ok: true, article: articleDetail(tracksNow(), article) });
  }

  if (articleMatch && method === 'PATCH') {
    const article = articles.find((a) => a.id === articleMatch[1] || a.slug === articleMatch[1]);
    if (!article) throw new HttpError(404, '没有这篇文章');
    const body = JSON.parse((await readBody(req, 1 << 20)).toString('utf8') || '{}');

    if (typeof body.title === 'string' && body.title.trim()) article.title = body.title.trim().slice(0, 120);
    if (typeof body.section === 'string' && body.section.trim()) {
      const section = findSection(sections, body.section.trim());
      if (!section) throw new HttpError(400, '没有这个板块');
      article.section = section.id;
      if (article.sub && !findSub(section, article.sub)) article.sub = '';
    }
    if ('sub' in body) {
      const section = findSection(sections, article.section);
      const sub = body.sub ? findSub(section, String(body.sub)) : null;
      if (body.sub && !sub) throw new HttpError(400, '这个子板块不存在了');
      article.sub = sub ? sub.id : '';
    }
    if ('date' in body) article.date = normalizeDate(body.date);
    if ('min' in body) article.min = Math.min(120, Math.max(1, Number(body.min) || 3));
    if (typeof body.short === 'string') article.short = body.short.trim().slice(0, 6) || article.title.slice(0, 4);
    if (typeof body.blurb === 'string') article.blurb = body.blurb.trim().slice(0, 140);
    if (typeof body.source === 'string') article.source = body.source.slice(0, 200000);
    if ('assets' in body) article.assets = cleanAssets(body.assets);

    saveArticles(articles);
    return sendJson(res, 200, { ok: true, article: articleDetail(tracksNow(), article) });
  }

  if (articleMatch && method === 'DELETE') {
    const i = articles.findIndex((a) => a.id === articleMatch[1] || a.slug === articleMatch[1]);
    if (i === -1) throw new HttpError(404, '没有这篇文章');
    const [gone] = articles.splice(i, 1);
    for (const a of gone.assets || []) removeMedia(a.bucket, a.file);
    saveArticles(articles);
    return sendJson(res, 200, { ok: true, removed: gone.id });
  }

  /* 板块与子板块 */
  if (path === '/api/sections' && method === 'POST') {
    const form = await readForm(req);
    const name = (form.fields.name || '').trim();
    if (!name) throw new HttpError(400, '板块要有个名字');
    let sectionId = (form.fields.id || '').trim() || slugify(name);
    if (findSection(sections, sectionId)) sectionId = `${sectionId}-${randomBytes(2).toString('hex')}`;
    const pitch = (form.fields.pitch || '').trim() || suggestPitch(sections);
    if (sections.some((s) => s.pitch === pitch) && !form.fields.force) {
      throw new HttpError(409, `${pitch} 这个音已经被占用了，换一个，或者勾选「就要这个音」`);
    }
    const created = {
      id: sectionId,
      name: name.slice(0, 40),
      pitch,
      black: /#/.test(pitch),
      def: (form.fields.def || '').slice(0, 120),
      lede: (form.fields.lede || '').slice(0, 400),
      order: sections.length,
      seed: false,
      at: new Date().toISOString(),
      subs: [],
    };
    sections.push(created);
    saveSections(sections);
    return sendJson(res, 201, { ok: true, section: created, url: `/sections/${sectionId}.html` });
  }

  const sectionMatch = /^\/api\/sections\/([\w-]+)$/.exec(path);
  if (sectionMatch && method === 'PATCH') {
    const section = findSection(sections, sectionMatch[1]);
    if (!section) throw new HttpError(404, '没有这个板块');
    const body = JSON.parse((await readBody(req, 65536)).toString('utf8') || '{}');
    for (const key of ['name', 'def', 'lede']) {
      if (typeof body[key] === 'string') section[key] = body[key].slice(0, 400);
    }
    if (typeof body.pitch === 'string' && body.pitch.trim()) section.pitch = body.pitch.trim();
    saveSections(sections);
    return sendJson(res, 200, { ok: true, section });
  }
  if (sectionMatch && method === 'DELETE') {
    const i = sections.findIndex((s) => s.id === sectionMatch[1]);
    if (i === -1) throw new HttpError(404, '没有这个板块');
    if (sections[i].seed) throw new HttpError(400, 'content/posts.mjs 里的九个原生板块不在这里删（改那个文件然后重新生成）');
    const [gone] = sections.splice(i, 1);
    /* 这个板块下用编辑页写的文章也跟着走（连带它们带的图片 / 视频 / 音频） */
    const orphans = articles.filter((a) => a.section === gone.id);
    for (const a of orphans) for (const x of a.assets || []) removeMedia(x.bucket, x.file);
    if (orphans.length) {
      articles = articles.filter((a) => a.section !== gone.id);
      saveArticles(articles);
    }
    saveSections(sections);
    return sendJson(res, 200, { ok: true, removed: gone.id, removedArticles: orphans.length });
  }

  /* 子板块：POST /api/sections/<id>/subs */
  const subMatch = /^\/api\/sections\/([\w-]+)\/subs$/.exec(path);
  if (subMatch && method === 'POST') {
    const section = findSection(sections, subMatch[1]);
    if (!section) throw new HttpError(404, '没有这个板块');
    const form = await readForm(req);
    const name = (form.fields.name || '').trim();
    if (!name) throw new HttpError(400, '子板块要有个名字');
    let subId = (form.fields.id || '').trim() || slugify(name);
    if ((section.subs || []).some((s) => s.id === subId)) subId = `${subId}-${randomBytes(2).toString('hex')}`;
    const sub = { id: subId, name: name.slice(0, 40), def: (form.fields.def || '').slice(0, 120), at: new Date().toISOString() };
    section.subs = section.subs || [];
    section.subs.push(sub);
    saveSections(sections);
    return sendJson(res, 201, { ok: true, sub, url: `/sections/${section.id}/${sub.id}.html` });
  }

  const subItemMatch = /^\/api\/sections\/([\w-]+)\/subs\/([\w-]+)$/.exec(path);
  if (subItemMatch && method === 'DELETE') {
    const section = findSection(sections, subItemMatch[1]);
    const sub = findSub(section, subItemMatch[2]);
    if (!sub) throw new HttpError(404, '没有这个子板块');
    section.subs = section.subs.filter((s) => s.id !== sub.id);
    const orphans = articles.filter((a) => a.section === section.id && a.sub === sub.id);
    for (const a of orphans) for (const x of a.assets || []) removeMedia(x.bucket, x.file);
    if (orphans.length) {
      articles = articles.filter((a) => !(a.section === section.id && a.sub === sub.id));
      saveArticles(articles);
    }
    saveSections(sections);
    return sendJson(res, 200, { ok: true, removedArticles: orphans.length });
  }

  if (path === '/api/state' && method === 'GET') {
    return sendJson(res, 200, { sections, music: music.tracks, settings: music.settings });
  }

  throw new HttpError(404, `没有这个接口：${path}`);
}

/* ------------------------------------------------------------------ 静态文件 */

function serveFile(req, res, full, { download = false } = {}) {
  let stat;
  try {
    stat = statSync(full);
  } catch {
    return sendText(res, 404, '404');
  }
  if (stat.isDirectory()) return sendText(res, 404, '404');

  const type = MIME[extname(full).toLowerCase()] || 'application/octet-stream';
  const etag = `W/"${stat.size}-${Number(stat.mtimeMs).toString(36)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { etag });
    return res.end();
  }

  const headers = {
    'content-type': type,
    etag,
    /* 媒体文件（尤其视频）要能拖动进度条：支持 Range + 允许缓存 */
    'accept-ranges': 'bytes',
    'cache-control': 'public, max-age=3600',
  };
  if (download) headers['content-disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(full.split(sep).pop())}`;

  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (m) {
      let start = m[1] === '' ? stat.size - Number(m[2]) : Number(m[1]);
      let end = m[1] === '' || m[2] === '' ? stat.size - 1 : Number(m[2]);
      start = Math.max(0, Math.min(start, stat.size - 1));
      end = Math.max(start, Math.min(end, stat.size - 1));
      res.writeHead(206, {
        ...headers,
        'content-range': `bytes ${start}-${end}/${stat.size}`,
        'content-length': end - start + 1,
      });
      if (req.method === 'HEAD') return res.end();
      return createReadStream(full, { start, end }).pipe(res);
    }
  }

  res.writeHead(200, { ...headers, 'content-length': stat.size });
  if (req.method === 'HEAD') return res.end();
  createReadStream(full).pipe(res);
}

function notFoundPage(res, pathname) {
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>404 · 没有这一页</title>
<link rel="stylesheet" href="/assets/css/palette.css">
<link rel="stylesheet" href="/assets/css/tokens.css">
<link rel="stylesheet" href="/assets/css/base.css">
</head><body><main class="main" style="max-width:34em;margin:12vh auto">
<p class="sect-head__pitch" style="font-family:var(--f-measure);color:var(--miku-deep)">404</p>
<h1 class="sect-head__name" style="font-family:var(--f-read)">这里没有内容</h1>
<p class="lede" style="font-family:var(--f-read)"><code>${pathname.replace(/[<>&]/g, '')}</code> 既不是静态文件，也不是接口。</p>
<p><a href="/index.html" style="border-bottom:1px solid var(--miku-deep);color:var(--miku-deep)">回首页</a></p>
</main></body></html>`;
  res.writeHead(404, { 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(html) });
  res.end(html);
}

function serveStatic(req, res, url, pathname) {
  /* /media/… 只能落在 media/ 里 */
  if (pathname.startsWith('/media/')) {
    const rest = pathname.slice('/media/'.length);
    const bucket = rest.split('/')[0];
    if (!MEDIA_DIRS[bucket]) return sendText(res, 404, '404');
    const full = safePath(MEDIA_DIRS[bucket], rest.slice(bucket.length + 1));
    if (!full || !existsSync(full)) return sendText(res, 404, '404');
    return serveFile(req, res, full, { download: url.searchParams.has('download') });
  }

  /* 子板块页永远现场渲染：子板块本身就是运行时数据（data/sections.json），
     生成器写出来的那份只是给静态托管兜底 —— 不能让它盖住运行时新写的文章。 */
  const subRoute = /^\/sections\/([^/]+?)\/([^/]+?)\.html$/.exec(pathname);
  if (subRoute && findSub(findSection(sections, subRoute[1]), subRoute[2])) {
    return serveDynamicSection(req, res, subRoute[1], subRoute[2]);
  }

  /* /assets/… 与站点根目录下的静态文件（index.html / archive.html / sections/*.html …） */
  const top = pathname.split('/').filter(Boolean)[0] || '';
  if (top && HIDDEN.has(top)) return notFoundPage(res, pathname);

  let relative = pathname;
  if (relative === '/') relative = '/index.html';
  /* 目录式访问：/sections → /sections/index.html 不存在时给出 404 页面 */
  const full = safePath(ROOT, relative);
  if (!full || !existsSync(full)) {
    /* 编辑页写出来的文章：文件不存在就现场渲染（地址与静态文章一样是 posts/<slug>.html） */
    const dynPost = /^\/posts\/([^/]+?)\.html$/.exec(pathname);
    if (dynPost) return serveDynamicArticle(req, res, dynPost[1]);
    /* 新板块的动态页：/sections/<id>.html 或 /sections/<id>/<sub>.html，文件不存在就现场渲染。
       id 允许中文：自己改 data/sections.json 写了个中文 id 也能访问。 */
    const dyn = /^\/sections\/([^/]+?)(?:\/([^/]+?))?\.html$/.exec(pathname);
    if (dyn) return serveDynamicSection(req, res, dyn[1], dyn[2] || '');
    return notFoundPage(res, pathname);
  }
  if (statSync(full).isDirectory()) {
    const index = join(full, 'index.html');
    if (existsSync(index)) return serveFile(req, res, index);
    return notFoundPage(res, pathname);
  }
  return serveFile(req, res, full);
}

/* 动态文章页：编辑页写出来的那些，静态文件不存在时才走到这里 */
function serveDynamicArticle(req, res, slug) {
  const article = articles.find((a) => a.slug === slug);
  if (!article) return notFoundPage(res, req.url || '');
  const body = Buffer.from(articlePage({ article, tracks: tracksNow(), base: '../' }), 'utf8');
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': body.length, 'cache-control': 'no-store' });
  res.end(body);
}

/* 动态板块页：只在静态文件不存在时才走到这里。
   用合并后的轨道（九条原生 + 运行时板块 + 运行时文章）渲染，
   所以用编辑页写的文章会立刻出现在板块页与子板块页的文章列表里。 */
function serveDynamicSection(req, res, sectionId, subId) {
  const section = findSection(sections, sectionId);
  if (!section) return notFoundPage(res, req.url || '');
  const tracks = tracksNow();
  const track = tracks.find((t) => t.id === sectionId) || section;
  const base = subId ? '../../' : '../';
  let html;
  if (subId) {
    const sub = findSub(section, subId);
    if (!sub) return notFoundPage(res, req.url || '');
    html = dynamicSubPage({ track, sub, sections: tracks, base });
  } else {
    html = dynamicSectionPage({ track, sections: tracks, base });
  }
  const body = Buffer.from(html, 'utf8');
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': body.length, 'cache-control': 'no-store' });
  res.end(body);
}

/* ------------------------------------------------------------------ 启动 */

ensureStartup();

function ensureStartup() {
  for (const dir of [DATA, ...Object.values(MEDIA_DIRS)]) mkdirSync(dir, { recursive: true });

  if (!settings.passphrase) {
    settings.passphrase = randomBytes(4).toString('hex');
    settings.createdAt = new Date().toISOString();
    saveSettings(settings);
  }
  saveSections(sections); // 把播种结果落盘，用户可以直接编辑 data/sections.json
  const picked = syncMusicDir();
  if (picked) console.log(`[音乐] 从 media/music/ 认领了 ${picked} 个文件`);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || HOST + ':' + PORT}`);
  const pathname = decodeURIComponent(url.pathname);

  try {
    if (pathname.startsWith('/api/')) {
      await api(req, res, url);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendText(res, 405, '只支持 GET / HEAD / POST / PATCH / DELETE');
    }
    serveStatic(req, res, url, pathname);
  } catch (err) {
    const status = err.status || (err instanceof UploadError ? 400 : 500);
    if (status >= 500) console.error('[服务出错]', err);
    sendJson(res, status, { ok: false, error: err.message || '服务器内部错误' });
  }
});

server.listen(PORT, HOST, () => {
  const counts = sections.length;
  console.log('');
  console.log('  初音ミク CV01 · 上传服务已启动');
  console.log(`  ─────────────────────────────────────────────`);
  console.log(`  站点        http://${HOST}:${PORT}/`);
  console.log(`  板块 ${counts} 个 · 曲目 ${music.tracks.length} 首 · 自写文章 ${articles.length} 篇`);
  console.log('');
  console.log(`  上传口令    ${settings.passphrase}`);
  console.log('  （第一次上传时输入这个口令，之后这个浏览器就记住了；');
  console.log('    忘了就去 data/settings.json 里看，或者删掉那一行重启）');
  console.log('');
  console.log('  按 Ctrl+C 停止服务');
  console.log('');
});

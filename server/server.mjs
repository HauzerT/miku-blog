/* ==========================================================================
   server/server.mjs · 上传服务
   ---------------------------------------------------------------------------
   零依赖：只用 node: 内置模块。跑起来之后：
     http://127.0.0.1:4321/            原来的静态博客（一字未改地服务出来）
     /feed.html                        全站说说流
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
  loadPosts,
  savePosts,
  loadMusic,
  saveMusic,
  scanMusicDir,
  loadSettings,
  saveSettings,
  suggestPitch,
  extOf,
  id as newId,
} from './lib/store.mjs';
import { parseMultipart, DEFAULT_LIMIT } from './lib/multipart.js';
import { saveUpload, UploadError, kindOf } from './lib/media.js';
import { seedTracks } from './lib/shell.mjs';
import { dynamicSectionPage, dynamicSubPage, feedPage, postCard } from './lib/pages.mjs';

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
let posts = loadPosts();
let music = loadMusic();

function sectionIndex() {
  const map = new Map();
  for (const s of sections) map.set(s.id, s);
  return map;
}

/* 说说存的是 section/sub 的 id；渲染时补上名字与音高，前端就不用再查一遍 */
function decorate(post) {
  const s = sectionIndex().get(post.section);
  const sub = s ? (s.subs || []).find((x) => x.id === post.sub) : null;
  return {
    ...post,
    sectionName: s ? s.name : post.section,
    pitch: s ? s.pitch : '·',
    subName: sub ? sub.name : '',
    kindLabel: post.kind === 'video' ? '视频' : post.kind === 'image' ? '图片' : post.kind === 'sticker' ? '表情包' : post.kind === 'audio' ? '音频' : '文字',
  };
}

function publicPosts() {
  return posts.slice().sort((a, b) => (a.at < b.at ? 1 : -1)).map(decorate);
}

function sectionPosts(sectionId, subId = '') {
  return publicPosts().filter((p) => p.section === sectionId && (!subId || p.sub === subId));
}

function saveAllPosts() {
  savePosts(posts);
}

function removeMedia(asset) {
  if (!asset || !asset.bucket || !asset.file) return;
  const dir = MEDIA_DIRS[asset.bucket];
  if (!dir) return;
  const full = safePath(dir, asset.file);
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

/* ------------------------------------------------------------------ 说说流页面要用到的壳 */

function feedPageHtml() {
  const html = feedPage({ posts: publicPosts(), sections });
  return html;
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
      posts: posts.length,
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

  /* --- 公开读取：板块树 / 说说 / 音乐列表 --- */
  if (path === '/api/sections' && method === 'GET') {
    return sendJson(res, 200, {
      sections: sections.map((s) => ({
        id: s.id,
        name: s.name,
        pitch: s.pitch,
        black: Boolean(s.black),
        seed: Boolean(s.seed),
        def: s.def || '',
        subs: (s.subs || []).map((x) => ({ id: x.id, name: x.name, def: x.def || '' })),
        posts: posts.filter((p) => p.section === s.id).length,
      })),
      suggestPitch: suggestPitch(sections),
    });
  }

  if (path === '/api/posts' && method === 'GET') {
    const section = url.searchParams.get('section') || '';
    const sub = url.searchParams.get('sub') || '';
    const limit = Math.min(Number(url.searchParams.get('limit') || 200) || 200, 1000);
    const list = publicPosts().filter((p) => (!section || p.section === section) && (!sub || p.sub === sub));
    return sendJson(res, 200, { posts: list.slice(0, limit), total: list.length });
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
    removeMedia({ bucket: 'music', file: entry.file });
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

  /* 说说：发布 */
  if (path === '/api/posts' && method === 'POST') {
    const form = await readForm(req);
    const sectionId = (form.fields.section || '').trim();
    const subId = (form.fields.sub || '').trim();
    const section = findSection(sections, sectionId);
    if (!section) throw new HttpError(400, '要先选一个板块');
    const sub = subId ? findSub(section, subId) : null;
    if (subId && !sub) throw new HttpError(400, '这个子板块不存在了');

    const assets = [];
    for (const file of form.files) {
      const kind = kindOf(file);
      if (!kind) throw new UploadError(`不认得的文件类型：${file.filename}`);
      const bucket = kind === 'image' ? 'images' : kind === 'video' ? 'videos' : kind === 'sticker' ? 'stickers' : 'music';
      const saved = saveUpload(file, bucket === 'music' ? 'audio' : bucket);
      const width = Number(form.fields[`w:${file.filename}`] || 0);
      const height = Number(form.fields[`h:${file.filename}`] || 0);
      assets.push({
        kind: saved.kind,
        bucket: saved.bucket,
        file: saved.file,
        url: saved.url,
        original: saved.original,
        size: saved.size,
        type: saved.type,
        ...(width ? { w: width } : {}),
        ...(height ? { h: height } : {}),
      });
    }

    const text = (form.fields.text || '').trim();
    if (!text && !assets.length) throw new HttpError(400, '写点什么，或者选个图片/视频再发');

    const now = new Date();
    const kinds = new Set(assets.map((a) => a.kind));
    const kind = kinds.has('video') ? 'video' : kinds.has('image') || kinds.has('sticker') ? 'image' : 'text';

    const post = {
      id: newId('p_'),
      section: section.id,
      sub: sub ? sub.id : '',
      text: text.slice(0, 4000),
      mood: (form.fields.mood || '').slice(0, 24),
      kind,
      assets,
      date: `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`,
      time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
      at: now.toISOString(),
    };
    posts.push(post);
    saveAllPosts();
    return sendJson(res, 201, { ok: true, post: decorate(post) });
  }

  const postMatch = /^\/api\/posts\/([\w-]+)$/.exec(path);
  if (postMatch && method === 'DELETE') {
    const i = posts.findIndex((p) => p.id === postMatch[1]);
    if (i === -1) throw new HttpError(404, '这条说说已经没了');
    const [gone] = posts.splice(i, 1);
    for (const a of gone.assets || []) removeMedia(a);
    saveAllPosts();
    return sendJson(res, 200, { ok: true });
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
    for (const p of posts.filter((p) => p.section === gone.id)) {
      for (const a of p.assets || []) removeMedia(a);
    }
    posts = posts.filter((p) => p.section !== gone.id);
    saveAllPosts();
    saveSections(sections);
    return sendJson(res, 200, { ok: true, removedPosts: gone.id });
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
    for (const p of posts.filter((p) => p.section === section.id && p.sub === sub.id)) {
      for (const a of p.assets || []) removeMedia(a);
    }
    posts = posts.filter((p) => !(p.section === section.id && p.sub === sub.id));
    saveAllPosts();
    saveSections(sections);
    return sendJson(res, 200, { ok: true });
  }

  if (path === '/api/state' && method === 'GET') {
    return sendJson(res, 200, { sections, posts: publicPosts(), music: music.tracks, settings: music.settings });
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

  /* /assets/… 与站点根目录下的静态文件（index.html / archive.html / sections/*.html …） */
  const top = pathname.split('/').filter(Boolean)[0] || '';
  if (top && HIDDEN.has(top)) return notFoundPage(res, pathname);

  let relative = pathname;
  if (relative === '/') relative = '/index.html';
  /* 目录式访问：/sections → /sections/index.html 不存在时给出 404 页面 */
  const full = safePath(ROOT, relative);
  if (!full || !existsSync(full)) {
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

/* 动态板块页：只在静态文件不存在时才走到这里 */
function serveDynamicSection(req, res, sectionId, subId) {
  const section = findSection(sections, sectionId);
  if (!section) return notFoundPage(res, req.url || '');
  const base = subId ? '../../' : '../';
  let html;
  if (subId) {
    const sub = findSub(section, subId);
    if (!sub) return notFoundPage(res, req.url || '');
    html = dynamicSubPage({ track: section, sub, posts: sectionPosts(sectionId, subId), sections, base });
  } else {
    html = dynamicSectionPage({ track: section, posts: sectionPosts(sectionId), sections, base });
  }
  const body = Buffer.from(html, 'utf8');
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': body.length, 'cache-control': 'no-store' });
  res.end(body);
}

/* ------------------------------------------------------------------ 启动 */

ensureStartup();

function ensureStartup() {
  for (const dir of [DATA, ...Object.values(MEDIA_DIRS)]) mkdirSync(dir, { recursive: true });
  mkdirSync(join(MEDIA_DIRS.images), { recursive: true });

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
    if (pathname === '/feed.html' || pathname === '/feed') {
      const html = feedPageHtml();
      const body = Buffer.from(html, 'utf8');
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': body.length,
        'cache-control': 'no-store',
      });
      res.end(body);
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
  console.log(`  说说流      http://${HOST}:${PORT}/feed.html`);
  console.log(`  板块 ${counts} 个 · 说说 ${posts.length} 条 · 曲目 ${music.tracks.length} 首`);
  console.log('');
  console.log(`  上传口令    ${settings.passphrase}`);
  console.log('  （第一次上传时输入这个口令，之后这个浏览器就记住了；');
  console.log('    忘了就去 data/settings.json 里看，或者删掉那一行重启）');
  console.log('');
  console.log('  按 Ctrl+C 停止服务');
  console.log('');
});

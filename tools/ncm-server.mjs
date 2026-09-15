/* ==========================================================================
   tools/ncm-server.mjs · 云村登录与红心歌单的本地小服务
   ---------------------------------------------------------------------------
   为什么需要它：浏览器不能直接调网易云。原因有两个，都是硬的——
     1) 接口要加密（AES + RSA），纯前端做等于把密钥和算法摊在明面上；
     2) 网易不下发 CORS 头，跨域请求会被浏览器拦掉。
   所以「静态博客 + 一个本地小服务」是唯一不用第三方托管 API 的路子。

   零依赖：只用 node: 内置模块（node:crypto / node:http / node:fs）。
   启动：  node tools/ncm-server.mjs
   自检：  node tools/ncm-server.mjs --selftest

   接口一览（路径刻意与社区通行的网易云 API 命名对齐，方便日后换实现）：
     GET  /api/health           服务是否在、现在登录没登录
     GET  /api/login/qr/key     取二维码 key
     GET  /api/login/qr/create  取二维码内容（浏览器自己画成二维码）
     GET  /api/login/qr/check  轮询扫码状态：800 过期 / 801 待扫 / 802 待确认 / 803 成功
     GET  /api/account          账号信息（昵称、头像、等级、VIP、签名…）
     GET  /api/playlists        我的歌单（用来找「我喜欢的音乐」）
     GET  /api/likelist         红心歌曲 id 列表（无序，可能上万条）
     GET  /api/songs?ids=a,b,c  批量取歌曲详情
     GET  /api/liked            红心歌单分页（= likelist + songs 的组合，前端直接用这个）
     GET  /api/logout           忘掉本地保存的登录凭证
     GET  /api/img?url=…        图片代理（网易封面图不允许直接跨域取像素）

   凭证放在 .ncm-session.json（已在 .gitignore 里），只存在本机。
   ========================================================================== */

import crypto from 'node:crypto';
import http from 'node:http';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATE_FILE = join(ROOT, '.ncm-session.json');
const PORT = Number(process.env.NCM_PORT || 3170);
const HOST = process.env.NCM_HOST || '127.0.0.1';
const UA_PC =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const UA_APP = 'NeteaseMusic 9.0.90/5038 (iPhone; iOS 16.2; zh_CN)';
const WEAPI_DEAD_HINT = '网易已停用 weapi 通道（返回空响应体），故本服务统一走 eapi。';

/* ------------------------------------------------------------------ 加密 */

const EAPI_KEY = 'e82ckenh8dichen8';

/* eapi：AES-128-ECB + PKCS7，明文是 url-36cd479b6b5-json-36cd479b6b5-md5 */
function eapiParams(apiPath, data) {
  const text = JSON.stringify(data);
  const digest = crypto.createHash('md5').update(`nobody${apiPath}use${text}md5forencrypt`).digest('hex');
  const plain = `${apiPath}-36cd479b6b5-${text}-36cd479b6b5-${digest}`;
  const cipher = crypto.createCipheriv('aes-128-ecb', Buffer.from(EAPI_KEY), null);
  const params = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]).toString('hex').toUpperCase();
  return { params };
}

/* eapi 还要在 body 里自带一份 header；这些字段缺失会被判定为非客户端请求 */
function eapiHeader(cookieJar) {
  return {
    osver: 'Microsoft-Windows-10-Professional-build-19045-64bit',
    deviceId: cookieJar.deviceId,
    os: 'pc',
    appver: '3.1.17.204416',
    versioncode: '140',
    mobilename: '',
    buildver: String(Date.now()).slice(0, 10),
    resolution: '1920x1080',
    __csrf: cookieJar.cookies.__csrf || '',
    channel: 'netease',
    requestId: `${Date.now()}_${String(Math.floor(Math.random() * 1000)).padStart(4, '0')}`,
  };
}

/* ------------------------------------------------------------------ 会话 */

function newDeviceId() {
  return crypto.randomBytes(24).toString('base64').replace(/[^0-9a-zA-Z]/g, '').slice(0, 32).padEnd(32, 'A');
}

function emptyJar() {
  return { cookies: {}, deviceId: newDeviceId(), createdAt: Date.now() };
}

/* 短缓存：翻页时不必每页都重新问一次 uid 和上万条红心 id。
   60 秒足够翻完一屏，又不会让「刚点的红心」迟迟不出现。 */
const CACHE_TTL = 60000;
const cache = new Map();

function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return Promise.resolve(hit.value);
  return Promise.resolve(fn()).then((value) => {
    cache.set(key, { at: Date.now(), value });
    return value;
  });
}

const invalidate = (prefix) => {
  for (const key of cache.keys()) if (key.startsWith(prefix)) cache.delete(key);
};

/* Set-Cookie → 只留下关键的几个（MUSIC_U 是登录凭证，__csrf 是防伪 token） */
const KEEP_COOKIES = new Set(['MUSIC_U', '__csrf', '__remember_me', 'NMTID', '_ntes_nuid', '_ntes_nnid', 'MUSIC_A', 'JSESSIONID-WYYY']);

function absorbSetCookie(jar, setCookies) {
  let changed = false;
  for (const raw of setCookies) {
    const first = raw.split(';')[0];
    const eq = first.indexOf('=');
    if (eq <= 0) continue;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    if (!KEEP_COOKIES.has(name)) continue;
    if (value === '' || value === 'deleted') delete jar.cookies[name];
    else jar.cookies[name] = value;
    changed = true;
  }
  return changed;
}

function cookieHeaderFor(jar) {
  const parts = [];
  for (const [k, v] of Object.entries(jar.cookies)) if (v) parts.push(`${k}=${v}`);
  /* 这三个是网易客户端固定带的，缺了会被当成异常请求 */
  parts.push('os=pc', 'appver=3.1.17.204416', 'channel=netease');
  return parts.join('; ');
}

/* 本地会话表：浏览器拿 ncm_sid，服务端存对应的网易 cookie jar */
const sessions = new Map();

function loadState() {
  if (!existsSync(STATE_FILE)) return;
  try {
    const raw = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    if (raw && raw.sid && raw.jar && raw.jar.cookies) {
      sessions.set(raw.sid, raw.jar);
      console.log(`[session] 已载入上次的登录凭证（${Object.keys(raw.jar.cookies).length} 个 cookie）`);
    }
  } catch (err) {
    console.warn('[session] 读取 .ncm-session.json 失败，忽略：', err.message);
  }
}

function saveState() {
  /* 只持久化「已经登录」的会话，避免写一堆空壳 */
  for (const [sid, jar] of sessions) {
    if (jar.cookies.MUSIC_U) {
      try {
        writeFileSync(STATE_FILE, JSON.stringify({ sid, jar }, null, 2), { mode: 0o600 });
        return true;
      } catch (err) {
        console.warn('[session] 保存失败：', err.message);
      }
      return false;
    }
  }
  return false;
}

function clearState() {
  if (existsSync(STATE_FILE)) {
    try { unlinkSync(STATE_FILE); } catch { /* 无所谓 */ }
  }
}

/* ------------------------------------------------------------------ 请求 */

/* 真正打给网易。返回 { code, body, setCookie }。 */
async function netease(apiPath, data, jar, { retries = 2 } = {}) {
  const payload = { ...data, header: eapiHeader(jar) };
  const url = `https://interface.music.163.com/eapi/${apiPath}`;
  let lastErr = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': UA_APP,
          Referer: 'https://music.163.com/',
          Cookie: cookieHeaderFor(jar),
        },
        body: new URLSearchParams(eapiParams(`/api/${apiPath}`, payload)).toString(),
        signal: controller.signal,
      });
      clearTimeout(timer);

      const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      absorbSetCookie(jar, setCookie);

      const text = await res.text();
      let body = null;
      if (text) {
        try { body = JSON.parse(text); } catch { body = null; }
      }
      if (body === null) {
        /* 空响应体基本只有一种可能：接口通道变了 */
        throw Object.assign(new Error(`网易返回了空响应体（HTTP ${res.status}）。${WEAPI_DEAD_HINT}`), { fatal: true });
      }
      return { code: Number(body.code ?? res.status), body, setCookie };
    } catch (err) {
      lastErr = err;
      if (err.fatal) break;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastErr ?? new Error('请求网易失败');
}

/* ------------------------------------------------------------------ 业务 */

/* 找到「我喜欢的音乐」歌单：specialType === 5 是网易给的固定标记 */
const LIKED_SPECIAL_TYPE = 5;

/* 当前登录用户的 uid（带缓存，翻页时不用反复问） */
function getUid(jar, sid) {
  return cached(`uid:${sid}`, async () => {
    const account = await getAccount(jar);
    return account?.account?.id ?? account?.profile?.userId ?? null;
  });
}

async function getAccount(jar) {
  const r = await netease('nuser/account/get', {}, jar);
  return r.body;
}

async function getPlaylists(jar, uid) {
  const r = await netease('user/playlist', { uid, limit: 1000, offset: 0, includeVideo: false }, jar);
  return Array.isArray(r.body.playlist) ? r.body.playlist : [];
}

async function findLikedPlaylist(jar, uid) {
  if (!uid) return { uid: null, playlist: null };
  const playlists = await getPlaylists(jar, uid);
  const liked = playlists.find((p) => p.specialType === LIKED_SPECIAL_TYPE) || null;
  return { uid, playlist: liked, playlists };
}

/* 红心 id 列表：可能上万条，一次拿全（接口本身就是全量返回） */
function getLikelist(jar, uid, sid) {
  return cached(`likelist:${sid}:${uid}`, async () => {
    const r = await netease('song/like/get', { uid }, jar);
    return Array.isArray(r.body.ids) ? r.body.ids : [];
  });
}

/* 批量歌曲详情：一次最多 500 个，多了网易会截断 */
async function getSongs(jar, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const c = '[' + chunk.map((id) => `{"id":${id}}`).join(',') + ']';
    const r = await netease('v3/song/detail', { c }, jar);
    if (Array.isArray(r.body.songs)) out.push(...r.body.songs);
  }
  return out;
}

/* 播放地址。
   ---------------------------------------------------------------------------
   这是唯一一处"要真东西"的地方：返回的是一条带签名的 CDN 直链，
   有效期约 20 分钟，过期后必须重新问。所以这里做 12 分钟缓存——
   比有效期短一截，翻页来回点同一首歌不会每次都打网易。
   好消息是那些 CDN 会发 Access-Control-Allow-Origin: *，
   所以浏览器能直接 <audio src> 播，不需要我们中转音频流。 */
const PLAY_LEVELS = ['exhigh', 'higher', 'standard'];   // 逐级降级，尽量给好音质
const URL_TTL = 12 * 60 * 1000;
const urlCache = new Map();

async function getSongUrl(jar, id) {
  const hit = urlCache.get(id);
  if (hit && Date.now() - hit.at < URL_TTL) return hit.value;

  let last = null;
  for (const level of PLAY_LEVELS) {
    const r = await netease('song/enhance/player/url/v1', {
      ids: `[${id}]`,
      level,
      encodeType: 'mp3',
    }, jar);
    const d = r.body?.data?.[0];
    last = d || last;
    if (d && d.url) {
      const value = {
        ok: true,
        url: d.url,
        level: d.level || level,
        br: d.br || 0,
        size: d.size || 0,
        type: d.type || 'mp3',
        fee: d.fee ?? 0,
        trial: Boolean(d.freeTrialInfo),
      };
      urlCache.set(id, { at: Date.now(), value });
      return value;
    }
  }

  /* 走到这里说明三级都拿不到地址。原因通常是不可播（下架 / 版权 / 需付费）。 */
  const value = {
    ok: false,
    reason: 'UNPLAYABLE',
    message: '这首歌拿不到播放地址（可能是下架、版权受限，或者需要单独购买）。',
    fee: last?.fee ?? null,
  };
  urlCache.set(id, { at: Date.now(), value });
  return value;
}

/* 把网易那套字段压成前端要用的形状——前端不该认识 al/ar/dt 这些缩写 */
function slimSong(song) {
  if (!song) return null;
  const artists = (song.ar || song.artists || []).map((a) => a.name).filter(Boolean);
  const album = song.al || song.album || {};
  return {
    id: song.id,
    name: song.name,
    artists,
    artist: artists.join(' / '),
    album: album.name || '',
    cover: album.picUrl || '',
    duration: song.dt || song.duration || 0,
    fee: song.fee ?? 0,
    mvId: song.mv || 0,
    url: `https://music.163.com/song?id=${song.id}`,
  };
}

function slimProfile(account, detail) {
  const p = detail?.profile || account?.profile || null;
  if (!p) return null;
  return {
    uid: p.userId,
    nickname: p.nickname,
    avatar: p.avatarUrl,
    signature: p.signature || '',
    background: p.backgroundUrl || '',
    gender: p.gender,
    province: p.province,
    city: p.city,
    birthday: p.birthday,
    follows: p.follows ?? 0,
    followers: p.followers ?? 0,
    playlists: p.playlistCount ?? 0,
    level: detail?.level ?? null,
    listenSongs: p.listenSongs ?? null,
    createTime: p.createTime ?? null,
    vipType: p.vipType ?? 0,
    vip: vipLabel(p),
    createDays: p.createTime ? Math.floor((Date.now() - p.createTime) / 86400000) : null,
  };
}

/* vipType 是个位标记：0 无、11 黑胶 VIP、10 音乐包…这里只分「有 / 无」并说清是哪种 */
function vipLabel(p) {
  const t = p.vipType ?? 0;
  if (t === 0) return null;
  return { type: t, label: t === 11 ? '黑胶 VIP' : '音乐包' };
}

/* ------------------------------------------------------------------ HTTP */

const json = (res, status, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
};

/* CSRF 防护：只允许本站页面（含 file:// 的 null origin）跨域读，且只接受本机来源 */
function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

function sessionFor(req, res) {
  const cookies = parseCookies(req);
  let sid = cookies.ncm_sid;
  if (!sid || !/^[a-f0-9]{32}$/.test(sid)) {
    sid = crypto.randomBytes(16).toString('hex');
    res.setHeader('Set-Cookie', `ncm_sid=${sid}; Path=/; SameSite=Lax; HttpOnly; Max-Age=2592000`);
  }
  if (!sessions.has(sid)) sessions.set(sid, emptyJar());
  return { sid, jar: sessions.get(sid) };
}

/* 未登录时网易会回 301（而不是 401），这里翻译成明确的语义 */
function isLoggedIn(jar) {
  return Boolean(jar.cookies.MUSIC_U);
}

const server = http.createServer(async (req, res) => {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
  } catch {
    return json(res, 400, { ok: false, error: 'BAD_REQUEST' });
  }
  const route = url.pathname.replace(/\/+$/, '') || '/';
  const q = url.searchParams;

  /* 图片代理不碰会话，放在前面 */
  if (route === '/api/img') {
    const target = q.get('url');
    if (!target || !/^https?:\/\//.test(target)) return json(res, 400, { ok: false, error: 'BAD_URL' });
    try {
      const upstream = await fetch(target, {
        headers: { Referer: 'https://music.163.com/', 'User-Agent': UA_PC },
      });
      if (!upstream.ok) return json(res, 502, { ok: false, error: 'UPSTREAM_' + upstream.status });
      const type = upstream.headers.get('content-type') || 'image/jpeg';
      if (!/^image\//.test(type)) return json(res, 415, { ok: false, error: 'NOT_AN_IMAGE' });
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.writeHead(200, {
        'Content-Type': type,
        'Cache-Control': 'public, max-age=86400',
        'Content-Length': buf.length,
      });
      return res.end(buf);
    } catch (err) {
      return json(res, 502, { ok: false, error: 'PROXY_FAILED', message: err.message });
    }
  }

  const { sid, jar } = sessionFor(req, res);

  try {
    /* ---------------------------------------------------- 服务与登录状态 */
    if (route === '/api/health') {
      let profile = null;
      if (isLoggedIn(jar)) {
        try {
          const account = await getAccount(jar);
          profile = slimProfile(account, null);
        } catch { /* 凭证过期就当没登录 */ }
      }
      return json(res, 200, {
        ok: true,
        loggedIn: isLoggedIn(jar),
        profile,
        endpoint: `http://${HOST}:${PORT}`,
      });
    }

    /* ------------------------------------------------------------ 扫码登录 */
    if (route === '/api/login/qr/key') {
      const r = await netease('login/qrcode/unikey', { type: 3 }, jar);
      const key = r.body.unikey;
      if (!key) return json(res, 502, { ok: false, error: 'NO_KEY', body: r.body });
      return json(res, 200, { ok: true, key, code: r.code });
    }

    if (route === '/api/login/qr/create') {
      const key = q.get('key');
      if (!key) return json(res, 400, { ok: false, error: 'MISSING_KEY' });
      /* 二维码内容用网易 PC 登录页的官方格式；浏览器拿到它自己画成二维码，
         这样二维码是本地生成的，不经过任何第三方图片服务。 */
      const qrurl = `https://music.163.com/login?codekey=${encodeURIComponent(key)}`;
      return json(res, 200, { ok: true, qrurl });
    }

    if (route === '/api/login/qr/check') {
      const key = q.get('key');
      if (!key) return json(res, 400, { ok: false, error: 'MISSING_KEY' });
      const r = await netease('login/qrcode/client/login', { key, type: 3 }, jar);
      const code = r.code;
      /* 803 = 授权成功，此时 set-cookie 里才有 MUSIC_U */
      if (code === 803) {
        invalidate(`uid:${sid}`);
        invalidate(`likelist:${sid}`);
        const saved = saveState();
        if (!saved) {
          return json(res, 200, { ok: true, code, loggedIn: false, message: '登录成功但没能拿到凭证，请重试' });
        }
      }
      return json(res, 200, {
        ok: true,
        code,
        loggedIn: isLoggedIn(jar),
        message: { 800: '二维码已过期，请刷新', 801: '等待扫码', 802: '已扫码，请在手机上确认', 803: '登录成功' }[code] || r.body.message || '',
      });
    }

    if (route === '/api/logout') {
      try { await netease('logout', {}, jar); } catch { /* 退出失败也要清本地 */ }
      sessions.delete(sid);
      invalidate(`uid:${sid}`);
      invalidate(`likelist:${sid}`);
      clearState();
      return json(res, 200, { ok: true, loggedIn: false });
    }

    /* ---------------------------------------------------------------- 账号 */
    if (route === '/api/account') {
      if (!isLoggedIn(jar)) return json(res, 401, { ok: false, error: 'NOT_LOGGED_IN' });
      const account = await getAccount(jar);
      const uid = account?.account?.id;
      if (!uid) return json(res, 401, { ok: false, error: 'NOT_LOGGED_IN' });
      cache.set(`uid:${sid}`, { at: Date.now(), value: uid });

      /* 账号接口给的资料偏薄，再取一次用户详情拿等级/听歌数 */
      let detail = null;
      try {
        const r = await netease(`v1/user/detail/${uid}`, {}, jar);
        detail = r.body;
      } catch { /* 详情拿不到不影响主流程 */ }

      const profile = slimProfile(account, detail);
      let liked = null;
      try {
        const found = await findLikedPlaylist(jar, uid);
        if (found.playlist) {
          liked = {
            id: found.playlist.id,
            name: found.playlist.name,
            trackCount: found.playlist.trackCount,
            cover: found.playlist.coverImgUrl,
            playCount: found.playlist.playCount,
            updateTime: found.playlist.updateTime,
            url: `https://music.163.com/playlist?id=${found.playlist.id}`,
          };
        }
      } catch { /* 歌单拿不到不影响账号展示 */ }

      return json(res, 200, { ok: true, loggedIn: true, profile, liked });
    }

    /* ------------------------------------------------------------ 播放地址 */
    if (route === '/api/song/url') {
      if (!isLoggedIn(jar)) return json(res, 401, { ok: false, error: 'NOT_LOGGED_IN' });
      const id = Number(q.get('id'));
      if (!Number.isFinite(id) || id <= 0) return json(res, 400, { ok: false, error: 'BAD_ID' });
      const info = await getSongUrl(jar, id);
      return json(res, 200, { ok: true, id, ...info });
    }

    /* -------------------------------------------------------------- 歌单 */
    if (route === '/api/playlists') {
      if (!isLoggedIn(jar)) return json(res, 401, { ok: false, error: 'NOT_LOGGED_IN' });
      const uid = await getUid(jar, sid);
      if (!uid) return json(res, 401, { ok: false, error: 'NOT_LOGGED_IN' });
      const playlists = await getPlaylists(jar, uid);
      return json(res, 200, {
        ok: true,
        playlists: playlists
          .filter((p) => p.specialType !== 5)
          .map((p) => ({
            id: p.id,
            name: p.name,
            trackCount: p.trackCount,
            cover: p.coverImgUrl,
            playCount: p.playCount,
            subscribed: Boolean(p.subscribed),
            url: `https://music.163.com/playlist?id=${p.id}`,
          })),
      });
    }

    /* ------------------------------------------------------- 红心歌单（本页主角） */
    if (route === '/api/likelist') {
      if (!isLoggedIn(jar)) return json(res, 401, { ok: false, error: 'NOT_LOGGED_IN' });
      const uid = await getUid(jar, sid);
      if (!uid) return json(res, 401, { ok: false, error: 'NOT_LOGGED_IN' });
      const ids = await getLikelist(jar, uid, sid);
      return json(res, 200, { ok: true, total: ids.length, ids });
    }

    if (route === '/api/songs') {
      if (!isLoggedIn(jar)) return json(res, 401, { ok: false, error: 'NOT_LOGGED_IN' });
      const ids = (q.get('ids') || '')
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0);
      if (!ids.length) return json(res, 400, { ok: false, error: 'MISSING_IDS' });
      const songs = await getSongs(jar, ids);
      const byId = new Map(songs.map((s) => [s.id, slimSong(s)]));
      /* 按传入顺序回，顺便标出哪几条已经下架/查不到 */
      return json(res, 200, {
        ok: true,
        songs: ids.map((id) => byId.get(id) || { id, missing: true }),
      });
    }

    if (route === '/api/liked') {
      if (!isLoggedIn(jar)) return json(res, 401, { ok: false, error: 'NOT_LOGGED_IN' });
      const offset = Math.max(0, Number(q.get('offset')) || 0);
      const limit = Math.min(200, Math.max(1, Number(q.get('limit')) || 50));

      const uid = await getUid(jar, sid);
      if (!uid) return json(res, 401, { ok: false, error: 'NOT_LOGGED_IN' });

      const ids = await getLikelist(jar, uid, sid);
      const page = ids.slice(offset, offset + limit);
      const songs = page.length ? await getSongs(jar, page) : [];
      const byId = new Map(songs.map((s) => [s.id, slimSong(s)]));

      return json(res, 200, {
        ok: true,
        total: ids.length,
        offset,
        limit,
        hasMore: offset + limit < ids.length,
        songs: page.map((id) => byId.get(id) || { id, missing: true }),
      });
    }

    return json(res, 404, { ok: false, error: 'NOT_FOUND', route });
  } catch (err) {
    const detail = err?.message || String(err);
    console.error('[api]', route, '->', detail);
    return json(res, 502, { ok: false, error: 'UPSTREAM_ERROR', message: detail });
  }
});

/* -------------------------------------------------------------- 自检模式 */

async function selftest() {
  const steps = [];
  const jar = emptyJar();
  const check = (name, fn) => steps.push({ name, fn });

  check('加密：eapi 参数可加密且长度为偶数', () => {
    const { params } = eapiParams('/api/login/qrcode/unikey', { type: 3, header: eapiHeader(jar) });
    if (!/^[0-9A-F]+$/.test(params)) throw new Error('密文不是十六进制大写');
    if (params.length % 2 !== 0) throw new Error('密文长度不是偶数');
    if (params.length < 100) throw new Error('密文过短，疑似失败');
    return `${params.length} 个十六进制字符`;
  });

  check('会话：cookie 解析与拼装', () => {
    absorbSetCookie(jar, [
      'MUSIC_U=abc123; Path=/; Domain=.music.163.com; HttpOnly',
      '__csrf=xyz; Path=/',
      'Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/',
    ]);
    if (jar.cookies.MUSIC_U !== 'abc123') throw new Error('MUSIC_U 没解析出来');
    if (jar.cookies.__csrf !== 'xyz') throw new Error('__csrf 没解析出来');
    const header = cookieHeaderFor(jar);
    if (!header.includes('MUSIC_U=abc123')) throw new Error('cookie 头里没有 MUSIC_U');
    if (!header.includes('os=pc')) throw new Error('cookie 头缺少客户端字段');
    return header.slice(0, 60) + '…';
  });

  check('接口：生成二维码 key', async () => {
    const r = await netease('login/qrcode/unikey', { type: 3 }, emptyJar());
    if (!r.body?.unikey) throw new Error('没有拿到 unikey：' + JSON.stringify(r.body).slice(0, 120));
    return `key = ${r.body.unikey}`;
  });

  check('接口：轮询扫码状态（未扫应为 801）', async () => {
    const k = await netease('login/qrcode/unikey', { type: 3 }, emptyJar());
    const r = await netease('login/qrcode/client/login', { key: k.body.unikey, type: 3 }, emptyJar());
    if (r.code !== 801) throw new Error(`期望 801，实际 ${r.code}：${JSON.stringify(r.body).slice(0, 120)}`);
    return `code = ${r.code}（${r.body.message}）`;
  });

  check('接口：未登录访问红心歌单应被挡住', async () => {
    const r = await netease('song/like/get', { uid: 1 }, emptyJar());
    if (r.code !== 301 && r.code !== 200) throw new Error(`意外返回 ${r.code}`);
    return `code = ${r.code}（未登录被拒）`;
  });

  /* 只有已经登录过，才测得了播放地址；没登录就跳过而不是失败 */
  check('接口：播放地址（需要已登录，没有则跳过）', async () => {
    if (!existsSync(STATE_FILE)) return '跳过：还没登录过，登录后可以再跑一次 --selftest';
    const saved = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    const jar = saved.jar;
    if (!jar?.cookies?.MUSIC_U) return '跳过：凭证里没有 MUSIC_U';
    /* 用一首几乎肯定在库里的老歌探路，取不到也算正常，不算失败 */
    const r = await netease('song/enhance/player/url/v1', {
      ids: '[347230]', level: 'standard', encodeType: 'mp3',
    }, jar);
    const d = r.body?.data?.[0];
    if (!d) throw new Error('接口没返回 data');
    return d.url
      ? `拿到直链（${d.type || 'mp3'} / ${Math.round((d.br || 0) / 1000)}kbps）`
      : `接口通了，但这首歌当前不可播（fee=${d.fee}）——属于正常情况`;
  });

  let failed = 0;
  console.log('\n云村小服务 · 自检');
  console.log('─'.repeat(64));
  for (const s of steps) {
    try {
      const out = await s.fn();
      console.log(`✓ ${s.name}`);
      if (out) console.log(`    ${out}`);
    } catch (err) {
      failed++;
      console.log(`✗ ${s.name}`);
      console.log(`    ${err.message}`);
    }
  }
  console.log('─'.repeat(64));
  console.log(failed ? `${failed} 项失败` : '全部通过');
  console.log(`\n提示：${WEAPI_DEAD_HINT}`);
  return failed;
}

/* ------------------------------------------------------------------ 入口 */

loadState();

if (process.argv.includes('--selftest')) {
  const failed = await selftest();
  process.exit(failed ? 1 : 0);
}

server.listen(PORT, HOST, () => {
  console.log(`云村小服务已启动：http://${HOST}:${PORT}`);
  console.log(`  · 站点页面从这里取数：http://${HOST}:${PORT}/api/health`);
  console.log('  · 凭证存在 .ncm-session.json（只在本机，已在 .gitignore 里）');
  console.log('  · 停止：Ctrl+C');
});

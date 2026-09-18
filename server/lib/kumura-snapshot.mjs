/* ==========================================================================
   server/lib/kumura-snapshot.mjs · 云村「公网快照」：采集、脱敏、封面本地化
   ---------------------------------------------------------------------------
   云村那一页原来是**本机自用**的：浏览器直连 127.0.0.1:3170 的小服务，凭证
   （MUSIC_U）只躺在 .ncm-session.json 里。要让访客也看得见歌单，有两条路——
   实时只读代理（访客每次访问都拿站长账号去问网易）和**快照**。这一份做后者。

   快照的规矩，一条一条说清楚：

     · **白名单，不是黑名单。** 公开哪些字段由下面 sanitizeSnapshot 逐个列出。
       uid、性别、省市、生日、背景图、每日推荐、以及**任何播放地址**都不在名单里。
       要加字段就改那一处，而不是「顺手把整个对象发出去」。
     · **凭证不过界。** 采集时拿 .ncm-session.json 里的 ncm_sid 去问本机小服务，
       这个 cookie 只出现在 loopback 那一跳上，永不进快照、永不进浏览器。
     · **封面本地化。** 网易图床的地址写进快照，等于让访客去敲第三方（还可能被
       防盗链挡），所以发布时把图下到 media/kumura/，快照里只留站内地址。下载
       失败就留空——宁可少一张图，也不把第三方地址漏出去。
     · **快照是「拍一张照」。** 站长点一下才更新（或挂个定时任务跑
       tools/kumura-publish.mjs）。访客流量因此一个字节都不会打到网易账号上：
       既然「听」已经决定只走站上音乐盒，这一条就把「看」那半边也收干净了。
     · **播放地址一个都不给。** 采集只碰 /api/account、/api/playlists、/api/liked
       这三条**读**接口，永远不碰 /api/song/url——那是唯一会拿到带签名 CDN 直链
       的地方（见 tools/ncm-server.mjs 的 getSongUrl）。

   纯 node：只 import node: 内置模块 + 全局 fetch，没有别的依赖。所以两边共用：
     · Nitro 那侧：server/api/kumura/publish.post.ts（站长在页面上按那颗按钮）
     · 命令行那侧：tools/kumura-publish.mjs（定时任务挂它）
   白名单只有这一份，不会两边各写各的。
   ========================================================================== */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/* 快照格式版本：形状变了就 +1，读到对不上的旧快照当「没发布过」 */
export const SNAPSHOT_VERSION = 1;

/* 红心歌单公开多少首。小服务那侧 /api/liked 一次最多给 200，所以这里也封顶 200 */
export const TRACK_CAP = 200;
/* 我创建的歌单最多公开多少张 */
export const PLAYLIST_CAP = 60;
/* 单张封面最大 2MB，超了不要（封面本来就都是几十 KB） */
export const IMAGE_MAX = 2 * 1024 * 1024;

/* 允许下载的图床：只认网易自家的 music.126.net 子域。
   这一条是 SSRF 的边界——快照里的图片地址只能来自这里，别处一律不取。
   用 URL 解析而不是正则扫字符串：主机名要**正好**是 xxx.music.126.net，
   p1.music.126.net.evil.com 这种拼出来的名字过不了。
   另外网易回的是 http:// 的地址（实测头像就是），这里统一升成 https 再取。 */
const IMAGE_HOST = /^[a-z0-9-]+\.music\.126\.net$/i;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const SERVICE_TIMEOUT = 20000;
const IMAGE_TIMEOUT = 15000;

/* ------------------------------------------------------------------ 小工具 */

/* 压成一行、去掉首尾空白、截断。快照里所有字符串都从这儿过一遍 */
const text = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/* 只留网易云自己的网页地址（歌单页 / 单曲页）。这是「去网易云看」的出口，
   不是播放地址——播放地址永远不进快照。 */
const musicLink = (kind, id) => (id ? `https://music.163.com/${kind}?id=${id}` : '');

/* 图床地址的收口：认得出、且是网易自家域名，才回一条可以取的 https 地址。
   认不出就回空串——「取不到图」永远好过「把第三方地址写进快照」。 */
const imageOf = (v) => {
  const s = String(v || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    if (!IMAGE_HOST.test(u.hostname)) return '';
    u.protocol = 'https:';
    return u.toString();
  } catch {
    return '';
  }
};

/* ------------------------------------------------------------ 脱敏（纯函数）
   输入：采集回来的原始形状 { profile, liked, playlists, tracks }
   输出：{ snapshot, images }
     snapshot —— 可以公开的那一份（图片字段先留空，等本地化填）
     images   —— 要下载的封面清单 [{ key, url }]，key 同时是本地文件名

   纯函数，不碰网络也不碰磁盘，所以自检可以直接喂一份假数据进来验边界。 */
export function sanitizeSnapshot(raw, { now = new Date(), trackCap = TRACK_CAP, playlistCap = PLAYLIST_CAP } = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const images = [];

  /* ---------------------------------------------------------------- 账号
     公开：昵称、头像、签名、等级、听歌数、关注/粉丝、歌单数、注册天数、VIP 标签。
     不公开：uid、性别、省市、生日、背景图、注册时间戳。 */
  const p = src.profile && typeof src.profile === 'object' ? src.profile : {};
  const avatarUrl = imageOf(p.avatar);
  if (avatarUrl) images.push({ key: 'avatar', url: avatarUrl });

  const profile = {
    nickname: text(p.nickname, 40),
    avatar: '',
    signature: text(p.signature, 120),
    level: num(p.level),
    listenSongs: num(p.listenSongs),
    follows: num(p.follows),
    followers: num(p.followers),
    playlists: num(p.playlists),
    createDays: num(p.createDays),
    vip: p.vip && typeof p.vip === 'object' && p.vip.label ? text(p.vip.label, 16) : null,
  };

  /* ------------------------------------------------------ 我创建的歌单 */
  const playlists = [];
  for (const item of Array.isArray(src.playlists) ? src.playlists : []) {
    if (playlists.length >= playlistCap) break;
    const id = num(item && item.id);
    if (!id || id <= 0) continue;
    const coverUrl = imageOf(item.cover);
    if (coverUrl) images.push({ key: `pl-${id}`, url: coverUrl });
    playlists.push({
      id,
      name: text(item.name, 60),
      trackCount: num(item.trackCount) || 0,
      cover: '',
      playCount: num(item.playCount),
      url: musicLink('playlist', id),
    });
  }

  /* ------------------------------------------------------------ 红心歌单
     曲目只留「歌名 / 歌手 / 专辑 + 网易云单曲页」，一首歌的封面不下载
     （200 张图没必要），播放地址一个都不留。 */
  const likedRaw = src.liked && typeof src.liked === 'object' ? src.liked : {};
  const likedId = num(likedRaw.id);
  const likedCoverUrl = imageOf(likedRaw.cover);
  if (likedCoverUrl) images.push({ key: 'liked', url: likedCoverUrl });

  const all = Array.isArray(src.tracks) ? src.tracks : [];
  const tracks = [];
  for (const t of all) {
    if (tracks.length >= trackCap) break;
    const id = num(t && t.id);
    if (!id || id <= 0) continue;
    tracks.push({
      id,
      name: text(t.name, 80) || '（这首查不到了）',
      artist: text(t.artist, 80),
      album: text(t.album, 80),
      url: musicLink('song', id),
      missing: Boolean(t && t.missing),
    });
  }

  const liked = {
    name: text(likedRaw.name, 60) || '我喜欢的音乐',
    trackCount: num(likedRaw.trackCount) || all.length,
    cover: '',
    url: musicLink('playlist', likedId),
    tracks,
    capped: all.length > tracks.length,
  };

  return {
    snapshot: {
      version: SNAPSHOT_VERSION,
      at: now.toISOString(),
      profile,
      playlists,
      liked,
    },
    images,
  };
}

/* ------------------------------------------------------------ 本地登录凭证
   .ncm-session.json 里那一行 sid：小服务按它认「这是站长那台浏览器」。
   只读它、只在本机用；格式不对就当作没登录。 */
export function readSessionSid(file) {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    const sid = String((raw && raw.sid) || '');
    return /^[a-f0-9]{32}$/.test(sid) ? sid : '';
  } catch {
    return '';
  }
}

/* ------------------------------------------------------------------ 采集 */

async function getJson(fetchImpl, url, sid, timeoutMs) {
  let res;
  try {
    res = await fetchImpl(url, {
      headers: { accept: 'application/json', cookie: `ncm_sid=${sid}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    /* 连不上（小服务没跑 / 端口不对）时 fetch 直接抛，这里翻成站长看得懂的一句 */
    const where = url.replace(/\/api\/.*$/, '');
    throw new Error(`连不上本机的云村小服务（${where}）——先在仓库根跑 node tools/ncm-server.mjs`);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.ok === false) {
    const why = (data && (data.error || data.message)) || `HTTP ${res.status}`;
    throw new Error(whatToSay(String(why)));
  }
  return data;
}

/* 小服务的错误码翻成人话——发布失败时站长看到的就是这一句 */
function whatToSay(code) {
  if (code === 'NOT_LOGGED_IN') return '本机小服务说没登录：先在云村页扫码登录一次';
  if (code === 'UPSTREAM_ERROR') return '小服务问网易失败了（凭证可能过期），重新扫码登录一次再试';
  return `小服务回了一句：${code}`;
}

/* 只读这三条。顺序无所谓，但都是登录态接口，sid 不对会直接 401。 */
export async function collectFromService({
  service,
  sid,
  trackCap = TRACK_CAP,
  fetchImpl = fetch,
  timeoutMs = SERVICE_TIMEOUT,
}) {
  if (!sid) throw new Error('这台机器上还没有云村登录凭证（.ncm-session.json），先在 /kumura 扫码登录一次');
  const base = String(service || 'http://127.0.0.1:3170').replace(/\/+$/, '');
  const limit = Math.min(TRACK_CAP, Math.max(1, Number(trackCap) || TRACK_CAP));

  const account = await getJson(fetchImpl, `${base}/api/account`, sid, timeoutMs);
  const shelf = await getJson(fetchImpl, `${base}/api/playlists`, sid, timeoutMs);
  const liked = await getJson(fetchImpl, `${base}/api/liked?offset=0&limit=${limit}`, sid, timeoutMs);

  return {
    profile: account.profile || null,
    liked: {
      ...(account.liked || {}),
      /* total 是红心的真实总数（可能上万），列表只截了前 limit 首 */
      trackCount: num(liked.total) || num(account.liked && account.liked.trackCount) || 0,
    },
    playlists: Array.isArray(shelf.playlists) ? shelf.playlists : [],
    tracks: Array.isArray(liked.songs) ? liked.songs : [],
  };
}

/* ------------------------------------------------------------ 封面本地化 */

const EXT_OF_TYPE = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

/* 网易图床认 ?param=WxH 这个缩略参数。原图动辄 3–7MB（实测有 7.1MB 的歌单封面），
   公开页面用不着那个尺寸，直接要小图：头像 200、封面 400。 */
const THUMB_SIZE = { avatar: '200y200', liked: '400y400' };
const THUMB_DEFAULT = '400y400';

const thumbUrl = (url, key) => {
  try {
    const u = new URL(url);
    u.searchParams.set('param', THUMB_SIZE[key] || THUMB_DEFAULT);
    return u.toString();
  } catch {
    return url;
  }
};

/* 把 images 里那几个地址下到 mediaDir，回一张 key → 站内地址 的表。
   取不到就跳过（那张图留空），绝不把第三方地址写进快照。 */
export async function localizeImages({
  images,
  mediaDir,
  fetchImpl = fetch,
  timeoutMs = IMAGE_TIMEOUT,
  log = () => {},
}) {
  const out = new Map();
  if (!Array.isArray(images) || !images.length) return out;
  mkdirSync(mediaDir, { recursive: true });

  for (const item of images) {
    const key = String(item && item.key ? item.key : '');
    /* 双保险：这里再认一次图床（sanitize 已经筛过，但这一层不该只靠上游） */
    const url = imageOf(item && item.url);
    if (!key || !url) continue;
    try {
      const res = await fetchImpl(thumbUrl(url, key), {
        headers: { referer: 'https://music.163.com/', 'user-agent': UA },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        log(`封面取不到（HTTP ${res.status}）：${key}`);
        continue;
      }
      const type = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      const ext = EXT_OF_TYPE[type];
      if (!ext) {
        log(`那一头不是图片（${type || '没给类型'}）：${key}`);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length || buf.length > IMAGE_MAX) {
        log(`封面太大或空：${key}（${buf.length} 字节）`);
        continue;
      }
      const name = `${key}${ext}`;
      writeFileSync(join(mediaDir, name), buf);
      out.set(key, `/media/kumura/${name}`);
    } catch (err) {
      log(`封面下载失败：${key}（${err && err.message}）`);
    }
  }
  return out;
}

/* 把本地化结果填回快照那三个图片位 */
export function applyImages(snapshot, map) {
  if (!snapshot || !map || !map.size) return snapshot;
  if (snapshot.profile && map.has('avatar')) snapshot.profile.avatar = map.get('avatar');
  if (snapshot.liked && map.has('liked')) snapshot.liked.cover = map.get('liked');
  for (const item of snapshot.playlists || []) {
    const hit = map.get(`pl-${item.id}`);
    if (hit) item.cover = hit;
  }
  return snapshot;
}

/* 收走 media/kumura/ 里上一版留下的图（歌单删了 / 换了封面都会留下孤儿）。
   只在这个目录里动手，目录是这一套自己建的。 */
export function pruneImages(mediaDir, keep) {
  if (!existsSync(mediaDir)) return 0;
  const wanted = new Set(Array.from(keep || []));
  let removed = 0;
  for (const name of readdirSync(mediaDir)) {
    if (wanted.has(name)) continue;
    try {
      unlinkSync(join(mediaDir, name));
      removed++;
    } catch {
      /* 删不掉就算了，下次再说 */
    }
  }
  return removed;
}

/* ------------------------------------------------------------------ 读 */

/* 读已发布的快照。没有 / 坏了 / 版本对不上 → null（页面按「还没发布」处理） */
export function readSnapshot(file) {
  try {
    if (!existsSync(file)) return null;
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    if (!raw || typeof raw !== 'object') return null;
    if (raw.version !== SNAPSHOT_VERSION) return null;
    if (!raw.profile || !Array.isArray(raw.playlists) || !raw.liked) return null;
    return raw;
  } catch {
    return null;
  }
}

/* 给接口 / 命令行报数用的一句话摘要 */
export function snapshotSummary(snapshot) {
  if (!snapshot) return { at: null, playlists: 0, tracks: 0, nickname: '' };
  return {
    at: snapshot.at || null,
    nickname: (snapshot.profile && snapshot.profile.nickname) || '',
    playlists: (snapshot.playlists || []).length,
    tracks: (snapshot.liked && snapshot.liked.tracks ? snapshot.liked.tracks.length : 0),
    trackCount: (snapshot.liked && snapshot.liked.trackCount) || 0,
  };
}

/* ------------------------------------------------------------------ 一次发布 */

/* 采集 → 脱敏 → 下封面 → 落盘。返回 { snapshot, images, localized, pruned }。
   落盘走「临时文件 + rename」，与 server/utils/store.ts 同一条规矩：
   中途断电不会留下半个 JSON。 */
export async function publishSnapshot({
  service,
  sid,
  dataFile,
  mediaDir,
  trackCap = TRACK_CAP,
  now = new Date(),
  fetchImpl = fetch,
  log = () => {},
}) {
  const collected = await collectFromService({ service, sid, trackCap, fetchImpl });
  const { snapshot, images } = sanitizeSnapshot(collected, { now, trackCap });
  const localized = await localizeImages({ images, mediaDir, fetchImpl, log });
  applyImages(snapshot, localized);

  mkdirSync(dirname(dataFile), { recursive: true });
  const tmp = `${dataFile}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(snapshot, null, 2), 'utf8');
  renameSync(tmp, dataFile);

  /* 本地留下的图只保留这一版用得上的那几张 */
  const keep = Array.from(localized.values()).map((p) => p.split('/').pop());
  const pruned = pruneImages(mediaDir, keep);

  return { snapshot, images: images.length, localized: localized.size, pruned };
}

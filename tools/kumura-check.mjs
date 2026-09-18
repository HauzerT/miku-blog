/* ==========================================================================
   tools/kumura-check.mjs · 云村「公网快照」这条路的自检
   ---------------------------------------------------------------------------
   这一套的风险全在**边界**上：什么字段能出去、图片能去哪儿取、访客能不能触发
   发布。所以这份自检盯的就是这三处，而不是「页面好不好看」：

     1) 脱敏：uid / 性别 / 省市 / 生日 / 背景图 / 每日推荐 / **播放地址**
        一个都不许活下来；昵称等级粉丝这些该留的要留住。
     2) 图床白名单：只认 xxx.music.126.net，且 http 要升成 https；
        p1.music.126.net.evil.com、evil.com/p1.music.126.net/ 这类拼出来的
        名字一律拒掉。
     3) 已发布的快照（data/kumura.json）：不含禁区字符串、封面全在站内、
        引用的图在 media/kumura/ 里真的存在。
     4) 公开接口（给了地址才跑）：GET /api/kumura 公开可读且不带禁区；
        POST /api/kumura/publish 没口令必须 401/403。

   跑法：
     node tools/kumura-check.mjs                         只跑纯逻辑那几组
     node tools/kumura-check.mjs http://127.0.0.1:3987   再敲一遍公开接口

   零依赖，不联网（除了第 4 组敲你自己的服务）。
   ========================================================================== */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeSnapshot, readSnapshot, snapshotSummary } from '../server/lib/kumura-snapshot.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT_FILE = join(ROOT, 'data', 'kumura.json');
const MEDIA_DIR = join(ROOT, 'media', 'kumura');
const BASE = (process.argv[2] || '').replace(/\/+$/, '');

const results = [];
const problems = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  if (!pass) problems.push(`${name}  ${detail}`);
  console.log(`${pass ? '  ok  ' : '  XX  '} ${name}${detail ? `  — ${detail}` : ''}`);
};

/* 一份「什么坏东西都往里塞」的假采集结果 */
const HOSTILE = {
  profile: {
    uid: 123456789,
    nickname: 'hitori_bocchi',
    avatar: 'http://p3.music.126.net/avatar.jpg',
    signature: '签名',
    gender: 1,
    province: 440000,
    city: 440300,
    birthday: 946684800000,
    background: 'https://p1.music.126.net/bg.jpg',
    follows: 35,
    followers: 12,
    playlists: 31,
    level: 8,
    listenSongs: 4242,
    createDays: 2287,
    vip: { type: 11, label: '黑胶 VIP' },
  },
  liked: { id: 5065026085, name: '我喜欢的音乐', trackCount: 2421, cover: 'http://p1.music.126.net/liked.jpg' },
  playlists: [
    {
      id: 18338239905,
      name: '一张歌单',
      trackCount: 41,
      cover: 'http://p1.music.126.net/pl.jpg',
      playCount: 4,
      creator: { userId: 123456789, nickname: 'hitori_bocchi' },
      trackIds: [{ id: 1, at: 2 }],
    },
  ],
  /* 采集侧根本不该带这些；带上了也必须被丢掉 */
  tracks: [
    {
      id: 3376495083,
      name: '一首歌',
      artist: '某人',
      album: '某专辑',
      url: 'https://music.163.com/song?id=3376495083',
      playUrl: 'http://m701.music.126.net/20260918/abc/xxx.mp3?authSecret=deadbeef',
      fee: 1,
      likedAt: 1750000000000,
    },
  ],
  daily: [{ id: 1, name: '每日推荐里的歌' }],
};

const rawOf = (o) => JSON.stringify(o);

/* ================================================================ 1. 脱敏 */
console.log('\n— 1. 脱敏：白名单只放该放的 —');
{
  const { snapshot, images } = sanitizeSnapshot(HOSTILE, { now: new Date('2026-09-18T00:00:00Z') });
  const text = rawOf(snapshot);

  check('uid 不进快照', !text.includes('"uid"') && !text.includes('123456789'));
  check(
    '性别 / 省市 / 生日 / 背景图 不进快照',
    !/gender|province|city|birthday|background/.test(text)
  );
  check('每日推荐不进快照', !text.includes('daily') && !text.includes('每日推荐里的歌'));
  check(
    '播放地址（带签名的 CDN 直链）不进快照',
    !/m701\.music\.126\.net|authSecret|\.mp3/i.test(text),
    text.match(/m701[^"]{0,40}/) ? '居然带上了' : ''
  );
  check('采集侧多带的字段（fee / likedAt / creator）不进快照', !/fee|likedAt|creator/.test(text));

  check(
    '该留的留住了：昵称 / 等级 / 听歌数 / 粉丝 / 注册天数 / VIP',
    snapshot.profile.nickname === 'hitori_bocchi' &&
      snapshot.profile.level === 8 &&
      snapshot.profile.listenSongs === 4242 &&
      snapshot.profile.followers === 12 &&
      snapshot.profile.createDays === 2287 &&
      snapshot.profile.vip === '黑胶 VIP'
  );
  check(
    '歌单只留白名单那几个字段',
    Object.keys(snapshot.playlists[0]).join(',') === 'id,name,trackCount,cover,playCount,url',
    Object.keys(snapshot.playlists[0]).join(',')
  );
  check(
    '曲目只留白名单那几个字段',
    Object.keys(snapshot.liked.tracks[0]).join(',') === 'id,name,artist,album,url,missing',
    Object.keys(snapshot.liked.tracks[0]).join(',')
  );
  check(
    '曲目的 url 是网易云网页地址，不是音频直链',
    snapshot.liked.tracks[0].url === 'https://music.163.com/song?id=3376495083' &&
      snapshot.playlists[0].url === 'https://music.163.com/playlist?id=18338239905'
  );
  check('快照带版本号与发布时间', snapshot.version === 1 && snapshot.at === '2026-09-18T00:00:00.000Z');
  check('红心总数按采集值留着（列表只截前几首）', snapshot.liked.trackCount === 2421);

  /* 上限 */
  const many = sanitizeSnapshot(
    { profile: {}, liked: {}, playlists: Array.from({ length: 80 }, (_, i) => ({ id: i + 1, name: `p${i}` })), tracks: Array.from({ length: 500 }, (_, i) => ({ id: i + 1, name: `t${i}` })) },
    { trackCap: 20, playlistCap: 5 }
  ).snapshot;
  check('歌单上限生效（80 → 5）', many.playlists.length === 5, String(many.playlists.length));
  check('曲目上限生效（500 → 20）且标了 capped', many.liked.tracks.length === 20 && many.liked.capped === true);

  /* 脏输入不许炸 */
  let threw = '';
  try {
    for (const bad of [null, undefined, 'string', 42, [], { profile: 'x', liked: 7, playlists: 'no', tracks: {} }]) {
      sanitizeSnapshot(bad);
    }
  } catch (err) {
    threw = String(err && err.message);
  }
  check('空值 / 脏类型喂进来不抛异常', threw === '', threw);

  /* 图片清单：只该有白名单里那几张 */
  check(
    '图片清单只列白名单图床（头像 + 红心封面 + 歌单封面）',
    images.length === 3 && images.every((i) => /^https:\/\/[a-z0-9-]+\.music\.126\.net\//i.test(i.url)),
    JSON.stringify(images)
  );
  check('http 的图床地址被升成 https', images.every((i) => i.url.startsWith('https://')));
  check(
    '图片 key 是文件名安全的那几个',
    images.map((i) => i.key).slice().sort().join(',') === 'avatar,liked,pl-18338239905',
    images.map((i) => i.key).join(',')
  );
}

/* ============================================================ 2. 图床白名单 */
console.log('\n— 2. 图床白名单：只认网易自家域名 —');
{
  const probe = (url) => {
    const { images } = sanitizeSnapshot({ profile: { nickname: 'x', avatar: url }, liked: {}, playlists: [], tracks: [] });
    return images.length > 0;
  };
  check('https://p1.music.126.net/a.jpg 通过', probe('https://p1.music.126.net/a.jpg'));
  check('http://p3.music.126.net/a.jpg 通过（并升 https）', probe('http://p3.music.126.net/a.jpg'));
  check('p1.music.126.net.evil.com 被拒', !probe('https://p1.music.126.net.evil.com/a.jpg'));
  check('evil.com/p1.music.126.net/a.jpg 被拒', !probe('https://evil.com/p1.music.126.net/a.jpg'));
  check('music.126.net 本身（没有子域）被拒', !probe('https://music.126.net/a.jpg'));
  check('file:// 被拒', !probe('file:///C:/Windows/win.ini'));
  check('javascript: 被拒', !probe('javascript:alert(1)'));
  check('内网地址被拒', !probe('http://127.0.0.1:3170/api/account'));
  check('空串 / 垃圾串被拒', !probe('') && !probe('not a url'));
}

/* ========================================================= 3. 已发布的快照 */
console.log('\n— 3. 已发布的快照（data/kumura.json）—');
{
  const snapshot = readSnapshot(SNAPSHOT_FILE);
  if (!snapshot) {
    console.log('  ··  还没有发布过快照（data/kumura.json 不在），这一组跳过');
  } else {
    const text = readFileSync(SNAPSHOT_FILE, 'utf8');
    const s = snapshotSummary(snapshot);
    check(`读得出来：${s.nickname} · 歌单 ${s.playlists} 张 · 红心 ${s.tracks}/${s.trackCount} 首`, true);
    for (const banned of ['"uid"', 'gender', 'province', 'city', 'birthday', 'background', 'daily', 'song/url', 'MUSIC_U', 'ncm_sid', 'music.126.net', '.mp3?']) {
      check(`不含禁区「${banned}」`, !text.includes(banned));
    }
    const covers = [snapshot.profile.avatar, snapshot.liked.cover, ...snapshot.playlists.map((p) => p.cover)].filter(Boolean);
    check('封面地址全在站内 /media/kumura/', covers.every((u) => u.startsWith('/media/kumura/')), `${covers.length} 张`);
    const missing = covers.filter((u) => !existsSync(join(MEDIA_DIR, u.split('/').pop())));
    check('引用的封面文件都在 media/kumura/ 里', missing.length === 0, missing.join(', '));
    check('曲目列表没超过 200 首的封顶', snapshot.liked.tracks.length <= 200, String(snapshot.liked.tracks.length));
  }
}

/* ============================================================ 4. 公开接口 */
if (!BASE) {
  console.log('\n— 4. 公开接口 —\n  ··  没给地址，跳过（想跑：node tools/kumura-check.mjs http://127.0.0.1:3987）');
} else {
  console.log(`\n— 4. 公开接口 ${BASE} —`);
  const get = async (path, options = {}) => {
    const res = await fetch(BASE + path, { redirect: 'manual', ...options });
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    return { status: res.status, data, text };
  };

  const pub = await get('/api/kumura');
  check('GET /api/kumura 公开可读（不带口令）', pub.status === 200 && pub.data && pub.data.ok === true, String(pub.status));
  check('回体里带 published / summary / snapshot 三样', Boolean(pub.data && 'published' in pub.data && 'summary' in pub.data && 'snapshot' in pub.data));
  const local = readSnapshot(SNAPSHOT_FILE);
  check(
    'published 与本地文件一致',
    Boolean(pub.data && pub.data.published === Boolean(local)),
    `接口说 ${pub.data && pub.data.published}，本地 ${Boolean(local)}`
  );
  check('接口回体里不含禁区', !/MUSIC_U|ncm_sid|music\.126\.net|"uid"|song\/url/.test(pub.text));
  if (local) {
    const s = snapshotSummary(local);
    check(`接口里的账号与本地一致（${s.nickname}）`, pub.data.summary && pub.data.summary.nickname === s.nickname);
  }

  const noKey = await get('/api/kumura/publish', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  check('POST /api/kumura/publish 没口令必须被拦（401/403）', noKey.status === 401 || noKey.status === 403, String(noKey.status));
}

/* ================================================================ 收尾 */
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
if (problems.length) {
  console.log('\n没过的：');
  for (const p of problems) console.log(`  !! ${p}`);
}
process.exit(failed.length ? 1 : 0);

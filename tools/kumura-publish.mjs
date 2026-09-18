/* ==========================================================================
   tools/kumura-publish.mjs · 把云村歌单「拍一张照」发到公网
   ---------------------------------------------------------------------------
   站长在云村页上按那颗「发布到公网」，走的是同一条路：
     server/api/kumura/publish.post.ts → server/lib/kumura-snapshot.mjs
   这一份是**命令行那半边**：不要求站点在跑，只要求本机小服务在跑、这台机器
   还登录着。所以它适合挂定时任务（见 README「云村」一节）。

   跑法：
     node tools/kumura-publish.mjs                 采集并写 data/kumura.json
     node tools/kumura-publish.mjs --dry-run       只看会发布什么，不落盘、不下图
     node tools/kumura-publish.mjs --cap 50        红心只公开前 50 首（默认 200）
     node tools/kumura-publish.mjs --service http://127.0.0.1:3170

   前置：另开一个窗口跑 node tools/ncm-server.mjs（登录凭证在 .ncm-session.json，
   扫码登录过一次就行）。

   它只读 /api/account、/api/playlists、/api/liked 三条读接口，**永不碰
   /api/song/url**——播放地址一个都不进快照。白名单在 server/lib/kumura-snapshot.mjs，
   与网页那颗按钮共用同一份。
   ========================================================================== */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  publishSnapshot,
  readSessionSid,
  sanitizeSnapshot,
  collectFromService,
  snapshotSummary,
  TRACK_CAP,
} from '../server/lib/kumura-snapshot.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_FILE = join(ROOT, 'data', 'kumura.json');
const MEDIA_DIR = join(ROOT, 'media', 'kumura');
const SESSION_FILE = join(ROOT, '.ncm-session.json');

/* ------------------------------------------------------------------ 参数 */
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback) => {
  const i = argv.indexOf(name);
  return i > -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

const dryRun = flag('--dry-run');
const service = value('--service', process.env.NCM_SERVICE || `http://127.0.0.1:${process.env.NCM_PORT || 3170}`);
const cap = Math.min(TRACK_CAP, Math.max(1, Number(value('--cap', TRACK_CAP)) || TRACK_CAP));

const line = (s) => console.log(s);

async function main() {
  line('');
  line(`  云村快照  ·  服务 ${service}  ·  红心上限 ${cap} 首  ·  ${dryRun ? '试跑（不落盘）' : '发布'}`);
  line('');

  const sid = readSessionSid(SESSION_FILE);
  if (!sid) {
    line('  这台机器上还没有云村登录凭证（.ncm-session.json）。');
    line('  先在 /kumura 那一页扫码登录一次，再回来跑这个。');
    process.exitCode = 1;
    return;
  }

  if (dryRun) {
    /* 试跑：采集 + 脱敏，但不下载封面、不写文件。看的是「会公开什么」 */
    const collected = await collectFromService({ service, sid, trackCap: cap });
    const { snapshot, images } = sanitizeSnapshot(collected, { trackCap: cap });
    const s = snapshotSummary(snapshot);
    line(`  账号      ${s.nickname || '（没取到昵称）'}`);
    line(`  歌单      ${s.playlists} 张`);
    line(`  红心      ${s.tracks} 首公开 / 共 ${s.trackCount} 首`);
    line(`  要下的封面 ${images.length} 张`);
    line('');
    line('  试跑到此为止，什么都没写。去掉 --dry-run 就真发布。');
    line('');
    return;
  }

  const out = await publishSnapshot({
    service,
    sid,
    dataFile: DATA_FILE,
    mediaDir: MEDIA_DIR,
    trackCap: cap,
    log: (s) => line(`  · ${s}`),
  });

  const s = snapshotSummary(out.snapshot);
  line('');
  line(`  发布完成  ${s.at}`);
  line(`  账号      ${s.nickname || '（没取到昵称）'}`);
  line(`  歌单      ${s.playlists} 张`);
  line(`  红心      ${s.tracks} 首公开 / 共 ${s.trackCount} 首`);
  line(`  封面      ${out.localized}/${out.images} 张下到 media/kumura/`);
  if (out.pruned) line(`  清掉旧图  ${out.pruned} 张`);
  line(`  快照      data/kumura.json${existsSync(DATA_FILE) ? '' : '（没写成功？）'}`);
  line('');
  line('  访客现在读 GET /api/kumura 这一份；凭证与播放地址都不在里面。');
  line('');
}

main().catch((err) => {
  console.error(`\n  发布失败：${err && err.message}\n`);
  process.exitCode = 1;
});

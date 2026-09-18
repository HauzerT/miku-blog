/* ==========================================================================
   server/utils/kumura.ts · 云村快照的三个固定位置
   ---------------------------------------------------------------------------
   快照这一套要碰三个文件/目录，位置只在这里说一次：

     data/kumura.json      公开快照本体（data/* 不入库，见 .gitignore）
     media/kumura/         快照里那几张封面（发布时从网易图床下到这里）
     .ncm-session.json     本机登录凭证——**只读它的 sid**，用来问本机小服务

   前两个跟着 paths.ts 的 DATA / MEDIA 走；第三个在仓库根。给接口层用，
   命令行那一侧（tools/kumura-publish.mjs）自己按 import.meta.url 推根目录——
   它不在 Nitro 里跑，拿不到 paths.ts 的 ROOT（理由见 paths.ts 开头）。
   ========================================================================== */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATA, MEDIA, ROOT } from './paths';
import { readSnapshot, snapshotSummary } from '../lib/kumura-snapshot.mjs';

export const KUMURA_FILE = join(DATA, 'kumura.json');
export const KUMURA_MEDIA = join(MEDIA, 'kumura');
export const KUMURA_SESSION = join(ROOT, '.ncm-session.json');

/* 已经发布的那一份；没发布过（或坏了）就是 null */
export const getKumuraSnapshot = () => readSnapshot(KUMURA_FILE);

/* 门厅用：只问「发布过没有」，不解析。门厅在每一次请求上都要跑，
   不该为了一个是非题去读一个两百首的文件。落盘是临时文件 + rename，
   所以文件在就等于一份完整的快照在。 */
export const hasKumuraSnapshot = () => existsSync(KUMURA_FILE);

export { snapshotSummary };

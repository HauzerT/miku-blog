/* POST /api/kumura/publish · 站长按一下「发布到公网」
   ---------------------------------------------------------------------------
   要口令（requireAuth）。这一条是快照唯一的入口，做的四件事：

     1) 拿 .ncm-session.json 里的 sid，去问**本机**小服务要账号 / 歌单 / 红心
        （只读三条接口，永不碰 /api/song/url——播放地址一个都不进快照）
     2) 按白名单脱敏（uid、性别、省市、生日、每日推荐、播放地址全部出局）
     3) 把封面下到 media/kumura/，快照里只留站内地址
     4) 写 data/kumura.json

   之后访客读的是 GET /api/kumura 那一份**静态快照**：流量不经过网易，也不经过
   这个账号——这正是当初决定「听」只用站上音乐盒之后，剩下那一半风险的答案。

   失败一律 502：这一跳依赖的是本机小服务与网易，不是请求本身写错了。 */
import { publishSnapshot, readSessionSid, snapshotSummary } from '../../lib/kumura-snapshot.mjs';
import { requireAuth } from '../../utils/auth';
import { defineApiHandler, httpError } from '../../utils/http';
import { KUMURA_FILE, KUMURA_MEDIA, KUMURA_SESSION } from '../../utils/kumura';

/* 小服务的地址：与 tools/ncm-server.mjs 的 NCM_PORT 对齐，
   想指别处就用 NCM_SERVICE 给一整条 */
const service = () => process.env.NCM_SERVICE || `http://127.0.0.1:${process.env.NCM_PORT || 3170}`;

export default defineApiHandler(async (event) => {
  requireAuth(event);

  try {
    const out = await publishSnapshot({
      service: service(),
      sid: readSessionSid(KUMURA_SESSION),
      dataFile: KUMURA_FILE,
      mediaDir: KUMURA_MEDIA,
      log: (line: string) => console.log('[云村快照]', line),
    });
    return {
      ok: true,
      mode: 'published',
      ...snapshotSummary(out.snapshot),
      images: out.images,
      localized: out.localized,
      pruned: out.pruned,
    };
  } catch (err: any) {
    throw httpError(502, err?.message || '发布失败');
  }
});

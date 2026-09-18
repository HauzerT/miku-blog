/* GET /api/kumura · 云村的公开快照（访客读的就是这一份）
   ---------------------------------------------------------------------------
   公开可读，与 /api/music 同一条规矩：这一页对访客是**只读展示**，而账号数据
   在「发布」那一刻就已经脱敏过一遍（白名单见 server/lib/kumura-snapshot.mjs）。

   回 snapshot: null 表示站长还没发布过——页面据此说清楚，而不是假装空歌单。
   published / summary 是给页面和自检看的两个便利字段。 */
import { defineApiHandler } from '../utils/http';
import { getKumuraSnapshot, snapshotSummary } from '../utils/kumura';

export default defineApiHandler(() => {
  const snapshot = getKumuraSnapshot();
  return {
    ok: true,
    published: Boolean(snapshot),
    summary: snapshotSummary(snapshot),
    snapshot,
  };
});

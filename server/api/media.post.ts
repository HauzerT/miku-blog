/* POST /api/media · 上传媒体（编辑页插图片 / 视频 / 音频都走这里）
   要口令。字段：kind（'image' / 'video' / 'audio'，不给就按文件认）。
   每个回来的文件多带一个 label（「图片」/「视频」/「音频」），前端直接拿去显示。 */
import { setResponseStatus } from 'h3';
import { requireAuth } from '../utils/auth';
import { defineApiHandler, httpError } from '../utils/http';
import { KIND_LABEL, readForm, saveUpload } from '../utils/media-store';

export default defineApiHandler(async (event) => {
  requireAuth(event);

  const { fields, files } = await readForm(event);
  if (!files.length) throw httpError(400, '没有收到文件');

  const wanted = (fields.kind || '').trim();
  const uploaded = files.map((file) => {
    const asset = saveUpload(file, wanted || undefined);
    return { ...asset, label: KIND_LABEL[asset.kind] || asset.kind };
  });

  setResponseStatus(event, 201);
  return { ok: true, files: uploaded };
});

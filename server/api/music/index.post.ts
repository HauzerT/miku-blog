/* POST /api/music · 上传曲目（multipart 表单）
   要口令。字段：title、artist；文件必须认得出是音频（后缀优先，MIME 兜底）。
   多个文件一次传也可以，全部成功才回 201 —— 中途认错类型会整单 400，
   但已经写进 media/music/ 的那几个文件会留在盘上（与旧服务一致）。 */
import { setResponseStatus } from 'h3';
import { requireAuth } from '../../utils/auth';
import { defineApiHandler, httpError } from '../../utils/http';
import { kindOf, readForm, saveUpload, UploadError } from '../../utils/media-store';
import { getMusic, id as newId, saveMusic } from '../../utils/store';

export default defineApiHandler(async (event) => {
  requireAuth(event);

  const { fields, files } = await readForm(event);
  if (!files.length) throw httpError(400, '没有收到音频文件');

  const added: any[] = [];
  for (const file of files) {
    if (kindOf(file) !== 'audio') throw new UploadError(`${file.filename} 不是音频（支持 mp3 / m4a / wav / ogg / flac）`);
    const saved = saveUpload(file, 'audio');
    const entry = {
      id: newId('m_'),
      title: (fields.title || saved.original.replace(/\.[^.]+$/, '')).slice(0, 120),
      artist: (fields.artist || '').slice(0, 60),
      file: saved.file,
      url: saved.url,
      size: saved.size,
      type: saved.type,
      at: new Date().toISOString(),
      source: 'upload',
    };
    getMusic().tracks.push(entry);
    added.push(entry);
  }
  saveMusic(getMusic());

  setResponseStatus(event, 201);
  return { ok: true, added: added.length, tracks: added };
});

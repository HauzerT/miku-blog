/* ==========================================================================
   server/utils/media-store.ts · 上传落盘
   ---------------------------------------------------------------------------
   把 multipart 解析出来的文件规规矩矩放进 media/：
     images/   文章里的图片
     videos/   文章里的视频
     music/    音乐盒的曲目（也算文章里能放的音频）
   文件名统一重写成 `<日期>-<8位十六进制>-<安全主干><后缀>`：原始文件名只留一份在
   JSON 里，磁盘上永远不会有中文空格括号带来的路径问题，也不会互相覆盖。

   目录来源是 server/utils/paths.ts（它按 Nitro 的运行时布局推仓库根，
   1.x 那套 import.meta.url 推法打包之后是错的）。规则没动：
   **先认后缀、MIME 只作兜底**，因为 Windows 有时候对 .m4a 报 audio/x-m4a
   或干脆 application/octet-stream。
   ========================================================================== */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { H3Event } from 'h3';
import { getRequestHeader, readMultipartFormData } from 'h3';
import { HttpError, tooBigMessage } from './http';
import { MAX_BODY, MEDIA_DIRS, safePath } from './paths';
import { registerPublicAsset, unregisterPublicAsset } from './static-assets';
import { extOf } from './store';

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp', '.svg']);
const VIDEO_EXT = new Set(['.mp4', '.m4v', '.webm', '.mov', '.ogv', '.mkv']);
const AUDIO_EXT = new Set(['.mp3', '.m4a', '.mp4', '.aac', '.wav', '.ogg', '.oga', '.opus', '.flac', '.webm']);

const IMAGE_MIME = /^image\/(jpeg|png|gif|webp|avif|bmp|svg\+xml)$/i;
const VIDEO_MIME = /^video\/(mp4|webm|quicktime|x-matroska|ogg)$/i;
const AUDIO_MIME = /^audio\/|^video\/(mp4|webm|ogg)$/i;

/* 认出来的类型 → 放哪个桶 */
const BUCKET_OF: Record<string, string> = { image: 'images', video: 'videos', audio: 'music' };

export const KIND_LABEL: Record<string, string> = { image: '图片', video: '视频', audio: '音频' };

/* 与旧 UploadError 一样带 400 —— 收口那一层只看 error.status */
export class UploadError extends HttpError {
  constructor(message: string) {
    super(400, message);
  }
}

export interface UploadPart {
  name?: string;
  filename?: string;
  type?: string;
  data: Buffer;
  size?: number;
}

/* 认后缀：优先看浏览器给的文件名，MIME 只作兜底 */
export function kindOf(file: { filename?: string; type?: string }): string | null {
  const ext = extOf(file.filename || '');
  const type = String(file.type || '');
  if (IMAGE_EXT.has(ext) || (IMAGE_MIME.test(type) && ext !== '.svg')) return 'image';
  if (VIDEO_EXT.has(ext) || VIDEO_MIME.test(type)) return 'video';
  if (AUDIO_EXT.has(ext) || AUDIO_MIME.test(type)) return 'audio';
  return null;
}

function safeBase(filename: unknown): string {
  const raw = String(filename || 'file')
    .replace(/\\/g, '/')
    .split('/')
    .pop() as string;
  /* 只留字母数字、中日韩、横线点，别的（空格、括号、引号、控制符）一律换成下划线 */
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[^\w\u4e00-\u9fff\u3040-\u30ff.\-]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[.\-]+/, '');
  const base = cleaned.replace(/\.[^.]+$/, '').slice(0, 48) || 'file';
  return base;
}

export function storedName(file: { filename?: string }): string {
  const ext = extOf(file.filename || '') || '.bin';
  const stamp = new Date().toISOString().slice(0, 10);
  return `${stamp}-${randomBytes(4).toString('hex')}-${safeBase(file.filename)}${ext}`;
}

/* 存一个文件。wanted 是想要的类型（'image' / 'video' / 'audio'），不给就按认出来的算。
   返回 { kind, bucket, file, url, original, size, type } */
export function saveUpload(file: UploadPart, wanted?: string) {
  const kind = kindOf(file);
  if (!kind) throw new UploadError(`${file.filename || '(没有名字)'} 不是图片、视频或音频`);
  if (wanted && wanted !== kind) {
    throw new UploadError(`${file.filename} 不是${KIND_LABEL[wanted] || wanted}（认出来是${KIND_LABEL[kind]}）`);
  }
  if (!file.data || !file.data.length) throw new UploadError(`${file.filename || '文件'} 是空的`);

  const bucket = BUCKET_OF[kind];
  const name = storedName(file);
  const dir = MEDIA_DIRS[bucket];
  mkdirSync(dir, { recursive: true });
  const full = join(dir, name);
  if (existsSync(full)) throw new UploadError('文件名撞车，请重试');
  writeFileSync(full, file.data);
  /* 刚写下来的文件不在 Nitro 那张（构建时烘出来的）静态资源表里，
     不补进去的话 /media/… 会 404，直到下一次构建——见 static-assets.ts */
  registerPublicAsset(`/media/${bucket}/${name}`, full);

  return {
    kind,
    bucket,
    file: name,
    original: String(file.filename || name),
    size: file.data.length,
    type: file.type || '',
    url: `/media/${bucket}/${name}`,
  };
}

/* 从盘上抹掉一个上传物。文件被占用就留着——数据不能因为一个删不掉的文件而写不进去 */
export function removeMedia(bucket: string, file: string): void {
  const dir = MEDIA_DIRS[bucket];
  if (!dir || !file) return;
  const full = safePath(dir, file);
  if (full && existsSync(full)) {
    try { rmSync(full); } catch { /* 文件被占用就留着，不影响数据 */ }
  }
  /* 条目也得跟着走：留着它，请求会读到不存在的文件上炸成 500（见 static-assets.ts） */
  unregisterPublicAsset(`/media/${bucket}/${file}`);
}

/* 一条文章记录的附件清单：字段长度封顶、认不出的桶与类型落回默认值 */
export function cleanAssets(list: unknown) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 80).map((a: any) => ({
    kind: ['image', 'video', 'audio'].includes(a && a.kind) ? a.kind : 'image',
    bucket: ['images', 'videos', 'music'].includes(a && a.bucket) ? a.bucket : 'images',
    file: String((a && a.file) || '').slice(0, 160),
    url: String((a && a.url) || '').slice(0, 300),
    original: String((a && a.original) || '').slice(0, 200),
    size: Number((a && a.size) || 0),
    type: String((a && a.type) || '').slice(0, 80),
  })).filter((a) => a.file && a.url);
}

/* ------------------------------------------------------------------ 表单
   解析交给 h3 的 readMultipartFormData，契约是
   { fields, files:[{name,filename,type,data,size}] }——调用方
   （/api/music、/api/media、/api/sections…）只管照着这个形状取。

   一处差别要说明：h3 的解析器不带上限，所以「读之前先看 content-length」这一步
   必须我们自己来（见 paths.ts 的 MAX_BODY）；没有 content-length 的分块上传
   （浏览器正常不会这么发）就没有边读边数的第二道闸。 */
export async function readForm(event: H3Event) {
  const type = getRequestHeader(event, 'content-type') || '';
  if (!/multipart\/form-data/i.test(type)) throw new HttpError(400, '需要 multipart/form-data');

  const declared = Number(getRequestHeader(event, 'content-length') || 0);
  if (declared && declared > MAX_BODY) throw new HttpError(413, tooBigMessage(MAX_BODY));

  const parts = (await readMultipartFormData(event)) || [];
  const fields: Record<string, string> = {};
  const files: UploadPart[] = [];
  for (const part of parts as any[]) {
    if (part.filename !== undefined) {
      const data: Buffer = part.data || Buffer.alloc(0);
      files.push({
        name: part.name || '',
        filename: part.filename,
        type: part.type || 'application/octet-stream',
        data,
        size: data.length,
      } as UploadPart);
    } else if (part.name) {
      fields[part.name] = (part.data || Buffer.alloc(0)).toString('utf8');
    }
  }
  return { fields, files };
}

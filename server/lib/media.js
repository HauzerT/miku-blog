/* ==========================================================================
   server/lib/media.js · 上传落盘
   ---------------------------------------------------------------------------
   把 multipart 解析出来的文件规规矩矩放进 media/：
     images/   文章里的图片
     videos/   文章里的视频
     music/    音乐盒的曲目（也算文章里能放的音频）
   文件名统一重写成 `<日期>-<随机>.<安全后缀>`：原始文件名只留一份在 JSON 里，
   磁盘上永远不会有中文空格括号带来的路径问题，也不会互相覆盖。
   ========================================================================== */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { MEDIA_DIRS, extOf } from './store.mjs';

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp', '.svg']);
const VIDEO_EXT = new Set(['.mp4', '.m4v', '.webm', '.mov', '.ogv', '.mkv']);
const AUDIO_EXT = new Set(['.mp3', '.m4a', '.mp4', '.aac', '.wav', '.ogg', '.oga', '.opus', '.flac', '.webm']);

const IMAGE_MIME = /^image\/(jpeg|png|gif|webp|avif|bmp|svg\+xml)$/i;
const VIDEO_MIME = /^video\/(mp4|webm|quicktime|x-matroska|ogg)$/i;
const AUDIO_MIME = /^audio\/|^video\/(mp4|webm|ogg)$/i;

/* 认出来的类型 → 放哪个桶 */
const BUCKET_OF = { image: 'images', video: 'videos', audio: 'music' };

export class UploadError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

/* 认后缀：优先看浏览器给的文件名，MIME 只作兜底。
   Windows 有时候对 .m4a 报 audio/x-m4a 或干脆 application/octet-stream。 */
export function kindOf(file) {
  const ext = extOf(file.filename || '');
  const type = String(file.type || '');
  if (IMAGE_EXT.has(ext) || (IMAGE_MIME.test(type) && ext !== '.svg')) return 'image';
  if (VIDEO_EXT.has(ext) || VIDEO_MIME.test(type)) return 'video';
  if (AUDIO_EXT.has(ext) || AUDIO_MIME.test(type)) return 'audio';
  return null;
}

export const KIND_LABEL = { image: '图片', video: '视频', audio: '音频' };

function safeBase(filename) {
  const raw = String(filename || 'file')
    .replace(/\\/g, '/')
    .split('/')
    .pop();
  /* 只留字母数字、中日韩、横线点，别的（空格、括号、引号、控制符）一律换成下划线 */
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[^\w\u4e00-\u9fff\u3040-\u30ff.\-]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[.\-]+/, '');
  const base = cleaned.replace(/\.[^.]+$/, '').slice(0, 48) || 'file';
  return base;
}

export function storedName(file) {
  const ext = extOf(file.filename || '') || '.bin';
  const stamp = new Date().toISOString().slice(0, 10);
  return `${stamp}-${randomBytes(4).toString('hex')}-${safeBase(file.filename)}${ext}`;
}

/* 存一个文件。wanted 是想要的类型（'image' / 'video' / 'audio'），不给就按认出来的算。
   返回 { kind, bucket, file, url, original, size, type } */
export function saveUpload(file, wanted) {
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

  return {
    kind,
    bucket,
    file: name,
    original: String(file.filename || name),
    size: file.data.length,
    type: file.type || '',
    /* URL 里直接放原始文件名：浏览器取的时候自己会编码，
       服务端也只解码一次。中文名在地址栏里也是可读的。 */
    url: `/media/${bucket}/${name}`,
  };
}

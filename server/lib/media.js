/* ==========================================================================
   server/lib/media.js · 上传落盘
   ---------------------------------------------------------------------------
   把 multipart 解析出来的文件规规矩矩放进 media/：
     images/   说说里的图片
     stickers/ 表情包
     videos/   视频
     music/    音乐盒的曲目
   文件名统一重写成 `<日期>-<随机>.<安全后缀>`：原始文件名只留一份在 JSON 里，
   磁盘上永远不会有中文空格括号带来的路径问题，也不会互相覆盖。
   ========================================================================== */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { MEDIA_DIRS, extOf } from './store.mjs';

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp', '.svg']);
const VIDEO_EXT = new Set(['.mp4', '.m4v', '.webm', '.mov', '.ogv', '.mkv']);
const AUDIO_EXT = new Set(['.mp3', '.m4a', '.mp4', '.aac', '.wav', '.ogg', '.oga', '.opus', '.flac', '.webm']);
const STICKER_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif']);

const IMAGE_MIME = /^image\/(jpeg|png|gif|webp|avif|bmp|svg\+xml)$/i;
const VIDEO_MIME = /^video\/(mp4|webm|quicktime|x-matroska|ogg)$/i;
const AUDIO_MIME = /^audio\/|^video\/(mp4|webm|ogg)$/i;

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
  if (STICKER_EXT.has(ext)) return 'sticker';
  return null;
}

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

/* 存一个文件，返回 { url, file, kind, size, type, original } */
export function saveUpload(file, wanted) {
  const kind = kindOf(file);
  if (!kind) throw new UploadError(`不认得的文件类型：${file.filename || '(没有名字)'}`);

  let bucket = wanted || kind;
  if (wanted === 'image' && kind !== 'image') throw new UploadError(`${file.filename} 不是图片`);
  if (wanted === 'video' && kind !== 'video') throw new UploadError(`${file.filename} 不是视频`);
  if (wanted === 'audio' && kind !== 'audio') throw new UploadError(`${file.filename} 不是音频（支持 mp3 / m4a / wav / ogg / flac）`);

  if (kind === 'sticker') bucket = wanted || 'stickers';
  if (bucket === 'image') bucket = 'images';
  if (bucket === 'video') bucket = 'videos';
  if (bucket === 'audio') bucket = 'music';
  if (bucket === 'sticker') bucket = 'stickers';
  if (!MEDIA_DIRS[bucket]) throw new UploadError(`未知的存放位置：${bucket}`);

  if (!file.data || !file.data.length) throw new UploadError(`${file.filename || '文件'} 是空的`);

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

export function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

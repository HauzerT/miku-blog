/* ==========================================================================
   server/lib/multipart.js · 极简 multipart/form-data 解析
   ---------------------------------------------------------------------------
   零依赖：不装 busboy / formidable，直接按 boundary 切 Buffer。
   用法：
     const form = parseMultipart(buffer, req.headers['content-type']);
     form.fields.title            // 文本字段
     form.files                   // [{name, filename, type, data:Buffer, size}]
   上限由调用方在读取 body 时就卡住（见 server.mjs 的 readBody），
   所以这里不做流式——本地单人使用，几十 MB 一次性读进内存是划算的。
   ========================================================================== */

/* 单个请求体上限。一次上传的所有文件加起来算，所以留得宽一点：
   手机上拍一段一分钟的视频大概 100–200MB，卡在 64MB 会让人以为坏了。
   这个数字只影响「一次请求」——本地单人用，多占一点内存换来不折腾。 */
export const DEFAULT_LIMIT = 256 * 1024 * 1024;

export function boundaryOf(contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  const value = m && (m[1] || m[2]);
  return value ? value.trim() : '';
}

/* `name="x"; filename="y"` → { x: 'y' } */
function dispositionParams(value) {
  const out = {};
  const re = /([a-zA-Z*]+)\s*=\s*(?:"([^"]*)"|([^;]+))/g;
  let m;
  while ((m = re.exec(value))) out[m[1].toLowerCase()] = (m[2] !== undefined ? m[2] : m[3]).trim();
  return out;
}

function headerBlock(part) {
  const end = part.indexOf('\r\n\r\n');
  if (end === -1) return null;
  const raw = part.slice(0, end).toString('utf8');
  const headers = {};
  for (const line of raw.split('\r\n')) {
    const i = line.indexOf(':');
    if (i === -1) continue;
    headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return { headers, bodyStart: end + 4 };
}

export function parseMultipart(buffer, contentType, { limit = DEFAULT_LIMIT } = {}) {
  if (!Buffer.isBuffer(buffer)) throw new Error('body must be a Buffer');
  if (buffer.length > limit) throw new Error(`请求体超过 ${Math.round(limit / 1048576)}MB 上限`);

  const boundary = boundaryOf(contentType);
  if (!boundary) throw new Error('缺少 multipart boundary');

  const fields = Object.create(null);
  const files = [];
  const delim = Buffer.from(`--${boundary}`);

  let index = buffer.indexOf(delim);
  if (index === -1) throw new Error('multipart 内容里找不到 boundary');

  while (index !== -1) {
    let start = index + delim.length;
    /* 结束标记是 `--boundary--` */
    if (buffer[start] === 0x2d && buffer[start + 1] === 0x2d) break;
    if (buffer[start] === 0x0d && buffer[start + 1] === 0x0a) start += 2;

    const next = buffer.indexOf(delim, start);
    if (next === -1) break;

    /* 这一段的正文：去掉结尾的 \r\n（它是下一个 boundary 的前导） */
    let end = next;
    if (buffer[end - 2] === 0x0d && buffer[end - 1] === 0x0a) end -= 2;

    const part = buffer.subarray(start, end);
    const head = headerBlock(part);
    if (head) {
      const cd = head.headers['content-disposition'] || '';
      if (/form-data/i.test(cd)) {
        const params = dispositionParams(cd);
        const name = params.name || '';
        const body = part.subarray(head.bodyStart);
        if (params.filename !== undefined) {
          files.push({
            name,
            filename: params.filename,
            type: head.headers['content-type'] || 'application/octet-stream',
            data: body,
            size: body.length,
          });
        } else if (name) {
          fields[name] = body.toString('utf8');
        }
      }
    }
    index = next;
  }

  return { fields, files };
}

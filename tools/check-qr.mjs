/* 用 OpenCV 实扫校验：随机样本 + 登录 URL 形态，确认编码器可靠。 */
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
await import('../assets/js/qr.js');
const QR = globalThis.CV01QR;

const py = `
import sys, cv2, numpy as np, json
size = int(sys.argv[1]); path = sys.argv[2]; scale = int(sys.argv[3])
total = size + 8
img = np.frombuffer(open(path,'rb').read(), dtype=np.uint8).reshape((total, total))
img = np.where(img > 0, 0, 255).astype(np.uint8)
img = cv2.resize(img, (total*scale, total*scale), interpolation=cv2.INTER_NEAREST)
ok, decoded, pts, _ = cv2.QRCodeDetector().detectAndDecodeMulti(img)
print(json.dumps({'ok': bool(ok), 'decoded': list(decoded) if ok else []}))
`;

function decode(text, scale) {
  const qr = QR.encode(text);
  const total = qr.size + 8;
  const buf = Buffer.alloc(total * total);
  for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) {
    buf[(y + 4) * total + x + 4] = qr.modules[y][x] ? 255 : 0;
  }
  const p = `${process.env.TEMP}\\qr-${Math.random().toString(36).slice(2)}.bin`;
  writeFileSync(p, buf);
  const out = execFileSync('python', ['-c', py, String(qr.size), p, String(scale)], { encoding: 'utf8' });
  const res = JSON.parse(out.trim().split('\n').pop());
  return { qr, decoded: res.decoded, ok: res.ok && res.decoded.includes(text) };
}

const samples = [];
/* 真实登录 URL 形态（key 长度固定，只有内容不同） */
for (let i = 0; i < 6; i++) {
  const k = [...Array(36)].map(() => '0123456789abcdef'[Math.floor(Math.random() * 16)]);
  k[8] = k[13] = k[18] = k[23] = '-';
  samples.push(`https://music.163.com/login?codekey=${k.join('')}`);
}
/* 边界：短、长、含中文与特殊字符 */
samples.push('https://music.163.com/login?codekey=test');
samples.push('https://music.163.com/login?codekey=' + 'a'.repeat(60));
samples.push('云村 · 红心歌单 · HATSUNE MIKU CV01');
samples.push('https://music.163.com/login?codekey=99047eee-813a-4d4d-8976-eb8edd65cb69&chainId=abc123');

let fails = 0;
for (const s of samples) {
  /* 三种渲染密度都试：8px/模块、4px/模块、2px/模块 */
  const results = [8, 4, 2].map((scale) => {
    try { return decode(s, scale).ok; } catch { return false; }
  });
  const ok = results.every(Boolean);
  if (!ok) fails++;
  const qr = QR.encode(s);
  console.log(`${ok ? 'PASS' : 'FAIL'} v${qr.version} ${qr.size}px模块矩阵 len=${s.length}  8x=${results[0] ? 'ok' : 'no'} 4x=${results[1] ? 'ok' : 'no'} 2x=${results[2] ? 'ok' : 'no'}  ${s.slice(0, 48)}`);
}
console.log(fails ? `\n✗ ${fails}/${samples.length} 失败` : `\n✓ ${samples.length}/${samples.length} 全部被 OpenCV 正确解码（含 2px/模块 的极端密度）`);

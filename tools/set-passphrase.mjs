/* ==========================================================================
   tools/set-passphrase.mjs · 把上传口令换成一条强随机串
   ---------------------------------------------------------------------------
   为什么要有这个脚本：口令是本站**唯一**的真权限（门厅那枚章不是）。
   原来 default 生成的是 randomBytes(4).toString('hex')——8 位十六进制，
   本机跑够用；一旦用 Cloudflare Tunnel 挂到公网上，它就是一个可以被穷举的东西。
   （这个仓库的 data/settings.json 里还实际躺着一串 6 位数字。）

   用法：

     node tools/set-passphrase.mjs              # 生成一条，写进 data/settings.json，并打印
     node tools/set-passphrase.mjs --print      # 只打印现在这条（不改文件）
     node tools/set-passphrase.mjs --length 48  # 换一条更长的
     node tools/set-passphrase.mjs --ask        # 交互式：自己敲一条（不回显）

   注意：换完口令之后，**每个浏览器里记着的旧口令都失效**（localStorage 的
   cv01-key），门厅会重新问你一次。这是预期行为，不是坏了。
   服务跑着的时候改的话，要重启服务才生效（settings 是启动时读一次的）。
   ========================================================================== */

import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/* 只读 / 只写 data/settings.json 的那一小块。旧的数据层 server/lib/store.mjs 跟着
   1.x 静态线一起删了（Nuxt 的数据层是 server/utils/store.ts，走打包，命令行进不去），
   所以工具侧留一份最小的——见 tools/lib/settings.mjs 顶部那段。 */
import { loadSettings, saveSettings } from './lib/settings.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SETTINGS_FILE = join(ROOT, 'data', 'settings.json');

/* 密码学随机的口令。挑掉了 l/1/I/0/O 这些会看错的字符——它要从终端抄到另一个窗口里。
   拒绝采样：超过 limit 的字节丢掉，免得取模把前面几个字符变得更容易出现。 */
const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DEFAULT_LENGTH = 32;

function generate(length) {
  if (!Number.isInteger(length) || length < 16) {
    throw new Error('口令至少 16 位（公网部署建议 32 位以上）');
  }
  const limit = 256 - (256 % ALPHABET.length);
  let out = '';
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte >= limit) continue;
      out += ALPHABET[byte % ALPHABET.length];
      if (out.length === length) break;
    }
  }
  return out;
}

/* 熵：每个字符 log2(57) ≈ 5.83 bit */
function entropyBits(length) {
  return Math.round(length * Math.log2(ALPHABET.length));
}

function ask() {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    /* 不回显：口令不该留在终端的回滚缓冲里 */
    const onData = (char) => {
      if (String(char) === '\u0003') { rl.close(); reject(new Error('取消了')); }
    };
    process.stdin.on('data', onData);
    const origWrite = rl._writeToOutput ? rl._writeToOutput.bind(rl) : null;
    rl._writeToOutput = function (str) {
      if (str.includes('\n') || str.includes('\r')) return origWrite ? origWrite(str) : undefined;
      return undefined;
    };
    rl.question('输入新口令（不回显）：', (answer) => {
      process.stdin.removeListener('data', onData);
      rl.close();
      process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i > -1 && args[i + 1] ? args[i + 1] : fallback;
};

const settings = loadSettings();

if (has('--print')) {
  console.log(`文件  ${SETTINGS_FILE}`);
  console.log(`口令  ${settings.passphrase || '(还没设置：跑一次服务就会自动生成)'}`);
  console.log(`长度  ${settings.passphrase ? settings.passphrase.length : 0}`);
  process.exit(0);
}

let next;
if (has('--ask')) {
  next = await ask();
  if (!next) {
    console.error('没输入，什么都没改。');
    process.exit(1);
  }
} else {
  next = generate(Number(valueOf('--length', DEFAULT_LENGTH)));
}

if (next === settings.passphrase) {
  console.log('新口令和现在这条一样，没改。');
  process.exit(0);
}

settings.passphrase = next;
if (!settings.createdAt) settings.createdAt = new Date().toISOString();
settings.rotatedAt = new Date().toISOString();
saveSettings(settings);

console.log('');
console.log('  口令已换 · 初音ミク CV01');
console.log('  ─────────────────────────────────────────────');
console.log(`  新口令    ${next}`);
console.log(`  长度      ${next.length} 位 · 约 ${entropyBits(next.length)} bit 熵`);
console.log(`  写在      ${SETTINGS_FILE}`);
console.log('');
console.log('  接下来：');
console.log('    1. 重启服务（settings 是启动时读一次的）：stop.cmd 然后 start.cmd');
console.log('       跑着服务时用 deploy\\start-blog-background.cmd 起的，就 stop.cmd 再起一次它');
console.log('    2. 每个浏览器里记着的旧口令都失效了，门厅会重新问你一次（这是预期的）');
console.log('    3. 这条口令不要贴进聊天、issue、截图或任何会被搜到的地方');
console.log('');

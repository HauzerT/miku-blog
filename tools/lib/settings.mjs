/* ==========================================================================
   tools/lib/settings.mjs · 命令行工具读口令用的最小数据层
   ---------------------------------------------------------------------------
   为什么单独有这么一份：数据层原先在 server/lib/store.mjs 里，但它服务的是那条
   已经删掉的 1.x 静态线（外壳、动态页面、文章装配）。Nuxt 那一侧的数据层是
   server/utils/store.ts，走 Nitro 的别名与打包，**命令行工具 import 不了**。

   而 tools/set-passphrase.mjs 与 tools/preflight-check.mjs 这两件工具必须留在
   命令行里跑（换口令、上线前预检都要在没有服务的情况下能用），所以这里只留它们
   真正用得着的一件事：**读写 data/settings.json**。写盘沿用「临时文件 + rename」，
   中途断电不会写出半个 JSON。

   这不是第二个数据层——它没有板块、文章、曲库、覆盖层的任何概念。别往这里长东西；
   要动那些，去改 server/utils/store.ts。
   ========================================================================== */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SETTINGS_FILE = join(ROOT, 'data', 'settings.json');

/* 与 server/utils/store.ts 的 DEFAULT_SETTINGS 保持一致：两项都是空值起步 */
const DEFAULT_SETTINGS = { passphrase: '', createdAt: null };

function readJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    console.warn(`[settings] ${file} 解析失败，用默认值顶上：${err.message}`);
    return fallback;
  }
}

function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  renameSync(tmp, file);
}

export function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...readJson(SETTINGS_FILE, {}) };
}

export function saveSettings(value) {
  writeJson(SETTINGS_FILE, value);
}

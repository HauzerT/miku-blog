/* ==========================================================================
   tools/secret-scan.mjs · 提交前扫一遍密钥与本机实况
   ---------------------------------------------------------------------------
   回答两个问题：

     A. 仓库里有没有**凭据**？GitHub 令牌、云厂商 key、私钥、JWT、
        Cloudflare tunnel token、网易云登录 cookie、以及 `password = "…"`
        这种写在赋值里的口令。

     B. 有没有把**只属于这台机器的东西**又写回公开仓库？域名、隧道 ID、
        DSH 的绝对安装路径、Windows 用户名。

   B 这件事 gitleaks 做不了——它不知道你这台机器长什么样。所以本地那份
   deploy/local.config.ps1（在 .gitignore 里）会被读进来当尺子：里面的值
   一旦出现在被跟踪的文件、暂存区或历史里，就报出来。换机器、换域名之后
   不用改这个脚本，改那个配置文件就行。

   装了 gitleaks 就用它跑 A（规则更全）；没装就用自带的规则集，照样能跑。
   B 永远用自己的逻辑——找不到 gitleaks 不是「跳过」，这正是它存在的意义。

   用法：

     node tools/secret-scan.mjs              # 工作区 + 暂存区 + 历史
     node tools/secret-scan.mjs --staged     # 只扫暂存区（pre-commit 用的就是这个）
     node tools/secret-scan.mjs --history    # 只翻历史
     node tools/secret-scan.mjs --list       # 列出规则，不扫描

   退出码：有**新**命中就非零。报告里不打印完整值——终端会被截图，CI 日志会留档，
   报出「哪个文件哪一行命中了哪条规则」就够了。

   ## 基线：为什么历史里的旧账不会把 CI 永远卡红

   一个永远红的门等于没有门——最后一定会被 --no-verify 绕过。所以已经认下的
   命中记进 .secret-scan-baseline.json（只存哈希，不存值），它们照常列出来、
   但不再让构建失败；**新**命中才拦。

     node tools/secret-scan.mjs --update-baseline   # 把当前全部命中记成「已认下」
     node tools/secret-scan.mjs --strict            # 无视基线，全都拦（审计用）

   基线里躺着的多半是「公开过的历史」——那部分不重写历史就删不掉。想真清干净，
   得改写历史 + 强推，那是另一件事，不在这个脚本的职权里。

   没扫的地方：工作区里**被 .gitignore 挡住**的文件（data/、media/、
   deploy/*.log、.ncm-session.json…）。它们本来就进不了仓库，里面也确实有
   真东西（口令、登录态、带 token 的入口链接）。要看它们得自己跑
   gitleaks dir .（注意 gitleaks 的 dir 模式不看 .gitignore，会连那些一起报）。
   ========================================================================== */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------ A. 通用规则 */

/* 规则写窄一点：宁可漏掉古怪格式，也不要天天误报——一个天天误报的钩子
   最后一定会被 --no-verify 绕过，那还不如没有。 */
const RULES = [
  { id: 'github-token', what: 'GitHub 令牌',
    re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{60,}\b/g },
  { id: 'openai-key', what: 'OpenAI key',
    re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/g },
  { id: 'aws-access-key', what: 'AWS Access Key',
    re: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: 'google-api-key', what: 'Google API key',
    re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: 'slack-token', what: 'Slack 令牌',
    re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { id: 'stripe-key', what: 'Stripe key',
    re: /\b[rs]k_live_[A-Za-z0-9]{24,}\b/g },
  { id: 'private-key', what: '私钥文件头',
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g },
  { id: 'cf-tunnel-token', what: 'Cloudflare tunnel token',
    re: /\beyJhIjoi[A-Za-z0-9+/=]{40,}/g },
  { id: 'ncm-cookie', what: '网易云登录 cookie',
    re: /\bMUSIC_U=[0-9a-f]{20,}/gi },
  { id: 'jwt', what: 'JWT',
    re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  /* 写在赋值里的口令。抓引号里那一串，长度卡 16 起，够躲开 '1' / 'on'。 */
  { id: 'assigned-secret', what: '写在赋值里的口令',
    re: /(?:passphrase|password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\s*[:=]\s*['"]([^'"\r\n]{16,})['"]/gi,
    group: 1 },
];

/* 文档里的占位值：形状像密钥，其实是给人抄的模板。 */
const PLACEHOLDER = [
  /^<[^>]+>$/,                        // <TUNNEL-ID>
  /^\$\{[^}]+\}$/,                    // ${TOKEN}
  /^x{3,}$/i, /^\.{3,}$/, /^0{8}-/,   // xxxx / ... / 00000000-
  /^(?:redacted|changeme|placeholder|dummy|fake|todo|none|null|undefined)$/i,
  /^your[-_ ]/i,
  /example\.(?:com|org|net)/i,
  /^(?:https?|ftp):\/\//i,
  /^[A-Za-z]:\\/,                     // Windows 绝对路径
  /^[/~]/,
];

const isPlaceholder = (v) => {
  const s = String(v).trim();
  if (s.length < 8) return true;
  return PLACEHOLDER.some((re) => re.test(s));
};

/* 公开的协议常量：形状像密钥，其实写在几十个开源仓库里，谁都能查到。
   放进来是为了不误报——不是为了图省事，每一条都得说得出出处。 */
const KNOWN_PUBLIC = new Map([
  /* 网易云 eapi 的 AES-128 密钥，NeteaseCloudMusicApi 等开源客户端通用常量。
     它不是任何人的账号凭据：拿到它只能按协议格式加密请求，登不了你的号。 */
  ['e82ckenh8dichen8', '网易云 eapi 协议公开常量'],
]);

/* 尺子用的是更松的一套：本机值里**本来就该有** Windows 绝对路径与域名，
   拿上面那套筛会把「DSH 安装路径」自己筛掉。这里只挡模板里那几个占位。 */
const isScalePlaceholder = (v) => {
  const s = String(v).trim();
  if (s.length < 6) return true;
  return /^<[^>]+>$/.test(s) || /^\$\{[^}]+\}$/.test(s) || /^0{8}-/.test(s) || /example\.(?:com|org|net)/i.test(s);
};

/* --------------------------------------------------- B. 本机实况（尺子） */

/* 尺子来自 deploy/local.config.ps1 —— 那个文件不进仓库，所以这些值写在这里
   也不算泄露。隧道名（CV01_TUNNEL_NAME）故意不在名单里：它通常就是仓库名，
   出现在公开文档里是正常的，盯它只会天天误报。 */
const LOCAL_LABELS = {
  CV01_SITE_HOST: '站点域名',
  CV01_DSH_HOST: '远控域名',
  CV01_TUNNEL_ID: '隧道 ID',
  CV01_DSH_BIN: 'DSH 安装路径',
};

function localValues() {
  const out = [];
  const file = join(ROOT, 'deploy', 'local.config.ps1');
  if (!existsSync(file)) return out;

  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/^\s*\$(CV01_[A-Z_]+)\s*=\s*'([^']*)'/gm)) {
    const label = LOCAL_LABELS[m[1]];
    const value = m[2].trim();
    if (!label || value.length < 6) continue;
    if (isScalePlaceholder(value)) continue;
    out.push({ label, value });
  }
  /* 用户名只在「本机那份配置在」的时候查：CI 上的 runner / user 这类名字
     会满仓库乱撞。 */
  const user = process.env.USERNAME || process.env.USER || '';
  if (user.length >= 5) out.push({ label: 'Windows 用户名', value: user });
  return out;
}

const SCALE = localValues();

/* ------------------------------------------------------------ 小工具 */

const git = (args) =>
  execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });

const listZ = (args) => git(args).split('\0').map((s) => s.trim()).filter(Boolean);

/* rev-list 这类是**换行**输出。别拿 listZ 去切——那会把 44 个提交读成 1 个，
   报告里就会写「历史 1 个提交」，看着像扫过了，其实数字是错的。 */
const lines = (args) => git(args).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

const isBinary = (buf) => buf.subarray(0, 8192).includes(0);

/** 报告里只露个头尾，中间一律隐去——终端会截图，CI 日志会留档。 */
const mask = (v) => {
  const s = String(v);
  if (s.length <= 8) return '****';
  return `${s.slice(0, 3)}…${s.slice(-2)}（${s.length} 字符，已隐去）`;
};

const findings = [];
const report = (f) => findings.push(f);

/* ------------------------------------------------------------ 基线 */

const BASELINE = join(ROOT, '.secret-scan-baseline.json');

/* 存哈希不存值：基线文件是**要进仓库**的，把命中的值（哪怕是掩码形式）写进去
   等于换个地方再泄露一次。哈希够用来判断「是不是同一处」了。 */
const hashOf = (f) =>
  createHash('sha256').update(`${f.kind}|${f.rule}|${f.where}|${f.line}|${f.sample}`).digest('hex').slice(0, 16);

function loadBaseline() {
  if (!existsSync(BASELINE)) return new Set();
  try {
    /* 文件带 BOM（这样 Windows PowerShell 的 Get-Content 也不会读成乱码），
       JSON.parse 不认 BOM，先剥掉。 */
    const j = JSON.parse(readFileSync(BASELINE, 'utf8').replace(/^\uFEFF/, ''));
    return new Set((j.accepted || []).map((e) => e.hash).filter(Boolean));
  } catch { return new Set(); }
}

/* ------------------------------------------------------ 扫一段文本 */

/** 扫一段文本。`where` 是给人看的位置，`lineOf` 把字符下标换成行号。 */
function scanText(text, where, lineOf) {
  const at = (index) => (lineOf ? lineOf(index) : null);

  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(text)) !== null) {
      const raw = rule.group ? m[rule.group] : m[0];
      if (m.index === rule.re.lastIndex) rule.re.lastIndex += 1;  // 零宽保护
      if (!raw || isPlaceholder(raw)) continue;
      if (KNOWN_PUBLIC.has(String(raw).trim())) continue;
      report({ kind: 'secret', rule: rule.id, what: rule.what, where, line: at(m.index), sample: mask(raw) });
    }
  }

  /* 本机值之间会互相包含（远控域名里就含着站点域名）。只报最长的那条，
     否则同一个位置会冒出两行「命中」，读的人会以为漏了两个地方。 */
  const hits = [];
  for (const { label, value } of SCALE) {
    let from = 0;
    for (;;) {
      const i = text.indexOf(value, from);
      if (i < 0) break;
      hits.push({ label, start: i, end: i + value.length });
      from = i + value.length;
    }
  }
  hits.sort((a, b) => (b.end - b.start) - (a.end - a.start));
  const taken = [];
  for (const h of hits) {
    if (taken.some((t) => h.start < t.end && t.start < h.end)) continue;
    taken.push(h);
    report({ kind: 'local', rule: 'local-value', what: h.label, where, line: at(h.start), sample: `本机值（${h.label}）` });
  }
}

/**
 * 扫一段 unified diff，只看**新增的行**——删掉的行已经不在任何一棵树里了。
 * 文件位置认 `diff --git`（不认 `+++`：内容是 `++ x` 的代码行，加号前缀
 * 之后长得和文件头一模一样）。
 */
function scanPatch(patch, source) {
  let file = '(未知)';
  let commit = null;
  let newLine = 0;
  let inHeader = true;
  let buf = '';
  let bufStart = 0;

  const flush = () => {
    if (!buf) return;
    const where = commit ? `${source} ${commit.slice(0, 8)} ${file}` : `${source} ${file}`;
    const text = buf;
    scanText(text, where, (i) => bufStart + (text.slice(0, i).match(/\n/g) || []).length);
    buf = '';
  };

  for (const line of patch.split('\n')) {
    const c = /^commit ([0-9a-f]{40})/.exec(line);
    if (c) { flush(); commit = c[1]; file = '(未知)'; inHeader = true; continue; }

    const d = /^diff --git a\/(.*) b\/(.*)$/.exec(line);
    if (d) { flush(); file = d[2]; inHeader = true; continue; }

    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (h) { flush(); inHeader = false; newLine = Number(h[1]); continue; }

    if (inHeader) continue;   // index / --- / +++ / rename / mode / Binary files…

    if (line.startsWith('+')) {
      if (!buf) bufStart = newLine;
      buf += `${line.slice(1)}\n`;
      newLine += 1;
    } else if (line.startsWith('-') || line.startsWith('\\')) {
      /* 删掉的行不看 */
    } else {
      flush();
      newLine += 1;
    }
  }
  flush();
}

/* ------------------------------------------------------------ 扫一个文件 */

function scanFile(rel, label) {
  const full = join(ROOT, rel);
  let buf;
  try {
    const st = statSync(full);
    if (!st.isFile() || st.size > 4 * 1024 * 1024) return;
    buf = readFileSync(full);
  } catch { return; }
  if (isBinary(buf)) return;

  const text = buf.toString('utf8');
  scanText(text, `${label} ${rel}`, (i) => text.slice(0, i).split('\n').length);
}

/* ------------------------------------------------------------ gitleaks */

function findGitleaks() {
  if (process.env.GITLEAKS_BIN && existsSync(process.env.GITLEAKS_BIN)) return process.env.GITLEAKS_BIN;

  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const out = execFileSync(cmd, ['gitleaks'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const first = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    if (first && existsSync(first)) return first;
  } catch { /* 没装 */ }

  /* winget 装完要新开窗口才在 PATH 上——顺手把它的包目录也找一遍 */
  if (process.platform === 'win32') {
    const base = join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
    try {
      for (const d of readdirSync(base)) {
        if (!/gitleaks/i.test(d)) continue;
        const exe = join(base, d, 'gitleaks.exe');
        if (existsSync(exe)) return exe;
      }
    } catch { /* 没这个目录 */ }
  }
  return null;
}

function runGitleaks(bin, mode) {
  const out = join(tmpdir(), `cv01-gitleaks-${process.pid}-${Date.now()}.json`);
  const common = ['--redact', '--no-banner', '--exit-code', '0', '--report-format', 'json', '--report-path', out];
  const config = join(ROOT, '.gitleaks.toml');
  if (existsSync(config)) common.push('--config', config);

  const args = mode === 'staged'
    ? ['git', '--staged', ...common]
    : ['git', ROOT, '--log-opts=--all', ...common];

  /* 命中时 gitleaks 会非零退出，报告照样写得出来——所以这里不抛。 */
  try {
    execFileSync(bin, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch { /* 见上 */ }

  if (existsSync(out)) {
    let hits = [];
    try { hits = JSON.parse(readFileSync(out, 'utf8')); } catch { hits = []; }
    for (const h of hits) {
      report({
        kind: 'secret',
        rule: h.RuleID || 'gitleaks',
        what: h.Description || 'gitleaks 命中',
        where: `${mode === 'staged' ? '暂存区' : '历史'} ${h.File || '?'}${h.Commit ? ` @${String(h.Commit).slice(0, 8)}` : ''}`,
        line: h.StartLine || null,
        sample: mask(h.Secret || h.Match || ''),
      });
    }
    try { unlinkSync(out); } catch { /* 临时目录，留着也无妨 */ }
  }
}

/* ------------------------------------------------------------ 主流程 */

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);

if (has('--help') || has('-h')) {
  console.log('');
  console.log('  用法：node tools/secret-scan.mjs [选项]');
  console.log('');
  console.log('    不带参数          工作区 + 暂存区 + 历史');
  console.log('    --staged          只扫暂存区（pre-commit 用的就是这个）');
  console.log('    --history         只翻历史');
  console.log('    --strict          无视基线，旧账新账一起拦（审计用）');
  console.log('    --update-baseline 把当前全部命中记成「已认下」');
  console.log('    --list            列出规则，不扫描');
  console.log('');
  process.exit(0);
}

if (has('--list')) {
  console.log('');
  console.log('  A. 通用规则（装了 gitleaks 就用它的，这是自带的兜底）');
  console.log('  ─────────────────────────────────────────────');
  for (const r of RULES) console.log(`  ${r.id.padEnd(18)} ${r.what}`);
  console.log('');
  console.log('  B. 本机实况（尺子来自 deploy/local.config.ps1）');
  console.log('  ─────────────────────────────────────────────');
  if (!SCALE.length) {
    console.log('  读不到尺子——deploy/local.config.ps1 不存在，或者里面还是占位值。');
    console.log('  复制模板填一份：Copy-Item deploy\\local.config.example.ps1 deploy\\local.config.ps1');
  } else {
    for (const v of SCALE) console.log(`  ${v.label} · ${mask(v.value)}`);
  }
  console.log('');
  process.exit(0);
}

const gitleaks = findGitleaks();
const stagedOnly = has('--staged');
const historyOnly = has('--history');
const doStaged = stagedOnly || (!stagedOnly && !historyOnly);
const doHistory = historyOnly || (!stagedOnly && !historyOnly);
const doWorktree = !stagedOnly && !historyOnly;

console.log('');
console.log('  密钥扫描 · 初音ミク CV01');
console.log('  ─────────────────────────────────────────────');
console.log(`  引擎        ${gitleaks ? `gitleaks 跑通用规则（${gitleaks}）` : '自带规则集（没找到 gitleaks）'}`);
console.log(`  尺子        ${SCALE.length ? `deploy/local.config.ps1 · ${SCALE.length} 条本机值` : '没有（本机实况这一项跳过）'}`);
console.log(`  基线        ${has('--strict') ? '忽略（--strict）' : `${loadBaseline().size} 处已认下`}`);
console.log('');

if (doStaged) {
  const names = listZ(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR']);
  if (!names.length) {
    console.log('  暂存区      空');
  } else {
    console.log(`  暂存区      ${names.length} 个文件`);
    scanPatch(git(['diff', '--cached', '--unified=0', '--no-color']), '暂存区');
    if (gitleaks) runGitleaks(gitleaks, 'staged');
  }
  console.log('');
}

if (doHistory) {
  let commits = 0;
  try { commits = lines(['rev-list', '--all']).length; } catch { /* 还没有提交 */ }
  console.log(`  历史        ${commits} 个提交（--all）`);
  if (commits) {
    scanPatch(git(['log', '-p', '--all', '--unified=0', '--no-color', '--format=commit %H']), '历史');
    if (gitleaks) runGitleaks(gitleaks, 'history');
  }
  console.log('');
}

if (doWorktree) {
  const tracked = listZ(['ls-files', '-z']);
  const untracked = listZ(['ls-files', '-z', '--others', '--exclude-standard']);
  console.log(`  工作区      ${tracked.length} 个已跟踪 + ${untracked.length} 个待加入`);
  for (const rel of tracked) scanFile(rel, '已跟踪');
  for (const rel of untracked) scanFile(rel, '待加入');
  console.log('');
}

/* ------------------------------------------------------------ 报告 */

const seen = new Set();
const unique = findings.filter((f) => {
  const key = `${f.kind}|${f.rule}|${f.where}|${f.line}|${f.sample}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

console.log('  ─────────────────────────────────────────────');

const byKind = { secret: '凭据', local: '本机实况' };
const describe = (f) => {
  console.log(`  [${byKind[f.kind] || f.kind}] ${f.what}（规则 ${f.rule}）`);
  console.log(`      ${f.where}${f.line ? `:${f.line}` : ''}`);
  console.log(`      值：${f.sample}`);
  console.log('');
};

/* --update-baseline：把现在看到的全部记成「已认下」。 */
if (has('--update-baseline')) {
  const accepted = unique.map((f) => ({
    hash: hashOf(f), kind: f.kind, rule: f.rule, what: f.what, where: f.where, line: f.line,
  }));
  writeFileSync(BASELINE, `\uFEFF${JSON.stringify({
    note: '已认下的命中。hash 由 kind|rule|where|line|掩码值 算出，值本身不落盘。',
    updatedAt: new Date().toISOString(),
    accepted,
  }, null, 2)}\n`, 'utf8');
  console.log(`  基线已更新：${accepted.length} 处记成「已认下」→ .secret-scan-baseline.json`);
  console.log('');
  process.exit(0);
}

if (!unique.length) {
  console.log('  没有命中。');
  console.log('  （被 .gitignore 挡住的文件不在范围内——data/、media/、deploy/*.log、');
  console.log('    .ncm-session.json 里确实有真东西，但那些不进仓库。）');
  console.log('');
  process.exit(0);
}

const baseline = has('--strict') ? new Set() : loadBaseline();
const known = unique.filter((f) => baseline.has(hashOf(f)));
const fresh = unique.filter((f) => !baseline.has(hashOf(f)));

if (known.length) {
  console.log(`  已认下 ${known.length} 处（在 .secret-scan-baseline.json 里，不再拦）：`);
  console.log('');
  for (const f of known) {
    console.log(`  [${byKind[f.kind] || f.kind}] ${f.what} · ${f.where}${f.line ? `:${f.line}` : ''}`);
  }
  console.log('');
}

if (!fresh.length) {
  console.log('  没有**新**命中。历史里的旧账都在基线里，这次放行。');
  console.log('  想连旧账一起看：node tools/secret-scan.mjs --strict');
  console.log('');
  process.exit(0);
}

console.log(`  新命中 ${fresh.length} 处：`);
console.log('');
for (const f of fresh) describe(f);
console.log('  怎么办：');
console.log('    · 真凭据：**先吊销 / 轮换**，再删文件。删掉文件或再提交一次都不会让旧钥匙失效。');
console.log('    · 本机实况：把值搬进 deploy/local.config.ps1（不进仓库），公开文档只留占位值。');
console.log('    · 确认是公开常量：加进脚本里的 KNOWN_PUBLIC，并写清出处。');
console.log('    · 确认是历史旧账、认了：node tools/secret-scan.mjs --update-baseline');
console.log('');
process.exit(1);

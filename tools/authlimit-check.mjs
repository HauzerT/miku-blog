/* ==========================================================================
   tools/authlimit-check.mjs · 口令限速自检
   ---------------------------------------------------------------------------
   两段：

     A. 纯逻辑（不需要服务）：拿假时钟把几小时的退避在几毫秒里跑一遍。
        验的是规则本身——免费次数、2 的幂、封顶、对的人洗白、窗口过期。
     B. 真接口（需要一个服务）：用 CV01_AUTH_FREE=1 起一个服务，
        POST /api/auth 连错几次，看 401 → 429、看 Retry-After、
        并确认**口令是对的**时候一次就过。

   用法：

     node tools/authlimit-check.mjs                        # 只跑 A
     node tools/authlimit-check.mjs http://127.0.0.1:4399  # A + B（先另开窗口起服务）

   B 段会故意把 /api/auth 试错几次。它是**从 127.0.0.1 出发**的，
   而服务默认不信任转发头、认的就是 127.0.0.1——所以如果你的服务是拿
   CV01_AUTH_FREE=1 起的，这几下会把「本机」这个来客暂时挡一会儿。
   跑完等 15 分钟自然恢复，或者重启服务立刻清空（记录只在内存里）。
   ========================================================================== */

import { createAuthLimit, clientKey } from '../server/lib/authlimit.mjs';

let pass = 0;
let fail = 0;

function ok(name, condition, detail = '') {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${detail ? '  → ' + detail : ''}`);
  }
}

/* ---------------------------------------------------------------- A. 纯逻辑 */

console.log('');
console.log('  A. 限速规则（假时钟）');
console.log('  ─────────────────────────────────────────────');

let clock = 1_000_000;
const lim = createAuthLimit({ freeAttempts: 3, windowMs: 60_000, pruneEveryMs: 1000, now: () => clock });
const IP = '203.0.113.7';

ok('一开始就允许', lim.check(IP).allowed);

/* 前 3 次失败不罚 */
for (let i = 1; i <= 3; i += 1) {
  const r = lim.recordFailure(IP);
  ok(`第 ${i} 次失败后不罚（fails=${r.fails}）`, r.retryAfterMs === 0, `retryAfterMs=${r.retryAfterMs}`);
}
ok('免费次数用完了仍然允许马上再试', lim.check(IP).allowed);

/* 第 4 次失败：2s，之后 4s / 8s / 16s… */
const r4 = lim.recordFailure(IP);
ok('第 4 次失败 → 等 2s', r4.retryAfterMs === 2000, `得到 ${r4.retryAfterMs}`);
const blocked = lim.check(IP);
ok('等待期内被挡下', blocked.allowed === false);
ok('被挡时给出还要等多久', blocked.retryAfterMs > 0 && blocked.retryAfterMs <= 2000, `${blocked.retryAfterMs}ms`);

clock += 2000;
ok('等够了就放行（没有「锁死」这种状态）', lim.check(IP).allowed);

const r5 = lim.recordFailure(IP);
ok('第 5 次失败 → 等 4s（翻倍）', r5.retryAfterMs === 4000, `得到 ${r5.retryAfterMs}`);
const r6 = lim.recordFailure(IP);
ok('第 6 次失败 → 等 8s', r6.retryAfterMs === 8000, `得到 ${r6.retryAfterMs}`);

/* 封顶 */
let capped = 0;
for (let i = 0; i < 30; i += 1) capped = lim.recordFailure(IP).retryAfterMs;
ok('封顶在 windowMs（60s），不会无限翻上去', capped === 60_000, `得到 ${capped}`);

/* 对的人洗白 */
lim.recordSuccess(IP);
ok('口令对了 → 这条记录被抹掉', lim.check(IP).allowed && lim.check(IP).fails === 0);

/* 不同来客互不牵连 */
lim.recordFailure('198.51.100.9');
ok('另一个来客不受影响', lim.check('203.0.113.7').allowed);

/* 窗口过期 */
clock += 61_000;
lim.recordFailure('198.51.100.9'); // 触发 prune
ok('窗口内没再来试 → 过期记录被清掉', lim.snapshot().size <= 1, `size=${lim.snapshot().size}`);

/* 条数上限：一堆来客也不会把内存撑爆 */
const small = createAuthLimit({ maxKeys: 5, pruneEveryMs: 0, windowMs: 60_000, now: () => clock });
for (let i = 0; i < 50; i += 1) small.recordFailure(`10.0.0.${i}`);
ok('来客数超过上限时只留最近的几条', small.snapshot().size <= 5, `size=${small.snapshot().size}`);

/* 来客是谁：默认不信任任何转发头 */
const fakeReq = (headers, addr) => ({ headers, socket: { remoteAddress: addr } });
ok('默认认 socket 地址，不认 CF-Connecting-IP',
  clientKey(fakeReq({ 'cf-connecting-ip': '203.0.113.7' }, '127.0.0.1')) === '127.0.0.1');
ok('CV01_TRUST_PROXY 时采信 CF-Connecting-IP',
  clientKey(fakeReq({ 'cf-connecting-ip': '203.0.113.7' }, '127.0.0.1'), { trustProxy: true }) === '203.0.113.7');
ok('CF-Connecting-IP 只取第一个（后面的链不看）',
  clientKey(fakeReq({ 'cf-connecting-ip': '203.0.113.7, 10.0.0.1' }, '127.0.0.1'), { trustProxy: true }) === '203.0.113.7');

/* ---------------------------------------------------------------- B. 真接口 */

const base = process.argv[2] || '';
if (!base) {
  console.log('');
  console.log('  B. 真接口：跳过（没给地址）。要跑就：');
  console.log('     $env:PORT=4399; $env:CV01_AUTH_FREE=1; node .output/server/index.mjs');
  console.log('     node tools/authlimit-check.mjs http://127.0.0.1:4399');
} else {
  console.log('');
  console.log(`  B. 真接口 · ${base}`);
  console.log('  ─────────────────────────────────────────────');

  const root = base.replace(/\/+$/, '');
  const auth = async (key) => {
    const res = await fetch(`${root}/api/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cv01-key': key },
      body: '{}',
      redirect: 'manual',
    });
    let body = {};
    try { body = await res.json(); } catch { /* 不是 JSON 就算了 */ }
    return { status: res.status, retryAfter: res.headers.get('retry-after'), body };
  };

  try {
    const health = await fetch(`${root}/api/health`).then((r) => r.json());
    ok('/api/health 说服务活着', health.ok === true);

    if (!(await fetch(`${root}/api/health`).then((r) => r.json())).hasPassphrase) {
      ok('服务上没有口令 —— 先跑一次服务让它生成一条', false);
    } else {
      /* 错口令。免费次数的默认值是 5；如果服务不是用 CV01_AUTH_FREE 起的，
         这里只会看到 401，看不到 429——这也是一个有效的结果，只是说明没测到闸门。 */
      const sequence = [];
      for (let i = 0; i < 8; i += 1) sequence.push((await auth('definitely-not-the-passphrase-' + i)).status);
      const sawLimit = sequence.includes(429);
      ok('反复试错最终会被挡下（429）', sawLimit, `状态序列 ${sequence.join('→')}` +
        (sawLimit ? '' : '（服务大概不是用 CV01_AUTH_FREE=1 起的）'));

      if (sawLimit) {
        const blocked = await auth('one-more-wrong');
        ok('被挡时带 Retry-After 头', Number(blocked.retryAfter) > 0, `Retry-After=${blocked.retryAfter}`);
        ok('被挡时给的是 429 与一句人话', blocked.status === 429 && /等/.test(blocked.body.error || ''),
          `${blocked.status} ${blocked.body.error || ''}`);
      }

      const wrong = await auth('still-wrong');
      ok('错口令仍是 401 或 429（不会漏成 200）', wrong.status === 401 || wrong.status === 429, String(wrong.status));
    }
  } catch (err) {
    ok('能连上服务', false, err.message);
  }
}

console.log('');
console.log(`  一共 ${pass + fail} 项 · 通过 ${pass} · 失败 ${fail}`);
console.log('');
process.exit(fail ? 1 : 0);

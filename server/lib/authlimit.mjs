/* ==========================================================================
   server/lib/authlimit.mjs · 口令试错限速
   ---------------------------------------------------------------------------
   只有一件事：**同一个来客反复把口令试错，就让它等。** 本站原来的 /api/auth
   是「比对一下、不通过就 401」——本机这么写没问题，一旦挂到公网上，
   它就是一个没有任何摩擦的猜口令入口。这个模块是那道摩擦。

   规则（刻意做得很笨，因为笨的规则不会自己出错）：

     · 记的是**来客**（IP），不是全局。一个人在试，别人不受牵连。
     · 头 `freeAttempts` 次失败不罚——人会打错字。
     · 之后每错一次，下一次要等的时长翻倍：2ⁿ 秒，封顶 `windowMs`。
     · 等太久就不必留着了：`windowMs` 没再来试，这条记录自动作废（prune）。

   两个刻意的选择：

   1. **只看「失败」。** 口令对了就当场把这条记录抹掉——站长在自己的网络里
      连错几次再输对，不该被留下一个正在倒计时的影子。
   2. **等待期不是一个单独的「锁」状态。** 它就是「下一次允许尝试的时间」，
      所以不存在「锁住了但不知道怎么解锁」这种事：等够就是好。

   时间由 `now()` 注入，所以 tools/authlimit-check.mjs 可以在几毫秒里
   把几小时的退避全跑一遍，自检不需要真的等。

   状态在内存里，重启服务即清空。这是故意的：重启是我们自己的动作，
   不是攻击者的手段；把它落盘反而多出一个可以被撑爆的文件。
   ========================================================================== */

export const AUTH_LIMIT_DEFAULTS = {
  freeAttempts: 5,              /* 打错几次不算数 */
  windowMs: 15 * 60 * 1000,     /* 最长等这么久；也是记录的保鲜期 */
  pruneEveryMs: 60 * 1000,      /* 每隔一分钟清一次过期记录 */
  maxKeys: 5000,                /* 记录条数上限，超了先丢最老的 */
};

function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function createAuthLimit(options = {}) {
  const freeAttempts = positiveInt(options.freeAttempts, AUTH_LIMIT_DEFAULTS.freeAttempts);
  const windowMs = positiveInt(options.windowMs, AUTH_LIMIT_DEFAULTS.windowMs);
  const pruneEveryMs = positiveInt(options.pruneEveryMs, AUTH_LIMIT_DEFAULTS.pruneEveryMs);
  const maxKeys = positiveInt(options.maxKeys, AUTH_LIMIT_DEFAULTS.maxKeys);
  const now = typeof options.now === 'function' ? options.now : Date.now;

  /** key -> { fails, last } */
  const records = new Map();
  let prunedAt = -Infinity;

  /* 把最老的几条丢出去，直到回到上限之内。这一条**每次都要检查**：
     它原来写在周期扫描里面，结果「刚扫过」的那一分钟里来客暴涨就不会被削——
     自检抓到了这个（tools/authlimit-check.mjs 的 maxKeys 那项）。 */
  function trimToMax() {
    while (records.size > maxKeys) {
      let oldestKey = null;
      let oldestLast = Infinity;
      for (const [key, rec] of records) {
        if (rec.last < oldestLast) { oldestLast = rec.last; oldestKey = key; }
      }
      if (oldestKey === null) break;
      records.delete(oldestKey);
    }
  }

  /* 过期的记录留着只会长内存。每 pruneEveryMs 扫一次。 */
  function prune(nowMs) {
    if (nowMs - prunedAt >= pruneEveryMs) {
      prunedAt = nowMs;
      for (const [key, rec] of records) {
        if (nowMs - rec.last >= windowMs) records.delete(key);
      }
    }
    trimToMax();
  }

  /* 第 n 次失败之后要等多久：前 freeAttempts 次不罚，之后 2 的幂，封顶 windowMs。 */
  function backoffFor(fails) {
    const n = fails - freeAttempts;
    if (n <= 0) return 0;
    return Math.min(windowMs, 2000 * 2 ** (n - 1));
  }

  return {
    /* 现在能不能试？不能就给一个「还要等多少秒」。 */
    check(key, at = now()) {
      prune(at);
      const rec = records.get(key);
      if (!rec) return { allowed: true, retryAfterMs: 0, fails: 0 };
      const wait = backoffFor(rec.fails);
      const elapsed = at - rec.last;
      const left = wait - elapsed;
      if (left > 0) return { allowed: false, retryAfterMs: Math.ceil(left), fails: rec.fails };
      return { allowed: true, retryAfterMs: 0, fails: rec.fails };
    },

    /* 记一次失败，并把「下一次要等多久」算出来告诉调用方。 */
    recordFailure(key, at = now()) {
      prune(at);
      const rec = records.get(key) || { fails: 0, last: 0 };
      rec.fails += 1;
      rec.last = at;
      records.set(key, rec);
      /* 削上限必须放在**写入之后**：放在 prune 里只能削到 maxKeys，
         紧接着这一条又会把它顶成 maxKeys + 1（自检抓到的第二个 off-by-one）。 */
      trimToMax();
      return { fails: rec.fails, retryAfterMs: backoffFor(rec.fails) };
    },

    /* 口令对了：这条记录不再有意义（也顺手挡掉「用正确口令洗白计数」的错觉——
       洗白本来就不是问题，记着才是不对的）。 */
    recordSuccess(key) {
      records.delete(key);
    },

    /* 给自检和 /api/health 看的读数，不是给页面用的。 */
    snapshot() {
      return { size: records.size, freeAttempts, windowMs };
    },
  };
}

/* ------------------------------------------------------------------ 来客是谁

   cloudflared 会补上 CF-Connecting-IP；X-Forwarded-For 也可能有。
   但这两个头**任何直连的人都能自己填**——所以默认不认它们。
   真正的判断标准是：这台服务是不是「只有 tunnel 能连到」。

     · 本机跑（默认）：req.socket.remoteAddress 是 127.0.0.1，所有人都一样。
       于是限速退化成「全局限速」。这不理想，但不会误伤，也不会被骗。
     · 挂了 tunnel 且只监听 127.0.0.1：上面那句依然成立，所以**默认情况下
       公网部署会变成全局限速**——一个人在猜，会把站长也挡在门外一会儿。

   想按真实来客限速，就设环境变量 CV01_TRUST_PROXY=1，并且**确认这台服务
   除了 cloudflared 没有别的路能连上**（server.mjs 只监听 127.0.0.1 就是这条保证）。
   那时才采信 CF-Connecting-IP。取的是**最后一跳之外的那个头**的信任语义：
   这里只认 CF-Connecting-IP，不认 X-Forwarded-For 的链条。 */
export function clientKey(req, { trustProxy = false } = {}) {
  if (trustProxy) {
    const cf = String(req.headers['cf-connecting-ip'] || '').split(',')[0].trim();
    if (cf) return cf;
  }
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown';
}

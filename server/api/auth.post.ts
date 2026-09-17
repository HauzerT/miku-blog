/* POST /api/auth · 验口令
   ---------------------------------------------------------------------------
   口令从 X-CV01-Key / Authorization: Bearer / ?key= 任一处来（见 utils/auth）。
   验过之后顺手把门厅那枚章也盖上——登录页就是靠它把人送进站点的。

   试错限速也在这里：本机跑随便错，挂上 tunnel 之后它是那道摩擦。
   同一个来客错够 freeAttempts 次之后，每错一次要等的时长翻倍（封顶 15 分钟）。
   来客是谁由 authlimit 的 clientKey() 判断，默认不信任任何转发头。 */
import { setCookie, setResponseHeader } from 'h3';
import { AUTH_FREE_ATTEMPTS, ENTER_COOKIE, authKey, authLimit, enterCookieOptions, keyMatches, keyOf } from '../utils/auth';
import { defineApiHandler, httpError } from '../utils/http';
import { getSettings } from '../utils/store';

export default defineApiHandler((event) => {
  const settings = getSettings();
  const key = keyOf(event) || '';
  if (!settings.passphrase) throw httpError(403, '还没有设置口令：请重启一次服务，终端会打印口令');

  const who = authKey(event);
  const gate = authLimit.check(who);
  if (!gate.allowed) {
    const waitMinutes = Math.ceil(gate.retryAfterMs / 60000);
    const waitText = gate.retryAfterMs >= 60000 ? `${waitMinutes} 分钟` : `${Math.ceil(gate.retryAfterMs / 1000)} 秒`;
    setResponseHeader(event, 'retry-after', String(Math.ceil(gate.retryAfterMs / 1000)));
    throw httpError(429, `口令错的次数太多了，请等 ${waitText} 再试`);
  }

  if (!keyMatches(key, settings.passphrase)) {
    const after = authLimit.recordFailure(who);
    /* 服务端自己也要留一行：公网上的口令试错是唯一值得盯着的事件。
       只记来客与次数，不记试的是什么。 */
    const attemptsLeft = Math.max(0, AUTH_FREE_ATTEMPTS - after.fails);
    console.warn(`[口令] 不对 · 来客 ${who} · 这是第 ${after.fails} 次` +
      (after.retryAfterMs
        ? ` · 下次要等 ${Math.ceil(after.retryAfterMs / 1000)}s`
        : ` · 还能白试 ${attemptsLeft} 次`));
    throw httpError(401, '口令不对，再看一眼启动服务的终端');
  }

  authLimit.recordSuccess(who);
  /* 验过口令 = 从站长这道门进来了：顺手把门厅那枚章盖上 */
  setCookie(event, ENTER_COOKIE, '1', enterCookieOptions());
  return { ok: true, entered: true };
});

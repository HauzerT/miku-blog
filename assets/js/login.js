/* ==========================================================================
   login.js · 门厅的两颗键（login.html）
   ---------------------------------------------------------------------------
   访客那颗键是普通链接：没有 JS、没有服务也进得去，而且永远不会问口令。
   它指向 `<目标>?enter=1`，服务看到就盖一枚 `cv01-enter` 的章再把人送进去——
   所以「不许跳过门厅」这件事没有 JS 也成立。

   站长那颗键展开一行口令，把口令交给本机的上传服务核对（POST api/auth）；
   核对通过服务同样盖章，页面这边再把口令记进 localStorage 的 cv01-key ——
   与站长工具箱（studio.js）用的是同一把钥匙，所以进门之后钥匙球不必再问一次。

   `?next=` 是「本来要去的那一页」（被门厅拦下来的），两颗键都把它带上。

   没跑服务时这一页也不该转圈：把「双击 start.cmd、口令印在终端里」这句话
   说清楚。口令一直只在本机比对，页面这边拿到的是一个「对/不对」。
   ========================================================================== */
(function () {
  'use strict';

  var KEY_STORE = 'cv01-key';
  var HOME = 'index.html';
  var AUTH = 'api/auth';
  var WAIT = 6000;   /* 服务不在时别让人干等 */

  var FILE_TIP = '这一页是用 file:// 打开的：口令要问本机的上传服务。' +
    '双击 start.cmd 把它起来，再开 http://127.0.0.1:4321/login.html。';
  var TERMINAL = '口令印在启动服务的那个终端窗口里。';

  var owner = document.querySelector('[data-owner]');
  var visitor = document.querySelector('[data-visitor]');
  var pass = document.querySelector('[data-pass]');
  var input = document.querySelector('[data-pass-input]');
  var msg = document.querySelector('[data-msg]');
  var status = document.querySelector('[data-status]');
  var forget = document.querySelector('[data-forget]');
  var door = document.querySelector('[data-door]');
  if (!owner || !pass || !input) return;

  /* 被门厅拦下来的那一页。只认本站路径，免得 ?next=//evil 把人带去别处 */
  function nextPage() {
    var raw = '';
    try { raw = new URLSearchParams(window.location.search).get('next') || ''; } catch (e) { raw = ''; }
    if (!raw || raw.charAt(0) !== '/' || raw.slice(0, 2) === '//') return HOME;
    return raw;
  }
  var NEXT = nextPage();

  /* 站在门厅里的人，本来就是想去哪儿就回哪儿去：两颗键都带上 ?enter=1，
     服务看到就盖章、再把人送到 cleanQuery 之后的那一页 */
  function enterHref(target) {
    return target + (target.indexOf('?') > -1 ? '&' : '?') + 'enter=1';
  }

  /* 门厅这道门盖的章：服务盖的（不是本地存储），所以这里只是读出来给人看 */
  function doorStamped() {
    return /(?:^|;\s*)cv01-enter=/.test(document.cookie || '');
  }

  function read() {
    try { return window.localStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; }
  }
  function write(value) {
    try {
      if (value) window.localStorage.setItem(KEY_STORE, value);
      else window.localStorage.removeItem(KEY_STORE);
    } catch (e) { /* 隐私模式：这次照样进得去，只是没记住 */ }
  }

  /* 青地上只有黑字读得动，所以「错」不靠颜色，靠一块黑板 */
  function say(text, bad) {
    if (!msg) return;
    msg.textContent = text || '';
    msg.hidden = !text;
    msg.classList.toggle('gate__msg--bad', Boolean(bad));
    if (bad) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }

  function show(open) {
    pass.hidden = !open;
    owner.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      window.setTimeout(function () { input.focus(); }, 30);
    } else {
      input.value = '';
      say('');
      owner.focus();
    }
  }

  function paintStatus() {
    if (status) status.hidden = !read();
  }

  /* 进不去的时候，把原因说清楚：是没跑服务、还是口令不对 */
  function reason(err) {
    if (window.location.protocol === 'file:') return FILE_TIP;
    if (err && err.name === 'AbortError') return '上传服务没有回应。它跑着吗？' + TERMINAL;
    if (err instanceof TypeError) return '没连上上传服务。双击 start.cmd 把它起来，' + TERMINAL;
    return (err && err.message) || '没进去。' + TERMINAL;
  }

  function enter() {
    var value = input.value.trim();
    if (!value) {
      say('先填口令。' + TERMINAL, true);
      input.focus();
      return;
    }
    say('');

    var ctl = typeof window.AbortController === 'function' ? new window.AbortController() : null;
    var timer = ctl ? window.setTimeout(function () { ctl.abort(); }, WAIT) : null;
    var stop = function () { if (timer) window.clearTimeout(timer); };

    window.fetch(AUTH, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cv01-key': value },
      body: '{}',
      signal: ctl ? ctl.signal : undefined,
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok || data.ok === false) {
            var err = new Error(data.error || ('HTTP ' + res.status));
            err.status = res.status;
            throw err;
          }
          return data;
        });
      })
      .then(function () {
        stop();
        write(value);
        /* 口令过了服务就已经盖了门厅那枚章，这一跳直接去本来要去的地方 */
        window.location.href = NEXT;
      }, function (err) {
        stop();
        say(reason(err), true);
        input.select();
      });
  }

  owner.addEventListener('click', function () { show(pass.hidden); });

  pass.addEventListener('submit', function (e) {
    e.preventDefault();
    enter();
  });

  if (forget) {
    forget.addEventListener('click', function () {
      write('');
      paintStatus();
      say('这台浏览器不再记着口令了。');
    });
  }

  /* Esc：收起口令那一行，回到两颗键 */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !pass.hidden) show(false);
  });

  /* 访客那颗键：带上「本来要去的那一页」与服务认得出的盖章请求。
     没有 JS 时它就是 HTML 里那个 index.html?enter=1 —— 照样进得去。 */
  if (visitor) visitor.setAttribute('href', enterHref(NEXT));

  /* 已经盖过章的人：告诉他门是开着的，并给一条重新上锁的路 */
  if (door) door.hidden = !doorStamped();

  /* 访客那颗键：**先降级再进门**。
     身份就是「这台浏览器里有没有那把口令」——所以按访客进入 = 把口令忘掉。
     不这么做的话，之前输过口令的浏览器（比如站长自己试用）点了访客之后
     照样带着站长权限进门，右键菜单、站长工具箱一个不少：那是个真的洞。
     口令只存在 localStorage 里，清掉它就等于降成访客；站长想回来，重新输一次口令。 */
  if (visitor) {
    visitor.addEventListener('click', function () {
      write('');
      paintStatus();
      /* 不 preventDefault：该怎么跳还怎么跳（含按住 Ctrl / ⌘ 开新标签） */
    });
  }

  /* 地址栏写 #owner 就直接停在口令那一行——站长可以把 login.html#owner 存成书签 */
  if (window.location.hash === '#owner') show(true);

  paintStatus();
})();

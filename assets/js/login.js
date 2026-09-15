/* ==========================================================================
   login.js · 门厅的两颗键（login.html）
   ---------------------------------------------------------------------------
   访客那颗键是普通链接：没有 JS、没有服务也进得去，而且永远不会问口令。
   站长那颗键展开一行口令，把口令交给本机的上传服务核对（POST api/auth），
   核对通过就记进 localStorage 的 cv01-key —— 与站长工具箱（studio.js）
   用的是同一把钥匙，所以进门之后右下角那颗钥匙球不必再问一次。

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
  var pass = document.querySelector('[data-pass]');
  var input = document.querySelector('[data-pass-input]');
  var msg = document.querySelector('[data-msg]');
  var status = document.querySelector('[data-status]');
  var forget = document.querySelector('[data-forget]');
  if (!owner || !pass || !input) return;

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
        window.location.href = HOME;
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

  /* 地址栏写 #owner 就直接停在口令那一行——站长可以把 login.html#owner 存成书签 */
  if (window.location.hash === '#owner') show(true);

  paintStatus();
})();

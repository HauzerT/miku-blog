/* ==========================================================================
   studio.js · 悬浮工作台
   ---------------------------------------------------------------------------
   右下角两颗球：音乐盒 / 站长工具箱。
   音乐盒谁都能开（听歌、选歌、设默认）；站长工具箱里有写文件的操作，开之前先验口令。
   站点的静态部分（首页、卷帘、文章）不依赖这个文件；没跑服务时它什么都不做，
   所以 file:// 打开或者丢到静态托管上，页面依然和以前一模一样。

   它负责三件事：
     1) 探一探上传服务在不在（不在就整体隐身）
     2) 口令的存取（第一次上传时问一次，之后记在这个浏览器里）
     3) 面板的开合（同一时刻只开一个，Esc 关，点外面关）
   ========================================================================== */
(function () {
  'use strict';

  var doc = document;
  var root = doc.querySelector('[data-studio]');
  if (!root) return;

  var BASE = root.getAttribute('data-base') || '';
  var API = BASE + 'api/';
  var KEY_STORE = 'cv01-key';
  var online = false;

  /* ------------------------------------------------------------ 对外接口 */
  var cv01 = (window.cv01 = window.cv01 || {});
  cv01.base = BASE;
  cv01.api = API;
  cv01.isOnline = function () { return online; };

  cv01.key = function () {
    try { return window.localStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; }
  };
  cv01.setKey = function (value) {
    try { window.localStorage.setItem(KEY_STORE, value); } catch (e) { /* 隐私模式：本次会话有效 */ }
    /* 音乐盒靠这个把「换 / 改名 / 删」这几颗只有站长能按的按钮亮出来 */
    doc.dispatchEvent(new CustomEvent('cv01:key'));
  };

  cv01.error = function (err) {
    var text = err && err.message ? err.message : String(err || '出错了');
    cv01.toast(text, true);
    return text;
  };

  cv01.toast = toast;

  /* 统一的 fetch：带上口令，返回 JSON，出错时抛出带中文消息的 Error */
  cv01.fetchJSON = function (path, options) {
    var opts = options || {};
    var headers = Object.assign({}, opts.headers || {});
    var key = cv01.key();
    if (key) headers['x-cv01-key'] = key;
    if (opts.json !== undefined) {
      headers['content-type'] = 'application/json';
      opts.body = JSON.stringify(opts.json);
    }
    return fetch(path, Object.assign({}, opts, { headers: headers })).then(function (res) {
      return res.json().catch(function () { return { ok: false, error: '服务返回了看不懂的内容（HTTP ' + res.status + '）' }; })
        .then(function (data) {
          if (!res.ok || data.ok === false) {
            var err = new Error(data.error || ('HTTP ' + res.status));
            err.status = res.status;
            throw err;
          }
          return data;
        });
    });
  };

  /* 上传：带进度（fetch 拿不到进度，所以用 XHR） */
  cv01.upload = function (path, formData, onProgress) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', path, true);
      var key = cv01.key();
      if (key) xhr.setRequestHeader('x-cv01-key', key);
      if (xhr.upload && onProgress) {
        xhr.upload.addEventListener('progress', function (e) {
          if (e.lengthComputable) onProgress(e.loaded / e.total);
        });
      }
      xhr.addEventListener('load', function () {
        var data = {};
        try { data = JSON.parse(xhr.responseText); } catch (e) { /* 非 JSON */ }
        if (xhr.status >= 200 && xhr.status < 300 && data.ok !== false) return resolve(data);
        var err = new Error(data.error || ('上传失败（HTTP ' + xhr.status + '）'));
        err.status = xhr.status;
        reject(err);
      });
      xhr.addEventListener('error', function () { reject(new Error('连不上上传服务，服务还在跑吗？')); });
      xhr.addEventListener('abort', function () { reject(new Error('上传被取消了')); });
      xhr.send(formData);
    });
  };

  /* ------------------------------------------------------------ 口令询问 */
  /* 口令不对或没填时弹一个小条，输完把这次请求重放一遍 */
  cv01.askKey = function (message) {
    return new Promise(function (resolve, reject) {
      var wrap = doc.createElement('div');
      wrap.className = 'keygate';
      wrap.innerHTML =
        '<form class="keygate__box">' +
        '<p class="keygate__title">上传口令</p>' +
        '<p class="keygate__hint">' + (message || '第一次上传需要口令。它印在启动服务的那个终端窗口里。') + '</p>' +
        '<div class="keygate__row">' +
        '<input class="keygate__input" type="password" inputmode="latin" autocomplete="off" placeholder="例如 3f9a1c02" aria-label="上传口令">' +
        '<button class="keygate__go" type="submit">确认</button>' +
        '</div>' +
        '<button class="keygate__cancel" type="button">以后再说</button>' +
        '</form>';
      doc.body.appendChild(wrap);
      var input = wrap.querySelector('.keygate__input');
      var form = wrap.querySelector('form');
      window.setTimeout(function () { input.focus(); }, 30);

      function close() {
        wrap.remove();
        doc.removeEventListener('keydown', onKey, true);
      }
      function onKey(e) {
        if (e.key === 'Escape') { close(); reject(new Error('没有口令，先不传了')); }
      }
      wrap.querySelector('.keygate__cancel').addEventListener('click', function () {
        close();
        reject(new Error('没有口令，先不传了'));
      });
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var value = input.value.trim();
        if (!value) return;
        cv01.fetchJSON(API + 'auth', { method: 'POST', json: {} , headers: { 'x-cv01-key': value } })
          .then(function () {
            cv01.setKey(value);
            close();
            resolve(value);
          })
          .catch(function (err) {
            input.select();
            wrap.querySelector('.keygate__hint').textContent = err.message || '口令不对';
          });
      });
      doc.addEventListener('keydown', onKey, true);
    });
  };

  /* 需要口令的操作统一从这里走：401/403 时问一次再重放 */
  cv01.withKey = function (run) {
    return Promise.resolve()
      .then(run)
      .catch(function (err) {
        if (err && (err.status === 401 || err.status === 403)) {
          return cv01.askKey(err.message).then(run);
        }
        throw err;
      });
  };

  /* ------------------------------------------------------------ 面板开合 */
  var panel = root.querySelector('[data-studio-panel]');
  var balls = Array.prototype.slice.call(root.querySelectorAll('[data-ball]'));
  var openName = '';

  function closePanel() {
    openName = '';
    panel.hidden = true;
    panel.innerHTML = '';
    balls.forEach(function (b) { b.setAttribute('aria-expanded', 'false'); b.classList.remove('is-on'); });
    root.removeAttribute('data-open');
  }

  function openPanel(name, render, ball) {
    if (openName === name) return closePanel();
    closePanel();
    openName = name;
    panel.hidden = false;
    root.setAttribute('data-open', name);
    ball.setAttribute('aria-expanded', 'true');
    ball.classList.add('is-on');
    render(panel, closePanel);
    var focusable = panel.querySelector('input, textarea, button, [tabindex]');
    if (focusable && !window.matchMedia('(hover: none)').matches) window.setTimeout(function () { focusable.focus(); }, 40);
  }

  /* 只有站长进得去的那颗球 */
  var OWNER_ONLY = { owner: true };

  balls.forEach(function (ball) {
    ball.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!online) return toast('上传服务没在跑：先双击 start.cmd', true);
      var name = ball.getAttribute('data-ball');
      var mod = { music: cv01.music, owner: cv01.owner }[name];
      if (!mod || !mod.open) return toast('这个面板没有加载成功，刷新一下试试', true);
      /* 音乐盒公开：直接开。站长工具箱：先验口令，验过才开 */
      if (!OWNER_ONLY[name]) return openPanel(name, mod.open, ball);
      cv01.withKey(function () { return cv01.fetchJSON(API + 'auth', { method: 'POST', json: {} }); })
        .then(function () { openPanel(name, mod.open, ball); })
        .catch(function (err) { cv01.error(err); });
    });
  });

  /* 子面板换内容之后重新收一下焦点（owner.js 的「← 工具箱」用得上） */
  cv01.focusPanel = function () {
    var focusable = panel.querySelector('button, input, select, textarea, a[href]');
    if (focusable && !window.matchMedia('(hover: none)').matches) window.setTimeout(function () { focusable.focus(); }, 20);
  };

  doc.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && openName) closePanel();
  });

  /* 「点面板外面就收起」这件事有个坑：面板里的按钮经常会把列表 innerHTML 重画一遍
     （比如音乐盒点「设默认」、点「删」、站长工具箱换子面板），重画之后 e.target 已经脱离文档，
     等事件冒泡到 document 再问 root.contains(e.target) 就变成 false 了——
     明明点在里面，却被判成点在外面，面板自己关掉。
     所以判断放在捕获阶段：那时 DOM 还没被改，e.target 一定还在原位。 */
  root.__pressInside = false;
  doc.addEventListener('click', function (e) {
    root.__pressInside = root.contains(e.target);
  }, true);
  doc.addEventListener('click', function (e) {
    if (!openName) return;
    if (root.__pressInside || root.contains(e.target)) return;
    closePanel();
  });

  cv01.closePanel = closePanel;
  cv01.reopenPanel = function () {
    if (!openName) return;
    var name = openName;
    var ball = balls.filter(function (b) { return b.getAttribute('data-ball') === name; })[0];
    closePanel();
    if (ball) ball.click();
  };

  /* ------------------------------------------------------------ 启动 */
  function boot() {
    fetch(API + 'health', { headers: { accept: 'application/json' } })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (!data || !data.ok) return;
        online = true;
        root.hidden = false;
        root.setAttribute('data-online', 'true');
        var music = ballBy('music');
        if (music) music.setAttribute('data-count', String(data.music || 0));
        doc.dispatchEvent(new CustomEvent('cv01:online', { detail: data }));
        deepLink();
      })
      .catch(function () { /* 静态托管：工作台隐身，站点照常 */ });
  }

  /* 深链：index.html?open=music / ?open=owner 进来就展开那个面板。
     自己用着方便，截图检查样式也靠它。 */
  function deepLink() {
    var want = '';
    try { want = new URLSearchParams(window.location.search).get('open') || ''; } catch (e) { want = ''; }
    if (!want) return;
    var ball = ballBy(want);
    if (ball) window.setTimeout(function () { ball.click(); }, 60);
  }

  function ballBy(name) {
    return balls.filter(function (b) { return b.getAttribute('data-ball') === name; })[0];
  }

  function toast(text, bad) {
    var box = doc.querySelector('.studio__toast');
    if (!box) {
      box = doc.createElement('div');
      box.className = 'studio__toast';
      box.setAttribute('role', 'status');
      root.appendChild(box);
    }
    box.textContent = text;
    box.classList.toggle('is-bad', Boolean(bad));
    box.classList.add('is-on');
    window.clearTimeout(box.__t);
    box.__t = window.setTimeout(function () { box.classList.remove('is-on'); }, bad ? 5200 : 2600);
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

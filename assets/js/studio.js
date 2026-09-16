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

  /* --------------------------------------------------------- 右键：改名 / 撤下
     只有站长看得到这个菜单：浏览器里存着口令（门厅存的，或第一次上传时输入的），
     而且服务认这把口令。访客右键 = 浏览器自己那一套，这里一个字都不拦。

     菜单挂在三种地方，做的事其实只有两件：
       板块（轨道栏 / 首页索引 / 卷帘的轨道头）→ 重命名 · 删除
       文章（板块页与归档的文章行 / 卷帘上的音符）→ 重命名 · 删除
     站点里有两层东西，菜单对它们说的话不一样：
       界面建的（data/*.json）——真的删，连它带的图片视频音乐一起删；
       content/posts.mjs 里原生的那批——只「撤下」：服务在 data/overrides.json
       里记一笔，源文件一个字节不动，随时能放回来（菜单里的「撤销」就干这个）。
     键盘一样能用：Tab 到那一项上按 Shift+F10（或菜单键）。手机上是长按。
     ============================================================ */
  var CN_NUM = ['零', '一', '两', '三', '四', '五', '六', '七', '八', '九', '十'];
  var menu = null;          /* 当前开着的那一个 */
  var menuOwner = null;     /* 菜单是给谁开的（关掉之后焦点还回去） */
  var menuAt = null;        /* 菜单是在哪儿弹的（编辑时光标就落在那儿） */
  var verified = false;     /* 口令这次会话里验过没有 */
  var layers = null;        /* { sections: {id:…}, posts: {slug:…} }：哪一层的东西，懒取一次 */
  var longPress = null;
  var ateClick = false;

  /* 地址里的板块 id / 文章 slug。静态页里烤着的是绝对地址，sections.js 刚补进来
     的那几条是相对的（sections/x.html）——两种都得认。 */
  function sectionIdOf(href) {
    var m = /(?:^|\/)sections\/([^/]+?)(?:\/([^/]+?))?\.html(?:[?#]|$)/.exec(String(href || ''));
    return m ? decodeURIComponent(m[1]) : '';
  }
  function slugOf(href) {
    var m = /(?:^|\/)posts\/([^/]+?)\.html(?:[?#]|$)/.exec(String(href || ''));
    return m ? decodeURIComponent(m[1]) : '';
  }

  /* 右键点到了什么？认不出就不弹（正文之外的空白都归浏览器） */
  function targetOf(node) {
    if (!node || !node.closest) return null;
    var key = node.closest('a.key');
    if (key && key.closest('.rail')) return { kind: 'section', id: sectionIdOf(key.getAttribute('href')), el: key };
    var entry = node.closest('.entry');
    if (entry) {
      var ea = entry.querySelector('.entry__name a');
      if (ea) return { kind: 'section', id: sectionIdOf(ea.getAttribute('href')), el: entry };
    }
    var head = node.closest('.roll .head');
    if (head) return { kind: 'section', id: sectionIdOf(head.getAttribute('href')), el: head };

    /* 文章页：正文（点哪儿改哪儿）、标题、以及板块页上的两段文字 */
    var prose = node.closest('.prose');
    if (prose) {
      var slug = slugOf(location.pathname);
      if (slug) return { kind: 'body', slug: slug, el: prose };
    }
    var title = node.closest('.article__title');
    if (title) {
      var slugT = slugOf(location.pathname);
      if (slugT) return { kind: 'post', slug: slugT, el: title };
    }
    var lede = node.closest('.lede');
    if (lede) {
      var sid = sectionIdOf(location.pathname);
      if (sid) return { kind: 'text', id: sid, field: 'lede', el: lede };
    }
    var def = node.closest('.sect-head__def');
    if (def) {
      var sidD = sectionIdOf(location.pathname);
      if (sidD) return { kind: 'text', id: sidD, field: 'def', el: def };
    }
    var h1 = node.closest('.sect-head__name');
    if (h1) {
      var sidH = sectionIdOf(location.pathname);
      if (sidH) return { kind: 'section', id: sidH, el: h1 };
    }

    var row = node.closest('.post-row');
    if (row) {
      var link = row.querySelector('.post-row__link');
      if (link) return { kind: 'post', slug: slugOf(link.getAttribute('href')), el: row };
    }
    var note = node.closest('.roll a.note');
    if (note) return { kind: 'post', slug: slugOf(note.getAttribute('href')), el: note };
    return null;
  }

  /* 两层的名单：板块是不是原生（seed）、文章是不是运行时写的 */
  function loadLayers() {
    if (layers) return Promise.resolve(layers);
    return Promise.all([
      cv01.fetchJSON(API + 'sections'),
      cv01.fetchJSON(API + 'posts').catch(function () { return { posts: [] }; }),
    ]).then(function (out) {
      var sec = {};
      var post = {};
      ((out[0] && out[0].sections) || []).forEach(function (s) {
        sec[s.id] = { seed: Boolean(s.seed), name: s.name, pitch: s.pitch };
      });
      ((out[1] && out[1].posts) || []).forEach(function (p) {
        post[p.slug] = {
          runtime: Boolean(p.runtime),
          title: p.title,
          section: p.section,
          sectionName: p.sectionName,
          /* 正文被页面上改过的那种也捎上：菜单要靠它决定要不要摆「恢复成源文件」 */
          body: p.body || '',
        };
      });
      layers = { sections: sec, posts: post };
      return layers;
    });
  }
  function forgetLayers() { layers = null; }

  /* ------------------------------------------------------------ 菜单本身 */
  function closeMenu(back) {
    if (!menu) return;
    var owner = menuOwner;
    menu.remove();
    menu = null;
    menuOwner = null;
    if (back && owner && owner.focus) owner.focus();
  }

  function openMenu(target, x, y, items) {
    closeMenu(false);
    if (!items.length) return;
    menuOwner = target.el;
    menu = doc.createElement('div');
    menu.className = 'ctx';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', target.kind === 'section' ? '板块' : '文章');
    items.forEach(function (item) {
      var b = doc.createElement('button');
      b.type = 'button';
      b.className = 'ctx__item' + (item.danger ? ' ctx__item--danger' : '');
      b.setAttribute('role', 'menuitem');
      b.textContent = item.label;
      b.addEventListener('click', function () {
        closeMenu(false);
        item.run();
      });
      menu.appendChild(b);
    });
    /* 先摆到屏幕外量尺寸，再贴着指针摆好——不许出界 */
    menu.style.left = '-9999px';
    menu.style.top = '-9999px';
    doc.body.appendChild(menu);
    var box = menu.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(x, window.innerWidth - box.width - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(y, window.innerHeight - box.height - 8)) + 'px';
    var first = menu.querySelector('.ctx__item');
    if (first && !window.matchMedia('(hover: none)').matches) first.focus();
  }

  function menuFor(target, x, y) {
    menuAt = { x: x, y: y };
    var ok = verified
      ? Promise.resolve()
      : cv01.fetchJSON(API + 'auth', { method: 'POST', json: {} }).then(function () { verified = true; });
    ok.then(function () {
      return loadLayers().then(function (map) {
        var known = target.kind === 'section' ? map.sections[target.id] : map.posts[target.slug];
        if (known) return map;
        /* 名单里没有它——刚建的板块、刚写的文章、刚在别处改过的：再问一次服务 */
        forgetLayers();
        return loadLayers();
      });
    })
      .then(function (map) { openMenu(target, x, y, itemsFor(target, map)); })
      .catch(function (err) { cv01.error(err); });
  }

  function dropLabel(seed) { return seed ? '撤下' : '删除'; }

  function itemsFor(target, map) {
    if (target.kind === 'body') {
      var post = map.posts[target.slug] || { slug: target.slug, title: '这一篇' };
      var out = [{ label: '编辑正文…', run: function () { startEdit('body', target, post); } }];
      if (post.body) {
        out.push({ label: '恢复成源文件里的正文…', run: function () { restoreBody(target, post); } });
      }
      out.push({
        label: dropLabel(!post.runtime) + '这篇文章…',
        danger: true,
        run: function () { dropPost(target, post); },
      });
      return out;
    }
    if (target.kind === 'text') {
      return [{
        label: target.field === 'lede' ? '编辑这段导语…' : '编辑这段简介…',
        run: function () { startEdit('text', target, {}); },
      }];
    }
    if (target.kind === 'section') {
      var info = map.sections[target.id];
      if (!info) return [];
      return [
        { label: '重命名板块…', run: function () { renameSection(target, info); } },
        { label: dropLabel(info.seed) + '这个板块…', danger: true, run: function () { dropSection(target, info); } },
      ];
    }
    var post = map.posts[target.slug];
    if (!post) return [];
    return [
      { label: '重命名文章…', run: function () { renamePost(target, post); } },
      { label: dropLabel(!post.runtime) + '这篇文章…', danger: true, run: function () { dropPost(target, post); } },
    ];
  }

  /* ------------------------------------------------------------ 浮层
     与口令那一个同一套壳（.keygate）。value 给了就是「改名字」，没给就是「确认」。 */
  function ask(opts) {
    return new Promise(function (resolve) {
      var wrap = doc.createElement('div');
      wrap.className = 'keygate';
      var form = doc.createElement('form');
      form.className = 'keygate__box';

      var title = doc.createElement('p');
      title.className = 'keygate__title';
      title.textContent = opts.title;
      form.appendChild(title);

      if (opts.hint) {
        var hint = doc.createElement('p');
        hint.className = 'keygate__hint';
        hint.textContent = opts.hint;
        form.appendChild(hint);
      }

      var input = null;
      var row = doc.createElement('div');
      row.className = 'keygate__row';
      if (typeof opts.value === 'string') {
        input = doc.createElement('input');
        input.className = 'keygate__input keygate__input--text';
        input.type = 'text';
        input.value = opts.value;
        input.maxLength = opts.maxlength || 120;
        input.setAttribute('aria-label', opts.title);
        row.appendChild(input);
      }
      var go = doc.createElement('button');
      go.className = 'keygate__go';
      go.type = 'submit';
      go.textContent = opts.ok || '确认';
      row.appendChild(go);
      form.appendChild(row);

      var cancel = doc.createElement('button');
      cancel.className = 'keygate__cancel';
      cancel.type = 'button';
      cancel.textContent = '取消';
      form.appendChild(cancel);

      wrap.appendChild(form);
      doc.body.appendChild(wrap);
      if (input) window.setTimeout(function () { input.focus(); input.select(); }, 30);
      else window.setTimeout(function () { go.focus(); }, 30);

      function done(value) {
        wrap.remove();
        doc.removeEventListener('keydown', onKey, true);
        resolve(value);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); }
      }
      doc.addEventListener('keydown', onKey, true);
      cancel.addEventListener('click', function () { done(null); });
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        done(input ? input.value.trim() : '');
      });
    });
  }

  /* ------------------------------------------------------------ 把改动画回页面上
     DOM 里的地址都是相对的（../sections/x.html），所以一律按后缀认。 */
  function each(selector, fn) { Array.prototype.forEach.call(doc.querySelectorAll(selector), fn); }
  function drop(selector) { each(selector, function (n) { n.remove(); }); }
  function hrefTail(path) { return '[href$="' + path + '"]'; }

  function paintSection(id, name) {
    var tail = 'sections/' + encodeURIComponent(id) + '.html';
    each('a.key' + hrefTail(tail) + ' .key__name', function (n) { n.textContent = name; });
    each('.roll .head' + hrefTail(tail) + ' .head__name', function (n) { n.textContent = name; });
    each('.entry', function (li) {
      var a = li.querySelector('.entry__name a');
      if (a && a.getAttribute('href').indexOf('sections/' + id + '.html') > -1) a.textContent = name;
    });
    var here = /\/sections\/([^/]+?)(?:\/([^/]+?))?\.html$/.exec(location.pathname);
    if (here && decodeURIComponent(here[1]) === id) {
      var h1 = doc.querySelector('.sect-head__name');
      if (h1) h1.textContent = name;
      doc.title = doc.title.replace(/^[^·]+/, name + ' ');
    }
  }

  function countTracks() {
    var rail = doc.querySelector('.rail');
    var n = rail ? rail.querySelectorAll('a.key').length : 0;
    var label = rail && rail.querySelector('.rail__label');
    if (label) label.textContent = '轨道 · ' + (CN_NUM[n] || String(n)) + '个音';
    var head = doc.querySelector('.index-head p');
    if (head) head.textContent = head.textContent.replace(/(·\s*)\d+(\s*轨)/, '$1' + n + '$2');
  }

  function unpaintSection(id, pitch) {
    var tail = 'sections/' + encodeURIComponent(id) + '.html';
    drop('a.key' + hrefTail(tail));
    each('.entry', function (li) {
      var a = li.querySelector('.entry__name a');
      if (a && a.getAttribute('href').indexOf('sections/' + id + '.html') > -1) li.remove();
    });
    drop('.roll .head' + hrefTail(tail));
    if (pitch) drop('.roll .note[data-pitch="' + pitch + '"]');
    countTracks();
  }

  function paintPost(slug, title) {
    var tail = 'posts/' + encodeURIComponent(slug) + '.html';
    each('.post-row__link' + hrefTail(tail) + ' .post-row__title', function (n) { n.textContent = title; });
    each('.roll a.note' + hrefTail(tail), function (n) {
      n.setAttribute('data-title', title);
      n.setAttribute('aria-label', title + '（' + (n.getAttribute('data-pitch') || '') + '，' +
        (n.getAttribute('data-min') || '') + ' 分钟）');
    });
  }

  function countPosts(pitch, sectionId) {
    var list = doc.querySelector('main .post-list');
    var head = doc.querySelector('.sect-head__pitch');
    if (list && head) {
      head.textContent = head.textContent.replace(/(·\s*)\d+(\s*篇)/, '$1' + list.querySelectorAll('.post-row').length + '$2');
    }
    if (pitch) {
      var n = doc.querySelectorAll('.roll .note[data-pitch="' + pitch + '"]').length;
      each('.roll .head[data-pitch="' + pitch + '"] .head__count', function (el) { el.textContent = n + ' 篇'; });
    }
    if (sectionId) {
      each('.entry', function (li) {
        var a = li.querySelector('.entry__name a');
        if (!a || a.getAttribute('href').indexOf('sections/' + sectionId + '.html') === -1) return;
        var count = li.querySelector('.entry__count');
        if (count) count.textContent = Math.max(0, (parseInt(count.textContent, 10) || 0) - 1) + ' 篇';
      });
    }
  }

  function unpaintPost(slug, pitch, sectionId) {
    var tail = 'posts/' + encodeURIComponent(slug) + '.html';
    each('.post-row', function (li) {
      var a = li.querySelector('.post-row__link');
      if (a && a.getAttribute('href').indexOf('posts/' + slug + '.html') > -1) li.remove();
    });
    drop('.roll a.note' + hrefTail(tail));
    countPosts(pitch, sectionId);
  }

  /* ------------------------------------------------------------ 四件事
     每一件都走 cv01.withKey：没口令 / 口令过期时，服务回 401，它会先把口令问来
     再重放一次。菜单本来就只对「浏览器里有口令」的人开，这里是第二道——
     身份、口令、服务端校验，三道都过才写得进去。 */
  function patchSection(id, body) {
    return cv01.withKey(function () {
      return cv01.fetchJSON(API + 'sections/' + encodeURIComponent(id), { method: 'PATCH', json: body });
    });
  }
  function patchPost(key, body) {
    return cv01.withKey(function () {
      return cv01.fetchJSON(API + 'articles/' + encodeURIComponent(key), { method: 'PATCH', json: body });
    });
  }
  function dropSectionReq(id) {
    return cv01.withKey(function () {
      return cv01.fetchJSON(API + 'sections/' + encodeURIComponent(id), { method: 'DELETE' });
    });
  }
  function dropPostReq(key) {
    return cv01.withKey(function () {
      return cv01.fetchJSON(API + 'articles/' + encodeURIComponent(key), { method: 'DELETE' });
    });
  }

  function renameSection(target, info) {
    ask({
      title: '重命名板块',
      hint: '只改显示名。音高 ' + info.pitch + ' 与地址都不动，文章也留在原处。',
      value: info.name,
      ok: '改名',
      maxlength: 40,
    }).then(function (name) {
      if (name === null) return;
      if (!name) return cv01.toast('名字不能空着', true);
      return patchSection(target.id, { name: name }).then(function () {
        paintSection(target.id, name);
        forgetLayers();
        cv01.toast('改好了：' + info.name + ' → ' + name);
      });
    }).catch(function (err) { cv01.error(err); });
  }

  function dropSection(target, info) {
    var native = info.seed;
    ask({
      title: (native ? '撤下' : '删除') + '板块「' + info.name + '」？',
      hint: native
        ? '它是 content/posts.mjs 里的原生板块（tools/build.mjs 生成的）。撤下之后站点上不再出现，源文件一个字节不动，随时能放回来。'
        : '它存在 data/sections.json 里，会真的删掉；用它写的文章，连同那些图片 / 视频 / 音乐，一起走。',
      ok: native ? '撤下' : '删除',
    }).then(function (yes) {
      if (yes === null) return;
      return dropSectionReq(target.id)
        .then(function (data) {
          unpaintSection(target.id, info.pitch);
          forgetLayers();
          if (data.mode === 'hidden') {
            cv01.toast('「' + info.name + '」撤下了——源文件没动', false, {
              label: '撤销',
              run: function () {
                patchSection(target.id, { hidden: false }).then(function () {
                  cv01.toast('放回来了，刷新一下就看到');
                  window.setTimeout(function () { window.location.reload(); }, 700);
                }).catch(function (err) { cv01.error(err); });
              },
            });
          } else {
            cv01.toast('「' + info.name + '」删掉了' + (data.removedArticles ? '，连同 ' + data.removedArticles + ' 篇文章' : ''));
          }
        });
    }).catch(function (err) { cv01.error(err); });
  }

  function renamePost(target, post) {
    ask({
      title: '重命名文章',
      hint: post.runtime
        ? '这篇是编辑页写的，改的是 data/articles.json 里的标题。'
        : '这篇在 content/posts.mjs 里：只改站点上显示的名字，源文件不动（改回来只要再改一次）。',
      value: post.title,
      ok: '改名',
      maxlength: 120,
    }).then(function (title) {
      if (title === null) return;
      if (!title) return cv01.toast('标题不能空着', true);
      return patchPost(target.slug, { title: title }).then(function () {
        paintPost(target.slug, title);
        forgetLayers();
        cv01.toast('改好了：' + post.title + ' → ' + title);
      });
    }).catch(function (err) { cv01.error(err); });
  }

  function dropPost(target, post) {
    var native = !post.runtime;
    ask({
      title: (native ? '撤下' : '删除') + '文章「' + post.title + '」？',
      hint: native
        ? '它在 content/posts.mjs 里。撤下之后站点上不再出现（那一页会回一句「已撤下」），源文件不动，随时能放回来。'
        : '它是编辑页写的，会从 data/articles.json 里真的删掉，连同它的图片 / 视频 / 音乐。',
      ok: native ? '撤下' : '删除',
    }).then(function (yes) {
      if (yes === null) return;
      return dropPostReq(target.slug)
        .then(function (data) {
          var pitch = target.el && target.el.getAttribute ? target.el.getAttribute('data-pitch') : '';
          unpaintPost(target.slug, pitch, post.section);
          forgetLayers();
          if (data.mode === 'hidden') {
            cv01.toast('「' + post.title + '」撤下了——源文件没动', false, {
              label: '撤销',
              run: function () {
                patchPost(target.slug, { hidden: false }).then(function () {
                  cv01.toast('放回来了，刷新一下就看到');
                  window.setTimeout(function () { window.location.reload(); }, 700);
                }).catch(function (err) { cv01.error(err); });
              },
            });
          } else {
            cv01.toast('「' + post.title + '」删掉了');
          }
        });
    }).catch(function (err) { cv01.error(err); });
  }

  /* ------------------------------------------------------------ 页面上直接改字
     右键 → 编辑正文 / 编辑这段文字：那一段当场变成可编辑的，光标落在你点的地方，
     页面上多出一条工具条（加粗 / 斜体 / 下划线·青 / 下划线·粉 / 划掉 / 四档字号）。
     与 Word 那一套一样：选中文字再加效果，或者先把光标放好再打。

     存到哪儿，还是那两层：
       界面写的文章（data/articles.json）→ 真正的 body 字段
       content/posts.mjs 里的原生文章 → data/overrides.json 里的 body（源文件不动）
     板块页上那两段文字（简介 / 导语）本来就是 data/sections.json 里的字段，直接改。
     下划线用 <u style="text-decoration-color: var(--miku)"> —— 存的是 var()，
     所以换配色、切夜间它都跟着走；Markdown 表达不了下划线，所以这里存 HTML。
     ============================================================ */
  var edit = null;   /* { kind, el, target, info, before, beforeText, bar, changed } */

  function markChanged() { if (edit) edit.changed = true; }

  function placeCaret(el, x, y) {
    var range = null;
    try {
      if (doc.caretRangeFromPoint) range = doc.caretRangeFromPoint(x, y);
      else if (doc.caretPositionFromPoint) {
        var pos = doc.caretPositionFromPoint(x, y);
        if (pos) { range = doc.createRange(); range.setStart(pos.offsetNode, pos.offset); }
      }
    } catch (e) { range = null; }
    if (!range || !range.startContainer || !el.contains(range.startContainer)) {
      range = doc.createRange();
      range.selectNodeContents(el);
      range.collapse(false);         /* 认不出点在哪：光标落到末尾 */
    }
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function execCmd(cmd, value) {
    try {
      doc.execCommand('styleWithCSS', false, false);   /* 要标签（<u>/<b>），不要行内 style */
      doc.execCommand(cmd, false, value);
    } catch (e) { /* 浏览器不认这个命令就算了，不砸场子 */ }
  }

  /* 选区盖到的那些「块」（正文的直接子元素）；光标时就是它所在的那一块 */
  function touchedBlocks(el) {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return [];
    var range = sel.getRangeAt(0);
    var out = [];
    Array.prototype.forEach.call(el.children, function (child) {
      if (range.intersectsNode(child)) out.push(child);
    });
    if (out.length) return out;
    var node = range.startContainer;
    if (node && node.nodeType === 3) node = node.parentNode;
    while (node && node.parentNode && node.parentNode !== el) node = node.parentNode;
    return node && node.parentNode === el ? [node] : [];
  }

  /* 换标签（p ⇄ h2 ⇄ h3）自己做，不走 execCommand：
     它一换标签就把选区弄丢，之后再问「选区盖到了哪几段」会把整篇都算进来，
     于是「这一行是注释」的 class 会被邻居顺手摘掉。自己换，属性、子节点、类全在手里。 */
  var RETAGGABLE = /^(p|h[1-6]|div|blockquote)$/i;

  function retag(el, tag) {
    if (String(el.tagName).toLowerCase() === tag) return el;
    var next = doc.createElement(tag);
    for (var i = 0; i < el.attributes.length; i++) next.setAttribute(el.attributes[i].name, el.attributes[i].value);
    while (el.firstChild) next.appendChild(el.firstChild);
    el.parentNode.replaceChild(next, el);
    return next;
  }

  function setBlock(tag, note) {
    var blocks = touchedBlocks(edit.el);
    if (!blocks.length) return;
    var first = null;
    blocks.forEach(function (b) {
      /* 列表 / 引用 / 代码块不动标签，只跟着变字号那一档 */
      var next = RETAGGABLE.test(b.tagName) ? retag(b, tag) : b;
      if (note) next.classList.add('prose-note');
      else next.classList.remove('prose-note');
      if (!first) first = next;
    });
    if (!first) return;
    var range = doc.createRange();
    range.selectNodeContents(first);
    range.collapse(false);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function underline(color) {
    execCmd('underline');
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    var range = sel.getRangeAt(0);
    Array.prototype.forEach.call(edit.el.querySelectorAll('u'), function (u) {
      if (range.intersectsNode(u)) u.style.setProperty('text-decoration-color', color);
    });
  }

  function rteButton(group, text, title, run, extra) {
    var b = doc.createElement('button');
    b.type = 'button';
    b.className = 'rte__btn' + (extra ? ' ' + extra : '');
    b.textContent = text;
    b.title = title;
    b.setAttribute('aria-label', title);
    /* 按下鼠标不能让可编辑区丢焦点，不然选区就没了 */
    b.addEventListener('mousedown', function (e) { e.preventDefault(); });
    b.addEventListener('click', function () { run(); });
    group.appendChild(b);
    return b;
  }

  function buildBar(kind) {
    var bar = doc.createElement('div');
    bar.className = 'rte';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', kind === 'body' ? '编辑正文' : '编辑这段文字');

    var label = doc.createElement('p');
    label.className = 'rte__label';
    label.textContent = kind === 'body' ? '编辑正文' : '编辑这段文字';
    bar.appendChild(label);

    /* 字号四档：一级 / 二级 / 正文 / 注释。板块页那两行字是版式的一部分，不给改字号 */
    if (kind === 'body') {
      var sizes = doc.createElement('div');
      sizes.className = 'rte__group';
      sizes.setAttribute('role', 'group');
      sizes.setAttribute('aria-label', '字号');
      bar.appendChild(sizes);
      rteButton(sizes, '一级', '一级标题（h2）', function () { setBlock('h2', false); });
      rteButton(sizes, '二级', '二级标题（h3）', function () { setBlock('h3', false); });
      rteButton(sizes, '正文', '正文段落', function () { setBlock('p', false); });
      rteButton(sizes, '注释', '注释（小字）', function () { setBlock('p', true); });
    }

    var fx = doc.createElement('div');
    fx.className = 'rte__group';
    fx.setAttribute('role', 'group');
    fx.setAttribute('aria-label', '文字效果');
    bar.appendChild(fx);
    rteButton(fx, 'B', '加粗', function () { execCmd('bold'); }, 'rte__btn--b');
    rteButton(fx, 'I', '斜体', function () { execCmd('italic'); }, 'rte__btn--i');
    rteButton(fx, 'U', '下划线（青）', function () { underline('var(--miku)'); }, 'rte__btn--u rte__btn--cyan');
    rteButton(fx, 'U', '下划线（粉）', function () { underline('var(--cuer)'); }, 'rte__btn--u rte__btn--pink');
    rteButton(fx, 'S', '划掉', function () { execCmd('strikeThrough'); }, 'rte__btn--s');

    var acts = doc.createElement('div');
    acts.className = 'rte__group rte__group--acts';
    acts.setAttribute('role', 'group');
    acts.setAttribute('aria-label', '保存还是算了');
    bar.appendChild(acts);
    rteButton(acts, '保存', '保存（Ctrl+S）', function () { saveEdit(); }, 'rte__btn--save');
    rteButton(acts, '取消', '取消（Esc）', function () { cancelEdit(); }, 'rte__btn--cancel');

    var hint = doc.createElement('p');
    hint.className = 'rte__hint';
    hint.textContent = '选中文字再加效果；Esc 取消，Ctrl+S 保存';
    bar.appendChild(hint);
    return bar;
  }

  /* 工具条贴着命令栏往下挂。命令栏是 sticky 的，位置随滚动变（顶上还有「每日一句」
     那一条会滚走），所以不能写死——每次开、每次滚都按它的实际底边算一次。 */
  function placeBar() {
    if (!edit || !edit.bar) return;
    var bar = doc.querySelector('.bar');
    var y = bar ? Math.round(bar.getBoundingClientRect().bottom + 10) : 10;
    edit.bar.style.top = Math.max(10, y) + 'px';
  }

  window.addEventListener('scroll', placeBar, true);
  window.addEventListener('resize', placeBar);

  function startEdit(kind, target, info) {
    if (edit) return;
    closeMenu(false);
    var el = target.el;
    var point = menuAt || { x: 0, y: 0 };
    edit = {
      kind: kind,
      el: el,
      target: target,
      info: info || {},
      before: el.innerHTML,
      beforeText: kind === 'text' ? textWithBreaks(el) : el.textContent,
      changed: false,
      bar: null,
    };
    el.setAttribute('contenteditable', 'true');
    el.setAttribute('spellcheck', 'false');
    doc.documentElement.setAttribute('data-editing', kind);
    el.focus();
    placeCaret(el, point.x, point.y);
    el.addEventListener('input', markChanged);
    doc.addEventListener('keydown', onEditKey, true);
    edit.bar = buildBar(kind);
    doc.body.appendChild(edit.bar);
    placeBar();
  }

  function stopEdit(restore) {
    if (!edit) return;
    var el = edit.el;
    el.removeEventListener('input', markChanged);
    doc.removeEventListener('keydown', onEditKey, true);
    if (restore) el.innerHTML = edit.before;
    el.removeAttribute('contenteditable');
    el.removeAttribute('spellcheck');
    doc.documentElement.removeAttribute('data-editing');
    if (edit.bar) edit.bar.remove();
    edit = null;
  }

  function onEditKey(e) {
    if (!edit) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancelEdit();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      e.stopPropagation();
      saveEdit();
    }
  }

  function cancelEdit() {
    if (!edit) return;
    if (!edit.changed) { stopEdit(true); return; }
    ask({
      title: '放弃这次修改？',
      hint: '改的东西还没保存——放弃就回到原来的样子。',
      ok: '放弃',
    }).then(function (yes) {
      if (yes === null) return;
      stopEdit(true);
      cv01.toast('没保存，改回去了');
    });
  }

  /* 板块页那两行是纯文本，但换行有意义（原生导语里就有 <br>）：
     读的时候只留 <br>，其余标签拍平；写回去的也是这个形状。 */
  function textWithBreaks(el) {
    var clone = el.cloneNode(true);
    Array.prototype.forEach.call(clone.querySelectorAll('*'), function (n) {
      if (String(n.tagName).toLowerCase() === 'br') return;
      while (n.firstChild) n.parentNode.insertBefore(n.firstChild, n);
      n.remove();
    });
    return clone.innerHTML
      .replace(/\s+/g, ' ')
      .replace(/(?:\s*<br\s*\/?>\s*)+/gi, '<br>')
      .trim();
  }

  function saveEdit() {
    if (!edit) return;
    var kind = edit.kind;
    var target = edit.target;
    var info = edit.info;
    var el = edit.el;
    var before = edit.before;
    var beforeText = edit.beforeText;

    var request;
    var where;
    if (kind === 'text') {
      /* 板块页那两行是纯文本（换行用 <br> 带着），存回 data/sections.json */
      var text = textWithBreaks(el);
      if (!text) { cv01.toast('这一段不能空着', true); return; }
      if (text === String(beforeText || '').trim()) { stopEdit(true); return; }
      var patch = {};
      patch[target.field] = text;
      request = patchSection(target.id, patch);
      where = 'data/sections.json';
    } else {
      request = patchPost(target.slug, { body: el.innerHTML });
      where = info.runtime ? 'data/articles.json' : 'data/overrides.json（源文件没动）';
    }

    request.then(function () {
      stopEdit(false);
      forgetLayers();
      cv01.toast('改好了，存进了 ' + where, false, {
        label: '撤销',
        run: function () {
          var back = kind === 'text'
            ? (function () {
                var p = {};
                p[target.field] = beforeText;
                return patchSection(target.id, p);
              })()
            : patchPost(target.slug, { body: before });
          Promise.resolve(back).then(function () {
            cv01.toast('改回来了，刷新一下就看到');
            window.setTimeout(function () { window.location.reload(); }, 700);
          }).catch(function (err) { cv01.error(err); });
        },
      });
    }).catch(function (err) { cv01.error(err); });
  }

  /* 把上一次「页面上改的正文」撤掉，回到 content/posts.mjs（或 Markdown 源）里的那一份 */
  function restoreBody(target, post) {
    ask({
      title: '恢复成源文件里的正文？',
      hint: post.runtime
        ? '这一篇是编辑页写的：正文会回到 data/articles.json 里那份 Markdown 渲染出来的样子。'
        : '这一篇在 content/posts.mjs 里：页面上改的那一版会从 data/overrides.json 里删掉，回到源文件的正文。',
      ok: '恢复',
    }).then(function (yes) {
      if (yes === null) return;
      return patchPost(target.slug, { body: false }).then(function () {
        forgetLayers();
        cv01.toast('恢复了，刷新一下就看到');
        window.setTimeout(function () { window.location.reload(); }, 700);
      });
    }).catch(function (err) { cv01.error(err); });
  }

  /* ------------------------------------------------------------ 谁来喊菜单 */
  doc.addEventListener('contextmenu', function (e) {
    var target = targetOf(e.target);
    if (!target) return;
    if (!online || !cv01.key()) return;      /* 没服务 / 没口令：这一页对访客照旧 */
    e.preventDefault();
    menuFor(target, e.clientX, e.clientY);
  });

  /* 触摸屏没有右键：长按也算（有的浏览器自己还会弹一个，两个都在也不碍事） */
  doc.addEventListener('touchstart', function (e) {
    if (!online || !cv01.key() || e.touches.length !== 1) return;
    var target = targetOf(e.target);
    if (!target) return;
    var t = e.touches[0];
    longPress = window.setTimeout(function () {
      longPress = null;
      ateClick = true;
      menuFor(target, t.clientX, t.clientY);
    }, 550);
  }, { passive: true });

  ['touchend', 'touchmove', 'touchcancel'].forEach(function (name) {
    doc.addEventListener(name, function () {
      if (!longPress) return;
      window.clearTimeout(longPress);
      longPress = null;
    }, { passive: true });
  });

  /* 长按抬起手指时浏览器还会补一次 click（可能就跳走了）：吃掉它。
     必须 stopImmediatePropagation——同一个节点上还挂着「点外面就收起」那条，
     光 stopPropagation 拦不住它，菜单会在刚弹出来的下一秒被自己关掉。 */
  doc.addEventListener('click', function (e) {
    if (!ateClick) return;
    ateClick = false;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }, true);

  /* 点外面 / 滚动 / 改窗口大小 / Esc：菜单收起 */
  doc.addEventListener('click', function (e) {
    if (menu && !menu.contains(e.target)) closeMenu(false);
  }, true);
  window.addEventListener('scroll', function () { closeMenu(false); }, true);
  window.addEventListener('resize', function () { closeMenu(false); });
  window.addEventListener('blur', function () { closeMenu(false); });

  doc.addEventListener('keydown', function (e) {
    if (menu) {
      var items = Array.prototype.slice.call(menu.querySelectorAll('.ctx__item'));
      var i = items.indexOf(doc.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); closeMenu(true); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1 + items.length) % items.length].focus(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); return; }
    }
  }, true);

  /* 面板换过内容、页面换过页：两层名单也可能变了，下次右键重新问一遍；
     换页时开着的那一个菜单也顺手收掉（它锚在上一页的元素上） */
  doc.addEventListener('cv01:sections-changed', forgetLayers);
  doc.addEventListener('cv01:navigated', function () {
    forgetLayers();
    closeMenu(false);
  });

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

  /* 提示条。action 可选：{ label, run }——「撤下」之后那次「撤销」就挂在这儿。
     hold：这句话需要多停一会儿（比如「那版富文本让位了」）。 */
  function toast(text, bad, action, hold) {
    var box = doc.querySelector('.studio__toast');
    if (!box) {
      box = doc.createElement('div');
      box.className = 'studio__toast';
      box.setAttribute('role', 'status');
      root.appendChild(box);
    }
    box.textContent = '';
    var line = doc.createElement('span');
    line.textContent = text;
    box.appendChild(line);
    if (action) {
      var act = doc.createElement('button');
      act.type = 'button';
      act.className = 'studio__toast-act';
      act.textContent = action.label;
      act.addEventListener('click', function () {
        box.classList.remove('is-on');
        action.run();
      });
      box.appendChild(act);
    }
    box.classList.toggle('is-bad', Boolean(bad));
    box.classList.add('is-on');
    window.clearTimeout(box.__t);
    box.__t = window.setTimeout(function () { box.classList.remove('is-on'); },
      action ? 9000 : (bad ? 5200 : (hold ? 7600 : 2600)));
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

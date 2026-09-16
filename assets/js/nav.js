/* ==========================================================================
   nav.js · 站内跳转的局部刷新 —— 让音乐不中断
   ---------------------------------------------------------------------------
   站点是多页的：整页刷新会把右下角那根 <audio> 一起销毁，歌于是从头再放。
   所以站内链接改走这里：fetch 目标页 → 只换 <main>、<title> 与描述，
   命令栏与轨道栏的高亮就地更新，<audio> 和悬浮工作台原地不动。
   切板块、翻文章，音乐一秒都不停。

   任何一条不成立就退回原来的整页跳转，行为与以前一模一样：
     · file:// 打开（没有 fetch）
     · 目标是外链 / 非 .html / 云村页
     · 中键、Ctrl/⌘/Shift/Alt 点击，target=_blank，download，data-no-spa
     · 目标页取不到（404、断网）

   云村页为什么整页走：它自带一套扫码轮询的定时器和自己的播放器，
   局部换进来之后那些东西不会被回收 —— 那一页进出都老老实实整页跳。
   ========================================================================== */
(function () {
  'use strict';

  var doc = document;
  var cv01 = (window.cv01 = window.cv01 || {});
  var FULL = /\/kumura\.html$/i;

  /* file:// 与静态托管上的本地文件：没有 fetch，整站维持原样 */
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
  if (FULL.test(location.pathname)) return;

  /* 当前正文所属的地址。定目标、比链接都以它为准，不跟着 pushState 漂 */
  var here = new URL(location.href);
  var token = 0;

  /* 第一个历史条目也记上，否则「从文章返回首页」会退化成整页跳转 */
  history.replaceState(Object.assign({}, history.state, { cv01: true, scroll: 0 }), '', location.href);

  /* 换页只换 <main>，命令栏 / 轨道栏 / 页脚 / 每日一句 / favicon 都留在原地，
     可它们的 href 是按「第一次加载那一页」的深度写的（'' 或 '../'）。
     文档地址一变，这些相对地址就会解析到 /sections/index.html 这种不存在的地方。
     所以外壳里的相对地址在这里改成绝对地址，正文里的不动
     —— 正文是整块换进来的，本身就相对新地址。
     sections.js 往外壳里补新板块的链接之后会再喊一次（cv01.absolutizeShell）。 */
  function absolutizeShell() {
    Array.prototype.forEach.call(doc.querySelectorAll('a[href], link[href]'), function (node) {
      if (node.closest && node.closest('main')) return;
      var href = node.getAttribute('href') || '';
      if (!href || href.charAt(0) === '#') return;
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return;   // 已经是绝对地址或 mailto: 之类
      try { node.setAttribute('href', new URL(href, here.href).href); } catch (e) { /* 留着原样 */ }
    });
  }
  absolutizeShell();
  cv01.absolutizeShell = absolutizeShell;

  function toUrl(href) {
    if (!href) return null;
    var url;
    try { url = new URL(href, here.href); } catch (e) { return null; }
    if (url.origin !== here.origin) return null;
    if (!/\.html?$/i.test(url.pathname)) return null;
    if (FULL.test(url.pathname)) return null;
    return url;
  }

  function fetchDoc(url) {
    return fetch(url.href, { credentials: 'same-origin' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      /* 门厅那道门有时候会把我们送回 login.html（cookie 过期了，
         或者在另一个标签页里点了「锁上门」）。那不是我想要的那一页——
         返回 null，下面会退回整页跳转，让浏览器老老实实停在门厅。 */
      if (new URL(res.url, location.href).pathname !== url.pathname) return null;
      return res.text();
    }).then(function (html) {
      return html === null ? null : new DOMParser().parseFromString(html, 'text/html');
    });
  }

  /* 「当前页」的高亮：两边按同一个键配对，不碰 URL 解析。
     命令栏认文件名，轨道栏认音高——两边每个页面都带着。 */
  function markAll(next) {
    mark('.bar__nav', next, function (el) { return (el.getAttribute('href') || '').split('/').pop(); });
    mark('.rail', next, function (el) { return el.getAttribute('data-pitch') || ''; });
  }

  function mark(selector, next, key) {
    var mine = doc.querySelector(selector);
    var fresh = next.querySelector(selector);
    if (!mine || !fresh) return;
    var want = fresh.querySelector('[aria-current="page"]');
    var wanted = want ? key(want) : '';
    Array.prototype.forEach.call(mine.querySelectorAll('a'), function (a) {
      if (wanted && key(a) === wanted) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  /* 目标页比这一页多的样式表补进来就够。
     脚本不补：那等于把别页的应用拉起来，而除了云村，全站每一页的脚本表都一样。 */
  function injectStyles(next, url) {
    var have = {};
    Array.prototype.forEach.call(doc.querySelectorAll('link[rel="stylesheet"]'), function (l) {
      have[(l.getAttribute('href') || '').split('/').pop()] = true;
    });
    Array.prototype.forEach.call(next.querySelectorAll('link[rel="stylesheet"]'), function (l) {
      var href = l.getAttribute('href') || '';
      var name = href.split('/').pop();
      if (!name || have[name]) return;
      var copy = doc.createElement('link');
      copy.rel = 'stylesheet';
      /* 按目标页的地址解析：这段跑在 pushState 之前，文档地址还是旧的 */
      try { copy.href = new URL(href, url.href).href; } catch (e) { copy.href = href; }
      doc.head.appendChild(copy);
    });
  }

  function apply(next, url, toTop) {
    var fresh = next.querySelector('main#main');
    var main = doc.querySelector('main#main');
    if (!fresh || !main) throw new Error('这一页没有正文容器');

    doc.title = next.title;
    var desc = next.querySelector('meta[name="description"]');
    var mine = doc.querySelector('meta[name="description"]');
    if (desc && mine) mine.setAttribute('content', desc.getAttribute('content') || '');

    main.className = fresh.className;
    main.innerHTML = fresh.innerHTML;

    markAll(next);
    injectStyles(next, url);

    /* 工作台与接口的基址跟着当前页走：首页是 ''，板块页/文章页是 '../'。
       漏了这一步，从文章页调 /api/… 会变成 /posts/api/… 而 404。 */
    var studio = next.querySelector('[data-studio]');
    if (studio) {
      cv01.base = studio.getAttribute('data-base') || '';
      cv01.api = cv01.base + 'api/';
    }

    /* 工作台面板跟整页刷新时一样收起来 */
    if (cv01.closePanel) cv01.closePanel();
    /* 卷帘的播放头动画、悬停读数、每日一句：按新正文重来一遍 */
    if (cv01.site && cv01.site.initPage) cv01.site.initPage();

    if (url.hash) {
      var target = doc.getElementById(url.hash.slice(1));
      if (target) { target.scrollIntoView(); return; }
    }
    if (toTop) window.scrollTo(0, 0);
    if (toTop) {
      /* 焦点交给新正文的标题：键盘与读屏不会还停在上一个页面的位置上 */
      var h1 = main.querySelector('h1');
      if (h1) {
        if (!h1.hasAttribute('tabindex')) h1.setAttribute('tabindex', '-1');
        try { h1.focus({ preventScroll: true }); } catch (e) { h1.focus(); }
      }
    }
  }

  function rememberScroll() {
    var state = history.state;
    if (!state || !state.cv01) return;
    state.scroll = Math.round(window.scrollY);
    history.replaceState(state, '', location.href);
  }

  function navigate(url, mode) {
    var mine = ++token;
    return fetchDoc(url).then(function (next) {
      if (mine !== token) return;            // 期间又点了别的链接，这一次作废
      if (!next) { location.href = url.href; return; }   // 被门厅拦下了：整页走
      if (mode === 'push') rememberScroll();
      apply(next, url, mode !== 'pop');
      if (mode === 'push') history.pushState({ cv01: true, scroll: 0 }, '', url.href);
      else if (mode === 'replace') history.replaceState({ cv01: true, scroll: 0 }, '', url.href);
      here = url;
      if (mode === 'pop' && !url.hash) window.scrollTo(0, (history.state && history.state.scroll) || 0);
      doc.dispatchEvent(new CustomEvent('cv01:navigated', { detail: { url: url.href } }));
    }).catch(function () {
      if (mine === token) location.href = url.href;   // 取不到就老老实实跳
    });
  }

  /* 对外：音效那边「先响一声，再切模块」也走这里 */
  cv01.go = function (href) {
    var url = toUrl(href);
    if (!url) { location.href = href; return; }
    if (url.href === here.href) { window.scrollTo(0, 0); return; }   // 点的是当前这一页：回顶部
    navigate(url, 'push');
  };

  doc.addEventListener('click', function (e) {
    if (e.defaultPrevented) return;                 // 音效已经接过手了，它会调 cv01.go
    /* 正在页面上直接改字：正文里的链接点一下不该跳走（那是在挑字，不是在导航） */
    if (doc.documentElement.hasAttribute('data-editing')) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    if (a.target && a.target !== '_self') return;
    if (a.hasAttribute('download') || a.hasAttribute('data-no-spa')) return;
    var url = toUrl(a.getAttribute('href'));
    if (!url) return;                               // 外链 / 云村 / 不是 .html：交给浏览器
    e.preventDefault();
    cv01.go(url);
  });

  window.addEventListener('popstate', function () {
    if (!history.state || !history.state.cv01) return;   // 不是我们建的条目
    navigate(new URL(location.href), 'pop');
  });

  /* 滚动位置由我们自己记，免得浏览器在换完正文之后又插一脚 */
  if (history.scrollRestoration) history.scrollRestoration = 'manual';
})();

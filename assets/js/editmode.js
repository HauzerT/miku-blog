/* ==========================================================================
   editmode.js · 全局编辑模式（页顶那颗「全局编辑」按钮）
   ---------------------------------------------------------------------------
   从前站长改字全靠右键：右键正文 → 菜单 → 「编辑正文…」。这一版把同一条路
   摆到了明面上——页顶按钮一按，整站进入编辑模式：

     · 虚线框里的文字点一下就变成可编辑的（不用右键）：
       板块页的板块名 / 简介 / 导语，文章页的标题 / 正文，
       以及任何页面上的轨道栏板块名、首页索引、卷帘轨道头、文章行标题。
     · 简介或导语是空的（动态板块页连那个 <p> 都没有）时，框里摆一颗
       「＋ 新建」：点它就地开工，存进去的就是从零新建的那一句。
     · Esc 退出；正在改的那一段先按它自己的规矩来（改过会问你一句）。

   身份与右键菜单同一把尺：服务在线、浏览器里有口令的人才看得到按钮。
   访客的页面一个字节都不动——按钮连 hidden 都不会解开。
   真正的权限仍然在服务端那一层（每一次 PATCH 都要口令），这里只是把手
   递到明处。改动的保存、撤销、两层去向（data/*.json 或 overrides 覆盖层）
   全部复用 studio.js 那台机器（cv01.direct）。
   ========================================================================== */
(function () {
  'use strict';

  var doc = document;
  var cv01 = (window.cv01 = window.cv01 || {});
  var btn = doc.querySelector('[data-edit-toggle]');
  if (!btn) return;

  var on = false;        /* 编辑模式开着没有 */
  var slots = [];        /* 这一页认出来的可编辑位置 */

  var EMPTY_MARKS = { '': true, '新建板块': true };   /* 动态板块页拿「新建板块」当空简介的占位 */

  /* ------------------------------------------------------------ 小工具 */

  /* 拍平成纯文本：<br> 折成空格，其余标签摘掉，空白压成一格 */
  function plainOf(html) {
    return String(html == null ? '' : html)
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/[<>]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function oneLine(el) {
    return String((el && el.textContent) || '').replace(/\s+/g, ' ').trim();
  }

  /* 这一段是不是「空的」：元素不存在、只有一个 <br>、或者只剩动态页那句
     「新建板块」占位——都算，都要给站长一颗「＋ 新建」。 */
  function isEmptyText(el) {
    if (!el) return true;
    return Boolean(EMPTY_MARKS[plainOf(el.innerHTML)] || EMPTY_MARKS[oneLine(el)]);
  }

  /* href → 板块 id / 文章 slug。绝对地址与 sections.js 补进来的相对地址都认。 */
  function sectionIdOf(href) {
    var m = /(?:^|\/)sections\/([^/]+?)(?:\/([^/]+?))?\.html(?:[?#]|$)/.exec(String(href || ''));
    return m ? decodeURIComponent(m[1]) : '';
  }
  function slugOf(href) {
    var m = /(?:^|\/)posts\/([^/]+?)\.html(?:[?#]|$)/.exec(String(href || ''));
    return m ? decodeURIComponent(m[1]) : '';
  }

  function each(list, fn) { Array.prototype.forEach.call(list, fn); }

  /* ------------------------------------------------------------ 这一页有哪些可编辑的位置
     只认「改字」这一类事：名字、简介、导语、标题、正文。
     删除 / 撤下这些破坏性的动作仍然住在右键菜单和站长工具箱里——
     编辑模式要敢开着到处点，就不能藏着一顺手就删东西的按钮。 */
  function computeTargets() {
    var out = [];
    var main = doc.querySelector('main#main');
    var path = location.pathname;

    function add(kind, el, extra) {
      if (!el) return;
      var slot = Object.assign({ kind: kind, el: el }, extra || {});
      out.push(slot);
    }

    /* 任何页面都有的：轨道栏的板块名 */
    each(doc.querySelectorAll('.rail a.key'), function (a) {
      var id = sectionIdOf(a.getAttribute('href'));
      if (id) add('name', a.querySelector('.key__name'), { id: id });
    });
    /* 首页卷帘的轨道头 */
    each(doc.querySelectorAll('.roll--hero .head'), function (h) {
      var id = sectionIdOf(h.getAttribute('href'));
      if (id) add('name', h.querySelector('.head__name'), { id: id });
    });
    /* 首页索引：板块名与那行简介（简介就是板块的 def，只是换了地方摆） */
    each(doc.querySelectorAll('.entry'), function (li) {
      var a = li.querySelector('.entry__name a');
      var id = a ? sectionIdOf(a.getAttribute('href')) : '';
      if (!id) return;
      add('name', a, { id: id });
      add('text', li.querySelector('.entry__blurb'), { id: id, field: 'def' });
    });
    /* 板块页 / 子板块页 / 归档里的文章行标题 */
    each(doc.querySelectorAll('.post-row'), function (li) {
      var a = li.querySelector('.post-row__link');
      var slug = a ? slugOf(a.getAttribute('href')) : '';
      if (slug) add('title', li.querySelector('.post-row__title'), { slug: slug });
    });

    /* 文章页：标题与正文 */
    var pm = /\/posts\/([^/]+?)\.html$/.exec(path);
    if (pm && main) {
      var slug = decodeURIComponent(pm[1]);
      add('title', main.querySelector('.article__title'), { slug: slug });
      add('body', main.querySelector('.prose'), { slug: slug });
      return out;
    }

    /* 板块页（子板块页没有自己的简介 / 导语接口，页头那行字是子板块的，
       想改它的名字仍走右键菜单——这里不认它） */
    var sm = /\/sections\/([^/]+?)(?:\/([^/]+?))?\.html$/.exec(path);
    if (sm && !sm[2] && main) {
      var sid = decodeURIComponent(sm[1]);
      add('name', main.querySelector('.sect-head__name'), { id: sid });
      add('text', main.querySelector('.sect-head__def'), { id: sid, field: 'def' });
      /* 导语可能整段缺失（动态页在 lede 为空时连 <p> 都不渲染）：
         这一条要故意带着 null 进名单——decorate 时把它造出来。 */
      out.push({ kind: 'text', el: main.querySelector('main .lede'), id: sid, field: 'lede' });
    }
    return out;
  }

  /* ------------------------------------------------------------ 占位与「＋ 新建」 */

  /* 简介为空时那颗「＋ 新建简介」就摆在框里；导语整段缺失的动态页，
     先给它把 <p class="lede"> 造出来（摆在与静态页同一处：板块页头的后面）。 */
  function ensureLedeEl(slot) {
    var el = slot.el;
    if (el) return el;
    var head = doc.querySelector('main .sect-head');
    if (!head) return null;
    el = doc.createElement('p');
    el.className = 'lede';
    el.setAttribute('data-gm-ghost', '');
    head.insertAdjacentElement('afterend', el);
    slot.el = el;
    return el;
  }

  function chipFor(slot) {
    var b = doc.createElement('button');
    b.type = 'button';
    b.className = 'gm-chip';
    b.textContent = slot.field === 'lede' ? '＋ 新建导语' : '＋ 新建简介';
    return b;
  }

  /* 点下「＋ 新建」或点进空框之前：把占位清干净（「新建板块」那几个字、
     空导语里的 <br>、chip 本身），让编辑从一张真正的白纸开始。
     取消的话 cv01:edit-ended 会把 chip 补回来。 */
  function clearForEdit(slot) {
    var el = slot.el;
    if (!el) return;
    if (plainOf(el.innerHTML) && !EMPTY_MARKS[oneLine(el)]) return;   /* 有真内容：一个字都不动 */
    el.innerHTML = '';
  }

  /* ------------------------------------------------------------ 描点 / 擦除 */

  function decorate() {
    slots = computeTargets();
    slots.forEach(function (slot) {
      var el = slot.el;
      if (slot.field === 'lede') el = ensureLedeEl(slot);
      if (!el) return;
      el.__gm = slot;
      el.setAttribute('data-gm', slot.kind);
      if (slot.kind === 'text' && isEmptyText(el)) {
        el.classList.add('is-gm-empty');
        if (!el.querySelector('.gm-chip')) el.appendChild(chipFor(slot));
      }
    });
    if (cv01.toast && !slots.length) cv01.toast('这一页没有可编辑的文字', false, null, true);
  }

  function undecorate() {
    slots.forEach(function (slot) {
      var el = slot.el;
      if (!el) return;
      delete el.__gm;
      el.removeAttribute('data-gm');
      el.classList.remove('is-gm-empty');
      var chip = el.querySelector('.gm-chip');
      if (chip) chip.remove();
      /* 我造的那只空壳导语：人没写东西进去就一并收走，别在页面上留一个空档 */
      if (el.hasAttribute('data-gm-ghost') && isEmptyText(el)) el.remove();
      else el.removeAttribute('data-gm-ghost');
    });
    slots = [];
  }

  /* 保存或取消之后重新看一眼：存进去了 → 框里就是真内容，chip 不再出现；
     取消了一次新建 → 框还是空的，chip 补回来，随时可以再来。 */
  function refreshSlots() {
    if (!on) return;
    undecorate();
    decorate();
  }

  /* ------------------------------------------------------------ 点字即改 */

  doc.addEventListener('click', function (e) {
    if (!on) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

    /* 手上正改着一段：一次只改一段，改着的之外的链接一概不跳——
       跳了就是一次整页刷新，没保存的字就全没了。框里的链接本来就
       不会跳（浏览器对可编辑区里的链接只放光标），这里管的是框外的。 */
    if (cv01.direct && cv01.direct.active()) {
      var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (a && !a.closest('[contenteditable="true"]')) {
        e.preventDefault();
        e.stopPropagation();
        cv01.toast('先保存或取消这一段（Ctrl+S / Esc），再点链接');
      }
      return;
    }

    if (e.defaultPrevented) return;
    var el = e.target && e.target.closest ? e.target.closest('[data-gm]') : null;
    if (!el || !el.__gm) return;
    e.preventDefault();                                 /* 链接不让跳了：此刻它是字，不是门 */
    e.stopPropagation();
    var slot = el.__gm;
    clearForEdit(slot);
    var point = { x: e.clientX, y: e.clientY };
    if (slot.slug && cv01.direct.postInfo) {
      /* 查一查这篇住在哪一层（界面写的还是原生的）：提示条要说得准 */
      cv01.direct.postInfo(slot.slug)
        .then(function (info) { cv01.direct.start(slot.kind, slot, info || {}, point); })
        .catch(function () { cv01.direct.start(slot.kind, slot, {}, point); });
    } else {
      cv01.direct.start(slot.kind, slot, {}, point);
    }
  }, true);

  /* 一段编辑结束（保存 / 取消）：空位上的「＋ 新建」要重新摆一遍 */
  doc.addEventListener('cv01:edit-ended', refreshSlots);

  /* 局部刷新换完页：模式还开着就到新页面上重新认一遍位置 */
  doc.addEventListener('cv01:navigated', function () {
    if (on) { undecorate(); decorate(); }
  });

  /* ------------------------------------------------------------ 开与关 */

  function paintBtn() {
    var narrow = window.matchMedia && window.matchMedia('(max-width: 720px)').matches;
    btn.textContent = on ? (narrow ? '编辑中' : '退出编辑') : (narrow ? '编辑' : '全局编辑');
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.setAttribute('aria-label', on ? '退出全局编辑模式' : '进入全局编辑模式：点页面上的文字直接改');
    btn.title = on ? '退出编辑模式（Esc）' : '点页面上的文字直接改，不用右键';
  }

  function enter() {
    on = true;
    doc.documentElement.setAttribute('data-editmode', 'on');
    paintBtn();
    decorate();
    cv01.toast('编辑模式开着：虚线框里的文字点一下就能改，空简介 / 导语点「＋ 新建」。Esc 退出', false, null, true);
  }

  function exit() {
    on = false;
    doc.documentElement.removeAttribute('data-editmode');
    paintBtn();
    undecorate();
    /* 退出时手上还改着一段：交给它自己的规矩——改过会先问你一句 */
    if (cv01.direct && cv01.direct.active()) cv01.direct.cancel();
  }

  btn.addEventListener('click', function () {
    if (!cv01.isOnline || !cv01.isOnline()) return;
    if (on) exit();
    else enter();
  });

  /* Esc：退出模式。手上正改着一段时不接手——那一段的 Esc 是「取消这次编辑」，
     由 studio.js 处理（它改过东西还会先问一句）。 */
  doc.addEventListener('keydown', function (e) {
    if (!on || e.key !== 'Escape') return;
    if (cv01.direct && cv01.direct.active()) return;
    if (doc.querySelector('.keygate')) return;         /* 口令小条开着：Esc 是它的事 */
    exit();
  });

  /* ------------------------------------------------------------ 按钮什么时候出现
     服务在线 + 浏览器里有口令 = 站长。两个条件少一个都是访客，
     按钮保持 hidden——访客的页面不摆一把用不了的钥匙。 */
  function refresh() {
    var owner = Boolean(cv01.isOnline && cv01.isOnline() && cv01.key());
    btn.hidden = !owner;
    if (!owner && on) exit();
  }
  doc.addEventListener('cv01:online', refresh);
  doc.addEventListener('cv01:key', refresh);
  refresh();
})();

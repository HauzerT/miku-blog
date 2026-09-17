/* ==========================================================================
   sections.js · 新建板块 / 子板块 + 把服务里的板块树与文章并进静态页
   ---------------------------------------------------------------------------
   新板块不是「新建一个空文件夹」——它要接进卷帘那套语法里：
   占一个还没被用过的音高（默认帮你挑一个空的），有自己的定义和导语，
   生成出来之后，轨道栏、首页索引、卷帘、子板块都会认它。

   子板块挂在板块下面，一个板块可以有任意多个。

   下半段解决的是「建完看不见」：用界面建的板块、用编辑页写的文章，
   都只存在服务端的 data/*.json 里，而轨道栏、首页索引、大卷帘、板块页的
   文章列表、归档都是生成静态页时烤进 HTML 的。所以跑着服务时这里把服务那份
   读回来，缺的补上、多的撤掉 —— 建完立刻出现，不用刷新也不用重启生成器。
   没跑服务时这段什么都不做，静态页一个字都不动。
   ========================================================================== */
(function () {
  'use strict';

  var doc = document;
  var cv01 = (window.cv01 = window.cv01 || {});
  var host = null;
  var sections = [];
  var suggested = '';

  var PITCHES = [];
  (function () {
    var names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    for (var octave = 2; octave <= 6; octave++) {
      for (var i = 0; i < 12; i++) PITCHES.push(names[i] + octave);
    }
  })();

  function shellHtml() {
    return '' +
      '<form class="sc" novalidate>' +
      '  <div class="sc__head">' +
      '    <p class="sc__eyebrow">新建板块</p>' +
      '    <p class="sc__hint">板块 = 卷帘上的一条轨道。给它一个音高、一个名字、一句话定义，它就会出现在左边的轨道栏和首页索引里。</p>' +
      '  </div>' +
      '  <div class="sc__row">' +
      '    <label class="sc__field">' +
      '      <span class="sc__label">名字</span>' +
      '      <input class="sc__input" type="text" maxlength="40" required placeholder="比如：深夜厨房" data-name>' +
      '    </label>' +
      '    <label class="sc__field sc__field--pitch">' +
      '      <span class="sc__label">音高</span>' +
      '      <select class="sc__select" data-pitch></select>' +
      '    </label>' +
      '  </div>' +
      '  <label class="sc__field">' +
      '    <span class="sc__label">一句话定义</span>' +
      '    <input class="sc__input" type="text" maxlength="120" placeholder="出现在板块标题下面" data-def>' +
      '  </label>' +
      '  <label class="sc__field">' +
      '    <span class="sc__label">导语（可留空）</span>' +
      '    <textarea class="sc__text" rows="2" maxlength="400" placeholder="这里写什么、不写什么" data-lede></textarea>' +
      '  </label>' +
      '  <p class="sc__warn" data-warn hidden></p>' +
      '  <div class="sc__foot">' +
      '    <button class="sc__send" type="submit" data-create>建这个板块</button>' +
      '  </div>' +
      '  <div class="sc__divider"><span>现有板块的子板块</span></div>' +
      '  <div class="sc__subs">' +
      '    <label class="sc__field">' +
      '      <span class="sc__label">加到哪个板块</span>' +
      '      <select class="sc__select" data-parent></select>' +
      '    </label>' +
      '    <div class="sc__row">' +
      '      <label class="sc__field">' +
      '        <span class="sc__label">子板块名字</span>' +
      '        <input class="sc__input" type="text" maxlength="40" placeholder="比如：家常 / 探店" data-subname>' +
      '      </label>' +
      '      <button class="sc__mini" type="button" data-addsub>加子板块</button>' +
      '    </div>' +
      '    <ul class="sc__list" data-sublist></ul>' +
      '  </div>' +
      '</form>';
  }

  function fillPitches() {
    var select = host.querySelector('[data-pitch]');
    var taken = {};
    sections.forEach(function (s) { taken[s.pitch] = s.name; });
    select.innerHTML = PITCHES.map(function (p) {
      var used = taken[p];
      return '<option value="' + p + '"' + (used ? ' disabled' : '') + (p === suggested ? ' selected' : '') + '>' +
        p + (used ? '（已被「' + esc(used) + '」占用）' : p === suggested ? '（推荐：空着的）' : '') +
        '</option>';
    }).join('');
    var warn = host.querySelector('[data-warn]');
    warn.hidden = !suggested;
    warn.textContent = suggested ? '空着的音里推荐 ' + suggested + '：它接在卷帘最上面，听起来最轻。' : '';
  }

  function fillParents() {
    var select = host.querySelector('[data-parent]');
    var previous = select.value;
    select.innerHTML = sections.map(function (s) {
      return '<option value="' + s.id + '">' + s.pitch + ' · ' + esc(s.name) + '</option>';
    }).join('');
    if (previous && sections.some(function (s) { return s.id === previous; })) select.value = previous;
    paintSubs();
  }

  function paintSubs() {
    var parentId = host.querySelector('[data-parent]').value;
    var section = sections.filter(function (s) { return s.id === parentId; })[0];
    var list = host.querySelector('[data-sublist]');
    var subs = (section && section.subs) || [];
    if (!subs.length) {
      list.innerHTML = '<li class="sc__list-empty">这个板块还没有子板块。</li>';
      return;
    }
    list.innerHTML = subs.map(function (sub) {
      return '<li class="sc__item">' +
        '<a class="sc__item-name" href="' + cv01.base + 'sections/' + encodeURIComponent(parentId) + '/' + encodeURIComponent(sub.id) + '.html">' + esc(sub.name) + '</a>' +
        '<span class="sc__item-id">' + esc(sub.id) + '</span>' +
        '<button class="sc__item-x" type="button" data-dropsub="' + esc(sub.id) + '" aria-label="删除子板块">×</button>' +
        '</li>';
    }).join('');
  }

  function reload() {
    return cv01.fetchJSON(cv01.api + 'sections').then(function (data) {
      sections = data.sections || [];
      suggested = data.suggestPitch || '';
      fillPitches();
      fillParents();
    });
  }

  function createSection() {
    var name = host.querySelector('[data-name]').value.trim();
    var pitch = host.querySelector('[data-pitch]').value;
    if (!name) return cv01.toast('板块要有个名字', true);
    if (sections.some(function (s) { return s.pitch === pitch; })) return cv01.toast(pitch + ' 已经被占用了，换一个', true);

    var form = new FormData();
    form.append('name', name);
    form.append('pitch', pitch);
    form.append('def', host.querySelector('[data-def]').value.trim());
    form.append('lede', host.querySelector('[data-lede]').value.trim());

    cv01.withKey(function () { return cv01.upload(cv01.api + 'sections', form); })
      .then(function (data) {
        cv01.toast('板块「' + name + '」建好了，去 ' + pitch + ' 那条轨道看看');
        host.querySelector('[data-name]').value = '';
        host.querySelector('[data-def]').value = '';
        host.querySelector('[data-lede]').value = '';
        return reload().then(function () {
          /* 轨道栏、首页索引、卷帘都靠下面那段合并跟上，见 syncTree */
          doc.dispatchEvent(new CustomEvent('cv01:sections-changed', { detail: data.section }));
        });
      })
      .catch(cv01.error);
  }

  function createSub() {
    var parentId = host.querySelector('[data-parent]').value;
    var name = host.querySelector('[data-subname]').value.trim();
    if (!name) return cv01.toast('子板块要有个名字', true);
    var form = new FormData();
    form.append('name', name);
    cv01.withKey(function () { return cv01.upload(cv01.api + 'sections/' + parentId + '/subs', form); })
      .then(function (data) {
        host.querySelector('[data-subname]').value = '';
        cv01.toast('子板块「' + name + '」加好了');
        return reload().then(function () {
          doc.dispatchEvent(new CustomEvent('cv01:sections-changed', { detail: data.sub }));
        });
      })
      .catch(cv01.error);
  }

  function dropSub(subId) {
    var parentId = host.querySelector('[data-parent]').value;
    if (!window.confirm('删掉这个子板块？')) return;
    cv01.withKey(function () { return cv01.fetchJSON(cv01.api + 'sections/' + parentId + '/subs/' + subId, { method: 'DELETE' }); })
      .then(function () {
        cv01.toast('删掉了');
        return reload().then(function () {
          doc.dispatchEvent(new CustomEvent('cv01:sections-changed'));
        });
      })
      .catch(cv01.error);
  }

  function bind() {
    host.querySelector('form').addEventListener('submit', function (e) { e.preventDefault(); createSection(); });
    host.querySelector('[data-addsub]').addEventListener('click', createSub);
    host.querySelector('[data-parent]').addEventListener('change', paintSubs);
    host.querySelector('[data-sublist]').addEventListener('click', function (e) {
      var x = e.target.closest('[data-dropsub]');
      if (x) dropSub(x.getAttribute('data-dropsub'));
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  cv01.sections = {
    open: function (target) {
      host = doc.createElement('div');
      host.className = 'sc-wrap';
      host.innerHTML = shellHtml();
      target.appendChild(host);
      bind();
      reload().catch(cv01.error);
    },
  };

  /* ============================================================ 板块树合并
     服务是权威：它说有哪些板块、哪些子板块，页面就按它对齐。
     只动按 id 认得出的节点（轨道栏的 .key、索引的 .entry、卷帘的三列、
     子板块的 .subnav__item），别的 DOM 一概不碰。 */

  var PITCH_RE = /^([A-G])(#?)(-?\d)$/;
  var SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  var PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  var CN_NUM = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五'];

  /* 音高 → 数字。和 server/lib/store.mjs 里那套同一算法，用来排「高音在上」 */
  function pitchValue(pitch) {
    var m = PITCH_RE.exec(String(pitch || ''));
    if (!m) return -1;
    return (Number(m[3]) + 1) * 12 + SEMITONE[m[1]] + (m[2] ? 1 : 0);
  }

  function pitchName(value) {
    return PITCH_NAMES[((value % 12) + 12) % 12] + (Math.floor(value / 12) - 1);
  }

  /* href → 板块 id：'../sections/niji.html' 与绝对地址都认 */
  function idOf(href) {
    var tail = String(href || '').split('?')[0].split('#')[0].split('/').pop() || '';
    return decodeURIComponent(tail.replace(/\.html?$/i, ''));
  }

  function each(list, fn) { Array.prototype.forEach.call(list, fn); }

  function byPitchDesc(a, b) { return pitchValue(b.pitch) - pitchValue(a.pitch); }

  /* 插到「第一个音高比它低的」前面：卷帘那套语法里高音在上 */
  function insertByPitch(container, node, items, value, valOf) {
    var at = items.length;
    for (var i = 0; i < items.length; i++) {
      if (valOf(items[i]) < value) { at = i; break; }
    }
    container.insertBefore(node, items[at] || null);
  }

  function sectionHref(section) {
    return cv01.base + 'sections/' + encodeURIComponent(section.id) + '.html';
  }

  /* --- 轨道栏 --- */
  function syncRail(all) {
    var rail = doc.querySelector('.rail');
    if (!rail) return;

    var ids = {};
    all.forEach(function (s) { ids[s.id] = true; });

    var keys = Array.prototype.slice.call(rail.querySelectorAll('a.key'));
    keys = keys.filter(function (a) {
      if (ids[idOf(a.getAttribute('href'))]) return true;
      a.parentNode.removeChild(a);            // 服务里已经没有它了
      return false;
    });
    var known = {};
    keys.forEach(function (a) { known[idOf(a.getAttribute('href'))] = true; });

    /* 已经在那儿的那些：名字与音高按服务那份重写一遍。
       站长右键改过名之后，静态页里烤着的是旧名字——这里把它跟上。 */
    var byId = {};
    all.forEach(function (s) { byId[s.id] = s; });
    keys.forEach(function (a) {
      var s = byId[idOf(a.getAttribute('href'))];
      if (!s) return;
      var name = a.querySelector('.key__name');
      if (name && name.textContent !== s.name) name.textContent = s.name;
      var pitch = a.querySelector('.key__pitch');
      if (pitch && pitch.textContent !== s.pitch) pitch.textContent = s.pitch;
    });

    all.slice().sort(byPitchDesc).forEach(function (s) {
      if (known[s.id]) return;
      var a = doc.createElement('a');
      a.className = 'key' + (s.black ? ' key--black' : '');
      a.setAttribute('data-pitch', s.pitch);
      a.setAttribute('data-live', '');
      a.setAttribute('href', sectionHref(s));
      a.innerHTML = '<span class="key__pitch">' + esc(s.pitch) + '</span>' +
        '<span class="key__name">' + esc(s.name) + '</span>';
      var current = Array.prototype.slice.call(rail.querySelectorAll('a.key'));
      insertByPitch(rail, a, current, pitchValue(s.pitch), function (el) {
        return pitchValue(el.getAttribute('data-pitch'));
      });
    });

    var label = rail.querySelector('.rail__label');
    if (label) {
      var n = rail.querySelectorAll('a.key').length;
      label.textContent = '轨道 · ' + (CN_NUM[n] || String(n)) + '个音';
    }
  }

  /* --- 首页的板块索引 --- */
  function syncEntries(all, total) {
    var list = doc.querySelector('.entry-list');
    if (!list) return;

    var entryId = function (li) {
      var a = li.querySelector('.entry__name a');
      return a ? idOf(a.getAttribute('href')) : '';
    };
    var entryPitch = function (li) {
      var p = li.querySelector('.entry__pitch');
      return pitchValue(p ? p.textContent : '');
    };

    var ids = {};
    all.forEach(function (s) { ids[s.id] = true; });

    var items = Array.prototype.slice.call(list.querySelectorAll('.entry'));
    items = items.filter(function (li) {
      if (ids[entryId(li)]) return true;
      li.parentNode.removeChild(li);
      return false;
    });
    var known = {};
    items.forEach(function (li) { known[entryId(li)] = true; });

    all.slice().sort(byPitchDesc).forEach(function (s) {
      if (known[s.id]) return;
      var li = doc.createElement('li');
      li.className = 'entry';
      li.setAttribute('data-live', '');
      li.innerHTML =
        '<p class="entry__pitch">' + esc(s.pitch) + '</p>' +
        '<div>' +
          '<h3 class="entry__name"><a href="' + sectionHref(s) + '">' +
            esc(s.name) + '</a></h3>' +
          '<p class="entry__blurb">' + esc(s.def || '') + '</p>' +
          '<p class="entry__recent">最近：还没有文章</p>' +
        '</div>' +
        '<p class="entry__count">0 篇</p>';
      var current = Array.prototype.slice.call(list.querySelectorAll('.entry'));
      insertByPitch(list, li, current, pitchValue(s.pitch), entryPitch);
    });

    /* 「N 篇」与「最近：…」按服务那份重算（运行时文章也算进去），
       板块名与一句话简介也一样——右键改过名之后静态页里那份就旧了 */
    Array.prototype.forEach.call(list.querySelectorAll('.entry'), function (li) {
      var id = entryId(li);
      var s = null;
      all.forEach(function (x) { if (x.id === id) s = x; });
      if (!s) return;
      var name = li.querySelector('.entry__name a');
      if (name && name.textContent !== s.name) name.textContent = s.name;
      var blurb = li.querySelector('.entry__blurb');
      if (blurb && s.def) {
        /* 索引里这行简介是单行的：生成器把 <br> 折成空格，这里也照办——
           直接塞 textContent 会把 <br> 当字面量摆在页面上 */
        var oneLine = String(s.def).replace(/<br\s*\/?>/gi, ' ');
        if (blurb.textContent !== oneLine) blurb.textContent = oneLine;
      }
      var count = li.querySelector('.entry__count');
      if (count) count.textContent = (s.articles || 0) + ' 篇';
      var recent = li.querySelector('.entry__recent');
      if (!recent) return;
      var links = (s.recent || []).map(function (r) {
        return '<a href="' + esc(r.url) + '">' + esc(r.title) + '</a>';
      }).join('<span aria-hidden="true">·</span>');
      recent.innerHTML = '最近：' + (links || '还没有文章');
    });

    /* 索引头上那行「27 篇 · 9 轨」 */
    var head = doc.querySelector('.index-head p');
    if (head) {
      head.textContent = head.textContent
        .replace(/^\s*\d+(\s*篇)/, (total || '') + '$1')
        .replace(/(·\s*)\d+(\s*轨)/, '$1' + all.length + '$2');
    }
  }

  /* --- 板块页的文章列表 --- */
  function syncSectionPosts(all, hidden) {
    var list = doc.querySelector('main .post-list');
    if (!list) return;
    var m = /\/sections\/([^/]+?)(?:\/([^/]+?))?\.html$/.exec(location.pathname);
    if (!m || m[2]) return;                                   // 子板块页没有文章列表
    var here = decodeURIComponent(m[1]);
    var section = null;
    all.forEach(function (s) { if (s.id === here) section = s; });
    if (!section) return;

    /* 先撤掉上一轮补的，再按服务那份补缺 —— 与轨道栏同一套路 */
    each(list.querySelectorAll('[data-live]'), function (n) { n.parentNode.removeChild(n); });

    /* 被站长撤下的那些：整行拿掉（撤下的名单以服务为准，不是「缺了就删」） */
    var gone = {};
    ((hidden && hidden.posts) || []).forEach(function (p) { gone[p.slug] = true; });
    each(list.querySelectorAll('.post-row'), function (li) {
      var a = li.querySelector('.post-row__link');
      if (a && gone[idOf(a.getAttribute('href'))]) li.parentNode.removeChild(li);
    });

    /* 改过名的：当场换字（静态页里烤着的是旧标题） */
    var briefs = {};
    (section.posts || []).forEach(function (p) { briefs[p.slug] = p; });
    each(list.querySelectorAll('.post-row'), function (li) {
      var a = li.querySelector('.post-row__link');
      var p = a ? briefs[idOf(a.getAttribute('href'))] : null;
      if (!p) return;
      var title = li.querySelector('.post-row__title');
      if (title && title.textContent !== p.title) title.textContent = p.title;
      var date = li.querySelector('.post-row__date');
      if (date && p.date && date.textContent.trim() !== p.date) date.textContent = p.date;
      var blurb = li.querySelector('.post-row__blurb');
      if (blurb && typeof p.blurb === 'string' && blurb.textContent !== p.blurb) blurb.textContent = p.blurb;
    });

    var known = {};
    each(list.querySelectorAll('.post-row'), function (li) {
      var a = li.querySelector('.post-row__link');
      if (a) known[idOf(a.getAttribute('href'))] = true;
    });

    (section.runtime || []).slice().sort(function (x, y) { return x.date < y.date ? 1 : -1; })
      .forEach(function (art) {
        if (known[art.slug]) return;
        var li = doc.createElement('li');
        li.className = 'post-row';
        li.setAttribute('data-live', '');
        li.innerHTML = '<a class="post-row__link" href="' + esc(art.url) + '">' +
          '<time class="post-row__date">' + esc(art.date) + '</time>' +
          '<span class="post-row__title">' + esc(art.title) + '</span>' +
          '<span class="post-row__blurb">' + esc(art.blurb || '') + '</span>' +
          '</a>';
        insertByDate(list, li, art.date);
      });

    var pitch = doc.querySelector('.sect-head__pitch');
    if (pitch) pitch.textContent = pitch.textContent.replace(/(·\s*)\d+(\s*篇)/, '$1' + (section.articles || 0) + '$2');
  }

  /* --- 归档 --- */
  function syncArchive(all, total, hidden) {
    var main = doc.querySelector('main#main');
    if (!main || !main.querySelector('.year')) return;

    each(main.querySelectorAll('[data-live]'), function (n) { n.parentNode.removeChild(n); });

    /* 两层的文章都要：归档页列的是全部。
       服务那份 posts 已经合并过「原生 + 运行时」，runtime 又是单独一份，
       所以按 slug 去重——不去重的话新写的文章会在这里排两行。
       撤下的整行拿掉，改过名的当场换字——静态页里那两样都是旧的。 */
    var posts = [];
    var briefs = {};
    var seen = {};
    all.forEach(function (s) {
      (s.posts || []).concat(s.runtime || []).forEach(function (p) {
        if (!p || seen[p.slug]) return;
        seen[p.slug] = true;
        posts.push(p);
        briefs[p.slug] = p;
      });
    });
    var gone = {};
    ((hidden && hidden.posts) || []).forEach(function (p) { gone[p.slug] = true; });
    each(main.querySelectorAll('.post-row'), function (li) {
      var a = li.querySelector('.post-row__link');
      var slug = a ? idOf(a.getAttribute('href')) : '';
      if (gone[slug]) { li.parentNode.removeChild(li); return; }
      var p = briefs[slug];
      if (!p) return;
      var title = li.querySelector('.post-row__title');
      if (title && title.textContent !== p.title) title.textContent = p.title;
      var date = li.querySelector('.post-row__date');
      if (date && p.date && date.textContent.trim() !== p.date) date.textContent = p.date;
    });

    var runtime = posts.slice().sort(function (x, y) { return x.date < y.date ? 1 : -1; });
    var known = {};
    each(main.querySelectorAll('.post-row'), function (li) {
      var a = li.querySelector('.post-row__link');
      if (a) known[idOf(a.getAttribute('href'))] = true;
    });

    runtime.forEach(function (art) {
      if (known[art.slug]) return;
      known[art.slug] = true;                        // 这份名单补进去就地记一笔，同一条不会再补第二次
      var year = String(art.date).slice(0, 4);
      var group = null;
      each(main.querySelectorAll('.year'), function (g) {
        var num = g.querySelector('.year__num');
        if (num && num.textContent.trim() === year) group = g;
      });
      if (!group) group = makeYear(main, year);

      var list = group.querySelector('.post-list');
      if (!list) return;
      var li = doc.createElement('li');
      li.className = 'post-row';
      li.setAttribute('data-live', '');
      li.innerHTML = '<a class="post-row__link" href="' + esc(art.url) + '">' +
        '<time class="post-row__date">' + esc(art.date) + '</time>' +
        '<span class="post-row__title">' + esc(art.title) + '</span>' +
        '<span class="post-row__blurb">' + esc(art.sectionName || '') + '</span>' +
        '</a>';
      insertByDate(list, li, art.date);
    });

    /* 空了的那一年（整年都被撤下）：这一组也拿走 */
    each(main.querySelectorAll('.year'), function (g) {
      if (!g.querySelectorAll('.post-row').length) { g.parentNode.removeChild(g); return; }
      var count = g.querySelector('.year__count');
      if (count) count.textContent = g.querySelectorAll('.post-row').length + ' 篇';
    });

    var head = main.querySelector('.sect-head__pitch');
    if (head) {
      head.textContent = head.textContent
        .replace(/^\s*\d+(\s*篇)/, (total || '') + '$1')
        .replace(/(·\s*)\d+(\s*轨)/, '$1' + all.length + '$2');
    }
  }

  function makeYear(main, year) {
    var group = doc.createElement('section');
    group.className = 'year';
    group.setAttribute('data-live', '');
    group.innerHTML = '<div class="year__head">' +
      '<span class="year__num">' + esc(year) + '</span>' +
      '<span class="year__count">0 篇</span>' +
      '</div><ol class="post-list"></ol>';
    var groups = Array.prototype.slice.call(main.querySelectorAll('.year'));
    var at = groups.length;
    for (var i = 0; i < groups.length; i++) {
      var num = groups[i].querySelector('.year__num');
      if (num && num.textContent.trim() < year) { at = i; break; }
    }
    main.insertBefore(group, groups[at] || null);
    return group;
  }

  /* 日期倒序地插进去（日期都是 YYYY.MM.DD，字符串比大小就对） */
  function insertByDate(container, node, date) {
    var rows = Array.prototype.slice.call(container.querySelectorAll('.post-row'));
    var at = rows.length;
    for (var i = 0; i < rows.length; i++) {
      var d = rows[i].querySelector('.post-row__date');
      var text = d ? d.textContent.trim() : '';
      if (text && text < date) { at = i; break; }
    }
    container.insertBefore(node, rows[at] || null);
  }

  /* 一串 YYYY.MM.DD → 「2025.01–03」（同年）或「2025.11–2026.02」（跨年）。
     时间轴读数上那段跨度就是它，与生成器（server/lib/shell.mjs）同一套写法 */
  function spanOf(dates) {
    if (!dates || !dates.length) return '';
    var a = String(dates[0]).slice(0, 7);
    var b = String(dates[dates.length - 1]).slice(0, 7);
    if (!a || !b) return '';
    return a.slice(0, 4) === b.slice(0, 4) ? a + '–' + b.slice(5) : a + '–' + b;
  }

  /* --- 首页那条大卷帘：轨道头 / 键帽 / 空轨道三列得一起插 --- */
  function syncRoll(all, hidden) {
    var roll = doc.querySelector('.roll--hero');
    if (!roll) return;
    var heads = roll.querySelector('.roll__heads');
    var caps = roll.querySelector('.roll__keys');
    var lanes = roll.querySelector('.roll__lanes');
    if (!heads || !caps || !lanes) return;

    var ids = {};
    all.forEach(function (s) { ids[s.id] = true; });

    /* 服务里没有的轨道：三列按同一个下标一起撤（从后往前，免得下标错位） */
    var doomed = [];
    each(heads.querySelectorAll('.head'), function (h, i) {
      if (!ids[idOf(h.getAttribute('href'))]) doomed.push(i);
    });
    for (var i = doomed.length - 1; i >= 0; i--) {
      [heads.children[doomed[i]], caps.children[doomed[i]], lanes.children[doomed[i]]]
        .forEach(function (n) { if (n && n.parentNode) n.parentNode.removeChild(n); });
    }

    var known = {};
    each(heads.querySelectorAll('.head'), function (h) { known[idOf(h.getAttribute('href'))] = true; });

    all.slice().sort(byPitchDesc).forEach(function (s) {
      if (known[s.id]) return;
      var at = heads.children.length;
      for (var j = 0; j < heads.children.length; j++) {
        if (pitchValue(heads.children[j].getAttribute('data-pitch')) < pitchValue(s.pitch)) { at = j; break; }
      }

      var head = doc.createElement('a');
      head.className = 'head';
      head.setAttribute('data-pitch', s.pitch);
      head.setAttribute('data-live', '');
      head.setAttribute('href', sectionHref(s));
      head.innerHTML = '<span class="head__name">' + esc(s.name) + '</span>' +
        '<span class="head__count">0 篇</span>';

      var cap = doc.createElement('span');
      cap.className = 'keycap' + (s.black ? ' keycap--black' : '');
      cap.setAttribute('data-live', '');

      var lane = doc.createElement('div');
      lane.className = 'lane' + (s.black ? ' lane--black' : '');
      lane.setAttribute('data-live', '');

      heads.insertBefore(head, heads.children[at] || null);
      caps.insertBefore(cap, caps.children[at] || null);
      lanes.insertBefore(lane, lanes.children[at] || null);
    });

    /* 读数：轨数 / 篇数 / 时间跨度跟着走（运行时文章的日子也算进去） */
    var readout = roll.querySelector('.roll__readout');
    var values = all.map(function (s) { return pitchValue(s.pitch); }).filter(function (v) { return v > 0; });
    if (readout && values.length) {
      var dates = [];
      var totalArticles = 0;
      all.forEach(function (s) {
        totalArticles += s.articles || 0;
        (s.posts || []).concat(s.runtime || []).forEach(function (p) {
          if (p && p.date) dates.push(p.date);
        });
      });
      dates.sort();
      readout.innerHTML = '<b>' + all.length + '</b> 轨 · <b>' + totalArticles + '</b> 篇 · <b>' +
        spanOf(dates) + '</b> · ' +
        pitchName(Math.min.apply(null, values)) + '–' + pitchName(Math.max.apply(null, values));
    }

    /* 运行时文章的音符：带上自己的日子。位置先按服务给的占个位，
       插完马上按接龙把整条时间轴重排（见 cv01.site.layoutTimeline） */
    var fresh = [];
    all.forEach(function (s, index) {
      var lane = lanes.children[index];
      if (!lane) return;
      (s.runtime || []).forEach(function (a) {
        var note = doc.createElement('a');
        note.className = 'note';
        note.setAttribute('data-live', '');
        note.setAttribute('data-x', String(a.x));
        if (a.date) note.setAttribute('data-date', a.date);
        note.setAttribute('data-pitch', a.pitch || s.pitch);
        note.setAttribute('data-title', a.title);
        note.setAttribute('data-min', String(a.min || 3));
        note.setAttribute('href', a.url);
        note.setAttribute('style', '--x:' + a.x + ';--w:' + a.w);
        note.setAttribute('aria-label', (a.date ? a.date + ' · ' : '') + a.title + '（' + s.name + '，' + (a.min || 3) + ' 分钟）');
        note.innerHTML = '<span class="note__short">' + esc(a.short || a.title.slice(0, 4)) + '</span>';
        lane.appendChild(note);
        fresh.push(note);
      });
    });
    /* 名字 / 篇数 / 音符上的字按服务那份刷一遍；站长撤下的音符整块拿掉。
       这一整段就是「右键改过名或撤下之后，刷新页面也是对的」的保障。 */
    var byId = {};
    all.forEach(function (s) { byId[s.id] = s; });
    each(heads.querySelectorAll('.head'), function (h) {
      var s = byId[idOf(h.getAttribute('href'))];
      if (!s) return;
      var name = h.querySelector('.head__name');
      if (name && name.textContent !== s.name) name.textContent = s.name;
      var count = h.querySelector('.head__count');
      if (count) count.textContent = (s.articles || 0) + ' 篇';
    });

    var gonePost = {};
    ((hidden && hidden.posts) || []).forEach(function (p) { gonePost[p.slug] = true; });
    var briefs = {};
    all.forEach(function (s) {
      (s.posts || []).forEach(function (p) { briefs[p.slug] = p; });
      (s.runtime || []).forEach(function (p) { briefs[p.slug] = p; });
    });
    var touched = fresh.length > 0;
    each(lanes.querySelectorAll('a.note'), function (n) {
      var slug = idOf(n.getAttribute('href'));
      if (gonePost[slug]) { n.parentNode.removeChild(n); touched = true; return; }
      var p = briefs[slug];
      if (!p) return;
      if (n.getAttribute('data-title') !== p.title) n.setAttribute('data-title', p.title);
      if (p.date && n.getAttribute('data-date') !== p.date) {
        n.setAttribute('data-date', p.date);
        touched = true;
      }
      var label = (p.date ? p.date + ' · ' : '') + p.title + '（' + (p.sectionName || '') + '，' + (p.min || 3) + ' 分钟）';
      if (n.getAttribute('aria-label') !== label) n.setAttribute('aria-label', label);
    });

    if (fresh.length) {
      /* 运行时文章是扫光之后才进来的：直接点亮 */
      fresh.forEach(function (n) { n.classList.add('is-lit'); });
    }
    if (touched && cv01.site && cv01.site.layoutTimeline) {
      /* 增、删、改期都会改接龙的次序：只要动过，就按同一把尺把整条轴
         （音符、月份刻度）重排一遍 */
      cv01.site.layoutTimeline(roll);
    }
    if (fresh.length && cv01.site && cv01.site.bindNotes) cv01.site.bindNotes(fresh);
  }

  /* --- 板块页的子板块列表 --- */
  function syncSubnav(all) {
    var main = doc.querySelector('main#main');
    if (!main) return;
    var m = /\/sections\/([^/]+?)(?:\/([^/]+?))?\.html$/.exec(location.pathname);
    if (!m || m[2]) return;                                  // 子板块页自己没有下一层
    var here = decodeURIComponent(m[1]);
    var section = null;
    all.forEach(function (s) { if (s.id === here) section = s; });
    if (!section) return;

    var subs = section.subs || [];
    var ids = {};
    subs.forEach(function (x) { ids[x.id] = true; });

    var nav = main.querySelector('.subnav');
    if (nav) {
      each(nav.querySelectorAll('a.subnav__item'), function (a) {
        var id = idOf(a.getAttribute('href'));
        if (!ids[id] && a.parentNode) { a.parentNode.removeChild(a); return; }
        /* 静态页里的那条链接是按生成时的深度写死的；换页之后（局部刷新）
           或者生成器写错了前缀，它就会解析到别处去。这里按当前页重写一遍。 */
        if (ids[id]) {
          a.setAttribute('href', cv01.base + 'sections/' + encodeURIComponent(section.id) + '/' + encodeURIComponent(id) + '.html');
        }
      });
    }
    if (!subs.length) {
      if (nav && nav.parentNode) nav.parentNode.removeChild(nav);
      return;
    }
    if (!nav) {
      nav = doc.createElement('nav');
      nav.className = 'subnav';
      nav.setAttribute('aria-label', section.name + '的子板块');
      var list = main.querySelector('.post-list');
      var lede = main.querySelector('.lede');
      if (list) list.parentNode.insertBefore(nav, list);
      else if (lede) lede.parentNode.insertBefore(nav, lede.nextSibling);
      else main.appendChild(nav);
    }
    var known = {};
    each(nav.querySelectorAll('a.subnav__item'), function (a) { known[idOf(a.getAttribute('href'))] = true; });
    subs.forEach(function (x) {
      if (known[x.id]) return;
      var a = doc.createElement('a');
      a.className = 'subnav__item';
      a.setAttribute('data-live', '');
      a.setAttribute('href', cv01.base + 'sections/' + encodeURIComponent(section.id) + '/' + encodeURIComponent(x.id) + '.html');
      a.innerHTML = '<span class="subnav__name">' + esc(x.name) + '</span>';
      nav.appendChild(a);
    });
  }

  /* --- 页面上直接改过的字：正文与板块页那两行 ---
     静态页里烤着的是生成时的那一份；站长右键改过之后，这里按服务那份换回来。
     没跑服务时这一整段不执行——静态页一个字节都没变。 */
  function syncEditedText(all) {
    /* 正在被直接编辑的那一段（页面上改字 / 全局编辑模式）不能动：
       这里的对齐跑在输入的半路上，会把人正在打的那几个字盖掉 */
    var beingEdited = function (el) { return Boolean(el && el.getAttribute('contenteditable') === 'true'); };
    var post = /\/posts\/([^/]+?)\.html$/.exec(location.pathname);
    if (post) {
      var slug = decodeURIComponent(post[1]);
      var hit = null;
      all.forEach(function (s) {
        (s.posts || []).forEach(function (p) { if (p.slug === slug) hit = p; });
        (s.runtime || []).forEach(function (p) { if (p.slug === slug) hit = p; });
      });
      var prose = doc.querySelector('main .prose');
      if (hit && hit.body && prose && prose.innerHTML !== hit.body && !beingEdited(prose)) {
        prose.innerHTML = hit.body;
        needMathCss(hit.body);
      }
      /* 改过名的：文章页的大标题与标签页也照服务那份换——静态页里烤着的是旧标题 */
      if (hit && hit.title) {
        var h1 = doc.querySelector('main .article__title');
        if (h1 && h1.textContent !== hit.title && !beingEdited(h1)) h1.textContent = hit.title;
        retitle(hit.title);
      }
      return;
    }
    var sec = /\/sections\/([^/]+?)(?:\/([^/]+?))?\.html$/.exec(location.pathname);
    if (!sec || sec[2]) return;                       /* 子板块页显示的是子板块自己的话 */
    var id = decodeURIComponent(sec[1]);
    var section = null;
    all.forEach(function (s) { if (s.id === id) section = s; });
    if (!section) return;
    /* 改过名的板块：页头那个名字（和标签页）也换——轨道栏与索引有人管，就这一处没人管 */
    var name = doc.querySelector('.sect-head__name');
    if (name && section.name && name.textContent !== section.name && !beingEdited(name)) name.textContent = section.name;
    retitle(section.name);
    var def = doc.querySelector('.sect-head__def');
    if (def && typeof section.def === 'string' && !beingEdited(def)) putLine(def, section.def);
    var lede = doc.querySelector('.lede');
    if (lede && typeof section.lede === 'string' && !beingEdited(lede)) putLine(lede, section.lede);
  }

  /* 标签页上的标题跟着换：页面 <title> 的第一段就是这篇 / 这个板块的名字，
     把它换掉即可——后面的「· 初音ミク CV01」是站点自己的，不动。 */
  function retitle(name) {
    var at = String(doc.title || '').indexOf(' · ');
    if (!name || at < 0) return;
    var next = name + doc.title.slice(at);
    if (doc.title !== next) doc.title = next;
  }

  /* 板块那两行是纯文本，只允许 <br> 当换行；服务写的时候就洗过了，这里再挡一道。
     比较的是「拍平之后的样子」，所以 <br> 与空格的差别不会让它每次都重画一遍。 */
  function plainOf(html) {
    return String(html == null ? '' : html)
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/[<>]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function putLine(el, value) {
    /* 编辑模式的「＋ 新建」占位还挂在框里时，这一段归编辑模式管：
       服务这边空空如也，一写就会把占位擦掉。等站长真写了字（占位收走），
       之后的同步照常认它。 */
    if (el.querySelector && el.querySelector('.gm-chip')) return false;
    var text = String(value == null ? '' : value);
    if (plainOf(el.innerHTML) === plainOf(text)) return false;
    if (/^(?:[^<>]|<br\s*\/?>)*$/i.test(text)) el.innerHTML = text;
    else el.textContent = text.replace(/[<>]/g, '');
    return true;
  }

  /* 贴上去的正文里要是有公式（页面上直接改字存下来的那种），这一页可能没带
     KaTeX 的样式表——静态页是按**生成时**的正文决定带不带的。缺了就补一张：
     它只是本地的一张 CSS，字体是懒加载的。 */
  function needMathCss(html) {
    if (!/class="katex/.test(String(html || ''))) return;
    if (doc.querySelector('link[href$="katex.min.css"]')) return;
    var link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = cv01.base + 'assets/vendor/katex/katex.min.css';
    doc.head.appendChild(link);
  }

  var syncing = false;
  var again = false;

  function syncTree() {
    if (!cv01.fetchJSON || !cv01.isOnline || !cv01.isOnline()) return;
    if (syncing) { again = true; return; }
    syncing = true;
    cv01.fetchJSON(cv01.api + 'sections')
      .then(function (data) {
        var all = data.sections || [];
        var total = (data.articles && data.articles.total) || 0;
        var hidden = data.hidden || { sections: [], posts: [] };
        syncRail(all);
        syncEntries(all, total);
        syncRoll(all, hidden);
        syncSubnav(all);
        syncSectionPosts(all, hidden);
        syncArchive(all, total, hidden);
        syncEditedText(all);
        /* 刚补进去的链接也要变成绝对地址，否则换页（局部刷新）之后会解析错 */
        if (cv01.absolutizeShell) cv01.absolutizeShell();
      })
      .catch(function () { /* 服务抽风就当没这回事，静态页照旧 */ })
      .then(function () {
        syncing = false;
        if (again) { again = false; syncTree(); }
      });
  }

  doc.addEventListener('cv01:online', syncTree);
  doc.addEventListener('cv01:sections-changed', syncTree);
  doc.addEventListener('cv01:navigated', syncTree);
})();

/* ==========================================================================
   sections.js · 新建板块 / 子板块
   ---------------------------------------------------------------------------
   新板块不是「新建一个空文件夹」——它要接进卷帘那套语法里：
   占一个还没被用过的音高（默认帮你挑一个空的），有自己的定义和导语，
   生成出来之后轨道栏、说说、子板块都会认它。

   子板块挂在板块下面，一个板块可以有任意多个。
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
          /* 轨道栏是静态生成的，新板块要刷新一次才会出现在左边 */
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
    if (!window.confirm('删掉这个子板块？里面的说说和它们带的文件也会一起删掉。')) return;
    cv01.withKey(function () { return cv01.fetchJSON(cv01.api + 'sections/' + parentId + '/subs/' + subId, { method: 'DELETE' }); })
      .then(function () {
        cv01.toast('删掉了');
        return reload();
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
})();

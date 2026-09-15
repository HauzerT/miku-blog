/* ==========================================================================
   editor.js · 编辑页
   ---------------------------------------------------------------------------
   左边写、右边看。正文用 Markdown 子集（服务端渲染，和文章页同一套 renderBody），
   图片 / 视频 / 音乐点按钮、拖进正文框、或者 Ctrl+V 粘截图都能传。

   传上来的文件先落在 media/ 里，同时把对应的插入语法塞到光标处；
   保存时把这篇文章带的文件清单一起交给服务（删文章时好一起清掉）。

   文章存在 data/articles.json，由服务运行时渲染成 posts/<slug>.html，
   并实时并进板块页 / 归档 / 首页索引与卷帘。

   这一页是手写的（不跟生成器走），所以球的挂载点那份 HTML 与 shell.mjs
   的 studio() 是一份拷贝——改那边记得改 editor.html。
   ========================================================================== */
(function () {
  'use strict';

  var doc = document;
  var cv01 = (window.cv01 = window.cv01 || {});
  var KIND_LABEL = { image: '图片', video: '视频', audio: '音乐' };

  var state = {
    sections: [],
    editing: '',
    assets: [],
    dirty: false,
    started: false,
  };

  function q(sel) { return doc.querySelector(sel); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function today() {
    var n = new Date();
    return n.getFullYear() + '.' + String(n.getMonth() + 1).padStart(2, '0') + '.' + String(n.getDate()).padStart(2, '0');
  }

  function setState(text, bad, url) {
    var box = q('[data-state]');
    box.classList.toggle('is-bad', Boolean(bad));
    box.textContent = text;
    if (url) {
      box.appendChild(doc.createTextNode(' '));
      var a = doc.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = '去看这一篇';
      box.appendChild(a);
    }
  }

  function keyState() {
    setState(cv01.key && cv01.key()
      ? '口令已经记住了，保存时不会再问。'
      : '还没有口令：第一次保存时会问你一次，那串口令印在启动服务的终端里。');
  }

  /* ------------------------------------------------------------ 板块下拉 */
  function loadSections() {
    return cv01.fetchJSON(cv01.api + 'sections').then(function (data) {
      state.sections = data.sections || [];
      fillSections();
    });
  }

  function lastSection() {
    try { return window.localStorage.getItem('cv01-editor-section') || ''; } catch (e) { return ''; }
  }

  function fillSections(keep) {
    var select = q('[data-section]');
    var previous = keep || select.value || lastSection();
    select.innerHTML = state.sections.map(function (s) {
      return '<option value="' + esc(s.id) + '">' + esc(s.pitch) + ' · ' + esc(s.name) + '</option>';
    }).join('');
    if (previous && state.sections.some(function (s) { return s.id === previous; })) select.value = previous;
    fillSubs();
  }

  function fillSubs(keep) {
    var sectionId = q('[data-section]').value;
    var select = q('[data-sub]');
    var section = state.sections.filter(function (s) { return s.id === sectionId; })[0];
    var subs = (section && section.subs) || [];
    var previous = keep || select.value;
    select.innerHTML = '<option value="">（直接发在板块里）</option>' + subs.map(function (x) {
      return '<option value="' + esc(x.id) + '">' + esc(x.name) + '</option>';
    }).join('');
    if (previous && subs.some(function (x) { return x.id === previous; })) select.value = previous;
  }

  /* ------------------------------------------------------------ 正文插入 */
  function insertAtCursor(text) {
    var area = q('[data-source]');
    var start = typeof area.selectionStart === 'number' ? area.selectionStart : area.value.length;
    var end = typeof area.selectionEnd === 'number' ? area.selectionEnd : start;
    area.value = area.value.slice(0, start) + text + area.value.slice(end);
    var at = start + text.length;
    try { area.setSelectionRange(at, at); } catch (e) { /* 有些浏览器对 textarea 之外的类型会拒绝 */ }
    area.focus();
    markDirty();
  }

  function insertSyntax(asset) {
    if (asset.kind === 'image') return '![' + (asset.original || '图片') + '](' + asset.url + ')';
    if (asset.kind === 'video') {
      return '<video src="' + asset.url + '" controls preload="metadata" playsinline></video>';
    }
    return '<audio src="' + asset.url + '" controls preload="metadata"></audio>';
  }

  function collectAssets(files) {
    (files || []).forEach(function (f) {
      state.assets.push({
        kind: f.kind, bucket: f.bucket, file: f.file, url: f.url,
        original: f.original, size: f.size, type: f.type,
      });
    });
    paintAssets();
  }

  function paintAssets() {
    var box = q('[data-att]');
    box.hidden = state.assets.length === 0;
    box.innerHTML = state.assets.map(function (a) {
      return '<li class="ed__att-item"><span class="ed__att-kind">' +
        esc(KIND_LABEL[a.kind] || a.kind) + '</span><span class="ed__att-name">' +
        esc(a.original || a.file) + '</span></li>';
    }).join('');
  }

  /* ------------------------------------------------------------ 上传 */
  function uploadFiles(kind, files) {
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) return;

    var form = new FormData();
    list.forEach(function (f) { form.append('file', f, f.name); });
    if (kind) form.append('kind', kind);

    var btn = q('[data-save]');
    btn.disabled = true;
    setState('正在传 ' + list.length + ' 个文件…');

    cv01.withKey(function () {
      return cv01.upload(cv01.api + 'media', form, function (ratio) {
        setState('正在传 ' + list.length + ' 个文件… ' + Math.round(ratio * 100) + '%');
      });
    })
      .then(function (data) {
        var got = data.files || [];
        got.forEach(function (f) { insertAtCursor('\n' + insertSyntax(f) + '\n'); });
        collectAssets(got);
        markDirty();
        refreshPreview();
        setState('传好了 ' + got.length + ' 个文件，已经插到光标处。');
      })
      .catch(function (err) { setState(cv01.error(err), true); })
      .then(function () { btn.disabled = false; });
  }

  /* ------------------------------------------------------------ 预览 */
  var previewTimer = 0;

  function refreshPreview() {
    window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(renderPreview, 320);
  }

  function renderPreview() {
    var box = q('[data-previewbox]');
    var source = q('[data-source]').value;
    if (!source.trim()) {
      box.innerHTML = '<p class="ed__empty">写点什么，这边就跟着显示。</p>';
      return;
    }
    cv01.fetchJSON(cv01.api + 'render', { method: 'POST', json: { source: source } })
      .then(function (data) { box.innerHTML = data.html || ''; })
      .catch(function () { box.innerHTML = '<p class="ed__empty">服务没在跑，预览不了。</p>'; });
  }

  /* ------------------------------------------------------------ 保存 */
  function save() {
    var payload = {
      title: q('[data-title]').value.trim(),
      section: q('[data-section]').value,
      sub: q('[data-sub]').value || '',
      date: q('[data-date]').value.trim() || today(),
      min: Number(q('[data-min]').value) || 4,
      short: q('[data-short]').value.trim(),
      blurb: q('[data-blurb]').value.trim(),
      source: q('[data-source]').value,
      assets: state.assets,
    };
    if (!payload.title) return setState('标题别忘了。', true);
    if (!payload.section) return setState('先选一个板块。', true);

    var isNew = !state.editing;
    var btn = q('[data-save]');
    btn.disabled = true;
    setState(isNew ? '正在保存…' : '正在改…');

    cv01.withKey(function () {
      return cv01.fetchJSON(cv01.api + 'articles' + (isNew ? '' : '/' + state.editing), {
        method: isNew ? 'POST' : 'PATCH',
        json: payload,
      });
    })
      .then(function (data) {
        var a = data.article;
        state.editing = a.id;
        state.assets = a.assets || [];
        state.dirty = false;
        q('[data-new]').hidden = false;
        q('[data-heading]').textContent = '在写：' + a.title;
        q('[data-date]').value = a.date;
        paintAssets();
        loadList();
        setState('保存好了 · ' + a.slug + '.html', false, a.url);
        cv01.toast(isNew ? '发出去了' : '改好了');
      })
      .catch(function (err) { setState(cv01.error(err), true); })
      .then(function () { btn.disabled = false; });
  }

  /* ------------------------------------------------------------ 我写的 */
  function loadList() {
    return cv01.fetchJSON(cv01.api + 'articles').then(function (data) {
      var list = q('[data-list]');
      var items = data.articles || [];
      if (!items.length) {
        list.innerHTML = '<li class="ed__empty">还没有。写完第一篇就会出现在这儿。</li>';
        return;
      }
      list.innerHTML = items.map(function (a) {
        return '<li class="ed__list-item' + (a.id === state.editing ? ' is-editing' : '') + '" data-id="' + esc(a.id) + '">' +
          '<div>' +
          '<a class="ed__list-title" href="' + esc(a.url) + '" target="_blank" rel="noopener">' + esc(a.title) + '</a>' +
          '<span class="ed__list-meta">' + esc(a.date) + ' · ' + esc(a.section) +
          (a.assets ? ' · ' + a.assets + ' 个附件' : '') + '</span>' +
          '</div>' +
          '<span class="ed__list-acts">' +
          '<button type="button" data-edit="' + esc(a.id) + '">编辑</button>' +
          '<button type="button" data-del="' + esc(a.id) + '">删</button>' +
          '</span></li>';
      }).join('');
    });
  }

  function openArticle(id) {
    return cv01.fetchJSON(cv01.api + 'articles/' + id).then(function (data) {
      var a = data.article;
      state.editing = a.id;
      state.assets = (a.assets || []).slice();
      q('[data-title]').value = a.title;
      q('[data-date]').value = a.date;
      q('[data-min]').value = a.min;
      q('[data-short]').value = a.short || '';
      q('[data-blurb]').value = a.blurb || '';
      q('[data-source]').value = a.source || '';
      q('[data-heading]').textContent = '在写：' + a.title;
      q('[data-new]').hidden = false;
      fillSections(a.section);
      fillSubs(a.sub);
      paintAssets();
      state.dirty = false;
      renderPreview();
      loadList();
      setState('正在改这一篇。改完再点一次「保存并发布」。');
      window.scrollTo(0, 0);
    }).catch(function (err) { setState(cv01.error(err), true); });
  }

  function removeArticle(id) {
    if (!window.confirm('删掉这篇？它带的图片 / 视频 / 音乐也会一起从磁盘上删掉。')) return;
    cv01.withKey(function () { return cv01.fetchJSON(cv01.api + 'articles/' + id, { method: 'DELETE' }); })
      .then(function () {
        if (state.editing === id) resetForm();
        cv01.toast('删掉了');
        loadList();
      })
      .catch(cv01.error);
  }

  function resetForm() {
    state.editing = '';
    state.assets = [];
    state.dirty = false;
    q('[data-title]').value = '';
    q('[data-date]').value = today();
    q('[data-min]').value = 4;
    q('[data-short]').value = '';
    q('[data-blurb]').value = '';
    q('[data-source]').value = '';
    q('[data-heading]').textContent = '写一篇博客';
    q('[data-new]').hidden = true;
    paintAssets();
    renderPreview();
    keyState();
  }

  function markDirty() {
    state.dirty = true;
    if (!state.editing) setState('还没保存。');
  }

  /* ------------------------------------------------------------ 绑定 */
  function bind() {
    var area = q('[data-source]');

    q('[data-section]').addEventListener('change', function () {
      fillSubs();
      markDirty();
      /* 下次进来还停在这一栏 */
      try { window.localStorage.setItem('cv01-editor-section', q('[data-section]').value); } catch (e) { /* 隐私模式 */ }
    });
    q('[data-save]').addEventListener('click', save);
    q('[data-preview]').addEventListener('click', renderPreview);
    q('[data-new]').addEventListener('click', resetForm);

    ['title', 'date', 'min', 'short', 'blurb', 'source'].forEach(function (name) {
      var el = q('[data-' + name + ']');
      el.addEventListener('input', function () { markDirty(); if (name === 'source') refreshPreview(); });
    });

    /* 点按钮选文件 */
    Array.prototype.forEach.call(doc.querySelectorAll('[data-add]'), function (btn) {
      btn.addEventListener('click', function () {
        q('[data-file="' + btn.getAttribute('data-add') + '"]').click();
      });
    });
    Array.prototype.forEach.call(doc.querySelectorAll('[data-file]'), function (input) {
      input.addEventListener('change', function () {
        if (input.files.length) uploadFiles(input.getAttribute('data-file'), input.files);
        input.value = '';
      });
    });

    /* 拖进正文框 */
    ['dragenter', 'dragover'].forEach(function (type) {
      area.addEventListener(type, function (e) { e.preventDefault(); area.classList.add('is-over'); });
    });
    ['dragleave', 'drop'].forEach(function (type) {
      area.addEventListener(type, function (e) { e.preventDefault(); area.classList.remove('is-over'); });
    });
    area.addEventListener('drop', function (e) {
      var files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) uploadFiles('', files);
    });

    /* Ctrl+V 粘截图 */
    area.addEventListener('paste', function (e) {
      var items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      var files = [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].kind === 'file') {
          var f = items[i].getAsFile();
          if (f && /^image\//.test(f.type)) files.push(f);
        }
      }
      if (files.length) {
        e.preventDefault();
        uploadFiles('image', files);
      }
    });

    /* 列表里的编辑 / 删除 */
    q('[data-list]').addEventListener('click', function (e) {
      var edit = e.target.closest('[data-edit]');
      if (edit) return openArticle(edit.getAttribute('data-edit'));
      var del = e.target.closest('[data-del]');
      if (del) return removeArticle(del.getAttribute('data-del'));
    });

    /* 走之前提醒一句没保存 */
    window.addEventListener('beforeunload', function (e) {
      if (!state.dirty) return;
      e.preventDefault();
      e.returnValue = '';
    });
  }

  /* ------------------------------------------------------------ 启动 */
  function start() {
    if (state.started) return;
    state.started = true;
    q('[data-date]').value = today();
    bind();
    keyState();
    renderPreview();
    loadSections().catch(function () { setState('连不上服务：先双击 start.cmd 把它跑起来。', true); });
    loadList().catch(function () { /* 上面已经说过一次了 */ });

    var id = '';
    try { id = new URLSearchParams(location.search).get('id') || ''; } catch (e) { id = ''; }
    if (id) openArticle(id);
  }

  doc.addEventListener('cv01:online', start);
  if (cv01.isOnline && cv01.isOnline()) start();
})();

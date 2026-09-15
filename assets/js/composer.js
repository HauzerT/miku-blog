/* ==========================================================================
   composer.js · 发说说
   ---------------------------------------------------------------------------
   选板块 → 选子板块（有的话）→ 写字 → 加图片 / 视频 / 表情包 → 发出去。
   图片在浏览器里先缩到长边 1920 再传（拍屏和相机原图太占地方，展示也用不上）；
   视频原样上传。表情包分两种：竖着一点就插进文字的 unicode 表情，
   和上传成贴纸图片的「收藏表情」。

   发出去之后通知 feed.js 往列表里塞一条，不刷新页面。
   ========================================================================== */
(function () {
  'use strict';

  var doc = document;
  var cv01 = (window.cv01 = window.cv01 || {});

  var MOODS = ['', '开心', '平静', '累了', '在想事情', '值得记下来', '有点烦'];
  var EMOJI = [
    '😀', '😄', '😁', '😆', '😅', '😂', '🙂', '😉', '😊', '😍', '😘', '😜',
    '🤪', '🤔', '🤨', '😐', '😑', '😴', '😪', '😢', '😭', '😤', '😠', '😱',
    '🥺', '😳', '🤯', '🥳', '😎', '🤓', '🧐', '😇', '🙃', '😋', '🤤', '🤗',
    '👍', '👎', '👏', '🙏', '🤝', '✌️', '🤟', '👌', '💪', '🫡', '🙌', '👋',
    '❤️', '💔', '💕', '💗', '✨', '🔥', '🎉', '🎵', '🎧', '🎹', '📷', '🎬',
    '🌸', '🍀', '🌙', '⭐', '☕', '🍜', '🍟', '🍰', '🐱', '🐶', '🐟', '🫧',
    '😂', '🥲', '😶‍🌫️', '🫠', '💤', '❄️', '🌧️', '☀️', '🍂', '🎮', '📖', '💻',
  ];

  var host = null;
  var sections = [];
  var picked = { images: [], videos: [], stickers: [] };
  var busy = false;

  /* ------------------------------------------------------------ 结构 */
  function shellHtml() {
    return '' +
      '<form class="cp" novalidate>' +
      '  <div class="cp__head">' +
      '    <p class="cp__eyebrow">发说说</p>' +
      '    <p class="cp__hint">选一个板块，写点东西。图片、视频、表情包都可以一起带。</p>' +
      '  </div>' +
      '  <div class="cp__row cp__row--pick">' +
      '    <label class="cp__field">' +
      '      <span class="cp__label">板块</span>' +
      '      <select class="cp__select" data-section required></select>' +
      '    </label>' +
      '    <label class="cp__field" data-sub-field hidden>' +
      '      <span class="cp__label">子板块</span>' +
      '      <select class="cp__select" data-sub></select>' +
      '    </label>' +
      '    <label class="cp__field">' +
      '      <span class="cp__label">心情</span>' +
      '      <select class="cp__select" data-mood>' +
      MOODS.map(function (m) { return '<option value="' + m + '">' + (m || '不标') + '</option>'; }).join('') +
      '      </select>' +
      '    </label>' +
      '  </div>' +
      '  <textarea class="cp__text" data-text rows="5" placeholder="此刻在想什么……（Ctrl + V 可以直接粘截图）"></textarea>' +
      '  <div class="cp__att" data-att hidden></div>' +
      '  <div class="cp__tools">' +
      '    <button class="cp__tool" type="button" data-add="image">图片</button>' +
      '    <button class="cp__tool" type="button" data-add="video">视频</button>' +
      '    <button class="cp__tool" type="button" data-add="sticker">表情包</button>' +
      '    <button class="cp__tool cp__tool--emoji" type="button" data-emoji-toggle aria-expanded="false">表情</button>' +
      '    <span class="cp__count" data-count>0 字</span>' +
      '  </div>' +
      '  <div class="cp__emoji" data-emoji hidden>' +
      EMOJI.map(function (e) { return '<button class="cp__emoji-btn" type="button" data-e="' + e + '">' + e + '</button>'; }).join('') +
      '  </div>' +
      '  <div class="cp__foot">' +
      '    <span class="cp__up" data-up hidden><i data-bar></i><b data-uptext>上传中</b></span>' +
      '    <button class="cp__send" type="submit" data-send>发出去</button>' +
      '  </div>' +
      '  <input type="file" accept="image/*" multiple hidden data-file="image">' +
      '  <input type="file" accept="video/*" hidden data-file="video">' +
      '  <input type="file" accept="image/*" multiple hidden data-file="sticker">' +
      '</form>';
  }

  /* ------------------------------------------------------------ 数据 */
  function loadSections() {
    return cv01.fetchJSON(cv01.api + 'sections').then(function (data) {
      sections = data.sections || [];
      return sections;
    });
  }

  function fillSections() {
    var select = host.querySelector('[data-section]');
    var previous = select.value;
    select.innerHTML = sections
      .map(function (s) {
        return '<option value="' + s.id + '">' + s.pitch + ' · ' + esc(s.name) + '</option>';
      })
      .join('');
    if (previous && sections.some(function (s) { return s.id === previous; })) select.value = previous;
    fillSubs();
    var current = urlSection();
    if (current && sections.some(function (s) { return s.id === current; })) {
      select.value = current;
      fillSubs();
    }
  }

  function fillSubs() {
    var sectionId = host.querySelector('[data-section]').value;
    var field = host.querySelector('[data-sub-field]');
    var select = host.querySelector('[data-sub]');
    var section = sections.filter(function (s) { return s.id === sectionId; })[0];
    var subs = (section && section.subs) || [];
    if (!subs.length) {
      field.hidden = true;
      select.innerHTML = '';
      return;
    }
    field.hidden = false;
    select.innerHTML = '<option value="">（直接发在板块里）</option>' +
      subs.map(function (x) { return '<option value="' + x.id + '">' + esc(x.name) + '</option>'; }).join('');
    var wanted = urlSub();
    if (wanted && subs.some(function (x) { return x.id === wanted; })) select.value = wanted;
  }

  /* 页面在某个板块 / 子板块里时，默认就发在这里 */
  function urlSection() {
    var feed = doc.querySelector('[data-feed]');
    return feed ? feed.getAttribute('data-section') || '' : '';
  }
  function urlSub() {
    var feed = doc.querySelector('[data-feed]');
    return feed ? feed.getAttribute('data-sub') || '' : '';
  }

  /* ------------------------------------------------------------ 附件 */
  function attMarkup() {
    var rows = [];
    function group(kind, items, cls) {
      if (!items.length) return;
      rows.push('<div class="cp__group cp__group--' + kind + '">' + items.map(function (item, i) {
        var thumb = kind === 'video'
          ? '<video src="' + item.preview + '" muted playsinline></video>'
          : '<img src="' + item.preview + '" alt="">';
        return '<figure class="cp__chip ' + cls + '">' + thumb +
          '<figcaption>' + esc(item.label) + '</figcaption>' +
          '<button class="cp__chip-x" type="button" data-drop="' + kind + '" data-i="' + i + '" aria-label="移除">×</button>' +
          '</figure>';
      }).join('') + '</div>');
    }
    group('images', picked.images.map(function (f) { return { preview: f.preview, label: f.name }; }), '');
    group('videos', picked.videos.map(function (f) { return { preview: f.preview, label: f.name }; }), '');
    group('stickers', picked.stickers.map(function (f) { return { preview: f.preview, label: f.name }; }), 'cp__chip--sticker');
    return rows.join('');
  }

  function refreshAtt() {
    var box = host.querySelector('[data-att]');
    var total = picked.images.length + picked.videos.length + picked.stickers.length;
    box.hidden = total === 0;
    box.innerHTML = attMarkup();
  }

  function addFiles(kind, files) {
    var list = Array.prototype.slice.call(files);
    if (kind === 'video') list = list.slice(0, 1); // 一条说说一个视频，够用了
    list.forEach(function (file) {
      var ok = kind === 'video' ? /^video\//.test(file.type) || /\.(mp4|mov|webm|m4v)$/i.test(file.name)
        : /^image\//.test(file.type) || /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(file.name);
      if (!ok) return cv01.toast('这个文件不是' + (kind === 'video' ? '视频' : '图片') + '：' + file.name, true);
      var item = {
        file: file,
        name: file.name,
        size: file.size,
        preview: URL.createObjectURL(file),
        width: 0,
        height: 0,
      };
      if (kind === 'video') picked.videos = [item];
      else if (kind === 'sticker') picked.stickers.push(item);
      else picked.images.push(item);
    });
    refreshAtt();
  }

  /* 图片先缩到长边 1920，再按需压一次质量：手机直出 8MB 的照片能掉到 300KB 上下 */
  function shrink(file) {
    if (!/^image\//.test(file.type) || /gif|svg/i.test(file.type)) return Promise.resolve({ blob: file });
    return new Promise(function (resolve) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        var MAX = 1920;
        var scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
        if (scale >= 1 && file.size < 1.2 * 1024 * 1024) {
          URL.revokeObjectURL(url);
          return resolve({ blob: file, width: img.naturalWidth, height: img.naturalHeight });
        }
        var w = Math.max(1, Math.round(img.naturalWidth * scale));
        var h = Math.max(1, Math.round(img.naturalHeight * scale));
        var canvas = doc.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        var type = /png/i.test(file.type) ? 'image/png' : 'image/jpeg';
        canvas.toBlob(function (blob) {
          URL.revokeObjectURL(url);
          if (!blob) return resolve({ blob: file, width: img.naturalWidth, height: img.naturalHeight });
          resolve({ blob: blob, width: w, height: h });
        }, type, type === 'image/jpeg' ? 0.86 : undefined);
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve({ blob: file }); };
      img.src = url;
    });
  }

  /* ------------------------------------------------------------ 发送 */
  function send() {
    if (busy) return;
    var section = host.querySelector('[data-section]').value;
    var subField = host.querySelector('[data-sub-field]');
    var sub = subField.hidden ? '' : host.querySelector('[data-sub]').value;
    var text = host.querySelector('[data-text]').value.trim();
    var mood = host.querySelector('[data-mood]').value;
    var total = picked.images.length + picked.videos.length + picked.stickers.length;

    if (!text && !total) return cv01.toast('写点什么，或者加张图', true);
    if (!section) return cv01.toast('先选一个板块', true);
    var bigVideo = picked.videos.find(function (v) { return v.size > 240 * 1024 * 1024; });
    if (bigVideo) return cv01.toast('视频太大了（超过 240MB），先压一下再传', true);

    busy = true;
    var button = host.querySelector('[data-send]');
    button.disabled = true;
    var box = host.querySelector('[data-up]');
    var bar = host.querySelector('[data-bar]');
    var uptext = host.querySelector('[data-uptext]');
    box.hidden = false;
    bar.style.width = '4%';
    uptext.textContent = '整理图片…';

    var all = picked.images.map(function (i) { return { kind: 'image', item: i }; })
      .concat(picked.videos.map(function (i) { return { kind: 'video', item: i }; }))
      .concat(picked.stickers.map(function (i) { return { kind: 'sticker', item: i }; }));

    Promise.all(all.map(function (entry) {
      if (entry.kind === 'video') return Promise.resolve(entry);
      return shrink(entry.item.file).then(function (r) {
        entry.blob = r.blob;
        entry.width = r.width || 0;
        entry.height = r.height || 0;
        return entry;
      });
    }))
      .then(function (entries) {
        uptext.textContent = '上传中…';
        var form = new FormData();
        form.append('section', section);
        form.append('sub', sub);
        form.append('text', text);
        form.append('mood', mood);
        entries.forEach(function (entry, i) {
          var name = entry.item.name || (entry.kind + '-' + i + '.bin');
          var blob = entry.blob || entry.item.file;
          form.append('file', blob, name);
          if (entry.width) form.append('w:' + name, String(entry.width));
          if (entry.height) form.append('h:' + name, String(entry.height));
        });
        return cv01.withKey(function () {
          return cv01.upload(cv01.api + 'posts', form, function (ratio) {
            bar.style.width = Math.round(ratio * 100) + '%';
            uptext.textContent = '上传中 ' + Math.round(ratio * 100) + '%';
          });
        });
      })
      .then(function (data) {
        cv01.toast('发出去了');
        reset();
        doc.dispatchEvent(new CustomEvent('cv01:posted', { detail: data.post }));
      })
      .catch(cv01.error)
      .then(function () {
        busy = false;
        button.disabled = false;
        box.hidden = true;
        bar.style.width = '0';
      });
  }

  function reset() {
    host.querySelector('[data-text]').value = '';
    host.querySelector('[data-mood]').value = '';
    picked = { images: [], videos: [], stickers: [] };
    refreshAtt();
    countChars();
  }

  function countChars() {
    var text = host.querySelector('[data-text]').value;
    host.querySelector('[data-count]').textContent = text.length + ' 字';
  }

  /* ------------------------------------------------------------ 绑定 */
  function bind() {
    host.querySelector('[data-section]').addEventListener('change', fillSubs);
    host.querySelector('[data-text]').addEventListener('input', countChars);

    host.querySelector('[data-emoji-toggle]').addEventListener('click', function (e) {
      var box = host.querySelector('[data-emoji]');
      box.hidden = !box.hidden;
      e.currentTarget.setAttribute('aria-expanded', box.hidden ? 'false' : 'true');
    });

    host.querySelector('[data-emoji]').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-e]');
      if (!btn) return;
      insert(btn.getAttribute('data-e'));
    });

    host.querySelectorAll('[data-add]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        host.querySelector('[data-file="' + btn.getAttribute('data-add') + '"]').click();
      });
    });
    host.querySelectorAll('[data-file]').forEach(function (input) {
      input.addEventListener('change', function () {
        if (input.files.length) addFiles(input.getAttribute('data-file'), input.files);
        input.value = '';
      });
    });

    host.querySelector('[data-att]').addEventListener('click', function (e) {
      var x = e.target.closest('[data-drop]');
      if (!x) return;
      var kind = x.getAttribute('data-drop');
      var i = Number(x.getAttribute('data-i'));
      var bucket = kind === 'images' ? picked.images : kind === 'videos' ? picked.videos : picked.stickers;
      var [gone] = bucket.splice(i, 1);
      if (gone) URL.revokeObjectURL(gone.preview);
      refreshAtt();
    });

    host.querySelector('form').addEventListener('submit', function (e) { e.preventDefault(); send(); });

    /* 直接往面板里 Ctrl+V 粘截图 */
    host.addEventListener('paste', function (e) {
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
        addFiles('image', files);
        cv01.toast('粘进来 ' + files.length + ' 张图');
      }
    });

    /* 拖进来 */
    ['dragenter', 'dragover'].forEach(function (type) {
      host.addEventListener(type, function (e) { e.preventDefault(); host.classList.add('is-over'); });
    });
    ['dragleave', 'drop'].forEach(function (type) {
      host.addEventListener(type, function (e) { e.preventDefault(); host.classList.remove('is-over'); });
    });
    host.addEventListener('drop', function (e) {
      var files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length) return;
      var images = [];
      var videos = [];
      Array.prototype.slice.call(files).forEach(function (f) {
        if (/^video\//.test(f.type)) videos.push(f);
        else images.push(f);
      });
      if (images.length) addFiles('image', images);
      if (videos.length) addFiles('video', videos);
    });
  }

  function insert(text) {
    var area = host.querySelector('[data-text]');
    var start = area.selectionStart || 0;
    var end = area.selectionEnd || 0;
    area.value = area.value.slice(0, start) + text + area.value.slice(end);
    area.selectionStart = area.selectionEnd = start + text.length;
    area.focus();
    countChars();
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  cv01.composer = {
    open: function (target) {
      host = doc.createElement('div');
      host.className = 'cp-wrap';
      host.innerHTML = shellHtml();
      target.appendChild(host);
      bind();
      countChars();
      loadSections()
        .then(function () { fillSections(); })
        .catch(function (err) { cv01.error(err); });
    },
  };
})();

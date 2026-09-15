/* ==========================================================================
   feed.js · 说说流
   ---------------------------------------------------------------------------
   有 data-feed 的地方就拉一次 /api/posts：说说页、板块页、子板块页都用同一个列表。
   生成静态页时已经内联了一份（没跑服务也能看见），跑起来之后这里会用接口的数据覆盖它，
   所以新发的内容不用重新生成 HTML。

   删除按钮只对有口令的人显示。
   ========================================================================== */
(function () {
  'use strict';

  var doc = document;
  var cv01 = (window.cv01 = window.cv01 || {});
  var feed = doc.querySelector('[data-feed]');
  var all = [];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function bodyHtml(text) {
    return esc(text).split(/\n{2,}/).map(function (para) {
      return '<p>' + para.replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }

  function mediaHtml(post) {
    var assets = Array.isArray(post.assets) ? post.assets : [];
    if (!assets.length) return '';
    var images = assets.filter(function (a) { return a.kind === 'image' || a.kind === 'sticker'; });
    var videos = assets.filter(function (a) { return a.kind === 'video'; });
    var out = '';
    if (images.length) {
      out += '<div class="shots' + (images.length === 1 ? ' shots--one' : '') + '">' +
        images.map(function (a) {
          return '<a class="shot" href="' + a.url + '" target="_blank" rel="noopener">' +
            '<img src="' + a.url + '" alt="' + esc(a.alt || a.original || '') + '" loading="lazy"></a>';
        }).join('') + '</div>';
    }
    videos.forEach(function (v) {
      out += '<figure class="clip"><video src="' + v.url + '" controls preload="metadata" playsinline></video></figure>';
    });
    assets.filter(function (a) { return a.kind === 'audio'; }).forEach(function (a) {
      out += '<p class="clip clip--audio"><audio src="' + a.url + '" controls preload="metadata"></audio></p>';
    });
    return out;
  }

  function card(post) {
    var sub = post.subName ? '<span class="feed__sep">/</span><span class="feed__sub">' + esc(post.subName) + '</span>' : '';
    return '<article class="feed-item" data-post-id="' + esc(post.id) + '">' +
      '<header class="feed-item__head">' +
      '<span class="feed-item__pitch">' + esc(post.pitch || '·') + '</span>' +
      '<a class="feed__sect" href="' + cv01.base + 'sections/' + encodeURIComponent(post.section) + '.html">' + esc(post.sectionName || '') + '</a>' + sub +
      '<time class="feed-item__time">' + esc(post.date) + ' ' + esc(post.time || '') + '</time>' +
      (post.mood ? '<span class="feed__mood">' + esc(post.mood) + '</span>' : '') +
      '</header>' +
      '<div class="feed-item__body">' +
      (post.text ? '<div class="feed__text">' + bodyHtml(post.text) + '</div>' : '') +
      mediaHtml(post) +
      '</div>' +
      '<footer class="feed-item__foot">' +
      '<span class="feed-item__meta">' + esc(post.kindLabel || '说说') +
      (post.assets && post.assets.length ? ' · ' + post.assets.length + ' 个附件' : '') + '</span>' +
      '<button class="feed-item__del" type="button" data-del-post="' + esc(post.id) + '" hidden>删除</button>' +
      '</footer>' +
      '</article>';
  }

  function applyFilter(sectionId) {
    feed.setAttribute('data-section', sectionId || '');
    Array.prototype.slice.call(feed.querySelectorAll('.feed-item')).forEach(function (item) {
      var match = !sectionId || (all.filter(function (p) { return p.id === item.getAttribute('data-post-id'); })[0] || {}).section === sectionId;
      item.hidden = !match;
    });
    var empty = feed.querySelector('[data-feed-empty]');
    if (empty) {
      var visible = feed.querySelectorAll('.feed-item:not([hidden])').length;
      empty.hidden = visible > 0;
    }
  }

  function refreshDeleteVisibility() {
    var hasKey = Boolean(cv01.key());
    Array.prototype.slice.call(doc.querySelectorAll('[data-del-post]')).forEach(function (btn) {
      btn.hidden = !hasKey;
    });
  }

  function load() {
    if (!feed) return Promise.resolve();
    var section = feed.getAttribute('data-section') || '';
    var sub = feed.getAttribute('data-sub') || '';
    var query = [];
    if (section) query.push('section=' + encodeURIComponent(section));
    if (sub) query.push('sub=' + encodeURIComponent(sub));
    return cv01.fetchJSON(cv01.api + 'posts' + (query.length ? '?' + query.join('&') : ''))
      .then(function (data) {
        all = data.posts || [];
        render();
      });
  }

  function render() {
    if (!all.length) {
      feed.innerHTML = '<p class="empty" data-feed-empty>这里还没有说说。点右下角的悬浮球，写下第一条。</p>';
      return;
    }
    feed.innerHTML = all.map(card).join('');
    refreshDeleteVisibility();
  }

  doc.addEventListener('cv01:posted', function (e) {
    var post = e.detail;
    if (!post) return;
    /* 这一页没有留言区（首页、归档、关于）：说说已经发出去了，
       只是没地方插，提示一句就算了。 */
    if (!feed) {
      cv01.toast('已发到「' + (post.sectionName || '') + '」，去那个板块或说说页就能看见');
      return;
    }
    var sectionFilter = feed.getAttribute('data-section') || '';
    var subFilter = feed.getAttribute('data-sub') || '';
    if (sectionFilter && post.section !== sectionFilter) {
      /* 发到别的板块去了：提示一句，不动当前列表 */
      cv01.toast('已发到「' + (post.sectionName || '') + '」，换到那个板块就能看见');
      return;
    }
    if (subFilter && post.sub !== subFilter) {
      cv01.toast('已发到子板块「' + (post.subName || '') + '」');
      return;
    }
    all.unshift(post);
    var empty = feed.querySelector('[data-feed-empty]');
    if (empty) feed.innerHTML = '';
    feed.insertAdjacentHTML('afterbegin', card(post));
    refreshDeleteVisibility();
  });

  doc.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-del-post]');
    if (!btn || !feed) return;
    var id = btn.getAttribute('data-del-post');
    if (!window.confirm('删掉这条说说？它带的图片和视频也会一起从磁盘上删掉。')) return;
    cv01.withKey(function () { return cv01.fetchJSON(cv01.api + 'posts/' + id, { method: 'DELETE' }); })
      .then(function () {
        all = all.filter(function (p) { return p.id !== id; });
        var item = feed.querySelector('[data-post-id="' + id + '"]');
        if (item) item.remove();
        if (!all.length) render();
        cv01.toast('删掉了');
      })
      .catch(cv01.error);
  });

  cv01.feed = { reload: load };

  /* 首页、归档、关于没有留言区：拉数据、筛选按钮、删除按钮在这里全体收工。
     上面那些监听器留着——在首页发说说之后，至少要能提示一句「发到哪去了」。 */
  if (!feed) return;

  /* 说说页顶部的板块筛选 */
  Array.prototype.slice.call(doc.querySelectorAll('[data-feed-filter]')).forEach(function (chip) {
    chip.addEventListener('click', function () {
      Array.prototype.slice.call(doc.querySelectorAll('[data-feed-filter]')).forEach(function (c) { c.classList.remove('is-on'); });
      chip.classList.add('is-on');
      applyFilter(chip.getAttribute('data-feed-filter'));
    });
  });

  doc.addEventListener('cv01:online', function () { load().catch(function () {}); });
  /* 工作台探到服务之后再拉数据；没服务就用静态页里内联的那份 */
  if (cv01.isOnline && cv01.isOnline()) load().catch(function () {});
})();

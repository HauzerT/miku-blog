/* ==========================================================================
   music.js · 音乐盒
   ---------------------------------------------------------------------------
   一根 <audio data-bgm>，一份 media/music/ 里的曲库。
   进页面自动尝试播放：浏览器拦下来（没有用户手势）就在悬浮球上点一颗琥珀色的灯，
   并且这一次点击、滚动、按键都算手势，一有手势就接着放。

   面板里：播放/上一首/下一首/列表循环/单曲循环、拖动进度、音量、
   以及上传 mp3 / m4a（拖进去也行）、改名、删除。
   选中的曲目和音量记在 localStorage，下次进站接着放。
   ========================================================================== */
(function () {
  'use strict';

  var doc = document;
  var cv01 = (window.cv01 = window.cv01 || {});
  var audio = doc.querySelector('[data-bgm]');
  if (!audio) return;

  var STORE = 'cv01-music';
  var MODES = ['list', 'one', 'shuffle'];
  var MODE_LABEL = { list: '列表循环', one: '单曲循环', shuffle: '随机' };
  var state = {
    tracks: [],
    settings: { volume: 0.6, loop: true, autoplay: true },
    index: -1,
    defaultIndex: -1,   // 「进页面自动播」的那一首
    failed: {},         // 放不出来的文件（键是 url），跳过它们
    mode: 'list',
    playing: false,
    blocked: false,
  };
  var panel = null;

  /* ------------------------------------------------------------ 本地记忆 */
  function remember() {
    try {
      window.localStorage.setItem(STORE, JSON.stringify({
        file: state.playedFile || (state.tracks[state.index] ? state.tracks[state.index].file : ''),
        pin: state.tracks[state.defaultIndex] ? state.tracks[state.defaultIndex].file : '',
        mode: state.mode,
        volume: audio.volume,
      }));
    } catch (e) { /* 隐私模式：忽略 */ }
  }
  function recall() {
    try { return JSON.parse(window.localStorage.getItem(STORE) || '{}') || {}; } catch (e) { return {}; }
  }

  function indexOfFile(file) {
    if (!file) return -1;
    for (var i = 0; i < state.tracks.length; i++) if (state.tracks[i].file === file) return i;
    return -1;
  }

  /* 设为「进页面自动播」的那一首。不打断正在放的东西，
     但曲库还空着、或者压根没在放的时候，顺手把它放起来。 */
  function pin(i) {
    if (i < 0 || i >= state.tracks.length) return;
    state.defaultIndex = i;
    remember();
    paint();
    /* 没在放的时候顺手把这一首放起来——「选它」这个动作本来就该听见结果。
       已经在放别的歌就不打断，只把它记成"下次先进这一首"。 */
    if (audio.paused) play(i);
  }

  /* ------------------------------------------------------------ 播放控制 */
  function current() { return state.tracks[state.index] || null; }

  function play(index, opts) {
    var options = opts || {};
    if (!state.tracks.length) return;
    if (typeof index === 'number') state.index = (index + state.tracks.length) % state.tracks.length;
    if (state.index < 0) state.index = 0;
    var track = current();
    if (!track) return;
    if (audio.getAttribute('src') !== track.url) {
      audio.src = track.url;
      audio.load();
    }
    state.playedFile = track.file;
    var p = audio.play();
    if (p && p.catch) {
      p.then(function () { state.blocked = false; paintBall(); })
        .catch(function () { state.blocked = options.auto ? true : false; paintBall(); paint(); });
    }
    remember();
    paint();
  }

  function toggle() {
    if (!state.tracks.length) return;
    if (audio.paused) play(state.index);
    else audio.pause();
  }

  function step(delta) {
    if (!state.tracks.length) return;
    if (state.mode === 'shuffle') {
      var next = state.index;
      var guard = 0;
      while (state.tracks.length > 1 && next === state.index && guard++ < 40) {
        next = Math.floor(Math.random() * state.tracks.length);
      }
      return play(next);
    }
    /* 跳过已知放不出来的文件（媒体文件坏了不该把整条队列堵死） */
    var i = state.index;
    for (var hop = 0; hop < state.tracks.length; hop++) {
      i = (i + delta + state.tracks.length) % state.tracks.length;
      if (!state.failed[state.tracks[i].url]) return play(i);
    }
    cv01.toast('曲库里没有能放的文件了', true);
  }

  audio.addEventListener('play', function () { state.playing = true; state.blocked = false; paint(); paintBall(); });
  audio.addEventListener('pause', function () { state.playing = false; paint(); paintBall(); });
  audio.addEventListener('ended', function () {
    if (state.mode === 'one') { audio.currentTime = 0; play(state.index); return; }
    step(1);
  });
  audio.addEventListener('timeupdate', paintProgress);
  audio.addEventListener('loadedmetadata', paintProgress);

  /* 文件坏掉（被手动删了、拷进来一半、格式不认）时：把那首从「默认」上摘下来，
     在列表里标出来，然后往下找一首能放的。别默默切走，也别报告错的曲名。 */
  audio.addEventListener('error', function () {
    var bad = state.tracks.filter(function (t) { return t.url === audio.getAttribute('src'); })[0];
    if (!bad) bad = current();
    if (!bad) return;
    state.failed[bad.url] = true;
    cv01.toast('这首放不出来：' + bad.title + '（文件坏了或被删了）', true);
    if (state.tracks[state.defaultIndex] && state.tracks[state.defaultIndex].url === bad.url) {
      var usable = -1;
      for (var i = 0; i < state.tracks.length; i++) {
        if (!state.failed[state.tracks[i].url]) { usable = i; break; }
      }
      state.defaultIndex = usable;
      remember();
    }
    paint();
    /* 只在「正在放的那一首坏了」时往前找；否则不动用户刚选的东西 */
    if (state.tracks[state.index] && state.tracks[state.index].url === bad.url) step(1);
  });

  /* 音量：跟服务端的设置同步，但以本地为准，免得每次都要重设 */
  function setVolume(v) {
    audio.volume = Math.min(1, Math.max(0, v));
    remember();
    cv01.fetchJSON(cv01.api + 'music/settings', { method: 'PATCH', json: { volume: audio.volume } }).catch(function () {});
  }

  /* ------------------------------------------------------------ 悬浮球 */
  function paintBall() {
    var ball = doc.querySelector('[data-ball="music"]');
    if (!ball) return;
    var t = current();
    ball.classList.toggle('is-playing', state.playing);
    ball.classList.toggle('is-blocked', state.blocked && !state.playing);
    ball.setAttribute('data-count', String(state.tracks.length));
    /* 球上带出正在放的那一首：不用点开就知道现在在听什么 */
    if (t) ball.setAttribute('data-title', t.title);
    else ball.removeAttribute('data-title');
    ball.setAttribute('aria-label', state.playing
      ? '音乐盒：正在播放 ' + ((t && t.title) || '')
      : state.blocked ? '音乐盒：点一下开始播放' : '音乐盒');
  }

  /* ------------------------------------------------------------ 面板 */
  /* 曲库列表。每一行：序号/播放、曲名、大小、设为默认、换一首、改名、删。
     「默认」那一首就是进页面自动放的那一首——这样「选歌」这件事才落得下地：
     点行 = 现在就放，点「设默认」= 下次进页面先放它。 */
  function listMarkup() {
    if (!state.tracks.length) {
      return '<p class="mp-empty">曲库是空的。把 mp3 / m4a 拖到上面的框里，或者点「选择文件」。</p>';
    }
    var pinned = state.defaultIndex;
    return state.tracks
      .map(function (t, i) {
        var isCurrent = i === state.index;
        var broken = Boolean(state.failed[t.url]);
        return '<li class="mp-item' + (isCurrent ? ' is-current' : '') + (i === pinned ? ' is-pinned' : '') +
          (broken ? ' is-broken' : '') + '" data-i="' + i + '" data-id="' + esc(t.id || '') + '">' +
          '<button class="mp-item__play" type="button" data-play="' + i + '" aria-label="播放 ' + esc(t.title) + '">' +
          '<span class="mp-item__no">' + (isCurrent ? (state.playing ? '▶' : '❚❚') : i + 1) + '</span>' +
          '</button>' +
          '<span class="mp-item__title">' + esc(t.title) +
          (broken ? '（放不出来）' : '') +
          (t.artist ? '<em>' + esc(t.artist) + '</em>' : '') + '</span>' +
          '<span class="mp-item__size">' + size(t.size) + '</span>' +
          '<span class="mp-item__acts">' +
          '<button class="mp-item__act' + (i === pinned ? ' is-on' : '') + '" type="button" data-pin="' + i +
          '" aria-pressed="' + (i === pinned ? 'true' : 'false') +
          '" title="设为进页面自动播放的那一首">' + (i === pinned ? '默认' : '设默认') + '</button>' +
          '<button class="mp-item__act" type="button" data-swap="' + i + '" title="用本机另一个文件替换这一首">换</button>' +
          '<button class="mp-item__act" type="button" data-rename="' + i + '">改名</button>' +
          '<button class="mp-item__act mp-item__act--del" type="button" data-del="' + i + '" aria-label="删除 ' + esc(t.title) + '">删</button>' +
          '</span>' +
          '</li>';
      })
      .join('');
  }

  function shell() {
    var t = current();
    var pinned = state.tracks[state.defaultIndex];
    return '' +
      '<div class="mp">' +
      '  <div class="mp__head">' +
      '    <p class="mp__eyebrow">音乐盒 · ' + state.tracks.length + ' 首</p>' +
      '    <p class="mp__now" data-now>' + (t ? esc(t.title) : '还没有曲子') + '</p>' +
      '    <p class="mp__sub" data-sub>' + (t && t.artist ? esc(t.artist) : 'MP3 / M4A · 进页面自动播放') + '</p>' +
      (pinned ? '    <p class="mp__pin" data-pin-line>进页面自动播：' + esc(pinned.title) + '</p>' : '') +
      '  </div>' +
      '  <div class="mp__scrub">' +
      '    <input class="mp__seek" type="range" min="0" max="1000" value="0" step="1" aria-label="进度" data-seek>' +
      '    <span class="mp__clock" data-clock>0:00 / 0:00</span>' +
      '  </div>' +
      '  <div class="mp__ctrl">' +
      '    <button class="mp__btn" type="button" data-prev aria-label="上一首">◀◀</button>' +
      '    <button class="mp__btn mp__btn--main" type="button" data-toggle aria-label="播放/暂停" data-toggle-label>▶</button>' +
      '    <button class="mp__btn" type="button" data-next aria-label="下一首">▶▶</button>' +
      '    <button class="mp__btn mp__btn--mode" type="button" data-mode>' + MODE_LABEL[state.mode] + '</button>' +
      '  </div>' +
      '  <div class="mp__vol">' +
      '    <span class="mp__vol-label">音量</span>' +
      '    <input class="mp__vol-range" type="range" min="0" max="100" value="' + Math.round(audio.volume * 100) + '" aria-label="音量" data-vol>' +
      '  </div>' +
      '  <div class="mp__drop" data-drop>' +
      '    <b class="mp__drop-title">上传 BGM</b>' +
      '    把 MP3 / M4A 拖到这里，或者 <button class="mp__pick" type="button" data-pick>选择文件</button>' +
      '    <input class="mp__file" type="file" accept="audio/mpeg,audio/mp4,audio/x-m4a,.mp3,.m4a,.mp4,.wav,.ogg,.flac" multiple hidden data-file>' +
      '    <input class="mp__file" type="file" accept="audio/mpeg,audio/mp4,audio/x-m4a,.mp3,.m4a,.mp4" hidden data-swap-file>' +
      '    <span class="mp__up" data-up hidden><i data-up-bar></i><b data-up-text>上传中 0%</b></span>' +
      '  </div>' +
      '  <ul class="mp__list" data-list>' + listMarkup() + '</ul>' +
      '  <div class="mp__foot">' +
      '    <button class="mp__btn mp__btn--upload" type="button" data-upload>上传 BGM</button>' +
      '    <span class="mp__foot-note">支持 MP3 / M4A</span>' +
      '  </div>' +
      '  <p class="mp__note">曲库存在 <code>media/music/</code>，直接把文件丢进那个文件夹也会被认出来（刷新页面即可）。「默认」那一首就是每次进页面自动放的那一首；浏览器不允许没交互就出声，所以第一次可能要你点一下。</p>' +
      '</div>';
  }

  function paint() {
    if (!panel || panel.hidden) return;
    var t = current();
    var now = panel.querySelector('[data-now]');
    var sub = panel.querySelector('[data-sub]');
    var list = panel.querySelector('[data-list]');
    var toggle = panel.querySelector('[data-toggle]');
    if (now) now.textContent = t ? t.title : '还没有曲子';
    if (sub) sub.textContent = t && t.artist ? t.artist : 'MP3 / M4A · 进页面自动播放';
    var pinned = state.tracks[state.defaultIndex];
    var pinLine = panel.querySelector('[data-pin-line]');
    if (pinLine) {
      pinLine.textContent = pinned ? '进页面自动播：' + pinned.title : '';
      pinLine.hidden = !pinned;
    }
    var eyebrow = panel.querySelector('.mp__eyebrow');
    if (eyebrow) eyebrow.textContent = '音乐盒 · ' + state.tracks.length + ' 首';
    paintBall();
    if (toggle) {
      toggle.textContent = state.playing ? '❚❚' : '▶';
      toggle.classList.toggle('is-playing', state.playing);
    }
    if (list) list.innerHTML = listMarkup();
    paintProgress();
  }

  function paintProgress() {
    if (!panel || panel.hidden) return;
    var seek = panel.querySelector('[data-seek]');
    var clock = panel.querySelector('[data-clock]');
    var dur = audio.duration;
    if (seek && document.activeElement !== seek) {
      seek.value = dur && isFinite(dur) ? String(Math.round((audio.currentTime / dur) * 1000)) : '0';
    }
    if (clock) clock.textContent = fmt(audio.currentTime) + ' / ' + fmt(dur);
  }

  function bind() {
    var seek = panel.querySelector('[data-seek]');
    var drop = panel.querySelector('[data-drop]');
    var file = panel.querySelector('[data-file]');

    panel.querySelector('[data-toggle]').addEventListener('click', toggle);
    panel.querySelector('[data-prev]').addEventListener('click', function () { step(-1); });
    panel.querySelector('[data-next]').addEventListener('click', function () { step(1); });
    panel.querySelector('[data-mode]').addEventListener('click', function (e) {
      state.mode = MODES[(MODES.indexOf(state.mode) + 1) % MODES.length];
      e.currentTarget.textContent = MODE_LABEL[state.mode];
      remember();
    });
    panel.querySelector('[data-vol]').addEventListener('input', function (e) { setVolume(e.target.value / 100); });
    seek.addEventListener('input', function (e) {
      if (!audio.duration || !isFinite(audio.duration)) return;
      audio.currentTime = (Number(e.target.value) / 1000) * audio.duration;
      paintProgress();
    });

    panel.querySelector('[data-pick]').addEventListener('click', function () { file.click(); });
    panel.querySelector('[data-upload]').addEventListener('click', function () { file.click(); });
    file.addEventListener('change', function () { if (file.files.length) upload(file.files); file.value = ''; });

    ['dragenter', 'dragover'].forEach(function (type) {
      drop.addEventListener(type, function (e) { e.preventDefault(); drop.classList.add('is-over'); });
    });
    ['dragleave', 'drop'].forEach(function (type) {
      drop.addEventListener(type, function (e) { e.preventDefault(); drop.classList.remove('is-over'); });
    });
    drop.addEventListener('drop', function (e) {
      var files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) upload(files);
    });

    panel.addEventListener('click', function (e) {
      var playBtn = e.target.closest('[data-play]');
      if (playBtn) { play(Number(playBtn.getAttribute('data-play'))); return; }
      var pinBtn = e.target.closest('[data-pin]');
      if (pinBtn) { pin(Number(pinBtn.getAttribute('data-pin'))); return; }
      var swap = e.target.closest('[data-swap]');
      if (swap) { swapFrom(Number(swap.getAttribute('data-swap'))); return; }
      var rename = e.target.closest('[data-rename]');
      if (rename) { renameTrack(Number(rename.getAttribute('data-rename'))); return; }
      var del = e.target.closest('[data-del]');
      if (del) { removeTrack(Number(del.getAttribute('data-del'))); return; }
    });

    /* 键盘：空格播放/暂停，左右切歌 */
    panel.addEventListener('keydown', function (e) {
      if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
      if (e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); toggle(); }
      if (e.key === 'ArrowRight' && e.altKey) { e.preventDefault(); step(1); }
      if (e.key === 'ArrowLeft' && e.altKey) { e.preventDefault(); step(-1); }
    });
  }

  /* ------------------------------------------------------------ 上传 */
  function upload(files) {
    var list = Array.prototype.slice.call(files);
    var audioFiles = list.filter(function (f) { return /\.(mp3|m4a|wav|ogg|oga|opus|flac|aac)$/i.test(f.name) || /^audio\//.test(f.type); });
    if (!audioFiles.length) return cv01.toast('只认音频文件（mp3 / m4a / wav / ogg / flac）', true);

    var box = panel.querySelector('[data-up]');
    var bar = panel.querySelector('[data-up-bar]');
    var text = panel.querySelector('[data-up-text]');
    box.hidden = false;

    var done = 0;
    var form = new FormData();
    audioFiles.forEach(function (f) { form.append('file', f, f.name); });

    cv01.withKey(function () {
      return cv01.upload(cv01.api + 'music', form, function (ratio) {
        var overall = (done + ratio) / audioFiles.length;
        bar.style.width = Math.round(overall * 100) + '%';
        text.textContent = '上传中 ' + Math.round(overall * 100) + '%（' + fmtSize(sum(audioFiles)) + '）';
      });
    })
      .then(function (data) {
        (data.tracks || []).forEach(function (t) { state.tracks.push(t); });
        done = audioFiles.length;
        bar.style.width = '100%';
        text.textContent = '传好了，' + (data.tracks || []).length + ' 首';
        cv01.toast('已加入音乐盒：' + (data.tracks || []).map(function (t) { return t.title; }).join('、'));
        var wasEmpty = state.index === -1;
        /* 曲库本来是空的：新传的这首自动成为「进页面自动播」的那一首 */
        if (wasEmpty) state.defaultIndex = 0;
        paint();
        if (wasEmpty) play(0);
        window.setTimeout(function () { box.hidden = true; bar.style.width = '0'; }, 1600);
      })
      .catch(function (err) { box.hidden = true; cv01.error(err); });
  }

  /* 用本机另一个文件替换曲库里的某一首：位置、名字都不动，只换声音。
     上传成功之后再删旧文件——顺序反了会先丢歌再发现传失败。 */
  function swapFrom(i) {
    var t = state.tracks[i];
    if (!t) return;
    var input = panel.querySelector('[data-swap-file]');
    input.onchange = function () {
      var file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      if (!/\.(mp3|m4a|wav|ogg|oga|opus|flac|aac)$/i.test(file.name) && !/^audio\//.test(file.type)) {
        return cv01.toast('只认音频文件（mp3 / m4a / wav / ogg / flac）', true);
      }
      var box = panel.querySelector('[data-up]');
      var bar = panel.querySelector('[data-up-bar]');
      var text = panel.querySelector('[data-up-text]');
      box.hidden = false;
      bar.style.width = '10%';
      text.textContent = '替换中…';

      var form = new FormData();
      form.append('file', file, file.name);
      cv01.withKey(function () {
        return cv01.upload(cv01.api + 'music', form, function (ratio) {
          bar.style.width = Math.round(ratio * 100) + '%';
          text.textContent = '替换中 ' + Math.round(ratio * 100) + '%';
        });
      })
        .then(function (data) {
          var added = (data.tracks || [])[0];
          if (!added) throw new Error('服务没有返回新曲目');
          /* 新的一首顶到旧的位置上（歌曲顺序按加入时间，替换相当于原地换血） */
          state.tracks.splice(i, 1, added);
          if (state.defaultIndex === i) remember();
          return cv01.withKey(function () {
            return cv01.fetchJSON(cv01.api + 'music/' + t.id, { method: 'DELETE' });
          });
        })
        .then(function () {
          text.textContent = '换好了';
          /* 刚换掉的正好是正在放的那一首：用新文件接着放。
             （判断里加上 state.index，因为放着的这首可能停在中途、src 还没落地） */
          var playingThis = state.index === i || (current() && current().id === added.id);
          if (playingThis) play(i, { auto: true });
          paint();
          cv01.toast('《' + t.title + '》换成了新文件');
          window.setTimeout(function () { box.hidden = true; bar.style.width = '0'; }, 1500);
        })
        .catch(function (err) { box.hidden = true; cv01.error(err); });
    };
    input.click();
  }

  function renameTrack(i) {
    var t = state.tracks[i];
    if (!t) return;
    var name = window.prompt('改成什么名字？', t.title);
    if (name === null) return;
    name = name.trim();
    if (!name || name === t.title) return;
    cv01.withKey(function () {
      return cv01.fetchJSON(cv01.api + 'music/' + t.id, { method: 'PATCH', json: { title: name } });
    })
      .then(function () { t.title = name; paint(); paintBall(); })
      .catch(cv01.error);
  }

  function removeTrack(i) {
    var t = state.tracks[i];
    if (!t) return;
    if (!window.confirm('删掉《' + t.title + '》？文件也会从 media/music/ 里删掉。')) return;
    cv01.withKey(function () { return cv01.fetchJSON(cv01.api + 'music/' + t.id, { method: 'DELETE' }); })
      .then(function () {
        state.tracks.splice(i, 1);
        if (state.index >= state.tracks.length) state.index = state.tracks.length - 1;
        if (!state.tracks.length) { audio.pause(); audio.removeAttribute('src'); }
        else play(state.index);
        paint();
        cv01.toast('删掉了');
      })
      .catch(cv01.error);
  }

  /* ------------------------------------------------------------ 自动播放 */
  /* 进页面该放哪一首：
     ① 你指定过的「默认」那一首（进页面自动播放的正式答案）
     ② 上次听到一半的那一首（没有默认时就接着上次）
     ③ 曲库第一首 */
  function startIndex() {
    if (state.defaultIndex >= 0 && state.defaultIndex < state.tracks.length) return state.defaultIndex;
    var memo = recall();
    return indexOfFile(memo.file) === -1 ? 0 : indexOfFile(memo.file);
  }

  function armAutoplay() {
    var gestures = ['pointerdown', 'keydown', 'touchstart', 'wheel'];
    function once() {
      gestures.forEach(function (g) { doc.removeEventListener(g, once, true); });
      if (state.blocked && !state.playing && state.settings.autoplay) play(state.index, { auto: true });
    }
    gestures.forEach(function (g) { doc.addEventListener(g, once, true); });
  }

  function boot() {
    var memo = recall();
    if (typeof memo.volume === 'number') audio.volume = memo.volume;
    if (memo.mode && MODE_LABEL[memo.mode]) state.mode = memo.mode;
    audio.loop = false;

    cv01.fetchJSON(cv01.api + 'music')
      .then(function (data) {
        state.tracks = data.tracks || [];
        state.settings = Object.assign(state.settings, data.settings || {});
        if (!memo.volume && typeof state.settings.volume === 'number') audio.volume = state.settings.volume;
        state.defaultIndex = indexOfFile(memo.pin);
        if (state.defaultIndex === -1 && state.tracks.length) state.defaultIndex = 0;
        state.index = state.tracks.length ? startIndex() : -1;
        paintBall();
        /* 进页面就放。浏览器多半会拦，拦了就在悬浮球上点灯，等第一个手势。 */
        if (state.settings.autoplay && state.tracks.length) play(state.index, { auto: true });
        armAutoplay();
      })
      .catch(function () { /* 服务没在跑：音乐盒安静地不存在 */ });

    doc.addEventListener('cv01:posts-changed', function () { /* 占位：别的模块刷新时音乐盒不动 */ });
  }

  /* ------------------------------------------------------------ 对外 */
  cv01.music = {
    open: function (host) {
      panel = doc.createElement('div');
      panel.className = 'mp-wrap';
      panel.innerHTML = shell();
      host.appendChild(panel);
      bind();
      paint();
      paintProgress();
    },
    play: play,
    pause: function () { audio.pause(); },
    toggle: toggle,
    /* 只读快照：面板之外（自检、控制台）想知道音乐盒现在怎么想的时候用它 */
    state: function () {
      return {
        tracks: state.tracks.map(function (t) { return { id: t.id, title: t.title, file: t.file, url: t.url }; }),
        index: state.index,
        defaultIndex: state.defaultIndex,
        defaultTitle: state.tracks[state.defaultIndex] ? state.tracks[state.defaultIndex].title : '',
        startIndex: state.tracks.length ? startIndex() : -1,
        startTitle: state.tracks.length ? (state.tracks[startIndex()] || {}).title || '' : '',
        mode: state.mode,
        volume: audio.volume,
        playing: state.playing,
        blocked: state.blocked,
        src: audio.currentSrc || audio.getAttribute('src') || '',
      };
    },
  };

  /* ------------------------------------------------------------ 小工具 */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function fmt(sec) {
    if (!sec || !isFinite(sec)) return '0:00';
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function size(bytes) { return fmtSize(bytes); }
  function fmtSize(bytes) {
    var n = Number(bytes) || 0;
    if (!n) return '';
    if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }
  function sum(list) { return list.reduce(function (a, f) { return a + f.size; }, 0); }

  /* 延迟到 DOMContentLoaded：那时候 studio.js 已经建好 window.cv01 上的公共方法了。
     （defer 脚本是「文档还在加载」的状态下按顺序跑的，直接执行会拿不到 cv01.fetchJSON） */
  if (doc.readyState === 'complete') boot();
  else doc.addEventListener('DOMContentLoaded', boot, { once: true });
})();

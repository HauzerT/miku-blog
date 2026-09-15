/* ==========================================================================
   kumura.js · 云村页：扫码登录 → 账号信息 → 红心歌单
   ---------------------------------------------------------------------------
   这一页自己会说话：小服务没起、没登录、二维码过期、歌单为空，都有对应的说法，
   不靠弹窗报错。取数全部走本机小服务（tools/ncm-server.mjs）；
   浏览器这边不碰任何密钥，也不把登录凭证写进 localStorage——
   凭证只在小服务的 .ncm-session.json 里，那是本机文件。
   ========================================================================== */
(function () {
  'use strict';

  var CFG = window.CV01_MUSIC || {};
  var SERVICE = (CFG.service || 'http://127.0.0.1:3170').replace(/\/+$/, '');
  var PAGE_SIZE = CFG.pageSize || 50;
  var POLL_MS = CFG.pollInterval || 2000;
  var QR_TTL = (CFG.qrTtl || 180) * 1000;

  var panel = document.querySelector('[data-music]');
  if (!panel) return;

  var liked = { offset: 0, total: 0, hasMore: false, loading: false };
  var qrState = { key: null, deadline: 0, pollTimer: null, ticker: null, refreshTimer: null, polling: false, expired: false };

  /* ------------------------------------------------------------ 取节点 */

  function q(sel) { return panel.querySelector(sel); }
  var el = {
    qrBox: q('[data-qr]'),
    qrStatus: q('[data-qr-status]'),
    qrTimer: q('[data-qr-timer]'),
    qrRefresh: q('[data-qr-refresh]'),
    serviceHint: q('[data-service-hint]'),
    avatar: q('[data-avatar]'),
    facts: q('[data-facts]'),
    vip: q('[data-vip]'),
    profileBg: q('[data-profile-bg]'),
    likedCover: q('[data-liked-cover]'),
    likedMeta: q('[data-liked-meta]'),
    list: q('[data-list]'),
    listNote: q('[data-list-note]'),
    more: q('[data-more]'),
    logout: q('[data-logout]'),
    player: q('[data-player]'),
    playerArt: q('[data-player-art]'),
    playerName: q('[data-player-name]'),
    playerSub: q('[data-player-sub]'),
    playerPrev: q('[data-player-prev]'),
    playerToggle: q('[data-player-toggle]'),
    playerNext: q('[data-player-next]'),
    playerSeek: q('[data-player-seek]'),
    playerClock: q('[data-player-clock]'),
    playerVol: q('[data-player-vol]'),
    playerClose: q('[data-player-close]'),
  };

  function setState(name) { panel.setAttribute('data-music-state', name); }

  /* -------------------------------------------------------------- 小工具 */

  function text(node, value) { if (node) node.textContent = value == null ? '' : String(value); }

  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }

  function make(tag, className, content) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (content != null) node.textContent = content;
    return node;
  }

  function duration(ms) {
    if (!ms || ms < 0) return '--:--';
    var total = Math.round(ms / 1000);
    var m = Math.floor(total / 60);
    var s = total % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function compact(n) {
    if (n == null) return '—';
    if (n < 10000) return String(n);
    return (n / 10000).toFixed(n < 100000 ? 1 : 0) + ' 万';
  }

  function dateOnly(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    return d.getFullYear() + '.' +
      String(d.getMonth() + 1).padStart(2, '0') + '.' +
      String(d.getDate()).padStart(2, '0');
  }

  /* ---------------------------------------------------------------- 请求 */

  /* 每个请求都设个上限。指向一个没人监听的端口时，浏览器第一次连接可能迟迟不报错，
     没有这个超时页面就会一直停在"正在连接"——那是最糟的一种失败方式。 */
  var API_TIMEOUT = (CFG.timeout || 8000);

  function api(path, params) {
    var url = SERVICE + path;
    if (params) {
      var qs = Object.keys(params).map(function (k) {
        return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
      }).join('&');
      if (qs) url += '?' + qs;
    }
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, API_TIMEOUT) : null;

    return fetch(url, { credentials: 'include', signal: ctrl ? ctrl.signal : undefined })
      .then(function (res) {
        return res.json().catch(function () { return null; }).then(function (data) {
          /* 端口上有别的东西在应答（不是小服务）时会是 404 + HTML：
             这种情况不能当成"服务在"，否则页面会卡在"正在连接"。 */
          if (!data) throw new Error('HTTP ' + res.status);
          return { status: res.status, data: data };
        });
      })
      .then(function (r) { if (timer) clearTimeout(timer); return r; },
        function (err) {
          if (timer) clearTimeout(timer);
          throw err;
        });
  }

  /* 封面图走小服务代理：网易的图不允许直接跨域读像素 */
  function img(url, size) {
    if (!url) return '';
    var u = size
      ? url + (url.indexOf('?') === -1 ? '?' : '&') + 'param=' + size + 'y' + size
      : url;
    return SERVICE + '/api/img?url=' + encodeURIComponent(u);
  }

  /* -------------------------------------------------------- 二维码与轮询 */

  function stopQrWork() {
    if (qrState.pollTimer) { clearTimeout(qrState.pollTimer); qrState.pollTimer = null; }
    if (qrState.ticker) { clearInterval(qrState.ticker); qrState.ticker = null; }
    if (qrState.refreshTimer) { clearTimeout(qrState.refreshTimer); qrState.refreshTimer = null; }
    qrState.polling = false;
  }

  function renderQr(url) {
    clear(el.qrBox);
    if (!window.CV01QR) {
      el.qrBox.appendChild(make('p', 'km-login__fallback', '二维码模块没加载上，刷新一下。'));
      return;
    }
    try {
      var qr = window.CV01QR.encode(url);
      var wrap = make('div', 'km-login__code');
      wrap.innerHTML = window.CV01QR.toSvg(qr, { dark: '#1a1c1e', light: '#ffffff' });
      el.qrBox.appendChild(wrap);
    } catch (err) {
      el.qrBox.appendChild(make('p', 'km-login__fallback', '二维码生成失败，刷新重试。'));
    }
  }

  function startCountdown() {
    qrState.deadline = Date.now() + QR_TTL;
    if (qrState.ticker) clearInterval(qrState.ticker);
    qrState.ticker = setInterval(function () {
      var left = Math.max(0, Math.round((qrState.deadline - Date.now()) / 1000));
      text(el.qrTimer, left + ' 秒后过期');
      if (left <= 0) expireQr('超时');
    }, 500);
  }

  /* 过期只有一种正确的处理方式：**自己换一张**。
     之前是停下来等用户点「换一张」—— 实测这会把整件事拖死：
     二维码有效期比人慢悠悠掏手机的时间短，等扫的时候它已经作废了，
     而页面上只是小字变了一下，没人会注意到。
     现在改成：一过期就立刻自动换新，同时把状态说清楚。 */
  function expireQr(reason) {
    if (qrState.expired) return;
    qrState.expired = true;
    stopQrWork();
    setState('login-expired');
    text(el.qrStatus, reason === '已扫码但确认超时'
      ? '手机上确认得太久，二维码已作废 —— 正在换一张新的。'
      : '二维码已作废 —— 正在自动换一张新的。');
    scheduleQrRefresh();
  }

  /* 自动换新留一秒，让用户看清"为什么变了"，而不是二维码无声无息地换掉 */
  function scheduleQrRefresh() {
    if (qrState.refreshTimer) clearTimeout(qrState.refreshTimer);
    qrState.refreshTimer = setTimeout(function () {
      qrState.refreshTimer = null;
      beginQrLogin();
    }, 1000);
  }

  function schedulePoll(delay) {
    if (qrState.pollTimer) clearTimeout(qrState.pollTimer);
    qrState.pollTimer = setTimeout(pollOnce, delay == null ? POLL_MS : delay);
  }

  function pollOnce() {
    if (!qrState.key) return;
    if (qrState.polling) return schedulePoll();
    qrState.polling = true;
    qrState.pollTimer = null;

    api('/api/login/qr/check', { key: qrState.key }).then(function (r) {
      qrState.polling = false;
      var d = r.data || {};
      if (d.code === 800) return expireQr('超时');
      if (d.code === 802) text(el.qrStatus, '已扫码 —— 请在手机上点一下确认。');
      if (d.code === 803) {
        if (d.loggedIn) {
          stopQrWork();
          text(el.qrStatus, '登录成功，正在读取你的云村…');
          /* 网易那边要几秒才把凭证预热好，等一拍再取数据更稳 */
          setTimeout(loadAll, 800);
        } else {
          text(el.qrStatus, '登录成功但没拿到凭证，点「换一张」再试一次。');
          setState('login-expired');
        }
        return;
      }
      schedulePoll();
    }).catch(function () {
      qrState.polling = false;
      text(el.qrStatus, '轮询失败，正在重试…');
      schedulePoll(POLL_MS * 2);
    });
  }

  function beginQrLogin() {
    stopQrWork();
    qrState.expired = false;
    qrState.key = null;
    clear(el.qrBox);
    setState('login-loading');
    text(el.qrStatus, '正在生成二维码…');
    text(el.qrTimer, '');

    api('/api/login/qr/key').then(function (r) {
      if (!r.data || !r.data.key) {
        throw new Error((r.data && (r.data.message || r.data.error)) || '拿不到 key');
      }
      qrState.key = r.data.key;
      return api('/api/login/qr/create', { key: qrState.key });
    }).then(function (r) {
      if (!r.data || !r.data.qrurl) throw new Error('拿不到二维码内容');
      renderQr(r.data.qrurl);
      setState('login');
      text(el.qrStatus, '打开网易云音乐 App → 左上角「扫一扫」。');
      startCountdown();
      schedulePoll(POLL_MS);
    }).catch(function (err) {
      setState('login-error');
      text(el.qrStatus, '二维码没出来：' + ((err && err.message) || '未知错误'));
    });
  }

  /* ------------------------------------------------------------ 账号信息 */

  function renderProfile(profile, likedInfo) {
    if (!profile) return;

    if (el.avatar) {
      clear(el.avatar);
      if (profile.avatar) {
        var av = make('img', 'km-profile__avatar-img');
        av.src = img(profile.avatar, 300);
        av.alt = profile.nickname + ' 的头像';
        av.loading = 'lazy';
        el.avatar.appendChild(av);
      }
    }

    text(q('[data-nickname]'), profile.nickname);
    text(q('[data-uid]'), profile.uid ? 'UID ' + profile.uid : '');
    text(q('[data-signature]'), profile.signature || '这个人很懒，什么都没写。');

    if (el.vip) {
      if (profile.vip && profile.vip.label) {
        text(el.vip, profile.vip.label);
        el.vip.hidden = false;
      } else {
        el.vip.hidden = true;
      }
    }

    if (el.profileBg) {
      if (profile.background) {
        el.profileBg.style.backgroundImage = 'url("' + img(profile.background, 1200) + '")';
        el.profileBg.hidden = false;
      } else {
        el.profileBg.hidden = true;
      }
    }

    /* 数据条：没值的格子整格不出现，不留空壳 */
    if (el.facts) {
      clear(el.facts);
      [
        ['等级', profile.level != null ? 'Lv.' + profile.level : null],
        ['听歌', profile.listenSongs != null ? compact(profile.listenSongs) + ' 首' : null],
        ['关注', profile.follows != null ? compact(profile.follows) : null],
        ['粉丝', profile.followers != null ? compact(profile.followers) : null],
        ['歌单', profile.playlists != null ? compact(profile.playlists) + ' 个' : null],
        ['云村年龄', profile.createDays != null ? Math.floor(profile.createDays / 365) + ' 年' : null],
      ].forEach(function (row) {
        if (row[1] == null) return;
        var li = make('li', 'km-facts__row');
        li.appendChild(make('span', 'km-facts__key', row[0]));
        li.appendChild(make('span', 'km-facts__val', row[1]));
        el.facts.appendChild(li);
      });
      el.facts.hidden = el.facts.children.length === 0;
    }

    /* 红心歌单的头 */
    if (el.likedCover) {
      clear(el.likedCover);
      if (likedInfo && likedInfo.cover) {
        var cover = make('img', 'km-liked__cover-img');
        cover.src = img(likedInfo.cover, 300);
        cover.alt = (likedInfo.name || '红心歌单') + ' 封面';
        cover.loading = 'lazy';
        el.likedCover.appendChild(cover);
        el.likedCover.hidden = false;
      } else {
        el.likedCover.hidden = true;
      }
    }

    if (el.likedMeta) {
      clear(el.likedMeta);
      if (likedInfo) {
        el.likedMeta.appendChild(make('span', 'km-liked__name', likedInfo.name || '我喜欢的音乐'));
        if (likedInfo.trackCount != null) {
          el.likedMeta.appendChild(make('span', 'km-liked__dot', '·'));
          el.likedMeta.appendChild(make('span', 'km-liked__count', likedInfo.trackCount + ' 首'));
        }
        if (likedInfo.updateTime) {
          el.likedMeta.appendChild(make('span', 'km-liked__dot', '·'));
          el.likedMeta.appendChild(make('span', 'km-liked__upd', '最近更新 ' + dateOnly(likedInfo.updateTime)));
        }
      } else {
        el.likedMeta.appendChild(make('span', 'km-liked__name', '我喜欢的音乐'));
      }
    }
  }

  /* ------------------------------------------------------------ 曲目列表 */

  function songRow(song, index, offset) {
    var li = make('li', 'km-track');
    li.setAttribute('data-id', song.id);

    li.appendChild(make('span', 'km-track__no', String(offset + index + 1).padStart(2, '0')));

    var art = make('span', 'km-track__art');
    if (song.cover) {
      var im = make('img', 'km-track__art-img');
      im.src = img(song.cover, 100);
      im.alt = '';
      im.loading = 'lazy';
      art.appendChild(im);
    }
    li.appendChild(art);

    var main = make('span', 'km-track__main');
    var title = make('span', 'km-track__name', song.missing ? '（已下架或不可用）' : song.name);
    if (song.mvId) title.appendChild(make('span', 'km-track__mv', 'MV'));
    main.appendChild(title);
    main.appendChild(make('span', 'km-track__artist', song.missing
      ? '歌曲 id ' + song.id
      : song.artist + (song.album ? ' · ' + song.album : '')));
    li.appendChild(main);

    li.appendChild(make('span', 'km-track__time', song.duration ? duration(song.duration) : ''));

    /* 播放键只给"能播的"：下架的条目点了也是白点，索性不给按钮 */
    if (song.missing) {
      li.appendChild(make('span', 'km-track__noplay', '不可播'));
    } else {
      var play = make('button', 'km-track__play');
      play.type = 'button';
      /* 属性名带 km- 前缀是有原因的：站点上的音乐盒（music.js）在整个 document 上
         监听 [data-play]，用它自己的曲库播放。用同名属性会被它抢走点击，
         结果就是"点了红心歌，响的却是本地 mp3"。 */
      play.setAttribute('data-km-play', String(song.id));
      play.setAttribute('aria-label', '播放《' + (song.name || '这首歌') + '》');
      play.appendChild(make('span', 'km-track__play-icon', '▶'));
      li.appendChild(play);
    }

    var link = make('a', 'km-track__link', '网易云');
    link.href = song.url || ('https://music.163.com/song?id=' + song.id);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.setAttribute('aria-label', (song.name || '这首') + ' —— 在网易云音乐打开');
    li.appendChild(link);

    return li;
  }

  function loadLiked(reset) {
    if (liked.loading) return;
    liked.loading = true;
    if (reset) {
      liked.offset = 0;
      clear(el.list);
    }
    text(el.listNote, reset ? '正在读取红心歌单…' : '正在读取更多…');
    if (el.more) el.more.disabled = true;

    api('/api/liked', { offset: liked.offset, limit: PAGE_SIZE }).then(function (r) {
      liked.loading = false;
      var d = r.data || {};
      if (!d.ok) {
        if (r.status === 401) { beginQrLogin(); return; }
        text(el.listNote, '读取失败：' + (d.message || d.error || '未知错误'));
        if (el.more) el.more.disabled = false;
        return;
      }
      liked.total = d.total || 0;
      liked.hasMore = Boolean(d.hasMore);
      (d.songs || []).forEach(function (song, i) {
        el.list.appendChild(songRow(song, i, liked.offset));
      });
      liked.offset += (d.songs || []).length;

      if (liked.offset === 0) text(el.listNote, '这个账号还没有红心歌曲。');
      else {
        text(el.listNote, '已显示 ' + liked.offset + ' / ' + liked.total + ' 首' +
          (liked.hasMore ? '，点下面的按钮继续。' : '，到底了。'));
      }
      if (el.more) {
        el.more.hidden = !liked.hasMore;
        el.more.disabled = false;
      }
    }).catch(function (err) {
      liked.loading = false;
      text(el.listNote, '读取失败：' + ((err && err.message) || '网络错误'));
      if (el.more) el.more.disabled = false;
    });
  }

  function loadAll() {
    api('/api/account').then(function (r) {
      var d = r.data || {};
      if (r.status === 401 || !d.ok) { beginQrLogin(); return; }
      renderProfile(d.profile, d.liked);
      setState('ready');
      loadLiked(true);
    }).catch(function () {
      setState('offline');
      text(el.serviceHint, '服务在跑，但读账号失败了。看看小服务那个窗口里有没有报错。');
      if (el.serviceHint) el.serviceHint.hidden = false;
    });
  }

  /* ---------------------------------------------------------------- 播放
     地址由小服务现取（网易的直链约 20 分钟过期，服务端有 12 分钟缓存）。
     音频本身直连网易 CDN —— 那边发 CORS 头，所以不用我们中转字节，
     也就不用让本机服务去扛整首歌的流量。 */
  var player = {
    audio: null,
    list: [],        /* 当前可播队列（按 DOM 里的顺序） */
    index: -1,
    currentId: null,
    loadingId: null,
  };

  function audio() {
    if (!player.audio) {
      var a = document.createElement('audio');
      a.preload = 'none';
      a.setAttribute('data-km-audio', '');
      /* 挂进文档（.km-player 里）。不必须也能播，但挂上去才能被看见/被调试，
         而且站点上已经有一个 <audio data-bgm>（音乐盒的），
         留一个明确的钩子省得以后自己人也选错元素。 */
      if (el.player) el.player.appendChild(a);
      a.volume = (el.playerVol ? Number(el.playerVol.value) : 80) / 100;
      a.addEventListener('play', paintPlayer);
      a.addEventListener('pause', paintPlayer);
      a.addEventListener('timeupdate', paintProgress);
      a.addEventListener('loadedmetadata', paintProgress);
      a.addEventListener('ended', function () { step(1); });
      a.addEventListener('error', function () {
        /* 两种可能：地址过期了，或者这首本来就放不出来。
           用的是"地址"而不是"版权"，因为从浏览器这边分不清是哪一种——
           猜错原因比不给原因更糟。 */
        if (player.currentId) setPlayerNote('取到的地址播不了（多半是已过期）—— 再点一次就会重新取。');
        paintPlayer();
      });
      player.audio = a;
    }
    return player.audio;
  }

  /* 队列 = 当前 DOM 里所有"有播放键"的行，按显示顺序 */
  function refreshQueue() {
    player.list = Array.prototype.slice.call(panel.querySelectorAll('[data-km-play]'))
      .map(function (btn) { return Number(btn.getAttribute('data-km-play')); });
  }

  function songMeta(id) {
    var row = panel.querySelector('.km-track[data-id="' + id + '"]');
    if (!row) return null;
    return {
      id: id,
      name: textOf(row.querySelector('.km-track__name')),
      artist: textOf(row.querySelector('.km-track__artist')),
      cover: (row.querySelector('.km-track__art-img') || {}).src || '',
    };
  }

  function textOf(node) { return node ? node.textContent : ''; }

  function setPlayerNote(msg) {
    text(el.playerSub, msg);
  }

  function paintProgress() {
    var a = player.audio;
    if (!a || !el.playerSeek) return;
    var dur = a.duration;
    if (document.activeElement !== el.playerSeek) {
      el.playerSeek.value = dur && isFinite(dur) ? String(Math.round((a.currentTime / dur) * 1000)) : '0';
    }
    text(el.playerClock, clock(a.currentTime) + ' / ' + clock(dur));
  }

  function clock(sec) {
    if (!sec || !isFinite(sec)) return '0:00';
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function paintPlayer() {
    var a = player.audio;
    var playing = Boolean(a && !a.paused && !a.ended);
    if (el.playerToggle) {
      text(el.playerToggle, playing ? '❚❚' : '▶');
      el.playerToggle.setAttribute('aria-label', playing ? '暂停' : '播放');
      el.playerToggle.classList.toggle('is-playing', playing);
    }
    /* 把正在播的那一行标出来，滚到哪儿都知道是哪首 */
    Array.prototype.forEach.call(panel.querySelectorAll('.km-track'), function (row) {
      var on = player.currentId != null && Number(row.getAttribute('data-id')) === player.currentId;
      row.classList.toggle('is-playing', on);
      var btn = row.querySelector('[data-km-play]');
      if (btn) {
        var icon = btn.querySelector('.km-track__play-icon');
        if (icon) text(icon, on && playing ? '❚❚' : '▶');
        btn.setAttribute('aria-label', (on && playing ? '暂停' : '播放') + '第 ' +
          (textOf(row.querySelector('.km-track__no')) || '') + ' 首');
      }
    });
  }

  function showPlayer(meta) {
    if (el.player) el.player.hidden = false;
    document.body.classList.add('has-km-player');
    if (meta) {
      text(el.playerName, meta.name || '—');
      text(el.playerSub, meta.artist || '');
      if (el.playerArt) {
        clear(el.playerArt);
        if (meta.cover) {
          var im = make('img', 'km-player__art-img');
          im.src = meta.cover;
          im.alt = '';
          el.playerArt.appendChild(im);
        }
      }
    }
  }

  function hidePlayer() {
    var a = player.audio;
    if (a) a.pause();
    player.currentId = null;
    if (el.player) el.player.hidden = true;
    document.body.classList.remove('has-km-player');
    paintPlayer();
  }

  function playId(id) {
    var meta = songMeta(id);
    if (!meta) return;
    var a = audio();

    /* 同一首：切换播放/暂停，不再重新取地址 */
    if (player.currentId === id && a.src) {
      if (a.paused) a.play().catch(function () { /* 浏览器拦了就等下一次点击 */ });
      else a.pause();
      return;
    }

    player.currentId = id;
    player.loadingId = id;
    refreshQueue();
    player.index = player.list.indexOf(id);
    showPlayer(meta);
    setPlayerNote('正在取播放地址…');
    paintPlayer();

    api('/api/song/url', { id: id }).then(function (r) {
      var d = r.data || {};
      if (player.currentId !== id) return;     /* 期间已经点了别的歌 */
      player.loadingId = null;
      if (!d.ok || !d.url) {
        setPlayerNote(d.message || '这首歌拿不到播放地址。');
        paintPlayer();
        return;
      }
      a.src = d.url;
      var label = meta.artist || '';
      if (d.trial) label += (label ? ' · ' : '') + '仅可试听片段';
      setPlayerNote(label);
      var p = a.play();
      if (p && p.catch) {
        p.catch(function () {
          setPlayerNote('浏览器挡住了自动播放，点一下播放键。');
          paintPlayer();
        });
      }
      paintPlayer();
    }).catch(function (err) {
      player.loadingId = null;
      setPlayerNote('取播放地址失败：' + ((err && err.message) || '网络错误'));
      paintPlayer();
    });
  }

  function step(delta) {
    if (!player.list.length) return;
    var at = player.list.indexOf(player.currentId);
    if (at === -1) at = delta > 0 ? -1 : 0;
    var next = at + delta;
    if (next < 0) next = player.list.length - 1;
    if (next >= player.list.length) next = 0;
    playId(player.list[next]);
  }

  function bindPlayer() {
    if (!el.player) return;

    panel.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('[data-km-play]');
      if (btn) { playId(Number(btn.getAttribute('data-km-play'))); }
    });

    if (el.playerToggle) el.playerToggle.addEventListener('click', function () {
      var a = player.audio;
      if (!a || !a.src) return;
      if (a.paused) a.play().catch(function () { /* 同上 */ });
      else a.pause();
    });
    if (el.playerPrev) el.playerPrev.addEventListener('click', function () { step(-1); });
    if (el.playerNext) el.playerNext.addEventListener('click', function () { step(1); });
    if (el.playerClose) el.playerClose.addEventListener('click', hidePlayer);

    if (el.playerSeek) {
      el.playerSeek.addEventListener('input', function (e) {
        var a = player.audio;
        if (!a || !a.duration || !isFinite(a.duration)) return;
        a.currentTime = (Number(e.target.value) / 1000) * a.duration;
        paintProgress();
      });
    }
    if (el.playerVol) {
      el.playerVol.addEventListener('input', function (e) {
        var a = audio();
        a.volume = Math.min(1, Math.max(0, Number(e.target.value) / 100));
      });
    }

    /* 空格播放/暂停；左右切歌。别抢输入框的键。 */
    document.addEventListener('keydown', function (e) {
      if (!el.player || el.player.hidden) return;
      var tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        if (el.playerToggle) el.playerToggle.click();
      } else if (e.key === 'ArrowRight' && e.altKey) { e.preventDefault(); step(1); }
      else if (e.key === 'ArrowLeft' && e.altKey) { e.preventDefault(); step(-1); }
    });
  }

  /* ---------------------------------------------------------------- 启动 */

  function boot() {
    setState('loading');
    api('/api/health').then(function (r) {
      if (!r.data || !r.data.ok) throw new Error('服务返回异常');
      if (el.serviceHint) el.serviceHint.hidden = true;
      if (r.data.loggedIn) {
        /* health 里已经带了账号，先渲染出来，别让页面等一拍才说话 */
        renderProfile(r.data.profile, null);
        setState('ready');
        loadAll();
      } else {
        beginQrLogin();
      }
    }).catch(function () {
      setState('offline');
      text(el.serviceHint, '连不上本机的云村小服务（' + SERVICE + '）。先运行：node tools/ncm-server.mjs');
      if (el.serviceHint) el.serviceHint.hidden = false;
    });
  }

  if (el.qrRefresh) el.qrRefresh.addEventListener('click', beginQrLogin);
  if (el.more) el.more.addEventListener('click', function () { loadLiked(false); });
  if (el.logout) {
    el.logout.addEventListener('click', function () {
      el.logout.disabled = true;
      api('/api/logout').catch(function () { /* 本地清掉就够了 */ }).then(function () {
        el.logout.disabled = false;
        clear(el.list);
        liked = { offset: 0, total: 0, hasMore: false, loading: false };
        if (el.likedCover) el.likedCover.hidden = true;
        if (el.likedMeta) clear(el.likedMeta);
        text(el.listNote, '');
        if (el.more) el.more.hidden = true;
        beginQrLogin();
      });
    });
  }

  bindPlayer();
  boot();
})();

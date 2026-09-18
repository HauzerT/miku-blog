/* ==========================================================================
   composables/useKumura.ts · 云村那一页的行为
   ---------------------------------------------------------------------------
   扫码登录 → 账号信息 → 我创建的歌单 → 每日推荐 → 红心歌单，
   以及这一页自己的播放条。

   形状上和 useRoll.ts 是同一路数——「页面把容器交进来，行为在里面干活」，
   而不是把数据摊成响应式状态让 Vue 重画。原因很实在：这一页的标记是对着
   assets/css/kumura.css 写死的，包括那些空 span、解释过的列位、data-* 钩子；
   Vue 重画一遍只会把这些细节磨掉。所以 pages/kumura.vue 只吐静态 HTML，
   一切运行时的事都在这里。

   两样东西是**复用**而不是抄：
     · assets/js/music.config.js → window.CV01_MUSIC（服务地址、页大小、轮询间隔、超时）
     · assets/js/qr.js           → window.CV01QR（二维码在本地画成 SVG，不经第三方图片服务）
   它们由页面 useHead 当普通 script 挂上，这里轮询等它们的 global 出现。

   取数全部走本机小服务（tools/ncm-server.mjs，默认 http://127.0.0.1:3170），
   不碰本站的 /api。浏览器这边一个字节的凭证都不存——凭证只在小服务的
   .ncm-session.json 里，那是本机文件。

   状态名就是 kumura.css 认的那几个：loading / offline / login / ready；
   登录还有三个子状态 login-loading / login-error / login-expired。
   ========================================================================== */

/* 小服务回的那几个形状（见 tools/ncm-server.mjs 的 slimSong / slimProfile） */
type Song = {
  id: number;
  name?: string;
  artist?: string;
  album?: string;
  cover?: string;
  duration?: number;
  mvId?: number;
  missing?: boolean;
  url?: string;
  likedAt?: number;
};

type Profile = {
  uid?: number;
  nickname?: string;
  avatar?: string;
  signature?: string;
  background?: string;
  level?: number | null;
  listenSongs?: number | null;
  follows?: number | null;
  followers?: number | null;
  playlists?: number | null;
  createDays?: number | null;
  vip?: { label?: string } | null;
};

type LikedInfo = {
  name?: string;
  trackCount?: number;
  cover?: string;
  updateTime?: number;
};

type Playlist = {
  id: number;
  name?: string;
  trackCount?: number;
  cover?: string;
  url?: string;
};

/* assets/js/music.config.js 摊在 window 上的东西 */
type MusicConfig = {
  service?: string;
  pageSize?: number;
  pollInterval?: number;
  qrTtl?: number;
  timeout?: number;
};

type QrModule = {
  encode: (text: string) => unknown;
  toSvg: (qr: unknown, opts?: { dark?: string; light?: string }) => string;
};

type KumuraGlobals = {
  CV01_MUSIC?: MusicConfig;
  CV01QR?: QrModule;
  CV01_PALETTE?: { fixed?: { qr?: { ink?: string; face?: string } } };
};

const G = () =>
  (typeof window === 'undefined' ? {} : (window as unknown as KumuraGlobals));

/* 页面 <head> 里那两个 classic script 什么时候跑完不由 Vue 决定，这里轮着看一眼。
   上限之内等不到也照常往下走：配置没了还有兜底值（与 music.config.js 里的一致），
   二维码没了 renderQr 会说「二维码模块没加载上」——绝不能因为一个脚本没到，
   页面就永远停在「正在连接」。 */
const SCRIPT_WAIT = 4000;

const waitForGlobal = (read: () => unknown) =>
  new Promise<void>((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (read() || Date.now() - started > SCRIPT_WAIT) return resolve();
      setTimeout(tick, 40);
    };
    tick();
  });

export const useKumura = (root: Ref<HTMLElement | null>) => {
  /* 容器（页面上是 [data-music]）。所有节点都在它里面找，页面之外的东西一概不碰。 */
  let panel: HTMLElement | null = null;
  /* 组件卸载之后，晚到的回调不许再去碰已经不在文档里的节点 */
  let alive = true;

  /* 可调项。这里的初值就是 music.config.js 里的兜底值——那个文件没加载上也能跑 */
  let SERVICE = 'http://127.0.0.1:3170';
  let PAGE_SIZE = 50;
  let POLL_MS = 2000;
  let QR_TTL = 180 * 1000;
  let API_TIMEOUT = 8000;

  let el: Record<string, HTMLElement | null> = {};

  let liked = { offset: 0, total: 0, hasMore: false, loading: false };
  let shelf = { loading: false };
  let daily = { loading: false };
  const qrState = {
    key: '',
    deadline: 0,
    pollTimer: null as ReturnType<typeof setTimeout> | null,
    ticker: null as ReturnType<typeof setInterval> | null,
    refreshTimer: null as ReturnType<typeof setTimeout> | null,
    polling: false,
    expired: false,
  };

  /* 站长那两下（口令 + 带口令的写请求）在 setup 里取一次。
     useStudio 里用了 useState，事件回调里现取会碰「没有 Nuxt 实例」那颗雷。 */
  const studio = useStudio();

  /* ------------------------------------------------------------ 取节点 */

  const q = (sel: string) => (panel ? (panel.querySelector(sel) as HTMLElement | null) : null);

  /* 一次把要用的钩子抓齐。抓不到的留 null，后面每处都当「没有那个节点」处理——
     旧脚本也是这么宽容的（查不到就跳过，不抛）。 */
  const bindElements = () => {
    el = {
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
      playlists: q('[data-playlists]'),
      playlistsNote: q('[data-playlists-note]'),
      dailyList: q('[data-daily-list]'),
      dailyNote: q('[data-daily-note]'),
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
      /* 公开快照那一版（访客看的） */
      pubAt: q('[data-pub-at]'),
      pubHint: q('[data-pub-hint]'),
      pubAvatar: q('[data-pub-avatar]'),
      pubName: q('[data-pub-name]'),
      pubVip: q('[data-pub-vip]'),
      pubSign: q('[data-pub-sign]'),
      pubFacts: q('[data-pub-facts]'),
      pubPlaylists: q('[data-pub-playlists]'),
      pubPlaylistsNote: q('[data-pub-playlists-note]'),
      pubLikedCover: q('[data-pub-liked-cover]'),
      pubLikedMeta: q('[data-pub-liked-meta]'),
      pubLikedNote: q('[data-pub-liked-note]'),
      pubTracks: q('[data-pub-tracks]'),
      pubBox: q('[data-pub-box]'),
      pubBoxNote: q('[data-pub-box-note]'),
      pubAudio: q('[data-pub-audio]'),
      publish: q('[data-publish]'),
      publishNote: q('[data-publish-note]'),
    };
  };

  const setState = (name: string) => {
    if (panel) panel.setAttribute('data-music-state', name);
  };

  /* -------------------------------------------------------------- 小工具 */

  const text = (node: HTMLElement | null | undefined, value: unknown) => {
    if (node) node.textContent = value == null ? '' : String(value);
  };

  const clear = (node: HTMLElement | null | undefined) => {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  };

  const make = (tag: string, className?: string, content?: string) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content != null) node.textContent = content;
    return node;
  };

  const duration = (ms?: number) => {
    if (!ms || ms < 0) return '--:--';
    const total = Math.round(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  };

  const compact = (n?: number | null) => {
    if (n == null) return '—';
    if (n < 10000) return String(n);
    return (n / 10000).toFixed(n < 100000 ? 1 : 0) + ' 万';
  };

  const dateOnly = (ts?: number) => {
    if (!ts) return '';
    const d = new Date(ts);
    return (
      d.getFullYear() +
      '.' +
      String(d.getMonth() + 1).padStart(2, '0') +
      '.' +
      String(d.getDate()).padStart(2, '0')
    );
  };

  /* ---------------------------------------------------------------- 请求 */

  /* 每个请求都设个上限。指向一个没人监听的端口时，浏览器第一次连接可能迟迟不报错，
     没有这个超时页面就会一直停在「正在连接」——那是最糟的一种失败方式。 */
  const api = (path: string, params?: Record<string, string | number>) => {
    let url = SERVICE + path;
    if (params) {
      const qs = Object.keys(params)
        .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(String(params[k])))
        .join('&');
      if (qs) url += '?' + qs;
    }
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), API_TIMEOUT) : null;

    return fetch(url, { credentials: 'include', signal: ctrl ? ctrl.signal : undefined })
      .then((res) =>
        res
          .json()
          .catch(() => null)
          .then((data) => {
            /* 端口上有别的东西在应答（不是小服务）时会是 404 + HTML：
               这种情况不能当成「服务在」，否则页面会卡在「正在连接」。 */
            if (!data) throw new Error('HTTP ' + res.status);
            return { status: res.status, data };
          })
      )
      .then(
        (r) => {
          if (timer) clearTimeout(timer);
          return r;
        },
        (err) => {
          if (timer) clearTimeout(timer);
          throw err;
        }
      );
  };

  /* 封面图走小服务代理：网易的图不允许直接跨域读像素 */
  const img = (url?: string, size?: number) => {
    if (!url) return '';
    const u =
      size != null
        ? url + (url.indexOf('?') === -1 ? '?' : '&') + 'param=' + size + 'y' + size
        : url;
    return SERVICE + '/api/img?url=' + encodeURIComponent(u);
  };

  /* -------------------------------------------------------- 二维码与轮询 */

  const stopQrWork = () => {
    if (qrState.pollTimer) {
      clearTimeout(qrState.pollTimer);
      qrState.pollTimer = null;
    }
    if (qrState.ticker) {
      clearInterval(qrState.ticker);
      qrState.ticker = null;
    }
    if (qrState.refreshTimer) {
      clearTimeout(qrState.refreshTimer);
      qrState.refreshTimer = null;
    }
    qrState.polling = false;
  };

  const renderQr = (url: string) => {
    const box = el.qrBox;
    if (!box) return;
    clear(box);
    const qr = G().CV01QR;
    if (!qr) {
      box.appendChild(make('p', 'km-login__fallback', '二维码模块没加载上，刷新一下。'));
      return;
    }
    try {
      const code = qr.encode(url);
      const wrap = make('div', 'km-login__code');
      /* 二维码的墨色来自配色文件（--qr-ink），不跟主题走：白底黑块是功能不是风格。
         qr.js 自己有兜底默认值，取不到就交给它。 */
      const ink = G().CV01_PALETTE?.fixed?.qr || {};
      wrap.innerHTML = qr.toSvg(code, { dark: ink.ink, light: ink.face });
      box.appendChild(wrap);
    } catch {
      box.appendChild(make('p', 'km-login__fallback', '二维码生成失败，刷新重试。'));
    }
  };

  const startCountdown = () => {
    qrState.deadline = Date.now() + QR_TTL;
    if (qrState.ticker) clearInterval(qrState.ticker);
    qrState.ticker = setInterval(() => {
      const left = Math.max(0, Math.round((qrState.deadline - Date.now()) / 1000));
      text(el.qrTimer, left + ' 秒后过期');
      if (left <= 0) expireQr('超时');
    }, 500);
  };

  /* 过期只有一种正确的处理方式：**自己换一张**。
     之前是停下来等用户点「换一张」—— 实测这会把整件事拖死：
     二维码有效期比人慢悠悠掏手机的时间短，等扫的时候它已经作废了，
     而页面上只是小字变了一下，没人会注意到。
     现在改成：一过期就立刻自动换新，同时把状态说清楚。 */
  const expireQr = (reason: string) => {
    if (qrState.expired) return;
    qrState.expired = true;
    stopQrWork();
    setState('login-expired');
    text(
      el.qrStatus,
      reason === '已扫码但确认超时'
        ? '手机上确认得太久，二维码已作废 —— 正在换一张新的。'
        : '二维码已作废 —— 正在自动换一张新的。'
    );
    scheduleQrRefresh();
  };

  /* 自动换新留一秒，让用户看清「为什么变了」，而不是二维码无声无息地换掉 */
  const scheduleQrRefresh = () => {
    if (qrState.refreshTimer) clearTimeout(qrState.refreshTimer);
    qrState.refreshTimer = setTimeout(() => {
      qrState.refreshTimer = null;
      beginQrLogin();
    }, 1000);
  };

  const schedulePoll = (delay?: number) => {
    if (qrState.pollTimer) clearTimeout(qrState.pollTimer);
    qrState.pollTimer = setTimeout(pollOnce, delay == null ? POLL_MS : delay);
  };

  const pollOnce = () => {
    if (!qrState.key) return;
    if (qrState.polling) return schedulePoll();
    qrState.polling = true;
    qrState.pollTimer = null;

    api('/api/login/qr/check', { key: qrState.key })
      .then((r) => {
        qrState.polling = false;
        const d = r.data || {};
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
      })
      .catch(() => {
        qrState.polling = false;
        text(el.qrStatus, '轮询失败，正在重试…');
        schedulePoll(POLL_MS * 2);
      });
  };

  const beginQrLogin = () => {
    stopQrWork();
    qrState.expired = false;
    qrState.key = '';
    clear(el.qrBox);
    setState('login-loading');
    text(el.qrStatus, '正在生成二维码…');
    text(el.qrTimer, '');

    api('/api/login/qr/key')
      .then((r) => {
        if (!r.data || !r.data.key) {
          throw new Error((r.data && (r.data.message || r.data.error)) || '拿不到 key');
        }
        qrState.key = r.data.key;
        return api('/api/login/qr/create', { key: qrState.key });
      })
      .then((r) => {
        if (!r.data || !r.data.qrurl) throw new Error('拿不到二维码内容');
        renderQr(r.data.qrurl);
        setState('login');
        text(el.qrStatus, '打开网易云音乐 App → 左上角「扫一扫」。');
        startCountdown();
        schedulePoll(POLL_MS);
      })
      .catch((err) => {
        setState('login-error');
        text(el.qrStatus, '二维码没出来：' + ((err && err.message) || '未知错误'));
      });
  };

  /* ------------------------------------------------------------ 账号信息 */

  const renderProfile = (profile: Profile | null, likedInfo: LikedInfo | null) => {
    if (!profile) return;

    if (el.avatar) {
      clear(el.avatar);
      if (profile.avatar) {
        const av = make('img', 'km-profile__avatar-img') as HTMLImageElement;
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
      const rows: Array<[string, string | null]> = [
        ['等级', profile.level != null ? 'Lv.' + profile.level : null],
        ['听歌', profile.listenSongs != null ? compact(profile.listenSongs) + ' 首' : null],
        ['关注', profile.follows != null ? compact(profile.follows) : null],
        ['粉丝', profile.followers != null ? compact(profile.followers) : null],
        ['歌单', profile.playlists != null ? compact(profile.playlists) + ' 个' : null],
        [
          '云村年龄',
          profile.createDays != null ? Math.floor(profile.createDays / 365) + ' 年' : null,
        ],
      ];
      rows.forEach((row) => {
        if (row[1] == null) return;
        const li = make('li', 'km-facts__row');
        li.appendChild(make('span', 'km-facts__key', row[0]));
        li.appendChild(make('span', 'km-facts__val', row[1]));
        el.facts!.appendChild(li);
      });
      el.facts.hidden = el.facts.children.length === 0;
    }

    /* 红心歌单的头 */
    if (el.likedCover) {
      clear(el.likedCover);
      if (likedInfo && likedInfo.cover) {
        const cover = make('img', 'km-liked__cover-img') as HTMLImageElement;
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
          el.likedMeta.appendChild(
            make('span', 'km-liked__count', likedInfo.trackCount + ' 首')
          );
        }
        if (likedInfo.updateTime) {
          el.likedMeta.appendChild(make('span', 'km-liked__dot', '·'));
          el.likedMeta.appendChild(
            make('span', 'km-liked__upd', '最近更新 ' + dateOnly(likedInfo.updateTime))
          );
        }
      } else {
        el.likedMeta.appendChild(make('span', 'km-liked__name', '我喜欢的音乐'));
      }
    }
  };

  /* ------------------------------------------------------------ 曲目列表 */

  const songRow = (song: Song, index: number, offset: number) => {
    const li = make('li', 'km-track');
    li.setAttribute('data-id', String(song.id));

    li.appendChild(
      make('span', 'km-track__no', String(offset + index + 1).padStart(2, '0'))
    );

    const art = make('span', 'km-track__art');
    if (song.cover) {
      const im = make('img', 'km-track__art-img') as HTMLImageElement;
      im.src = img(song.cover, 100);
      im.alt = '';
      im.loading = 'lazy';
      art.appendChild(im);
    }
    li.appendChild(art);

    const main = make('span', 'km-track__main');
    const title = make('span', 'km-track__name', song.missing ? '（已下架或不可用）' : song.name);
    if (song.mvId) title.appendChild(make('span', 'km-track__mv', 'MV'));
    main.appendChild(title);
    main.appendChild(
      make(
        'span',
        'km-track__artist',
        song.missing
          ? '歌曲 id ' + song.id
          : (song.artist || '') + (song.album ? ' · ' + song.album : '')
      )
    );
    li.appendChild(main);

    /* 加入时间这一列只有红心歌单的行有值；每日推荐的行留一个空 span
       撑住网格列位，不然后面的格子会集体左移。悬停说明写清它是哪一刻，
       省得被当成发行日期。 */
    const at = make('span', 'km-track__at', song.likedAt ? dateOnly(song.likedAt) : '');
    if (song.likedAt) at.title = '加入红心歌单的时间';
    li.appendChild(at);

    li.appendChild(make('span', 'km-track__time', song.duration ? duration(song.duration) : ''));

    /* 播放键只给「能播的」：下架的条目点了也是白点，索性不给按钮 */
    if (song.missing) {
      li.appendChild(make('span', 'km-track__noplay', '不可播'));
    } else {
      const play = make('button', 'km-track__play') as HTMLButtonElement;
      play.type = 'button';
      /* 属性名带 km- 前缀是有原因的：站点上的音乐盒（music.js）在整个 document 上
         监听 [data-play]，用它自己的曲库播放。用同名属性会被它抢走点击，
         结果就是「点了红心歌，响的却是本地 mp3」。 */
      play.setAttribute('data-km-play', String(song.id));
      play.setAttribute('aria-label', '播放《' + (song.name || '这首歌') + '》');
      play.appendChild(make('span', 'km-track__play-icon', '▶'));
      li.appendChild(play);
    }

    const link = make('a', 'km-track__link', '网易云') as HTMLAnchorElement;
    link.href = song.url || 'https://music.163.com/song?id=' + song.id;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.setAttribute('aria-label', (song.name || '这首') + ' —— 在网易云音乐打开');
    li.appendChild(link);

    return li;
  };

  /* ------------------------------------------------------------ 歌单架
     「我创建的歌单」：封面就是网易回传的那张（经 /api/img 代理），
     所以页面上永远和网易云长着同一张脸。整卡可点，落到网易云的歌单页。 */

  const playlistCard = (p: Playlist) => {
    const li = make('li', 'km-shelf__item');
    const card = make('a', 'km-shelf__card') as HTMLAnchorElement;
    card.href = p.url || 'https://music.163.com/playlist?id=' + p.id;
    card.target = '_blank';
    card.rel = 'noopener noreferrer';
    card.setAttribute('aria-label', (p.name || '歌单') + '（在网易云音乐打开）');

    const cover = make('span', 'km-shelf__cover');
    if (p.cover) {
      const im = make('img', 'km-shelf__cover-img') as HTMLImageElement;
      im.src = img(p.cover, 300);
      im.alt = '';
      im.loading = 'lazy';
      cover.appendChild(im);
    }
    card.appendChild(cover);
    card.appendChild(make('span', 'km-shelf__name', p.name || '未命名歌单'));
    card.appendChild(
      make('span', 'km-shelf__count', p.trackCount != null ? compact(p.trackCount) + ' 首' : '')
    );
    li.appendChild(card);
    return li;
  };

  const loadShelf = () => {
    if (!el.playlists || shelf.loading) return;
    shelf.loading = true;
    text(el.playlistsNote, '正在读取歌单…');
    api('/api/playlists')
      .then((r) => {
        shelf.loading = false;
        const d = r.data || {};
        if (!d.ok) {
          if (r.status === 401) {
            beginQrLogin();
            return;
          }
          text(el.playlistsNote, '读取失败：' + (d.message || d.error || '未知错误'));
          return;
        }
        const ps: Playlist[] = d.playlists || [];
        clear(el.playlists);
        ps.forEach((p) => el.playlists!.appendChild(playlistCard(p)));
        text(
          el.playlistsNote,
          ps.length ? '共 ' + ps.length + ' 个 · 封面与网易云同步' : '还没有创建过歌单。'
        );
      })
      .catch((err) => {
        shelf.loading = false;
        text(el.playlistsNote, '读取失败：' + ((err && err.message) || '网络错误'));
      });
  };

  /* ---------------------------------------------------------- 每日推荐
     网易按口味每天生成的那一小摞。和红心歌单共用同一套曲目行，
     所以点歌、播放器、上一首/下一首都不用另写一份。 */

  const loadDaily = () => {
    if (!el.dailyList || daily.loading) return;
    daily.loading = true;
    text(el.dailyNote, '正在读取今日推荐…');
    api('/api/daily')
      .then((r) => {
        daily.loading = false;
        const d = r.data || {};
        if (!d.ok) {
          if (r.status === 401) {
            beginQrLogin();
            return;
          }
          text(el.dailyNote, '读取失败：' + (d.message || d.error || '未知错误'));
          return;
        }
        const songs: Song[] = d.songs || [];
        clear(el.dailyList);
        songs.forEach((song, i) => {
          el.dailyList!.appendChild(songRow(song, i, 0));
        });
        text(
          el.dailyNote,
          songs.length ? '根据你的音乐口味生成 · 每天 6:00 更新' : '今天没有拿到推荐，明天再来看看。'
        );
      })
      .catch((err) => {
        daily.loading = false;
        text(el.dailyNote, '读取失败：' + ((err && err.message) || '网络错误'));
      });
  };

  const loadLiked = (reset?: boolean) => {
    if (liked.loading) return;
    liked.loading = true;
    if (reset) {
      liked.offset = 0;
      clear(el.list);
    }
    text(el.listNote, reset ? '正在读取红心歌单…' : '正在读取更多…');
    if (el.more) (el.more as HTMLButtonElement).disabled = true;

    api('/api/liked', { offset: liked.offset, limit: PAGE_SIZE })
      .then((r) => {
        liked.loading = false;
        const d = r.data || {};
        if (!d.ok) {
          if (r.status === 401) {
            beginQrLogin();
            return;
          }
          text(el.listNote, '读取失败：' + (d.message || d.error || '未知错误'));
          if (el.more) (el.more as HTMLButtonElement).disabled = false;
          return;
        }
        liked.total = d.total || 0;
        liked.hasMore = Boolean(d.hasMore);

        /* 服务端确实按加入时间排了序，才把这句话挂到歌单头上——
           拿不到时间戳的兜底顺序不能瞎标。 */
        if (d.orderBy === 'added-desc' && el.likedMeta && !el.likedMeta.querySelector('.km-liked__sort')) {
          const chip = make('span', 'km-liked__sort', '按加入时间 · 最新在前');
          const dot = make('span', 'km-liked__dot', '·');
          const upd = el.likedMeta.querySelector('.km-liked__upd');
          if (upd) {
            el.likedMeta.insertBefore(dot, upd);
            el.likedMeta.insertBefore(chip, upd);
          } else {
            el.likedMeta.appendChild(dot);
            el.likedMeta.appendChild(chip);
          }
        }
        const songs: Song[] = d.songs || [];
        songs.forEach((song, i) => {
          el.list!.appendChild(songRow(song, i, liked.offset));
        });
        liked.offset += songs.length;

        if (liked.offset === 0) text(el.listNote, '这个账号还没有红心歌曲。');
        else {
          text(
            el.listNote,
            '已显示 ' +
              liked.offset +
              ' / ' +
              liked.total +
              ' 首' +
              (liked.hasMore ? '，点下面的按钮继续。' : '，到底了。')
          );
        }
        if (el.more) {
          el.more.hidden = !liked.hasMore;
          (el.more as HTMLButtonElement).disabled = false;
        }
      })
      .catch((err) => {
        liked.loading = false;
        text(el.listNote, '读取失败：' + ((err && err.message) || '网络错误'));
        if (el.more) (el.more as HTMLButtonElement).disabled = false;
      });
  };

  const loadAll = () => {
    api('/api/account')
      .then((r) => {
        const d = r.data || {};
        if (r.status === 401 || !d.ok) {
          beginQrLogin();
          return;
        }
        renderProfile(d.profile, d.liked);
        setState('ready');
        loadShelf();
        loadDaily();
        loadLiked(true);
      })
      .catch(() => {
        setState('offline');
        text(el.serviceHint, '服务在跑，但读账号失败了。看看小服务那个窗口里有没有报错。');
        if (el.serviceHint) el.serviceHint.hidden = false;
      });
  };

  /* ------------------------------------------------ 公开快照（访客那一版）
     访客的浏览器连不上本机的 127.0.0.1:3170 —— 那个地址指的是**他自己那台电脑**，
     所以小服务探不到的时候，不该只丢一句「没在跑」就完事。这一版读站点自己的
     GET /api/kumura：站长按「发布到公网」时脱敏并落盘的那一份快照
     （白名单见 server/lib/kumura-snapshot.mjs）。

     快照里**没有播放地址**——那是唯一会碰到「账号签名直链」的地方，故意不给。
     所以这一版只「看」；想听就往下走音乐盒：站上自己的曲子本来对访客就是公开的，
     与网易账号一点关系都没有。 */

  const pubFact = (key: string, value: string) => {
    const li = make('li', 'km-facts__row');
    li.appendChild(make('span', 'km-facts__key', key));
    li.appendChild(make('span', 'km-facts__val', value));
    return li;
  };

  const renderPublicProfile = (profile: any) => {
    if (el.pubAvatar) {
      clear(el.pubAvatar);
      if (profile.avatar) {
        const im = make('img', 'km-profile__avatar-img') as HTMLImageElement;
        /* 快照里的封面在发布时就下到 media/kumura/ 了，站内地址直接用，不走代理 */
        im.src = profile.avatar;
        im.alt = '';
        el.pubAvatar.appendChild(im);
      }
    }
    text(el.pubName, profile.nickname || '（没写昵称）');
    if (el.pubVip) {
      el.pubVip.hidden = !profile.vip;
      text(el.pubVip, profile.vip || '');
    }
    text(el.pubSign, profile.signature || '');
    if (el.pubFacts) {
      clear(el.pubFacts);
      const rows: Array<[string, string]> = [];
      if (profile.level != null) rows.push(['等级', 'Lv.' + profile.level]);
      if (profile.listenSongs != null) rows.push(['听歌', compact(profile.listenSongs) + ' 首']);
      if (profile.follows != null) rows.push(['关注', compact(profile.follows)]);
      if (profile.followers != null) rows.push(['粉丝', compact(profile.followers)]);
      if (profile.createDays != null) rows.push(['村龄', Math.floor(profile.createDays / 365) + ' 年']);
      for (const row of rows) el.pubFacts.appendChild(pubFact(row[0], row[1]));
      el.pubFacts.hidden = rows.length === 0;
    }
  };

  const renderPublicPlaylists = (list: any[]) => {
    if (!el.pubPlaylists) return;
    clear(el.pubPlaylists);
    for (const p of list) {
      const li = make('li', 'km-shelf__item');
      const card = make('a', 'km-shelf__card') as HTMLAnchorElement;
      card.href = p.url || 'https://music.163.com/playlist?id=' + p.id;
      card.target = '_blank';
      card.rel = 'noopener noreferrer';
      card.setAttribute('aria-label', (p.name || '歌单') + '（在网易云音乐打开）');
      const cover = make('span', 'km-shelf__cover');
      if (p.cover) {
        const im = make('img', 'km-shelf__cover-img') as HTMLImageElement;
        im.src = p.cover;
        im.alt = '';
        im.loading = 'lazy';
        cover.appendChild(im);
      }
      card.appendChild(cover);
      card.appendChild(make('span', 'km-shelf__name', p.name || '未命名歌单'));
      card.appendChild(make('span', 'km-shelf__count', (p.trackCount || 0) + ' 首'));
      li.appendChild(card);
      el.pubPlaylists.appendChild(li);
    }
    text(el.pubPlaylistsNote, list.length ? '' : '快照里没有歌单。');
  };

  /* 快照里的曲目行：序号 / 曲名歌手 / 外链。
     与站长那一版共用 .km-track 那套格子（7 列），所以空位照样占着——
     少一个 span 后面的格子会集体左移（见 km-track 的注释）。 */
  const publicTrackRow = (song: any, index: number) => {
    const li = make('li', 'km-track');
    li.appendChild(make('span', 'km-track__no', String(index + 1).padStart(2, '0')));
    li.appendChild(make('span', 'km-track__art'));
    const main = make('span', 'km-track__main');
    main.appendChild(make('span', 'km-track__name', song.name || '（这首查不到了）'));
    main.appendChild(
      make('span', 'km-track__artist', (song.artist || '') + (song.album ? ' · ' + song.album : ''))
    );
    li.appendChild(main);
    li.appendChild(make('span', 'km-track__at', ''));
    li.appendChild(make('span', 'km-track__time', ''));
    const link = make('a', 'km-track__link', '网易云') as HTMLAnchorElement;
    link.href = song.url || 'https://music.163.com/song?id=' + song.id;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.setAttribute('aria-label', (song.name || '这首') + ' —— 在网易云音乐打开');
    li.appendChild(link);
    return li;
  };

  const renderPublicLiked = (liked: any) => {
    if (el.pubLikedCover) {
      clear(el.pubLikedCover);
      if (liked.cover) {
        const im = make('img', 'km-liked__cover-img') as HTMLImageElement;
        im.src = liked.cover;
        im.alt = '';
        im.loading = 'lazy';
        el.pubLikedCover.appendChild(im);
        el.pubLikedCover.hidden = false;
      } else {
        el.pubLikedCover.hidden = true;
      }
    }
    if (el.pubLikedMeta) {
      clear(el.pubLikedMeta);
      el.pubLikedMeta.appendChild(make('span', 'km-liked__name', liked.name || '我喜欢的音乐'));
      el.pubLikedMeta.appendChild(make('span', 'km-liked__dot', '·'));
      el.pubLikedMeta.appendChild(
        make('span', 'km-liked__count', (liked.trackCount || 0) + ' 首')
      );
    }
    const tracks = Array.isArray(liked.tracks) ? liked.tracks : [];
    text(
      el.pubLikedNote,
      liked.capped
        ? '快照只收最近加入的前 ' + tracks.length + ' 首（共 ' + liked.trackCount + ' 首），完整的在网易云那边。'
        : ''
    );
    if (!el.pubTracks) return;
    clear(el.pubTracks);
    tracks.forEach((song: any, i: number) => {
      if (el.pubTracks) el.pubTracks.appendChild(publicTrackRow(song, i));
    });
  };

  /* ------------------------------------------------------------ 音乐盒
     访客能「听」的就是这一份：站上自己的 mp3（/media/music/，本来就公开）。
     与网易账号无关，所以没有风控这回事，也不用站点服务端中转字节。 */
  const box = { audio: null as HTMLAudioElement | null, current: '', bound: false };

  const paintBox = () => {
    if (!el.pubBox) return;
    for (const node of Array.from(el.pubBox.querySelectorAll('[data-pub-play]'))) {
      const btn = node as HTMLButtonElement;
      const playing = Boolean(box.audio && !box.audio.paused && box.current === btn.getAttribute('data-pub-play'));
      btn.setAttribute('aria-pressed', playing ? 'true' : 'false');
      const icon = btn.querySelector('.km-track__play-icon');
      if (icon) icon.textContent = playing ? '❚❚' : '▶';
    }
  };

  const playBox = (track: any) => {
    const a = box.audio;
    if (!a || !track || !track.url) return;
    if (box.current === track.url) {
      if (a.paused) a.play().catch(() => {});
      else a.pause();
      paintBox();
      return;
    }
    box.current = track.url;
    a.src = track.url;
    a.play().catch(() => {
      /* 与音乐盒同一条：浏览器不许没交互就出声，再点一下就好 */
      text(el.pubBoxNote, '浏览器不许没交互就出声——再点一下那颗键。');
    });
    paintBox();
  };

  const renderMusicBox = (data: any) => {
    const tracks = (data && Array.isArray(data.tracks) ? data.tracks : []).filter(
      (t: any) => t && t.url
    );
    if (!el.pubBox) return;
    clear(el.pubBox);
    if (!tracks.length) {
      text(el.pubBoxNote, '站上还没有自己的曲子（站长在音乐盒里上传）。');
      return;
    }
    tracks.forEach((t: any, i: number) => {
      const li = make('li', 'km-track');
      li.appendChild(make('span', 'km-track__no', String(i + 1).padStart(2, '0')));
      li.appendChild(make('span', 'km-track__art'));
      const main = make('span', 'km-track__main');
      main.appendChild(make('span', 'km-track__name', t.title || '未命名'));
      main.appendChild(make('span', 'km-track__artist', t.artist || '本站曲库'));
      li.appendChild(main);
      li.appendChild(make('span', 'km-track__at', ''));
      li.appendChild(make('span', 'km-track__time', ''));
      const play = make('button', 'km-track__play') as HTMLButtonElement;
      play.type = 'button';
      play.setAttribute('data-pub-play', t.url);
      play.setAttribute('aria-pressed', 'false');
      play.setAttribute('aria-label', '播放《' + (t.title || '这首') + '》');
      play.appendChild(make('span', 'km-track__play-icon', '▶'));
      play.addEventListener('click', () => playBox(t));
      li.appendChild(play);
      if (el.pubBox) el.pubBox.appendChild(li);
    });
  };

  const loadMusicBox = () => {
    if (!el.pubBox || !el.pubAudio) return;
    if (!box.bound) {
      const a = el.pubAudio as HTMLAudioElement;
      a.addEventListener('play', paintBox);
      a.addEventListener('pause', paintBox);
      a.addEventListener('ended', paintBox);
      box.audio = a;
      box.bound = true;
    }
    $fetch('/api/music')
      .then((data: any) => renderMusicBox(data))
      .catch(() => text(el.pubBoxNote, '站上曲库没读出来。'));
  };

  const renderPublic = (snapshot: any) => {
    const at = snapshot.at ? dateOnly(new Date(snapshot.at).getTime()) : '';
    text(el.pubAt, at ? '发布于 ' + at : '');
    /* 站长本人在这台机器上、只是小服务没跑：说清他看到的是快照，不是实时 */
    if (studio.keyValue.value && el.pubHint) {
      text(el.pubHint, '这台浏览器里有口令，但本机小服务没在跑——看到的是已发布的快照。');
      el.pubHint.hidden = false;
    }
    renderPublicProfile(snapshot.profile || {});
    renderPublicPlaylists(Array.isArray(snapshot.playlists) ? snapshot.playlists : []);
    renderPublicLiked(snapshot.liked || {});
  };

  /* 读站点自己的快照。回 true 表示「摆出来了」，false 表示「没得摆」 */
  const loadPublic = () =>
    $fetch('/api/kumura')
      .then((data: any) => {
        if (!data || !data.ok || !data.published || !data.snapshot) return false;
        renderPublic(data.snapshot);
        setState('public');
        loadMusicBox();
        return true;
      })
      .catch(() => false);

  /* ------------------------------------------------------ 发布到公网（站长）
     采集与脱敏都在服务端做（server/api/kumura/publish.post.ts），浏览器这边
     只是按一下、然后把回话念出来。口令从 useStudio 走：没有就问一次再重放。 */
  const publishNow = () => {
    const btn = el.publish as HTMLButtonElement | null;
    if (btn) btn.disabled = true;
    text(el.publishNote, '正在发布…（要向本机小服务取一次歌单，几秒钟）');
    studio
      .withKey(() => studio.authed('/api/kumura/publish', { method: 'POST', json: {} }))
      .then((r: any) => {
        const at = r && r.at ? dateOnly(new Date(r.at).getTime()) : '';
        text(
          el.publishNote,
          '已发布：歌单 ' + (r.playlists || 0) + ' 张 · 红心 ' + (r.tracks || 0) + '/' + (r.trackCount || 0) + ' 首' + (at ? ' · ' + at : '')
        );
      })
      .catch((err: any) => {
        const why = (err && err.data && err.data.error) || (err && err.message) || '未知错误';
        text(el.publishNote, '发布失败：' + why);
      })
      .finally(() => {
        if (btn) btn.disabled = false;
      });
  };

  /* ---------------------------------------------------------------- 播放
     地址由小服务现取（网易的直链约 20 分钟过期，服务端有 12 分钟缓存）。
     音频本身直连网易 CDN —— 那边发 CORS 头，所以不用我们中转字节，
     也就不用让本机服务去扛整首歌的流量。 */
  const player = {
    audio: null as HTMLAudioElement | null,
    list: [] as number[] /* 当前可播队列（按 DOM 里的顺序） */,
    index: -1,
    currentId: null as number | null,
    loadingId: null as number | null,
  };

  const audio = () => {
    if (!player.audio) {
      const a = document.createElement('audio');
      a.preload = 'none';
      a.setAttribute('data-km-audio', '');
      /* 挂进文档（.km-player 里）。不必须也能播，但挂上去才能被看见/被调试，
         而且站点上已经有一个 <audio data-bgm>（音乐盒的），
         留一个明确的钩子省得以后自己人也选错元素。
         元素是现造的而不是写进模板：模板要一字不差地等于 buildKumura()，
         那边也没有这个 <audio>。 */
      if (el.player) el.player.appendChild(a);
      const vol = el.playerVol ? (el.playerVol as HTMLInputElement) : null;
      a.volume = (vol ? Number(vol.value) : 80) / 100;
      a.addEventListener('play', paintPlayer);
      a.addEventListener('pause', paintPlayer);
      a.addEventListener('timeupdate', paintProgress);
      a.addEventListener('loadedmetadata', paintProgress);
      a.addEventListener('ended', () => {
        step(1);
      });
      a.addEventListener('error', () => {
        /* 两种可能：地址过期了，或者这首本来就放不出来。
           用的是「地址」而不是「版权」，因为从浏览器这边分不清是哪一种——
           猜错原因比不给原因更糟。 */
        if (player.currentId) {
          setPlayerNote('取到的地址播不了（多半是已过期）—— 再点一次就会重新取。');
        }
        paintPlayer();
      });
      player.audio = a;
    }
    return player.audio;
  };

  /* 队列 = 当前 DOM 里所有「有播放键」的行，按显示顺序 */
  const refreshQueue = () => {
    if (!panel) return;
    player.list = Array.prototype.slice
      .call(panel.querySelectorAll('[data-km-play]'))
      .map((btn: HTMLElement) => Number(btn.getAttribute('data-km-play')));
  };

  const songMeta = (id: number) => {
    if (!panel) return null;
    const row = panel.querySelector('.km-track[data-id="' + id + '"]');
    if (!row) return null;
    const im = row.querySelector('.km-track__art-img') as HTMLImageElement | null;
    return {
      id,
      name: textOf(row.querySelector('.km-track__name')),
      artist: textOf(row.querySelector('.km-track__artist')),
      cover: (im || { src: '' }).src || '',
    };
  };

  const textOf = (node: Element | null) => (node ? node.textContent : '');

  const setPlayerNote = (msg: string) => {
    text(el.playerSub, msg);
  };

  const clock = (sec?: number) => {
    if (!sec || !isFinite(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  };

  const paintProgress = () => {
    const a = player.audio;
    const seek = el.playerSeek ? (el.playerSeek as HTMLInputElement) : null;
    if (!a || !seek) return;
    const dur = a.duration;
    if (document.activeElement !== seek) {
      seek.value = dur && isFinite(dur) ? String(Math.round((a.currentTime / dur) * 1000)) : '0';
    }
    text(el.playerClock, clock(a.currentTime) + ' / ' + clock(dur));
  };

  const paintPlayer = () => {
    const a = player.audio;
    const playing = Boolean(a && !a.paused && !a.ended);
    if (el.playerToggle) {
      text(el.playerToggle, playing ? '❚❚' : '▶');
      el.playerToggle.setAttribute('aria-label', playing ? '暂停' : '播放');
      el.playerToggle.classList.toggle('is-playing', playing);
    }
    /* 把正在播的那一行标出来，滚到哪儿都知道是哪首 */
    if (!panel) return;
    Array.prototype.forEach.call(panel.querySelectorAll('.km-track'), (row: HTMLElement) => {
      const on = player.currentId != null && Number(row.getAttribute('data-id')) === player.currentId;
      row.classList.toggle('is-playing', on);
      const btn = row.querySelector('[data-km-play]');
      if (btn) {
        const icon = btn.querySelector('.km-track__play-icon');
        if (icon) text(icon as HTMLElement, on && playing ? '❚❚' : '▶');
        btn.setAttribute(
          'aria-label',
          (on && playing ? '暂停' : '播放') +
            '第 ' +
            (textOf(row.querySelector('.km-track__no')) || '') +
            ' 首'
        );
      }
    });
  };

  const showPlayer = (meta?: { name?: string; artist?: string; cover?: string } | null) => {
    if (el.player) el.player.hidden = false;
    document.body.classList.add('has-km-player');
    if (meta) {
      text(el.playerName, meta.name || '—');
      text(el.playerSub, meta.artist || '');
      if (el.playerArt) {
        clear(el.playerArt);
        if (meta.cover) {
          const im = make('img', 'km-player__art-img') as HTMLImageElement;
          im.src = meta.cover;
          im.alt = '';
          el.playerArt.appendChild(im);
        }
      }
    }
  };

  const hidePlayer = () => {
    const a = player.audio;
    if (a) a.pause();
    player.currentId = null;
    if (el.player) el.player.hidden = true;
    document.body.classList.remove('has-km-player');
    paintPlayer();
  };

  const playId = (id: number) => {
    const meta = songMeta(id);
    if (!meta) return;
    const a = audio();

    /* 同一首：切换播放/暂停，不再重新取地址 */
    if (player.currentId === id && a.src) {
      if (a.paused) {
        a.play().catch(() => {
          /* 浏览器拦了就等下一次点击 */
        });
      } else a.pause();
      return;
    }

    player.currentId = id;
    player.loadingId = id;
    refreshQueue();
    player.index = player.list.indexOf(id);
    showPlayer(meta);
    setPlayerNote('正在取播放地址…');
    paintPlayer();

    api('/api/song/url', { id })
      .then((r) => {
        const d = r.data || {};
        if (player.currentId !== id) return; /* 期间已经点了别的歌 */
        player.loadingId = null;
        if (!d.ok || !d.url) {
          setPlayerNote(d.message || '这首歌拿不到播放地址。');
          paintPlayer();
          return;
        }
        a.src = d.url;
        let label = meta.artist || '';
        if (d.trial) label += (label ? ' · ' : '') + '仅可试听片段';
        setPlayerNote(label);
        const p = a.play();
        if (p && p.catch) {
          p.catch(() => {
            setPlayerNote('浏览器挡住了自动播放，点一下播放键。');
            paintPlayer();
          });
        }
        paintPlayer();
      })
      .catch((err) => {
        player.loadingId = null;
        setPlayerNote('取播放地址失败：' + ((err && err.message) || '网络错误'));
        paintPlayer();
      });
  };

  const step = (delta: number) => {
    if (!player.list.length) return;
    let at = player.list.indexOf(player.currentId as number);
    if (at === -1) at = delta > 0 ? -1 : 0;
    let next = at + delta;
    if (next < 0) next = player.list.length - 1;
    if (next >= player.list.length) next = 0;
    playId(player.list[next]);
  };

  /* 空格播放/暂停、Alt + 左右切歌。别抢输入框的键。
     具名函数是为了卸载时能摘掉：Vue Router 不会刷新页面，留在 document 上就是幽灵监听。 */
  const onKeydown = (e: KeyboardEvent) => {
    if (!el.player || el.player.hidden) return;
    const tag = ((e.target as HTMLElement).tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      if (el.playerToggle) (el.playerToggle as HTMLButtonElement).click();
    } else if (e.key === 'ArrowRight' && e.altKey) {
      e.preventDefault();
      step(1);
    } else if (e.key === 'ArrowLeft' && e.altKey) {
      e.preventDefault();
      step(-1);
    }
  };

  const bindPlayer = () => {
    if (!el.player) return;

    panel?.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const btn = target.closest ? (target.closest('[data-km-play]') as HTMLElement | null) : null;
      if (btn) playId(Number(btn.getAttribute('data-km-play')));
    });

    if (el.playerToggle) {
      el.playerToggle.addEventListener('click', () => {
        const a = player.audio;
        if (!a || !a.src) return;
        if (a.paused) {
          a.play().catch(() => {
            /* 同上 */
          });
        } else a.pause();
      });
    }
    if (el.playerPrev) {
      el.playerPrev.addEventListener('click', () => {
        step(-1);
      });
    }
    if (el.playerNext) {
      el.playerNext.addEventListener('click', () => {
        step(1);
      });
    }
    if (el.playerClose) el.playerClose.addEventListener('click', hidePlayer);

    if (el.playerSeek) {
      el.playerSeek.addEventListener('input', (e) => {
        const a = player.audio;
        if (!a || !a.duration || !isFinite(a.duration)) return;
        a.currentTime = (Number((e.target as HTMLInputElement).value) / 1000) * a.duration;
        paintProgress();
      });
    }
    if (el.playerVol) {
      el.playerVol.addEventListener('input', (e) => {
        const a = audio();
        a.volume = Math.min(1, Math.max(0, Number((e.target as HTMLInputElement).value) / 100));
      });
    }

    document.addEventListener('keydown', onKeydown);
  };

  /* ---------------------------------------------------------------- 启动 */

  /* 三个「换一张 / 再读 50 首 / 退出登录」 */
  const bindActions = () => {
    if (el.qrRefresh) el.qrRefresh.addEventListener('click', beginQrLogin);
    if (el.publish) el.publish.addEventListener('click', publishNow);
    if (el.more) {
      el.more.addEventListener('click', () => {
        loadLiked(false);
      });
    }
    if (el.logout) {
      el.logout.addEventListener('click', () => {
        (el.logout as HTMLButtonElement).disabled = true;
        api('/api/logout')
          .catch(() => {
            /* 本地清掉就够了 */
          })
          .then(() => {
            (el.logout as HTMLButtonElement).disabled = false;
            clear(el.list);
            liked = { offset: 0, total: 0, hasMore: false, loading: false };
            if (el.likedCover) el.likedCover.hidden = true;
            if (el.likedMeta) clear(el.likedMeta);
            text(el.listNote, '');
            if (el.more) el.more.hidden = true;
            clear(el.playlists);
            text(el.playlistsNote, '');
            shelf = { loading: false };
            clear(el.dailyList);
            text(el.dailyNote, '');
            daily = { loading: false };
            beginQrLogin();
          });
      });
    }
  };

  const readConfig = () => {
    const CFG = G().CV01_MUSIC || {};
    SERVICE = (CFG.service || 'http://127.0.0.1:3170').replace(/\/+$/, '');
    PAGE_SIZE = CFG.pageSize || 50;
    POLL_MS = CFG.pollInterval || 2000;
    QR_TTL = (CFG.qrTtl || 180) * 1000;
    API_TIMEOUT = CFG.timeout || 8000;
  };

  const boot = () => {
    setState('loading');
    api('/api/health')
      .then((r) => {
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
      })
      .catch(() => {
        /* 小服务连不上：先看站长有没有发布过快照。发布过就摆访客那一版；
           没发布过才退回「小服务没在跑」——那句话是说给站长自己听的。 */
        loadPublic().then((shown) => {
          if (shown) return;
          setState('offline');
          text(
            el.serviceHint,
            '连不上本机的云村小服务（' + SERVICE + '）。先运行：node tools/ncm-server.mjs'
          );
          if (el.serviceHint) el.serviceHint.hidden = false;
        });
      });
  };

  /* ---------------------------------------------------------------- 生命周期 */

  onMounted(async () => {
    panel = root.value;
    if (!panel) return;
    bindElements();

    /* 等 <head> 里那两个 classic script 的 global。等不到也用兜底值继续——见 SCRIPT_WAIT */
    await Promise.all([
      waitForGlobal(() => G().CV01_MUSIC),
      waitForGlobal(() => G().CV01QR),
    ]);
    if (!alive || !panel) return;

    readConfig();
    bindActions();
    bindPlayer();
    boot();
  });

  /* 旧站换个页面就是整页重载，什么都跟着没了；Vue Router 不重载，
     所以这一页自己收尾：定时器、播放、body 上那个下边距、document 上的按键。
     不收的话，离开云村之后整站都会留着播放条的高度和一颗幽灵监听。 */
  onBeforeUnmount(() => {
    alive = false;
    stopQrWork();
    if (player.audio) {
      player.audio.pause();
      player.audio = null;
    }
    document.body.classList.remove('has-km-player');
    document.removeEventListener('keydown', onKeydown);
    panel = null;
    el = {};
  });
};

<script setup>
/* ==========================================================================
   云村（/kumura）· 扫码登录网易云，看账号、歌单架、每日推荐与红心歌单
   ---------------------------------------------------------------------------
   这一页的标记是对着 assets/css/kumura.css 写的：
   四段内容用 [data-pane] 标出来，显示哪一段交给 CSS
   按容器上的 data-music-state 决定；所以这里只摆挂载点和文案，
   取数 / 轮询 / 播放全在 composables/useKumura.ts 里。

   两个 classic script 是从 <head> 现挂的，不走打包：
     · assets/js/music.config.js —— 服务地址、页大小、轮询间隔这些可调项
     · assets/js/qr.js           —— 二维码在本地画成 SVG
   自己不抄一份二维码编码器，是这一页的老规矩：不引第三方图片服务，
   也不把那份算法维护成两份。composable 会等它们的 global 出现。
   ========================================================================== */
const site = useSiteMeta()

/* 容器交给 composable。查节点、改状态属性都在它里面发生，
   页面这一层不碰 DOM——SSR 出来的 HTML 与客户端 hydration 完全一致。 */
const music = ref(null)
useKumura(music)

useHead(() => ({
  title: `云村 · ${site.value.brand} ${site.value.mark}`,
  meta: [
    { name: 'description', content: '扫码登录网易云音乐，查看自己创建的歌单、每日推荐与红心歌单。' },
  ],
  link: [{ rel: 'stylesheet', href: '/assets/css/kumura.css' }],
  script: [{ src: '/assets/js/music.config.js' }, { src: '/assets/js/qr.js' }],
}))
</script>

<template>
  <header class="sect-head">
    <p class="sect-head__pitch">G4 · 生活在云上</p>
    <h1 class="sect-head__name">云村</h1>
    <p class="sect-head__def">用网易云扫码登录，在这里看自己创建的歌单、每日推荐与红心歌单。登录凭证只存在本机。</p>
  </header>

  <div ref="music" class="km" data-music data-music-state="loading">

    <section class="km-note" data-pane="loading">
      <span class="km-spinner" aria-hidden="true"></span>正在连接本机的云村小服务…
    </section>

    <section class="km-note" data-pane="offline">
      <b>小服务没在跑。</b><br>
      在博客根目录执行 <code>node tools/ncm-server.mjs</code>，然后刷新这一页。
      <span data-service-hint hidden></span>
    </section>

    <section class="km-login" data-pane="login">
      <div class="km-login__frame">
        <div class="km-login__code" data-qr></div>
      </div>
      <div class="km-login__side">
        <p class="km-login__title">扫码登录网易云音乐</p>
        <ol class="km-login__steps">
          <li>打开手机上的网易云音乐 App</li>
          <li>点左上角的「扫一扫」</li>
          <li>对准左边的二维码，然后在手机上确认</li>
        </ol>
        <p class="km-login__status">
          <span data-qr-status>正在准备二维码…</span>
          <span class="km-login__timer" data-qr-timer></span>
        </p>
        <div class="km-profile__act">
          <button class="km-btn" type="button" data-qr-refresh>换一张</button>
        </div>
        <p class="km-login__status">二维码由本站自己画，不经过任何第三方图片服务。<br>登录凭证只写进本机的 <code>.ncm-session.json</code>，浏览器这边不存。</p>
      </div>
    </section>

    <section class="km-profile" data-pane="ready">
      <div class="km-profile__bg" data-profile-bg hidden></div>
      <div class="km-profile__avatar" data-avatar></div>
      <div class="km-profile__body">
        <div class="km-profile__top">
          <h2 class="km-profile__name" data-nickname></h2>
          <span class="km-profile__uid" data-uid></span>
          <span class="km-profile__vip" data-vip hidden></span>
        </div>
        <p class="km-profile__sign" data-signature></p>
        <ul class="km-facts" data-facts></ul>
        <div class="km-profile__act">
          <button class="km-btn" type="button" data-logout>退出登录</button>
        </div>
      </div>
    </section>

    <section class="km-sec km-shelf" data-pane="ready">
      <div class="km-sec__head">
        <h3 class="km-sec__title">我创建的歌单</h3>
        <p class="km-sec__note" data-playlists-note></p>
      </div>
      <ul class="km-shelf__grid" data-playlists></ul>
    </section>

    <section class="km-sec km-daily" data-pane="ready">
      <div class="km-sec__head">
        <h3 class="km-sec__title">每日推荐</h3>
        <p class="km-sec__note" data-daily-note></p>
      </div>
      <ol class="km-tracks" data-daily-list></ol>
    </section>

    <section class="km-liked" data-pane="ready">
      <div class="km-liked__head">
        <div class="km-liked__cover" data-liked-cover hidden></div>
        <div>
          <div class="km-liked__meta" data-liked-meta></div>
          <p class="km-liked__note" data-list-note></p>
        </div>
      </div>
      <ol class="km-tracks" data-list></ol>
      <p class="km-more"><button class="km-btn km-btn--main" type="button" data-more hidden>再读 50 首</button></p>
    </section>

    <!-- 播放条：平时藏着，点任意一首歌才升起来。
         音频走网易 CDN 的直链（那边发 CORS 头），不经小服务中转。 -->
    <div class="km-player" data-player hidden>
      <div class="km-player__art" data-player-art></div>
      <div class="km-player__meta">
        <p class="km-player__name" data-player-name>—</p>
        <p class="km-player__sub" data-player-sub></p>
      </div>
      <div class="km-player__ctrl">
        <button class="km-player__btn" type="button" data-player-prev aria-label="上一首">◀◀</button>
        <button class="km-player__btn km-player__btn--main" type="button" data-player-toggle aria-label="播放 / 暂停">▶</button>
        <button class="km-player__btn" type="button" data-player-next aria-label="下一首">▶▶</button>
      </div>
      <div class="km-player__scrub">
        <input class="km-player__seek" type="range" min="0" max="1000" value="0" step="1"
               aria-label="播放进度" data-player-seek>
        <span class="km-player__clock" data-player-clock>0:00 / 0:00</span>
      </div>
      <div class="km-player__vol">
        <span class="km-player__vol-label" aria-hidden="true">音量</span>
        <input class="km-player__vol-range" type="range" min="0" max="100" value="80" step="1"
               aria-label="音量" data-player-vol>
      </div>
      <button class="km-player__btn km-player__btn--close" type="button" data-player-close aria-label="收起播放条">✕</button>
    </div>

  </div>
</template>

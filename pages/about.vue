<script setup>
/* 关于：站点自己的调声参数表 + 配色色块（与 about.html 同构）。
   色块下面那串十六进制是从当前配色里读出来的，不写死在页面里——
   换一轮配色、切一次主题，这一页都不会掉队。没 JS 时那里显示的是 token 名。 */
const site = useSiteMeta()

const specs = [
  {
    key: '建站方式',
    val: '外壳是 <b>Nuxt 3</b>（Vue 3 + Vite）：页面是 Vue 组件，服务端由 Nitro 提供接口与内容装配，第三方库（Vue、marked、KaTeX）全部随站打包，不联网、不 CDN。仓库里那条<b>零构建的静态路线</b>仍然留着：<code>node tools/build.mjs</code> 照旧把 <code>content/posts.mjs</code> 生成成 <code>index.html</code> / <code>sections/</code> / <code>posts/</code>，与 Nuxt 应用读同一份内容、用同一套卷帘算式。',
  },
  {
    key: '内容源',
    val: '两个源，各管一半。<b>手写的一半</b>：<code>content/posts.mjs</code>（板块、文章、每日一句、首页那一句），<code>node tools/build.mjs</code> 重新生成全部静态页，生成出来的 HTML 也可以直接手改。<b>界面写的一半</b>：编辑页写的文章、工具箱建的板块落在 <code>data/*.json</code>——跑着服务时由 <code>server/utils/content.ts</code> 把两半合成一份，页面与接口看到的都是它。',
  },
  {
    key: '门厅',
    val: '服务跑着的时候，站点每一页都得先过门厅：访客（粉键）按一下就进，盖三十天的章；站长（黑键）要口令。口令第一次启动自动生成，是一串 32 位的随机字符，印在启动服务的终端里——<code>tools/set-passphrase.mjs</code> 换一条，<code>tools/owner.cmd</code> 一键进门（起服务、口令进剪贴板、打开门厅）。口令错多了会被限速，越错等得越久。不想过这道门，<code>data/settings.json</code> 里写 <code>"gate": false</code>。',
  },
  {
    key: '目录',
    val: '左边那排琴键和首页的卷帘是同一个东西：九个板块 = 九个音。低音在下（做题区doge 是 F#3，也是唯一一个黑键），越往上越轻。首页的卷帘是一条<b>时间轴</b>：音符按写作日期往右接，越往右越新，同一个月的几篇一篇挨一篇排在一起（顶部月份牌子后面带着篇数），没发文的日子不留空白；文章页顶部那条迷你卷帘会告诉你现在在哪一格。',
  },
  {
    key: '每日一句',
    val: '每一页顶上那句小字来自「胡盐乱雨集」。它以本地日期为种子选句，所以全站同一天显示同一句，过了零点自动换。句子写在 <code>content/posts.mjs</code> 的 <code>excerpts</code> 里。',
  },
  {
    key: '配色',
    val: '颜色<b>不写在 CSS 里</b>：<code>content/palette.mjs</code> 是全站唯一写着色值的地方，<code>node tools/tokens.mjs</code> 校验对比度并生成 <code>assets/css/palette.css</code>。颜色在这里是<b>职务</b>不是气氛——<b>地</b>承担全部阅读重量（重量交给灰度的差，不交给色相），<b>墨</b>写正文，<b>签</b>只用来指认被选中的东西，<b>示</b>只表示「此刻」，是画面上唯一会动的东西。换一整套配色 = 改那个文件里的一行轮次。',
  },
  {
    key: '字体',
    val: '读到的是思源宋体（系统回退），操作界面是无衬线，测量数字用随站自带的 Big Shoulders。三个角色，各干各的事。',
  },
  {
    key: '素材',
    val: '全部视觉都是 CSS 与 SVG 现画的，没有引入任何插画素材。',
  },
  {
    key: '钢琴声',
    val: '默认<b>关闭</b>，顶栏「开启音效」打开后：点轨道名会先响一声再切板块，卷帘上的音符可以掠过试听。原生九个音（A3–A5，含黑键 F#3）已经放好<b>真钢琴的实录采样</b>（VSCO 2 Community Edition，CC0，按音高命名躺在 <code>assets/audio/</code>）；没采样文件的音高——比如新建板块挑的 B5、C6——由 WebAudio 现场合成顶替，缺哪个补哪个。',
  },
  {
    key: '上传',
    val: '双击 <code>start.cmd</code> 起一个零依赖的 Node 服务（顺手把云村那个小服务也一起拉起来），右下角就多出两颗悬浮球。<b>音乐盒</b>是公开的：谁都能开、能听、能选歌、能把某一首设成「进页面自动播的那一首」。<b>站长工具箱</b>要口令（就是门厅那把），里面三件事：新建板块 / 子板块、上传音乐盒的音乐、快速写一篇博客；音乐盒里换歌、改名、删歌也归它管。文件落在 <code>media/</code>，记录落在 <code>data/*.json</code>。想关掉就双击 <code>stop.cmd</code>，它自己按进程找，不用记端口。',
  },
  {
    key: '写文章',
    val: '站长工具箱里的「快速写一篇博客」会跳到独立编辑页：标题、板块 / 子板块、日期、阅读分钟、短标签、一句话简介，正文用 <b>Markdown（GFM 全量）</b>写——表格、任务列表、删除线都在，公式用 <code>$行内$</code> 和 <code>$$…$$</code>（KaTeX 在服务端排好版），emoji 直接打或写 <code>:smile:</code> 这样的短代码。图片 / 视频 / 音乐拖进正文框、点按钮选、或 <code>Ctrl+V</code> 粘截图都能传，传完自动塞到光标处，右栏实时预览。文章存在 <code>data/articles.json</code>，同时并进板块页的文章列表、归档、首页索引与卷帘——建完立刻看得见。',
  },
  {
    key: '改字',
    val: '不用重新生成页面也能改字。服务在线且有口令的浏览器，命令栏右侧多一颗<b>「全局编辑」</b>：一按整站进编辑模式，虚线框里的文字点一下就直接改——板块名、简介、导语、文章标题与正文、轨道栏与首页索引，空的简介 / 导语还能就地「＋ 新建」，<code>Esc</code> 退出。破坏性的事（改名 / 撤下）仍住在<b>站长右键菜单</b>里。界面上改原生文章不动源文件，改动记进 <code>data/overrides.json</code> 覆盖层。',
  },
  {
    key: '听歌',
    val: '歌是<b>跨页面接着放</b>的：站内跳转由 Vue Router 接手，右下角那根 <code>&lt;audio&gt;</code> 从头到尾没被销毁，所以切板块、翻文章、按后退都不会从头再来。<b>云村</b>扫码登录网易云：账号卡、我创建的歌单架、每天 6:00 更新的每日推荐、按加入时间倒序的红心歌单，点歌就在本页出声。',
  },
  {
    key: '联系',
    val: '改成你的邮箱、RSS 或社交账号。别留着占位符。',
  },
]

const swatches = [
  { var: '--paper', name: '<b>地</b>　整站的地面，阅读的重量都在它身上' },
  { var: '--ink', name: '<b>墨</b>　正文与结构线' },
  { var: '--miku-deep', name: '<b>签·地面</b>　被指认的东西：链接、序号、音高名' },
  { var: '--miku', name: '<b>签·暗窗</b>　音符块与读数' },
  { var: '--display', name: '<b>暗窗</b>　全站唯一的深色区域' },
  { var: '--cuer', name: '<b>此刻</b>　播放头、焦点环、进度' },
]

const hexes = reactive({})

const paint = () => {
  const style = getComputedStyle(document.documentElement)
  for (const row of swatches) {
    const value = style.getPropertyValue(row.var).trim()
    if (value) hexes[row.var] = value.toUpperCase()
  }
}

/* 首帧先摆 token 名（服务端与客户端第一次渲染都长这样），等整个应用 hydrate 完了
   才去读实际色值。用 onMounted 会太早：那时候兄弟节点的 hydration 还没走完，
   改文字会让 Vue 判成 mismatch。 */
onNuxtReady(() => {
  paint()
  const observer = new MutationObserver(paint)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-palette'] })
  onScopeDispose(() => observer.disconnect())
})

useHead(() => ({
  title: `关于 · ${site.value.brand} ${site.value.mark}`,
  meta: [{ name: 'description', content: '这个博客长什么样，用什么搭的，以及怎么把它改成你自己的。' }],
}))
</script>

<template>
  <header class="sect-head">
    <p class="sect-head__pitch">CV01 · 调声参数</p>
    <h1 class="sect-head__name">关于</h1>
    <p class="sect-head__def">这个博客长什么样，用什么搭的，以及怎么把它改成你自己的。</p>
  </header>

  <p class="lede">这里写一段自我介绍。名字、在做什么、为什么开这个博客，三句话以内最好。下面这张表是站点自己的参数——它是给人看的，也是给未来的你看的。</p>

  <div class="spec">
    <div v-for="row in specs" :key="row.key" class="spec__row">
      <p class="spec__key">{{ row.key }}</p>
      <!-- eslint-disable-next-line vue/no-v-html -->
      <p class="spec__val" v-html="row.val" />
    </div>
  </div>

  <div class="index-head">
    <h2>配色</h2>
    <p>6 个职务</p>
  </div>
  <div class="swatches">
    <div v-for="row in swatches" :key="row.var" class="swatch" :data-var="row.var">
      <span class="swatch__chip" :style="{ background: `var(${row.var})` }"></span>
      <!-- eslint-disable-next-line vue/no-v-html -->
      <span class="swatch__name" v-html="row.name" />
      <span class="swatch__hex">{{ hexes[row.var] || row.var }}</span>
    </div>
  </div>

  <p class="note-line">改配色只需动 <code>content/palette.mjs</code>——全站唯一写着色值的地方，然后跑一次 <code>node tools/tokens.mjs</code>：它会重算每对前景/背景的对比度，不够 AA 就拒绝生成，并把实测值写进 <code>assets/css/palette.css</code> 顶上那张表。上面这些色块与十六进制都跟着它走，不写死在这一页里。</p>
</template>

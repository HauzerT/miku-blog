<script setup>
/* ==========================================================================
   components/StudioDock.vue · 右下角两颗悬浮球
   ---------------------------------------------------------------------------
   与 server/lib/shell.mjs 的 studio() 同构：.studio > .studio__panel（面板宿主）
   + .studio__dock（两颗球）+ <audio data-bgm>，class、属性、层级一个不差，
   所以 assets/css/studio.css 一个字节都不用改。

   两条硬规矩写在这里：

     · 服务探不到就整体隐身（hidden），探到了才摆出来——与静态页同一条：
       没 JS 或没服务时，站点照旧，只是没有工作台。
     · <audio> 必须留在这一层。它住在 layouts/default.vue 里、<NuxtPage> 之外，
       换页时不重建，所以歌不会因为翻页而停。src 一概不绑：什么时候换歌、
       换哪一首，全由 useMusic 说了算，免得某次渲染把正在响的那一根重造。

   面板的开关、口令都交给 composables/useStudio.ts；播放交给 useMusic.ts。
   ========================================================================== */
const route = useRoute()
const { toast } = useToast()
const { online, openName, probe, adoptKey, togglePanel, closePanel, verifyOwner, setPanelFocus } = useStudio()
const music = useMusic()

const rootEl = ref(null)
const panelEl = ref(null)
const audioEl = ref(null)

/* 球上的那几样都是从播放状态算出来的：
   正在放（樱粉环）/ 被拦下（粉点）/ 曲目数 / 正在放的那一首的曲名 */
const musicCount = computed(() => String(music.tracks.value.length))
const musicTitle = computed(() => (music.current() ? music.current().title : ''))
const musicPlaying = computed(() => music.playing.value)
const musicBlocked = computed(() => music.blocked.value && !music.playing.value)
const musicLabel = computed(() =>
  music.playing.value
    ? '音乐盒：正在播放 ' + (music.current() ? music.current().title : '')
    : music.blocked.value
      ? '音乐盒：点一下开始播放'
      : '音乐盒'
)

/* 面板一开（或站长工具箱换了子面板）就把焦点收进第一个能按的东西里。
   触摸设备上没有悬停，别自作主张弹键盘。 */
const focusFirst = () => {
  const panel = panelEl.value
  if (!panel) return
  const first = panel.querySelector('input, textarea, button, [tabindex], a[href]')
  if (first && !window.matchMedia('(hover: none)').matches) window.setTimeout(() => first.focus(), 40)
}

const openBall = async (name) => {
  if (!online.value) return toast('上传服务没在跑：先双击 start.cmd', true)
  if (name === 'owner') {
    /* 站长工具箱里的东西都要写文件，开之前先验一次口令。第一次（或口令过期）
       服务回 401，withKey 会把口令框叫出来——这就是旧站 cv01.withKey 那条路。 */
    try {
      await verifyOwner()
    } catch (err) {
      toast(apiError(err), true)
      return
    }
    togglePanel('owner')
    return
  }
  /* 音乐盒公开：谁都能开 */
  togglePanel(name)
}

/* 深链：/?open=music 或 /?open=owner 进来就展开那个面板。
   自己用着方便，截图检查样式也靠它（旧站 studio.js 的 deepLink）。 */
const deepLink = () => {
  const want = String(route.query.open || '')
  if (want === 'music' || want === 'owner') window.setTimeout(() => openBall(want), 60)
}

/* 「点面板外面就收起」这件事有个坑：面板里的按钮常常会把列表重画一遍
   （点「设默认」、点「删」、站长工具箱换子面板），重画之后 e.target 已经脱离文档，
   等事件冒泡到 document 再问 root.contains(e.target) 就变成 false 了——
   明明点在里面，却被判成点在外面，面板自己关掉。
   所以判断放在捕获阶段：那时 DOM 还没被改，e.target 一定还在原位。 */
let pressInside = false
const onPressCapture = (event) => {
  pressInside = rootEl.value ? rootEl.value.contains(event.target) : false
}
const onDocClick = (event) => {
  if (!openName.value) return
  if (pressInside || (rootEl.value && rootEl.value.contains(event.target))) return
  closePanel()
}
const onDocKey = (event) => {
  if (event.key === 'Escape' && openName.value) closePanel()
}

onMounted(async () => {
  music.bindAudio(audioEl.value)
  adoptKey()
  setPanelFocus(focusFirst)
  document.addEventListener('click', onPressCapture, true)
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onDocKey)
  /* 在门厅（另一个布局）里登录完回到站内页，工作台该认出那把口令 */
  window.addEventListener('focus', adoptKey)

  /* 只读快照：面板之外（自检、控制台）想知道音乐盒现在怎么想的时候用它，
     与旧的 cv01.music.state() 同一个用途。 */
  window.cv01 = Object.assign(window.cv01 || {}, { music: { state: music.state } })

  const alive = await probe()
  if (!alive) return
  await music.load()
  deepLink()
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onPressCapture, true)
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onDocKey)
  window.removeEventListener('focus', adoptKey)
})

watch(openName, async (name) => {
  if (!name) return
  await nextTick()
  focusFirst()
})
</script>

<template>
  <div ref="rootEl" class="studio" data-studio data-base="/" :hidden="!online" :data-open="openName || undefined">
    <div ref="panelEl" class="studio__panel" data-studio-panel :hidden="!openName">
      <MusicBox v-if="openName === 'music'" />
      <OwnerToolbox v-else-if="openName === 'owner'" />
    </div>
    <div class="studio__dock">
      <button
        class="ball ball--music"
        :class="{ 'is-playing': musicPlaying, 'is-blocked': musicBlocked, 'is-on': openName === 'music' }"
        type="button"
        data-ball="music"
        :aria-expanded="openName === 'music' ? 'true' : 'false'"
        :data-count="musicCount"
        :data-title="musicTitle || undefined"
        :aria-label="musicLabel"
        @click="openBall('music')"
      >
        <span class="ball__glyph" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 18V6l10-2v12" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="16.5" cy="16" r="2.5" />
          </svg>
        </span>
        <span class="ball__dot" aria-hidden="true"></span>
      </button>
      <button
        class="ball ball--owner"
        :class="{ 'is-on': openName === 'owner' }"
        type="button"
        data-ball="owner"
        :aria-expanded="openName === 'owner' ? 'true' : 'false'"
        aria-label="站长工具箱（需要口令）"
        @click="openBall('owner')"
      >
        <span class="ball__glyph" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="8.5" cy="15.5" r="4.2" /><path d="M11.6 12.4 20 4M17.2 4.6l2.6 2.6M14.4 7.4l2.6 2.6" />
          </svg>
        </span>
      </button>
    </div>
    <!-- 一根 <audio>，全站就这一根。放在这里（不在页面里）是「换页歌不断」的全部秘密 -->
    <audio ref="audioEl" data-bgm preload="metadata"></audio>
  </div>
  <KeyDialog />
  <!-- 站长那两只手：右键菜单、页面上直接改字、全局编辑模式的工具条与浮层。
       它们都挂在文档上，所以需要一个全站每页都在、换页不重建的宿主——
       与 <audio> 和两颗球同一条理由。 -->
  <EditOverlay />
</template>

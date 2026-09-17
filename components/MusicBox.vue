<script setup>
/* ==========================================================================
   components/MusicBox.vue · 音乐盒面板
   ---------------------------------------------------------------------------
   面板分这几块：暗窗头（现在放哪一首、进页面自动播的是哪一首）、进度、播放控制、音量、
   曲目列表、换歌时那一条进度。每一行：序号/播放、曲名、大小、设为默认，
   以及只有站长看得见的 换 / 改名 / 删。

   播放状态与全部动作都在 composables/useMusic.ts 里（歌不能因为面板收起就停），
   这里只管画，以及把进度条这种「这一次操作才有的东西」留在本地。

   空曲库那一句 `<p class="mp-empty">` 故意摆在 `<ul>` **外面**：把 p 塞进 ul 里
   在 HTML 里是非法的，浏览器解析时一定会把它挤到 ul 后面——照这个结果写，
   省掉一次水合错位。
   ========================================================================== */
const { toast } = useToast()
const { hasKey } = useStudio()
const {
  tracks,
  index,
  defaultIndex,
  failed,
  mode,
  playing,
  volume,
  currentTime,
  duration,
  current,
  pinned,
  isBroken,
  play,
  toggle,
  step,
  pin,
  setVolume,
  seek,
  cycleMode,
  swapFrom,
  renameTrack,
  removeTrack,
} = useMusic()

const nowTitle = computed(() => (current() ? current().title : '还没有曲子'))
const nowSub = computed(() => {
  const t = current()
  return t && t.artist ? t.artist : 'MP3 / M4A · 进页面自动播放'
})
const pinTitle = computed(() => (pinned() ? pinned().title : ''))
const modeLabel = computed(() => MODE_LABEL[mode.value])
const seekValue = computed(() =>
  duration.value && isFinite(duration.value) ? Math.round((currentTime.value / duration.value) * 1000) : 0
)
const clock = computed(() => fmtClock(currentTime.value) + ' / ' + fmtClock(duration.value))

/* 拖动进度：duration 还没读出来就什么都不做（与旧站一致） */
const onSeek = (event) => seek(Number(event.target.value) / 1000)
const onVolume = (event) => setVolume(Number(event.target.value) / 100)

/* 键盘：空格播放/暂停，Alt+左右切歌。面板里除了范围条以外的输入框不吃这几个键 */
const onPanelKey = (event) => {
  if (event.target.tagName === 'INPUT' && event.target.type !== 'range') return
  if (event.key === ' ' || event.key === 'Spacebar') {
    event.preventDefault()
    toggle()
  }
  if (event.key === 'ArrowRight' && event.altKey) {
    event.preventDefault()
    step(1)
  }
  if (event.key === 'ArrowLeft' && event.altKey) {
    event.preventDefault()
    step(-1)
  }
}

/* 「换」用的隐藏文件框：按钮在列表里，文件选择器留在这儿（与旧站同一个位置） */
const swapInput = ref(null)
const swapAt = ref(-1)
const upOn = ref(false)
const upRatio = ref(0)
const upText = ref('')

const pickSwap = (i) => {
  swapAt.value = i
  const input = swapInput.value
  if (!input) return
  input.value = ''
  input.click()
}

const onSwapChange = async () => {
  const input = swapInput.value
  const file = input && input.files ? input.files[0] : null
  if (input) input.value = ''
  const i = swapAt.value
  swapAt.value = -1
  if (!file || i < 0) return
  upOn.value = true
  upRatio.value = 0.1
  upText.value = '替换中…'
  try {
    await swapFrom(i, file, (ratio) => {
      upRatio.value = ratio
      upText.value = '替换中 ' + Math.round(ratio * 100) + '%'
    })
    upText.value = '换好了'
    window.setTimeout(() => {
      upOn.value = false
      upRatio.value = 0
    }, 1500)
  } catch (err) {
    upOn.value = false
    toast(apiError(err), true)
  }
}
</script>

<template>
  <div class="mp" @keydown="onPanelKey">
    <div class="mp__head">
      <p class="mp__eyebrow">音乐盒 · {{ tracks.length }} 首</p>
      <p class="mp__now" data-now>{{ nowTitle }}</p>
      <p class="mp__sub" data-sub>{{ nowSub }}</p>
      <p class="mp__pin" data-pin-line :hidden="!pinTitle">{{ pinTitle ? '进页面自动播：' + pinTitle : '' }}</p>
    </div>

    <div class="mp__scrub">
      <input
        class="mp__seek"
        type="range"
        min="0"
        max="1000"
        step="1"
        aria-label="进度"
        data-seek
        :value="seekValue"
        @input="onSeek"
      >
      <span class="mp__clock" data-clock>{{ clock }}</span>
    </div>

    <div class="mp__ctrl">
      <button class="mp__btn" type="button" data-prev aria-label="上一首" @click="step(-1)">◀◀</button>
      <button
        class="mp__btn mp__btn--main"
        :class="{ 'is-playing': playing }"
        type="button"
        data-toggle
        aria-label="播放/暂停"
        @click="toggle"
      >{{ playing ? '❚❚' : '▶' }}</button>
      <button class="mp__btn" type="button" data-next aria-label="下一首" @click="step(1)">▶▶</button>
      <button class="mp__btn mp__btn--mode" type="button" data-mode @click="cycleMode">{{ modeLabel }}</button>
    </div>

    <div class="mp__vol">
      <span class="mp__vol-label">音量</span>
      <input
        class="mp__vol-range"
        type="range"
        min="0"
        max="100"
        aria-label="音量"
        data-vol
        :value="Math.round(volume * 100)"
        @input="onVolume"
      >
    </div>

    <ul class="mp__list" data-list>
      <li
        v-for="(t, i) in tracks"
        :key="t.id || i"
        class="mp-item"
        :class="{ 'is-current': i === index, 'is-pinned': i === defaultIndex, 'is-broken': isBroken(t) }"
        :data-i="i"
        :data-id="t.id || ''"
      >
        <button
          class="mp-item__play"
          type="button"
          :data-play="i"
          :aria-label="'播放 ' + t.title"
          @click="play(i)"
        >
          <span class="mp-item__no">{{ i === index ? (playing ? '▶' : '❚❚') : i + 1 }}</span>
        </button>
        <span class="mp-item__title">{{ t.title }}<template v-if="isBroken(t)">（放不出来）</template><em v-if="t.artist">{{ t.artist }}</em></span>
        <span class="mp-item__size">{{ fmtSize(t.size) }}</span>
        <span class="mp-item__acts">
          <button
            class="mp-item__act"
            :class="{ 'is-on': i === defaultIndex }"
            type="button"
            :data-pin="i"
            :aria-pressed="i === defaultIndex ? 'true' : 'false'"
            title="设为进页面自动播放的那一首"
            @click="pin(i)"
          >{{ i === defaultIndex ? '默认' : '设默认' }}</button>
          <button
            v-if="hasKey"
            class="mp-item__act"
            type="button"
            :data-swap="i"
            title="用本机另一个文件替换这一首"
            @click="pickSwap(i)"
          >换</button>
          <button v-if="hasKey" class="mp-item__act" type="button" :data-rename="i" @click="renameTrack(i)">改名</button>
          <button
            v-if="hasKey"
            class="mp-item__act mp-item__act--del"
            type="button"
            :data-del="i"
            :aria-label="'删除 ' + t.title"
            @click="removeTrack(i)"
          >删</button>
        </span>
      </li>
    </ul>
    <p v-if="!tracks.length" class="mp-empty">曲库是空的。右下角那颗站长球里可以传 mp3 / m4a 进来。</p>

    <!-- 换歌时用的进度条：平时藏着，只有站长按了「换」才会亮 -->
    <span class="mp__up" data-up :hidden="!upOn">
      <i data-up-bar :style="{ width: Math.round(upRatio * 100) + '%' }"></i>
      <b data-up-text>{{ upText }}</b>
    </span>

    <p class="mp__note">
      曲库存在 <code>media/music/</code>，直接把文件丢进那个文件夹也会被认出来（刷新页面即可）。「默认」那一首就是每次进页面自动放的那一首；浏览器不允许没交互就出声，所以第一次可能要你点一下。传新歌、换歌、删歌在右下角那颗<b>站长球</b>里。
    </p>

    <!-- 换歌用的隐藏输入框：按钮在列表里，文件选择器留在这儿 -->
    <input
      ref="swapInput"
      class="mp__file"
      type="file"
      accept="audio/mpeg,audio/mp4,audio/x-m4a,.mp3,.m4a,.mp4"
      hidden
      data-swap-file
      @change="onSwapChange"
    >
  </div>
</template>

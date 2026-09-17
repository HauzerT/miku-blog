<script setup>
/* ==========================================================================
   components/MusicUpload.vue · 站长工具箱里的「上传音乐盒的音乐」
   ---------------------------------------------------------------------------
   面板里就三样东西：一块虚线投放区（拖进来 / 选择文件），一条上传进度，
   一行「刚传进来：…」。
   传进来的曲子直接进曲库；曲库本来是空的话，这一首就顺手成为「进页面自动播」。

   进度这一条留在本地（这一次上传才有），曲库与上传动作在 composables/useMusic.ts。
   进度百分比按「第几个文件 + 这个文件传了多少」算（audioCount 恒为 0，
   所以多文件时进度条看起来慢半拍）。
   ========================================================================== */
const { toast } = useToast()
const { uploadTracks } = useMusic()

const fileInput = ref(null)
const over = ref(false)
const upOn = ref(false)
const upRatio = ref(0)
const upText = ref('')
const done = ref('')

const run = async (files) => {
  const list = Array.from(files || [])
  if (!list.length) return
  const audio = list.filter(isAudioFile)
  const total = audio.reduce((n, f) => n + f.size, 0)
  upOn.value = true
  upRatio.value = 0
  upText.value = '上传中 0%'
  try {
    const added = await uploadTracks(list, (ratio) => {
      const overall = audio.length ? ratio / audio.length : ratio
      upRatio.value = overall
      upText.value = '上传中 ' + Math.round(overall * 100) + '%（' + fmtSize(total) + '）'
    })
    if (!added.length) {
      /* 一个音频都没有：uploadTracks 已经说过那句「只认音频文件」了 */
      upOn.value = false
      return
    }
    upRatio.value = 1
    upText.value = '传好了，' + added.length + ' 首'
    done.value = '刚传进来：' + added.map((t) => t.title).join('、')
    window.setTimeout(() => {
      upOn.value = false
      upRatio.value = 0
    }, 1600)
  } catch (err) {
    upOn.value = false
    toast(apiError(err), true)
  }
}

const onPick = () => {
  const input = fileInput.value
  if (!input || !input.files || !input.files.length) return
  /* files 是活的：清空 input 之前先抄一份 */
  const files = Array.from(input.files)
  input.value = ''
  run(files)
}

const onDrop = (event) => {
  over.value = false
  const files = event.dataTransfer && event.dataTransfer.files
  if (files && files.length) run(files)
}

const onDragOver = (event) => {
  event.preventDefault()
  over.value = true
}

const onDragLeave = (event) => {
  event.preventDefault()
  over.value = false
}
</script>

<template>
  <div class="mp">
    <div class="mp__head">
      <p class="mp__eyebrow">上传音乐</p>
      <p class="mp__hint">传进来的曲子直接进音乐盒的曲库，进页面自动播放的就是它。</p>
    </div>
    <div
      class="mp__drop"
      data-drop
      :class="{ 'is-over': over }"
      @dragenter="onDragOver"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <b class="mp__drop-title">上传 BGM</b>
      把 MP3 / M4A 拖到这里，或者
      <button class="mp__pick" type="button" data-pick @click="fileInput && fileInput.click()">选择文件</button>
      <input
        ref="fileInput"
        class="mp__file"
        type="file"
        accept="audio/mpeg,audio/mp4,audio/x-m4a,.mp3,.m4a,.mp4,.wav,.ogg,.flac"
        multiple
        hidden
        data-file
        @change="onPick"
      >
      <span class="mp__up" data-up :hidden="!upOn">
        <i data-up-bar :style="{ width: Math.round(upRatio * 100) + '%' }"></i>
        <b data-up-text>{{ upText || '上传中 0%' }}</b>
      </span>
    </div>
    <p class="mp__done" data-done :hidden="!done">{{ done }}</p>
    <p class="mp__note">
      文件落在 <code>media/music/</code>，文件名会规整成「日期-随机名」，原名只留在记录里。想改名、想换、想删，去音乐盒面板（那几颗按钮只对输入过口令的浏览器显示）。
    </p>
  </div>
</template>

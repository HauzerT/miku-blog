<script setup>
/* ==========================================================================
   编辑页（/editor）· 左边写、右边看
   ---------------------------------------------------------------------------
   正文用 Markdown 写，预览走 POST /api/render —— 与文章页是同一个渲染器
   （server/lib/markdown.mjs），所见即所得。图片 / 视频 / 音乐点按钮、拖进正文框、
   或者 Ctrl+V 粘截图都能传：文件落进 media/，插入语法塞到光标处，同时把这篇文章
   带的文件清单一起交给服务（删文章时好一起清掉）。

   文章存在 data/articles.json，由 server/utils/content.ts 并进板块页 / 归档 /
   首页索引与卷帘——建完立刻看得见。
   与旧的 assets/js/editor.js 一一对应；它当年靠的 cv01.fetchJSON / withKey / upload
   现在住在 composables/useApi.ts 与 composables/useOwnerKey.ts 里。
   ========================================================================== */
definePageMeta({ layout: 'editor' })

const route = useRoute()
const { toast } = useToast()
const { key } = useOwnerKey()

const KIND_LABEL = { image: '图片', video: '视频', audio: '音乐' }

const sections = ref([])
const articles = ref([])
const assets = ref([])
const editing = ref('')
const dirty = ref(false)
const saving = ref(false)
const heading = ref('写一篇博客')
const previewHtml = ref('<p class="ed__empty">写点什么，这边就跟着显示。</p>')
const stateText = ref('正在看看这台机器上有没有口令…')
const stateBad = ref(false)
const stateUrl = ref('')

const form = reactive({
  title: '',
  section: '',
  sub: '',
  date: todayStamp(),
  min: 4,
  short: '',
  blurb: '',
  source: '',
})

const sourceEl = ref(null)
const fileImage = ref(null)
const fileVideo = ref(null)
const fileAudio = ref(null)
const fileRefs = { image: fileImage, video: fileVideo, audio: fileAudio }
const isOver = ref(false)
let previewTimer = 0

const subs = computed(() => sections.value.find((s) => s.id === form.section)?.subs || [])

const setState = (text, isBad = false, url = '') => {
  stateText.value = text
  stateBad.value = Boolean(isBad)
  stateUrl.value = url || ''
}

const keyState = () => {
  setState(
    key.value
      ? '口令已经记住了，保存时不会再问。'
      : '还没有口令：第一次保存时会问你一次，那串口令印在启动服务的终端里。'
  )
}

/* ------------------------------------------------------------ 板块下拉 */
const lastSection = () => {
  try {
    return localStorage.getItem('cv01-editor-section') || ''
  } catch {
    return ''
  }
}

const loadSections = async () => {
  const data = await fetchJson('sections')
  sections.value = data.sections || []
  const keep = form.section || lastSection()
  if (keep && sections.value.some((s) => s.id === keep)) form.section = keep
  else form.section = sections.value[0]?.id || ''
}

const onSectionChange = () => {
  /* 换了板块：子板块跟着换一栏；原来的那个要是新板块里也有，就留着 */
  if (!subs.value.some((s) => s.id === form.sub)) form.sub = ''
  markDirty()
  try {
    localStorage.setItem('cv01-editor-section', form.section)
  } catch {
    /* 隐私模式 */
  }
}

/* ------------------------------------------------------------ 正文插入 */
const insertAtCursor = (text) => {
  const area = sourceEl.value
  if (!area) return
  const start = typeof area.selectionStart === 'number' ? area.selectionStart : form.source.length
  const end = typeof area.selectionEnd === 'number' ? area.selectionEnd : start
  form.source = form.source.slice(0, start) + text + form.source.slice(end)
  const at = start + text.length
  nextTick(() => {
    try {
      area.setSelectionRange(at, at)
    } catch {
      /* 有的浏览器会拒绝，无所谓 */
    }
    area.focus()
  })
  markDirty()
}

const insertSyntax = (asset) => {
  if (asset.kind === 'image') return `![${asset.original || '图片'}](${asset.url})`
  if (asset.kind === 'video') return `<video src="${asset.url}" controls preload="metadata" playsinline></video>`
  return `<audio src="${asset.url}" controls preload="metadata"></audio>`
}

const collectAssets = (files) => {
  for (const f of files || []) {
    assets.value.push({
      kind: f.kind,
      bucket: f.bucket,
      file: f.file,
      url: f.url,
      original: f.original,
      size: f.size,
      type: f.type,
    })
  }
}

/* ------------------------------------------------------------ 上传 */
const uploadFiles = async (kind, files) => {
  const list = Array.from(files || [])
  if (!list.length) return

  const body = new FormData()
  for (const f of list) body.append('file', f, f.name)
  if (kind) body.append('kind', kind)

  saving.value = true
  setState(`正在传 ${list.length} 个文件…`)
  try {
    const data = await upload('media', body, (ratio) => {
      setState(`正在传 ${list.length} 个文件… ${Math.round(ratio * 100)}%`)
    })
    const got = data.files || []
    for (const f of got) insertAtCursor(`\n${insertSyntax(f)}\n`)
    collectAssets(got)
    markDirty()
    refreshPreview()
    setState(`传好了 ${got.length} 个文件，已经插到光标处。`)
  } catch (err) {
    setState(apiError(err), true)
  } finally {
    saving.value = false
  }
}

const pick = (kind) => fileRefs[kind].value?.click()

const onFilePicked = async (kind, event) => {
  const input = event.target
  if (input.files && input.files.length) await uploadFiles(kind, input.files)
  input.value = ''
}

const onDrop = (event) => {
  isOver.value = false
  uploadFiles('', event.dataTransfer?.files)
}

/* Ctrl+V 粘截图 */
const onPaste = (event) => {
  const files = Array.from(event.clipboardData?.items || [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file) => file && /^image\//.test(file.type))
  if (!files.length) return
  event.preventDefault()
  uploadFiles('image', files)
}

/* ------------------------------------------------------------ 预览 */
const renderPreview = async () => {
  if (!form.source.trim()) {
    previewHtml.value = '<p class="ed__empty">写点什么，这边就跟着显示。</p>'
    return
  }
  try {
    const data = await fetchJson('render', { method: 'POST', json: { source: form.source } })
    previewHtml.value = data.html || ''
  } catch {
    previewHtml.value = '<p class="ed__empty">服务没在跑，预览不了。</p>'
  }
}

const refreshPreview = () => {
  clearTimeout(previewTimer)
  previewTimer = setTimeout(renderPreview, 320)
}

/* ------------------------------------------------------------ 保存 */
const save = async () => {
  const payload = {
    title: form.title.trim(),
    section: form.section,
    sub: form.sub || '',
    date: form.date.trim() || todayStamp(),
    min: Number(form.min) || 4,
    short: form.short.trim(),
    blurb: form.blurb.trim(),
    source: form.source,
    assets: assets.value,
  }
  if (!payload.title) return setState('标题别忘了。', true)
  if (!payload.section) return setState('先选一个板块。', true)

  const isNew = !editing.value
  saving.value = true
  setState(isNew ? '正在保存…' : '正在改…')
  try {
    const data = await withOwnerKey(`/api/articles${isNew ? '' : '/' + editing.value}`, {
      method: isNew ? 'POST' : 'PATCH',
      body: payload,
    })
    const article = data.article
    editing.value = article.id
    assets.value = article.assets || []
    dirty.value = false
    heading.value = `在写：${article.title}`
    form.date = article.date
    await loadList()
    setState(`保存好了 · ${article.slug}`, false, `/posts/${article.slug}`)
    /* 这一篇要是在页面上直接改过正文（富文本那层），这次保存就把那层撤掉了：
       Markdown 重新成了正文的真相，得说一声，别让人以为改丢了 */
    toast(
      data.droppedBody
        ? '改好了——页面上那版富文本正文让位给这份 Markdown 了'
        : isNew
          ? '发出去了'
          : '改好了',
      false,
      null,
      Boolean(data.droppedBody)
    )
  } catch (err) {
    setState(apiError(err), true)
  } finally {
    saving.value = false
  }
}

/* ------------------------------------------------------------ 我写的 */
const loadList = async () => {
  const data = await fetchJson('articles')
  articles.value = data.articles || []
}

const openArticle = async (id) => {
  try {
    const data = await fetchJson(`articles/${id}`)
    const article = data.article
    editing.value = article.id
    assets.value = (article.assets || []).slice()
    form.title = article.title
    form.date = article.date
    form.min = article.min
    form.short = article.short || ''
    form.blurb = article.blurb || ''
    form.source = article.source || ''
    form.section = article.section
    await nextTick()
    form.sub = article.sub || ''
    heading.value = `在写：${article.title}`
    dirty.value = false
    renderPreview()
    setState('正在改这一篇。改完再点一次「保存并发布」。')
    window.scrollTo(0, 0)
  } catch (err) {
    setState(apiError(err), true)
  }
}

const removeArticle = async (id) => {
  if (!window.confirm('删掉这篇？它带的图片 / 视频 / 音乐也会一起从磁盘上删掉。')) return
  try {
    await withOwnerKey(`/api/articles/${id}`, { method: 'DELETE' })
    if (editing.value === id) resetForm()
    toast('删掉了')
    await loadList()
  } catch (err) {
    toast(apiError(err), true)
  }
}

const resetForm = () => {
  editing.value = ''
  assets.value = []
  dirty.value = false
  form.title = ''
  form.date = todayStamp()
  form.min = 4
  form.short = ''
  form.blurb = ''
  form.source = ''
  form.sub = ''
  heading.value = '写一篇博客'
  renderPreview()
  keyState()
}

const markDirty = () => {
  dirty.value = true
  if (!editing.value) setState('还没保存。')
}

const onSourceInput = () => {
  markDirty()
  refreshPreview()
}

/* 走之前提醒一句没保存 */
const onBeforeUnload = (event) => {
  if (!dirty.value) return
  event.preventDefault()
  event.returnValue = ''
}

onMounted(async () => {
  keyState()
  renderPreview()
  window.addEventListener('beforeunload', onBeforeUnload)
  onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnload))

  try {
    await loadSections()
  } catch {
    setState('连不上服务：先双击 start.cmd 把它跑起来。', true)
  }
  try {
    await loadList()
  } catch {
    /* 上面已经说过一次了 */
  }

  const id = String(route.query.id || '')
  if (id) openArticle(id)
})

useHead({
  title: '写博客 · 初音ミク CV01',
  meta: [{ name: 'description', content: '快速写一篇博客：Markdown 正文 + 图片 / 视频 / 音乐上传。' }],
})
</script>

<template>
  <main class="ed" id="main">
    <header class="ed__head">
      <div class="ed__headline">
        <p class="ed__eyebrow">编辑页</p>
        <h1 class="ed__title" data-heading>{{ heading }}</h1>
        <p class="ed__state" :class="{ 'is-bad': stateBad }" data-state role="status">
          {{ stateText }}
          <a v-if="stateUrl" :href="stateUrl" target="_blank" rel="noopener">去看这一篇</a>
        </p>
      </div>
      <div class="ed__acts">
        <button v-if="editing" class="ed__btn" type="button" data-new @click="resetForm">写新的一篇</button>
        <button class="ed__btn" type="button" data-preview @click="renderPreview">刷新预览</button>
        <button class="ed__btn ed__btn--main" type="button" data-save :disabled="saving" @click="save">保存并发布</button>
      </div>
    </header>

    <div class="ed__grid">
      <section class="ed__col ed__col--form">
        <label class="ed__field ed__field--wide">
          <span class="ed__label">标题</span>
          <input v-model="form.title" class="ed__input" type="text" maxlength="120" data-title placeholder="比如：唐师父的一盘炒肉" @input="markDirty">
        </label>

        <div class="ed__row">
          <label class="ed__field">
            <span class="ed__label">板块</span>
            <select v-model="form.section" class="ed__select" data-section @change="onSectionChange">
              <option v-for="s in sections" :key="s.id" :value="s.id">{{ s.pitch }} · {{ s.name }}</option>
            </select>
          </label>
          <label class="ed__field">
            <span class="ed__label">子板块</span>
            <select v-model="form.sub" class="ed__select" data-sub @change="markDirty">
              <option value="">（直接发在板块里）</option>
              <option v-for="x in subs" :key="x.id" :value="x.id">{{ x.name }}</option>
            </select>
          </label>
        </div>

        <div class="ed__row ed__row--three">
          <label class="ed__field">
            <span class="ed__label">日期</span>
            <input v-model="form.date" class="ed__input" type="text" data-date placeholder="2026.09.16" @input="markDirty">
          </label>
          <label class="ed__field">
            <span class="ed__label">阅读分钟</span>
            <input v-model.number="form.min" class="ed__input" type="number" min="1" max="120" data-min @input="markDirty">
          </label>
          <label class="ed__field">
            <span class="ed__label">短标签（≤6 字）</span>
            <input v-model="form.short" class="ed__input" type="text" maxlength="6" data-short placeholder="音符块上那四个字" @input="markDirty">
          </label>
        </div>

        <label class="ed__field ed__field--wide">
          <span class="ed__label">一句话简介</span>
          <input v-model="form.blurb" class="ed__input" type="text" maxlength="140" data-blurb placeholder="出现在索引、归档和文章列表里" @input="markDirty">
        </label>

        <div class="ed__tools">
          <span class="ed__tools-label">往正文里插</span>
          <button class="ed__tool" type="button" data-add="image" @click="pick('image')">图片</button>
          <button class="ed__tool" type="button" data-add="video" @click="pick('video')">视频</button>
          <button class="ed__tool" type="button" data-add="audio" @click="pick('audio')">音乐</button>
          <span class="ed__tools-note">也可以把文件拖进下面的正文框，或者 <code>Ctrl+V</code> 直接粘截图</span>
          <input ref="fileImage" type="file" accept="image/*" multiple hidden data-file="image" @change="onFilePicked('image', $event)">
          <input ref="fileVideo" type="file" accept="video/*" multiple hidden data-file="video" @change="onFilePicked('video', $event)">
          <input ref="fileAudio" type="file" accept="audio/*" multiple hidden data-file="audio" @change="onFilePicked('audio', $event)">
        </div>

        <textarea
          ref="sourceEl"
          v-model="form.source"
          class="ed__text"
          :class="{ 'is-over': isOver }"
          data-source
          rows="18"
          placeholder="正文。空行分段；## 小标题；- 列表；&gt; 引用；三个反引号包代码块。"
          @input="onSourceInput"
          @dragenter.prevent="isOver = true"
          @dragover.prevent="isOver = true"
          @dragleave.prevent="isOver = false"
          @drop.prevent="onDrop"
          @paste="onPaste"
        ></textarea>

        <p class="ed__tips">
          <b>#</b>–<b>######</b> 六档标题 · <b>-</b> / <b>1.</b> 列表（可以嵌套）· <b>&gt;</b> 引用 · 三个反引号包代码块 ·
          <b>**粗体**</b> · <b>*斜体*</b> · <b>~~划掉~~</b> · <b>`代码`</b> · <b>[文字](链接)</b> · 图片用 <b>![说明](地址)</b> ·
          表格用 <b>| 列 | 列 |</b> 加一行 <b>|---|---|</b> · 任务列表写 <b>- [x]</b> ·
          公式 <b>$行内$</b> 与独立一行 <b>$$…$$</b>（也可以写 <b>\(…\)</b> / <b>\[…\]</b>，KaTeX 支持的都认）·
          emoji 直接打，或者写 <b>:smile:</b> 这样的短代码。
          一行以 <code>&lt;</code> 开头就整块原样放行——视频、音频就是靠它插进去的。
        </p>

        <ul v-if="assets.length" class="ed__att" data-att>
          <li v-for="(a, i) in assets" :key="`${a.file}-${i}`" class="ed__att-item">
            <span class="ed__att-kind">{{ KIND_LABEL[a.kind] || a.kind }}</span>
            <span class="ed__att-name">{{ a.original || a.file }}</span>
          </li>
        </ul>
      </section>

      <aside class="ed__col ed__col--side">
        <div class="ed__block">
          <p class="ed__sidelabel">预览</p>
          <!-- 预览是服务端（与文章页同一个渲染器）排好版的 HTML -->
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div class="prose ed__preview" data-previewbox v-html="previewHtml"></div>
        </div>
        <div class="ed__block">
          <p class="ed__sidelabel">我写的（存在服务里）</p>
          <ol class="ed__list" data-list>
            <li v-if="!articles.length" class="ed__empty">还没有。写完第一篇就会出现在这儿。</li>
            <li
              v-for="a in articles"
              :key="a.id"
              class="ed__list-item"
              :class="{ 'is-editing': a.id === editing }"
              :data-id="a.id"
            >
              <div>
                <a class="ed__list-title" :href="`/posts/${a.slug}`" target="_blank" rel="noopener">{{ a.title }}</a>
                <span class="ed__list-meta">{{ a.date }} · {{ a.section }}<template v-if="a.assets"> · {{ a.assets }} 个附件</template></span>
              </div>
              <span class="ed__list-acts">
                <button type="button" :data-edit="a.id" @click="openArticle(a.id)">编辑</button>
                <button type="button" :data-del="a.id" @click="removeArticle(a.id)">删</button>
              </span>
            </li>
          </ol>
        </div>
      </aside>
    </div>
  </main>
</template>

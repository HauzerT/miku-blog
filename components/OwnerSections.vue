<script setup>
/* ==========================================================================
   components/OwnerSections.vue · 站长工具箱里的「新建板块 / 子板块」
   ---------------------------------------------------------------------------
   上半张表建板块（名字 / 音高 / 一句话定义 / 导语），下半张表给现有板块加子板块、
   列出它已经有的子板块并能删。音高下拉里被占用的音标出来且不能选，
   空着的音里推荐服务给的那一个（它接在卷帘最上面，听起来最轻）。

   建完 / 删完都要喊一声 refreshSite()：轨道栏、首页索引、卷帘读的是同一份共享
   状态（useSite），重取一次就够——不需要任何「就地改 DOM」的活儿。

   写操作全部走 withKey：没有口令 / 口令过期时服务回 401，口令框弹出来，
   输完这一次自动重放。
   ========================================================================== */
const { toast } = useToast()
const { withKey, authed } = useStudio()

/* 十二平均律，C2 到 B6 */
const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const PITCHES = []
for (let octave = 2; octave <= 6; octave += 1) {
  for (const name of PITCH_NAMES) PITCHES.push(name + octave)
}

const sections = ref([])
const suggested = ref('')
const name = ref('')
const pitch = ref('')
const def = ref('')
const lede = ref('')
const parentId = ref('')
const subName = ref('')

const parent = computed(() => sections.value.find((s) => s.id === parentId.value) || null)
const subs = computed(() => (parent.value && parent.value.subs) || [])
const takenBy = (p) => {
  const found = sections.value.find((s) => s.pitch === p)
  return found ? found.name : ''
}

const reload = async () => {
  const data = await fetchJson('sections')
  sections.value = data.sections || []
  suggested.value = data.suggestPitch || ''
  /* 选中的音被占了（比如刚建完）或者还没选过：落回推荐的那个空音上 */
  if (!pitch.value || takenBy(pitch.value)) {
    pitch.value = suggested.value || PITCHES.find((p) => !takenBy(p)) || ''
  }
  if (!parentId.value || !sections.value.some((s) => s.id === parentId.value)) {
    parentId.value = sections.value.length ? sections.value[0].id : ''
  }
}

onMounted(() => {
  reload().catch((err) => toast(apiError(err), true))
})

const createSection = async () => {
  const value = name.value.trim()
  if (!value) return toast('板块要有个名字', true)
  if (takenBy(pitch.value)) return toast(pitch.value + ' 已经被占用了，换一个', true)

  const form = new FormData()
  form.append('name', value)
  form.append('pitch', pitch.value)
  form.append('def', def.value.trim())
  form.append('lede', lede.value.trim())

  try {
    await withKey(() => upload('sections', form))
    toast('板块「' + value + '」建好了，去 ' + pitch.value + ' 那条轨道看看')
    name.value = ''
    def.value = ''
    lede.value = ''
    await reload()
    await refreshSite()
  } catch (err) {
    toast(apiError(err), true)
  }
}

const createSub = async () => {
  const value = subName.value.trim()
  if (!value) return toast('子板块要有个名字', true)
  if (!parentId.value) return

  const form = new FormData()
  form.append('name', value)
  try {
    await withKey(() => upload('sections/' + encodeURIComponent(parentId.value) + '/subs', form))
    subName.value = ''
    toast('子板块「' + value + '」加好了')
    await reload()
    await refreshSite()
  } catch (err) {
    toast(apiError(err), true)
  }
}

const dropSub = async (subId) => {
  if (!window.confirm('删掉这个子板块？')) return
  try {
    await withKey(() =>
      authed('sections/' + encodeURIComponent(parentId.value) + '/subs/' + encodeURIComponent(subId), {
        method: 'DELETE',
      })
    )
    toast('删掉了')
    await reload()
    await refreshSite()
  } catch (err) {
    toast(apiError(err), true)
  }
}
</script>

<template>
  <form class="sc" novalidate @submit.prevent="createSection">
    <div class="sc__head">
      <p class="sc__eyebrow">新建板块</p>
      <p class="sc__hint">板块 = 卷帘上的一条轨道。给它一个音高、一个名字、一句话定义，它就会出现在左边的轨道栏和首页索引里。</p>
    </div>
    <div class="sc__row">
      <label class="sc__field">
        <span class="sc__label">名字</span>
        <input v-model="name" class="sc__input" type="text" maxlength="40" required placeholder="比如：深夜厨房" data-name>
      </label>
      <label class="sc__field sc__field--pitch">
        <span class="sc__label">音高</span>
        <select v-model="pitch" class="sc__select" data-pitch>
          <option v-for="p in PITCHES" :key="p" :value="p" :disabled="Boolean(takenBy(p))">
            {{ p }}{{ takenBy(p) ? '（已被「' + takenBy(p) + '」占用）' : p === suggested ? '（推荐：空着的）' : '' }}
          </option>
        </select>
      </label>
    </div>
    <label class="sc__field">
      <span class="sc__label">一句话定义</span>
      <input v-model="def" class="sc__input" type="text" maxlength="120" placeholder="出现在板块标题下面" data-def>
    </label>
    <label class="sc__field">
      <span class="sc__label">导语（可留空）</span>
      <textarea v-model="lede" class="sc__text" rows="2" maxlength="400" placeholder="这里写什么、不写什么" data-lede></textarea>
    </label>
    <p class="sc__warn" data-warn :hidden="!suggested">{{ suggested ? '空着的音里推荐 ' + suggested + '：它接在卷帘最上面，听起来最轻。' : '' }}</p>
    <div class="sc__foot">
      <button class="sc__send" type="submit" data-create>建这个板块</button>
    </div>

    <div class="sc__divider"><span>现有板块的子板块</span></div>
    <div class="sc__subs">
      <label class="sc__field">
        <span class="sc__label">加到哪个板块</span>
        <select v-model="parentId" class="sc__select" data-parent>
          <option v-for="s in sections" :key="s.id" :value="s.id">{{ s.pitch }} · {{ s.name }}</option>
        </select>
      </label>
      <div class="sc__row">
        <label class="sc__field">
          <span class="sc__label">子板块名字</span>
          <input v-model="subName" class="sc__input" type="text" maxlength="40" placeholder="比如：家常 / 探店" data-subname>
        </label>
        <button class="sc__mini" type="button" data-addsub @click="createSub">加子板块</button>
      </div>
      <ul class="sc__list" data-sublist>
        <li v-if="!subs.length" class="sc__list-empty">这个板块还没有子板块。</li>
        <li v-for="sub in subs" :key="sub.id" class="sc__item">
          <NuxtLink class="sc__item-name" :to="`/sections/${encodeURIComponent(parentId)}/${encodeURIComponent(sub.id)}`">{{ sub.name }}</NuxtLink>
          <span class="sc__item-id">{{ sub.id }}</span>
          <button class="sc__item-x" type="button" :data-dropsub="sub.id" aria-label="删除子板块" @click="dropSub(sub.id)">×</button>
        </li>
      </ul>
    </div>
  </form>
</template>

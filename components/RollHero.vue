<script setup>
/* ==========================================================================
   首页那条大卷帘：时间轴 = 本站目录
   ---------------------------------------------------------------------------
   卷帘的规矩只有这几条：class 名与层级听 `assets/css/roll.css`，音符的横轴位置与宽度
   全部由 `content/roll.mjs` 的接龙算式算出来（SSR 与浏览器共用这一份）。
   运行时行为（扫光点亮、悬停读数、键盘导航、Ctrl+滚轮调尺度）来自
   composables/useRoll.ts。
   ========================================================================== */
import { noteWidth, slotOf, timelineChain, chainMonths, timelineSpan } from '../content/roll.mjs'

const props = defineProps({ tracks: { type: Array, required: true } })

const chain = computed(() => timelineChain(props.tracks.flatMap((t) => t.posts || [])))
const months = computed(() => chainMonths(chain.value))
const spanDays = computed(() => (chain.value ? chain.value.span : 0))
const days = computed(() => (spanDays.value ? Math.ceil(spanDays.value) : 0))

/* 先把每篇的位置算出来。同月的几篇在接龙轴上天然一篇挨一篇，各自独立，不归拢 */
const placed = computed(() => {
  const posOf = new Map()
  if (chain.value) for (const n of chain.value.notes) posOf.set(n.post, n)
  const span = spanDays.value
  const out = []
  props.tracks.forEach((track, ti) => {
    track.posts
      .slice()
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .forEach((post) => {
        const pos = posOf.get(post)
        const fallback = noteWidth(slotOf(track, ti), Math.max(0, track.posts.indexOf(post)))
        out.push({
          post,
          track,
          ti,
          x: pos && span ? Number(((pos.x / span) * 100).toFixed(2)) : fallback[0],
          w: pos ? Number(pos.w.toFixed(2)) : fallback[1],
        })
      })
  })
  return out
})

const lanes = computed(() =>
  props.tracks.map((track) => ({
    track,
    notes: placed.value.filter((n) => n.track === track),
  }))
)

const total = computed(() => props.tracks.reduce((n, t) => n + (t.posts || []).length, 0))
const first = computed(() => props.tracks[0] || { pitch: '' })
const last = computed(() => props.tracks[props.tracks.length - 1] || { pitch: '' })
const span = computed(() => {
  const dates = props.tracks.flatMap((t) => (t.posts || []).map((p) => p.date)).filter(Boolean).sort()
  return timelineSpan(dates[0], dates[dates.length - 1])
})

const rootEl = ref(null)
/* 待机文案：触摸设备上既没有指针也没有方向键，换一套说辞 */
const idle = ref('把指针停在音符上，会报出日子与时长')
const live = ref('把指针停在音符上，会报出日子与时长')
const isLive = ref(false)
const lit = reactive({})
const noteKey = (n) => `${n.track.id}:${n.post.slug}`

const show = (n) => {
  live.value = [n.track.pitch, n.post.title, n.post.date, `${n.post.min} 分钟`].filter(Boolean).join(' · ')
  isLive.value = true
}
const clear = () => {
  live.value = idle.value
  isLive.value = false
}

const { onKeydown } = useRollKeys(rootEl)
useRollZoom(rootEl)

onMounted(() => {
  if (window.matchMedia && window.matchMedia('(hover: none)').matches) {
    idle.value = '点音符进文章；左边的轨道名也能点'
    live.value = idle.value
  }

  /* 播放头扫过一次，经过的音符依次点亮；随后全站再无自动动画。
     终点按最右那格音符归一，不写死。 */
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduce || !document.documentElement.classList.contains('js')) {
    for (const n of placed.value) lit[noteKey(n)] = true
  } else {
    const maxX = placed.value.reduce((m, n) => Math.max(m, Number(n.x) || 0), 0) || 93
    const timers = placed.value.map((n) =>
      setTimeout(() => {
        lit[noteKey(n)] = true
      }, Math.min(2200, ((Number(n.x) || 0) / maxX) * 2200))
    )
    onBeforeUnmount(() => timers.forEach(clearTimeout))
  }

  measureRolls()
})
</script>

<template>
  <div
    ref="rootEl"
    class="roll roll--hero roll--bleed"
    :style="days ? { '--days': String(days) } : undefined"
    data-roll
    @keydown="onKeydown"
  >
    <div class="roll__bar">
      <p class="roll__caption">时间轴 · 本站目录</p>
      <p class="roll__live" data-live :data-idle="idle" :class="{ 'is-live': isLive }">{{ live }}</p>
      <p class="roll__readout"><b>{{ props.tracks.length }}</b> 轨 · <b>{{ total }}</b> 篇 · <b>{{ span }}</b> · {{ last.pitch }}–{{ first.pitch }}</p>
    </div>
    <div class="roll__scroller">
      <div class="roll__inner">
        <div class="roll__heads">
          <NuxtLink v-for="track in props.tracks" :key="track.id" class="head" :data-pitch="track.pitch" :to="`/sections/${track.id}`">
            <span class="head__name">{{ track.name }}</span>
            <span class="head__count">{{ (track.posts || []).length }} 篇</span>
          </NuxtLink>
        </div>
        <div class="roll__keys" aria-hidden="true">
          <span v-for="track in props.tracks" :key="track.id" class="keycap" :class="{ 'keycap--black': track.black }"></span>
        </div>
        <div class="roll__field">
          <div class="roll__ruler" aria-hidden="true">
            <span
              v-for="m in months"
              :key="m.label"
              class="roll__month"
              :style="{ '--x': String(m.x) }"
            >{{ m.label }}{{ m.count > 1 ? ` · ${m.count} 篇` : '' }}</span>
          </div>
          <div class="roll__body">
            <div class="roll__lanes">
              <div v-for="lane in lanes" :key="lane.track.id" class="lane" :class="{ 'lane--black': lane.track.black }">
                <NuxtLink
                  v-for="n in lane.notes"
                  :key="n.post.slug"
                  class="note"
                  :class="{ 'is-lit': lit[noteKey(n)] }"
                  :style="{ '--x': String(n.x), '--w': String(n.w) }"
                  :data-x="n.x"
                  :data-date="n.post.date"
                  :data-pitch="lane.track.pitch"
                  :data-title="n.post.title"
                  :data-min="n.post.min"
                  :to="`/posts/${n.post.slug}`"
                  :aria-label="`${n.post.date} · ${n.post.title}（${lane.track.name}，${n.post.min} 分钟）`"
                  @mouseenter="show(n)"
                  @mouseleave="clear()"
                  @focus="show(n)"
                  @blur="clear()"
                ><span class="note__short">{{ n.post.short }}</span></NuxtLink>
              </div>
            </div>
          </div>
          <div class="roll__playhead" aria-hidden="true"></div>
        </div>
      </div>
    </div>
  </div>
  <p class="roll__hint">时间轴可以左右滑动；同一个月的几篇一篇挨一篇排在一起，各回各的轨道。</p>
</template>

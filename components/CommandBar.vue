<script setup>
/* 命令栏：站名、四个去处、以及三颗站长/体验按钮。
   三颗按钮默认 hidden —— 与静态页同一条规矩：没 JS（或没服务）就不摆按不动的东西。

   「全局编辑」那一颗与旧站 editmode.js 同一把尺：**服务在线 + 这个浏览器里有口令**
   才解开 hidden。两个条件少一个都是访客，访客的页面连 hidden 都不会解开——
   旧站那句话是「不摆一把用不了的钥匙」。真正的权限仍然在服务端（每一次 PATCH 都要口令）。

   窄屏（≤720px）上那颗按钮的文案换短的一套：旧站用的是同一个 720px 断点。 */
const props = defineProps({ current: { type: String, default: '' } })

const site = useSiteMeta()
const { ready, label, ariaLabel, dark, toggle } = useTheme()
const {
  ready: soundReady,
  enabled: soundOn,
  label: soundLabel,
  ariaLabel: soundAria,
  toggle: toggleSound,
} = useSound()

/* 身份的两个事实都从 useStudio 拿：StudioDock 探完服务 / 读出口令之后，
   这两颗 ref 会变，按钮跟着出现——与旧站的 cv01:online / cv01:key 同一条。 */
const { online, keyValue } = useStudio()
const { editMode, toggle: toggleEdit } = useEditMode()
const owner = computed(() => Boolean(online.value && keyValue.value))
const narrow = ref(false)

/* 窄屏那一套文案（旧站 matchMedia('(max-width: 720px)')） */
const measure = () => {
  narrow.value = Boolean(window.matchMedia && window.matchMedia('(max-width: 720px)').matches)
}
onMounted(() => {
  measure()
  window.addEventListener('resize', measure)
})
onBeforeUnmount(() => window.removeEventListener('resize', measure))

const on = computed(() => editMode.value)
const editLabel = computed(() => (on.value ? (narrow.value ? '编辑中' : '退出编辑') : narrow.value ? '编辑' : '全局编辑'))
const editAria = computed(() => (on.value ? '退出全局编辑模式' : '进入全局编辑模式：点页面上的文字直接改'))
const editTitle = computed(() => (on.value ? '退出编辑模式（Esc）' : '点页面上的文字直接改，不用右键'))

const items = [
  { to: '/', label: '首页', id: 'home' },
  { to: '/kumura', label: '云村', id: 'kumura' },
  { to: '/archive', label: '归档', id: 'archive' },
  { to: '/about', label: '关于', id: 'about' },
]
</script>

<template>
  <header class="bar">
    <NuxtLink class="bar__id" to="/">{{ site.brand }} <span>{{ site.mark }}</span></NuxtLink>
    <nav class="bar__nav" aria-label="站点">
      <NuxtLink
        v-for="item in items"
        :key="item.id"
        :to="item.to"
        :aria-current="props.current === item.id ? 'page' : undefined"
      >{{ item.label }}</NuxtLink>
    </nav>
    <button
      class="bar__edit"
      type="button"
      data-edit-toggle
      :hidden="!owner"
      :aria-pressed="on ? 'true' : 'false'"
      :aria-label="editAria"
      :title="editTitle"
      @click="toggleEdit"
    >{{ editLabel }}</button>
    <button
      class="bar__theme"
      type="button"
      data-theme-toggle
      :hidden="!ready"
      :aria-pressed="dark ? 'true' : 'false'"
      :aria-label="ariaLabel"
      @click="toggle"
    >{{ label }}</button>
    <!-- 「开启音效」：默认关着。CSS 里 .bar__sound 的 display 会盖过 hidden，
         SSR 出来的那一瞬就看得见，与静态页一样（那边也是脚本挂载后才解开）。 -->
    <button
      class="bar__sound"
      type="button"
      data-sound-toggle
      :hidden="!soundReady"
      :aria-pressed="soundOn ? 'true' : 'false'"
      :aria-label="soundAria"
      @click="toggleSound"
    >{{ soundLabel }}</button>
  </header>
</template>

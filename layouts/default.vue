<script setup>
/* ==========================================================================
   layouts/default.vue · 全站外壳
   ---------------------------------------------------------------------------
   与 server/lib/shell.mjs 的 page() 一一对应：跳过链接、每日一句、命令栏、
   轨道栏、正文、页脚、悬浮球。这里不再拼字符串，而是组件——但吐出来的
   class 名与层级和静态页**完全一致**，所以 assets/css 一个字节都不用改。

   「当前在哪一页」不由页面告诉外壳，而是从路由算出来：页面 setup 跑在外壳
   模板之前，靠 props 传会慢一拍。见 server/lib/shell.mjs 的 nav / currentSection。
   ========================================================================== */
const route = useRoute()
const tracks = useTracks()

const nav = computed(() => {
  const p = route.path
  if (p === '/') return 'home';
  if (p.startsWith('/archive')) return 'archive';
  if (p.startsWith('/about')) return 'about';
  if (p.startsWith('/kumura')) return 'kumura';
  return '';
})

/* 板块页与文章页的正文窄一档（.sect-main），与 shell.mjs 的 nav==='section'|'post' 同义 */
const isSect = computed(() => route.path.startsWith('/sections/') || route.path.startsWith('/posts/'))

const currentSection = computed(() => {
  if (route.path.startsWith('/sections/')) return String(route.params.id || '')
  if (route.path.startsWith('/posts/')) return String(route.params.id || '')
  return ''
})

/* 窗口一改尺寸就重新量一遍卷帘：只有真的横向溢出了才说「可以左右滑动」 */
onMounted(() => {
  measureRolls()
  window.addEventListener('resize', measureRolls)
  onBeforeUnmount(() => window.removeEventListener('resize', measureRolls))
})
</script>

<template>
  <a class="skip" href="#main">跳到正文</a>
  <EpigraphBlock />
  <CommandBar :current="nav" />
  <div class="shell">
    <TrackRail :current="currentSection" :tracks="tracks" />
    <main :class="isSect ? 'main sect-main' : 'main'" id="main">
      <slot />
    </main>
    <SiteFooter />
  </div>
  <StudioDock />
</template>

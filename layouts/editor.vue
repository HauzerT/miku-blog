<script setup>
/* ==========================================================================
   layouts/editor.vue · 编辑页自己那张壳
   ---------------------------------------------------------------------------
   与旧的 editor.html 一致：命令栏只有站名、两个去处与主题按钮（没有轨道栏、
   没有每日一句、没有全局编辑）。它自己是一整块工作台，见 editor.css。
   ========================================================================== */
const site = useSiteMeta()
const { ready, label, ariaLabel, dark, toggle } = useTheme()

useHead({
  link: [
    { rel: 'stylesheet', href: '/assets/css/page.css' },
    { rel: 'stylesheet', href: '/assets/css/studio.css' },
    { rel: 'stylesheet', href: '/assets/css/editor.css' },
    /* 右栏预览里的数学公式要靠它（本地文件，字体是懒加载的） */
    { rel: 'stylesheet', href: '/assets/vendor/katex/katex.min.css' },
  ],
  script: [{ src: '/assets/js/palette.js' }],
})
</script>

<template>
  <a class="skip" href="#main">跳到正文</a>
  <header class="bar">
    <NuxtLink class="bar__id" to="/">{{ site.brand }} <span>{{ site.mark }}</span></NuxtLink>
    <nav class="bar__nav" aria-label="站点">
      <NuxtLink to="/editor" aria-current="page">写博客</NuxtLink>
      <NuxtLink to="/">回站点</NuxtLink>
    </nav>
    <button
      class="bar__theme"
      type="button"
      data-theme-toggle
      :hidden="!ready"
      :aria-pressed="dark ? 'true' : 'false'"
      :aria-label="ariaLabel"
      @click="toggle"
    >{{ label }}</button>
  </header>
  <slot />
  <StudioDock />
  <ToastBar />
</template>

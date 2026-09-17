<script setup>
/* ==========================================================================
   components/OwnerToolbox.vue · 站长工具箱面板
   ---------------------------------------------------------------------------
   三选一的菜单（新建板块 / 子板块、上传音乐盒的音乐、快速写一篇博客），
   每个子面板顶上一条「← 工具箱」。
   面板本身只有在验过口令之后才开得起来（见 StudioDock 的 openBall）。

   三个去处：
     · 新建板块 / 子板块 → OwnerSections.vue
     · 上传音乐盒的音乐  → MusicUpload.vue
     · 快速写一篇博客    → /editor，**整页跳**，不走局部刷新
   ========================================================================== */
const { focusPanel } = useStudio()
const view = ref('')

const back = () => {
  view.value = ''
  /* 子面板换回菜单之后重新收一下焦点 */
  focusPanel()
}
</script>

<template>
  <div v-if="!view" class="ow">
    <div class="ow__head">
      <p class="ow__eyebrow">站长工具箱</p>
      <p class="ow__hint">这里的东西都要写文件，所以只有输入过口令的浏览器进得来。音乐盒和站点本身对谁都一样。</p>
    </div>
    <button class="ow__item" type="button" data-go="section" @click="view = 'section'">
      <b>新建板块 / 子板块</b><span>给它一个音高，它就接进卷帘</span>
    </button>
    <button class="ow__item" type="button" data-go="music" @click="view = 'music'">
      <b>上传音乐盒的音乐</b><span>mp3 / m4a，传完立刻进曲库</span>
    </button>
    <NuxtLink class="ow__item" to="/editor" external data-no-spa>
      <b>快速写一篇博客</b><span>跳去编辑页：图片、视频、音乐都能带</span>
    </NuxtLink>
  </div>
  <div v-else>
    <div class="ow__bar">
      <button class="ow__back" type="button" @click="back">← 工具箱</button>
      <span class="ow__title">{{ view === 'section' ? '新建板块' : '上传音乐' }}</span>
    </div>
    <OwnerSections v-if="view === 'section'" />
    <MusicUpload v-else-if="view === 'music'" />
  </div>
</template>

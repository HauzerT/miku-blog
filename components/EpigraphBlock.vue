<script setup>
/* 页顶「每日一句」：句子来自胡盐乱雨集，指向那条轨道 */
const { text, title } = useExcerpt()
const site = useSite()
const suiyu = computed(() => (site.value.tracks || []).find((t) => t.id === 'suiyu') || (site.value.tracks || [])[0] || { id: 'suiyu', name: '胡盐乱雨集' })
</script>

<template>
  <aside class="epigraph" aria-label="每日一句">
    <div class="epigraph__inner">
      <NuxtLink class="epigraph__label" :to="`/sections/${suiyu.id}`">{{ suiyu.name }}</NuxtLink>
      <span class="epigraph__text" data-excerpt :title="title">{{ text }}</span>
      <span class="epigraph__note">每日一句</span>
    </div>
  </aside>
</template>

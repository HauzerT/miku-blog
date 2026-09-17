<script setup>
const site = useSiteMeta()
</script>

<template>
  <footer class="foot">
    <p class="foot__line">{{ site.brand }} {{ site.mark }} · 用卷帘当目录的个人博客骨架</p>
    <p class="foot__meta">{{ site.footer }}</p>
  </footer>
</template>

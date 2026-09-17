<script setup>
/* 轨道栏：一排琴键。低音在下，越往上越轻 —— 与首页卷帘同一份数据。 */
import { cn } from '../content/roll.mjs'

const props = defineProps({
  current: { type: String, default: '' },
  tracks: { type: Array, default: () => [] },
})

const voiceCn = computed(() => cn(props.tracks.length))
</script>

<template>
  <nav class="rail" aria-label="板块轨道">
    <p class="rail__label">轨道 · {{ voiceCn }}个音</p>
    <NuxtLink
      v-for="track in props.tracks"
      :key="track.id"
      class="key"
      :class="{ 'key--black': track.black }"
      :data-pitch="track.pitch"
      :to="`/sections/${track.id}`"
      :aria-current="props.current === track.id ? 'page' : undefined"
    ><span class="key__pitch">{{ track.pitch }}</span><span class="key__name">{{ track.name }}</span></NuxtLink>
  </nav>
</template>

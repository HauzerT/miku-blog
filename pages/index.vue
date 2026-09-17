<script setup>
/* 首页：卷帘 hero + 九板块索引 */
import { cn } from '../content/roll.mjs'

const site = useSiteMeta()
const tracks = useTracks()
const allPosts = computed(() => tracks.value.reduce((n, t) => n + (t.posts || []).length, 0))
const voiceCn = computed(() => cn(tracks.value.length))

/* 索引里那行小字的规矩：data 里写过 def 就用它，否则退回导语（def 是覆盖层优先级更高的那一个） */
const blurbOf = (track) => String((track.hasDefOverride ? track.def : track.lede) || '').replace(/<br\s*\/?>/gi, ' ')

useHead(() => ({
  title: `${site.value.brand} ${site.value.mark} · 个人博客`,
  meta: [{ name: 'description', content: site.value.desc }],
}))
</script>

<template>
  <section class="hero">
    <h1 class="hero__name">{{ site.brand }}</h1>
    <p class="hero__latin">{{ site.latin }}</p>
    <!-- eslint-disable-next-line vue/no-v-html -->
    <p class="hero__note" v-html="site.hero" />
  </section>

  <RollHero :tracks="tracks" />

  <div class="index-head">
    <h2>{{ voiceCn }}板块索引</h2>
    <p>{{ allPosts }} 篇 · {{ tracks.length }} 轨</p>
  </div>
  <ol class="entry-list">
    <li v-for="track in tracks" :key="track.id" class="entry">
      <p class="entry__pitch">{{ track.pitch }}</p>
      <div>
        <h3 class="entry__name"><NuxtLink :to="`/sections/${track.id}`">{{ track.name }}</NuxtLink></h3>
        <p class="entry__blurb">{{ blurbOf(track) }}</p>
        <p class="entry__recent">
          最近：<template v-for="(post, i) in (track.posts || []).slice(0, 2)" :key="post.slug"><span v-if="i" aria-hidden="true">·</span><NuxtLink :to="`/posts/${post.slug}`">{{ post.title }}</NuxtLink></template>
        </p>
      </div>
      <p class="entry__count">{{ (track.posts || []).length }} 篇</p>
    </li>
  </ol>
</template>

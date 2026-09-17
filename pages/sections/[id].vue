<script setup>
/* 板块页：迷你定位条 + 板块头 + 导语 + 子板块 + 文章列表 */
import { noteWidth, slotOf } from '../content/roll.mjs'

const route = useRoute()
const tracks = useTracks()
const track = useFindTrack(() => route.params.id)
const site = useSiteMeta()

if (!track.value) {
  throw createError({ statusCode: 404, statusMessage: '没有这个板块', message: `没有这个板块：${route.params.id}`, fatal: true })
}

const slot = computed(() => tracks.value.findIndex((t) => t.id === track.value.id))
const playX = computed(() => noteWidth(slotOf(track.value, slot.value < 0 ? 0 : slot.value), 0)[0])

useHead(() => ({
  title: `${track.value.name} · ${site.value.brand} ${site.value.mark}`,
  meta: [{ name: 'description', content: `${track.value.name}：${track.value.def || ''}` }],
}))
</script>

<template>
  <RollStrip v-if="track" :tracks="tracks" :current-id="track.id" current-slug="" :play-x="playX" />
  <template v-if="track">
    <header class="sect-head">
      <p class="sect-head__pitch">{{ track.pitch }}{{ track.black ? ' · 黑键' : '' }} · {{ track.posts.length }} 篇</p>
      <h1 class="sect-head__name">{{ track.name }}</h1>
      <!-- eslint-disable-next-line vue/no-v-html -->
      <p class="sect-head__def" v-html="track.def" />
    </header>
    <!-- eslint-disable-next-line vue/no-v-html -->
    <p class="lede" v-html="track.lede" />
    <nav v-if="track.subs.length" class="subnav" :aria-label="`${track.name}的子板块`">
      <NuxtLink v-for="sub in track.subs" :key="sub.id" class="subnav__item" :to="`/sections/${track.id}/${sub.id}`">
        <span class="subnav__name">{{ sub.name }}</span>
      </NuxtLink>
    </nav>
    <ol class="post-list">
      <li v-for="post in track.posts" :key="post.slug" class="post-row">
        <NuxtLink class="post-row__link" :to="`/posts/${post.slug}`">
          <time class="post-row__date">{{ post.date }}</time>
          <span class="post-row__title">{{ post.title }}</span>
          <span class="post-row__blurb">{{ post.blurb }}</span>
        </NuxtLink>
      </li>
    </ol>
  </template>
</template>

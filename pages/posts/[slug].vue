<script setup>
/* 文章页：迷你定位条 + 标题 + 正文 + 同轨道的上一篇 / 下一篇
   （正文在服务端就排好版，见 server/utils/content.ts —— 公式与 emoji
   都走 server/lib/markdown.mjs 这一条管线。） */
import { noteWidth, slotOf } from '../content/roll.mjs'

const route = useRoute()
const tracks = useTracks()
const site = useSiteMeta()
const post = useFindPost(() => route.params.slug)

if (!post.value) {
  throw createError({ statusCode: 404, statusMessage: '没有这篇文章', message: `没有这篇文章：${route.params.slug}`, fatal: true })
}

const siblings = computed(() => post.value?.track?.posts || [])
const index = computed(() => siblings.value.findIndex((p) => p.slug === post.value?.slug))
const prev = computed(() => (index.value > 0 ? siblings.value[index.value - 1] : null))
const next = computed(() => (index.value >= 0 && index.value < siblings.value.length - 1 ? siblings.value[index.value + 1] : null))

const slot = computed(() => tracks.value.findIndex((t) => t.id === post.value?.track?.id))
const playX = computed(() => noteWidth(slotOf(post.value?.track, slot.value < 0 ? 0 : slot.value), Math.max(0, index.value))[0])

useHead(() => ({
  title: `${post.value?.title || ''} · ${site.value.brand} ${site.value.mark}`,
  meta: [{ name: 'description', content: post.value?.blurb || '' }],
  /* 只有真出现公式的那几篇才带上 KaTeX 的样式表 */
  link: post.value?.math ? [{ rel: 'stylesheet', href: '/assets/vendor/katex/katex.min.css' }] : [],
}))
</script>

<template>
  <template v-if="post">
    <RollStrip :tracks="tracks" :current-id="post.track.id" :current-slug="post.slug" :play-x="playX" />
    <article class="article">
      <header>
        <h1 class="article__title">{{ post.title }}</h1>
        <p class="article__meta">
          <time :datetime="post.date.replace(/\./g, '-')">{{ post.date }}</time>
          <span aria-hidden="true">·</span>
          <NuxtLink :to="`/sections/${post.track.id}`">{{ post.track.name }}</NuxtLink>
          <span aria-hidden="true">·</span>
          <span>{{ post.min }} 分钟</span>
        </p>
      </header>
      <div class="prose">
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div v-if="post.body" v-html="post.body" />
        <p v-else class="empty">
          这篇还没写。骨架先留在这里：打开 <code>content/posts.mjs</code>，把这条记录的
          <code>body</code> 填上（刷新页面就是新的），或者直接在编辑页写。
        </p>
      </div>
      <nav class="pager" aria-label="同轨道的相邻文章">
        <div class="pager__item">
          <NuxtLink v-if="prev" :to="`/posts/${prev.slug}`">
            <span class="pager__label">上一首 · {{ post.track.pitch }}</span>
            <span class="pager__title">{{ prev.title }}</span>
          </NuxtLink>
        </div>
        <div class="pager__item pager__item--next">
          <NuxtLink v-if="next" :to="`/posts/${next.slug}`">
            <span class="pager__label">下一首 · {{ post.track.pitch }}</span>
            <span class="pager__title">{{ next.title }}</span>
          </NuxtLink>
        </div>
      </nav>
    </article>
  </template>
</template>

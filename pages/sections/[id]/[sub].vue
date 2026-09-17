<script setup>
/* 子板块页：板块页上那条子板块导航指着它。
   旧服务端把这一页叫 dynamicSubPage（server/lib/pages.mjs），这里同一个意思。 */
const route = useRoute()
const tracks = useTracks()
const track = useFindTrack(() => route.params.id)
const site = useSiteMeta()

const sub = computed(() => (track.value?.subs || []).find((s) => s.id === route.params.sub) || null)
const posts = computed(() => (track.value?.posts || []).filter((p) => p.sub === route.params.sub))

if (!track.value || !sub.value) {
  throw createError({ statusCode: 404, statusMessage: '没有这个子板块', message: `没有这个子板块：${route.params.id}/${route.params.sub}`, fatal: true })
}

useHead(() => ({
  title: `${sub.value?.name || ''} · ${track.value?.name || ''} · ${site.value.brand} ${site.value.mark}`,
  meta: [{ name: 'description', content: sub.value?.def || '' }],
}))
</script>

<template>
  <header class="sect-head">
    <p class="sect-head__pitch">{{ track?.pitch }} · {{ track?.name }}</p>
    <h1 class="sect-head__name">{{ sub?.name }}</h1>
    <p v-if="sub?.def" class="sect-head__def">{{ sub.def }}</p>
  </header>
  <ol class="post-list">
    <li v-for="post in posts" :key="post.slug" class="post-row">
      <NuxtLink class="post-row__link" :to="`/posts/${post.slug}`">
        <time class="post-row__date">{{ post.date }}</time>
        <span class="post-row__title">{{ post.title }}</span>
        <span class="post-row__blurb">{{ post.blurb }}</span>
      </NuxtLink>
    </li>
  </ol>
</template>

<script setup>
/* 归档：全部文章按年份倒序（与 tools/build.mjs 的 buildArchive() 同构） */
const tracks = useTracks()
const site = useSiteMeta()

const allPosts = computed(() =>
  tracks.value
    .flatMap((track) => (track.posts || []).map((post) => ({ ...post, track })))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
)

const years = computed(() => {
  const out = []
  for (const post of allPosts.value) {
    const year = String(post.date || '').slice(0, 4)
    let group = out.find((g) => g.year === year)
    if (!group) {
      group = { year, posts: [] }
      out.push(group)
    }
    group.posts.push(post)
  }
  return out
})

useHead(() => ({
  title: `归档 · ${site.value.brand} ${site.value.mark}`,
  meta: [{ name: 'description', content: '全部文章，按年份倒序。' }],
}))
</script>

<template>
  <header class="sect-head">
    <p class="sect-head__pitch">{{ allPosts.length }} 篇 · {{ tracks.length }} 轨</p>
    <h1 class="sect-head__name">归档</h1>
    <p class="sect-head__def">按年份倒序。每条前面是日期，后面是它所属的板块。</p>
  </header>
  <section v-for="group in years" :key="group.year" class="year">
    <div class="year__head">
      <span class="year__num">{{ group.year }}</span>
      <span class="year__count">{{ group.posts.length }} 篇</span>
    </div>
    <ol class="post-list">
      <li v-for="post in group.posts" :key="post.slug" class="post-row">
        <NuxtLink class="post-row__link" :to="`/posts/${post.slug}`">
          <time class="post-row__date">{{ post.date }}</time>
          <span class="post-row__title">{{ post.title }}</span>
          <span class="post-row__blurb">{{ post.track.name }} · {{ post.blurb }}</span>
        </NuxtLink>
      </li>
    </ol>
  </section>
</template>

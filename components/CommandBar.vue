<script setup>
/* 命令栏：站名、四个去处、以及三颗站长/体验按钮。
   三颗按钮默认 hidden —— 与静态页同一条规矩：没 JS（或没服务）就不摆按不动的东西。
   音效那颗等「钢琴声」那一半搬完之后再解开（见 composables/useSound，下一轮）。 */
const props = defineProps({ current: { type: String, default: '' } })

const site = useSiteMeta()
const { ready, label, ariaLabel, dark, toggle } = useTheme()

const items = [
  { to: '/', label: '首页', id: 'home' },
  { to: '/kumura', label: '云村', id: 'kumura' },
  { to: '/archive', label: '归档', id: 'archive' },
  { to: '/about', label: '关于', id: 'about' },
]
</script>

<template>
  <header class="bar">
    <NuxtLink class="bar__id" to="/">{{ site.brand }} <span>{{ site.mark }}</span></NuxtLink>
    <nav class="bar__nav" aria-label="站点">
      <NuxtLink
        v-for="item in items"
        :key="item.id"
        :to="item.to"
        :aria-current="props.current === item.id ? 'page' : undefined"
      >{{ item.label }}</NuxtLink>
    </nav>
    <button class="bar__edit" type="button" data-edit-toggle hidden>全局编辑</button>
    <button
      class="bar__theme"
      type="button"
      data-theme-toggle
      :hidden="!ready"
      :aria-pressed="dark ? 'true' : 'false'"
      :aria-label="ariaLabel"
      @click="toggle"
    >{{ label }}</button>
    <button class="bar__sound" type="button" data-sound-toggle hidden>开启音效</button>
  </header>
</template>

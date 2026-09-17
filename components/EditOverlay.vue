<script setup>
/* ==========================================================================
   components/EditOverlay.vue · 站长那两只手的宿主
   ---------------------------------------------------------------------------
   旧站的右键菜单与「页面上直接改字」是挂在 document 上的两段 IIFE
   （studio.js），全局编辑模式是第三段（editmode.js）。到了 Nuxt 这边，
   属于页面的东西交给组件（工具条 / 菜单 / 浮层），属于**文档**的东西
   （contextmenu / click / keydown 那几条监听器、以及那一份共享状态）
   归这一个组件——它挂在 StudioDock 里，全站每一页、换页不重建。

   它做四件事：
     1) 搭两座桥：toast 与 refreshSite（见 composables/useEditBridge.ts）
     2) 装 document 级的监听器：点字即改、Esc、右键菜单
     3) 把工具条 / 右键菜单 / 「问一句」浮层渲染出来
     4) 拿 useStudio 的两个事实（服务在线、浏览器里有口令）当「是不是站长」

   口令被忘掉（门厅的「访客进入」）时，编辑模式当场退出——与旧站
   editmode.js 的 refresh() 同一条。
   ========================================================================== */
import { useEditBridge } from '../composables/useEditBridge'
import { useContextMenu, installContextMenu, uninstallContextMenu } from '../composables/useContextMenu'
import { exitEditMode, editModeClick, editModeEscape, setEditModeOwner, useEditMode } from '../composables/useEditMode'
import { editActive, useInlineEditHost } from '../composables/useInlineEdit'

const { online, keyValue } = useStudio()

/* 两座桥：toast 与 refreshSite 都只能在组件 setup 里取出来 */
useEditBridge()

/* 站点共享状态要重取（改完名字 / 撤下之后整站跟着变）。
   「一次只改一段」那段会话也归这一个组件管生命周期。 */
useInlineEditHost({
  refresh: () => refreshSite(),
})

/* 「是不是站长」：服务在线 + 这个浏览器里有口令。少一个都是访客 */
const owner = computed(() => Boolean(online.value && keyValue.value))
setEditModeOwner(() => owner.value)

/* 留一份给自检/调试看：与旧站的 window.cv01 同一个用途 */
if (import.meta.client) {
  window.cv01 = Object.assign(window.cv01 || {}, {
    direct: {
      active: () => editActive(),
    },
    isOnline: () => online.value,
    key: () => keyValue.value,
  })
}

/* 编辑模式与 Nuxt 的共享内容绑在一起（描点跟着重渲染重来） */
const { editMode } = useEditMode()

/* 右键菜单要的那份状态（渲染用），监听器只在浏览器里装 */
useContextMenu()

/* 口令没了 / 过期了：编辑模式与手上的那一段都收掉（旧站 editmode.js 的 refresh） */
watch(owner, (now) => {
  if (now) return
  if (editMode.value) exitEditMode()
})

const onDocClick = (event) => editModeClick(event)
const onDocKey = (event) => editModeEscape(event)

onMounted(() => {
  /* 文档级的监听器都装在这里：服务端没有 document 可听。
     点字即改用捕获（要在链接自己的跳转之前拦下来）；Esc 用冒泡。 */
  document.addEventListener('click', onDocClick, true)
  document.addEventListener('keydown', onDocKey)

  /* 右键菜单：文档级一个监听器，按页面上现有的 class 与 data- 钩子认身份 */
  installContextMenu(() => online.value)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick, true)
  document.removeEventListener('keydown', onDocKey)
  uninstallContextMenu()
})
</script>

<template>
  <RteToolbar />
  <CtxMenu />
  <AskDialog />
</template>

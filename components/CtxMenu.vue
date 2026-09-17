<script setup>
/* ==========================================================================
   components/CtxMenu.vue · 右键那一小条（旧站 studio.js 的 openMenu）
   ---------------------------------------------------------------------------
   站长右键轨道栏的板块 / 文章行 / 卷帘上的音符 / 正文时出来。
   class 与旧站一个不差（.ctx / .ctx__item / .ctx__item--danger），
   所以 assets/css/studio.css 里那一段直接生效。

   位置由 useContextMenu 量好（先摆到屏幕外量尺寸，再贴着指针摆、不许出界）。
   菜单项上的动作住在模块级那份数组里——state 只摆看得见的字，
   函数不能塞进 state（payload 要序列化）。

   键盘一样能用：Tab 到那一项上按 Shift+F10（或菜单键），上下箭头换项，Esc 收起。
   ========================================================================== */
import { useContextMenu } from '../composables/useContextMenu'

const { menuState, runMenuItem } = useContextMenu()
</script>

<template>
  <div
    v-show="menuState.on"
    class="ctx"
    role="menu"
    :aria-label="menuState.label"
    :style="{ left: `${menuState.x}px`, top: `${menuState.y}px` }"
    @contextmenu.prevent
  >
    <button
      v-for="(item, i) in menuState.items"
      :key="i"
      :class="['ctx__item', { 'ctx__item--danger': item.danger }]"
      type="button"
      role="menuitem"
      @click="runMenuItem(i)"
    >{{ item.label }}</button>
  </div>
</template>

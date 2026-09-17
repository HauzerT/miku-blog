<script setup>
/* ==========================================================================
   components/RteToolbar.vue · 文字工具条（旧站 studio.js 的 buildBar）
   ---------------------------------------------------------------------------
   右键 → 「编辑正文…」之后（或全局编辑模式里点一下字），页面上多出来的那一条，
   像 Word 顶上那条。class 名与旧站一个不差，所以 assets/css/studio.css 里
   那一段 .rte__* 直接生效。

   按钮用文字不用图标——这一站里 B / I / U / S 这四个字母人人都认得，
   配一条彩色下边就够说明颜色（U 两颗：青 / 粉）。

   位置：贴着命令栏往下挂（.rte 的 top 由这里给）。命令栏是 sticky 的，
   位置随滚动变，所以 barTop 由 useInlineEdit 每次开、每次滚现算。
   ========================================================================== */
import { useInlineEdit } from '../composables/useInlineEdit'

const { edit, barTop, emojiOpen, label, kind, actions } = useInlineEdit()
const { setBlock, execCmd, underline, toggleEmoji, saveEdit, cancelEdit } = actions
</script>

<template>
  <div
    v-if="edit"
    class="rte"
    role="toolbar"
    :aria-label="label"
    :style="{ top: `${barTop}px` }"
  >
    <p class="rte__label">{{ label }}</p>

    <!-- 字号四档：一级 / 二级 / 正文 / 注释。板块页那两行字是版式的一部分，不给改字号 -->
    <div v-if="kind === 'body'" class="rte__group" role="group" aria-label="字号">
      <button class="rte__btn" type="button" title="一级标题（h2）" aria-label="一级标题（h2）" @mousedown.prevent @click="setBlock('h2', false)">一级</button>
      <button class="rte__btn" type="button" title="二级标题（h3）" aria-label="二级标题（h3）" @mousedown.prevent @click="setBlock('h3', false)">二级</button>
      <button class="rte__btn" type="button" title="正文段落" aria-label="正文段落" @mousedown.prevent @click="setBlock('p', false)">正文</button>
      <button class="rte__btn" type="button" title="注释（小字）" aria-label="注释（小字）" @mousedown.prevent @click="setBlock('p', true)">注释</button>
    </div>

    <div class="rte__group" role="group" aria-label="文字效果">
      <button class="rte__btn rte__btn--b" type="button" title="加粗" aria-label="加粗" @mousedown.prevent @click="execCmd('bold')">B</button>
      <button class="rte__btn rte__btn--i" type="button" title="斜体" aria-label="斜体" @mousedown.prevent @click="execCmd('italic')">I</button>
      <button class="rte__btn rte__btn--u rte__btn--cyan" type="button" title="下划线（青）" aria-label="下划线（青）" @mousedown.prevent @click="underline('var(--miku)')">U</button>
      <button class="rte__btn rte__btn--u rte__btn--pink" type="button" title="下划线（粉）" aria-label="下划线（粉）" @mousedown.prevent @click="underline('var(--cuer)')">U</button>
      <button class="rte__btn rte__btn--s" type="button" title="划掉" aria-label="划掉" @mousedown.prevent @click="execCmd('strikeThrough')">S</button>
      <button
        class="rte__btn rte__btn--emoji"
        :class="{ 'is-on': emojiOpen }"
        type="button"
        title="插入 emoji"
        aria-label="插入 emoji"
        @mousedown.prevent
        @click="toggleEmoji"
      >☺</button>
    </div>

    <div class="rte__group rte__group--acts" role="group" aria-label="保存还是算了">
      <button class="rte__btn rte__btn--save" type="button" title="保存（Ctrl+S）" aria-label="保存（Ctrl+S）" @mousedown.prevent @click="saveEdit">保存</button>
      <button class="rte__btn rte__btn--cancel" type="button" title="取消（Esc）" aria-label="取消（Esc）" @mousedown.prevent @click="cancelEdit">取消</button>
    </div>

    <p class="rte__hint">选中文字再加效果；Markdown 里也可以写 :smile:</p>

    <RteEmojiPicker v-if="emojiOpen" />
  </div>
</template>

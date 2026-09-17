<script setup>
/* ==========================================================================
   components/RteEmojiPicker.vue · emoji 面板（旧站 studio.js 的 toggleEmoji）
   ---------------------------------------------------------------------------
   在工具条里折一行出来，点一个插到光标处（走 execCommand('insertText')，
   所以撤销栈与光标都正常）。面板上的按钮 mousedown 一律 preventDefault——
   不然可编辑区一丢焦点，光标就没了，插进去的位置也就不对了。
   ========================================================================== */
import { EMOJI_PICKER, insertAtCaret } from '../composables/useInlineEdit'

const pick = (ch) => insertAtCaret(ch)
</script>

<template>
  <div class="rte__emoji" role="group" aria-label="emoji">
    <button
      v-for="ch in EMOJI_PICKER"
      :key="ch"
      class="rte__emoji-btn"
      type="button"
      :title="`插入 ${ch}`"
      :aria-label="`插入 ${ch}`"
      @mousedown.prevent
      @click="pick(ch)"
    >{{ ch }}</button>
  </div>
</template>

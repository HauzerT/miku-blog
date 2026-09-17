<script setup>
/* 提示条：平时 opacity 0 且 pointer-events: none，只有 is-on 时才露面
   （见 studio.css），所以一直挂在页面上不会挡住任何东西。 */
const { toastState, runAction } = useToast()
</script>

<template>
  <div class="studio__toast" role="status" :class="{ 'is-on': toastState.on, 'is-bad': toastState.bad }">
    <span>{{ toastState.text }}</span>
    <button v-if="toastState.actionLabel" type="button" class="studio__toast-act" @click="runAction">{{ toastState.actionLabel }}</button>
  </div>
</template>

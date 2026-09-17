<script setup>
/* 提示条：平时 opacity 0 且 pointer-events: none，只有 is-on 时才露面
   （见 studio.css），所以一直挂在页面上不会挡住任何东西。 */
const { toastState, runAction } = useToast()
</script>

<style scoped>
/* 提示条要压在悬浮球那一层（.studio 的 z-index 是 60）上面。
   旧站那条提示是 root.appendChild 进 .studio 里的，所以它永远盖着面板；
   在这里它是 .studio 的兄弟，而 .studio 自己开了层叠上下文——不给一个更高的层级，
   面板一开，「删掉了 / 换好了 / 只会认音频文件」这些提示就被面板吃掉了。
   61 这个数刚好在 .studio(60) 之上、.ctx(65) / .rte(68) / .keygate(70) 之下，
   与旧站那几个浮层的先后关系一模一样。 */
.studio__toast {
  z-index: 61;
}
</style>

<template>
  <div class="studio__toast" role="status" :class="{ 'is-on': toastState.on, 'is-bad': toastState.bad }">
    <span>{{ toastState.text }}</span>
    <button v-if="toastState.actionLabel" type="button" class="studio__toast-act" @click="runAction">{{ toastState.actionLabel }}</button>
  </div>
</template>

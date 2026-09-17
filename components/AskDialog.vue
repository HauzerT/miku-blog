<script setup>
/* ==========================================================================
   components/AskDialog.vue · 「问一句」那个小浮层（旧站 studio.js 的 ask()）
   ---------------------------------------------------------------------------
   与口令框（KeyDialog.vue）同一套壳、同一套 class（.keygate），所以
   assets/css/studio.css 里那一段直接生效：给了 value 就是「改名字」，
   没给就是「确认」。

   挂在 <Teleport to="body"> 上：旧站是 document.body.appendChild，
   在别的组件里渲染会掉进那一层的层叠上下文里，压不住别的东西。

   Esc 必须在这一层吃掉（capture + stopPropagation）：不拦的话它会冒到
   全局编辑模式那条监听器上，把整个模式一起关掉——旧站也是在这里拦下的。
   ========================================================================== */
import { askState, askAnswer } from '../composables/useAsk'
import { useStudio } from '../composables/useStudio'

const { keyDialog } = useStudio()
const value = ref('')
const inputEl = ref(null)

watch(
  () => askState.value.on,
  async (on) => {
    if (!on) return
    value.value = askState.value.value ?? ''
    await nextTick()
    /* 改名那一档：光标全选上，直接就能改（旧站 input.select()） */
    if (inputEl.value) {
      inputEl.value.focus()
      inputEl.value.select()
    }
  }
)

const onSubmit = () => {
  if (askState.value.value === null) askAnswer('')
  else askAnswer(String(value.value || '').trim())
}

const onKeyCapture = (event) => {
  if (!askState.value.on) return
  /* 口令框开着的时候 Esc 是它的事 */
  if (keyDialog.value.on) return
  if (event.key === 'Escape') {
    event.preventDefault()
    /* 必须 stopImmediatePropagation：外头那个「Esc 退出编辑模式」的监听器
       挂在**同一个 document** 上，stopPropagation 拦不住同一节点上的其他监听器，
       结果就是「问一句」弹出来的同时编辑模式也被关掉了。 */
    event.stopImmediatePropagation()
    askAnswer(null)
  }
}

onMounted(() => document.addEventListener('keydown', onKeyCapture, true))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeyCapture, true))
</script>

<template>
  <Teleport to="body">
    <div v-if="askState.on" class="keygate">
      <form class="keygate__box" @submit.prevent="onSubmit">
        <p class="keygate__title">{{ askState.title }}</p>
        <p v-if="askState.hint" class="keygate__hint">{{ askState.hint }}</p>
        <div class="keygate__row">
          <input
            v-if="askState.value !== null"
            ref="inputEl"
            v-model="value"
            class="keygate__input keygate__input--text"
            type="text"
            :maxlength="askState.maxlength"
            :aria-label="askState.title"
          >
          <button class="keygate__go" type="submit">{{ askState.ok }}</button>
        </div>
        <button class="keygate__cancel" type="button" @click="askAnswer(null)">取消</button>
      </form>
    </div>
  </Teleport>
</template>

<script setup>
/* ==========================================================================
   components/KeyDialog.vue · 口令框（旧站 studio.js 的 cv01.askKey）
   ---------------------------------------------------------------------------
   口令不对 / 还没输过时弹出来的那一个小条。它是全站唯一问口令的地方
   （门厅 login 是另一回事：那道门只是过场，这里问的才是真权限）。

   验过之后把口令记在这个浏览器里（localStorage 的 cv01-key），
   然后 withKey 会把刚才失败的那次请求重放一遍——所以人是被请进来，不是被丢下。

   挂在 <Teleport to="body"> 上：旧站是 document.body.appendChild，
   在 .studio 里渲染的话会掉进那个 z-index 的层叠上下文里，压不住别的东西。
   ========================================================================== */
const { keyDialog, cancelKey, submitKey } = useStudio()

const value = ref('')
const inputEl = ref(null)

watch(
  () => keyDialog.value.on,
  async (on) => {
    if (!on) return
    value.value = ''
    await nextTick()
    if (inputEl.value) inputEl.value.focus()
  }
)

const onSubmit = async () => {
  const ok = await submitKey(value.value)
  /* 口令不对：全选上，让人直接重打（旧站也是这么做的） */
  if (!ok && inputEl.value) inputEl.value.select()
}

const onKeyCapture = (event) => {
  if (!keyDialog.value.on) return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    cancelKey()
  }
}

onMounted(() => document.addEventListener('keydown', onKeyCapture, true))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeyCapture, true))
</script>

<template>
  <Teleport to="body">
    <div v-if="keyDialog.on" class="keygate">
      <form class="keygate__box" @submit.prevent="onSubmit">
        <p class="keygate__title">上传口令</p>
        <p class="keygate__hint">{{ keyDialog.error || keyDialog.message }}</p>
        <div class="keygate__row">
          <input
            ref="inputEl"
            v-model="value"
            class="keygate__input"
            type="password"
            inputmode="latin"
            name="passphrase"
            autocomplete="current-password"
            placeholder="例如 3f9a1c02"
            aria-label="上传口令"
          >
          <button class="keygate__go" type="submit" :disabled="keyDialog.busy">确认</button>
        </div>
        <button class="keygate__cancel" type="button" @click="cancelKey">以后再说</button>
      </form>
    </div>
  </Teleport>
</template>

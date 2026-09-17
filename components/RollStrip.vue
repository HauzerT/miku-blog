<script setup>
/* 迷你定位条：显示「我现在在卷帘的哪一格」。
   与首页那条大卷帘共用同一套位置算式（content/roll.mjs），只是压成一条。 */
import { noteWidth, slotOf } from '../content/roll.mjs'

const props = defineProps({
  tracks: { type: Array, default: () => [] },
  currentId: { type: String, default: '' },
  currentSlug: { type: String, default: '' },
  playX: { type: Number, default: 2 },
})

const lanes = computed(() =>
  props.tracks.map((track, ti) => ({
    track,
    notes: (track.posts || []).map((post, pi) => {
      const [x, w] = noteWidth(slotOf(track, ti), pi)
      const isCurrent = track.id === props.currentId && (props.currentSlug ? post.slug === props.currentSlug : true)
      return { post, x, w, isCurrent }
    }),
  }))
)
</script>

<template>
  <div class="roll roll--strip roll--bleed" :style="{ '--play-x': `${props.playX}%` }">
    <div class="roll__scroller">
      <div class="roll__inner">
        <div class="roll__field">
          <div class="roll__body">
            <div class="roll__lanes">
              <div v-for="lane in lanes" :key="lane.track.id" class="lane" :class="{ 'lane--black': lane.track.black }">
                <span
                  v-for="n in lane.notes"
                  :key="n.post.slug"
                  class="note"
                  :class="{ 'is-current': n.isCurrent }"
                  :style="{ '--x': String(n.x), '--w': String(n.w) }"
                ></span>
              </div>
            </div>
          </div>
          <div class="roll__playhead" aria-hidden="true"></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
/* 右下角两颗悬浮球：音乐盒（谁都能开）+ 站长工具箱（要口令）。
   外壳先照静态页摆好，行为（探服务、开合面板、音乐盒）搬到 Vue 那一步在下一轮；
   在那之前它们和静态页一样待着不动，也不解开 hidden。 */
</script>

<template>
  <div class="studio" data-studio data-base="/" hidden>
    <div class="studio__panel" data-studio-panel hidden></div>
    <div class="studio__dock">
      <button class="ball ball--music" type="button" data-ball="music" aria-expanded="false" aria-label="音乐盒">
        <span class="ball__glyph" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 18V6l10-2v12" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="16.5" cy="16" r="2.5" />
          </svg>
        </span>
        <span class="ball__dot" aria-hidden="true"></span>
      </button>
      <button class="ball ball--owner" type="button" data-ball="owner" aria-expanded="false" aria-label="站长工具箱（需要口令）">
        <span class="ball__glyph" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="8.5" cy="15.5" r="4.2" /><path d="M11.6 12.4 20 4M17.2 4.6l2.6 2.6M14.4 7.4l2.6 2.6" />
          </svg>
        </span>
      </button>
    </div>
    <audio data-bgm preload="metadata"></audio>
  </div>
</template>

/* ==========================================================================
   composables/useSound.ts · 调声
   ---------------------------------------------------------------------------
   事件的接法在这里，出声那台琴在 composables/sound-engine.mjs（WebAudio，
   采样 + 合成音色，起音与收尾都有斜坡）。只有两处会出声：

     · 点轨道名 / 点轨道头 / 点音符块 —— 先响一声，再切模块
     · 指针掠过音符块，或用方向键走上去 —— 试听那个音

   三条与手机有关的规矩：

     1. **pointerover 只认鼠标**。触屏一次点按会先发 pointerover 再发 click，
        两个声音差几十毫秒叠在一起就是梳状滤波（金属味）。鼠标才是「掠过」，
        触摸不是——触摸交给 click 那一路。
     2. **同一个音 320ms 内不再叠一层**（引擎里那道闸）：鼠标悬停过再点下去，
        不再出现两份同样的采样。
     3. **开启音效时先把这一页看得到的音拉下来**（最多 12 个，3 个并发）。
        手机上第一次点击往往就是切模块那一下，等它现下现解就晚了；先拉好，
        点下去就是真钢琴。存了「省流量」偏好的浏览器（Save-Data）跳过这一步。

   默认关闭——没人喜欢的网站不该自己出声。
   ========================================================================== */
import { SOUND, engine, pitchHz } from './sound-engine.mjs';

const STORE = 'cv01-sound';
const SWITCH_DELAY = 190; /* 切模块前让音符响多久（毫秒） */

/* 这一页看得到的音（轨道栏、卷帘轨道头、音符块、下拉里挑过的音） */
const pagePitches = () => {
  const seen = new Set();
  for (const el of document.querySelectorAll('[data-pitch]')) {
    const value = el.getAttribute('data-pitch') || '';
    if (pitchHz(value)) seen.add(value);
  }
  return [...seen];
};

const saveData = () => {
  try {
    return Boolean(navigator.connection && navigator.connection.saveData);
  } catch {
    return false;
  }
};

export const useSound = () => {
  const enabled = ref(false);
  const ready = ref(false);
  const narrow = ref(false);
  const router = useRouter();

  const label = computed(() =>
    enabled.value ? (narrow.value ? '音效开' : '关闭音效') : narrow.value ? '音效关' : '开启音效'
  );
  const ariaLabel = computed(() =>
    enabled.value ? '关闭音效：切换模块与时不再发声' : '开启音效：切换模块时会响一声，卷帘上可以试听'
  );

  const toggle = () => {
    enabled.value = !enabled.value;
    engine.setEnabled(enabled.value);
    if (enabled.value) {
      /* resume 必须在这一次点击里发生，手机上才给声音 */
      void engine.resume();
      engine.play('A5', { short: true }); /* 开启时用最高那个音应一声 */
      if (!saveData()) void engine.preload(pagePitches());
    }
    try {
      localStorage.setItem(STORE, enabled.value ? 'on' : 'off');
    } catch {
      /* 隐私模式 */
    }
  };

  onMounted(() => {
    ready.value = true;
    try {
      enabled.value = localStorage.getItem(STORE) === 'on';
    } catch {
      /* 同上 */
    }
    engine.setEnabled(enabled.value);
    if (enabled.value && !saveData()) void engine.preload(pagePitches());

    if (!window.matchMedia) return;
    const mq = window.matchMedia('(max-width: 720px)');
    narrow.value = mq.matches;
    mq.addEventListener('change', () => {
      narrow.value = mq.matches;
    });
  });

  onMounted(() => {
    /* 点任何一个带音高的链接：先响，再走。用捕获阶段拦下来，
       这样 NuxtLink 自己的跳转还没开始，SWITCH_DELAY 那一下是真的在等。
       音效关着的时候这一整段零拦截、零副作用。 */
    const onClick = (event) => {
      if (!enabled.value) return;
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target.closest ? event.target.closest('a[data-pitch]') : null;
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
      const pitch = link.getAttribute('data-pitch');
      if (!pitchHz(pitch)) return;

      event.preventDefault();
      event.stopPropagation();
      engine.play(pitch, { short: true });
      const href = link.getAttribute('href');
      if (!href) return;
      setTimeout(() => {
        router.push(href);
      }, SWITCH_DELAY);
    };

    /* 掠过音符块：试听。**只认鼠标**——触屏的 pointerover 紧接着就是 click，
       两次触发叠在一起会响成金属声（见文件头第 1 条）。 */
    const onOver = (event) => {
      if (!enabled.value) return;
      if (event.pointerType && event.pointerType !== 'mouse') return;
      const note = event.target.closest ? event.target.closest('.note[data-pitch]') : null;
      if (!note) return;
      const pitch = note.getAttribute('data-pitch');
      engine.play(pitch, { short: false });
      void engine.load(pitch);   /* 顺手把它拉下来：下一次点击就是真钢琴 */
    };

    /* 键盘走到音符块 / 轨道键：试听 */
    const onFocus = (event) => {
      if (!enabled.value) return;
      const el = event.target.closest ? event.target.closest('[data-pitch]') : null;
      if (!el) return;
      const pitch = el.getAttribute('data-pitch');
      void engine.load(pitch);
      engine.play(pitch, { short: false });
    };

    document.addEventListener('click', onClick, true);
    document.addEventListener('pointerover', onOver);
    document.addEventListener('focusin', onFocus);
    onBeforeUnmount(() => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('focusin', onFocus);
    });
  });

  return { enabled, ready, label, ariaLabel, toggle, SOUND };
};

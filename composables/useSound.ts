/* ==========================================================================
   composables/useSound.ts · 调声
   ---------------------------------------------------------------------------
   把卷帘上的音变成听得见的东西——原生九个音，以及界面上新建板块时挑的任何一个音。
   只有两处会出声：

     · 点轨道名 / 点卷帘的轨道头 —— 先响一声，再切模块
     · 指针掠过音符块，或用方向键在卷帘上走 —— 试听那个音

   两种声源自动选择：assets/audio/<音高>.mp3 这类真采样（缺哪个补哪个），
   没有采样就用 WebAudio 现场合成一个柔和的电钢琴音色。

   默认关闭——没人喜欢的网站不该自己出声。
   ========================================================================== */
const STORE = 'cv01-sound';
const SWITCH_DELAY = 190; /* 切模块前让音符响多久（毫秒） */
const EXTS = ['.mp3', '.wav', '.ogg'];
const MASTER = 0.15; /* 总音量。想更响改这里，别改单个音符 */

/* 音高 → 频率：十二平均律，A4 = 440Hz。
   算出来的话 C2 到 B6 任何音都认，采样文件也才有机会被找出来。 */
const SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export const pitchHz = (pitch) => {
  const m = /^([A-G])(#?)(-?\d)$/.exec(String(pitch || ''));
  if (!m) return 0;
  const midi = (Number(m[3]) + 1) * 12 + SEMITONE[m[1]] + (m[2] ? 1 : 0);
  return 440 * Math.pow(2, (midi - 69) / 12);
};

const slugOf = (pitch) => String(pitch).toLowerCase().replace('#', 's');

/* 引擎状态：只在浏览器里有，且整个会话共用一份（与旧站那一个 IIFE 闭包等价） */
let ctx = null;
let extOf = {};
let lastPitch = '';
let lastAt = 0;

const ensure = () => {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  const gain = ctx.createGain();
  gain.gain.value = MASTER;
  gain.connect(ctx.destination);
  ctx.__master = gain;
  return ctx;
};

/* 加法合成的柔和小钟琴：基频 + 三个泛音，快起音、长衰减 */
const synth = (pitch, short) => {
  if (!ensure()) return;
  const t = ctx.currentTime + 0.001;
  const partials = [
    [1, 1],
    [2, 0.3],
    [3, 0.12],
    [4, 0.05],
  ];

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  if (short) {
    env.gain.linearRampToValueAtTime(0.9, t + 0.006);
    env.gain.exponentialRampToValueAtTime(0.26, t + 0.12);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
  } else {
    env.gain.linearRampToValueAtTime(0.9, t + 0.008);
    env.gain.exponentialRampToValueAtTime(0.3, t + 0.22);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
  }

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 4200;
  lp.Q.value = 0.6;
  env.connect(lp);
  lp.connect(ctx.__master);

  for (const [mult, level] of partials) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = pitchHz(pitch) * mult;
    const g = ctx.createGain();
    g.gain.value = level;
    osc.connect(g);
    g.connect(env);
    osc.start(t);
    osc.stop(t + (short ? 0.5 : 1.25));
  }
};

const playFile = (pitch, ext, short) => {
  const audio = new Audio(`/assets/audio/${slugOf(pitch)}${ext}`);
  audio.volume = 0.55;
  const playing = audio.play();
  if (playing && playing.catch) playing.catch(() => synth(pitch, short));
};

const trySample = (pitch, i, short) => {
  if (i >= EXTS.length) {
    extOf[pitch] = false;
    synth(pitch, short);
    return;
  }
  const audio = new Audio(`/assets/audio/${slugOf(pitch)}${EXTS[i]}`);
  audio.volume = 0.55;
  const playing = audio.play();
  if (!playing || !playing.then) {
    extOf[pitch] = EXTS[i];
    return;
  }
  playing
    .then(() => {
      extOf[pitch] = EXTS[i];
    })
    .catch(() => trySample(pitch, i + 1, short));
};

const play = (pitch, short, force, enabled) => {
  if (!enabled || !pitchHz(pitch)) return;
  const now = Date.now();
  if (!force && pitch === lastPitch && now - lastAt < 260) return; /* 掠过时不连响 */
  lastPitch = pitch;
  lastAt = now;

  if (extOf[pitch] === false) return void synth(pitch, short);
  if (extOf[pitch]) return void playFile(pitch, extOf[pitch], short);
  trySample(pitch, 0, short);
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
    if (enabled.value) {
      ensure();
      if (ctx && ctx.state === 'suspended') ctx.resume();
      play('A5', true, true, enabled.value); /* 开启时用最高那个音应一声 */
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
      play(pitch, true, true, enabled.value);
      const href = link.getAttribute('href');
      if (!href) return;
      setTimeout(() => {
        router.push(href);
      }, SWITCH_DELAY);
    };

    /* 掠过音符块：试听 */
    const onOver = (event) => {
      if (!enabled.value) return;
      const note = event.target.closest ? event.target.closest('.note[data-pitch]') : null;
      if (note) play(note.getAttribute('data-pitch'), false, false, enabled.value);
    };

    /* 键盘走到音符块 / 轨道键：试听 */
    const onFocus = (event) => {
      if (!enabled.value) return;
      const el = event.target.closest ? event.target.closest('[data-pitch]') : null;
      if (el) play(el.getAttribute('data-pitch'), false, true, enabled.value);
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

  return { enabled, ready, label, ariaLabel, toggle };
};

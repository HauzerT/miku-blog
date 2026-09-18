/* ==========================================================================
   composables/sound-engine.mjs · 一台 WebAudio 钢琴
   ---------------------------------------------------------------------------
   这个站只在两处出声：点轨道名 / 点轨道头（先响一声，再切模块），以及指针掠过
   音符块或键盘走到它上面（试听）。两种声源：assets/audio/<音高>.mp3 真采样，
   缺哪个音，哪个音就用现场合成的电钢琴音色顶替——混着用也没问题。

   **为什么整台琴都建在 WebAudio 上，不再用 `new Audio()`**

   旧写法在手机上听着「短促 + 电子噪声」，就是下面这四条凑出来的：

     1. 每个音都 new 一个 HTMLAudioElement，等于每次现下现解 100–240KB 的 mp3。
        手机上一次要几百毫秒，而切模块只等 190ms——等它响出来页面早切走了，听到的
        是被截断的半声；play() 的 promise 一被拒（被下一次播放打断、或策略不允许），
        旧代码就一路退到 .wav、.ogg，最后把「这个音没有采样」记死，从此**永远**用
        合成音色。那一版合成音色只响 0.42 秒——就是那个「短促」。
     2. `<audio>` 的 volume 在 iOS 上是只读的，写了不生效：采样那一路根本没经过
        总音量（MASTER 只管合成音色），小喇叭上满幅输出，破音 = 电子噪声。
     3. 采样本身是 4.7–10 秒的长音，在 190ms 处硬切、或被回收，听感就是断在半截。
     4. 触屏一次点按会先发 pointerover 再发 click：同一个采样差几十毫秒叠两份，
        梳状滤波，金属味。那一条在 useSound.ts 里按鼠标 / 触摸分开处理。

   现在的做法：在 AudioContext 里 fetch + decodeAudioData 一次，缓存成 AudioBuffer；
   播放只做一次 AudioBufferSourceNode——不现下、不现解；音量走 GainNode（iOS 也认）；
   起音与收尾都有斜坡（没有斜坡就是「啪」的一声，那也是噪声）；每个采样先归一化到
   同一个峰值，九个音才一样响。

   调参全在 SOUND 里：想更响改 master，想响久一点改 hold / release / previewMax。
   自检：node tools/sound-check.mjs（无头 Chrome 里离线渲染，量爆音、时长与电平）。
   ========================================================================== */

const EXTS = ['.mp3', '.wav', '.ogg'];

/* 音高 → 频率：十二平均律，A4 = 440Hz。C2 到 B6 任何音都认。 */
const SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export const pitchHz = (pitch) => {
  const m = /^([A-G])(#?)(-?\d)$/.exec(String(pitch || ''));
  if (!m) return 0;
  const midi = (Number(m[3]) + 1) * 12 + SEMITONE[m[1]] + (m[2] ? 1 : 0);
  return 440 * Math.pow(2, (midi - 69) / 12);
};

const slugOf = (pitch) => String(pitch).toLowerCase().replace('#', 's');

export const SOUND = {
  master: 0.5,         /* 总闸。采样与合成音色都从这里出去，峰值落在 0.3 上下（留足余量） */
  voice: 0.9,          /* 单个音的电平（采样已归一化到 samplePeak） */
  samplePeak: 0.85,    /* 每个采样先归一化到这个峰值，九个音才一样响 */
  attack: 0.008,       /* 起音：0 就是爆音，8ms 听着仍然是「立刻响」 */
  release: 0.48,       /* 收尾淡出：硬切会「啪」 */
  hold: 0.22,          /* 切模块那一声淡出前的保持时长（导航在 190ms 处发生，音符跟过去） */
  previewMax: 1.6,     /* 试听最长响多久（采样本身更长也不放完） */
  sameHold: 0.32,      /* 同一个音这么近的第二次触发不再叠一层（防梳状滤波） */
  maxVoices: 8,        /* 同时最多几层，超了把最老的快速收掉 */
  preloadMax: 12,      /* 开启音效时最多先把几个音拉下来（一页看得到的那些） */
  tone: { f: 8200, q: 0.4 },  /* 总线上一条轻低通：抹掉手机小喇叭上的毛刺 */
  synth: {
    /* 加法合成的柔和电钢琴：泛音少、尾巴长，听着不像「电子音」 */
    partials: [[1, 1], [2, 0.3], [3, 0.11], [4, 0.04], [6, 0.015]],
    attack: 0.012,
    decay: 1.5,
    lp: 5200,
    /* 合成音色自己的电平：五个正弦叠起来的峰值比采样高，压到跟采样一样响 */
    voice: 0.62,
  },
};

/* 总音量 + 一条轻低通。在线与离线（自检）用同一份，量到的才是真东西。 */
function makeBus(ac) {
  const master = ac.createGain();
  master.gain.value = SOUND.master;
  const tone = ac.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = SOUND.tone.f;
  tone.Q.value = SOUND.tone.q;
  tone.connect(master);
  master.connect(ac.destination);
  return tone;
}

/* 采样的包络：软起音 → 保持 → 尾部淡出。硬切与零起音都是噪声的来源。 */
function sampleEnvelope(ac, dest, startAt, peak, dur) {
  const gain = ac.createGain();
  const attack = Math.min(SOUND.attack, dur / 4);
  const release = Math.min(SOUND.release, dur / 2);
  const fadeFrom = Math.max(startAt + attack + 0.02, startAt + dur - release);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.linearRampToValueAtTime(peak, startAt + attack);
  gain.gain.setValueAtTime(peak, fadeFrom);
  gain.gain.linearRampToValueAtTime(0.0001, startAt + dur);
  gain.connect(dest);
  return { gain, end: startAt + dur };
}

/* 合成音色的包络：软起音 → 先快后慢的两段衰减（像钢琴，不像正弦哔声） */
function synthEnvelope(ac, dest, startAt, dur) {
  const gain = ac.createGain();
  const peak = SOUND.synth.voice;
  const attack = Math.min(SOUND.synth.attack, dur / 4);
  const knee = startAt + attack + Math.min(dur * 0.3, 0.5);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.linearRampToValueAtTime(peak, startAt + attack);
  gain.gain.exponentialRampToValueAtTime(peak * 0.28, knee);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + dur);
  gain.connect(dest);
  return { gain, end: startAt + dur };
}

/* 一层采样声 */
function scheduleSample(ac, dest, buffer, opts = {}) {
  const startAt = (opts.at || ac.currentTime) + 0.004;
  const dur = opts.short
    ? SOUND.hold + SOUND.release
    : Math.min(buffer.duration, SOUND.previewMax);
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const env = sampleEnvelope(ac, dest, startAt, SOUND.voice, Math.max(dur, 0.12));
  src.connect(env.gain);
  src.start(startAt);
  src.stop(env.end + 0.02);
  return { nodes: [src], gain: env.gain, stopAt: env.end };
}

/* 一层合成音色声 */
function scheduleSynth(ac, dest, hz, opts = {}) {
  const startAt = (opts.at || ac.currentTime) + 0.004;
  const dur = opts.short ? SOUND.hold + SOUND.release : SOUND.synth.decay;
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = SOUND.synth.lp;
  lp.Q.value = 0.6;
  lp.connect(dest);
  const env = synthEnvelope(ac, lp, startAt, dur);
  const nodes = [];
  for (const [mult, level] of SOUND.synth.partials) {
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = hz * mult;
    const partial = ac.createGain();
    partial.gain.value = level;
    osc.connect(partial);
    partial.connect(env.gain);
    osc.start(startAt);
    osc.stop(env.end + 0.02);
    nodes.push(osc);
  }
  return { nodes, gain: env.gain, stopAt: env.end };
}

/* ==========================================================================
   引擎
   ========================================================================== */
export function createEngine(deps = {}) {
  const win = typeof window === 'undefined' ? {} : window;
  const AC = deps.AudioContext || win.AudioContext || win.webkitAudioContext || null;
  const OAC = deps.OfflineAudioContext || win.OfflineAudioContext || win.webkitOfflineAudioContext || null;
  const doFetch = deps.fetch || (typeof fetch === 'function' ? fetch : null);

  let ctx = null;
  let bus = null;
  let enabled = false;

  const buffers = new Map();   /* 音高 → AudioBuffer（拉到手的真采样） */
  const missing = new Set();   /* 确认三种后缀都没有的音高 */
  const loading = new Map();   /* 音高 → Promise，同一时刻只拉一次 */
  const lastAt = new Map();    /* 音高 → 上次触发时刻（毫秒） */
  const live = new Set();      /* 正在响的那几层 */
  const stats = { plays: 0, samples: 0, synths: 0, misses: 0, voices: 0, errors: 0 };

  const ensure = () => {
    if (ctx || !AC) return ctx;
    try {
      ctx = new AC();
      bus = makeBus(ctx);
    } catch {
      stats.errors++;
      ctx = null;
    }
    return ctx;
  };

  const resume = async () => {
    if (!ensure()) return false;
    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch { /* 还没拿到用户手势 */ }
    }
    return ctx.state === 'running';
  };

  /* 老的 iOS 上 decodeAudioData 只有回调形式，两种都接住 */
  const decodeAudio = (raw) => new Promise((resolve, reject) => {
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };
    const fail = (err) => { if (!settled) { settled = true; reject(err || new Error('decode 失败')); } };
    try {
      const maybe = ctx.decodeAudioData(raw, done, fail);
      if (maybe && typeof maybe.then === 'function') maybe.then(done, fail);
    } catch (err) {
      fail(err);
    }
  });

  /* 每个采样归一化到同一个峰值：有的 mp3 录得响、有的录得轻，不归一化就会
     「这个音炸、那个音听不见」，响的那个在小喇叭上就是破音 */
  function normalize(buffer) {
    let peak = 0;
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < data.length; i++) {
        const v = data[i] < 0 ? -data[i] : data[i];
        if (v > peak) peak = v;
      }
    }
    if (!peak) return;
    const scale = Math.min(1.6, SOUND.samplePeak / peak);
    if (scale > 0.97 && scale < 1.03) return;
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < data.length; i++) data[i] *= scale;
    }
  }

  function load(pitch) {
    if (!pitchHz(pitch) || !ensure()) return Promise.resolve(null);
    if (buffers.has(pitch)) return Promise.resolve(buffers.get(pitch));
    if (missing.has(pitch)) return Promise.resolve(null);
    if (loading.has(pitch)) return loading.get(pitch);
    if (!doFetch) return Promise.resolve(null);

    const task = (async () => {
      for (const ext of EXTS) {
        try {
          const res = await doFetch(`/assets/audio/${slugOf(pitch)}${ext}`, { cache: 'force-cache' });
          if (!res || !res.ok) continue;
          const raw = await res.arrayBuffer();
          const buffer = await decodeAudio(raw);
          if (!buffer || !buffer.length) continue;
          normalize(buffer);
          buffers.set(pitch, buffer);
          stats.samples++;
          return buffer;
        } catch {
          /* 这个后缀没有 / 解不开：试下一个 */
        }
      }
      missing.add(pitch);
      stats.misses++;
      return null;
    })();

    loading.set(pitch, task);
    const settle = () => loading.delete(pitch);
    task.then(settle, settle);
    return task;
  }

  /* 最多几层同时响：超了把最老的那层快速收掉（60ms 淡出，不出「啪」） */
  function retireOldest() {
    if (live.size < SOUND.maxVoices) return;
    const oldest = live.values().next().value;
    if (!oldest) return;
    live.delete(oldest);
    const t = ctx ? ctx.currentTime : 0;
    try {
      oldest.gain.gain.cancelScheduledValues(t);
      oldest.gain.gain.setValueAtTime(Math.max(0.0001, oldest.gain.gain.value), t);
      oldest.gain.gain.linearRampToValueAtTime(0.0001, t + 0.06);
      for (const node of oldest.nodes) node.stop(t + 0.08);
    } catch {
      /* 已经停了 */
    }
    stats.voices = live.size;
  }

  function track(voice) {
    retireOldest();
    live.add(voice);
    stats.voices = live.size;
    const left = ctx ? Math.max(0.1, voice.stopAt - ctx.currentTime) : 1;
    setTimeout(() => {
      live.delete(voice);
      stats.voices = live.size;
    }, Math.ceil(left * 1000) + 120);
  }

  function start(voice) {
    if (!voice) return false;
    track(voice);
    return true;
  }

  /* 拉一页里看得到的那些音。开了音效之后再拉，别在访客身上花流量。 */
  async function preload(pitches) {
    if (!ensure()) return 0;
    const queue = [...new Set(pitches)]
      .filter((p) => pitchHz(p) && !buffers.has(p) && !missing.has(p))
      .slice(0, SOUND.preloadMax);
    let got = 0;
    const worker = async () => {
      while (queue.length) {
        const pitch = queue.shift();
        if (await load(pitch)) got++;
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker));
    return got;
  }

  function play(pitch, opts = {}) {
    if (!enabled || !pitchHz(pitch) || !ensure()) return false;
    const now = Date.now();
    const prev = lastAt.get(pitch) || 0;
    if (now - prev < SOUND.sameHold * 1000) return false;  /* 同一个音不再叠一层 */
    lastAt.set(pitch, now);
    if (ctx.state !== 'running') resume();
    stats.plays++;

    const short = Boolean(opts.short);
    const buffer = buffers.get(pitch);
    if (buffer) {
      stats.samples++;
      return start(scheduleSample(ctx, bus, buffer, { short }));
    }
    if (!missing.has(pitch)) load(pitch);   /* 还没拉到：这一声先合成顶上，同时去拉 */
    stats.synths++;
    return start(scheduleSynth(ctx, bus, pitchHz(pitch), { short }));
  }

  /* 离线渲染一层声音（自检用）：跟在线走的是同一套排布，量得到爆音与时长 */
  async function renderOffline(pitch, opts = {}) {
    if (!OAC || !pitchHz(pitch)) return null;
    const rate = opts.sampleRate || 44100;
    const dur = opts.duration || 1.6;
    const ac = new OAC(1, Math.ceil(rate * dur), rate);
    const out = makeBus(ac);
    const spec = { short: Boolean(opts.short), at: 0 };
    const buffer = opts.useSample === false ? null : (buffers.get(pitch) || await load(pitch));
    if (buffer) scheduleSample(ac, out, buffer, spec);
    else scheduleSynth(ac, out, pitchHz(pitch), spec);
    const rendered = await ac.startRendering();
    return Array.from(rendered.getChannelData(0));
  }

  const api = {
    SOUND,
    pitchHz,
    stats,
    buffers,
    missing,
    resume,
    load,
    preload,
    play,
    renderOffline,
    setEnabled(value) { enabled = Boolean(value); },
    get enabled() { return enabled; },
    get ready() { return Boolean(ctx); },
    get state() { return ctx ? ctx.state : 'none'; },
  };
  return api;
}

/* 全站共用一个引擎（与旧站那一个 IIFE 闭包等价）。浏览器里顺手挂在 window 上，
   给 tools/sound-check.mjs 一个抓得住的手柄——访客看不见也摸不着别的东西。 */
export const engine = createEngine();
if (typeof window !== 'undefined') window.__cv01Sound = engine;

/* ==========================================================================
   composables/useMusic.ts · 音乐盒：一根 <audio data-bgm> 加一份 media/music/ 的曲库
   ---------------------------------------------------------------------------
   进页面自动尝试播放（浏览器拦下来就在音乐球上点一颗粉灯，第一个手势一到就接着放）、
   面板里的播放控制、曲目列表、「设为默认」，
   以及只有站长能按的 换 / 改名 / 删，加上站长工具箱里那块「上传音乐盒的音乐」。

   这一颗球是公开的——谁都能听、能选、能设默认。写文件的那几件事都要口令，
   没有口令的浏览器连那几颗按钮都不摆出来（服务端的 401 才是真边界）。

   状态为什么活在模块级而不是面板组件里：<audio> 住在 layouts/default.vue 的
   StudioDock 里，换页时不重建；面板却是关了就没了的。歌不能因为收起面板或者
   换了一页就停——所以播放状态与那根 <audio> 都在组件之外，组件只负责画。

   选中的曲目、默认曲目、循环方式与音量记在 localStorage，下次进站接着放。
   ========================================================================== */
import { apiError, fetchJson, upload as uploadXhr } from './useApi';
import { useStudio } from './useStudio';
import { useToast } from './useToast';

const STORE = 'cv01-music';
const MODES = ['list', 'one', 'shuffle'];
export const MODE_LABEL = { list: '列表循环', one: '单曲循环', shuffle: '随机' };
const AUDIO_RE = /\.(mp3|m4a|wav|ogg|oga|opus|flac|aac)$/i;

/* 认得出是音频就够了：后缀优先，MIME 兜底（Windows 有时候对 .m4a 报
   application/octet-stream）。 */
export const isAudioFile = (file) =>
  Boolean(file) && (AUDIO_RE.test(String(file.name || '')) || /^audio\//.test(String(file.type || '')));

let el = null; /* <audio data-bgm>，StudioDock 挂载时交给这里 */
let bound = false; /* 事件只绑一次：工作台是全站唯一的那一个 */
let playedFile = ''; /* 最近真的放过的那一首 */

const tracks = ref([]);
const settings = ref({ volume: 0.6, loop: true, autoplay: true });
const index = ref(-1);
const defaultIndex = ref(-1); /* 「进页面自动播」的那一首 */
const failed = ref({}); /* 放不出来的文件（键是 url），跳过它们 */
const mode = ref('list');
const playing = ref(false);
const blocked = ref(false); /* 自动播放被浏览器拦下了：球上点灯 */
const volume = ref(0.6);
const currentTime = ref(0);
const duration = ref(0);
const loaded = ref(false); /* 曲库取回来没有（取回来之前球上不摆数字） */

/* ------------------------------------------------------------ 小工具 */
export const fmtClock = (sec) => {
  if (!sec || !isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m + ':' + (s < 10 ? '0' : '') + s;
};

export const fmtSize = (bytes) => {
  const n = Number(bytes) || 0;
  if (!n) return '';
  if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
};

export const useMusic = () => {
  const { toast } = useToast();
  const studio = useStudio();

  const current = () => tracks.value[index.value] || null;
  const pinned = () => tracks.value[defaultIndex.value] || null;
  const isBroken = (track) => Boolean(track && failed.value[track.url]);

  const indexOfFile = (file) => {
    if (!file) return -1;
    return tracks.value.findIndex((t) => t.file === file);
  };

  /* ------------------------------------------------------------ 本地记忆 */
  const remember = () => {
    try {
      localStorage.setItem(
        STORE,
        JSON.stringify({
          file: playedFile || (current() ? current().file : ''),
          pin: pinned() ? pinned().file : '',
          mode: mode.value,
          volume: volume.value,
        })
      );
    } catch {
      /* 隐私模式：忽略 */
    }
  };

  const recall = () => {
    try {
      return JSON.parse(localStorage.getItem(STORE) || '{}') || {};
    } catch {
      return {};
    }
  };

  /* ------------------------------------------------------------ 播放控制 */
  const play = (i, opts = {}) => {
    if (!tracks.value.length || !el) return;
    if (typeof i === 'number') index.value = (i + tracks.value.length) % tracks.value.length;
    if (index.value < 0) index.value = 0;
    const track = current();
    if (!track) return;
    if (el.getAttribute('src') !== track.url) {
      el.src = track.url;
      el.load();
    }
    playedFile = track.file;
    const p = el.play();
    if (p && p.catch) {
      p.then(() => {
        blocked.value = false;
      }).catch(() => {
        /* 只有「进页面自动放」这一次失败才点灯。用户自己按的播放键失败是他自己的事，
           不该在球上留一颗说不清的灯（与旧实现一致）。 */
        blocked.value = opts.auto ? true : false;
      });
    }
    remember();
  };

  const toggle = () => {
    if (!tracks.value.length || !el) return;
    if (el.paused) play(index.value);
    else el.pause();
  };

  const step = (delta) => {
    if (!tracks.value.length) return;
    if (mode.value === 'shuffle') {
      let next = index.value;
      let guard = 0;
      while (tracks.value.length > 1 && next === index.value && guard++ < 40) {
        next = Math.floor(Math.random() * tracks.value.length);
      }
      play(next);
      return;
    }
    /* 跳过已知放不出来的文件（媒体文件坏了不该把整条队列堵死） */
    let i = index.value;
    for (let hop = 0; hop < tracks.value.length; hop++) {
      i = (i + delta + tracks.value.length) % tracks.value.length;
      if (!failed.value[tracks.value[i].url]) {
        play(i);
        return;
      }
    }
    toast('曲库里没有能放的文件了', true);
  };

  /* 设为「进页面自动播」的那一首。不打断正在放的东西，
     但曲库还空着、或者压根没在放的时候，顺手把它放起来。 */
  const pin = (i) => {
    if (i < 0 || i >= tracks.value.length) return;
    defaultIndex.value = i;
    remember();
    if (el && el.paused) play(i);
  };

  /* 音量：跟服务端的设置同步，但以本地为准，免得每次都要重设。
     这里**不**经过 withKey：访客拖音量不该被口令框拦住，服务端 401 就算了。 */
  const setVolume = (v) => {
    if (!el) return;
    el.volume = Math.min(1, Math.max(0, Number(v) || 0));
    volume.value = el.volume;
    remember();
    studio.authed('music/settings', { method: 'PATCH', json: { volume: el.volume } }).catch(() => {});
  };

  /* 拖动进度条。duration 还没读出来时不动（与旧站一样直接算了）。 */
  const seek = (fraction) => {
    if (!el || !el.duration || !isFinite(el.duration)) return;
    el.currentTime = Number(fraction) * el.duration;
    currentTime.value = el.currentTime;
  };

  const cycleMode = () => {
    mode.value = MODES[(MODES.indexOf(mode.value) + 1) % MODES.length];
    remember();
  };

  /* ------------------------------------------------------------ <audio> 的那几条 */
  const paintProgress = () => {
    if (!el) return;
    currentTime.value = el.currentTime || 0;
    duration.value = el.duration;
  };

  const onEnded = () => {
    if (mode.value === 'one') {
      if (el) el.currentTime = 0;
      play(index.value);
      return;
    }
    step(1);
  };

  /* 文件坏掉（被手动删了、拷进来一半、格式不认）时：把那首从「默认」上摘下来，
     在列表里标出来，然后往下找一首能放的。别默默切走，也别报告错的曲名。 */
  const onError = () => {
    if (!el) return;
    const src = el.getAttribute('src');
    let bad = tracks.value.find((t) => t.url === src) || current();
    if (!bad) return;
    failed.value[bad.url] = true;
    toast('这首放不出来：' + bad.title + '（文件坏了或被删了）', true);
    const def = pinned();
    if (def && def.url === bad.url) {
      let usable = -1;
      for (let i = 0; i < tracks.value.length; i++) {
        if (!failed.value[tracks.value[i].url]) {
          usable = i;
          break;
        }
      }
      defaultIndex.value = usable;
      remember();
    }
    /* 只在「正在放的那一首坏了」时往前找；否则不动用户刚选的东西 */
    const cur = current();
    if (cur && cur.url === bad.url) step(1);
  };

  const bindAudio = (node) => {
    el = node || null;
    if (!el || bound) return;
    bound = true;
    el.loop = false;
    el.addEventListener('play', () => {
      playing.value = true;
      blocked.value = false;
    });
    el.addEventListener('pause', () => {
      playing.value = false;
    });
    el.addEventListener('timeupdate', paintProgress);
    el.addEventListener('loadedmetadata', paintProgress);
    el.addEventListener('ended', onEnded);
    el.addEventListener('error', onError);
  };

  /* ------------------------------------------------------------ 自动播放 */
  /* 进页面该放哪一首：
     ① 你指定过的「默认」那一首（进页面自动播放的正式答案）
     ② 上次听到一半的那一首（没有默认时就接着上次）
     ③ 曲库第一首 */
  const startIndex = () => {
    if (defaultIndex.value >= 0 && defaultIndex.value < tracks.value.length) return defaultIndex.value;
    const i = indexOfFile(recall().file);
    return i === -1 ? 0 : i;
  };

  /* 浏览器不让人没交互就出声：这一次失败先在球上点灯，
     接下来第一次点击 / 滚动 / 按键都算手势，一有手势就接着放。 */
  const armAutoplay = () => {
    const GESTURES = ['pointerdown', 'keydown', 'touchstart', 'wheel'];
    const once = () => {
      GESTURES.forEach((g) => document.removeEventListener(g, once, true));
      if (blocked.value && !playing.value && settings.value.autoplay) play(index.value, { auto: true });
    };
    GESTURES.forEach((g) => document.addEventListener(g, once, true));
  };

  /* 进页面：读本地记忆、取曲库、试着放起来。曲库空着就什么都不做，也不报错。 */
  const load = async () => {
    if (!el) return;
    const memo = recall();
    if (typeof memo.volume === 'number') {
      el.volume = memo.volume;
      volume.value = el.volume;
    }
    if (memo.mode && MODE_LABEL[memo.mode]) mode.value = memo.mode;

    try {
      const data = await fetchJson('music');
      tracks.value = data.tracks || [];
      settings.value = { ...settings.value, ...(data.settings || {}) };
      if (!memo.volume && typeof settings.value.volume === 'number') {
        el.volume = settings.value.volume;
        volume.value = el.volume;
      }
      defaultIndex.value = indexOfFile(memo.pin);
      if (defaultIndex.value === -1 && tracks.value.length) defaultIndex.value = 0;
      index.value = tracks.value.length ? startIndex() : -1;
      loaded.value = true;
      /* 进页面就放。浏览器多半会拦，拦了就在悬浮球上点灯，等第一个手势。 */
      if (settings.value.autoplay && tracks.value.length) play(index.value, { auto: true });
      armAutoplay();
    } catch {
      /* 服务没在跑：音乐盒安静地不存在 */
    }
  };

  /* 别人传完歌之后让曲库跟上；也给别人一个手动刷新的口子 */
  const reload = async () => {
    try {
      const data = await fetchJson('music');
      tracks.value = data.tracks || [];
      settings.value = { ...settings.value, ...(data.settings || {}) };
      if (index.value >= tracks.value.length) index.value = tracks.value.length - 1;
      if (defaultIndex.value >= tracks.value.length) defaultIndex.value = tracks.value.length - 1;
    } catch {
      /* 服务没在跑就算了 */
    }
  };

  /* ------------------------------------------------------------ 写文件的那几件 */
  /* 传新歌：站长工具箱里的那一块。返回新进曲库的那几首。
     传进来的曲子直接进曲库；曲库本来是空的，这一首就顺手成为「进页面自动播」的那一首。 */
  const uploadTracks = async (files, onProgress) => {
    const audioFiles = Array.from(files || []).filter(isAudioFile);
    if (!audioFiles.length) {
      toast('只认音频文件（mp3 / m4a / wav / ogg / flac）', true);
      return [];
    }
    const wasEmpty = index.value === -1;
    const form = new FormData();
    audioFiles.forEach((f) => form.append('file', f, f.name));
    const data = await studio.withKey(() => uploadXhr('music', form, onProgress));
    const added = data.tracks || [];
    added.forEach((t) => tracks.value.push(t));
    if (wasEmpty) defaultIndex.value = 0;
    if (added.length) toast('已加入音乐盒：' + added.map((t) => t.title).join('、'));
    if (wasEmpty && added.length) play(0);
    return added;
  };

  /* 用本机另一个文件替换曲库里的某一首：位置、名字都不动，只换声音。
     上传成功之后再删旧文件——顺序反了会先丢歌再发现传失败。 */
  const swapFrom = async (i, file, onProgress) => {
    const t = tracks.value[i];
    if (!t || !file) return;
    if (!isAudioFile(file)) {
      toast('只认音频文件（mp3 / m4a / wav / ogg / flac）', true);
      return;
    }
    const form = new FormData();
    form.append('file', file, file.name);
    const data = await studio.withKey(() => uploadXhr('music', form, onProgress));
    const added = (data.tracks || [])[0];
    if (!added) throw new Error('服务没有返回新曲目');
    /* 新的一首顶到旧的位置上（歌曲顺序按加入时间，替换相当于原地换血） */
    tracks.value.splice(i, 1, added);
    if (defaultIndex.value === i) remember();
    await studio.withKey(() => studio.authed('music/' + encodeURIComponent(t.id), { method: 'DELETE' }));
    /* 刚换掉的正好是正在放的那一首：用新文件接着放。
       （判断里加上 index，因为放着的这首可能停在中途、src 还没落地） */
    const playingThis = index.value === i || (current() && current().id === added.id);
    if (playingThis) play(i, { auto: true });
    toast('《' + t.title + '》换成了新文件');
  };

  const renameTrack = async (i) => {
    const t = tracks.value[i];
    if (!t) return;
    const name = window.prompt('改成什么名字？', t.title);
    if (name === null) return;
    const next = name.trim();
    if (!next || next === t.title) return;
    try {
      await studio.withKey(() => studio.authed('music/' + encodeURIComponent(t.id), { method: 'PATCH', json: { title: next } }));
      t.title = next;
    } catch (err) {
      toast(apiError(err), true);
    }
  };

  const removeTrack = async (i) => {
    const t = tracks.value[i];
    if (!t) return;
    if (!window.confirm('删掉《' + t.title + '》？文件也会从 media/music/ 里删掉。')) return;
    try {
      await studio.withKey(() => studio.authed('music/' + encodeURIComponent(t.id), { method: 'DELETE' }));
      tracks.value.splice(i, 1);
      if (index.value >= tracks.value.length) index.value = tracks.value.length - 1;
      if (!tracks.value.length) {
        if (el) {
          el.pause();
          el.removeAttribute('src');
        }
        currentTime.value = 0;
        duration.value = 0;
      } else {
        play(index.value);
      }
      toast('删掉了');
    } catch (err) {
      toast(apiError(err), true);
    }
  };

  /* 只读快照：面板之外（自检、控制台）想知道音乐盒现在怎么想的时候用它，
     与旧的 cv01.music.state() 同一个用途。 */
  const state = () => ({
    tracks: tracks.value.map((t) => ({ id: t.id, title: t.title, file: t.file, url: t.url })),
    index: index.value,
    defaultIndex: defaultIndex.value,
    defaultTitle: pinned() ? pinned().title : '',
    startIndex: tracks.value.length ? startIndex() : -1,
    startTitle: tracks.value.length ? (tracks.value[startIndex()] || {}).title || '' : '',
    mode: mode.value,
    volume: volume.value,
    playing: playing.value,
    blocked: blocked.value,
    src: (el && (el.currentSrc || el.getAttribute('src'))) || '',
    paused: el ? el.paused : true,
  });

  return {
    /* 状态 */
    tracks,
    settings,
    index,
    defaultIndex,
    failed,
    mode,
    playing,
    blocked,
    volume,
    currentTime,
    duration,
    loaded,
    /* 读 */
    current,
    pinned,
    isBroken,
    startIndex,
    state,
    /* 播放 */
    bindAudio,
    load,
    reload,
    play,
    toggle,
    step,
    pin,
    setVolume,
    seek,
    cycleMode,
    /* 写（要口令） */
    uploadTracks,
    swapFrom,
    renameTrack,
    removeTrack,
  };
};
